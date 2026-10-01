// api/admin/_client-engine.js — the operating-model math + reference data.
//
// Plain browser JS (no import/export — this file is inlined as-is into the
// gated admin page by api/admin/model.js), attaching everything to `window.OM`.
// No React, no build step, matching the rest of this codebase (CLAUDE.md §2).
//
// Everything on the admin page is derived from this file. Nothing downstream
// is hard-coded: change an assumption and every month, quarter, summary row,
// chart band and reverse-lookup figure moves with it.
//
// ── How the projection is built ─────────────────────────────────────────────
// 1. Traffic follows an S-curve in log space, fitted so it passes through the
//    month-1, month-12 and month-24 session anchors exactly:
//      ln sessions(t) = A + B · sigmoid(k · (t − t0))
//    `k` (steepness) is a per-site constant; A, B and t0 are solved from the
//    anchors, by scanning for a sign change and bisecting. If no root exists
//    for a pathological set of anchors, this falls back to piecewise-geometric
//    interpolation so the page never renders NaN.
// 2. A fixed per-category monthly seasonality multiplier applies on top. The
//    anchors describe the deseasonalised trend, so a month's sessions can sit
//    slightly above or below its anchor.
// 3. Conversion matures from 80% to 125% of the stated rate over the horizon;
//    attribution capture ramps from today's rate to its month-24 target. Both
//    are normalised Weibull CDFs (p(t) = F(t)/F(24)), reaching their end state
//    exactly at month 24. Attribution ramps faster than conversion because the
//    affiliate wiring gets fixed in the first quarter, while trust and reviews
//    accumulate across the whole two years.
// 4. revenue = sessions × conversion × basket × commission × attribution.
//    GMV and orders are derived from revenue so that revenue/GMV always equals
//    commission × attribution and GMV/orders always equals the basket — true
//    for modelled and actuals-overridden months alike.
//
// Actuals entered for a closed month re-anchor everything after it — see
// applyActuals().

(function () {
  'use strict';

  /**
   * The ANCHOR horizon: 24 months. This is not the display length.
   *
   * Every calibrated part of the model is defined against month 24 and stays
   * that way whatever horizon is on screen: the third session anchor, the
   * month at which conversion and attribution finish maturing, and the
   * normalisation divisor for both Weibull ramps. `runModel` takes a separate
   * `displayMonths` (24 or 120) for how far to project. Raising THIS constant
   * would not lengthen the projection, it would restate the model, stretching
   * a two-year maturity curve over ten years.
   */
  const HORIZON_MONTHS = 24;
  /** Horizons offered on the page. The anchor horizon must stay first. */
  const DISPLAY_HORIZONS = [
    { key: '24', label: '2 years', months: 24 },
    { key: '120', label: '10 years', months: 120 },
  ];
  /** Month 1 of the projection. `month` is 0-indexed, so 8 = September. */
  const MODEL_START = { year: 2026, month: 8 };

  const CONVERSION_FLOOR = 0.8;
  const CONVERSION_CEILING = 1.25;
  const CONVERSION_RAMP = { scale: 11.1445, shape: 1.1606 };
  const ATTRIBUTION_RAMP = { scale: 9.5411, shape: 1.2217 };

  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  /** Spell out small counts so derived prose reads like prose, not a form. */
  const numWord = (n) => NUMBER_WORDS[n] || String(n);

  /**
   * Normalised Weibull CDF: p(1..24) rising to exactly 1 at the anchor horizon.
   *
   * The clamp matters once a projection can run past month 24. Dividing by
   * f(24) makes the ratio 1 at t=24, but f itself keeps rising after that (a
   * Weibull CDF only reaches 1 in the limit), so an unclamped ratio exceeds 1
   * further out and "conversion matures to 125% of the stated rate" would
   * quietly become 130%, then 140%, the longer the horizon. Every month past
   * 24 is fully matured by definition, which is exactly what clamping says.
   */
  function makeRamp(ramp) {
    const f = (t) => 1 - Math.exp(-Math.pow(t / ramp.scale, ramp.shape));
    const full = f(HORIZON_MONTHS);
    return (t) => Math.min(1, f(t) / full);
  }
  const conversionProgress = makeRamp(CONVERSION_RAMP);
  const attributionProgress = makeRamp(ATTRIBUTION_RAMP);

  /**
   * Fit ln(sessions) = A + B·sigmoid(k(t − t0)) through the three anchors.
   * Only t0 needs solving — A and B follow from it. Falls back to
   * piecewise-geometric interpolation if no root exists.
   */
  function fitTrafficCurve(month1, month12, month24, steepness) {
    const s1 = Math.max(month1, 1);
    const s12 = Math.max(month12, 1);
    const s24 = Math.max(month24, 1);

    const a1 = Math.log(s1);
    const a12 = Math.log(s12);
    const a24 = Math.log(s24);
    const span = a24 - a1;

    // Past month 24 this holds flat at the month-24 anchor instead of
    // continuing the month-12-to-24 log slope forever. The sigmoid fit below
    // plateaus past its anchors on its own (that is what a sigmoid does); this
    // piecewise stand-in has no such ceiling, and it used to be asked only for
    // t in [1, 24]. A ten-year run asks it for t up to 120, where an ordinary
    // non-monotonic anchor set (a modelled dip at month 12) compounds that
    // slope for 96 more months into session counts in the quintillions:
    // silent, non-crashing, and meaningless.
    const geometricFallback = () => (t) => {
      if (t <= 1) return s1;
      if (t <= 12) return Math.exp(a1 + ((a12 - a1) * (t - 1)) / 11);
      if (t <= 24) return Math.exp(a12 + ((a24 - a12) * (t - 12)) / 12);
      return s24;
    };

    if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return geometricFallback();

    const target = (a12 - a1) / span;
    const residual = (t0) => {
      const u = sigmoid(steepness * (1 - t0));
      const v = sigmoid(steepness * (12 - t0));
      const w = sigmoid(steepness * (24 - t0));
      const denom = w - u;
      if (Math.abs(denom) < 1e-15) return NaN;
      return (v - u) / denom - target;
    };

    // Scan for a sign change, then bisect. The scan makes this robust to
    // anchor sets that push the root far outside the horizon.
    let lo = null;
    let hi = 0;
    let prevT = null;
    let prevV = null;
    for (let t = -400; t <= 400; t += 0.5) {
      const v = residual(t);
      if (!Number.isFinite(v)) {
        prevT = null;
        prevV = null;
        continue;
      }
      if (prevV !== null && prevT !== null && prevV * v <= 0) {
        lo = prevT;
        hi = t;
        break;
      }
      prevT = t;
      prevV = v;
    }
    if (lo === null) return geometricFallback();

    let low = lo;
    let high = hi;
    for (let i = 0; i < 200; i += 1) {
      const mid = (low + high) / 2;
      const vm = residual(mid);
      if (!Number.isFinite(vm)) return geometricFallback();
      const vl = residual(low);
      if (!Number.isFinite(vl)) return geometricFallback();
      if (vl * vm <= 0) high = mid;
      else low = mid;
    }

    const t0 = (low + high) / 2;
    const u = sigmoid(steepness * (1 - t0));
    const w = sigmoid(steepness * (24 - t0));
    const B = span / (w - u);
    const A = a1 - B * u;
    if (!Number.isFinite(A) || !Number.isFinite(B)) return geometricFallback();

    return (t) => Math.exp(A + B * sigmoid(steepness * (t - t0)));
  }

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function calendarMonth(t) {
    return (MODEL_START.month + (t - 1)) % 12;
  }

  function monthLabel(t) {
    const absolute = MODEL_START.month + (t - 1);
    const year = MODEL_START.year + Math.floor(absolute / 12);
    return `${MONTH_NAMES[absolute % 12]} ${String(year % 100).padStart(2, '0')}`;
  }

  function buildMonthLabels(months) {
    return Array.from({ length: months }, (_, i) => monthLabel(i + 1));
  }
  const MONTH_LABELS = buildMonthLabels(HORIZON_MONTHS);

  function applyScenario(base, scenario) {
    return Object.assign({}, base, {
      sessionsMonth12: base.sessionsMonth12 * scenario.sessions12,
      sessionsMonth24: base.sessionsMonth24 * scenario.sessions24,
      conversionPct: base.conversionPct * scenario.conversion,
      attributionExitPct: scenario.freezeAttribution ? base.attributionNowPct : base.attributionExitPct,
    });
  }

  /** Revenue per session once conversion and attribution have fully matured. */
  function maturityRevPerSession(a) {
    return a.basket * (a.commissionPct / 100) * ((a.conversionPct / 100) * CONVERSION_CEILING) * (a.attributionExitPct / 100);
  }

  function attributionAt(a, t) {
    const now = a.attributionNowPct / 100;
    const exit = a.attributionExitPct / 100;
    return now + (exit - now) * attributionProgress(t);
  }

  function conversionAt(a, t) {
    const maturity = CONVERSION_FLOOR + (CONVERSION_CEILING - CONVERSION_FLOOR) * conversionProgress(t);
    return (a.conversionPct / 100) * maturity;
  }

  function projectSite(profile, effective, displayMonths) {
    const curve = fitTrafficCurve(effective.sessionsMonth1, effective.sessionsMonth12, effective.sessionsMonth24, profile.curveSteepness);
    const commission = effective.commissionPct / 100;

    const rows = [];
    for (let i = 0; i < displayMonths; i += 1) {
      const t = i + 1;
      const seasonal = profile.seasonality[calendarMonth(t)] ?? 1;
      const sessions = Math.max(0, Math.round(curve(t) * seasonal));
      const conversion = conversionAt(effective, t);
      const attribution = attributionAt(effective, t);
      const revenue = sessions * conversion * effective.basket * commission * attribution;
      rows.push({
        sessions,
        revenue,
        revPerSession: sessions > 0 ? revenue / sessions : 0,
        attribution,
      });
    }
    return rows;
  }

  /**
   * Re-anchor the projection on months that have closed.
   *
   * A month counts as closed only when BOTH real sessions and real earned
   * commission are present — revenue alone can't tell you whether you missed
   * on traffic or on yield. Once closed months exist:
   *   • forward traffic is scaled by how actual sessions are tracking vs plan
   *   • forward revenue per session is re-based on realised yield, while
   *     keeping the modelled improvement curve intact
   * Both indices are pooled totals rather than a per-month average, so one
   * freak month doesn't dominate.
   */
  function applyActuals(raw, actuals) {
    const closed = [];
    if (actuals) {
      for (let t = 1; t <= raw.length; t += 1) {
        const entry = actuals[t];
        const s = entry && entry.sessions;
        const r = entry && entry.revenue;
        if (typeof s === 'number' && s > 0 && typeof r === 'number' && r >= 0) closed.push(t);
      }
    }
    if (closed.length === 0) return { rows: raw, closedMonths: [], trafficIndex: 1, yieldIndex: 1 };

    let actualSessions = 0;
    let modelSessions = 0;
    let actualRevenue = 0;
    let modelRevenue = 0;
    for (const t of closed) {
      const entry = actuals[t];
      actualSessions += entry.sessions;
      actualRevenue += entry.revenue;
      modelSessions += raw[t - 1].sessions;
      modelRevenue += raw[t - 1].revenue;
    }

    const trafficIndex = modelSessions > 0 ? actualSessions / modelSessions : 1;
    const actualRps = actualSessions > 0 ? actualRevenue / actualSessions : 0;
    const modelRps = modelSessions > 0 ? modelRevenue / modelSessions : 0;
    const yieldIndex = modelRps > 0 && actualRps > 0 ? actualRps / modelRps : 1;

    const lastClosed = closed[closed.length - 1];
    const rows = raw.map((row, i) => {
      const t = i + 1;
      const entry = actuals[t];
      const isClosed = closed.includes(t);
      if (isClosed) {
        const sessions = entry.sessions;
        const revenue = entry.revenue;
        return Object.assign({}, row, { sessions, revenue, revPerSession: sessions > 0 ? revenue / sessions : 0 });
      }
      if (t <= lastClosed) return row;
      const sessions = Math.round(row.sessions * trafficIndex);
      const revPerSession = row.revPerSession * yieldIndex;
      return Object.assign({}, row, { sessions, revPerSession, revenue: sessions * revPerSession });
    });

    return { rows, closedMonths: closed, trafficIndex, yieldIndex };
  }

  function buildQuarters(months) {
    const quarters = [];
    // Derived from what was actually projected, not from the anchor horizon,
    // or a ten-year run would render eight quarters and drop the other 32.
    for (let q = 0; q < Math.ceil(months.length / 3); q += 1) {
      const slice = months.slice(q * 3, q * 3 + 3);
      if (slice.length === 0) break;
      const sessions = slice.reduce((s, m) => s + m.sessions, 0);
      const orders = slice.reduce((s, m) => s + m.orders, 0);
      const gmv = slice.reduce((s, m) => s + m.gmv, 0);
      const revenue = slice.reduce((s, m) => s + m.revenue, 0);
      const prior = quarters[q - 1];
      quarters.push({
        index: q + 1,
        label: `Q${q + 1}`,
        monthsLabel: `${slice[0].label} – ${slice[slice.length - 1].label}`,
        sessions,
        orders,
        gmv,
        revenue,
        revPerSession: sessions > 0 ? revenue / sessions : 0,
        changeVsPriorPct: prior && prior.revenue > 0 ? ((revenue - prior.revenue) / prior.revenue) * 100 : null,
      });
    }
    return quarters;
  }

  /**
   * `displayMonths` is how far to project, defaulting to the anchor horizon.
   * It never changes the calibration: the session anchors, the maturity month
   * and both ramp divisors stay pinned to month 24 (see HORIZON_MONTHS), so
   * switching to ten years extends the same model rather than restating it.
   */
  function runModel(profiles, overrides, scenario, actuals, displayMonths) {
    const months_ = Math.max(1, Math.round(displayMonths || HORIZON_MONTHS));
    const labels = months_ === HORIZON_MONTHS ? MONTH_LABELS : buildMonthLabels(months_);
    const sites = {};
    const order = [];

    for (const profile of profiles) {
      order.push(profile.key);
      const base = Object.assign({}, profile.assumptions, (overrides && overrides[profile.key]) || {});
      const effective = applyScenario(base, scenario);

      const raw = projectSite(profile, effective, months_);
      const { rows, closedMonths } = applyActuals(raw, actuals && actuals[profile.key]);

      const commission = effective.commissionPct / 100;
      const months = rows.map((row, i) => {
        const t = i + 1;
        const entry = actuals && actuals[profile.key] && actuals[profile.key][t];
        const hasSessions = typeof (entry && entry.sessions) === 'number' && entry.sessions > 0;
        const hasRevenue = typeof (entry && entry.revenue) === 'number' && entry.revenue >= 0;
        const isActual = hasSessions && hasRevenue;

        // GMV and orders are derived so that revenue/GMV always equals
        // commission × attribution and GMV/orders always equals the basket —
        // true for both modelled and re-anchored months.
        const denominator = commission * row.attribution;
        const gmv = denominator > 0 ? row.revenue / denominator : 0;
        const orders = effective.basket > 0 ? gmv / effective.basket : 0;

        const planned = raw[i];
        return {
          index: t,
          label: labels[i],
          sessions: row.sessions,
          revPerSession: row.revPerSession,
          orders,
          gmv,
          revenue: row.revenue,
          actualSessions: hasSessions ? entry.sessions : null,
          actualRevenue: hasRevenue ? entry.revenue : null,
          plannedRevenue: planned.revenue,
          plannedSessions: planned.sessions,
          revenueVariancePct: isActual && planned.revenue > 0 ? ((entry.revenue - planned.revenue) / planned.revenue) * 100 : null,
          sessionsVariancePct: isActual && planned.sessions > 0 ? ((entry.sessions - planned.sessions) / planned.sessions) * 100 : null,
          isActual,
          isReanchored: !isActual && row.revenue !== planned.revenue,
        };
      });

      // Both windows are fixed calendar years, NOT "the rest of the horizon".
      // year2 was .slice(12) when 24 months was the only option, where the two
      // are the same thing. On a ten-year run that would silently report nine
      // years of revenue in a column headed "Year 2".
      const year1Revenue = months.slice(0, 12).reduce((s, m) => s + m.revenue, 0);
      const year2Revenue = months.slice(12, 24).reduce((s, m) => s + m.revenue, 0);
      const last = months[months.length - 1];

      sites[profile.key] = {
        key: profile.key,
        profile,
        months,
        quarters: buildQuarters(months),
        year1Revenue,
        year2Revenue,
        // The full horizon, which is why this is no longer year1 + year2.
        totalRevenue: months.reduce((s, m) => s + m.revenue, 0),
        totalSessions: months.reduce((s, m) => s + m.sessions, 0),
        totalOrders: months.reduce((s, m) => s + m.orders, 0),
        totalGmv: months.reduce((s, m) => s + m.gmv, 0),
        // "finalMonth", not "month24": this is the last month of whatever
        // horizon ran. Naming it month24 is how a 10-year exit run-rate ends
        // up printed under a "Month 24" heading.
        finalMonthRevenue: last.revenue,
        finalMonthSessions: last.sessions,
        exitRunRate: last.revenue * 12,
        maturityRevPerSession: maturityRevPerSession(effective),
        effective,
        closedMonths,
      };
    }

    const list = order.map((k) => sites[k]);
    const finalMonthRevenue = list.reduce((s, p) => s + p.finalMonthRevenue, 0);
    const finalMonthSessions = list.reduce((s, p) => s + p.finalMonthSessions, 0);

    return {
      sites,
      order,
      displayMonths: months_,
      totals: {
        year1Revenue: list.reduce((s, p) => s + p.year1Revenue, 0),
        year2Revenue: list.reduce((s, p) => s + p.year2Revenue, 0),
        totalRevenue: list.reduce((s, p) => s + p.totalRevenue, 0),
        finalMonthRevenue,
        finalMonthSessions,
        exitRunRate: finalMonthRevenue * 12,
        blendedRevPerSession: finalMonthSessions > 0 ? finalMonthRevenue / finalMonthSessions : 0,
        totalSessions: list.reduce((s, p) => s + p.totalSessions, 0),
        indexablePages: list.reduce((s, p) => s + p.profile.indexablePages, 0),
      },
      monthLabels: labels,
    };
  }

  // ── formatting ──────────────────────────────────────────────────────────

  const money = (n, digits = 0) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  const count = (n, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rps = (n) => `$${n.toFixed(3)}`;
  const signedPercent = (n, digits = 0) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;

  // ── reference data ──────────────────────────────────────────────────────
  // Ported verbatim from the 8 August 2026 model brief.

  const PREPARED_ON = '8 August 2026';

  const COLORS = { legal: '#25a942', kawaii: '#d55181', herbal: '#c98500', nicotia: '#4a90e2', gearavail: '#f0a830' };

  const SITE_PROFILES = [
    {
      key: 'legal', name: 'Legal Leaf Market', shortName: 'Legal Leaf', domain: 'legal-leafmarket.com',
      tagline: 'Hemp / THCa price comparison · 18 stores · 3,576 products', color: COLORS.legal,
      seasonality: [0.8281, 0.815, 0.9292, 1.1072, 1.0106, 1.0088, 1.038, 1.0116, 0.9597, 0.9336, 0.8508, 0.8305],
      curveSteepness: 0.2558, indexablePages: 15,
      assumptions: { sessionsMonth1: 600, sessionsMonth12: 4500, sessionsMonth24: 20000, basket: 95, commissionPct: 15, conversionPct: 1.5, attributionNowPct: 60, attributionExitPct: 90 },
    },
    {
      key: 'kawaii', name: 'KawaiiKatz', shortName: 'KawaiiKatz', domain: 'kawaiikatz.com',
      tagline: 'Kawaii / anime merchandise · 9 vendors', color: COLORS.kawaii,
      seasonality: [0.7542, 0.8734, 0.8157, 0.8273, 0.8707, 0.9165, 0.9541, 1.0241, 0.9606, 0.9799, 1.1063, 1.0918],
      curveSteepness: 0.2588, indexablePages: 2,
      assumptions: { sessionsMonth1: 500, sessionsMonth12: 5000, sessionsMonth24: 26000, basket: 45, commissionPct: 9, conversionPct: 1.2, attributionNowPct: 25, attributionExitPct: 90 },
    },
    {
      key: 'herbal', name: 'Herbal Leaf Market', shortName: 'Herbal Leaf', domain: 'herballeafmarket.com',
      tagline: 'CBD / botanicals / tea · 6 makers · 540 products', color: COLORS.herbal,
      seasonality: [0.9572, 0.8765, 0.8681, 0.8645, 0.8684, 0.8368, 0.8472, 0.901, 0.9898, 1.0482, 1.1018, 1.1371],
      curveSteepness: 0.2782, indexablePages: 5,
      assumptions: { sessionsMonth1: 350, sessionsMonth12: 2000, sessionsMonth24: 8500, basket: 58, commissionPct: 17, conversionPct: 1.3, attributionNowPct: 40, attributionExitPct: 88 },
    },
    {
      key: 'nicotia', name: 'Nicotia Market', shortName: 'Nicotia', domain: 'nicotiamarket.com',
      tagline: 'Nicotine per-unit comparison · 15 stores · 2,451 listings', color: COLORS.nicotia,
      seasonality: [0.962, 0.8837, 0.9062, 0.9165, 0.9437, 0.9545, 0.9663, 0.9802, 0.9873, 0.9461, 0.9091, 0.9008],
      curveSteepness: 0.2794, indexablePages: 17,
      assumptions: { sessionsMonth1: 450, sessionsMonth12: 3000, sessionsMonth24: 14000, basket: 52, commissionPct: 9, conversionPct: 1.4, attributionNowPct: 55, attributionExitPct: 88 },
    },
    {
      // The fifth site, live since 10 Aug 2026, and structurally different from
      // the other four in two ways that matter to this model:
      //   1. Musical instruments are not a restricted advertising category, so
      //      paid acquisition is a real lever here. Month 1 includes ~150
      //      sessions from a $100/mo ad budget the others cannot legally spend.
      //   2. Its /gear and /deals pages are generated FROM the ingested
      //      catalogue rather than hand-authored, so indexable page count
      //      already scales with inventory. indexablePages counts only the 15
      //      hand-built category landings, not the ~10,000 generated ones,
      //      which is why the number looks small next to the others.
      // commissionPct is the catalogue-weighted real rate across the live
      // GoAffPro stores (6.77%), read store by store off GoAffPro's directory,
      // not an estimate. Month 1 also carries a proven ~750 sessions/mo from
      // the Instagram account already running for it.
      key: 'gearavail', name: 'Gear Avail', shortName: 'Gear Avail', domain: 'gearavail.com',
      tagline: 'Used / vintage / new gear · 12 stores · market price per instrument', color: COLORS.gearavail,
      seasonality: [0.82, 0.83, 0.9, 0.95, 0.95, 0.9, 0.85, 0.95, 1.0, 1.05, 1.35, 1.45],
      curveSteepness: 0.26, indexablePages: 15,
      assumptions: { sessionsMonth1: 1250, sessionsMonth12: 9000, sessionsMonth24: 30000, basket: 120, commissionPct: 6.77, conversionPct: 1.3, attributionNowPct: 60, attributionExitPct: 90 },
    },
  ];
  const SITE_MAP = Object.fromEntries(SITE_PROFILES.map((s) => [s.key, s]));

  const SCENARIOS = {
    bear: { key: 'bear', label: 'Bear', headline: 'The applications never get filed',
      detail: 'Attribution stays where it is today, so every merchant that cannot credit you never starts. Page count stays flat, so organic never compounds. Traffic lands at roughly 40% of plan by month 24 and conversion at 85% of the stated rate. This is the hobby column.',
      sessions12: 0.55, sessions24: 0.4, conversion: 0.85, freezeAttribution: true },
    base: { key: 'base', label: 'Base', headline: 'Consistent solo effort',
      detail: 'Programmatic pages built from data you already hold, steady community presence, a newsletter, and the affiliate applications actually filed. Attribution ramps to its month-24 target because you did the paperwork; traffic hits the anchors below.',
      sessions12: 1, sessions24: 1, conversion: 1, freezeAttribution: false },
    bull: { key: 'bull', label: 'Bull', headline: 'One channel breaks out',
      detail: 'Not four channels grinding — one working. A state-legality page cluster that ranks, or a creator partnership that sticks. Traffic runs 2.2× plan by month 24 and conversion 15% above the stated rate on the back of a stronger brand and returning visitors.',
      sessions12: 1.6, sessions24: 2.2, conversion: 1.15, freezeAttribution: false },
  };
  const SCENARIO_ORDER = ['bear', 'base', 'bull'];

  const MERCHANTS = {
    legal: [
      { merchant: 'Puffy (HiPuffy)', platform: 'Shopify', ratePct: 10, status: 'tracking', sharePct: 18, note: 'Coupon verified at checkout' },
      { merchant: 'Black Tie CBD', platform: 'Shopify', ratePct: 12, status: 'tracking', sharePct: 13, note: '161 own certificates · richest data' },
      /* A merchant was delisted on 10 Aug 2026 for short-shipping an order, and its 15 points
         moved HERE rather than being deleted. These shares are a distribution summing to 100, so
         dropping a row outright would have left the legal site modelled at 85 and quietly
         understated it: attributableShare below is an absolute sum, not a normalised one.
         Moving the share is also the honest guess about behaviour, since demand does not leave
         with the merchant. Somebody after a $50 ounce lands on the same page and buys the same
         weight from whoever else has it, and this is the store competing for that exact query at
         the same 10%. It is an assumption, so it is written down: if real months show those
         clicks landing elsewhere, re-split it from the actuals. */
      { merchant: 'THCA Small Buds', platform: 'Shopify', ratePct: 10, status: 'tracking', sharePct: 26, note: 'Coupon verified · absorbed a delisted peer\'s share' },
      /* Binoid delisted 20 Aug 2026, and its 9 points STAY HERE rather than moving, which is
         the opposite of what THCA King's 15 did four rows up. The difference is what each
         delisting removed. THCA King left a demand pool this site still serves -- somebody
         after a $50 ounce buys the same weight from whoever else has it -- so the share moved
         to the shop competing for that query. Binoid's share was mostly demand for delta-8
         and the other synthetics, and this site has now DECIDED not to serve that at all, so
         there is nobody for it to move to; a visitor searching for it finds nothing and
         leaves. status 'none' models exactly that: the row keeps the distribution summing to
         100, and attributableShare (which skips 'none') correctly stops crediting the 9.
         Deleting the row instead would have modelled the site at 91. */
      { merchant: 'Binoid', platform: 'WooCommerce', ratePct: null, status: 'none', sharePct: 9, note: 'Delisted 20 Aug 2026 · synthetics-led range · not what this site compares' },
      { merchant: 'Bloomz', platform: 'WooCommerce', ratePct: 15, status: 'tracking', sharePct: 7, note: 'Cart pre-fill working' },
      { merchant: 'Exhale', platform: 'WooCommerce', ratePct: 15, status: 'tracking', sharePct: 6, note: '—' },
      { merchant: 'THCA4Cheap', platform: 'WooCommerce', ratePct: 10, status: 'tracking', sharePct: 5, note: 'URL coupon verified −10%' },
      { merchant: 'THCa Hempire', platform: 'BigCommerce', ratePct: 10, status: 'partial', sharePct: 4, note: 'Bookmarklet hand-off only' },
      { merchant: 'Nothing But Canna', platform: 'Shopify', ratePct: 12, status: 'partial', sharePct: 4, note: 'Needs sca_ref · plain ref earned $0' },
      { merchant: 'Greek Glass', platform: 'Big Cartel', ratePct: 10, status: 'partial', sharePct: 3, note: 'Bookmarklet hand-off only' },
      { merchant: 'Cielo (was DSquared)', platform: 'Shopify', ratePct: null, status: 'none', sharePct: 1, note: 'Rebranded · old link 404s · re-enrol' },
      /* Lookah joined 22 Aug 2026 with no approved affiliate id, so it adds
         catalogue and earns nothing yet -- the row's share is unchanged and its
         status stays 'partial' rather than improving on the strength of a shop
         that currently pays zero. */
      { merchant: 'Accessories (7 stores)', platform: 'mixed', ratePct: 8, status: 'partial', sharePct: 4, note: 'Grasscity, Chill, Hitoki, Zam, YLLVAPE, Mein-Grinder, Lookah (unmonetised)' },
    ],
    kawaii: [
      { merchant: 'BRKOX', platform: 'Awin 129093', ratePct: 9, status: 'tracking', sharePct: 64, note: 'Verified end to end · showcase page' },
      { merchant: 'Kore Kawaii', platform: 'Shopify', ratePct: null, status: 'none', sharePct: 12, note: 'No affiliate programme wired' },
      { merchant: 'Seven other vendors', platform: 'Shopify', ratePct: null, status: 'none', sharePct: 24, note: 'No affiliate IDs · all clicks earn $0' },
    ],
    herbal: [
      { merchant: 'Rishi Tea', platform: 'Awin 53225', ratePct: 10, status: 'tracking', sharePct: 34, note: 'Approved 8 Aug · 187 products, healthiest feed' },
      { merchant: 'Natural Smoke Shop', platform: 'tr=138', ratePct: 10, status: 'partial', sharePct: 34, note: 'Attribution unconfirmed · /shop 301s to cart' },
      { merchant: 'Bear Blend', platform: 'ref=JAC6375', ratePct: 12, status: 'tracking', sharePct: 18, note: '30-day cookie verified · seed prices, no live feed' },
      { merchant: 'Puff Herbals', platform: 'Awin 74076', ratePct: 10, status: 'tracking', sharePct: 14, note: '—' },
      { merchant: 'Secret Nature', platform: 'Awin (no ID)', ratePct: 15, status: 'none', sharePct: 0, note: 'Largest catalogue (207) and earns nothing' },
      { merchant: 'Soul CBD', platform: 'Awin (no ID)', ratePct: 20, status: 'none', sharePct: 0, note: 'Merchant ID missing' },
      { merchant: "Charlotte's Web", platform: 'Awin (no ID)', ratePct: 10, status: 'none', sharePct: 0, note: 'Merchant ID missing' },
    ],
    nicotia: [
      { merchant: 'Europesnus', platform: 'Shopify', ratePct: 10, status: 'tracking', sharePct: 17, note: 'FLASH25 verified −25%' },
      { merchant: 'RELX Global', platform: 'Awin feed', ratePct: 10, status: 'tracking', sharePct: 15, note: 'Permalink checkout verified' },
      { merchant: 'BnB Tobacco', platform: 'Awin feed', ratePct: 10, status: 'tracking', sharePct: 13, note: '—' },
      { merchant: 'EightVape', platform: 'WooCommerce', ratePct: 10, status: 'tracking', sharePct: 12, note: '—' },
      { merchant: 'Wave Vape', platform: 'WooCommerce', ratePct: 10, status: 'tracking', sharePct: 11, note: 'OFF10 advertised by store but invalid' },
      { merchant: 'Vaporesso / Geekvape', platform: 'Shopify', ratePct: 12, status: 'tracking', sharePct: 10, note: '—' },
      { merchant: 'Fruitia', platform: 'Awin feed', ratePct: 10, status: 'tracking', sharePct: 9, note: '—' },
      { merchant: 'Kind Juice', platform: 'Awin feed', ratePct: 10, status: 'tracking', sharePct: 8, note: '—' },
      { merchant: 'Others (4 stores)', platform: 'mixed', ratePct: 9, status: 'partial', sharePct: 5, note: '—' },
      { merchant: 'Nicokick', platform: 'Magento', ratePct: null, status: 'none', sharePct: 0, note: 'CJ publisher + advertiser IDs empty' },
      { merchant: 'Black Buffalo', platform: 'Refersion', ratePct: 10, status: 'none', sharePct: 0, note: 'Refersion ACCOUNT pending, one level above this merchant · direct outreach sent 10 Aug 2026' },
      { merchant: 'Nicokick (rate found)', platform: 'CJ 5497560', ratePct: 3, status: 'none', sharePct: 0, note: 'Rate CONFIRMED at 3% in CJ directory · EPC $30.28, strongest in this set · appears joined, verify in dashboard' },
    ],
    gearavail: [
      // Real catalogue counts from the ingestion runs that populated
      // production, and real rates read store by store off GoAffPro's own
      // directory on 9 Aug 2026.
      //
      // TWO SHAPE DIFFERENCES worth knowing before comparing these to the
      // rows above. First, Gear Avail's own page models depth by ingested
      // catalogue count rather than a revenue-share estimate; sharePct here is
      // derived as catalogue x rate, normalised across the non-paused stores,
      // so it is a modelled mix and not a measurement. Second, that page uses
      // a richer status vocabulary (unconfirmed / pending / paused) than this
      // file's tracking / partial / none. Anything that earns nothing today
      // maps to 'none' so attributableShare stays honest, with the real state
      // kept in the note.
      { merchant: 'Eason Music Store', platform: 'Shopify', ratePct: 10, status: 'tracking', sharePct: 27, note: 'Confirmed real referral link · 1,037 products' },
      { merchant: 'Acoustic Guitar', platform: 'Shopify', ratePct: 10, status: 'none', sharePct: 26.1, note: 'UNCONFIRMED · 1,000 products at 10%, the best size-and-rate combination on the board and it earns nothing' },
      { merchant: 'Haze Guitar', platform: 'Shopify', ratePct: 5, status: 'tracking', sharePct: 16.2, note: 'Confirmed real referral link · 1,240 products, the largest live catalogue' },
      { merchant: 'Folkcraft Instruments', platform: 'Shopify', ratePct: 5, status: 'none', sharePct: 11.2, note: 'UNCONFIRMED · first store built · 12-HOUR cookie, close to unmonetisable until renegotiated' },
      { merchant: 'EART Guitar', platform: 'Shopify', ratePct: 5, status: 'tracking', sharePct: 10.5, note: 'Confirmed real referral link (auto-generated code)' },
      { merchant: 'Go Kalimba', platform: 'Shopify', ratePct: 7, status: 'tracking', sharePct: 3.2, note: 'Confirmed real referral link' },
      { merchant: 'Eminence Digital', platform: 'Shopify', ratePct: 20, status: 'tracking', sharePct: 3.1, note: 'Highest rate in the family · digital impulse-response packs, not physical gear' },
      { merchant: 'Jamstik', platform: 'Shopify', ratePct: 5, status: 'none', sharePct: 1.2, note: 'UNCONFIRMED · GoAffPro signup done, no link handed over' },
      { merchant: 'Play With Authority', platform: 'Shopify', ratePct: 10, status: 'none', sharePct: 1, note: 'PENDING · real link in hand, approval outstanding' },
      { merchant: 'Squaver', platform: 'WooCommerce', ratePct: 10, status: 'tracking', sharePct: 0.5, note: 'Confirmed link · weaker compliance basis (Store API, no agents.md)' },
      { merchant: 'Jackson Audio', platform: 'Shopify', ratePct: 0, status: 'tracking', sharePct: 0, note: 'Link works and pays 0%. Every click there is free traffic sent to a merchant' },
      { merchant: 'Pures Music', platform: 'Shopify', ratePct: 4, status: 'none', sharePct: 0, note: 'PAUSED on a product-mix decision (crystal singing bowls) · 4,368 products, excluded from the mix above' },
      { merchant: 'eBay', platform: 'Buy Feed API', ratePct: null, status: 'none', sharePct: 0, note: 'Sandboxed · no production EPN keyset approved · largest addressable used-gear catalogue there is' },
      { merchant: 'Reverb', platform: 'Awin 67144', ratePct: null, status: 'none', sharePct: 0, note: 'Datafeed CONFIRMED to exist · 100% approval, 30-day cookie · rate undisclosed in the directory, so null not 0' },
      { merchant: 'Gear4music', platform: 'Awin 1117', ratePct: 3.5, status: 'none', sharePct: 0, note: 'Feed confirmed · 3.5-5% · four regional programmes · needs the feed URL' },
      { merchant: 'zZounds', platform: 'CJ 1779394', ratePct: 6, status: 'none', sharePct: 0, note: 'Rate confirmed in CJ directory · appears joined already, verify in dashboard · EPC $1.94' },
      { merchant: 'Pineville Music', platform: 'CJ 6425392', ratePct: 7, status: 'none', sharePct: 0, note: 'Rate confirmed · highest of the three CJ retailers · APPLY TO PROGRAM' },
      { merchant: 'Full Compass Systems', platform: 'CJ 6382932', ratePct: 4, status: 'none', sharePct: 0, note: 'Lowest rate of the three and by far the strongest EPC at $28.69 · file this application first' },
      { merchant: "Anderton's", platform: 'Impact.com', ratePct: null, status: 'none', sharePct: 0, note: 'Application submitted 10 Aug 2026 with a written pitch · Impact publishes no directory rates · brand-defined feed columns, so approval alone does not unblock ingestion' },
      { merchant: 'Sweetwater', platform: 'LinkConnector', ratePct: null, status: 'none', sharePct: 0, note: 'No confirmed feed URL · never scraped as a substitute' },
    ],
  };

  /**
   * Share of a site's modelled revenue mix that can actually be credited today.
   * Returns 0 for a site with no merchant rows rather than throwing: adding a
   * SITE_PROFILE without a MERCHANTS entry is exactly how this page went blank
   * when Gear Avail was added, and a new site is always profiled before its
   * merchant list is written.
   */
  function attributableShare(key) {
    const rows = MERCHANTS[key];
    if (!Array.isArray(rows)) return 0;
    return rows.filter((m) => m.status !== 'none').reduce((sum, m) => sum + m.sharePct, 0);
  }

  const FACTS = [
    { tag: 'Structural · cannot be fixed', title: 'You cannot buy traffic',
      body: 'Google, Meta and TikTok all prohibit ads for THC, hemp flower, vapes and nicotine outright. Meta permits only LegitScript-certified CBD topicals; Google permits topical CBD in three jurisdictions. Organic posts on cannabis and nicotine get removed or shadowbanned without notice. Legal Leaf, Nicotia and most of Herbal Leaf are organic-only businesses by law and by platform policy. KawaiiKatz is the one site that can advertise, but see the economics section, because at 9% commission on a $45 basket it cannot afford to.' },
    { tag: 'Fixable · highest leverage', title: '54 hand-built pages is not a catalogue',
      body: "Measured live: Legal Leaf's sitemap lists 15 URLs, Nicotia 17, Herbal Leaf 5, KawaiiKatz 2, and Gear Avail 15 hand-authored category landings. Your direct competitor hempprice.store tracks 13,800 products across 169 vendors with per-state legal pages and a vendor directory. Long-tail search is how comparison sites live, and on four of these five sites you are offering search engines almost no surface to land on. You already hold the data (3,576 products, 1,071 certificates, 18 stores). It simply isn't published as pages. Gear Avail is the counter-example worth copying: its per-instrument and per-deal pages are generated FROM the ingested catalogue, so its indexable surface already grows with inventory instead of waiting on someone to hand-write it." },
    { tag: 'Fixable · fastest money', title: 'Much of your traffic earns nothing',
      body: "Herbal Leaf's largest vendor by catalogue (Secret Nature, 207 products) has no merchant ID, so it earns $0. So do Soul CBD and Charlotte's Web. Eight of KawaiiKatz's nine vendors have no affiliate wiring at all. Nicokick's network IDs are empty. Black Buffalo isn't approved. This is revenue you are already generating and giving away, and closing it costs applications, not traffic." },
  ];

  const NEXT_90_DAYS = [
    { title: 'Close the attribution gaps before writing a single new page',
      body: "Apply for Awin merchant IDs for Secret Nature, Soul CBD and Charlotte's Web. Get the eight unwired KawaiiKatz vendors onto affiliate programmes or drop them. Fill Nicokick's CJ publisher and advertiser IDs. Apply to Black Buffalo's Refersion programme. Confirm how Natural Smoke Shop records ?tr=138, and re-enrol with Cielo after their rebrand.",
      why: 'Multiplies revenue on traffic you already have. Costs applications, not months.' },
    { title: 'Turn your data into pages',
      body: 'You hold 3,576 products, 1,071 certificates, 18 vendors and per-state legality rules. That is a strain hub, a vendor-review page per store, a state-by-state legality page, a “cheapest ounce right now” page per strain, and a lab-report explainer per certificate. Going from 15 URLs to several hundred genuinely useful ones is the difference between the bear and base columns.',
      why: 'Long-tail organic is the only scalable channel legally open to you.' },
    { title: 'Decide whether the no-product-URLs rule still serves you',
      body: 'The sitemap deliberately omits product URLs so as never to compete with a vendor for their own listing. That is a principled call and it is also the single largest cap on your organic surface. A middle path exists: index comparison and strain pages that rank for “best price” and “vs” queries rather than the vendor’s own product name.',
      why: 'This is a business decision, not a technical one. It belongs to you.' },
    { title: 'Build the email list now, while traffic is small',
      body: 'Nicotine and hemp are consumables with the highest repeat rates of anything you sell, and email is the one channel no platform can shadowban. The subscribe endpoint is a no-op sink unless the Resend keys are set. Set them.',
      why: 'Owned audience is worth more than rented reach in a category that gets deplatformed.' },
    { title: 'Negotiate rates once you can show a statement',
      body: 'Coupon-code arrangements at 10% are the worst-paying instrument you have. Once any merchant sees consistent volume from you, a direct 20–25% deal is a normal ask. Doubling blended commission doubles revenue with zero extra traffic. It is strictly cheaper than doubling the audience.',
      why: 'Revenue per session is a lever you control; traffic is one you only influence.' },
    { title: 'Put KawaiiKatz on a different footing or accept it as a side project',
      body: 'It is the only site that may legally advertise and the only one whose economics forbid it. Either raise its take rate (print-on-demand or a dropship line at 30–40% margin instead of 9% affiliate) or run it purely on Pinterest and TikTok organic, where kawaii merchandise performs unusually well and costs nothing but time.',
      why: 'Same traffic, four times the yield, if the take rate changes.' },
  ];

  const METHOD_NOTES = [
    "Traffic follows an S-curve, not a straight line: slow for four months while a new domain earns trust, steepest between months 8 and 18, decelerating after. It is fitted to pass through the month-1, month-12 and month-24 anchors in the assumptions panel. Monthly seasonality is applied per category: April for hemp, January for nicotine, Q4 for tea and gifting, Black Friday through December for kawaii merchandise — which is why a month's sessions can sit slightly above or below its anchor.",
    "Conversion rate is the most fragile assumption on this page. The model matures it from 80% to 125% of the stated rate over two years as trust, reviews and returning visitors accumulate. If real conversion comes in at half the stated rate, halve every revenue figure. Hemp checkouts in particular carry friction the benchmarks don't: age gates, login walls and payment processors that decline more often than mainstream retail.",
    "Attribution capture starts low and deliberately so. It reflects the merchants that genuinely cannot credit you today, not pessimism. It ramps toward 88–90%, which assumes you actually do the applications in the ninety-day list. If you don't, switch to the bear scenario, which holds capture flat at today's rate and reads the result.",
    'What is not modelled: a merchant terminating a programme, a state banning THCa outright, a Google core update, an Instagram ban on your account, or the wholesale side of Legal Leaf. The first three are real risks in this category; the fourth is real upside that isn’t counted here.',
    'Costs are excluded because they are immaterial next to the revenue: domains, hosting, the concierge API and email land between $10 and $200 a month across the whole family. Affiliate has no cost of goods. What this business actually costs is your hours.',
  ];

  const METHOD_FOOTNOTE = 'Reference points used to sanity-check the growth curve: a THCa retailer went from 325 to 12,755 monthly sessions in 11 months with a paid agency running technical SEO, category pages, comparison content and 4–5 links a month. The base case here is deliberately slower than that, because you are one person. Industry survey data also says roughly 95% of affiliate sites never reach sustainable income and the single biggest cause is quitting inside year one, while 81% of those who stay past twelve months clear $20,000 a year. The distribution is brutal at the bottom and fine above it.';

  const INCOME_TARGETS = [500, 1000, 2500, 5000, 8333, 20000];

  const ASSUMPTION_FIELDS = [
    { key: 'sessionsMonth1', label: 'Sessions, month 1', step: 50, decimals: 0 },
    { key: 'sessionsMonth12', label: 'Sessions, month 12', step: 250, decimals: 0 },
    { key: 'sessionsMonth24', label: 'Sessions, month 24', step: 1000, decimals: 0 },
    { key: 'basket', label: 'Basket $', step: 1, decimals: 0 },
    { key: 'commissionPct', label: 'Commission %', step: 0.5, decimals: 1 },
    { key: 'conversionPct', label: 'Conversion %', step: 0.05, decimals: 2 },
    { key: 'attributionNowPct', label: 'Attribution now %', step: 5, decimals: 0 },
    { key: 'attributionExitPct', label: 'Attribution mo 24 %', step: 5, decimals: 0 },
  ];

  window.OM = {
    HORIZON_MONTHS, DISPLAY_HORIZONS, MODEL_START, MONTH_LABELS, PREPARED_ON, numWord,
    SITE_PROFILES, SITE_MAP, SCENARIOS, SCENARIO_ORDER,
    MERCHANTS, attributableShare, FACTS, NEXT_90_DAYS, METHOD_NOTES, METHOD_FOOTNOTE,
    INCOME_TARGETS, ASSUMPTION_FIELDS,
    runModel, money, count, rps, signedPercent,
  };
})();

// api/admin/_client-engine-gear.js — Gear Avail's own math + data, mirroring
// _client-engine.js's engine exactly (same curve fit, same Weibull ramps) but
// as a separate site profile with its own real vendor mix. Kept in its own
// file rather than folded into the four-site SITE_PROFILES so that page's
// hand-written narrative (advertising-restriction argument, its own "next 90
// days") never has to accommodate a structurally unrelated business.
//
// Attaches to window.OMGear, not window.OM -- the two engines never load on
// the same page, but distinct globals make that a certainty rather than a
// hope.
//
// Vendor data sourced 9 Aug 2026 from gearavail.com's live category pages
// and the GoAffPro master list the site owner supplied. Listing shares are
// rough (small visible samples, not the full ~8,259-listing catalog) --
// flagged in the merchant table caption, same as the four-site tool flags
// its own merchant mix as "estimates, not measurements."

(function () {
  'use strict';

  const HORIZON_MONTHS = 24;
  const MODEL_START = { year: 2026, month: 8 };

  const CONVERSION_FLOOR = 0.8;
  const CONVERSION_CEILING = 1.25;
  const CONVERSION_RAMP = { scale: 11.1445, shape: 1.1606 };
  const ATTRIBUTION_RAMP = { scale: 9.5411, shape: 1.2217 };

  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  function makeRamp(ramp) {
    const f = (t) => 1 - Math.exp(-Math.pow(t / ramp.scale, ramp.shape));
    const full = f(HORIZON_MONTHS);
    return (t) => f(t) / full;
  }
  const conversionProgress = makeRamp(CONVERSION_RAMP);
  const attributionProgress = makeRamp(ATTRIBUTION_RAMP);

  function fitTrafficCurve(month1, month12, month24, steepness) {
    const s1 = Math.max(month1, 1), s12 = Math.max(month12, 1), s24 = Math.max(month24, 1);
    const a1 = Math.log(s1), a12 = Math.log(s12), a24 = Math.log(s24), span = a24 - a1;

    const geometricFallback = () => (t) => {
      if (t <= 1) return s1;
      if (t <= 12) return Math.exp(a1 + ((a12 - a1) * (t - 1)) / 11);
      if (t <= 24) return Math.exp(a12 + ((a24 - a12) * (t - 12)) / 12);
      return Math.exp(a24 + ((a24 - a12) * (t - 24)) / 12);
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

    let lo = null, hi = 0, prevT = null, prevV = null;
    for (let t = -400; t <= 400; t += 0.5) {
      const v = residual(t);
      if (!Number.isFinite(v)) { prevT = null; prevV = null; continue; }
      if (prevV !== null && prevT !== null && prevV * v <= 0) { lo = prevT; hi = t; break; }
      prevT = t; prevV = v;
    }
    if (lo === null) return geometricFallback();

    let low = lo, high = hi;
    for (let i = 0; i < 200; i += 1) {
      const mid = (low + high) / 2;
      const vm = residual(mid);
      if (!Number.isFinite(vm)) return geometricFallback();
      const vl = residual(low);
      if (!Number.isFinite(vl)) return geometricFallback();
      if (vl * vm <= 0) high = mid; else low = mid;
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
  const calendarMonth = (t) => (MODEL_START.month + (t - 1)) % 12;
  function monthLabel(t) {
    const absolute = MODEL_START.month + (t - 1);
    const year = MODEL_START.year + Math.floor(absolute / 12);
    return `${MONTH_NAMES[absolute % 12]} ${String(year % 100).padStart(2, '0')}`;
  }
  const MONTH_LABELS = Array.from({ length: HORIZON_MONTHS }, (_, i) => monthLabel(i + 1));

  function applyScenario(base, scenario) {
    return Object.assign({}, base, {
      sessionsMonth12: base.sessionsMonth12 * scenario.sessions12,
      sessionsMonth24: base.sessionsMonth24 * scenario.sessions24,
      conversionPct: base.conversionPct * scenario.conversion,
      attributionExitPct: scenario.freezeAttribution ? base.attributionNowPct : base.attributionExitPct,
    });
  }

  function maturityRevPerSession(a) {
    return a.basket * (a.commissionPct / 100) * ((a.conversionPct / 100) * CONVERSION_CEILING) * (a.attributionExitPct / 100);
  }
  function attributionAt(a, t) {
    const now = a.attributionNowPct / 100, exit = a.attributionExitPct / 100;
    return now + (exit - now) * attributionProgress(t);
  }
  function conversionAt(a, t) {
    const maturity = CONVERSION_FLOOR + (CONVERSION_CEILING - CONVERSION_FLOOR) * conversionProgress(t);
    return (a.conversionPct / 100) * maturity;
  }

  function projectSite(profile, effective) {
    const curve = fitTrafficCurve(effective.sessionsMonth1, effective.sessionsMonth12, effective.sessionsMonth24, profile.curveSteepness);
    const commission = effective.commissionPct / 100;
    const rows = [];
    for (let i = 0; i < HORIZON_MONTHS; i += 1) {
      const t = i + 1;
      const seasonal = profile.seasonality[calendarMonth(t)] ?? 1;
      const sessions = Math.max(0, Math.round(curve(t) * seasonal));
      const conversion = conversionAt(effective, t);
      const attribution = attributionAt(effective, t);
      const revenue = sessions * conversion * effective.basket * commission * attribution;
      rows.push({ sessions, revenue, revPerSession: sessions > 0 ? revenue / sessions : 0, attribution });
    }
    return rows;
  }

  function applyActuals(raw, actuals) {
    const closed = [];
    if (actuals) {
      for (let t = 1; t <= HORIZON_MONTHS; t += 1) {
        const entry = actuals[t];
        const s = entry && entry.sessions, r = entry && entry.revenue;
        if (typeof s === 'number' && s > 0 && typeof r === 'number' && r >= 0) closed.push(t);
      }
    }
    if (closed.length === 0) return { rows: raw, closedMonths: [], trafficIndex: 1, yieldIndex: 1 };

    let actualSessions = 0, modelSessions = 0, actualRevenue = 0, modelRevenue = 0;
    for (const t of closed) {
      const entry = actuals[t];
      actualSessions += entry.sessions; actualRevenue += entry.revenue;
      modelSessions += raw[t - 1].sessions; modelRevenue += raw[t - 1].revenue;
    }
    const trafficIndex = modelSessions > 0 ? actualSessions / modelSessions : 1;
    const actualRps = actualSessions > 0 ? actualRevenue / actualSessions : 0;
    const modelRps = modelSessions > 0 ? modelRevenue / modelSessions : 0;
    const yieldIndex = modelRps > 0 && actualRps > 0 ? actualRps / modelRps : 1;

    const lastClosed = closed[closed.length - 1];
    const rows = raw.map((row, i) => {
      const t = i + 1, entry = actuals[t], isClosed = closed.includes(t);
      if (isClosed) {
        const sessions = entry.sessions, revenue = entry.revenue;
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
    for (let q = 0; q < HORIZON_MONTHS / 3; q += 1) {
      const slice = months.slice(q * 3, q * 3 + 3);
      const sessions = slice.reduce((s, m) => s + m.sessions, 0);
      const orders = slice.reduce((s, m) => s + m.orders, 0);
      const gmv = slice.reduce((s, m) => s + m.gmv, 0);
      const revenue = slice.reduce((s, m) => s + m.revenue, 0);
      const prior = quarters[q - 1];
      quarters.push({
        index: q + 1, label: `Q${q + 1}`, monthsLabel: `${slice[0].label} – ${slice[slice.length - 1].label}`,
        sessions, orders, gmv, revenue, revPerSession: sessions > 0 ? revenue / sessions : 0,
        changeVsPriorPct: prior && prior.revenue > 0 ? ((revenue - prior.revenue) / prior.revenue) * 100 : null,
      });
    }
    return quarters;
  }

  function runModel(profiles, overrides, scenario, actuals) {
    const sites = {}, order = [];
    for (const profile of profiles) {
      order.push(profile.key);
      const base = Object.assign({}, profile.assumptions, (overrides && overrides[profile.key]) || {});
      const effective = applyScenario(base, scenario);
      const raw = projectSite(profile, effective);
      const { rows, closedMonths } = applyActuals(raw, actuals && actuals[profile.key]);
      const commission = effective.commissionPct / 100;

      const months = rows.map((row, i) => {
        const t = i + 1;
        const entry = actuals && actuals[profile.key] && actuals[profile.key][t];
        const hasSessions = typeof (entry && entry.sessions) === 'number' && entry.sessions > 0;
        const hasRevenue = typeof (entry && entry.revenue) === 'number' && entry.revenue >= 0;
        const isActual = hasSessions && hasRevenue;
        const denominator = commission * row.attribution;
        const gmv = denominator > 0 ? row.revenue / denominator : 0;
        const orders = effective.basket > 0 ? gmv / effective.basket : 0;
        const planned = raw[i];
        return {
          index: t, label: MONTH_LABELS[i], sessions: row.sessions, revPerSession: row.revPerSession,
          orders, gmv, revenue: row.revenue,
          actualSessions: hasSessions ? entry.sessions : null, actualRevenue: hasRevenue ? entry.revenue : null,
          plannedRevenue: planned.revenue, plannedSessions: planned.sessions,
          revenueVariancePct: isActual && planned.revenue > 0 ? ((entry.revenue - planned.revenue) / planned.revenue) * 100 : null,
          sessionsVariancePct: isActual && planned.sessions > 0 ? ((entry.sessions - planned.sessions) / planned.sessions) * 100 : null,
          isActual, isReanchored: !isActual && row.revenue !== planned.revenue,
        };
      });

      const year1Revenue = months.slice(0, 12).reduce((s, m) => s + m.revenue, 0);
      const year2Revenue = months.slice(12).reduce((s, m) => s + m.revenue, 0);
      const last = months[months.length - 1];

      sites[profile.key] = {
        key: profile.key, profile, months, quarters: buildQuarters(months),
        year1Revenue, year2Revenue, totalRevenue: year1Revenue + year2Revenue,
        totalSessions: months.reduce((s, m) => s + m.sessions, 0),
        totalOrders: months.reduce((s, m) => s + m.orders, 0),
        totalGmv: months.reduce((s, m) => s + m.gmv, 0),
        month24Revenue: last.revenue, month24Sessions: last.sessions, exitRunRate: last.revenue * 12,
        maturityRevPerSession: maturityRevPerSession(effective), effective, closedMonths,
      };
    }

    const list = order.map((k) => sites[k]);
    const month24Revenue = list.reduce((s, p) => s + p.month24Revenue, 0);
    const month24Sessions = list.reduce((s, p) => s + p.month24Sessions, 0);

    return {
      sites, order,
      totals: {
        year1Revenue: list.reduce((s, p) => s + p.year1Revenue, 0),
        year2Revenue: list.reduce((s, p) => s + p.year2Revenue, 0),
        totalRevenue: list.reduce((s, p) => s + p.totalRevenue, 0),
        month24Revenue, month24Sessions, exitRunRate: month24Revenue * 12,
        blendedRevPerSession: month24Sessions > 0 ? month24Revenue / month24Sessions : 0,
        totalSessions: list.reduce((s, p) => s + p.totalSessions, 0),
        indexablePages: list.reduce((s, p) => s + p.profile.indexablePages, 0),
      },
      monthLabels: MONTH_LABELS,
    };
  }

  const money = (n, digits = 0) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  const count = (n, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rps = (n) => `$${n.toFixed(3)}`;
  const signedPercent = (n, digits = 0) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;

  // ── Gear Avail's data ────────────────────────────────────────────────
  // Session anchors and derived basket/commission below are built up over a
  // long working conversation on 9 Aug 2026 -- see the per-vendor table for
  // where basket/commission actually come from (GMV-weighted, not averaged).

  const PREPARED_ON = '9 August 2026';

  const SITE_PROFILES = [
    {
      key: 'gear', name: 'Gear Avail', shortName: 'Gear Avail', domain: 'gearavail.com',
      tagline: 'Used & new music gear aggregator · Reverb, eBay & independent shops · 8,259 listings, 900+ indexed pages',
      color: '#a06bdb',
      // Modest Q4/holiday lift and a secondary Feb-Apr (tax-return/GAS) bump; flatter than the four-site family's category-specific curves since gear demand is broader.
      seasonality: [1.05, 1.10, 1.10, 1.05, 0.95, 0.85, 0.85, 0.95, 1.05, 1.05, 1.15, 1.30],
      curveSteepness: 0.27,
      indexablePages: 914, // 900+ product pages + 14 category pages, live in the sitemap today -- already more than any one of the four-site family has
      assumptions: {
        // ~300 organic cold-start + ~750 proven IG (25 visits/day avg, first 3 weeks) + ~100 FB organic + ~150 from $100/mo ads
        sessionsMonth1: 1300,
        sessionsMonth12: 19000,
        sessionsMonth24: 60000,
        // Derived bottom-up from the per-vendor table below (GMV-weighted), not assumed:
        basket: 190,
        commissionPct: 3.0,
        conversionPct: 0.9,
        attributionNowPct: 70,
        attributionExitPct: 90,
      },
    },
  ];
  const SITE_MAP = Object.fromEntries(SITE_PROFILES.map((s) => [s.key, s]));

  // Same scenario shape as the four-site tool -- the multipliers describe how
  // hard the growth levers get pulled, which generalizes fine across businesses.
  const SCENARIOS = {
    bear: { key: 'bear', label: 'Bear', headline: 'Ads and IG stay flat, SEO alone carries it',
      detail: '$100/mo ad spend never increases, the IG/FB channels plateau rather than compound, and the vendor roster stops growing after the ten already in motion. Traffic lands around 40% of the base case by month 24.',
      sessions12: 0.55, sessions24: 0.4, conversion: 0.85, freezeAttribution: true },
    base: { key: 'base', label: 'Base', headline: 'Steady vendor growth, proven channels keep working',
      detail: 'IG and FB keep performing the way they have in the first three weeks, the ad budget holds at $100/mo, and roughly ten new vendors land as planned. SEO compounds across the 900+ pages already live.',
      sessions12: 1, sessions24: 1, conversion: 1, freezeAttribution: false },
    bull: { key: 'bull', label: 'Bull', headline: 'A vendor or the IG audience actually breaks out',
      detail: 'One of the boutique-maker relationships turns into a real partnership, or the pedal community on IG shares this the way niche gear communities sometimes do. Traffic runs well ahead of plan; conversion improves as trust builds.',
      sessions12: 1.6, sessions24: 2.2, conversion: 1.15, freezeAttribution: false },
  };
  const SCENARIO_ORDER = ['bear', 'base', 'bull'];

  // ── per-vendor breakdown ─────────────────────────────────────────────
  // listingShare is a rough proxy from visible category-page samples, NOT
  // the full ~8,259-listing catalog -- flagged in the table caption, same
  // as the four-site tool flags its own merchant shares as estimates.
  const MERCHANTS = {
    gear: [
      { merchant: 'eBay', platform: 'eBay Partner Network', ratePct: 3, status: 'tracking', sharePct: 41, note: 'General marketplace; dominant on higher-ticket categories (synths sampled $1.2-2k)' },
      { merchant: 'Reverb', platform: 'Reverb affiliate program', ratePct: 1, status: 'tracking', sharePct: 34, note: 'Confirmed: 1% on physical gear, not the 5% first assumed. Thin. See the "go direct" plan below.' },
      { merchant: 'Haze Guitar', platform: 'GoAffPro (hazeguitar.com.au)', ratePct: 5, status: 'tracking', sharePct: 8, note: 'Dominates listing COUNT (cheap strings/cables/small amps, mostly $3-127) but not GMV' },
      { merchant: 'Eason Music Store', platform: 'GoAffPro (easonmusicstore.com)', ratePct: 10, status: 'tracking', sharePct: 2, note: 'SGD store, basket unconfirmed' },
      { merchant: 'EART Guitar', platform: 'GoAffPro (eartguitar.com)', ratePct: 5, status: 'tracking', sharePct: 3, note: 'Basket assumed mid-tier, unconfirmed' },
      { merchant: 'Folkcraft Instruments', platform: 'GoAffPro (folkcraft.com)', ratePct: 5, status: 'tracking', sharePct: 1, note: 'Folk instruments + gift cards seen' },
      { merchant: 'Pures Music', platform: 'GoAffPro (puresmusic.com)', ratePct: 4, status: 'tracking', sharePct: 1, note: 'Handpan/kalimba "scale" accessories, cheap' },
      { merchant: 'Jackson Audio', platform: 'Direct / no affiliate program found', ratePct: 0, status: 'none', sharePct: 2, note: 'Boutique pedal maker; earns $0 today. Worth a direct outreach -- see below.' },
      { merchant: '~10 new vendors (in progress)', platform: 'GoAffPro, typical small-shop profile', ratePct: 8, status: 'partial', sharePct: 8, note: 'Assumed onboarding within 4 weeks of 9 Aug 2026; matches the boutique tier already live, not the eBay/Reverb tier' },
    ],
  };

  function attributableShare(key) {
    return MERCHANTS[key].filter((m) => m.status !== 'none').reduce((sum, m) => sum + m.sharePct, 0);
  }

  const FACTS = [
    { tag: 'Structural · works in your favor', title: 'You can actually advertise here',
      body: 'Unlike the legal-leaf family, musical instruments carry no ad-platform restriction. Google, Meta and TikTok all allow it. That means paid spend is a real lever here in a way it structurally cannot be for three of your other four sites -- the $100/mo currently running is a start, not a ceiling.' },
    { tag: 'Structural · works against you', title: 'The volume merchants pay very little',
      body: "Reverb pays 1% on physical gear -- confirmed, not assumed. eBay is thin too. The merchants who actually pay a real rate (5-10%) are small independent shops via GoAffPro, and they carry a fraction of the GMV eBay and Reverb do. This is the opposite of the legal-leaf pattern, where the highest-volume merchants also paid the best rates." },
    { tag: 'Fixable · the actual lever', title: 'Boutique makers mostly have no affiliate program at all',
      body: "JHS, Walrus Audio (confirmed no program), EarthQuaker, Bardic Audio Devices, Stomp Under Foot -- none of them run affiliate software. They sell through Reverb or a handful of boutique retailers. That's not a dead end, it's an opening: a direct discount-code relationship, tracked by hand the same way half the legal-leaf merchants already are, bypasses Reverb's 1% entirely. Your IG following in exactly this community is the credibility to make that pitch." },
    { tag: 'Reframe · Reverb is not the revenue plan', title: "Reverb is already the Kelley Blue Book of gear -- use it as that",
      body: "At 1%, Reverb isn't worth building the business around as a revenue source. But as a pricing authority -- genuine peer-to-peer market data, not retailer list prices -- it's the closest thing this category has to KBB for cars. Pulling its listings in as a price-comparison and valuation layer is worth doing regardless of what the affiliate link ever pays. The monetization case is the direct maker relationships; Reverb is the trusted data underneath, and eBay developer API access (real, buildable, unlike FB Marketplace) is worth pursuing on the same logic once this layer proves out." },
    { tag: 'Positioning · the actual differentiator', title: 'Blend what Reverb and FB Marketplace each got right before they drifted',
      body: "Reverb's founding edge was structured, searchable, musician-built tooling for a category eBay treated generically. FB Marketplace's edge is zero-friction, local trust, free-to-start. Both eventually monetized harder as they scaled -- Reverb after the Etsy acquisition, FB Marketplace more recently (a real seller fee now on shipped/Checkout sales, still free for local cash deals). Neither kept both strengths at once. Gear Avail's edge isn't out-cataloguing Reverb; it's the structured tooling plus the low-friction, direct-relationship trust neither competitor sustained -- monetize later and lightly, through direct maker relationships, not an aggressive take-rate from day one. And it is not a tech competition: both platforms' underlying tech is genuinely good and improving fast, backed by companies with real engineering budgets. The gap to close is relational, not technical." },
  ];

  const NEXT_90_DAYS = [
    { title: 'Go direct with boutique makers instead of routing through Reverb',
      body: "Reverb's 1% take makes it barely worth the click for a $300 boutique pedal. Reach out directly to makers you or your IG audience already have a relationship with -- Bardic Audio Devices and Stomp Under Foot are the two you've already named. Propose a simple tracked discount code, not a formal affiliate signup; that's how the legal-leaf family already handles merchants without real tracking infrastructure.",
      why: 'A 10-15% direct arrangement on a $300 pedal is worth roughly what 15-45 Reverb sales of the same item would earn at 1%.' },
    { title: 'Resurrect stompbox.world as a pedals-first page here, not a separate property',
      body: "You already validated this audience once -- proud pre-AI work, real followers, genuinely matched to this catalog's pedal category. Scope the relaunch to pedals specifically rather than the whole catalog, and let it expand into other categories once that's working. Rebuilding it as a page on gearavail.com rather than a standalone site means the traffic and SEO equity land on the property that already has 900+ pages indexed, instead of starting a second domain from zero.",
      why: "You get the community-building work you already know how to do, feeding the site that actually monetizes it, scoped small enough to actually ship." },
    { title: 'Close out the ten vendors already in motion, then keep going',
      body: 'The GoAffPro-typical small shop is where the real commission rates live (median 10% across music-relevant listings). Each one is a real conversation, per the site\'s own "list your shop" approach -- but that also means it scales with outreach effort, not luck.',
      why: 'This is the fastest lever that does not depend on traffic growing at all -- it raises the blended commission on sessions you already have.' },
    { title: 'Watch whether eBay and Reverb GMV share holds or grows',
      body: 'The listing-share estimates behind this model are rough samples, not the full 8,259-listing catalog. As real order data comes in, re-check whether eBay/Reverb are actually 41%+34% of GMV or whether the long tail of small shops carries more than assumed.',
      why: 'The blended commission (3.0%) is the single most consequential number in this model, and it is currently an estimate.' },
  ];

  const METHOD_NOTES = [
    'This model reuses the exact same engine as the four-site operating model (S-curve traffic fit, Weibull conversion/attribution ramps) -- same math, different business. See /admin/operating-model for the method writeup in full; nothing about the curve-fitting or ramp logic differs here.',
    'Basket ($190) and commission (3.0%) are derived bottom-up from the per-vendor table below, weighted by estimated GMV contribution (listing share x basket), not assumed or averaged from posted rates. The GoAffPro list\'s median rate for music-relevant stores is 10% -- using that number directly would have overstated the blend by more than 3x, because it ignores that eBay and Reverb dominate actual transaction volume at far lower rates.',
    'Session anchors are the least certain input. Month 1 (1,300) is grounded in a real, proven number -- roughly 25 visits/day from Instagram in the first three weeks -- plus a conservative organic and paid-ads estimate. Months 12 and 24 are not measured; they assume the content depth already live (900+ pages) converts into search traffic at a pace comparable to, or somewhat faster than, the four-site family\'s own launches, since none of those started with anywhere near this much indexed content on day one.',
    'What is not modelled: whether Reverb or eBay ever raise or lower their take rate, whether any of the ten pipeline vendors actually close, and whether a direct boutique-maker relationship (bypassing Reverb\'s 1%) materializes. All three could move this projection meaningfully in either direction.',
  ];
  const METHOD_FOOTNOTE = 'Built from a live working session on 9 August 2026: gearavail.com\'s own category pages and sitemap, a GoAffPro master list of ~22,400 stores supplied by the site owner, and web research on boutique pedal-maker and retailer affiliate programs. Treat every number here as a planning estimate, not a forecast -- re-anchor it with real actuals the moment they exist, the same way the four-site tool does.';

  const INCOME_TARGETS = [500, 1000, 2500, 5000, 8333, 20000];

  const ASSUMPTION_FIELDS = [
    { key: 'sessionsMonth1', label: 'Sessions, month 1', step: 50, decimals: 0 },
    { key: 'sessionsMonth12', label: 'Sessions, month 12', step: 500, decimals: 0 },
    { key: 'sessionsMonth24', label: 'Sessions, month 24', step: 1000, decimals: 0 },
    { key: 'basket', label: 'Basket $', step: 5, decimals: 0 },
    { key: 'commissionPct', label: 'Commission %', step: 0.1, decimals: 2 },
    { key: 'conversionPct', label: 'Conversion %', step: 0.05, decimals: 2 },
    { key: 'attributionNowPct', label: 'Attribution now %', step: 5, decimals: 0 },
    { key: 'attributionExitPct', label: 'Attribution mo 24 %', step: 5, decimals: 0 },
  ];

  window.OMGear = {
    HORIZON_MONTHS, MODEL_START, MONTH_LABELS, PREPARED_ON,
    SITE_PROFILES, SITE_MAP, SCENARIOS, SCENARIO_ORDER,
    MERCHANTS, attributableShare, FACTS, NEXT_90_DAYS, METHOD_NOTES, METHOD_FOOTNOTE,
    INCOME_TARGETS, ASSUMPTION_FIELDS,
    runModel, money, count, rps, signedPercent,
  };
})();

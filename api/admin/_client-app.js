// api/admin/_client-app.js — the admin operating-model dashboard UI.
//
// Plain browser JS, no framework, no build step (CLAUDE.md §2). Renders into
// #app, which api/admin/model.js's HTML shell provides. State lives in memory
// plus localStorage; every edit triggers a full re-render of #app except chart
// hover, which updates its own crosshair/tooltip nodes directly for performance.

(function () {
  'use strict';

  const OM = window.OM;
  const STORAGE_KEY = 'llm.operating-model.v1';

  const state = { scenario: 'base', horizon: '120', overrides: {}, actuals: {} };

  /** Months for the selected horizon. Falls back to the anchor horizon. */
  function horizonMonths() {
    const found = OM.DISPLAY_HORIZONS.find((h) => h.key === state.horizon);
    return found ? found.months : OM.HORIZON_MONTHS;
  }
  let hydrated = false;
  let savedAt = null;
  let notice = null;
  let noticeTimer = null;
  let chartRedraw = null;

  // ── state helpers ─────────────────────────────────────────────────────

  function getValue(site, field) {
    const o = state.overrides[site];
    if (o && Object.prototype.hasOwnProperty.call(o, field)) return o[field];
    return OM.SITE_MAP[site].assumptions[field];
  }

  function setValue(site, field, next) {
    const forSite = Object.assign({}, state.overrides[site] || {});
    if (next === null || next === undefined || Number.isNaN(next)) delete forSite[field];
    else forSite[field] = next;
    const copy = Object.assign({}, state.overrides, { [site]: forSite });
    if (Object.keys(forSite).length === 0) delete copy[site];
    state.overrides = copy;
  }

  function getActual(site, month, field) {
    const s = state.actuals[site];
    const m = s && s[month];
    return m && typeof m[field] === 'number' ? m[field] : null;
  }

  function setActual(site, month, field, next) {
    const forSite = Object.assign({}, state.actuals[site] || {});
    const entry = Object.assign({}, forSite[month] || {});
    if (next === null || next === undefined || Number.isNaN(next)) delete entry[field];
    else entry[field] = next;
    if (Object.keys(entry).length === 0) delete forSite[month];
    else forSite[month] = entry;
    const copy = Object.assign({}, state.actuals, { [site]: forSite });
    if (Object.keys(forSite).length === 0) delete copy[site];
    state.actuals = copy;
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) {
          if (parsed.scenario && OM.SCENARIOS[parsed.scenario]) state.scenario = parsed.scenario;
          if (parsed.horizon && OM.DISPLAY_HORIZONS.some((h) => h.key === parsed.horizon)) state.horizon = parsed.horizon;
          if (parsed.overrides) state.overrides = parsed.overrides;
          if (parsed.actuals) state.actuals = parsed.actuals;
          if (typeof parsed.savedAt === 'number') savedAt = parsed.savedAt;
        }
      }
    } catch (e) {
      // A corrupt or unreadable entry must never block the page.
    }
    hydrated = true;
  }

  function persist() {
    if (!hydrated) return;
    const stamp = Date.now();
    const payload = { version: 1, scenario: state.scenario, horizon: state.horizon, overrides: state.overrides, actuals: state.actuals, savedAt: stamp };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      savedAt = stamp;
    } catch (e) {
      queueNotice('Could not save to this browser — storage is full or blocked.');
    }
  }

  function queueNotice(text) {
    notice = text;
    if (noticeTimer) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice = null;
      renderApp();
    }, 4000);
  }

  function relativeTime(then) {
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function computeModels() {
    const months = horizonMonths();
    return {
      bear: OM.runModel(OM.SITE_PROFILES, state.overrides, OM.SCENARIOS.bear, state.actuals, months),
      base: OM.runModel(OM.SITE_PROFILES, state.overrides, OM.SCENARIOS.base, state.actuals, months),
      bull: OM.runModel(OM.SITE_PROFILES, state.overrides, OM.SCENARIOS.bull, state.actuals, months),
    };
  }

  // ── data actions ──────────────────────────────────────────────────────

  function exportData() {
    const payload = { version: 1, scenario: state.scenario, horizon: state.horizon, overrides: state.overrides, actuals: state.actuals, savedAt: Date.now() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `operating-model-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text);
        if (!parsed || parsed.version !== 1) throw new Error('unrecognised file');
        if (parsed.scenario && OM.SCENARIOS[parsed.scenario]) state.scenario = parsed.scenario;
        // An export from before the horizon selector existed has no horizon
        // key; those files were all 24-month runs, so say so rather than
        // silently reinterpreting them at whatever is on screen now.
        state.horizon = OM.DISPLAY_HORIZONS.some((h) => h.key === parsed.horizon) ? parsed.horizon : '24';
        state.overrides = parsed.overrides || {};
        state.actuals = parsed.actuals || {};
        persist();
        queueNotice('Imported.');
        renderApp();
      })
      .catch(() => {
        queueNotice("That file isn't an export of this model.");
        renderApp();
      });
  }

  function resetAll() {
    state.overrides = {};
    state.actuals = {};
    state.scenario = 'base';
    state.horizon = '120';
    persist();
    queueNotice('Reset to the shipped assumptions.');
    renderApp();
  }

  // ── small render helpers ──────────────────────────────────────────────

  function numInput(opts) {
    const attrs = [`data-role="${opts.role}"`, `data-site="${opts.site}"`];
    if (opts.month !== undefined) attrs.push(`data-month="${opts.month}"`);
    attrs.push(`data-field="${opts.field}"`);
    const val = opts.value === null || opts.value === undefined || Number.isNaN(opts.value) ? '' : String(opts.value);
    return `<span class="num${opts.tone === 'actual' ? ' num-actual' : ''}">${opts.prefix ? `<span class="num-affix">${opts.prefix}</span>` : ''}<input type="number" inputmode="decimal" step="${opts.step || 1}" min="${opts.min === undefined ? 0 : opts.min}"${opts.max !== undefined ? ` max="${opts.max}"` : ''}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''} aria-label="${esc(opts.label)}" value="${val}" ${attrs.join(' ')}>${opts.suffix ? `<span class="num-affix">${opts.suffix}</span>` : ''}</span>`;
  }

  function swatch(color) {
    return `<span class="swatch" style="background:${color}" aria-hidden="true"></span>`;
  }

  // ── section builders (return HTML strings) ──────────────────────────

  function renderHeaderChips(model, models, closedTotal, hydratedFlag) {
    const savedLabel = !hydratedFlag ? '' : savedAt ? `Saved to this browser · ${relativeTime(savedAt)}` : 'Nothing saved yet';
    return `
      <div class="chips">
        <span class="chip chip-gold">${esc(model.monthLabels[0])} → ${esc(model.monthLabels[model.monthLabels.length - 1])}</span>
        <span class="chip">${model.displayMonths} months · ${Math.ceil(model.displayMonths / 3)} quarters</span>
        <span class="chip">${closedTotal > 0 ? `Re-anchored on ${closedTotal} closed month${closedTotal === 1 ? '' : 's'}` : 'Model recalculates from your actuals'}</span>
        ${hydratedFlag ? `<span class="chip">${esc(savedLabel)}</span>` : ''}
      </div>`;
  }

  const SECTIONS = [
    { id: 'verdict', label: 'Verdict' },
    { id: 'facts', label: 'The three facts' },
    { id: 'engine', label: 'Unit economics' },
    { id: 'controls', label: 'Assumptions' },
    { id: 'trajectory', label: 'Trajectory' },
    { id: 'summary', label: 'Summary' },
    { id: 'quarterly', label: 'Quarterly' },
    { id: 'monthly', label: 'Monthly & actuals' },
    { id: 'stores', label: 'By store' },
    { id: 'reverse', label: 'Reverse' },
    { id: 'next', label: 'Next 90 days' },
    { id: 'method', label: 'Method' },
  ];

  function renderVerdict(models, model, t) {
    const legal = model.sites.legal;
    const legalRevShare = t.totalRevenue > 0 ? (legal.totalRevenue / t.totalRevenue) * 100 : 0;
    const legalSessionShare = t.totalSessions > 0 ? (legal.totalSessions / t.totalSessions) * 100 : 0;
    const weakest = Math.max(model.sites.nicotia.maturityRevPerSession, model.sites.kawaii.maturityRevPerSession);
    const legalMultiple = weakest > 0 ? legal.maturityRevPerSession / weakest : 0;
    const yearMultiple = t.year1Revenue > 0 ? t.year2Revenue / t.year1Revenue : 0;

    return `
      <section id="verdict" class="admin-section">
        <p class="eyebrow">Verdict</p>
        <h2>Yes, but only one of the ${OM.numWord(model.order.length)} is a real business, and none of it is a traffic-free bet</h2>
        <div class="section-body">
          <div style="max-width:48rem;font-size:0.9rem;color:var(--muted);line-height:1.7">
            <p>Your tech is genuinely good and it is not the constraint. The constraint is that four of your ${OM.numWord(model.order.length)} sites are permanently locked out of paid advertising, so on those every visitor has to be earned rather than bought. Gear Avail is the exception and the reason it was added here: musical instruments carry no advertising restriction, so it is the only site in the family where traffic can be bought at all. Right now you have <strong>${t.indexablePages} indexable pages</strong> hand-built across the ${OM.numWord(model.order.length)} domains, and a large share of your outbound clicks earn $0 because the affiliate relationships behind them aren't wired up.</p>
            <p>Fix those two things and the base case is realistic: roughly <strong>${OM.money(models.base.totals.year1Revenue)}</strong> in year one, <strong>${OM.money(models.base.totals.year2Revenue)}</strong> in year two, exiting ${esc(model.monthLabels[model.monthLabels.length - 1])} at about <strong>${OM.money(models.base.totals.finalMonthRevenue)}/month</strong>. Don't fix them and you're in the bear column, about <strong>${OM.money(models.bear.totals.totalRevenue)}</strong> across the ${model.displayMonths === 24 ? 'two years' : `${model.displayMonths / 12} years`} shown, which is a hobby. The upside case is a genuine <strong>${OM.money(models.bull.totals.exitRunRate)}</strong> run-rate, and it isn't fantasy, but it requires one channel to break out rather than five channels to grind.</p>
          </div>
          <div class="stat-grid">
            <div class="stat"><p class="label">Year 1 revenue</p><p class="value">${OM.money(t.year1Revenue)}</p><p class="sub">${esc(OM.SCENARIOS[state.scenario].label)} case</p></div>
            <div class="stat"><p class="label">Year 2 revenue</p><p class="value">${OM.money(t.year2Revenue)}</p><p class="sub">${yearMultiple.toFixed(1)}× year 1</p></div>
            <div class="stat"><p class="label">Exit run-rate</p><p class="value">${OM.money(t.exitRunRate)}/yr</p><p class="sub">${OM.money(t.finalMonthRevenue)} in ${esc(model.monthLabels[model.monthLabels.length - 1])}</p></div>
            <div class="stat"><p class="label">Blended rev / session</p><p class="value">$${t.blendedRevPerSession.toFixed(3)}</p><p class="sub">${OM.money(t.blendedRevPerSession * 1000)} per 1,000</p></div>
            <div class="stat"><p class="label">Sessions needed, ${esc(model.monthLabels[model.monthLabels.length - 1])}</p><p class="value">${OM.count(t.finalMonthSessions)}</p><p class="sub">≈ ${OM.count(Math.round(t.finalMonthSessions / 30))} a day</p></div>
            <div class="stat"><p class="label">Indexable pages today</p><p class="value">${t.indexablePages}</p><p class="sub">hand-built, across ${OM.numWord(model.order.length)} domains</p></div>
          </div>
          <p style="max-width:48rem;margin-top:18px;font-size:0.72rem;color:var(--muted);line-height:1.6">Every number on this page is computed live from the assumptions below. Change them and everything moves with you: monthly, quarterly, per-site and total. Enter your real Vercel Analytics sessions and your real affiliate statements in the monthly tables and the forward projection re-anchors to what is actually happening.</p>
          <p style="max-width:48rem;margin-top:10px;font-size:0.85rem;color:var(--muted);line-height:1.6"><strong>The strategic read.</strong> Legal Leaf earns roughly <strong>${legalMultiple.toFixed(1)}×</strong> what Nicotia or KawaiiKatz earn from the same visitor. In this scenario it produces <strong>${legalRevShare.toFixed(0)}%</strong> of all revenue on <strong>${legalSessionShare.toFixed(0)}%</strong> of all sessions.</p>
        </div>
      </section>`;
  }

  function renderFacts() {
    return `
      <section id="facts" class="admin-section">
        <p class="eyebrow">The three facts</p>
        <h2>What actually decides the outcome</h2>
        <div class="section-body card-grid cols-3">
          ${OM.FACTS.map(
            (f) => `<div class="card"><p class="eyebrow" style="margin-bottom:6px">${esc(f.tag)}</p><h3 style="margin:0 0 8px;font-size:1.05rem;font-weight:900;color:var(--leaf)">${esc(f.title)}</h3><p>${esc(f.body)}</p></div>`,
          ).join('')}
        </div>
      </section>`;
  }

  function renderUnitEconomics(model) {
    const rows = model.order
      .map((key) => {
        const site = model.sites[key];
        return `<tr>
          <td><span class="site-label">${swatch(site.profile.color)}${esc(site.profile.shortName)}</span></td>
          <td class="right">${numInput({ role: 'assumption', site: key, field: 'basket', value: getValue(key, 'basket'), prefix: '$', step: 1, label: `${site.profile.shortName} basket` })}</td>
          <td class="right">${numInput({ role: 'assumption', site: key, field: 'commissionPct', value: getValue(key, 'commissionPct'), suffix: '%', step: 0.5, label: `${site.profile.shortName} commission percent` })}</td>
          <td class="right">${numInput({ role: 'assumption', site: key, field: 'conversionPct', value: getValue(key, 'conversionPct'), suffix: '%', step: 0.05, label: `${site.profile.shortName} conversion percent` })}</td>
          <td class="right">${numInput({ role: 'assumption', site: key, field: 'attributionExitPct', value: getValue(key, 'attributionExitPct'), suffix: '%', step: 1, max: 100, label: `${site.profile.shortName} attribution at month 24` })}</td>
          <td class="right num" style="font-weight:900;color:var(--leaf)">${OM.rps(site.maturityRevPerSession)}</td>
          <td class="right num">${OM.money(site.maturityRevPerSession * 1000)}</td>
          <td class="right num">${site.profile.indexablePages}</td>
        </tr>`;
      })
      .join('');
    return `
      <section id="engine" class="admin-section">
        <p class="eyebrow">Engine · edit any cell</p>
        <h2>Unit economics: the number that governs everything</h2>
        <p class="intro">An affiliate site's whole economy compresses into one figure: revenue per session. It is basket size × commission rate × the share of visitors who complete a purchase × the share of those purchases you actually get credited for. Everything else is traffic.</p>
        <div class="section-body">
          <div class="table-wrap"><div class="table-scroll"><table class="model-table">
            <thead><tr><th>Site</th><th class="right">Basket</th><th class="right">Commission</th><th class="right">Conversion</th><th class="right">Attribution<span class="subrow">at maturity</span></th><th class="right">Revenue per<span class="subrow">session</span></th><th class="right">Per 1,000</th><th class="right">Indexable<span class="subrow">pages today</span></th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <p class="table-caption">Sources for the rates: hemp and CBD affiliate programmes commonly run 15–40% (a blended 15–17% is prudent given several of yours are coupon-code arrangements at 10%); nicotine programmes cluster at 8–15% with 10% the mode; anime and kawaii merchandise runs 5–20% with 8–10% typical. Ecommerce affiliate conversion benchmarks sit at 1–3% of sessions, average affiliate AOV $125.</p>
          </div>
        </div>
      </section>`;
  }

  function renderControls() {
    const active = OM.SCENARIOS[state.scenario];
    const assumptionCards = OM.SITE_PROFILES.map(
      (profile) => `<div class="card assumptions-card">
        <p class="site-title">${swatch(profile.color)}${esc(profile.name)}</p>
        <p class="tagline">${esc(profile.tagline)}</p>
        <p class="domain">${esc(profile.domain)}</p>
        <div class="assumptions-fields">
          ${OM.ASSUMPTION_FIELDS.map(
            (field) =>
              `<label><span class="field-label">${esc(field.label)}</span>${numInput({ role: 'assumption', site: profile.key, field: field.key, value: getValue(profile.key, field.key), step: field.step, label: `${profile.name} — ${field.label}` })}</label>`,
          ).join('')}
        </div>
      </div>`,
    ).join('');

    const savedLabel = !hydrated ? '' : savedAt ? `Saved to this browser · ${relativeTime(savedAt)}` : 'Nothing saved yet';

    return `
      <section id="controls" class="admin-section">
        <p class="eyebrow">Controls</p>
        <h2>Scenario and assumptions</h2>
        <div class="section-body">
          <div class="scenario-group" role="radiogroup" aria-label="Scenario">
            ${OM.SCENARIO_ORDER.map((key) => `<button type="button" class="scenario-btn${key === state.scenario ? ' active' : ''}" role="radio" aria-checked="${key === state.scenario}" data-role="scenario" data-key="${key}">${esc(OM.SCENARIOS[key].label)}</button>`).join('')}
          </div>
          <p class="scenario-copy"><strong>${esc(active.headline)}.</strong> ${esc(active.detail)}</p>
          <p class="scenario-copy" style="font-size:0.72rem">The scenario multiplies the assumptions below — it does not replace them. Edit a number and all three scenarios move with it.</p>
          <div class="scenario-group" role="radiogroup" aria-label="Horizon" style="margin-top:14px">
            ${OM.DISPLAY_HORIZONS.map((h) => `<button type="button" class="scenario-btn${h.key === state.horizon ? ' active' : ''}" role="radio" aria-checked="${h.key === state.horizon}" data-role="horizon" data-key="${h.key}">${esc(h.label)}</button>`).join('')}
          </div>
          <p class="scenario-copy" style="font-size:0.72rem">The horizon changes how far the projection runs, not how it is calibrated. The session anchors, the month at which conversion and attribution finish maturing, and both ramp curves stay pinned to month 24 either way, so the ten-year view extends this model rather than restating it. Treat the back half as the shape of a trend, not a forecast: nothing about year eight has been measured.</p>
          <div class="data-actions">
            <button type="button" class="btn" data-role="export">Export</button>
            <button type="button" class="btn" data-role="import-trigger">Import</button>
            <button type="button" class="btn btn-danger" data-role="reset">Reset all</button>
            <span class="saved-label">${esc(savedLabel)}</span>
            <input type="file" accept="application/json,.json" data-role="import-file" style="display:none">
          </div>
          <div class="assumptions-grid">${assumptionCards}</div>
        </div>
      </section>`;
  }

  function renderSummary(model) {
    const t = model.totals;
    const rows = model.order
      .map((key) => {
        const s = model.sites[key];
        const share = t.totalRevenue > 0 ? (s.totalRevenue / t.totalRevenue) * 100 : 0;
        return `<tr>
          <td><span class="site-label">${swatch(s.profile.color)}${esc(s.profile.shortName)}</span></td>
          <td class="right num">${OM.money(s.year1Revenue)}</td>
          <td class="right num">${OM.money(s.year2Revenue)}</td>
          <td class="right num" style="font-weight:900;color:var(--leaf)">${OM.money(s.totalRevenue)}</td>
          <td class="right num">${OM.money(s.finalMonthRevenue)}</td>
          <td class="right num">${OM.money(s.exitRunRate)}</td>
          <td class="right num">${OM.count(s.finalMonthSessions)}</td>
          <td class="right num">${share.toFixed(0)}%</td>
        </tr>`;
      })
      .join('');
    return `
      <section id="summary" class="admin-section">
        <p class="eyebrow">Summary</p>
        <h2>By site, and in total</h2>
        <div class="section-body">
          <div class="table-wrap"><div class="table-scroll"><table class="model-table">
            <thead><tr><th>Site</th><th class="right">Year 1</th><th class="right">Year 2</th><th class="right">${model.displayMonths}-month total</th><th class="right">${esc(model.monthLabels[model.monthLabels.length - 1])}</th><th class="right">Exit run-rate</th><th class="right">Sessions, final month</th><th class="right">Share of revenue</th></tr></thead>
            <tbody>${rows}<tr class="total-row"><td>All ${OM.numWord(model.order.length)}</td><td class="right num">${OM.money(t.year1Revenue)}</td><td class="right num">${OM.money(t.year2Revenue)}</td><td class="right num">${OM.money(t.totalRevenue)}</td><td class="right num">${OM.money(t.finalMonthRevenue)}</td><td class="right num">${OM.money(t.exitRunRate)}</td><td class="right num">${OM.count(t.finalMonthSessions)}</td><td class="right num">100%</td></tr></tbody>
          </table></div>
          <p class="table-caption">Exit run-rate is the final month annualised — the number that matters if you ever want to sell one of these. Commissions also pay on a lag: most programmes hold 30–60 days against refunds and require $50–$100 minimums, so cash arrives one to two months behind the revenue shown here.</p>
          </div>
        </div>
      </section>`;
  }

  function renderQuarterly(model) {
    const blocks = model.order
      .map((key) => {
        const site = model.sites[key];
        const rows = site.quarters
          .map(
            (q) => `<tr>
          <td style="font-weight:900;color:var(--leaf)">${esc(q.label)}</td>
          <td class="text-muted">${esc(q.monthsLabel)}</td>
          <td class="right num">${OM.count(q.sessions)}</td>
          <td class="right num">${OM.count(Math.round(q.orders))}</td>
          <td class="right num">${OM.money(q.gmv)}</td>
          <td class="right num" style="font-weight:900;color:var(--leaf)">${OM.money(q.revenue)}</td>
          <td class="right num">${OM.rps(q.revPerSession)}</td>
          <td class="right num ${q.changeVsPriorPct === null ? 'text-muted' : 'text-up'}">${q.changeVsPriorPct === null ? '–' : OM.signedPercent(q.changeVsPriorPct)}</td>
        </tr>`,
          )
          .join('');
        return `<div class="site-block">
          <p class="site-block-title">${esc(site.profile.name)}<span class="subtle">quarterly</span></p>
          <div class="table-wrap"><div class="table-scroll"><table class="model-table">
            <thead><tr><th>Quarter</th><th>Months</th><th class="right">Sessions</th><th class="right">Orders</th><th class="right">Merchant GMV</th><th class="right">Your revenue</th><th class="right">Rev / session</th><th class="right">vs prior Q</th></tr></thead>
            <tbody>${rows}<tr class="total-row"><td>Total</td><td class="text-muted">${model.displayMonths} months</td><td class="right num">${OM.count(site.totalSessions)}</td><td class="right num">${OM.count(Math.round(site.totalOrders))}</td><td class="right num">${OM.money(site.totalGmv)}</td><td class="right num">${OM.money(site.totalRevenue)}</td><td class="right num">${OM.rps(site.totalSessions > 0 ? site.totalRevenue / site.totalSessions : 0)}</td><td class="right text-muted">–</td></tr></tbody>
          </table></div></div>
        </div>`;
      })
      .join('');
    return `
      <section id="quarterly" class="admin-section">
        <p class="eyebrow">Quarterly</p>
        <h2>Eight quarters, by site</h2>
        <div class="section-body">${blocks}</div>
      </section>`;
  }

  function renderMonthly(model) {
    const blocks = model.order
      .map((key) => {
        const site = model.sites[key];
        const rows = site.months
          .map((m) => {
            const varianceCls = m.revenueVariancePct === null ? 'text-muted' : m.revenueVariancePct >= 0 ? 'text-up' : 'text-down';
            return `<tr class="${m.isActual ? 'actual-row' : ''}">
          <td style="font-weight:900;color:var(--leaf)">${esc(m.label)}${m.isActual ? '<span class="actual-tag">actual</span>' : ''}</td>
          <td class="right num">${OM.count(m.sessions)}</td>
          <td class="right num">${OM.rps(m.revPerSession)}</td>
          <td class="right num">${m.orders.toFixed(1)}</td>
          <td class="right num">${OM.money(m.gmv)}</td>
          <td class="right num" style="font-weight:900;color:var(--leaf)">${OM.money(m.revenue)}</td>
          <td class="right actual-col">${numInput({ role: 'actual', site: key, month: m.index, field: 'sessions', value: getActual(key, m.index, 'sessions'), placeholder: '–', step: 1, tone: 'actual', label: `${site.profile.shortName} actual sessions for ${m.label}` })}</td>
          <td class="right actual-col">${numInput({ role: 'actual', site: key, month: m.index, field: 'revenue', value: getActual(key, m.index, 'revenue'), placeholder: '–', prefix: '$', step: 1, tone: 'actual', label: `${site.profile.shortName} actual revenue for ${m.label}` })}</td>
          <td class="right num ${varianceCls}">${m.revenueVariancePct === null ? '–' : OM.signedPercent(m.revenueVariancePct)}${m.sessionsVariancePct !== null ? `<span class="subrow">${OM.signedPercent(m.sessionsVariancePct)} sessions</span>` : ''}</td>
        </tr>`;
          })
          .join('');
        const closedCount = site.closedMonths ? site.closedMonths.length : 0;
        return `<div class="site-block">
          <p class="site-block-title">${esc(site.profile.name)}<span class="subtle">monthly · ${closedCount > 0 ? `re-anchored on ${closedCount} closed month${closedCount === 1 ? '' : 's'}` : 'not re-anchored'}</span></p>
          <div class="table-wrap"><div class="table-scroll"><table class="model-table">
            <thead><tr><th>Month</th><th class="right">Sessions</th><th class="right">Rev/sess</th><th class="right">Orders</th><th class="right">GMV</th><th class="right">Revenue</th><th class="right actual-col">Actual sessions</th><th class="right actual-col">Actual revenue</th><th class="right">Variance</th></tr></thead>
            <tbody>${rows}<tr class="total-row"><td>${model.displayMonths}-month total</td><td class="right num">${OM.count(site.totalSessions)}</td><td class="right num">${OM.rps(site.totalSessions > 0 ? site.totalRevenue / site.totalSessions : 0)}</td><td class="right num">${OM.count(Math.round(site.totalOrders))}</td><td class="right num">${OM.money(site.totalGmv)}</td><td class="right num">${OM.money(site.totalRevenue)}</td><td class="actual-col"></td><td class="actual-col"></td><td></td></tr></tbody>
          </table></div></div>
        </div>`;
      })
      .join('');
    return `
      <section id="monthly" class="admin-section">
        <p class="eyebrow">Monthly</p>
        <h2>Month by month, and where you enter actuals</h2>
        <p class="intro">The two shaded columns in each table are yours. Enter real sessions and real earned commission for any month that has closed. As soon as a month has both, the model stops guessing about that month and re-anchors everything after it — per site. Your entries save to this browser automatically.</p>
        <div class="section-body">${blocks}</div>
      </section>`;
  }

  function statusPill(status) {
    if (status === 'tracking') return '<span class="pill pill-good">tracking</span>';
    if (status === 'partial') return '<span class="pill pill-warn">partial</span>';
    return '<span class="pill pill-bad">earns $0</span>';
  }

  function renderMerchants(model) {
    const blocks = model.order
      .map((key) => {
        const site = model.sites[key];
        const rows = OM.MERCHANTS[key];
        const attributable = OM.attributableShare(key);
        const dead = rows.filter((r) => r.status === 'none').length;
        const trs = rows
          .map(
            (r) => `<tr>
          <td style="font-weight:900;color:var(--leaf)">${esc(r.merchant)}</td>
          <td class="text-muted">${esc(r.platform)}</td>
          <td class="right num">${r.ratePct === null ? '–' : `${r.ratePct}%`}</td>
          <td>${statusPill(r.status)}</td>
          <td class="right num">${r.sharePct}%</td>
          <td class="right num ${r.status === 'none' ? 'text-muted' : ''}" style="${r.status === 'none' ? '' : 'font-weight:900;color:var(--leaf)'}">${OM.money((r.sharePct / 100) * site.year2Revenue)}</td>
          <td class="text-muted" style="white-space:normal;max-width:22rem;font-size:0.72rem">${esc(r.note)}</td>
        </tr>`,
          )
          .join('');
        return `<div class="site-block">
          <p class="site-block-title">${esc(site.profile.name)}<span class="subtle">${rows.length} merchant rows · ${dead} earning nothing today</span></p>
          <div class="table-wrap"><div class="table-scroll"><table class="model-table">
            <thead><tr><th>Merchant</th><th>Platform / network</th><th class="right">Rate</th><th>Status</th><th class="right">Share of site revenue</th><th class="right">Year-2 revenue</th><th>Note</th></tr></thead>
            <tbody>${trs}<tr class="total-row"><td>Attributable today</td><td></td><td></td><td></td><td class="right num">${attributable}%</td><td class="right num">${OM.money((attributable / 100) * site.year2Revenue)}</td><td class="text-muted" style="font-size:0.72rem">${100 - attributable}% of clicks currently uncredited</td></tr></tbody>
          </table></div></div>
        </div>`;
      })
      .join('');
    return `
      <section id="stores" class="admin-section">
        <p class="eyebrow">By store</p>
        <h2>Which merchants carry the money, and which earn nothing today</h2>
        <p class="intro">Revenue is not spread evenly across your vendors, and the ones with the biggest catalogues are not always the ones that pay. Share-of-revenue figures are modelled from catalogue depth, in-stock rate, basket size and commission rate — estimates of mix, not measurements.</p>
        <div class="section-body">${blocks}</div>
      </section>`;
  }

  function renderReverse(model) {
    const blended = model.totals.blendedRevPerSession;
    const legal = model.sites.legal;
    const legalRps = legal.finalMonthSessions > 0 ? legal.finalMonthRevenue / legal.finalMonthSessions : 0;
    const rows = OM.INCOME_TARGETS.map((income) => {
      const sessions = blended > 0 ? income / blended : 0;
      const legalSessions = legalRps > 0 ? income / legalRps : 0;
      return `<tr>
        <td style="font-weight:900;color:var(--leaf)">${OM.money(income)}${income === 8333 ? '<span class="text-muted" style="margin-left:8px;font-size:0.72rem;font-weight:500">($100k/yr)</span>' : ''}</td>
        <td class="right num" style="font-weight:900;color:var(--leaf)">${OM.count(Math.round(sessions))}</td>
        <td class="right num">${OM.count(Math.round(sessions / 30))}</td>
        <td class="right num">${OM.count(Math.round(legalSessions))}</td>
        <td class="right num">${OM.count(Math.round(legalSessions / 30))}</td>
        <td class="right num">${OM.money(income * 12)}</td>
      </tr>`;
    }).join('');
    return `
      <section id="reverse" class="admin-section">
        <p class="eyebrow">Reverse</p>
        <h2>What a given income actually requires</h2>
        <p class="intro">Run the model backwards. At the blended revenue per session above, this is the traffic each income level demands, and what that means in daily visitors across the family.</p>
        <div class="section-body">
          <div class="table-wrap"><div class="table-scroll"><table class="model-table">
            <thead><tr><th>Monthly income</th><th class="right">Sessions / month<span class="subrow">at blended economics</span></th><th class="right">Sessions / day</th><th class="right">If it were all Legal Leaf</th><th class="right">Legal Leaf sessions / day</th><th class="right">Annualised</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <p class="table-caption">The second column is the honest one. Legal Leaf alone needs far less traffic than the family average to hit the same number, because it earns several times more per visitor.</p>
          </div>
        </div>
      </section>`;
  }

  function renderNext90() {
    const cards = OM.NEXT_90_DAYS.map(
      (item, i) => `<div class="card"><p class="next-num">${String(i + 1).padStart(2, '0')}</p><h3 style="margin:6px 0 8px;font-size:1.05rem;font-weight:900;color:var(--leaf)">${esc(item.title)}</h3><p>${esc(item.body)}</p><p class="next-why">${esc(item.why)}</p></div>`,
    ).join('');
    return `
      <section id="next" class="admin-section">
        <p class="eyebrow">Next</p>
        <h2>The ninety days that move the projection</h2>
        <div class="section-body card-grid cols-2">${cards}</div>
      </section>`;
  }

  function renderMethod() {
    const notes = OM.METHOD_NOTES.map((n) => `<li>${esc(n)}</li>`).join('');
    return `
      <section id="method" class="admin-section">
        <p class="eyebrow">Method</p>
        <h2>How the model works, and where it is weakest</h2>
        <div class="section-body">
          <ul class="method-list">${notes}</ul>
          <p style="max-width:46rem;margin-top:20px;font-size:0.85rem;color:var(--muted);line-height:1.6">${esc(OM.METHOD_FOOTNOTE)}</p>
          <div class="admin-footer">
            <p>Built ${esc(OM.PREPARED_ON)} · sitemap counts measured live from the original four production domains on that date. Gear Avail joined on 10 Aug 2026; its 15 is its hand-authored category landings only, since its per-instrument pages are generated from the catalogue and scale with inventory.</p>
            <p>Market rates from published affiliate programme terms and 2026 industry benchmarks; platform advertising policies from Google, Meta and TikTok published standards.</p>
            <p>Projections are estimates under stated assumptions, not forecasts or guarantees. This is a planning tool for your own business, not investment advice.</p>
          </div>
        </div>
      </section>`;
  }

  // ── chart (built via DOM API so hover updates don't require a full rerender) ──

  const CHART_PAD = { top: 14, right: 124, bottom: 36, left: 58 };
  const CHART_PLOT_HEIGHT = 300;
  const CHART_MIN_WIDTH = 560;
  const NS = 'http://www.w3.org/2000/svg';

  function compactMoney(n) {
    if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return `$${Math.round(n)}`;
  }

  function niceTicks(max, target = 4) {
    if (max <= 0) return [0];
    const rough = max / target;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
    const step = candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1];
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
    return el;
  }

  function buildChart(mount, model) {
    mount.innerHTML = '';
    const series = model.order;
    const months = model.sites[series[0]].months;

    const card = document.createElement('div');
    card.className = 'chart-card';

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.innerHTML =
      series.map((key) => `<span style="display:flex;align-items:center;gap:6px">${swatch(model.sites[key].profile.color)}${esc(model.sites[key].profile.shortName)}</span>`).join('') +
      '<span class="note">Stacked — the top edge is total monthly revenue</span>';
    card.appendChild(legend);

    const scroll = document.createElement('div');
    scroll.className = 'chart-scroll';
    card.appendChild(scroll);

    const width = Math.max(CHART_MIN_WIDTH, mount.clientWidth || CHART_MIN_WIDTH);
    const plotWidth = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
    const height = CHART_PAD.top + CHART_PLOT_HEIGHT + CHART_PAD.bottom;

    const stacks = months.map((_, i) => {
      let running = 0;
      const bands = series.map((key) => {
        const value = model.sites[key].months[i].revenue;
        const band = { key, value, from: running, to: running + value };
        running += value;
        return band;
      });
      return { total: running, bands };
    });
    const peak = Math.max(...stacks.map((s) => s.total), 1);
    const ticks = niceTicks(peak);
    const maxY = ticks[ticks.length - 1];
    const xAt = (i) => CHART_PAD.left + (plotWidth * i) / Math.max(1, months.length - 1);
    const yAt = (v) => CHART_PAD.top + CHART_PLOT_HEIGHT * (1 - v / maxY);

    const svg = svgEl('svg', {
      width,
      height,
      role: 'img',
      'aria-label': `Monthly revenue by site, ${months[0].label} to ${months[months.length - 1].label}. Full figures are in the monthly tables below.`,
      tabindex: '0',
      class: 'chart-svg',
    });

    const GRID = 'rgba(255,255,255,0.08)';
    const AXIS_INK = '#9fb9aa';

    for (const t of ticks) {
      svg.appendChild(svgEl('line', { x1: CHART_PAD.left, x2: CHART_PAD.left + plotWidth, y1: yAt(t), y2: yAt(t), stroke: GRID, 'stroke-width': 1 }));
      const label = svgEl('text', { x: CHART_PAD.left - 10, y: yAt(t), 'text-anchor': 'end', 'dominant-baseline': 'middle', 'font-size': 11, fill: AXIS_INK });
      label.setAttribute('class', 'tabular-nums');
      label.textContent = compactMoney(t);
      svg.appendChild(label);
    }

    series.forEach((key, si) => {
      const top = stacks.map((s, i) => `${xAt(i)},${yAt(s.bands[si].to)}`);
      const bottom = stacks
        .map((s, i) => `${xAt(i)},${yAt(s.bands[si].from)}`)
        .reverse();
      svg.appendChild(svgEl('polygon', { points: [...top, ...bottom].join(' '), fill: model.sites[key].profile.color, 'fill-opacity': 0.9 }));
    });

    series.slice(1).forEach((key, si) => {
      svg.appendChild(
        svgEl('polyline', {
          points: stacks.map((s, i) => `${xAt(i)},${yAt(s.bands[si].to)}`).join(' '),
          fill: 'none',
          stroke: '#0a1a15',
          'stroke-width': 2,
        }),
      );
    });

    svg.appendChild(svgEl('line', { x1: CHART_PAD.left, x2: CHART_PAD.left + plotWidth, y1: CHART_PAD.top + CHART_PLOT_HEIGHT, y2: CHART_PAD.top + CHART_PLOT_HEIGHT, stroke: GRID, 'stroke-width': 1 }));

    months.forEach((m, i) => {
      if (i % 3 === 0 || i === months.length - 1) {
        const anchor = i === months.length - 1 ? 'end' : i === 0 ? 'start' : 'middle';
        const t = svgEl('text', { x: xAt(i), y: CHART_PAD.top + CHART_PLOT_HEIGHT + 18, 'text-anchor': anchor, 'font-size': 11, fill: AXIS_INK });
        t.textContent = m.label;
        svg.appendChild(t);
      }
    });

    // direct end labels, nudged apart so they never collide
    const endLabels = (() => {
      const last = stacks[stacks.length - 1];
      const raw = last.bands
        .map((b) => ({ key: b.key, value: b.value, y: yAt((b.from + b.to) / 2) }))
        .filter((l) => l.value > 0)
        .sort((a, b) => a.y - b.y);
      const MIN_GAP = 30;
      for (let i = 1; i < raw.length; i += 1) {
        if (raw[i].y - raw[i - 1].y < MIN_GAP) raw[i].y = raw[i - 1].y + MIN_GAP;
      }
      const overflow = raw.length ? raw[raw.length - 1].y - (CHART_PAD.top + CHART_PLOT_HEIGHT) : 0;
      if (overflow > 0) for (const l of raw) l.y -= overflow;
      return raw;
    })();
    for (const l of endLabels) {
      const t = svgEl('text', { x: CHART_PAD.left + plotWidth + 10, y: l.y, 'dominant-baseline': 'middle', 'font-size': 11, 'font-weight': 700, fill: model.sites[l.key].profile.color });
      t.textContent = `${model.sites[l.key].profile.shortName} ${OM.money(l.value)}`;
      svg.appendChild(t);
    }

    const crosshair = svgEl('line', { x1: 0, x2: 0, y1: CHART_PAD.top, y2: CHART_PAD.top + CHART_PLOT_HEIGHT, stroke: 'rgba(255,255,255,0.45)', 'stroke-width': 1, visibility: 'hidden' });
    svg.appendChild(crosshair);

    const hitWidth = plotWidth / Math.max(1, months.length - 1);
    const hitRects = months.map((m, i) => {
      const rect = svgEl('rect', { x: xAt(i) - hitWidth / 2, y: CHART_PAD.top, width: hitWidth, height: CHART_PLOT_HEIGHT, fill: 'transparent' });
      svg.appendChild(rect);
      return rect;
    });

    scroll.appendChild(svg);

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'status');
    scroll.appendChild(tooltip);

    function setHover(i) {
      if (i === null) {
        crosshair.setAttribute('visibility', 'hidden');
        tooltip.style.visibility = 'hidden';
        return;
      }
      const idx = Math.min(months.length - 1, Math.max(0, i));
      const x = xAt(idx);
      crosshair.setAttribute('x1', x);
      crosshair.setAttribute('x2', x);
      crosshair.setAttribute('visibility', 'visible');

      const stack = stacks[idx];
      const bandsHtml = [...stack.bands]
        .reverse()
        .map((b) => `<div class="tt-row"><span class="name">${swatch(model.sites[b.key].profile.color)}${esc(model.sites[b.key].profile.shortName)}</span><span class="val">${OM.money(b.value)}</span></div>`)
        .join('');
      tooltip.innerHTML = `<p class="tt-month">${esc(months[idx].label)}</p>${bandsHtml}<div class="tt-total"><span class="label">Total</span><span class="val">${OM.money(stack.total)}</span></div>`;
      tooltip.style.left = `${Math.min(Math.max(x + 14, 8), Math.max(width - 220, 8))}px`;
      tooltip.style.visibility = 'visible';
    }

    let hoverIndex = null;
    hitRects.forEach((rect, i) => {
      rect.addEventListener('mouseenter', () => {
        hoverIndex = i;
        setHover(i);
      });
    });
    svg.addEventListener('mouseleave', () => {
      hoverIndex = null;
      setHover(null);
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        hoverIndex = Math.min(months.length - 1, (hoverIndex === null ? months.length - 1 : hoverIndex) + 1);
        setHover(hoverIndex);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        hoverIndex = Math.max(0, (hoverIndex === null ? months.length - 1 : hoverIndex) - 1);
        setHover(hoverIndex);
      } else if (e.key === 'Escape') {
        hoverIndex = null;
        setHover(null);
      }
    });

    const foot = document.createElement('p');
    foot.className = 'chart-foot';
    foot.textContent = `Hover, or focus the chart and use ← →, for a month-by-month breakdown. Every value here is also in the monthly tables below. Peak month on this scale: ${OM.money(maxY)}.`;
    card.appendChild(foot);

    mount.appendChild(card);
  }

  function renderChartSection(model) {
    const t = model.totals;
    return `
      <section id="trajectory" class="admin-section">
        <p class="eyebrow">Trajectory</p>
        <h2>Monthly revenue, all ${OM.numWord(model.order.length)} sites</h2>
        <p class="intro">${esc(OM.SCENARIOS[state.scenario].label)} case. Stacked, so the top edge is total monthly revenue across all ${OM.numWord(model.order.length)} sites, ${OM.money(t.finalMonthRevenue)} in ${esc(model.monthLabels[model.monthLabels.length - 1])}. Legal Leaf is the bottom band.</p>
        <div class="section-body" id="chart-mount"></div>
      </section>`;
  }

  // ── full render ───────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), ms);
    };
  }

  function renderApp() {
    const root = document.getElementById('app');
    if (!root) return;

    const models = computeModels();
    const model = models[state.scenario];
    const t = model.totals;
    const closedTotal = model.order.reduce((sum, key) => sum + (model.sites[key].closedMonths ? model.sites[key].closedMonths.length : 0), 0);

    root.innerHTML = `
      <header>
        <p class="eyebrow">Operating model · ${models.base.order.length}-site affiliate family · prepared ${esc(OM.PREPARED_ON)}</p>
        <h1 class="admin-h1">Can this actually make money?</h1>
        <p class="admin-lede">A ${models.base.displayMonths}-month projection for Legal Leaf Market, Nicotia Market, Herbal Leaf Market, KawaiiKatz and Gear Avail, built from real commission rates, real catalogue sizes, and the affiliate links that are actually tracking today.</p>
        ${renderHeaderChips(model, models, closedTotal, hydrated)}
        <nav class="admin-nav">${SECTIONS.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join('')}</nav>
      </header>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
      ${renderVerdict(models, model, t)}
      ${renderFacts()}
      ${renderUnitEconomics(model)}
      ${renderControls()}
      ${renderChartSection(model)}
      ${renderSummary(model)}
      ${renderQuarterly(model)}
      ${renderMonthly(model)}
      ${renderMerchants(model)}
      ${renderReverse(model)}
      ${renderNext90()}
      ${renderMethod()}
    `;

    const chartMount = document.getElementById('chart-mount');
    if (chartMount) {
      buildChart(chartMount, model);
      chartRedraw = () => buildChart(chartMount, model);
    }
  }

  // ── event delegation (bound once; survives innerHTML rebuilds) ─────────

  function wireEvents() {
    const root = document.getElementById('app');
    if (!root) return;

    root.addEventListener('change', (e) => {
      const el = e.target;
      if (el.matches && el.matches('input[data-role="assumption"]')) {
        const raw = el.value.trim();
        const next = raw === '' ? null : Number(raw);
        setValue(el.dataset.site, el.dataset.field, Number.isFinite(next) ? next : null);
        persist();
        renderApp();
      } else if (el.matches && el.matches('input[data-role="actual"]')) {
        const raw = el.value.trim();
        const next = raw === '' ? null : Number(raw);
        setActual(el.dataset.site, Number(el.dataset.month), el.dataset.field, Number.isFinite(next) ? next : null);
        persist();
        renderApp();
      } else if (el.matches && el.matches('input[data-role="import-file"]')) {
        const file = el.files && el.files[0];
        if (file) importData(file);
        el.value = '';
      }
    });

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-role]');
      if (!btn) return;
      if (btn.dataset.role === 'scenario') {
        state.scenario = btn.dataset.key;
        persist();
        renderApp();
      } else if (btn.dataset.role === 'horizon') {
        state.horizon = btn.dataset.key;
        persist();
        renderApp();
      } else if (btn.dataset.role === 'export') {
        exportData();
      } else if (btn.dataset.role === 'import-trigger') {
        const input = root.querySelector('input[data-role="import-file"]');
        if (input) input.click();
      } else if (btn.dataset.role === 'reset') {
        if (window.confirm('Reset every assumption and every actual you have entered? This cannot be undone.')) resetAll();
      }
    });

    window.addEventListener(
      'resize',
      debounce(() => {
        if (chartRedraw) chartRedraw();
      }, 150),
    );
  }

  function init() {
    load();
    wireEvents();
    renderApp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* public/js/strategy.mjs — the ONE copy of the arithmetic.
 *
 * Imported by the browser (Plan / Live / Test tabs) AND by the serverless
 * functions in api/ (../public/js/strategy.mjs). A rule stated twice drifts,
 * and a drift here is not a display bug: the number the browser alerts on
 * would stop being the number the screen ranked on. Pure functions, no I/O,
 * no globals. Candles are {t, o, h, l, c, v} ascending, daily unless stated.
 *
 * WHAT IS IN HERE, AND WHERE EACH RULE COMES FROM
 *   ema / rollingStd / atr / annualisedVol / maxDrawdown ......... textbook
 *   bazTrend .......... Baz, Granger, Harvey, Le Roux, Rattray (Man AHL, 2015),
 *                       "Dissecting Investment Strategies in the Cross Section
 *                       and Time Series": three EMA crossover horizons
 *                       (8/24, 16/48, 32/96), normalised by 63-day price vol and
 *                       252-day signal vol, response u = z·exp(-z²/4)/0.89.
 *                       Applied to bitcoin by Rohrbach, Suremann & Osterrieder.
 *   donchianEnsemble .. Zarattini, Pagani & Barbon (2025), "Catching Crypto
 *                       Trends": one long/flat vote per lookback (5…360 days),
 *                       exposure = share of votes that are long.
 *   scoreSnapshot ..... cross-sectional momentum, the Liu–Tsyvinski–Wu (JF 2022)
 *                       factor: rank coins by return over a lookback of about
 *                       1–3× the holding period, risk-adjusted so a coin that is
 *                       up 20% on 200% vol does not outrank one up 12% on 40%.
 *   buildPlan ......... Brandt-style exits: a stop set from the coin's own
 *                       range (ATR), a target at 2–3× that risk, and a time
 *                       stop at the horizon. Inverse-vol sizing at low risk.
 *   FEE_MODELS ........ Coinbase's published schedule (Sept 2026): app "simple"
 *                       buy = flat $0.99/$1.49/$1.99/$2.99 by size plus ~0.5%
 *                       spread; Advanced lowest tier 1.20% taker / 0.60% maker.
 *   walkForward ....... the backtest: re-run the screen every cycle on data up
 *                       to that day only, hold, exit by the same rules, compound.
 */

export const VERSION = "2026-09-07.1";
const DAYS = 365;

/* ---------- basics ---------- */

export function ema(xs, n) {
  const out = new Array(xs.length);
  if (!xs.length) return out;
  const lam = 1 - 1 / n;                       // Baz et al. define the time scale this way
  let e = xs[0];
  out[0] = e;
  for (let i = 1; i < xs.length; i++) { e = lam * e + (1 - lam) * xs[i]; out[i] = e; }
  return out;
}

export function rollingMean(xs, n, minN = Math.min(n, 5)) {
  const out = new Array(xs.length).fill(NaN);
  const q = []; let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!Number.isFinite(v)) { q.length = 0; sum = 0; continue; }
    q.push(v); sum += v;
    if (q.length > n) sum -= q.shift();
    if (q.length >= minN) out[i] = sum / q.length;
  }
  return out;
}

/* Trailing sample standard deviation over the last n finite values. NaN until
   minN values are available; a NaN in the input restarts the window, so a
   series with a NaN prefix (every normalised series below) is handled. */
export function rollingStd(xs, n, minN = Math.min(n, 20)) {
  const out = new Array(xs.length).fill(NaN);
  const q = []; let sum = 0, sq = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!Number.isFinite(v)) { q.length = 0; sum = 0; sq = 0; continue; }
    q.push(v); sum += v; sq += v * v;
    if (q.length > n) { const d = q.shift(); sum -= d; sq -= d * d; }
    const m = q.length;
    if (m >= Math.max(2, minN)) {
      const mean = sum / m;
      out[i] = Math.sqrt(Math.max(0, (sq - m * mean * mean) / (m - 1)));
    }
  }
  return out;
}

export function trueRange(c, prev) {
  const hl = c.h - c.l;
  if (!prev) return hl;
  return Math.max(hl, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
}

/* Wilder's ATR: seeded with the simple mean of the first n true ranges, then
   smoothed (n-1)/n. */
export function atr(candles, n = 14) {
  const out = new Array(candles.length).fill(NaN);
  let a = 0, seed = 0;
  for (let i = 0; i < candles.length; i++) {
    const tr = trueRange(candles[i], candles[i - 1]);
    if (i < n) { seed += tr; if (i === n - 1) { a = seed / n; out[i] = a; } continue; }
    a = (a * (n - 1) + tr) / n; out[i] = a;
  }
  return out;
}

export function logRet(closes) {
  const out = new Array(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) out[i] = Math.log(closes[i] / closes[i - 1]);
  return out;
}

export function annualisedVol(closes, n = 30) {
  return rollingStd(logRet(closes), n, Math.min(n, 10)).map(v => v * Math.sqrt(DAYS));
}

/* Vol of log returns over exactly the last k bars ending at i (used for the
   horizon-matched lookback, which changes with the slider). */
export function volOver(closes, i, k) {
  if (i - k < 1) return NaN;
  let s = 0, sq = 0, m = 0;
  for (let j = i - k + 1; j <= i; j++) { const r = Math.log(closes[j] / closes[j - 1]); s += r; sq += r * r; m++; }
  if (m < 2) return NaN;
  const mean = s / m;
  return Math.sqrt(Math.max(0, (sq - m * mean * mean) / (m - 1))) * Math.sqrt(DAYS);
}

export function ret(closes, i, k) {
  if (i - k < 0 || !(closes[i - k] > 0)) return NaN;
  return closes[i] / closes[i - k] - 1;
}

export function maxDrawdown(closes, from = 0, to = closes.length - 1) {
  let peak = -Infinity, mdd = 0;
  for (let i = Math.max(0, from); i <= to; i++) {
    const c = closes[i];
    if (!(c > 0)) continue;
    if (c > peak) peak = c;
    const dd = 1 - c / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

/* ---------- the two published trend signals ---------- */

/* Baz et al. trend signal, in [-0.96, 0.96]. NaN until every horizon has
   enough history to be normalised (about 40 bars with the adaptive windows). */
export function bazTrend(closes, o = {}) {
  const S = o.S || [8, 16, 32], L = o.L || [24, 48, 96];
  const priceVolN = o.priceVolN || 63, sigVolN = o.sigVolN || 252;
  const n = closes.length;
  const sdP = rollingStd(closes, priceVolN, 20);
  const acc = new Array(n).fill(0), cnt = new Array(n).fill(0);
  for (let k = 0; k < S.length; k++) {
    const es = ema(closes, S[k]), el = ema(closes, L[k]);
    const y = new Array(n);
    for (let i = 0; i < n; i++) y[i] = (es[i] - el[i]) / sdP[i];
    const sdY = rollingStd(y, sigVolN, 20);
    for (let i = 0; i < n; i++) {
      const z = y[i] / sdY[i];
      if (!Number.isFinite(z)) continue;
      acc[i] += z * Math.exp(-z * z / 4) / 0.89;
      cnt[i]++;
    }
  }
  return acc.map((a, i) => (cnt[i] === S.length ? a / cnt[i] : NaN));
}

/* Zarattini-style ensemble: for each lookback the vote is 1 when the close is
   above the midpoint of that window's channel (max close + min close) / 2,
   else 0; the exposure is the mean vote. A lookback the history cannot fill is
   left out, so a young coin is judged on the short windows only. */
export const DONCHIAN_LOOKBACKS = [5, 10, 20, 30, 60, 90, 150, 250, 360];
export function donchianEnsemble(closes, lookbacks = DONCHIAN_LOOKBACKS) {
  const n = closes.length, out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let on = 0, used = 0;
    for (const lb of lookbacks) {
      const start = i - lb + 1;
      if (start < 0) continue;
      let mx = -Infinity, mn = Infinity;
      for (let j = start; j <= i; j++) { const c = closes[j]; if (c > mx) mx = c; if (c < mn) mn = c; }
      used++;
      if (closes[i] > (mx + mn) / 2) on++;
    }
    out[i] = used ? on / used : NaN;
  }
  return out;
}

/* ---------- per-coin analysis: every series once, read at any index ---------- */

export function lookbackFor(horizonDays) {
  return Math.max(5, Math.min(90, Math.round(horizonDays * 1.5)));
}

export function analyse(candles) {
  const closes = candles.map(c => c.c);
  const series = {
    trend: bazTrend(closes),
    donch: donchianEnsemble(closes),
    vol30: annualisedVol(closes, 30),
    atr14: atr(candles, 14),
    dollarVol30: rollingMean(candles.map(c => c.c * (c.v || 0)), 30),
  };
  const n = closes.length;
  function at(i, horizonDays = 21) {
    if (i < 0 || i >= n) return null;
    const L = lookbackFor(horizonDays);
    const close = closes[i];
    const volL = volOver(closes, i, L);
    const retL = ret(closes, i, L);
    // return in units of the noise one would expect over the lookback
    const raM = Number.isFinite(volL) && volL > 0 ? retL / (volL * Math.sqrt(L / DAYS)) : NaN;
    const a = series.atr14[i];
    return {
      i, t: candles[i].t, close, bars: i + 1, L,
      ret1: ret(closes, i, 1), ret7: ret(closes, i, 7), ret14: ret(closes, i, 14), ret30: ret(closes, i, 30), retL,
      vol30: series.vol30[i], volL, raM,
      trend: series.trend[i], donch: series.donch[i],
      atr14: a, atrPct: Number.isFinite(a) ? a / close : NaN,
      dollarVol30: series.dollarVol30[i],
      dd30: maxDrawdown(closes, i - 30, i),
      high30: Math.max(...closes.slice(Math.max(0, i - 30), i + 1)),
    };
  }
  return { n, candles, closes, series, at, last: (h) => at(n - 1, h) };
}

/* ---------- the screen ---------- */

export const RISK = {
  1: { label: "Careful",  maxRank: 30,  minDollarVol: 20e6, maxVol: 0.9,      maxStop: 0.15, targetR: 2,   weighting: "invvol", requireUpWeek: true,  requireTrend: true  },
  2: { label: "Steady",   maxRank: 50,  minDollarVol: 10e6, maxVol: 1.2,      maxStop: 0.20, targetR: 2,   weighting: "invvol", requireUpWeek: true,  requireTrend: true  },
  3: { label: "Balanced", maxRank: 100, minDollarVol: 5e6,  maxVol: 1.6,      maxStop: 0.25, targetR: 2.5, weighting: "blend",  requireUpWeek: true,  requireTrend: false },
  4: { label: "Spicy",    maxRank: 150, minDollarVol: 2e6,  maxVol: 2.5,      maxStop: 0.30, targetR: 3,   weighting: "equal",  requireUpWeek: false, requireTrend: false },
  5: { label: "Degen",    maxRank: 300, minDollarVol: 1e6,  maxVol: Infinity, maxStop: 0.40, targetR: 3,   weighting: "score",  requireUpWeek: false, requireTrend: false },
};
export function riskOf(r) { return RISK[Math.max(1, Math.min(5, Math.round(Number(r) || 3)))]; }

/* One coin's snapshot -> a score, or an exclusion with a reason a person can
   read. Every gate is a sentence on purpose: "why not X" is the first question
   a shopper asks of a list that leaves out the coin they heard about. */
export function scoreSnapshot(s, { horizonDays = 21, risk = 3, rank = null } = {}) {
  const R = riskOf(risk);
  if (!s || !Number.isFinite(s.close)) return { score: null, excluded: "no price" };
  if (s.bars < 30) return { score: null, excluded: "less than 30 days of history" };
  if (rank != null && rank > R.maxRank) return { score: null, excluded: `outside the top ${R.maxRank} by market cap` };
  if (Number.isFinite(s.dollarVol30) && s.dollarVol30 < R.minDollarVol) return { score: null, excluded: `under $${(R.minDollarVol / 1e6).toFixed(0)}M a day traded` };
  if (Number.isFinite(s.vol30) && s.vol30 < 0.05) return { score: null, excluded: "pegged (a stablecoin)" };
  if (Number.isFinite(s.vol30) && s.vol30 > R.maxVol) return { score: null, excluded: `too wild for "${R.label}" (${Math.round(s.vol30 * 100)}% vol)` };
  if (R.requireUpWeek && !(s.ret7 > 0)) return { score: null, excluded: "down this week" };
  if (R.requireTrend && !(s.trend > 0)) return { score: null, excluded: "trend signal is negative" };
  if (!(s.retL > 0)) return { score: null, excluded: `not up over the last ${s.L} days` };
  if (!Number.isFinite(s.raM)) return { score: null, excluded: "cannot measure its noise yet" };

  const why = [];
  let score = s.raM;
  why.push(`+${(s.retL * 100).toFixed(0)}% in ${s.L}d, ${s.raM.toFixed(1)}× its usual swing`);
  const d = Number.isFinite(s.donch) ? s.donch : 0.5;
  score *= 0.5 + 0.5 * d;
  why.push(`${Math.round(d * 100)}% of trend windows point up`);
  if (Number.isFinite(s.trend)) {
    score *= s.trend > 0 ? 1 + 0.5 * Math.min(1, s.trend) : 0.5;
    why.push(s.trend > 0 ? `trend signal +${s.trend.toFixed(2)}` : `trend signal ${s.trend.toFixed(2)}, haircut`);
  }
  const weekSigma = (Number.isFinite(s.volL) ? s.volL : 1) * Math.sqrt(7 / DAYS);
  if (s.ret7 > 3 * weekSigma) { score *= 0.7; why.push("already spiked this week, haircut"); }
  if (s.dd30 > 0.35) { score *= 0.7; why.push("fell more than 35% inside the month, haircut"); }
  return { score, why };
}

/* rank every candidate as of one bar index (the last bar for the live screen,
   an earlier one inside the backtest). candidates: [{id, symbol, name, rank, analysis, price?}] */
export function screen(candidates, { horizonDays = 21, risk = 3, asOfIndex = null } = {}) {
  const rows = [];
  for (const c of candidates) {
    const idx = asOfIndex == null ? c.analysis.n - 1 : asOfIndex(c);
    if (idx == null || idx < 0) { rows.push({ ...strip(c), score: null, excluded: "no data as of that day" }); continue; }
    const snap = c.analysis.at(idx, horizonDays);
    /* the liquidity gate is about getting out, and the coin trades on more
       venues than Coinbase: prefer the universe's global 24h volume (CoinGecko)
       over the 30-day Coinbase-only average when it is the larger figure.
       Measured live: Arbitrum at $3.4M/day on Coinbase alone read as "thin". */
    if (snap && c.vol24 > 0 && !(snap.dollarVol30 >= c.vol24)) snap.dollarVol30 = c.vol24;
    const r = scoreSnapshot(snap, { horizonDays, risk, rank: c.rank });
    rows.push({ ...strip(c), price: snap ? snap.close : null, snap, ...r });
  }
  rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || String(a.symbol).localeCompare(String(b.symbol)));
  return rows;
}
function strip(c) { const { analysis, ...rest } = c; return rest; }

/* ---------- fees ---------- */

export const FEE_MODELS = {
  coinbase_simple:          { label: "Coinbase app, the simple Buy button", spread: 0.005, flat: [[10, 0.99], [25, 1.49], [50, 1.99], [200, 2.99]], pct: 0.0149 },
  coinbase_advanced_taker:  { label: "Coinbase Advanced, market order (1.20%)", pct: 0.012 },
  coinbase_advanced_maker:  { label: "Coinbase Advanced, limit order (0.60%)", pct: 0.006 },
  kraken_pro:               { label: "Kraken Pro, market order (0.40%)", pct: 0.004 },
  zero:                     { label: "No fees (fantasy)", pct: 0 },
};
export function feeOneSide(model, notional) {
  const m = typeof model === "string" ? FEE_MODELS[model] : model;
  if (!m || !(notional > 0)) return 0;
  let f = notional * (m.pct || 0);
  if (m.flat) {
    const tier = m.flat.find(([upTo]) => notional <= upTo);
    f = tier ? Math.max(tier[1], notional * (m.pct || 0)) : notional * (m.pct || 0);
  }
  return f + notional * (m.spread || 0);
}
export function roundTrip(model, notional) { return feeOneSide(model, notional) * 2; }

/* ---------- the plan: sizes, stops, targets, dates ---------- */

export function buildPlan(ranked, { budget = 30, n = 6, horizonDays = 21, risk = 3, feeModel = "coinbase_advanced_taker", now = Date.now() } = {}) {
  const R = riskOf(risk);
  const picks = ranked.filter(r => r.score != null && r.snap && r.price > 0).slice(0, Math.max(1, n));
  if (!picks.length) return { rows: [], fees: null, note: "nothing passed the screen at this setting" };
  const inv = picks.map(p => 1 / Math.max(0.2, Number.isFinite(p.snap.vol30) ? p.snap.vol30 : 1));
  const eq = picks.map(() => 1);
  const sc = picks.map(p => Math.max(0.1, p.score));
  const norm = w => { const t = w.reduce((a, b) => a + b, 0); return w.map(x => x / t); };
  let w;
  if (R.weighting === "equal") w = norm(eq);
  else if (R.weighting === "invvol") w = norm(inv);
  else if (R.weighting === "score") w = norm(sc);
  else { const a = norm(inv), b = norm(eq); w = a.map((x, i) => (x + b[i]) / 2); }
  const rows = picks.map((p, i) => {
    const dollars = Math.round(budget * w[i] * 100) / 100;
    /* THE STOP IS A DISASTER STOP, NOT THE EXIT. A stop tighter than the noise
       of the holding period is hit by noise: a coin on 100% annualised vol
       wanders ~24% over three weeks, so a 15% stop paid the spread 32 times in
       36 on the sample universe and never caught a trend. The exit that says
       the thesis failed is the trend break (trendBrokenAt below); the stop is
       the floor under a crash. Scaled to the horizon and the coin's own range,
       capped by the risk setting. */
    const atrPct = Number.isFinite(p.snap.atrPct) ? p.snap.atrPct : 0.05;
    const vol = Number.isFinite(p.snap.vol30) ? p.snap.vol30 : 1;
    const noiseH = vol * Math.sqrt(horizonDays / DAYS);
    const stopPct = Math.min(R.maxStop, Math.max(0.06, 3 * atrPct, 1.0 * noiseH));
    const targetPct = stopPct * R.targetR;
    return {
      id: p.id, symbol: p.symbol, name: p.name, rank: p.rank, image: p.image || null,
      price: p.price, score: p.score, why: p.why,
      ret7: p.snap.ret7, ret30: p.snap.ret30, vol30: p.snap.vol30, trend: p.snap.trend, donch: p.snap.donch,
      weight: w[i], dollars, units: dollars / p.price,
      stopPct, targetPct, stop: p.price * (1 - stopPct), target: p.price * (1 + targetPct),
      sellBy: now + horizonDays * 86400e3,
      product: p.product || null,
    };
  });
  const rt = rows.reduce((a, r) => a + roundTrip(feeModel, r.dollars), 0);
  const simple = rows.reduce((a, r) => a + roundTrip("coinbase_simple", r.dollars), 0);
  return {
    rows,
    fees: { model: feeModel, label: FEE_MODELS[feeModel]?.label || feeModel, roundTrip: rt, pctOfStake: rt / budget, simpleRoundTrip: simple, simplePct: simple / budget },
    risk: R.label, horizonDays, budget,
  };
}

/* ---------- the exit that means "the thesis failed" ---------- */

/* Fewer than half the Donchian windows still long, or the Baz signal clearly
   negative. Evaluated on DAILY closes: it is a decision about the trend, and
   an intraday print is not a trend. */
export function trendBrokenAt(analysis, k) {
  const d = analysis.series.donch[k], t = analysis.series.trend[k];
  if (Number.isFinite(d) && d < 0.5) return true;
  if (Number.isFinite(t) && t < -0.2) return true;
  return false;
}

/* ---------- live rules: one function for the browser and the cron ---------- */

/* pos: {id, entry, units, stop, target, stopPct, high, sellBy, targetHit}
   tick: {price, time}. Mutates pos.high / pos.stop (the trail ratchets), returns
   the events this tick produced. Silent events (trail) carry level "info". */
export function evaluatePosition(pos, tick, now = Date.now(), ctx = {}) {
  const events = [];
  const p = Number(tick.price);
  if (!(p > 0)) return events;
  if (!(pos.high > 0) || p > pos.high) pos.high = p;
  const trail = pos.high * (1 - pos.stopPct);
  if (trail > pos.stop) { pos.stop = trail; events.push({ type: "trail", level: "info", price: p, stop: pos.stop }); }
  const pnl = p / pos.entry - 1;
  if (p <= pos.stop) {
    events.push({ type: "stop", level: "sell", price: p, pnl, msg: `${pos.symbol}: stop hit at $${fmt(p)} (${pct(pnl)}). Sell.` });
  } else if (!pos.targetHit && p >= pos.target) {
    pos.targetHit = true;
    if (pos.entry > pos.stop) pos.stop = pos.entry;      // never give a winner back below break-even
    events.push({ type: "target", level: "sell", price: p, pnl, msg: `${pos.symbol}: target hit, ${pct(pnl)}. Sell half, let the rest ride with the stop at break-even.` });
  }
  if (ctx.trendBroken && !pos.trendNotified) {
    pos.trendNotified = true;
    events.push({ type: "trend", level: "sell", price: p, pnl, msg: `${pos.symbol}: the trend broke on the daily close (${pct(pnl)}). This is the exit the plan was built on. Sell.` });
  }
  if (pos.sellBy && now >= pos.sellBy && !pos.horizonNotified) {
    pos.horizonNotified = true;
    events.push({ type: "horizon", level: "sell", price: p, pnl, msg: `${pos.symbol}: the ${pos.horizonLabel || "horizon"} is up at ${pct(pnl)}. Close it out; a plan that keeps extending is not a plan.` });
  }
  return events;
}

/* "It's popping": the move over the last `minutes` against what that window
   usually moves, from a ring of {t, p} ticks. threshold floors at 3% so a
   quiet coin does not page you for noise. */
export function poppingCheck(ring, { minutes = 60, volAnnual = 1, sigma = 2.5, now = Date.now() } = {}) {
  if (!ring || ring.length < 2) return null;
  const since = now - minutes * 60e3;
  let first = null;
  for (const r of ring) { if (r.t >= since) { first = r; break; } }
  if (!first) first = ring[0];
  const last = ring[ring.length - 1];
  if (!(first.p > 0) || last.t - first.t < minutes * 60e3 * 0.5) return null;
  const move = last.p / first.p - 1;
  const windowSigma = (Number.isFinite(volAnnual) ? volAnnual : 1) * Math.sqrt(minutes / (DAYS * 24 * 60));
  const threshold = Math.max(0.03, sigma * windowSigma);
  return { move, threshold, popping: Math.abs(move) >= threshold, up: move > 0 };
}

/* ---------- the backtest: walk forward, no lookahead ---------- */

/* universe: [{id, symbol, name, rank, analysis}] on daily candles. Cycles of
   horizonDays: screen on the cycle's first day using only bars up to it, buy at
   that close, exit at stop (with slippage), target, or the last day's close;
   proceeds compound into the next cycle. Fees both sides. */
export function walkForward(universe, { budget = 30, n = 6, horizonDays = 21, risk = 3, feeModel = "coinbase_advanced_taker", months = 6, slippage = 0.002, calendarId = null } = {}) {
  const cal = universe.find(u => u.id === calendarId) || universe.reduce((a, b) => (b.analysis.n > (a ? a.analysis.n : 0) ? b : a), null);
  if (!cal) return { error: "empty universe" };
  const times = cal.analysis.candles.map(c => c.t);
  const lastT = times[times.length - 1];
  const startT = lastT - months * 30 * 86400e3;
  let startIdx = times.findIndex(t => t >= startT);
  if (startIdx < 0) startIdx = 0;
  startIdx = Math.max(startIdx, 40);
  const idxMaps = new Map(universe.map(u => [u.id, new Map(u.analysis.candles.map((c, i) => [c.t, i]))]));
  const indexAt = (u, t) => { const m = idxMaps.get(u.id); return m.has(t) ? m.get(t) : null; };

  let cash = budget, feesPaid = 0;
  const equity = [], cycles = [], exits = { stop: 0, target: 0, trend: 0, horizon: 0 };
  let ci = startIdx;
  while (ci < times.length - 1) {
    const t0 = times[ci];
    const ranked = screen(universe, { horizonDays, risk, asOfIndex: (u) => indexAt(u, t0) });
    const plan = buildPlan(ranked, { budget: cash, n, horizonDays, risk, feeModel, now: t0 });
    const positions = plan.rows.map(r => {
      const fee = feeOneSide(feeModel, r.dollars);
      cash -= r.dollars; feesPaid += fee;
      const units = (r.dollars - fee) / r.price;
      return { ...r, units, cost: r.dollars, high: r.price, open: true, exit: null, exitT: null, reason: null };
    });
    const endIdx = Math.min(times.length - 1, ci + horizonDays);
    for (let di = ci + 1; di <= endIdx; di++) {
      const t = times[di];
      let value = cash;
      for (const pos of positions) {
        if (!pos.open) continue;
        const u = universe.find(x => x.id === pos.id);
        const k = indexAt(u, t);
        if (k == null) { value += pos.units * pos.price; continue; }
        const c = u.analysis.candles[k];
        let exitPx = null, reason = null;
        if (c.o <= pos.stop) { exitPx = c.o * (1 - slippage); reason = "stop"; }          // gapped through it
        else if (c.l <= pos.stop) { exitPx = pos.stop * (1 - slippage); reason = "stop"; }
        else if (!pos.targetHit && c.h >= pos.target) { exitPx = pos.target; reason = "target"; }
        else if (trendBrokenAt(u.analysis, k)) { exitPx = c.c * (1 - slippage); reason = "trend"; }
        else if (di === endIdx) { exitPx = c.c; reason = "horizon"; }
        if (exitPx != null) {
          const gross = pos.units * exitPx, fee = feeOneSide(feeModel, gross);
          cash += gross - fee; feesPaid += fee;
          pos.open = false; pos.exit = exitPx; pos.exitT = t; pos.reason = reason; pos.pnl = (gross - fee) / pos.cost - 1;
          exits[reason]++;
          value += gross - fee;
        } else {
          if (c.h > pos.high) { pos.high = c.h; pos.stop = Math.max(pos.stop, pos.high * (1 - pos.stopPct)); }
          value += pos.units * c.c;
        }
      }
      equity.push({ t, v: value });
    }
    cycles.push({
      start: t0, end: times[endIdx], startCash: plan.budget, endCash: cash,
      ret: plan.budget > 0 ? cash / plan.budget - 1 : 0,
      picks: positions.map(p => ({ symbol: p.symbol, entry: p.price, exit: p.exit, reason: p.reason, pnl: p.pnl, dollars: p.cost })),
    });
    ci = endIdx;
  }
  const bench = benchmark(cal, times[startIdx], budget);
  const eq = equity.map(e => e.v);
  const stats = {
    start: times[startIdx], end: lastT, days: Math.round((lastT - times[startIdx]) / 86400e3),
    totalReturn: cash / budget - 1, endCash: cash, feesPaid, feesPctOfStake: feesPaid / budget,
    maxDrawdown: maxDrawdown(eq), cycles: cycles.length,
    winRate: cycles.length ? cycles.filter(c => c.ret > 0).length / cycles.length : 0,
    avgCycle: cycles.length ? cycles.reduce((a, c) => a + c.ret, 0) / cycles.length : 0,
    exits, benchmarkReturn: bench.ret, benchmarkSymbol: cal.symbol,
  };
  return { stats, cycles, equity, benchmark: bench.series };
}
function benchmark(u, fromT, budget) {
  const cs = u.analysis.candles;
  const i0 = cs.findIndex(c => c.t >= fromT);
  if (i0 < 0) return { ret: 0, series: [] };
  const p0 = cs[i0].c;
  return { ret: cs[cs.length - 1].c / p0 - 1, series: cs.slice(i0).map(c => ({ t: c.t, v: budget * c.c / p0 })) };
}

/* ---------- formatting shared by the alert text ---------- */
export function fmt(p) {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(3);
}
export function pct(x) { return Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—"; }

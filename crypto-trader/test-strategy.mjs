/* test-strategy.mjs — pins the arithmetic in public/js/strategy.mjs. No network,
   no browser. `node test-strategy.mjs`. */
import * as S from "./public/js/strategy.mjs";
import { fixtureUniverse, syntheticCandles } from "./lib/fixture.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("  FAIL:", msg); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const section = (t) => console.log(`\n# ${t}`);

section("ema, rollingStd, atr");
{
  const e = S.ema([1, 2, 3, 4, 5], 2);
  ok(near(e[1], 1.5) && near(e[2], 2.25) && near(e[3], 3.125) && near(e[4], 4.0625), `ema lambda=1-1/n: ${e}`);
  const sd = S.rollingStd([2, 4, 4, 4, 5, 5, 7, 9], 8, 8);
  ok(near(sd[7], Math.sqrt(32 / 7), 1e-9), `sample std of the textbook series: ${sd[7]}`);
  ok(Number.isNaN(sd[6]), "NaN until minN values");
  const sd2 = S.rollingStd([NaN, NaN, 1, 2, 3, 4], 3, 3);
  ok(Number.isNaN(sd2[3]) && near(sd2[4], 1) && near(sd2[5], 1), `window restarts after a NaN prefix: ${sd2}`);
  const cs = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: 100, v: 1 }));
  const a = S.atr(cs, 14);
  ok(Number.isNaN(a[12]) && near(a[13], 2) && near(a[29], 2), `constant 2-point range -> ATR 2: ${a[13]}, ${a[29]}`);
  const vol = S.annualisedVol([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 10);
  ok(near(vol[11], 0), "a flat price has zero vol");
  ok(S.lookbackFor(21) === 32 && S.lookbackFor(3) === 5 && S.lookbackFor(90) === 90 && S.lookbackFor(200) === 90, "lookback = 1.5x horizon, floored at 5, capped at 90");
}

section("Baz trend signal");
{
  const up = syntheticCandles({ seed: 7, days: 400, start: 100, vol: 0.5, drift: 2.5 }).map(c => c.c);
  const dn = syntheticCandles({ seed: 7, days: 400, start: 100, vol: 0.5, drift: -2.5 }).map(c => c.c);
  const tu = S.bazTrend(up), td = S.bazTrend(dn);
  ok(Number.isNaN(tu[10]) && Number.isFinite(tu[399]), "NaN prefix, then finite");
  ok(tu[399] > 0.15, `strong uptrend reads positive: ${tu[399].toFixed(3)}`);
  ok(td[399] < -0.15, `strong downtrend reads negative: ${td[399].toFixed(3)}`);
  // the response function u = z*exp(-z^2/4)/0.89 peaks at z = sqrt(2) and FADES a trend that has run for a very long time (that is the point of it)
  const u = z => z * Math.exp(-z * z / 4) / 0.89;
  ok(u(Math.SQRT2) > u(3) && u(3) > u(6) && Math.abs(u(Math.SQRT2) - 0.964) < 0.002, "response function peaks at sqrt(2) then fades an over-extended trend");
  ok(tu.every(v => Number.isNaN(v) || Math.abs(v) <= 0.97), "bounded by the response function's peak (0.964)");
  const flat = S.bazTrend(new Array(300).fill(100));
  ok(flat.every(v => Number.isNaN(v)), "a constant price has no signal (not a spurious zero)");
}

section("Donchian ensemble");
{
  const up = Array.from({ length: 400 }, (_, i) => 100 + i);
  const dn = Array.from({ length: 400 }, (_, i) => 500 - i);
  ok(near(S.donchianEnsemble(up)[399], 1), "monotonic up -> every window votes long");
  ok(near(S.donchianEnsemble(dn)[399], 0), "monotonic down -> no window votes long");
  ok(Number.isNaN(S.donchianEnsemble([1, 2, 3])[2]), "3 bars: no lookback fits -> NaN, not a vote");
  ok(near(S.donchianEnsemble([1, 2, 3, 4, 5])[4], 1), "5 bars: only the 5-day window votes");
}

section("fees");
{
  ok(near(S.feeOneSide("coinbase_simple", 5), 1.015, 1e-9), `$5 on the simple button: $0.99 + 0.5% spread = ${S.feeOneSide("coinbase_simple", 5)}`);
  ok(near(S.roundTrip("coinbase_simple", 5), 2.03, 1e-9), "round trip on $5 is $2.03 (40% of the ticket)");
  ok(near(S.feeOneSide("coinbase_simple", 30), 2.14, 1e-9), "$30: $1.99 + spread");
  ok(near(S.feeOneSide("coinbase_simple", 500), 9.95, 1e-9), "$500: 1.49% beats every flat tier, plus spread");
  ok(near(S.feeOneSide("coinbase_advanced_taker", 5), 0.06, 1e-9), "Advanced taker 1.20%");
  ok(near(S.feeOneSide("coinbase_advanced_maker", 5), 0.03, 1e-9), "Advanced maker 0.60%");
  ok(S.feeOneSide("zero", 5) === 0 && S.feeOneSide("nope", 5) === 0, "unknown model charges nothing rather than throwing");
}

section("scoreSnapshot gates");
{
  const base = { close: 10, bars: 400, ret7: 0.05, ret14: 0.1, ret30: 0.2, retL: 0.15, L: 32, vol30: 0.8, volL: 0.8, raM: 1.2, trend: 0.4, donch: 0.8, atrPct: 0.04, dollarVol30: 1e8, dd30: 0.1 };
  ok(S.scoreSnapshot({ ...base, vol30: 0.001 }).excluded?.includes("pegged"), "stablecoin refused");
  ok(S.scoreSnapshot({ ...base, dollarVol30: 1e5 }).excluded?.includes("traded"), "thin coin refused");
  ok(S.scoreSnapshot(base, { risk: 1, rank: 40 }).excluded?.includes("top 30"), "risk 1 stays inside the top 30");
  ok(S.scoreSnapshot({ ...base, ret7: -0.02 }, { risk: 3 }).excluded === "down this week", "balanced still wants an up week");
  ok(S.scoreSnapshot({ ...base, ret7: -0.02 }, { risk: 5 }).score > 0, "degen does not");
  ok(S.scoreSnapshot({ ...base, trend: -0.2 }, { risk: 2 }).excluded?.includes("trend"), "steady wants a positive trend signal");
  ok(S.scoreSnapshot({ ...base, vol30: 3 }, { risk: 3 }).excluded?.includes("wild"), "vol cap by risk");
  ok(S.scoreSnapshot({ ...base, retL: -0.01 }).excluded?.includes("not up"), "must be up over the lookback");
  const r = S.scoreSnapshot(base);
  ok(r.score > 0 && Array.isArray(r.why) && r.why.length >= 3, `a sound coin scores with reasons: ${r.score?.toFixed(3)} / ${r.why?.join("; ")}`);
  const spiked = S.scoreSnapshot({ ...base, ret7: 0.6 });
  ok(spiked.score < r.score && spiked.why.some(w => w.includes("spiked")), "a blow-off week is haircut, not rewarded");
}

section("screen + buildPlan on the fixture universe");
{
  const uni = fixtureUniverse().map(u => ({ ...u, analysis: S.analyse(u.candles) }));
  const ranked = S.screen(uni, { horizonDays: 21, risk: 3 });
  const syms = ranked.filter(r => r.score != null).map(r => r.symbol);
  ok(syms.length >= 6, `at least six pass at balanced: ${syms.join(",")}`);
  ok(!syms.includes("USDC") && !syms.includes("THIN"), "the stablecoin and the thin coin never pass");
  ok(ranked.find(r => r.symbol === "USDC").excluded.includes("pegged"), "USDC's exclusion names the reason");
  const plan = S.buildPlan(ranked, { budget: 30, n: 6, horizonDays: 21, risk: 3 });
  ok(plan.rows.length === 6, "six picks");
  const sum = plan.rows.reduce((a, r) => a + r.dollars, 0);
  ok(Math.abs(sum - 30) < 0.07, `dollars sum to the stake: ${sum.toFixed(2)}`);
  ok(plan.rows.every(r => r.stop < r.price && r.target > r.price && r.stopPct <= 0.25 + 1e-9 && r.stopPct >= 0.06), "stop below, target above, stop capped by risk");
  ok(plan.rows.every(r => r.stopPct >= 0.9 * Math.min(0.25, r.vol30 * Math.sqrt(21 / 365))), "the stop is not inside three weeks of the coin's own noise");
  ok(plan.rows.every(r => Math.abs(r.targetPct / r.stopPct - 2.5) < 1e-9), "balanced targets 2.5x the risk");
  ok(plan.fees.roundTrip > 0 && plan.fees.simpleRoundTrip > plan.fees.roundTrip * 5, `the app button costs many times Advanced: $${plan.fees.simpleRoundTrip.toFixed(2)} vs $${plan.fees.roundTrip.toFixed(2)}`);
  const careful = S.buildPlan(S.screen(uni, { horizonDays: 21, risk: 1 }), { budget: 30, n: 6, risk: 1 });
  ok(careful.rows.every(r => r.rank <= 30), "careful: nothing outside the top 30");
  if (careful.rows.length >= 2) {
    const byVol = [...careful.rows].sort((a, b) => a.vol30 - b.vol30);
    ok(byVol[0].dollars >= byVol[byVol.length - 1].dollars, "careful sizes inverse to vol: the calmest coin gets the most dollars");
  }
  const degen = S.buildPlan(S.screen(uni, { horizonDays: 7, risk: 5 }), { budget: 30, n: 6, risk: 5 });
  ok(degen.rows.length === 6 && degen.rows.every(r => r.stopPct <= 0.40 + 1e-9), "degen: wider stops, still bounded");
}

section("evaluatePosition");
{
  const pos = { symbol: "SOL", entry: 100, units: 0.05, stop: 90, target: 125, stopPct: 0.1, high: 100, sellBy: Date.now() + 86400e3 };
  ok(S.evaluatePosition(pos, { price: 95 }).length === 0, "95: nothing");
  const ev = S.evaluatePosition(pos, { price: 110 });
  ok(ev.length === 1 && ev[0].type === "trail" && near(pos.stop, 99), `110: the stop trails to 99 (${pos.stop})`);
  const ev2 = S.evaluatePosition(pos, { price: 98.5 });
  ok(ev2.some(e => e.type === "stop" && e.level === "sell"), "98.5: below the trailed stop -> sell");
  const p2 = { symbol: "SOL", entry: 100, stop: 90, target: 125, stopPct: 0.1, high: 100, sellBy: Date.now() + 86400e3 };
  const ev3 = S.evaluatePosition(p2, { price: 126 });
  ok(ev3.some(e => e.type === "target") && p2.targetHit && p2.stop >= 100, "126: target -> sell half, stop to break-even at least");
  ok(!S.evaluatePosition(p2, { price: 127 }).some(e => e.type === "target"), "target fires once");
  const p3 = { symbol: "SOL", entry: 100, stop: 90, target: 125, stopPct: 0.1, high: 100, sellBy: Date.now() - 1000 };
  const ev4 = S.evaluatePosition(p3, { price: 101 });
  ok(ev4.some(e => e.type === "horizon") && !S.evaluatePosition(p3, { price: 101 }).some(e => e.type === "horizon"), "horizon fires once");
  ok(S.evaluatePosition(p3, { price: "nope" }).length === 0, "garbage tick -> no events");
  const p4 = { symbol: "SOL", entry: 100, stop: 80, target: 150, stopPct: 0.2, high: 100, sellBy: Date.now() + 86400e3 };
  const ev5 = S.evaluatePosition(p4, { price: 97 }, Date.now(), { trendBroken: true });
  ok(ev5.some(e => e.type === "trend" && e.level === "sell") && !S.evaluatePosition(p4, { price: 97 }, Date.now(), { trendBroken: true }).some(e => e.type === "trend"), "trend break -> sell, once");
  const up = Array.from({ length: 400 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1 }));
  const dn = Array.from({ length: 400 }, (_, i) => ({ t: i, o: 500 - i, h: 501 - i, l: 499 - i, c: 500 - i, v: 1 }));
  ok(!S.trendBrokenAt(S.analyse(up), 399) && S.trendBrokenAt(S.analyse(dn), 399), "trendBrokenAt reads the daily ensemble");
}

section("poppingCheck");
{
  const now = Date.now();
  const ring = Array.from({ length: 61 }, (_, i) => ({ t: now - (60 - i) * 60e3, p: 100 * (1 + 0.05 * i / 60) }));
  const r = S.poppingCheck(ring, { minutes: 60, volAnnual: 0.8, now });
  ok(r && r.popping && r.up && near(r.threshold, 0.03), `+5% in an hour pops (threshold floors at 3%): ${JSON.stringify(r)}`);
  const quiet = ring.map((x, i) => ({ t: x.t, p: 100 * (1 + 0.01 * i / 60) }));
  ok(!S.poppingCheck(quiet, { minutes: 60, volAnnual: 0.8, now }).popping, "+1% does not");
  ok(S.poppingCheck(ring.slice(-3), { minutes: 60, now }) === null, "too short a window -> null, not a verdict");
}

section("walkForward");
{
  const uni = fixtureUniverse().map(u => ({ ...u, analysis: S.analyse(u.candles) }));
  const bt = S.walkForward(uni, { budget: 30, n: 6, horizonDays: 21, risk: 3, months: 4, calendarId: "bitcoin" });
  ok(!bt.error && bt.cycles.length >= 4, `cycles: ${bt.cycles.length}`);
  ok(bt.equity.length > 60 && bt.equity.every(e => Number.isFinite(e.v)), "daily equity path");
  ok(bt.stats.feesPaid > 0 && Number.isFinite(bt.stats.totalReturn) && Number.isFinite(bt.stats.maxDrawdown), `stats: ${JSON.stringify(bt.stats)}`);
  const positions = bt.cycles.reduce((a, c) => a + c.picks.length, 0);
  const exits = bt.stats.exits.stop + bt.stats.exits.target + bt.stats.exits.horizon + bt.stats.exits.trend;
  ok(exits === positions, `every position exits exactly once: ${exits}/${positions}`);
  ok(bt.cycles.every(c => c.picks.every(p => !["USDC", "THIN"].includes(p.symbol))), "the refused coins never get bought");
  // no lookahead: the screen on day t0 must not change when the future is deleted
  const t0 = bt.cycles[1].start;
  const asOf = (u) => u.analysis.candles.findIndex(c => c.t === t0);
  const full = S.screen(uni, { horizonDays: 21, risk: 3, asOfIndex: asOf }).filter(r => r.score != null).slice(0, 6).map(r => r.symbol);
  const truncated = uni.map(u => { const k = asOf(u); return { ...u, analysis: S.analyse(u.candles.slice(0, k + 1)) }; });
  const trunc = S.screen(truncated, { horizonDays: 21, risk: 3 }).filter(r => r.score != null).slice(0, 6).map(r => r.symbol);
  ok(JSON.stringify(full) === JSON.stringify(trunc), `no lookahead: ${full.join(",")} == ${trunc.join(",")}`);
  ok(Number.isFinite(bt.stats.benchmarkReturn) && bt.benchmark.length > 0 && bt.stats.benchmarkSymbol === "BTC", "benchmark rides along");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

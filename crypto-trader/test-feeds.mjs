/* test-feeds.mjs — the feeds layer against a stubbed fetch: a 429 is retried
   and honours retry-after, request starts are paced, CT_NO_FETCH refuses, the
   universe falls back to the fixture when Coinbase is down, and global volume
   reaches the liquidity gate. `node test-feeds.mjs` */
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };

delete process.env.CT_NO_FETCH; delete process.env.CT_FIXTURE;
const calls = [];
const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
globalThis.fetch = async (url) => {
  const u = String(url); calls.push({ url: u, t: Date.now() });
  const nth = calls.filter(c => c.url === u).length;
  if (u.includes("/candles")) {
    if (nth === 1) return new Response("Public rate limit exceeded", { status: 429, headers: { "retry-after": "0.2" } });
    return json(Array.from({ length: 40 }, (_, i) => [1700000000 - i * 86400, 1, 3, 2, 2 + i * 0.01, 10]));   // newest first, as Coinbase serves it
  }
  if (u.endsWith("/products")) return json([{ id: "BTC-USD", base_currency: "BTC", quote_currency: "USD", status: "online", trading_disabled: false }, { id: "ETH-USD", base_currency: "ETH", quote_currency: "USD", status: "online" }, { id: "XYZ-USD", base_currency: "XYZ", quote_currency: "USD", status: "delisted" }, { id: "BTC-EUR", base_currency: "BTC", quote_currency: "EUR", status: "online" }]);
  if (u.includes("coingecko")) return json([{ id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1, current_price: 80000, total_volume: 5e10, price_change_percentage_7d_in_currency: 2, price_change_percentage_30d_in_currency: 20 }, { id: "ethereum", symbol: "eth", name: "Ethereum", market_cap_rank: 2, current_price: 2500, total_volume: 2e10 }, { id: "tether", symbol: "usdt", name: "Tether", market_cap_rank: 3, total_volume: 9e10 }, { id: "nowhere", symbol: "NOPE", name: "Not on Coinbase", market_cap_rank: 4, total_volume: 1e9 }]);
  if (u.includes("/ticker")) return json({ price: "1.5", bid: "1.49", ask: "1.51", volume: "100", time: "2026-09-07T00:00:00Z" });
  return new Response("nope", { status: 500 });
};
const F = await import("./lib/feeds.js");

console.log("# 429 retry with retry-after");
{
  const t0 = Date.now();
  const bars = await F.coinbaseCandles("BTC-USD", { bars: 300 });
  const cc = calls.filter(c => c.url.includes("/candles"));
  ok(bars.length === 40 && bars[0].t < bars[39].t && bars[39].c === 2, `retried once and sorted ascending: ${bars.length} bars, ${cc.length} calls`);
  ok(cc.length === 2 && Date.now() - t0 >= 190, "waited retry-after (0.2s) before the retry");
}
console.log("# pacing");
{
  const before = calls.length;
  await Promise.all(["A", "B", "C", "D"].map(p => F.getRetry(`https://api.exchange.coinbase.com/products/${p}-USD/ticker`, {}, { minGap: 100 })));
  const ts = calls.slice(before).map(c => c.t).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  ok(gaps.every(g => g >= 90), `four parallel requests start at least ~100ms apart: gaps ${gaps.join(",")}`);
}
console.log("# universe");
{
  const u = await F.buildUniverse({ limit: 10 });
  ok(!u.meta.fixture && u.candidates.length === 2, `two Coinbase-tradable, non-stable coins with history: ${u.candidates.map(c => c.symbol).join(",")}`);
  ok(u.candidates.every(c => c.product && c.vol24 > 0), "candidates carry the product id and global volume");
  ok(!u.candidates.some(c => c.symbol === "USDT" || c.symbol === "NOPE"), "stablecoin and off-Coinbase coins excluded");
  ok(u.meta.upstreams.coingecko.ok && u.meta.upstreams.coinbaseProducts.usdPairs === 2, `upstreams reported: ${JSON.stringify(u.meta.upstreams)}`);
}
console.log("# refusals and fallbacks");
{
  F.clearCache();
  process.env.CT_NO_FETCH = "1";
  let threw = null; try { await F.get("https://api.exchange.coinbase.com/products"); } catch (e) { threw = e; }
  ok(threw && /CT_NO_FETCH/.test(threw.message), "CT_NO_FETCH throws a named refusal, never a fake 200");
  delete process.env.CT_NO_FETCH;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  const u = await F.buildUniverse({ limit: 5 });
  ok(u.meta.fixture === true && /unreachable/.test(u.meta.reason) && u.candidates.length > 20, `Coinbase down -> flagged fixture universe: ${u.meta.reason}`);
}
console.log("# global volume reaches the gate");
{
  const S = await import("./public/js/strategy.mjs");
  const { syntheticCandles } = await import("./lib/fixture.js");
  const thin = syntheticCandles({ seed: 3, days: 200, start: 1, vol: 0.8, drift: 2.5, dollarVol: 3e5 });
  const a = S.analyse(thin);
  const without = S.screen([{ id: "x", symbol: "X", name: "X", rank: 50, analysis: a }], { risk: 3 })[0];
  const withGlobal = S.screen([{ id: "x", symbol: "X", name: "X", rank: 50, vol24: 4e7, analysis: a }], { risk: 3 })[0];
  ok(without.excluded && /traded/.test(without.excluded), `Coinbase-only $300k/day is refused: ${without.excluded}`);
  ok(withGlobal.score != null || !/traded/.test(withGlobal.excluded || ""), `the same coin with $40M global volume passes the liquidity gate: ${withGlobal.excluded || "passed"}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/* test-api.mjs — boots server.mjs on sample data with every upstream refused
   (CT_NO_FETCH=1) and drives each route. No network can be reached even by
   accident. `node test-api.mjs` */
import { spawn } from "node:child_process";

const PORT = 8791;
const srv = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT, CT_FIXTURE: "1", CT_NO_FETCH: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  FAIL:", m); } };
async function up() { for (let i = 0; i < 200; i++) { try { await fetch(base + "/api/quote?ids=BTC-USD"); return; } catch { await new Promise(r => setTimeout(r, 50)); } } throw new Error("server did not start\n" + log); }
const j = async (p, init) => { const r = await fetch(base + p, init); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b, headers: r.headers }; };

try {
  await up();
  const s = await j("/api/screen?budget=30&n=6&horizon=21&risk=3&debug");
  ok(s.status === 200 && s.body.meta.fixture === true, "screen answers on sample data and says so");
  ok(s.body.plan.rows.length === 6 && Math.abs(s.body.plan.rows.reduce((a, r) => a + r.dollars, 0) - 30) < 0.07, "six picks summing to the stake");
  ok(s.body.plan.rows.every(r => r.product && /-USD$/.test(r.product)), "every pick names a Coinbase product for the live feed");
  ok(s.body.ranked.some(r => r.excluded) && s.body.ranked.every(r => Array.isArray(r.spark)), "ranked rows carry exclusions and sparklines");
  ok(s.headers.get("cache-control") === "no-store", "sample data is never CDN-cached");
  const s2 = await j("/api/screen?risk=1&n=3");
  ok(s2.body.plan.rows.length <= 3 && s2.body.plan.rows.every(r => r.rank <= 30), "risk 1 stays in the top 30, n honoured");
  const b = await j("/api/backtest?months=3&risk=3");
  ok(b.status === 200 && b.body.stats && b.body.cycles.length >= 3 && b.body.equity.length > 30, "backtest runs");
  const c = await j("/api/candles?id=SOL-USD&bars=20");
  ok(c.status === 200 && c.body.candles.length === 20 && c.body.meta.fixture, "candles from the fixture");
  ok((await j("/api/candles?id=../etc")).status === 400, "candles validates the product id");
  const q = await j("/api/quote?ids=BTC-USD,SOL-USD");
  ok(q.status === 200 && q.body.quotes.length === 2 && q.body.quotes.every(x => x.price > 0), "quotes");
  ok((await j("/api/quote")).status === 400, "quote without ids is 400");
  const t = await j("/api/traders");
  ok(t.status === 200 && t.body.rows.length >= 3 && t.body.meta.fixture, "traders leaderboard (sample)");
  const t2 = await j("/api/traders?user=0xd475000000000000000000000000000000001a91");
  ok(t2.status === 200 && t2.body.positions.length > 0 && t2.body.fills.length > 0, "trader detail (sample)");
  const p = await j("/api/push");
  ok(p.status === 200 && "vapid" in p.body && "storage" in p.body, "push capability probe");
  const home = await fetch(base + "/"); const html = await home.text();
  ok(home.status === 200 && html.includes('id="tab-plan"') && html.includes("/js/app.js"), "index served");
  ok((await fetch(base + "/playbook")).status === 200, "clean URL /playbook resolves");
  ok((await fetch(base + "/manifest.webmanifest")).headers.get("content-type").includes("manifest"), "manifest content type");
  ok((await fetch(base + "/sw.js")).status === 200 && (await fetch(base + "/js/strategy.mjs")).status === 200, "sw and strategy module served");
  ok((await fetch(base + "/nope")).status === 404 && (await j("/api/nope")).status === 404, "404s");
} catch (e) { fail++; console.log("  FAIL:", e.message); }
finally { srv.kill(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

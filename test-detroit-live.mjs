/* test-detroit-live.mjs — the second city, driven in a real browser.
 *
 * ONE_CORE.md's step 6 asserts that ADDING a city touches only the two data
 * files. This asserts the other half: that a city added that way actually
 * WORKS -- the page renders, the shim asks for its own town, the roster is its
 * own, the trip and colour and overrides are all namespaced to it, and the
 * pilot is untouched by any of it.
 *
 * IT DRIVES THE SAME ENGINE AS THE PILOT, which is the whole point of the
 * exercise: public/engine.js is one file, and if a second city needed its own
 * copy of anything this suite is where that would show up.
 *
 * THE DEMO BANNER IS THE ASSERTION THAT MATTERS. Detroit has nine confirmed
 * shops and none of them connected, so the feed serves placeholder rows. A page
 * of sample products under a real city's name is the single worst thing this
 * project can publish -- so it must ANNOUNCE itself, in words, naming Detroit
 * and not the pilot. That banner was one of the six things step 6 found broken.
 *
 *   node test-detroit-live.mjs
 */
import { spawn } from "node:child_process";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test

const PORT = 3199, CDP = 9599;
const CHROME = chromePath();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => {
  for (let i = 0; i < n; i++) { try { return await fn(); } catch { await wait(250); } }
  throw new Error("timeout");
};

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

const srv = spawn(process.execPath, ["server.mjs"],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_lldet" });

await until(() => fetch(`http://127.0.0.1:${PORT}/api/market?town=detroit`).then(r => { if (!r.ok) throw 0; return r; }));
const tgt = await until(() => fetch(`http://127.0.0.1:${CDP}/json`).then(r => r.json()).then(t => {
  const p = t.find(x => x.type === "page"); if (!p) throw 0; return p;
}));

const s = new globalThis.WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
/* ONE message handler, and it resolves with the WHOLE message. Resolving with
   `m.result` instead reads perfectly and makes every ev() return undefined --
   the accessor below is `.result.result.value`, so the shape has to match the
   other twelve suites rather than be re-derived. */
let id = 0; const waiting = new Map(); const reqs = [];
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent") reqs.push(m.params.request.url);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; waiting.set(i, res); s.send(JSON.stringify({ id: i, method, params }));
});
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* The proxies here refuse Google Fonts, and a render-blocking <link> then
   stalls for ~13s and takes every script after it with it (CLAUDE.md §10). */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });

async function goto(path) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
}

console.log("\n/detroit — a second city, end to end\n");

await goto("/detroit");
await wait(2500);

console.log("== it is served, and it is Detroit's ==");
ok("the page has its own title",
   /^Detroit Cannabis Prices/.test(String(await ev(`document.title`))), await ev(`document.title`));
ok("and its own hero",
   String(await ev(`(document.querySelector('.hero h1')||{}).textContent||''`)).trim() === "DETROIT CANNABIS",
   String(await ev(`(document.querySelector('.hero h1')||{}).textContent||''`)).trim());
ok("the engine painted a grid", (await ev(`document.querySelectorAll('#grid .card').length`)) > 0,
   (await ev(`document.querySelectorAll('#grid .card').length`)) + " cards");

console.log("\n== it asks the feed for ITS OWN town ==");
ok("the shim requested /api/market with town=detroit",
   reqs.some(u => /\/api\/market\b[^"]*town=detroit/.test(u)),
   (reqs.find(u => u.includes("/api/market")) || "none").slice(0, 80));
ok("and never the pilot's town", !reqs.some(u => /town=coldwater/.test(u)));
ok("/api/products was never requested", !reqs.some(u => u.includes("/api/products")));

console.log("\n== THE BANNER, which is what stops sample rows reading as real ones ==");
const banner = String(await ev(`(document.getElementById('cw-banner')||{}).textContent||''`));
ok("a sample-catalogue banner is shown while no shop is connected",
   /Sample catalogue/i.test(banner), banner.slice(0, 90));
ok("...and it names Detroit", /No Detroit dispensary is connected/i.test(banner));
ok("...and never the pilot", !/Coldwater/i.test(banner));

console.log("\n== every store of storage is namespaced to this city ==");
ok("the trip cart key carries the town",
   (await ev(`(function(){var f=document.getElementById('cwl-fab');return f?f.getAttribute('href'):''})()`)) === "/trip?market=detroit",
   String(await ev(`(function(){var f=document.getElementById('cwl-fab');return f?f.getAttribute('href'):''})()`)));
ok("the page published its own context for the shared trip page",
   (await ev(`(JSON.parse(localStorage.getItem('ll_cw:ctx')||'{}')||{}).slug`)) === "detroit",
   String(await ev(`localStorage.getItem('ll_cw:ctx')`)));

console.log("\n== the shop strip is this city's nine, not the pilot's seven ==");
const shops = String(await ev(`
  Array.prototype.map.call(document.querySelectorAll('#fStore option'), function(o){return o.value})
    .filter(Boolean).join('|')`));
ok("the store filter is populated", shops.length > 0, shops.slice(0, 120));
ok("and carries none of the pilot's shops",
   !/Sapura|Green Tree|Banzen|Exclusive|Herbology|Dude Abides/i.test(shops), shops.slice(0, 120));

console.log("\n== the pilot is untouched ==");
await goto("/coldwater");
await wait(2000);
ok("Coldwater still renders as itself",
   String(await ev(`(document.querySelector('.hero h1')||{}).textContent||''`)).trim() === "COLDWATER CANNABIS");
ok("with its own town in the shim", reqs.some(u => /town=coldwater/.test(u)));
ok("and its own trip link",
   (await ev(`(function(){var f=document.getElementById('cwl-fab');return f?f.getAttribute('href'):''})()`)) === "/trip?market=coldwater");

console.log("\n== the collector can be pointed at this city ==");
await goto("/coldwater-collect?market=detroit");
await wait(2500);
const bm = String(await ev(`(document.getElementById('bm')||{}).href||''`));
ok("the bookmarklet it builds carries market=detroit", /market=detroit/.test(bm),
   bm.slice(0, 110));
ok("...so a Detroit capture cannot land on the pilot's shelf", !/market=coldwater/.test(bm));
const cban = String(await ev(`(document.getElementById('ll-market-banner')||{}).textContent||''`));
ok("and the page says which shelf in words", /Detroit/i.test(cban), cban.slice(0, 110));

/* THE SHOP TABLE IS THE SCREEN AN OPERATOR CHECKS TO SEE IF A CAPTURE LANDED,
   and it was answering about a different city. GET /api/market/ingest carried
   Coldwater's seven shop keys as its hardcoded default for every city market
   (the roster-shaped sibling of the third-registry bug), so this table showed
   all nine Detroit shops reading "not connected" while the shelf behind it
   served 2,461 of their rows. Nothing errored; the response was a well-formed
   map of nulls about shops in another town. */
await until(async () => { if (await ev(`document.querySelectorAll('#tbl tbody tr').length > 0`)) return true; throw 0; }, 40);
const tkeys = String(await ev(`[...document.querySelectorAll('#tbl tbody td code')].map(c=>c.textContent).join(',')`));
ok("the shop table lists Detroit's own shops", /hod-detroit/.test(tkeys) && /ascend-detroit/.test(tkeys),
   tkeys.slice(0, 110));
ok("...and none of the pilot's", !/(^|,)(lume|sapura|greentree|banzen|exclusive)(,|$)/.test(tkeys));
/* A shop whose only lane is the operator's browser is not a broken connection.
   Saying so in the language of one sends whoever reads it to look for a
   connection to fix, on every Dutchie and Jane menu in the city. */
const tstate = String(await ev(`document.getElementById('tbl').innerText`));
ok("a shop nobody has visited reads as work, not as a fault",
   /yours to capture/i.test(tstate) && !/not connected/i.test(tstate),
   tstate.replace(/\s+/g, " ").slice(0, 100));

s.close(); ch.kill(); srv.kill();
console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

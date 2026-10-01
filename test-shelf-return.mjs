/* THE SHELF IS A FEED YOU COME BACK TO.

   "We can't have a snap back to grid that refreshes. We need a snap back to
    grid in same state back to same card ... just like on Facebook, you tab over
    and come back to the home page, and the home page is at the same spot."

   A bug this site acquired the day the card body started opening /p/<id>:
   before that there was nowhere to go and nothing to come back from.

   THE ORDER IS THE ASSERTION THAT MATTERS, not the scroll. shelf-shuffle
   re-draws the round order on every load, deliberately, so coming back without
   restoring it gives a DIFFERENT SHELF -- and a scroll restored onto that is
   the right pixel of the wrong page. A suite that only checked scrollY would
   pass against exactly that bug.

   AND A FRESH VISIT MUST STILL SHUFFLE. Quietly turning the shelf into a fixed
   list would be a different site, and test-shelf-shuffle.mjs asserts the
   opposite property. Both are checked here, because either alone is satisfied
   by a broken implementation of the other.

     node test-shelf-return.mjs
*/
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const PORT = 3618, CDP = 9418;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* Enough products that the grid pages several times -- the restore has to
   rebuild depth, and a fixture that fits on one page cannot show that. */
const SHOPS = [["Black Tie CBD", "blacktie"], ["THCA Small Buds", "tsb"], ["Puffy", "puffy"], ["Chill", "chill"]];
const prod = (i) => {
  const [store, storeKey] = SHOPS[i % 4];
  return {
    id: "r" + i, name: "Strain Number " + i, store, storeKey, domain: "e.test", platform: "shopify",
    cannabinoid: "THCa", category: "THCA Flower", type: ["Indica", "Sativa", "Hybrid"][i % 3],
    strain: "S" + i, grow: "Indoor", image: "/favicon.svg", gallery: [],
    url: "https://e.test/p/" + i, brand: "B", brandKey: "b", description: "Sentences.",
    inStock: true, startsAt: 30 + i, sale: 30 + i, perG: (30 + i) / 28, ship: 0, badges: [],
    subTags: { trim: false },
    sizes: [["1 oz", 30 + i, 28, "r" + i + "o", true, "https://e.test/p/" + i, "", 0]],
  };
};
const FEED = { meta: { updated: new Date(0).toISOString(), total: 90, stores: SHOPS.map(([name]) => ({ name, count: 22 })) },
               products: Array.from({ length: 90 }, (_, i) => prod(i)) };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(/products|market|coldwater/.test(u.pathname) ? FEED : { p: {} }));
  }
  /* A stand-in product page: the real one is api/share.js and this suite is
     about the SHELF, but the referrer has to be a real /p/ path or the return
     test would be testing the harness. */
  if (/^\/p\//.test(u.pathname)) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><title>p</title><a id="back" href="/">back</a>`);
  }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  for (const c of [f, f + ".html"]) {
    try { const b = await readFile(join("public", c));
      res.writeHead(200, { "content-type": MIME[extname(c)] || "application/octet-stream" }); return res.end(b); } catch {}
  }
  res.writeHead(404).end("no");
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llreturn" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find((x) => x.type === "page"); if (!p) throw 0; return p });
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = [];
s.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const shelfReady = async () => {
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`);
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card[data-pid]').length`)) > 0) return true; throw 0 }, 80);
  await wait(900);
};
const order = () => ev(`[].map.call(document.querySelectorAll('#grid .card[data-pid]'),function(c){return c.getAttribute('data-pid')})`);

console.log("\n-- a fresh visit still shuffles, which the restore must not take away --");
const seen = [];
for (let i = 0; i < 3; i++) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await shelfReady();
  seen.push((await order()).slice(0, 12).join("|"));
}
ok("three fresh loads give at least two different shelves",
   new Set(seen).size >= 2, new Set(seen).size + " distinct openings");

console.log("\n-- leaving the shelf deep, and coming back --");
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await shelfReady();
/* Page down a few times, so the restore has real depth to rebuild. */
for (let i = 0; i < 3; i++) {
  await ev(`(function(){var b=document.querySelector('#grid .loadmore'); if(b) b.click();})()`);
  await wait(500);
}
const before = await order();
const deep = before.length;
ok("the shelf is paged out before leaving", deep >= 36, deep + " cards");
await ev(`window.scrollTo(0, 1400)`);
await wait(300);
const yBefore = await ev(`Math.round(window.scrollY)`);
ok("...and scrolled down", yBefore > 800, String(yBefore));
const target = before[Math.min(30, before.length - 1)];

/* Leave the way a shopper does: click a card body, which opens /p/<id>. */
await ev(`(function(){var c=document.querySelector('#grid .card[data-pid=${JSON.stringify(target)}] .cname');
  if(c) c.click();})()`);
await until(async () => { if (/^\/p\//.test(await ev(`location.pathname`))) return true; throw 0 }, 40);
ok("clicking a card left the shelf for its product page", /^\/p\//.test(await ev(`location.pathname`)));

/* AND COME BACK BY FOLLOWING A LINK, WHICH IS THE CASE THAT NEEDS THIS MODULE.

   The first draft of this suite pressed history.back(), and every assertion
   passed with shelf-return.js DELETED -- the browser's bfcache restores the DOM
   and the scroll position of a back navigation perfectly, so the suite was
   measuring Chromium rather than this repo.

   A LINK IS NOT A BACK BUTTON. The product page's own breadcrumb says
   "Legal-Leaf Market" and points at /, which is a fresh navigation: no bfcache,
   the page is parsed again, the feed is fetched again and shelf-shuffle deals a
   new shelf. That is the path a shopper actually takes when they have read a
   page and want the shelf again, and it is the one that was broken. */
await ev(`(function(){var a=document.getElementById('back'); if(a) a.click();})()`);
await until(async () => { if ((await ev(`location.pathname`)) === "/") return true; throw 0 }, 40);
await shelfReady();
await wait(900);
ok("following a link came back to the shelf", (await ev(`location.pathname`)) === "/");
ok("...as a fresh navigation, not a bfcache restore",
   (await ev(`(performance.getEntriesByType('navigation')[0]||{}).type`)) !== "back_forward",
   String(await ev(`(performance.getEntriesByType('navigation')[0]||{}).type`)));

const after = await order();
console.log("  before: " + before.slice(0, 8).join(" ") + " ...(" + before.length + ")");
console.log("  after : " + after.slice(0, 8).join(" ") + " ...(" + after.length + ")");

ok("the shelf is as deep as it was", after.length >= deep, after.length + " vs " + deep);
ok("...and in the SAME ORDER, which is the whole point",
   after.slice(0, deep).join("|") === before.join("|"),
   after.slice(0, 6).join(" ") + "  vs  " + before.slice(0, 6).join(" "));
ok("...so the card they were on is where they left it",
   after.indexOf(target) === before.indexOf(target),
   "index " + after.indexOf(target) + " vs " + before.indexOf(target));
const yAfter = await ev(`Math.round(window.scrollY)`);
ok("...and the page is back at the same spot", Math.abs(yAfter - yBefore) < 120, yAfter + " vs " + yBefore);

console.log("\n-- the snapshot is spent, so a later fresh visit is fresh again --");
ok("it was cleared once used", (await ev(`sessionStorage.getItem('ll_shelf_return')`)) === null);

console.log("\n-- and it is quiet --");
ok("no uncaught exceptions", errs.length === 0, errs.slice(0, 2).join(" | "));

try { ch.kill() } catch {}
srv.close();
console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All shelf-return checks passed."}`);
process.exit(fails.length ? 1 : 0);

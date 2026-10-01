/* THE LAST SHELF YOU SAW, INSTEAD OF THE BAKED SEED.

   "Fuck the seed. It sucks anyway and doesn't even have pictures. Can you
    always put the last cache up instead of the seed, and then refresh on top
    of that."

   public/js/feed-cache.js answers the engine's one /api/products call from the
   previous visit's catalogue when the network is slower than a short grace
   period, and always writes the network response back for next time.

   WHAT MAKES THIS SUITE NON-VACUOUS is the control: with the cache cleared and
   the same slow feed, the grid must show the ENGINE'S OWN SEED. Without that
   assertion every other check here is satisfied by a page that simply renders
   its feed, and the whole feature could be deleted with the suite still green.

   THE ORDERING IS THE OTHER HALF. feed-meta.js must wrap this shim, not the
   reverse, or the rails count a catalogue that is not on screen -- so a load
   answered from cache is asserted to leave LL_META describing the CACHED
   shops. That failure is invisible in markup and silent in the console.

     node test-feed-cache.mjs
*/
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const PORT = 3540, CDP = 9660;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

const SHOPS = [["Black Tie CBD", "blacktie"], ["THCA Small Buds", "tsb"], ["Puffy", "puffy"], ["Chill", "chill"]];
const prod = (gen, i) => {
  const [store, storeKey] = SHOPS[i % 4];
  return {
    id: gen + "-" + i, name: gen.toUpperCase() + " Strain " + i, store, storeKey, domain: "e.test", platform: "shopify",
    cannabinoid: "THCa", category: "THCA Flower", type: ["Indica", "Sativa", "Hybrid"][i % 3],
    strain: gen + "S" + i, grow: "Indoor", image: "/favicon.svg",
    /* Eight photographs per product, so "gallery is dropped" is a claim with
       something to drop. It is by far the largest field in the real feed. */
    gallery: Array.from({ length: 8 }, (_, g) => "/favicon.svg?" + gen + i + "-" + g),
    url: "https://e.test/p/" + gen + i, brand: "B", brandKey: "b", description: "Sentences.",
    inStock: true, startsAt: 30 + i, sale: 30 + i, perG: (30 + i) / 28, ship: 0, badges: [],
    subTags: { trim: false },
    sizes: [["1 oz", 30 + i, 28, gen + "-" + i + "o", true, "https://e.test/p/" + gen + i, "", 0]],
  };
};
const feedFor = (gen) => ({
  meta: { updated: new Date(0).toISOString(), total: 40, stores: SHOPS.map(([name]) => ({ name, count: 10 })) },
  products: Array.from({ length: 40 }, (_, i) => prod(gen, i)),
});

/* Server state the suite drives from node, so one browser can be walked through
   fast / slow / broken without restarting anything. */
let DELAY = 0, GEN = "g1", BROKEN = false;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/ctl") {
    DELAY = Number(u.searchParams.get("delay") || 0);
    GEN = u.searchParams.get("gen") || GEN;
    BROKEN = u.searchParams.get("broken") === "1";
    res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok");
  }
  if (u.pathname.startsWith("/api/")) {
    if (DELAY) await wait(DELAY);
    if (BROKEN && /products|market/.test(u.pathname)) { res.writeHead(500).end("no"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(/products|market|coldwater/.test(u.pathname) ? feedFor(GEN) : { p: {} }));
  }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  for (const c of [f, f + ".html"]) {
    try { const b = await readFile(join("public", c));
      res.writeHead(200, { "content-type": MIME[extname(c)] || "application/octet-stream" }); return res.end(b); } catch {}
  }
  res.writeHead(404).end("no");
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
const ctl = (q) => fetch(`http://127.0.0.1:${PORT}/ctl?${q}`).then((r) => r.text());

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llfeedcache" });
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
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* Google Fonts and Big Cartel at the network layer: the proxies these containers
   run behind refuse both, and a render-blocking <link> that stalls reads as a
   broken page. public/engine.js calls a real merchant without this. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const go = async () => { await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await until(async () => { if (await ev(`document.readyState==='interactive'||document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`); };
const pids = () => ev(`[].map.call(document.querySelectorAll('#grid .card[data-pid]'),function(c){return c.getAttribute('data-pid')})`);
const genOf = async (g) => ((await pids()) || []).filter((p) => String(p).indexOf(g + "-") === 0).length;
const anyCards = async () => ((await pids()) || []).length;

/* ---------------------------------------------------------------- */
console.log("\n-- a cold visit writes the shelf it was served --");
await ctl("delay=0&gen=g1&broken=0");
await go();
await ev(`localStorage.removeItem('ll_feed_cache_v1')`);
await go();
await until(async () => { if ((await genOf("g1")) > 0) return true; throw 0 }, 80);
await wait(700);
ok("the live feed renders", (await genOf("g1")) > 0, (await genOf("g1")) + " g1 cards");
const stored = await ev(`(function(){var e=window.LL_feedCache.read();
  return e? {n:e.products.length, at:!!e.at, gal:e.products.filter(function(p){return 'gallery' in p}).length, first:e.products[0].id, meta:!!e.meta} : null})()`);
ok("the response was cached", !!stored && stored.n === 40, stored ? stored.n + " products" : "nothing stored");
ok("the cache carries a timestamp and the feed's meta", !!stored && stored.at && stored.meta);
ok("gallery is dropped on the way in", !!stored && stored.gal === 0, stored ? stored.gal + " kept a gallery" : "");

/* ---------------------------------------------------------------- */
console.log("\n-- THE CONTROL: no cache, slow feed, and the seed is what you get --");
await ctl("delay=2500&gen=g2&broken=0");
await go();
await ev(`localStorage.removeItem('ll_feed_cache_v1')`);
await go();
await wait(1400);   /* well past GRACE_MS (450), well short of the feed */
const seedCount = await anyCards();
const seedFixture = (await genOf("g1")) + (await genOf("g2"));
ok("the grid is not blank while the feed is in flight", seedCount > 0, seedCount + " cards");
ok("and none of them come from the feed -- this is the engine's own seed",
   seedFixture === 0, seedFixture + " fixture cards");
const seedPids = ((await pids()) || []).slice(0, 3).join(",");
await until(async () => { if ((await genOf("g2")) > 0) return true; throw 0 }, 80);
ok("the feed still lands when it arrives", (await genOf("g2")) > 0, "seed was " + seedPids);

/* ---------------------------------------------------------------- */
console.log("\n-- the same slow feed, with last visit's shelf in hand --");
/* g2 is now cached (the visit above finished). Serve g3 slowly: whatever is on
   screen at 1.4s can only have come from storage. */
await ctl("delay=2500&gen=g3&broken=0");
await go();
await wait(1400);
const early2 = await genOf("g2"), early3 = await genOf("g3");
ok("the cached shelf is up instead of the seed", early2 > 0, early2 + " g2 cards");
ok("and it is not the network -- that has not answered yet", early3 === 0, early3 + " g3 cards");
/* THE ORDERING, ASSERTED ON A FIELD ONLY THE CACHED PAYLOAD COULD HAVE FILLED.
   feed-meta keys `desc` by product id, so an entry for g2-0 can only have come
   from the response this shim served -- the network is still 1.1s away. Wrap
   these two the other way round and desc is built from the live feed instead,
   which is rails counting a catalogue that is not on screen. */
const metaEarly = await ev(`(function(){var m=window.LL_META||{};
  return {dom:Object.keys(m.domains||{}).length, g2:!!(m.desc&&m.desc['g2-0']), g3:!!(m.desc&&m.desc['g3-0'])}})()`);
ok("feed-meta wrapped the shim, so the rails describe what is on screen",
   !!metaEarly && metaEarly.dom > 0 && metaEarly.g2 && !metaEarly.g3,
   metaEarly ? JSON.stringify(metaEarly) : "no LL_META");
/* And the live response still refreshes storage for next time. */
await wait(2200);
const after = await ev(`(function(){var e=window.LL_feedCache.read(); return e? e.products[0].id : null})()`);
ok("the network response overwrites the cache for next time", String(after).indexOf("g3-") === 0, String(after));

/* ---------------------------------------------------------------- */
console.log("\n-- a fast feed still wins, so nothing changes on a good connection --");
await ctl("delay=0&gen=g4&broken=0");
await go();
await until(async () => { if ((await anyCards()) > 0) return true; throw 0 }, 80);
await wait(700);
ok("the live catalogue is what renders", (await genOf("g4")) > 0, (await genOf("g4")) + " g4 cards");
ok("and the stale one is not on screen beside it", (await genOf("g3")) === 0);

/* ---------------------------------------------------------------- */
console.log("\n-- ?refresh is never answered from a cache --");
await ctl("delay=1500&gen=g5&broken=0");
const refreshed = await ev(`(async function(){var t0=Date.now();
  var r=await fetch('/api/products?refresh'); var j=await r.json();
  return {ms:Date.now()-t0, first:j.products[0].id}})()`);
ok("it waited for the server rather than answering instantly",
   refreshed && refreshed.ms > 1200, refreshed ? refreshed.ms + "ms" : "no result");
ok("and it returned the live catalogue", refreshed && String(refreshed.first).indexOf("g5-") === 0, refreshed && refreshed.first);

/* ---------------------------------------------------------------- */
console.log("\n-- a dispensary path is neither read from nor written to this key --");
await ctl("delay=1500&gen=g6&broken=0");
const town = await ev(`(async function(){var t0=Date.now();
  var r=await fetch('/api/market?town=coldwater'); var j=await r.json();
  return {ms:Date.now()-t0, first:j.products[0].id}})()`);
ok("a city feed is not served from the hemp cache", town && town.ms > 1200, town ? town.ms + "ms" : "no result");
const keyAfterTown = await ev(`(function(){var e=window.LL_feedCache.read(); return e? e.products[0].id : null})()`);
ok("and it did not overwrite it either", String(keyAfterTown).indexOf("g6-") !== 0, String(keyAfterTown));

/* ---------------------------------------------------------------- */
console.log("\n-- the generated shelves do not share the hemp shelf's cache --");
/* THE ONE THAT IS EASY TO GET WRONG. /devices does not fetch a different route:
   tools/make-shelf.mjs repoints THIS path to /api/products?shelf=devices, so the
   pathname is identical and only the query separates gear from flower. Keyed on
   the path alone, a visit to a shelf page decides what the hemp shelf shows on
   the next slow load -- the wrong catalogue under the right heading. */
await ctl("delay=1500&gen=g6a&broken=0");
const shelf = await ev(`(async function(){var t0=Date.now();
  var r=await fetch('/api/products?shelf=devices'); var j=await r.json();
  return {ms:Date.now()-t0, first:j.products[0].id}})()`);
ok("a shelf slice is not answered from the whole shelf's cache", shelf && shelf.ms > 1200, shelf ? shelf.ms + "ms" : "no result");
ok("and it returns its own slice", shelf && String(shelf.first).indexOf("g6a-") === 0, shelf && shelf.first);
const ring = await ev(`(function(){var all=window.LL_feedCache.all();
  return {keys:Object.keys(all).sort(), home:(window.LL_feedCache.read()||{}).products[0].id}})()`);
ok("the two are stored under separate keys",
   !!ring && ring.keys.indexOf("/api/products") > -1 && ring.keys.indexOf("/api/products?shelf=devices") > -1,
   ring ? ring.keys.join(" ") : "");
ok("and the shelf slice did not become the hemp shelf's cache",
   !!ring && String(ring.home).indexOf("g6a-") !== 0, ring && ring.home);
/* Bounded, or six shelves would spend the whole origin budget on catalogues
   nobody is looking at. */
const ringN = await ev(`(async function(){
  for (var i=0;i<5;i++) await fetch('/api/products?shelf=s'+i+'&refresh');
  return Object.keys(window.LL_feedCache.all()).length})()`);
ok("the ring is bounded", ringN <= 3, ringN + " entries");

/* ---------------------------------------------------------------- */
console.log("\n-- the network failing outright is the case the seed handles worst --");
/* Primed here rather than relying on an earlier section: the ring above is
   bounded at MAX_ENTRIES and those five shelf writes evict the hemp key, which
   is the ring doing its job and would read here as the fallback failing. */
await ctl("delay=0&gen=g7&broken=0");
await go();
await until(async () => { if ((await genOf("g7")) > 0) return true; throw 0 }, 80);
await wait(600);
await ctl("delay=0&gen=g7&broken=1");
await go();
await wait(1600);
const brokeCached = await genOf("g7");
ok("a 500 still leaves last visit's catalogue on the shelf", brokeCached > 0, brokeCached + " cached cards");
ok("a bad day does not evict a good catalogue",
   (await ev(`(function(){var e=window.LL_feedCache.read(); return e? e.products.length : 0})()`)) === 40);
await ctl("broken=0");

/* ---------------------------------------------------------------- */
console.log("\n-- and a stale cache is not served forever --");
await ctl("delay=2500&gen=g8&broken=0");
await go();
await ev(`(function(){var all=window.LL_feedCache.all();
  for(var k in all) all[k].at = Date.now() - 7*60*60*1000;
  localStorage.setItem('ll_feed_cache_v1', JSON.stringify(all));})()`);
ok("a cache older than six hours is refused", (await ev(`window.LL_feedCache.read()===null`)) === true);

ok("no page exceptions", errs.length === 0, errs.slice(0, 2).join(" | "));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall good");
process.exit(fails.length ? 1 : 0);

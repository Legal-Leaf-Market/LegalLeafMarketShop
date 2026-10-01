/* The satellites, rebuilt on the engine.

   /consumables, /devices and /international were three hand-written pages of
   ~120KB each that fetched /api/products and then rendered their own cards,
   their own store and category filters, their own sort, their own cart drawer
   and their own checkout link. None of the engine. So every improvement to the
   shelf -- the three rails, the card flip, the photo viewer, the sentences on
   the back, price-per-gram ranking, the eight gear buckets -- stopped at `/`.

   THE SLICE IS THE ONLY DIFFERENCE, and it lives in api/shelves.js. Each page
   is now index.html plus a fetch shim that repoints /api/products to
   ?shelf=<slug>, applied SERVER-SIDE.

   WHAT THIS PINS, and why each is its own kind of check:

   1. THE SLICE IS RIGHT, driven through the real handler. The predicates were
      measured off the pages they replace rather than invented, and getting one
      backwards puts flower on the devices shelf, which looks like a
      classification bug and is not one.

   2. THE SHIM WRAPS feed-meta.js RATHER THAN BEING WRAPPED BY IT. Both patch
      fetch; source order decides which sees the url first. Wrong way round and
      the rails count the whole site while the grid shows a slice -- a chip
      saying 1,218 above a grid holding 300, which is exactly the drift every
      rail is written to avoid.

   3. THE CART DIVERGENCE, from the hemp side. A city page says "Add to
      Shopping List" and has no checkout; these keep the Legal-Leaf cart. They
      inherit it from index.html, so this notices if a source edit takes it.

     node test-shelves.mjs
*/
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
process.env.LL_NO_STORE_FETCH = "1";
const { SHELVES, shelfFor, shelfGroup } = await import("./api/shelves.js");
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

const CHROME = chromePath();
const PORT = 3501, CDP = 9355;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

console.log("\nThe satellites, rebuilt on the engine\n");

group("THE REGISTRY IS THE ONLY PLACE A SHELF IS NAMED");
/* Same rule as ONE_CORE.md's: one `if (shelf === "devices")` anywhere else is
   invisible in every test, because every other shelf keeps passing. */
const { readFileSync, readdirSync } = await import("node:fs");
const offenders = [];
for (const f of readdirSync("api")) {
  if (!f.endsWith(".js") || f === "shelves.js") continue;
  const t = readFileSync(join("api", f), "utf8");
  /* PROSE IS NOT A COMPARISON. The rule is about code branching on a shelf name;
     a comment that happens to mention one is not that. api/products.js documents
     a store's `international` field -- whether the shop ships worldwide, which
     long predates and has nothing to do with the /international shelf -- inside a
     block comment, and the backticks around it matched. One registry slug
     colliding with one store property was enough to make this read as an
     architecture violation.
     Only block comments and whole-line // comments are stripped. A general //
     stripper would cut the 1,681 https:// URLs in these files in half, and could
     hide a real offender behind one -- a guard that silently stops guarding is a
     worse outcome than the false positive it was fixing. */
  const code = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const s of SHELVES) {
    const re = new RegExp('["\'`]' + s.slug + '["\'`]');
    if (re.test(code)) offenders.push(f + " names " + s.slug);
  }
}
ok("no api/ file outside the registry compares against a shelf name",
   offenders.length === 0, offenders.join(", "));

group("THE SLICE, THROUGH THE REAL HANDLER");
/* Every product lands on exactly one of the two group shelves -- the split is
   a partition, not a pair of overlapping guesses -- while international cuts
   across both, because shipping is orthogonal to what the thing is. */
const SAMPLE = [
  { name: "Flower", cannabinoid: "THCa", intl: false },
  { name: "Gummy", cannabinoid: "CBD", intl: false },
  { name: "Grinder", cannabinoid: "Accessory", intl: false },
  { name: "Intl grinder", cannabinoid: "Accessory", intl: true },
  { name: "Intl tincture", cannabinoid: "CBD", intl: true },
];
const cons = SAMPLE.filter(shelfFor("consumables").test).map(p => p.name);
const dev = SAMPLE.filter(shelfFor("devices").test).map(p => p.name);
const intl = SAMPLE.filter(shelfFor("international").test).map(p => p.name);
ok("consumables is everything that is not gear", cons.join() === "Flower,Gummy,Intl tincture", cons.join());
ok("devices is the gear", dev.join() === "Grinder,Intl grinder", dev.join());
ok("...and the two partition the catalogue", cons.length + dev.length === SAMPLE.length,
   cons.length + " + " + dev.length + " = " + SAMPLE.length);
ok("international cuts across both, because shipping is not a category",
   intl.join() === "Intl grinder,Intl tincture", intl.join());
ok("the group a product carries agrees with the shelf that claims it",
   SAMPLE.every(p => (shelfGroup(p) === "cons") === shelfFor("consumables").test(p)));

group("AND IN A BROWSER");
/* A feed with one of each, so a shelf showing the wrong slice is unmistakable
   rather than a count that could be a filter. Priced to clear the Ounce+ and
   $75 defaults the shop front opens on. */
function prod(id, name, cann, intl) {
  return {
    id, name, store: cann === "Accessory" ? "Gear Shop" : "Flower Shop",
    storeKey: cann === "Accessory" ? "gear" : "flower", domain: "e.test", platform: "shopify",
    cannabinoid: cann, category: cann === "Accessory" ? "Grinders" : "THCA Flower",
    type: "Indica", strain: name, image: "/favicon.svg", url: "https://e.test/p/" + id,
    brand: "B", brandKey: "b", description: "Sentences.", intl: !!intl,
    inStock: true, startsAt: 25, sale: 25, perG: cann === "Accessory" ? null : 0.89,
    ship: 5, badges: [],
    sizes: [[cann === "Accessory" ? "One Size" : "1 oz", 25, cann === "Accessory" ? 0 : 28,
             id + "s", true, "https://e.test/p/" + id, "", 0]]
  };
}
const ALL = [
  prod("f1", "Alpha Gelato", "THCa", false),
  prod("f2", "Beta Kush", "THCa", false),
  prod("g1", "Zeta Grinder", "Accessory", false),
  prod("g2", "Intl Grinder", "Accessory", true),
];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
let served = [];
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/products") {
    /* The REAL slicing rule, exercised the way the handler does it. */
    const sh = u.searchParams.get("shelf");
    served.push(sh || "(none)");
    const s = sh ? shelfFor(sh) : null;
    const rows = s ? ALL.filter(s.test) : ALL;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ meta: { updated: new Date(0).toISOString(), total: rows.length, stores: [] }, products: rows }));
  }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "") + (extname(u.pathname) ? "" : ".html");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llshelves" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const pg = j.find(x => x.type === "page"); if (!pg) throw 0; return pg; });
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const p = new Map(); const errs = [];
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

async function goto(path) {
  /* Two navigations: the first only exists to set the age-gate flag. The
     counter is reset AFTER it, or "asked once" counts one request per page
     load and reads as a caching bug in working code. */
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`);
  served = [];
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
  await wait(900);
}
const names = () => ev(`[].map.call(document.querySelectorAll('#grid .card .cname'),function(n){return n.textContent.trim()})`);

for (const [path, want, notWant] of [
  ["/consumables", /Alpha Gelato|Beta Kush/, /Zeta Grinder/],
  ["/devices", /Zeta Grinder|Intl Grinder/, /Alpha Gelato/],
]) {
  await goto(path);
  const n = await names();
  const feedRows = n.filter(x => /Alpha|Beta|Zeta|Intl/.test(x));
  console.log("  " + path + " feed rows: " + (feedRows.join(" | ") || "(none)"));
  ok(path + " shows its own slice", feedRows.some(x => want.test(x)), feedRows.join(" | "));
  ok("...and none of the other one", !feedRows.some(x => notWant.test(x)), feedRows.join(" | "));
  /* The whole point of slicing server-side: the request itself carries it. */
  ok("...asked the server for the slice, rather than filtering after the fact",
     served.every(x => x === path.slice(1)), served.join(","));
  /* One request, still: the shim repoints, feed-meta memoises. */
  ok("...and asked once", served.length === 1, served.length + " requests");
  /* GREEK GLASS IS NOT FROM THE FEED AND IS EXCLUDED FROM THE COUNT. The claim
     here is that LL_META describes THIS SHELF rather than the whole catalogue,
     and it is made about the feed. Greek Glass is deliberately kept out of
     /api/products (CLAUDE.md section 7) and reaches the page as the engine's
     baked cross-sell, so feed-meta.js fills its domain from that seed -- it has
     a chip on this rail and would otherwise be the only shop drawing a monogram
     instead of its own mark. Counting it here would make the assertion fail for
     a shop the slice was never about. */
  const meta = await ev(`(function(){var m=window.LL_META||{};
    var d=Object.keys(m.domains||{}).filter(function(k){return k!=="Greek Glass";});
    return {stores:d.length,brands:Object.keys(m.brands||{}).length,
            gg:!!(m.domains||{})["Greek Glass"]};})()`);
  ok("...so the rails were built from this shelf, not the whole site",
     meta.stores > 0 && meta.stores <= 1, JSON.stringify(meta));
  /* And the fill itself is asserted rather than merely tolerated, so the
     exclusion above cannot quietly become a licence for real drift. */
  ok("...with the one shop the feed cannot describe still given its mark",
     meta.gg === true, JSON.stringify(meta));
}

group("WHAT THE OLD PAGES COULD NOT DO");
await goto("/devices");
/* OUR OWN PRODUCT, NOT "THE FIRST CARD". The opening shelf is dealt out now
   (public/js/shelf-shuffle.js), so position one is whichever shop and category
   the rotation landed on -- which on a gear shelf is usually one of the 85
   baked Greek Glass seed products, and those carry no description. */
ok("the card flip is here", await ev(`!!document.querySelector('#grid .card')`) &&
   (await ev(`(function(){
     var c=[].filter.call(document.querySelectorAll('#grid .card'),function(x){
       var n=x.querySelector('.cname'); return n && /Zeta Grinder|Intl Grinder/.test(n.textContent);})[0];
     if(!c) return 0; c.scrollIntoView({block:"center"});
     /* .cimg, not .cname. The card is two targets now -- the picture flips and
        the body opens /p/<id> -- so clicking the name here navigates off the
        shelf, and every assertion after it reads a product page while reporting
        that the flip is missing. */
     var t=c.querySelector('.cimg')||c; t.click();
     return document.querySelectorAll('#grid .card.on').length;})()`)) === 1);
ok("...and the back carries the product's sentences",
   /Sentences/.test(await ev(`(document.querySelector('#grid .card.on .llb-desc')||{}).textContent||""`)));
await ev(`(function(){var b=document.querySelector('#grid .card.on .llb-turn'); if(b) b.click();})()`);
ok("the store rail is here", (await ev(`document.querySelectorAll('#storeLogos .lchip').length`)) > 0);
ok("the category rail is here", (await ev(`document.querySelectorAll('#catLogos .lchip').length`)) > 0);
ok("the photo viewer is here", await ev(`!!document.querySelector('#grid .card .cw-expand')`));

group("THE CART DIVERGENCE, FROM THE HEMP SIDE");
const buttons = await ev(`Array.from(new Set([].map.call(document.querySelectorAll('#grid .card .addbtn'),
  function(b){return (b.textContent||"").trim()})))`);
console.log("  buttons: " + JSON.stringify(buttons));
ok("a shelf keeps the Legal-Leaf cart", buttons.some(b => /Legal-Leaf Cart/i.test(b)), buttons.join(" | "));
ok("...and never says Shopping List, which belongs to a city page",
   !buttons.some(b => /Shopping List/i.test(b)), buttons.join(" | "));

ok("no uncaught errors on any shelf", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : "All assertions passed.") + "\n");
try { s.close() } catch {}
ch.kill(); srv.close();
process.exit(fails.length ? 1 : 0);

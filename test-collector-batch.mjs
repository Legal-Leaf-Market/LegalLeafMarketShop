/* What makes two captured rows the SAME product, in a real browser and again on
 * the server. One question, two places that answer it, and they had drifted.
 *
 * THE BUG THIS EXISTS FOR. The batch was keyed by product NAME. THCA Small Buds
 * sells one strain as several listings, so its /collections/thca-products runs
 * to hundreds of rows over about 170 distinct titles -- and the operator paging
 * through it watched the count stop dead at 170 while every further page
 * replaced rows instead of adding them. Reported as "capping out at 170 and not
 * saving from page to page", which reads like storage failing or pages being
 * missed. Neither: two different products were being read as one.
 *
 * readIngest() deduped by name as well, so fixing only the browser would have
 * moved the cap one step downstream and left the number identical.
 *
 * WHAT MUST NOT REGRESS IN FIXING IT. Keying on the link is wrong for the two
 * layers that have no link: the rendered-page and printed-text readers fall
 * back to location.href, and captureToProduct() falls back to the store's home
 * page. Key on those and a whole menu collapses into ONE row -- the same
 * failure an order of magnitude worse, and it would look like a working
 * capture. So a url carrying more than one name is not an identity, and the
 * fixtures here include a page that has exactly that shape.
 *
 * Google Fonts are blocked at the network layer -- the proxies in the
 * containers this repo is edited from refuse them, and the render-blocking
 * <link> otherwise stalls ~13s and makes a working page look broken
 * (CLAUDE.md section 10).
 *
 * Run: node test-collector-batch.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { captureKeyer, normUrl } from "./api/coldwater-ingest.js";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
const CHROME = chromePath();
const PORT = 3488, CDP = 9377, SHOP = 3489;
const TOKEN = "test-token-not-a-real-secret";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* ---- 1. the keying rule on its own ---------------------------------------- */
console.log("\ncaptureKeyer — what counts as the same product\n");

const sameName = [
  { name: "Blue Dream", url: "https://s.com/products/blue-dream-smalls" },
  { name: "Blue Dream", url: "https://s.com/products/blue-dream-premium" },
];
{
  const k = captureKeyer(sameName);
  ok("two listings sharing a title are two products", k(sameName[0]) !== k(sameName[1]),
     `${k(sameName[0])} vs ${k(sameName[1])}`);
}
{
  /* The overlap readIngest's dedupe exists for: "Shop All" and "Flower" both
     carry the same product, and it must stay one row. */
  const rows = [
    { name: "Gelato", url: "https://s.com/products/gelato?_pos=3&_sid=ab" },
    { name: "Gelato", url: "https://s.com/products/gelato/" },
  ];
  const k = captureKeyer(rows);
  ok("the same link twice is one product, tracking params and slash ignored",
     k(rows[0]) === k(rows[1]), k(rows[0]));
}
{
  /* A DOM capture: every row carries the page it was read from. */
  const page = "https://s.com/collections/all";
  const rows = [{ name: "Runtz", url: page }, { name: "Zkittlez", url: page }, { name: "MAC 1", url: page }];
  const k = captureKeyer(rows);
  const keys = new Set(rows.map(k));
  ok("a url shared by several names is a page, not an identity", keys.size === 3, [...keys].join(" "));
}
{
  /* captureToProduct() falls back to the store's home page when a row has no
     link of its own -- declared ambiguous by the caller for the same reason. */
  const home = "https://thcasmallbuds.com";
  const rows = [{ name: "A", url: home }, { name: "B", url: home }];
  const k = captureKeyer([], { alsoAmbiguous: [home] });
  ok("a declared store home never keys a product", k(rows[0]) !== k(rows[1]), `${k(rows[0])} vs ${k(rows[1])}`);
}
ok("normUrl drops query, hash and trailing slash",
   normUrl("HTTPS://S.com/products/x/?v=1#buy") === "https://s.com/products/x",
   normUrl("HTTPS://S.com/products/x/?v=1#buy"));

/* ---- a Shopify collection that repeats titles across its pages ------------ */
const PER = 12, PAGES = 4;
/* Five titles over 48 products, which is the shape that produced the cap:
   many more listings than distinct names. */
const TITLES = ["Blue Dream", "Gelato", "Runtz", "Wedding Cake", "Sour Diesel"];
const productsFor = (page) => Array.from({ length: PER }, (_, i) => {
  const n = (page - 1) * PER + i;
  return {
    id: 1000 + n,
    title: TITLES[n % TITLES.length] + " Small Buds",
    /* A GROWER PER LISTING, and it is load-bearing rather than decoration.
       mergeListings() in api/coldwater.js deliberately gathers listings that
       agree on name + category + brand back into ONE card, because several of
       these menus publish one product per weight and a shelf of one-option
       cards is what that produces. Its dedupeRows() then keeps the cheapest row
       per label -- correct when each listing carried a DIFFERENT weight, and
       lossy when they carried the same weights at different prices.

       So a fixture whose rows share a title AND have no brand cannot tell the
       two bugs apart: the display merge and the capture-time name collapse both
       come out as "5 of 48". Distinct growers keep the listings distinct
       through the merge, which is what leaves readIngest's keying observable --
       and it is the realistic shape anyway, since these shops list one strain
       from several growers. 5 titles x 12 growers over 48 products, and
       lcm(5,12) = 60, so every (title, grower) pair here is unique. */
    vendor: "Grower " + (n % 12),
    url: "/products/sb-" + n,
    images: ["https://cdn.example.com/sb-" + n + ".jpg"],
    /* Bulk weights, which is what this shop sells and what nothing could read:
       QP and LB returned 0 g, so not one row carried a weight. */
    variants: [
      { title: "1 oz", price: 49.99 },
      { title: "QP", price: 179.99 },
      { title: "1 LB", price: 599.99 },
    ],
  };
});
const SHOP_PAGE = (n) =>
  '<!doctype html><html><head><title>THCa Products</title></head><body><h1>THCa Products</h1>' +
  /* DECLARES ITSELF SHOPIFY, the way a real Shopify store does. Detection no
     longer accepts a /collections/ path as proof: thca4cheap is WooCommerce
     serving Shopify-style /collections/ URLs from a migration, and reading the
     URL as the platform sent it down the Shopify branch, which found nothing
     and fell silently through to the page scan. */
  '<script>window.Shopify={shop:"fixture.myshopify.com"};' +
  'window.__COLLECTION__={products:' + JSON.stringify(productsFor(n)) + '};</script>' +
  '</body></html>';

/* THE LONG THIN ARRAY, which is what THCA Small Buds actually served. Page
   state carries a summary of every product -- name, link, one flat price, no
   photo, no description, no weights -- alongside a shorter array holding the
   real thing. "Largest wins" took the summary, so the capture came back at 371
   bytes a row with withGrams:0 for the whole store: no price-per-gram, no
   ranking, no best-$/g badge, off a page whose weights were present the whole
   time.

   The decoy matters as much: a recommendations rail is product-shaped too, and
   an implementation that UNIONS instead of enriching puts its rows on the shelf
   as products this page never listed. */
const THIN = Array.from({ length: 30 }, (_, i) => ({
  title: "Strain " + i + " Small Buds", url: "/products/thin-" + i, price: 49.99 + i,
}));
const RICH = THIN.slice(0, 18).map((t, i) => ({
  title: t.title, url: t.url, images: ["https://cdn.example.com/" + i + ".jpg"],
  body_html: "<p>Premium indoor THCa small buds.</p>", product_type: "THCa Flower",
  variants: [{ title: "1 oz", price: 49.99 + i }, { title: "QP", price: 179 + i }, { title: "1 LB", price: 599 + i }],
}));
const RAIL = Array.from({ length: 6 }, (_, i) => ({
  title: "Recommended Gummies " + i, url: "/products/rec-" + i, price: 19.99,
}));
const SPLIT_PAGE =
  '<!doctype html><html><head><title>Split state</title></head><body><h1>THCa Products</h1>' +
  '<script>window.__SUMMARY__={products:' + JSON.stringify(THIN) + '};' +
  'window.__DETAIL__={items:' + JSON.stringify(RICH) + '};' +
  'window.__RECS__={products:' + JSON.stringify(RAIL) + '};</script></body></html>';

/* A menu with no structured data at all, so every row is read off the rendered
   page and carries no link of its own. Distinct products, one url. */
const DOM_PAGE =
  '<!doctype html><html><head><title>Plain shop</title></head><body><h1>Menu</h1><div class="grid">' +
  [["Purple Punch", "$32.00"], ["Gelato 41", "$38.00"], ["Blue Dream", "$30.00"], ["Runtz", "$42.00"]]
    .map(r => '<div class="card"><img src="/i.jpg"><h3>' + r[0] + '</h3>' +
      '<div class="row"><span>3.5g</span><span>' + r[1] + '</span></div></div>').join("") +
  '</div></body></html>';

let FEED_ON = false;   // a shop with no product feed is the fallback path
const shopSrv = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  /* A WOOCOMMERCE STORE, serving Shopify-style /collections/ URLs -- which is
     what thca4cheap actually is, a migration leftover. Detection reading the URL
     as the platform sent it down the Shopify branch, found nothing, and fell
     through to the page scan, which on a marketing page read 23 pseudo-products
     out of nav and breadcrumbs. The Store API quotes money in MINOR UNITS. */
  if (u.pathname === "/wp-json/wc/store/v1/products") {
    const page = Number(u.searchParams.get("page") || 1);
    const isVar = u.searchParams.get("type") === "variation";
    res.writeHead(200, { "content-type": "application/json" });
    if (page > 1) return res.end("[]");
    if (isVar) {
      const vars = [];
      for (let i = 0; i < 7; i++) for (const [lab, cents] of [["1 oz", 4999], ["QP", 17999], ["1 LB", 59999]])
        vars.push({ id: 900 + vars.length, parent: 100 + i,
                    variation: "Weight: " + lab, is_in_stock: lab !== "1 LB",
                    prices: { price: String(cents), currency_minor_unit: 2 } });
      return res.end(JSON.stringify(vars));
    }
    return res.end(JSON.stringify(Array.from({ length: 7 }, (_, i) => ({
      id: 100 + i, name: "Woo Strain " + i, slug: "woo-" + i,
      permalink: "http://127.0.0.1:" + SHOP + "/product/woo-" + i,
      description: "<p>Indoor.</p>", is_in_stock: true,
      categories: [{ name: "THCa Flower" }],
      images: [{ src: "https://cdn.example.com/woo" + i + ".jpg" }],
      prices: { price: "4999", currency_minor_unit: 2 },
    }))));
  }
  /* THE SHOP'S OWN PRODUCT FEED, deliberately BIGGER than any one page shows.
     This is the number three rounds of "still 170" had no way to establish:
     whether the count in the panel is a cap or is the whole shop. 60 here
     against 48 captured, so the panel must say 12 are still to capture --
     and must not congratulate the operator for finishing. */
  /* THE COLLECTION'S OWN FEED, smaller than the store's. thcasmallbuds
     publishes 165 store-wide and 118 in /collections/thca-products, so a count
     taken against the store tells an operator capturing the collection that 47
     rows are missing which do not exist. 40 here against 60 store-wide. */
  if (u.pathname === "/collections/thca-products/products.json") {
    const page = Number(u.searchParams.get("page") || 1);
    const per = Number(u.searchParams.get("limit") || 250);
    const all = Array.from({ length: 40 }, (_, i) => ({ id: i, handle: "c" + i }));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ products: all.slice((page - 1) * per, page * per) }));
  }
  if (u.pathname === "/feed-on" || u.pathname === "/feed-off") {
    FEED_ON = u.pathname === "/feed-on";
    res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok");
  }
  if (u.pathname === "/products.json" && !FEED_ON) {
    res.writeHead(404, { "content-type": "text/plain" }); return res.end("no feed");
  }
  if (u.pathname === "/products.json") {
    const page = Number(u.searchParams.get("page") || 1);
    /* Real Shopify shape: the variant TITLE is the size label, and the same
       strain appears under several handles -- which is the shape that capped a
       name-keyed batch and which a handle-keyed feed reads correctly. */
    const all = Array.from({ length: 60 }, (_, i) => ({
      id: i, handle: "p" + i, title: TITLES[i % TITLES.length] + " Small Buds",
      vendor: "Grower " + (i % 12), product_type: "THCa Flower",
      body_html: "<p>Indoor small buds.</p>",
      images: [{ src: "https://cdn.example.com/p" + i + ".jpg" }],
      variants: [{ title: "1 oz", price: "49.99", available: true },
                 { title: "QP", price: "179.99", available: true },
                 { title: "1 LB", price: "599.99", available: false }],
    }));
    const per = Number(u.searchParams.get("limit") || 250);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ products: all.slice((page - 1) * per, page * per) }));
  }
  res.writeHead(200, { "content-type": "text/html" });
  if (u.pathname.startsWith("/woo")) return res.end(
    '<!doctype html><html><head><title>Woo shop</title>' +
    '<link rel="https://api.w.org/" href="/wp-json/"></head>' +
    '<body class="woocommerce archive"><h1>Shop</h1>' +
    '<script src="/wp-content/themes/x.js"></script></body></html>');
  if (u.pathname.startsWith("/plain")) return res.end(DOM_PAGE);
  if (u.pathname.startsWith("/split")) return res.end(SPLIT_PAGE);
  res.end(SHOP_PAGE(Number(u.searchParams.get("page") || 1)));
});
await new Promise(r => shopSrv.listen(SHOP, r));

/* ---- boot the site + browser ---------------------------------------------- */
const srv = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(PORT), LL_ADMIN_TOKEN: TOKEN }, stdio: "ignore" });
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_cwbatch" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find(x => x.type === "page"); if (!p) throw 0; return p; });
await until(() => fetch(`http://127.0.0.1:${PORT}/api/coldwater`).then(r => { if (!r.ok) throw 0; return r }));

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
const evp = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });

const runCollector = async () => {
  await evp(`new Promise(function(res){var s=document.createElement('script');s.src='http://127.0.0.1:${PORT}/coldwater-collector.js?'+Date.now();s.onload=function(){res(1)};s.onerror=function(){res(0)};document.body.appendChild(s)})`);
  await wait(450);
  return String(await ev(`(document.getElementById('ll-collector')||{}).innerText||''`));
};
const clearBatch = () => ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
const batchRows = () => ev(`(function(){var k=Object.keys(localStorage).filter(function(x){return x.indexOf('ll_collector_batch')===0&&!/:at$/.test(x)})[0];
  return Object.keys(JSON.parse(localStorage.getItem(k)||'{}')).length})()`);
const batchRowList = async () => JSON.parse(await ev(
  `(function(){var k=Object.keys(localStorage).filter(function(x){return x.indexOf('ll_collector_batch')===0&&!/:at$/.test(x)})[0];
   var b=JSON.parse(localStorage.getItem(k)||'{}');return JSON.stringify(Object.keys(b).map(function(x){return b[x]}))})()`));

/* ---- 2. paging through the collection ------------------------------------- */
console.log(`\nthe collector — paging a ${PAGES}x${PER} collection over ${TITLES.length} titles\n`);

let panelText = "", parsedPageOne = [];
/* SCOPED TO THE HOST NOW, not to host + two path segments -- a shop is a host,
   and the old scope gave /collections/a and /collections/b different batches,
   which is what "changing screens loses what you grabbed" was. These fixtures
   deliberately share one host, so each section clears first; real use wants
   exactly the opposite and gets it. */
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/collections/thca-products?page=1` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await clearBatch();
for (let n = 1; n <= PAGES; n++) {
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/collections/thca-products?page=${n}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  panelText = await runCollector();
  const rows = await batchRows();
  ok(`page ${n} adds its rows to the batch (${rows})`, rows === n * PER, `want ${n * PER}`);
  if (n === 1) parsedPageOne = await batchRowList();
}
/* Snapshotted here, because the legacy-batch section below deliberately
   replaces what is in storage. */
const parsed = await batchRowList();
ok("the batch is not capped at the number of distinct titles",
   (await batchRows()) === PAGES * PER, `${await batchRows()} rows, ${TITLES.length} titles`);
ok("the panel reports what this page contributed", /\+\d+ new from this page/.test(panelText),
   (panelText.split("\n").find(l => /new from this page|Nothing new/.test(l)) || "").slice(0, 60));
ok("bulk weights read, so price-per-gram can compute",
   new RegExp(`${PAGES * PER} carry a weight`).test(panelText),
   (panelText.split("\n").find(l => /carry a weight/.test(l)) || "").slice(0, 60));
ok("the batch survives navigation between pages", (await ev(
   `Object.keys(localStorage).filter(function(x){return x.indexOf('ll_collector_batch')===0&&!/:at$/.test(x)}).length`)) === 1);
/* WHICH BUILD ANSWERED, on screen and in the copied diagnostics. A bookmarklet
   points at whichever origin it was dragged from and is kept for months, so
   "the fix is not working" and "the fixed file never ran" arrive looking
   identical. This is the field that separates them, and it cost a full round
   trip to learn that. */
ok("the panel names the build and the origin that served it",
   /Collector \S+ from 127\.0\.0\.1:/.test(panelText),
   (panelText.split("\n").find(l => /^Collector /.test(l)) || "").slice(0, 70));
ok("collector threw nothing", errs.length === 0, errs.join(" | ").slice(0, 160));

/* ---- 2b. a batch left behind by the old collector -------------------------
   The operator who reported the cap has one of these in their tab. Keyed by
   bare name, it merges with nothing: the same product read again keys as
   "u:<link>", finds no entry, and is added a second time. The count jumps,
   which looks like the fix working, and half the batch is duplicates. */
console.log("\na batch written by the previous collector\n");
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/collections/thca-products?page=1` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
{
  /* Exactly what the old code wrote: keys are lowercased names, so the twelve
     rows of page 1 arrive as five. */
  await clearBatch();
  const legacy = {};
  for (const p of parsedPageOne) legacy[String(p.name).trim().toLowerCase()] = p;
  const legacyCount = Object.keys(legacy).length;
  ok("the old shape really did collapse a page to its titles", legacyCount === TITLES.length,
     `${legacyCount} keys for ${PER} products`);
  await ev(`localStorage.setItem(Object.keys(localStorage).filter(function(x){return x.indexOf('ll_collector_batch')===0&&!/:at$/.test(x)})[0]
    || 'll_collector_batch:127.0.0.1:${SHOP}', ${JSON.stringify(JSON.stringify(legacy))})`);
  const text = await runCollector();
  const rows = await batchRows();
  ok("a legacy batch is re-keyed rather than duplicated", rows === PER, `${rows} rows, want ${PER}`);
  ok("and the rows it already held were kept, not discarded", !/Nothing new/.test(text) || rows === PER);
}

/* ---- 2c. changing screens must not lose the batch -------------------------
   The reported symptom, in its own words: "sometimes when you change screens it
   doesn't bring along what you already grabbed". Two independent causes, and
   neither is a storage failure -- the rows were written correctly and filed
   where the next run does not look, which is worse, because it reads as data
   loss and cannot be recovered by trying again.

   1. The batch was keyed by host + the first TWO path segments, so on a Shopify
      store /collections/a and /collections/b were different shops, and a
      product page was a third. Paging one collection grew a batch that clicking
      into a product appeared to erase.
   2. It lived in sessionStorage, which is per TAB. Any link that opens a new
      tab -- or reopening the menu after closing it -- started from nothing. No
      amount of re-keying fixes that one. */
console.log("\nchanging screens — the batch has to come with you\n");
{
  await clearBatch();
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/collections/thca-products?page=1` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await runCollector();
  const first = await batchRows();

  /* A DIFFERENT COLLECTION on the same shop. Same batch, or the operator is
     capturing into a bucket they cannot get back to. */
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/collections/thca-flower?page=2` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  const carried = await batchRows();
  ok("a different collection on the same shop keeps the batch", carried === first,
     `${carried} rows there, ${first} here`);
  await runCollector();
  ok("and a run there adds to it rather than starting over", (await batchRows()) > first,
     `${await batchRows()} rows`);

  /* A PRODUCT PAGE, which is where the two-segment key broke hardest: every
     product had its own batch. */
  const before = await batchRows();
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/products/sb-3` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  ok("a product page keeps it too", (await batchRows()) === before, `${await batchRows()} of ${before}`);

  /* AND A NEW TAB. sessionStorage cannot do this at all. */
  const tab = await fetch(`http://127.0.0.1:${CDP}/json/new?` + encodeURIComponent(`http://127.0.0.1:${SHOP}/collections/thca-products`),
    { method: "PUT" }).then(r => r.json()).catch(() => null);
  if (tab && tab.webSocketDebuggerUrl) {
    const s2 = new globalThis.WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => s2.addEventListener("open", r));
    let id2 = 0; const p2 = new Map();
    s2.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && p2.has(m.id)) { p2.get(m.id)(m); p2.delete(m.id) } });
    const send2 = (method, params = {}) => new Promise(r => { const i = ++id2; p2.set(i, r); s2.send(JSON.stringify({ id: i, method, params })) });
    await send2("Runtime.enable");
    const inTab = await until(async () => {
      const v = (await send2("Runtime.evaluate", { expression:
        `Object.keys(localStorage).filter(function(x){return x.indexOf('ll_collector_batch')===0&&!/:at$/.test(x)}).map(function(k){return Object.keys(JSON.parse(localStorage.getItem(k)||'{}')).length})[0]||0`,
        returnByValue: true })).result?.result?.value;
      if (v == null) throw 0;
      return v;
    }, 40);
    ok("a NEW TAB on the same shop sees the batch", inTab === before, `${inTab} of ${before}`);
    s2.close();
  } else {
    ok("a NEW TAB on the same shop sees the batch", false, "could not open a second tab");
  }
  await clearBatch();
}

/* ---- 2e. the shop's own feed beats reading its markup --------------------
   A live audit measured /collections/thca-products at 118 products while this
   collector reported 170. The 52 extras are the header menu, the footer and the
   "recommended" carousel: product-shaped, on every page, and still there after
   the grid empties. No amount of care with selectors separates them, because on
   the page they ARE the same thing. Where a shop publishes its catalogue, that
   list is the shelf. */
console.log("\nthe shop's own feed\n");
{
  await fetch(`http://127.0.0.1:${SHOP}/feed-on`);
  await clearBatch();
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/collections/thca-products?page=1` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await runCollector();
  const txt = await until(async () => {
    const t = String(await ev(`(document.getElementById('ll-collector')||{}).innerText||''`));
    if (/own product feed/.test(t)) return t;
    throw 0;
  }, 40);
  const rows = await batchRows();
  ok("the feed's count is the catalogue, not what the page happened to show",
     rows === 60, `${rows} rows, feed publishes 60`);
  ok("and the panel says where it came from", /the complete catalogue/.test(txt),
     (txt.split("\n").find(l => /own product feed/.test(l)) || "").slice(0, 90));
  const list = await batchRowList();
  ok("weights read from the variant labels, including the bulk ones",
     list.every(p => p.sizes.some(z => z.grams === 448)), `${list.filter(p => p.sizes.some(z => z.grams === 448)).length}/60 carry a pound`);
  ok("photos and vendors came across", list.every(p => p.image && p.brand), "");
  /* Handle-keyed, so one strain under several handles stays several products --
     the exact shape that capped a name-keyed batch at its distinct-title count. */
  ok("repeated titles under distinct handles stay distinct products",
     new Set(list.map(p => p.name)).size < list.length,
     `${new Set(list.map(p => p.name)).size} titles over ${list.length} products`);
  ok("a sold-out variant is marked per row, not per product",
     list.every(p => p.sizes.some(z => z.inStock === false)), "");
  await fetch(`http://127.0.0.1:${SHOP}/feed-off`);
  await clearBatch();
}

/* ---- 2f. WooCommerce, which had no path at all --------------------------- */
console.log("\nthe WooCommerce Store API\n");
{
  await clearBatch();
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/woo/collections/thca-products` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await runCollector();
  const txt = await until(async () => {
    const t = String(await ev(`(document.getElementById('ll-collector')||{}).innerText||''`));
    if (/wc\/store\/v1|own product feed/.test(t)) return t;
    throw 0;
  }, 40);
  const list = await batchRowList();
  ok("a Woo store is read through its Store API", list.length === 7, `${list.length} rows`);
  ok("and the panel names that source", /wc\/store\/v1/.test(txt),
     (txt.split("\n").find(l => /feed/.test(l)) || "").slice(0, 80));
  /* MINOR UNITS: 4999 is $49.99, and reading it as dollars is the 100x error. */
  ok("money is read as minor units, not dollars",
     list.every(p => p.sizes.some(z => Math.abs(z.price - 49.99) < 0.01)),
     JSON.stringify((list[0] || {}).sizes || []).slice(0, 90));
  /* Without the variation sweep a variable product publishes its price_range
     minimum as one flat "One Size" row -- the size bug, three times diagnosed. */
  ok("the variation sweep ran, so sizes are real", list.every(p => p.sizes.length === 3),
     `${list.filter(p => p.sizes.length === 3).length}/7 carry three sizes`);
  ok("weights come from the variation label", list.every(p => p.sizes.some(z => z.grams === 448)));
  ok("a sold-out variation is marked per row", list.every(p => p.sizes.some(z => z.inStock === false)));
  ok("every row carries a real product link", list.every(p => /\/product\/woo-/.test(p.url || "")),
     String((list[0] || {}).url));
  await clearBatch();
}

/* ---- 3. the same rows, through the server -------------------------------- */
const postIt = (body) => fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, {
  method: "POST", headers: { "content-type": "application/json", "x-ll-admin-token": TOKEN },
  body: JSON.stringify(body),
}).then(r => r.json());

console.log("\nthe server — the flattener must not put the cap back\n");
await postIt({ storeKey: "banzen", reset: true });
const stored = await postIt({ storeKey: "banzen", collection: "thca-products", products: parsed });
ok("every captured row was stored", stored.stored === PAGES * PER, `${stored.stored} of ${PAGES * PER}`);

const shelf = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const mine = (shelf.products || []).filter(x => x.storeKey === "banzen" || /banzen/i.test(x.store || ""));
ok("readIngest keeps them distinct on the way back out", mine.length === PAGES * PER,
   `${mine.length} of ${PAGES * PER} reached the shelf`);
ok("and price-per-gram computed for them", mine.filter(x => x.perG > 0).length === mine.length,
   `${mine.filter(x => x.perG > 0).length} of ${mine.length}`);

/* The overlap the dedupe genuinely exists for: re-capturing the same products
   under a second collection must not double the shelf. */
await postIt({ storeKey: "banzen", collection: "shop-all", products: parsed });
const shelf2 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const mine2 = (shelf2.products || []).filter(x => x.storeKey === "banzen" || /banzen/i.test(x.store || ""));
ok("a second collection carrying the same products does not duplicate them",
   mine2.length === PAGES * PER, `${mine2.length} of ${PAGES * PER}`);

/* ---- 4. the layer with no link per row ----------------------------------- */
console.log("\nthe rendered-page layer — no link per row, and it must still be many products\n");
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/plain` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
const domText = await runCollector();
const domRows = await batchRows();
ok("a DOM-read page does not collapse into one row", domRows === 4, `${domRows} rows`);
ok("read off the rendered page, as expected", /rendered page/.test(domText),
   (domText.split("\n").find(l => /Source|rendered/.test(l)) || "").slice(0, 60));

await postIt({ storeKey: "banzen", reset: true });
const domCap = JSON.parse(await ev(`(function(){var k=Object.keys(localStorage).filter(function(x){return x.indexOf('ll_collector_batch')===0&&!/:at$/.test(x)})[0];
  var b=JSON.parse(localStorage.getItem(k)||'{}');return JSON.stringify(Object.keys(b).map(function(x){return b[x]}))})()`));
await postIt({ storeKey: "banzen", collection: "plain", products: domCap });
const shelf3 = await (await fetch(`http://127.0.0.1:${PORT}/api/coldwater`)).json();
const mine3 = (shelf3.products || []).filter(x => x.storeKey === "banzen" || /banzen/i.test(x.store || ""));
ok("and survives the server as four products, not one", mine3.length === 4, `${mine3.length} rows`);

/* ---- 5. a long thin array beside a short rich one ------------------------ */
console.log("\npage state split across arrays — the biggest is not the best\n");
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/split` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`Object.keys(localStorage).filter(function(k){return k.indexOf('ll_collector_batch')===0}).forEach(function(k){localStorage.removeItem(k)})`);
await runCollector();
const split = await batchRowList();
const named = (n) => split.find(p => p.name === n);
ok("the long array still decides which products exist", split.length === THIN.length,
   `${split.length} rows, want ${THIN.length}`);
ok("a product-shaped rail is NOT added to the shelf",
   !split.some(p => /^Recommended Gummies/.test(p.name)),
   split.filter(p => /Recommended/.test(p.name)).length + " rail rows leaked");
ok("weights arrive from the richer array",
   split.filter(p => p.sizes.some(s => s.grams > 0)).length === RICH.length,
   `${split.filter(p => p.sizes.some(s => s.grams > 0)).length} of ${RICH.length} carry a weight`);
ok("and the flat one-price row was replaced, not appended",
   (named("Strain 0 Small Buds") || {}).sizes?.length === 3,
   JSON.stringify((named("Strain 0 Small Buds") || {}).sizes || []).slice(0, 90));
ok("the pound reads as 448 g, so per-gram is right",
   ((named("Strain 0 Small Buds") || {}).sizes || []).some(s => s.grams === 448));
ok("photos and descriptions came across too",
   split.filter(p => p.image).length === RICH.length && split.filter(p => p.description).length === RICH.length,
   `${split.filter(p => p.image).length} images, ${split.filter(p => p.description).length} descriptions`);
ok("a row the rich array never covered is left alone, not invented",
   (named("Strain 25 Small Buds") || {}).sizes?.length === 1 && !(named("Strain 25 Small Buds") || {}).image);

await postIt({ storeKey: "banzen", reset: true });
console.log("\n" + (fails.length ? `FAILED (${fails.length}): ${fails.join(", ")}` : "All assertions passed.") + "\n");
srv.kill(); ch.kill(); shopSrv.close();
process.exit(fails.length ? 1 : 0);

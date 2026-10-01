/* "I need all sites to do a true checkout button. Not all sites are currently triggering
 * one, including THCA Small Buds."
 *
 * Drives the REAL api/products.js normalizers (via realistic stubbed upstream responses, one
 * per platform shape actually in use by an enabled store) into the REAL public/index.html
 * engine in a real headless browser, and for every currently-ENABLED store asserts that adding
 * an item to the cart and opening the drawer produces a working checkout trigger: a real
 * add-to-cart href for Shopify/WooCommerce stores, or the documented bookmarklet-handoff
 * button for the one store (THCa Hempire) where no direct link can exist at all (BigCommerce +
 * a required Strain option no URL can pre-fill -- same reason Greek Glass gets one).
 *
 * Every product below is produced by the REAL handler from a REAL per-platform upstream shape,
 * the same way test-cbdhempdirect.mjs already does for one store -- a hand-typed product
 * fixture can silently diverge from what api/products.js actually emits (sizes-row shape,
 * variantId, platform, cartDomain...), and this is exactly the class of bug that would slip
 * past one.
 *
 * Run: node test-checkout-links.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";
import handler, { STORES } from "./api/products.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

const money = (cents) => ({ price: String(cents), regular_price: String(cents), currency_minor_unit: 2, currency_code: "USD" });
const json = (body, headers) => ({ ok: true, status: 200, headers: headers ? new Headers(headers) : { get: () => null }, text: async () => JSON.stringify(body) });
const notFound = () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "not found" });

/* ---- Shopify fixture: a realistic products.json page ---- */
function shopifyJson(store, n) {
  const products = [];
  for (let i = 0; i < n; i++) {
    const isAcc = !!store.accessory;
    products.push({
      id: 800000 + i, handle: store.key + "-item-" + i,
      title: isAcc ? ("Test Grinder " + i) : ("Test Strain " + i + " THCa Flower"),
      tags: [isAcc ? "grinder" : "flower"], body_html: "<p>Test listing.</p>",
      product_type: isAcc ? "Grinder" : "Flower", vendor: store.name,
      published_at: "2026-01-01T00:00:00Z",
      images: [{ src: "https://cdn.shopify.com/s/files/1/" + store.key + i + ".jpg", variant_ids: [] }],
      variants: [
        { id: 900000 + i * 10 + 1, title: isAcc ? "One Size" : "3.5g", price: "25.00", compare_at_price: null, available: true },
        { id: 900000 + i * 10 + 2, title: isAcc ? "Blue" : "28g", price: "120.00", compare_at_price: "150.00", available: true },
      ],
    });
  }
  return { products };
}

/* ---- WooCommerce fixture: Store API parent + variations, same shape as test-cbdhempdirect.mjs ---- */
function wooFixture(store, n) {
  const parents = [], variations = [];
  for (let i = 0; i < n; i++) {
    const pid = 150000 + i * 10;
    parents.push({
      id: pid, name: "Test Flower " + i, slug: store.key + "-flower-" + i,
      permalink: "https://" + store.domain + "/products/" + store.key + "-flower-" + i,
      type: store.wooVariations ? "variable" : "simple", is_in_stock: true,
      date_created: "2026-01-05T00:00:00",
      prices: { ...money(3353), price_range: { min_amount: "3353", max_amount: "11499" } },
      categories: [{ name: "THCa Flower" }], tags: [],
      attributes: store.wooVariations ? [{ id: 1, name: "Net Weight", taxonomy: "pa_net-weight", has_variations: true,
        terms: [{ id: 11, name: "7 Grams", slug: "7-grams" }, { id: 12, name: "28 Grams", slug: "28-grams" }] }] : [],
      short_description: "Test listing.", description: "Test listing.",
      images: [{ src: "https://" + store.domain + "/wp-content/uploads/" + store.key + i + ".jpg" }],
      weight: "40",
    });
    if (store.wooVariations) {
      variations.push({ id: pid + 1, parent: pid, variation: "Net Weight: 7 Grams", prices: money(3353),
        is_in_stock: true, images: [], attributes: [{ name: "Net Weight", value: "7-grams" }] });
      variations.push({ id: pid + 2, parent: pid, variation: "Net Weight: 28 Grams", prices: money(11499),
        is_in_stock: true, images: [], attributes: [{ name: "Net Weight", value: "28-grams" }] });
    }
  }
  return { parents, variations };
}

/* ---- BigCommerce fixture: HTML card markup matching parseBcCards()'s regex ---- */
function bigCommerceHtml(store, n) {
  let cards = "";
  for (let i = 0; i < n; i++) {
    cards += `<h3 class="card-title"><a href="https://${store.domain}/products/test-hempire-${i}/">Test Hempire Flower ${i}</a></h3>` +
      `<div data-product-price-without-tax>$30.00</div>` +
      `<img data-src="https://cdn1.bigcommerce.com/s-x/products/${i}/1/test.jpg">`;
  }
  return `<section>${cards}</section>`;
}

const enabled = STORES.filter(s => s.enabled !== false);
console.log("enabled stores:", enabled.map(s => s.key).join(", "));

const wooByStore = {};
enabled.filter(s => (s.platform === "woocommerce") || (s.platform === "auto" && s.preferWoo))
  .forEach(s => { wooByStore[s.domain] = wooFixture(s, 2); });

/* Stood down as soon as the real handler returns (see below): this stub only needs to answer
   the scraper's own fetch() calls, and leaving it in place would swallow launchChrome()'s own
   fetch to Chrome's /json/version endpoint, which reads as "no Chromium would start" -- a
   browser problem that is actually this file's own fetch mock still installed. */
const realFetch = globalThis.fetch;
/* THIS SUITE STANDS THE NO-REAL-STORE GUARD DOWN, and substitutes a stronger one, the
   same trade test-cbdhempdirect.mjs makes and for the same reason. LL_NO_STORE_FETCH
   makes api/products.js refuse at its fetch chokepoint, which is right for every suite
   that boots the real server -- but this one drives the REAL handler and needs it to
   reach the stub one line down. Left set, the handler refuses before fetch is ever
   called and every store scrapes zero products, which reads as a broken scraper rather
   than as a guard doing its job: all 16 stores failed "at least one product scraped
   from the stub" while the suite passed perfectly on a machine that had never exported
   the variable. The workflow sets it for every job, so this could only ever have been
   red in CI, and CI has not scheduled a runner since 21 Aug.
   A fetch replaced on the next line cannot touch a real merchant at all, which is what
   the flag is for. Deleted here rather than at the top of the file, because
   api/products.js reads it PER CALL: the stub and the standing-down arrive together, so
   there is no window in which this suite could make a real request. Restored with the
   real fetch below, so nothing after the scrape inherits a lowered guard. */
delete process.env.LL_NO_STORE_FETCH;
globalThis.fetch = async (url) => {
  const u = String(url);
  const host = (() => { try { return new URL(u).host; } catch { return ""; } })();
  const store = enabled.find(s => s.domain === host);
  if (!store) return notFound();

  if (u.includes("/products.json")) {
    if (store.platform !== "shopify" && !(store.platform === "auto" && !store.preferWoo)) return notFound();
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    return page === 1 ? json(shopifyJson(store, 2)) : json({ products: [] });
  }
  if (u.includes("/wp-json/wc/store/v1/products")) {
    const fx = wooByStore[store.domain];
    if (!fx) return notFound();
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    if (u.includes("type=variation")) return json(page === 1 ? fx.variations : [], { "x-wp-total": String(fx.variations.length) });
    return json(page === 1 ? fx.parents : [], { "x-wp-total": String(fx.parents.length) });
  }
  if (store.platform === "bigcommerce") {
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => (page === 1 ? bigCommerceHtml(store, 2) : "<section></section>") };
  }
  return notFound();
};

let payload = null;
await handler({ query: {} }, { setHeader() {}, status() { return this; }, json(b) { payload = b; return this; } });
globalThis.fetch = realFetch;
process.env.LL_NO_STORE_FETCH = "1";   /* guard back up the moment the stub comes down */
console.log("scrape drops:", JSON.stringify(payload.dropped || {}));
console.log("total products scraped:", (payload.products || []).length);

const FEED = { meta: { updated: new Date(0).toISOString(), total: (payload.products || []).length, stores: [] }, products: payload.products || [] };
for (const s of enabled) {
  const got = FEED.products.filter(p => p.storeKey === s.key).length;
  ok(`${s.key}: at least one product scraped from the stub`, got > 0, `${got} products`);
}

/* ---- Serve the real feed + real public/ via a tiny http server ---- */
const PORT = 3505, CDP = 9357;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/products") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(FEED)); }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const f = u.pathname.replace(/^\//, "") || "index.html";
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_checkoutlinks" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find(x => x.type === "page"); if (!p) throw 0; return p; });
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = [];
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* Google Fonts stalls the render-blocking <link> for ~13s in this proxy (CLAUDE.md section 10);
   bigcartel.com is the live Greek Glass refresh public/engine.js fires on every page load. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`localStorage.setItem('ll_age_ok','1')`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
await wait(500);

const cardCount = await ev(`document.querySelectorAll('#grid .card').length`);
ok("engine painted the grid", cardCount > 0, `${cardCount} cards`);

/* Reset the search box so no store's card is hidden behind a stale query. */
await ev(`(function(){var q=document.getElementById('q'); if(q){q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
await wait(300);

/* Add ONE item per store to the cart, by selecting the store in #fStore and clicking every
   addbtn on screen while that filter is active. This reaches every store's card regardless of
   pagination or the grid's default sort, without depending on any one store's category surviving
   the default filters (Ounce+/$75 budget only bite THCa flower rows; accessory rows never do). */
for (const st of enabled) {
  await ev(`(function(){var s=document.getElementById('fStore'); if(!s) return;
    var opt=[].find.call(s.options,function(o){return o.textContent.indexOf(${JSON.stringify(st.name)})>=0;});
    if(opt){ s.value=opt.value; s.dispatchEvent(new Event('change',{bubbles:true})); }})()`);
  await wait(250);
  await ev(`[].forEach.call(document.querySelectorAll('#grid .card .addbtn'), function(b){ if(!b.disabled) b.click(); })`);
  await wait(150);
}
await ev(`(function(){var s=document.getElementById('fStore'); if(s){ s.value=''; s.dispatchEvent(new Event('change',{bubbles:true})); }})()`);
await wait(300);

const cartRaw = await ev(`localStorage.getItem('ll_cart')`);
const cart = JSON.parse(cartRaw || "[]");
console.log("cart size:", cart.length, "stores in cart:", [...new Set(cart.map(i => i.store))].join(", "));
for (const st of enabled) ok(`${st.key}: an item reached the cart`, cart.some(i => i.storeKey === st.key));

await ev(`document.getElementById('openCart').click()`);
await wait(600);

const rendered = await ev(`[].map.call(document.querySelectorAll('a.checkout, button.checkout'), function(a){ return {tag:a.tagName, text:(a.textContent||'').trim(), href:a.getAttribute('href'), rel:a.getAttribute('rel')}; })`);
console.log("rendered checkout triggers:\n" + JSON.stringify(rendered, null, 2));

/* THCa Hempire is the one store with no direct link possible at all: BigCommerce plus a required
   Strain option no URL can pre-fill, so it gets the same bookmarklet-handoff modal as Greek
   Glass (which is not in STORES/api/products.js at all -- it is loaded client-side). */
const HANDOFF = new Set(["thcahempire"]);

for (const st of enabled) {
  const trig = rendered.find(r => r.text === `Checkout at ${st.name} →` || r.text.indexOf(st.name) >= 0);
  if (HANDOFF.has(st.key)) {
    ok(`${st.key}: documented bookmarklet-handoff button rendered`, !!(trig && trig.tag === "BUTTON"), JSON.stringify(trig));
    continue;
  }
  ok(`${st.key}: a checkout ANCHOR rendered (not just a button, and not nothing)`, !!(trig && trig.tag === "A" && trig.href), JSON.stringify(trig));
  if (!trig || trig.tag !== "A" || !trig.href) continue;
  const href = trig.href;
  if (st.platform === "woocommerce" || (st.platform === "auto" && st.preferWoo)) {
    ok(`${st.key}: woo href adds to cart (not a bare product page)`, /add-to-cart=/.test(href), href);
    if (st.refParam && st.ref) ok(`${st.key}: woo href carries its own ref param (${st.refParam})`, href.includes(st.refParam + "="), href);
  } else if (st.platform === "shopify" || (st.platform === "auto" && !st.preferWoo)) {
    const wantHost = st.cartDomain || st.domain;
    ok(`${st.key}: shopify href targets a real /cart/ permalink`, /\/cart\/\d+:1/.test(href), href);
    ok(`${st.key}: shopify href host is the CART host, not just the display domain`, href.indexOf("https://" + wantHost + "/cart/") === 0, `want host ${wantHost}, got ${href}`);
    if (st.ref) ok(`${st.key}: shopify href carries its ref param (${st.refParam || "ref"})`, href.includes((st.refParam || "ref") + "="), href);
    if (st.coupon) ok(`${st.key}: shopify href carries its discount code`, href.includes("discount=" + encodeURIComponent(st.coupon)), href);
  }
}

/* EVERY PAID LINK SAYS SO. These all carry an affiliate parameter -- ref,
   sca_ref, sld, rfsn -- so Google asks for rel="sponsored" on every one of
   them, and the engine emits rel="noopener" alone.

   THE STAMP HAS TO LAND ON ALL OF THEM, WHICH IS THE ONLY INTERESTING PART.
   ll-checkout-fix returns early for every store whose href the engine already
   builds correctly, which is most of them, so a stamp written lower in that
   loop marks a handful of links and leaves the majority bare -- indistinguishable
   from working code unless the assertion counts. This one counts. */
{
  const anchors = rendered.filter(r => r.tag === "A" && /^https?:/.test(r.href || ""));
  ok("there are outbound merchant links to check", anchors.length > 0, anchors.length + " links");
  const unmarked = anchors.filter(r => !/\bsponsored\b/.test(r.rel || ""));
  ok("every outbound merchant link is marked sponsored", unmarked.length === 0,
     unmarked.map(r => r.text + " rel=" + JSON.stringify(r.rel)).join(" | "));
  const unsafe = anchors.filter(r => !/\bnoopener\b/.test(r.rel || ""));
  ok("...and none lost noopener on the way", unsafe.length === 0,
     unsafe.map(r => r.text).join(" | "));
}

ok("no uncaught errors", errs.length === 0, errs.join(" | ").slice(0, 500));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

/* test-shop-dispensary.mjs -- the Shopify dispensary shelf (public/shop-dispensary.js) in real Chromium.
 *
 * Serves a bare page carrying the same mount the Shopify page template does, with data-api pointed
 * at a stub feed. Pins what the owner asked for on 14 Nov 2026:
 *   - no sold-out size in any dropdown, and no product whose every size (or inStock) is sold out;
 *   - cards flip to a back face with the description, and a mouse leaving flips them back;
 *   - three switchable views (Shelf / Menu board / Dashboard) and a "pick your size" row that
 *     drives all three;
 *   - no horizontal page overflow at 390px in any view.
 * The stub never reaches a real shop: data-api points at this server.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3561, CDP = 9681;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x !== "" ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await wait(150); } throw new Error("timeout"); }

const STORES = { thcasmallbuds: "THCA Small Buds", puffweiser: "Puffweiser", blacktiecbd: "Black Tie CBD" };
function prod(key, i) {
  const base = 20 + i * 3;
  const sizes = [
    ["3.5g", base, 3.5, key + i + "a", true, null],
    ["7g", base * 1.8, 7, key + i + "b", i % 2 === 0, null],          // every other product: the quarter is sold out
    ["1 oz", base * 5, 28, key + i + "c", true, base * 6],
  ].map((r) => r.map((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)));
  return {
    id: key + "-" + i, name: STORES[key] + " Strain " + i, store: STORES[key], storeKey: key, domain: key + ".test",
    platform: "shopify", cannabinoid: "THCa", category: i % 4 === 3 ? "Pre-rolls" : "THCA Flower",
    type: ["Indica", "Sativa", "Hybrid", ""][i % 4], grow: "Indoor", potency: 20 + i, image: "/favicon.svg",
    url: "https://" + key + ".test/products/s" + i, description: "<p>Back-face sentence for " + key + " " + i + ".</p>",
    lineage: i === 0 ? { parents: ["Gelato", "Runtz"], stated: "Gelato x Runtz" } : null,
    lab: i === 0 ? { terps: [["Limonene", 0.82], ["Myrcene", 0.41]] } : null,
    inStock: true, ship: 0, badges: [], added: 1000 + i, sizes,
  };
}
function feed(key) {
  const ps = Array.from({ length: 10 }, (_, i) => prod(key, i));
  ps.push({ ...prod(key, 90), id: key + "-gone", name: "SOLDOUT " + key, inStock: false });
  const allGone = prod(key, 91); allGone.id = key + "-rows-gone"; allGone.name = "ROWSGONE " + key;
  allGone.sizes = allGone.sizes.map((r) => { r = r.slice(); r[4] = false; return r; });
  ps.push(allGone);
  return { products: ps, meta: {} };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#000}</style></head><body>
<div id="ll-dispensary" data-stores="thcasmallbuds,puffweiser,blacktiecbd" data-api="http://127.0.0.1:${PORT}/api/products"></div>
<script src="/shop-dispensary.js" defer></script></body></html>`;

const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/products") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify(feed(u.searchParams.get("store"))));
  }
  if (u.pathname === "/shop-dispensary.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(await readFile("public/shop-dispensary.js")); }
  if (u.pathname === "/favicon.svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(await readFile("public/favicon.svg")); }
  res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE);
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_lldisp" });
const t = await until(async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === "page"));
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = [];
s.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const click = (sel) => ev(`(function(){var b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
await send("Runtime.enable"); await send("Page.enable");

async function boot(width) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await until(() => ev(`document.querySelectorAll('#ll-dispensary .lld-card,#ll-dispensary .lld-tk,#ll-dispensary .lld-table tbody tr').length>0`));
}

console.log("\n-- in stock only --");
await boot(1280);
await ev(`localStorage.clear()`); await boot(1280);
const opts = await ev(`[].map.call(document.querySelectorAll('#ll-dispensary .lld-card select option'),function(o){return o.textContent})`);
ok("cards carry size dropdowns", opts.length > 0, opts.length);
ok("no dropdown option is sold out", opts.every((o) => !/sold out/i.test(o)));
const p1 = await ev(`(function(){var c=[].filter.call(document.querySelectorAll('.lld-card'),function(c){return /Small Buds Strain 1$/.test(c.querySelector('.lld-name').textContent)})[0];return c?[].map.call(c.querySelectorAll('select option'),function(o){return o.textContent}):null})()`);
ok("a product with its quarter sold out offers only the sizes it has", p1 && p1.length === 2 && !p1.some((o) => /^7g/.test(o)), JSON.stringify(p1));
const names = await ev(`document.getElementById('ll-dispensary').textContent`);
ok("an inStock:false product is not on the shelf", !/SOLDOUT/.test(names));
ok("a product whose every size is sold out is not on the shelf", !/ROWSGONE/.test(names));
ok("there is no 'In stock only' toggle to undo it", !(await ev(`!!document.querySelector('[data-f=stock]')`)));

console.log("\n-- flip --");
await click(".lld-card .lld-front .lld-foot .lld-flipbtn");
await wait(700);
ok("Flip turns the card", await ev(`document.querySelector('.lld-card').classList.contains('is-flipped')`));
const backTxt = await ev(`document.querySelector('.lld-card .lld-back').innerText`);
ok("the back carries the description", /Back-face sentence/.test(backTxt), backTxt.slice(0, 60));
ok("the back face is what is visible", await ev(`getComputedStyle(document.querySelector('.lld-card .lld-front')).visibility==='hidden'`));
const h = await ev(`(function(){var c=document.querySelectorAll('.lld-card');return [c[0].getBoundingClientRect().height,c[1].getBoundingClientRect().height]})()`);
ok("a flipped card stays the height of its row", Math.abs(h[0] - h[1]) < 2, h.join(" vs "));
/* a real mouse: onto the card, then off it */
const r = await ev(`(function(){document.querySelector('.lld-card').scrollIntoView({block:'center'});var b=document.querySelector('.lld-card').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2,b.right]})()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] });
await wait(100);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
await wait(900);
ok("moving the mouse away flips it back", !(await ev(`document.querySelector('.lld-card').classList.contains('is-flipped')`)));
await click(".lld-card .lld-media");
await wait(100);
ok("tapping the photo flips it too", await ev(`document.querySelector('.lld-card').classList.contains('is-flipped')`));
await click(".lld-card .lld-unflip");
ok("Back flips it home", !(await ev(`document.querySelector('.lld-card').classList.contains('is-flipped')`)));
const lin = await ev(`(function(){var c=[].filter.call(document.querySelectorAll('.lld-card'),function(c){return /Small Buds Strain 0$/.test(c.querySelector('.lld-name').textContent)})[0];return c?c.querySelector('.lld-back').innerText:''})()`);
ok("lineage and terpenes reach the back", /Gelato/.test(lin) && /Limonene/.test(lin), lin.replace(/\s+/g, " ").slice(0, 120));

console.log("\n-- pick your size --");
await click('.lld-jar[data-size="7"]');
const prices = await ev(`[].map.call(document.querySelectorAll('.lld-card'),function(c){return c.querySelector('.lld-sz').textContent})`);
ok("7 g shows only products that have a quarter in stock", prices.length === 15 && prices.every((x) => x === "7g"), prices.length + " cards");
ok("and no per-card dropdown fights the jar", !(await ev(`!!document.querySelector('.lld-card select')`)));
await click('.lld-jar[data-size="28"]');
ok("28 g matches every ounce", (await ev(`document.querySelectorAll('.lld-card').length`)) === 24);
const sortedPg = await ev(`[].map.call(document.querySelectorAll('.lld-card .lld-pg'),function(e){return parseFloat(e.textContent.slice(1))})`);
ok("sorted by $/g at that size", sortedPg.every((v, i) => i === 0 || v >= sortedPg[i - 1]), sortedPg.slice(0, 5).join(","));
ok("budtender picks: one per shop", (await ev(`document.querySelectorAll('.lld-pick').length`)) === 3);

console.log("\n-- menu board --");
await click('.lld-view[data-view="board"]');
ok("board has a column per shop", (await ev(`document.querySelectorAll('.lld-col').length`)) === 3);
await click('.lld-grp[data-g="price"]');
const cols = await ev(`[].map.call(document.querySelectorAll('.lld-col h4'),function(e){return e.textContent})`);
ok("columns by price band", cols.length >= 2 && cols.every((c) => /\$/.test(c)), cols.join(" | "));
await click('.lld-grp[data-g="type"]');
const tcols = await ev(`[].map.call(document.querySelectorAll('.lld-col h4'),function(e){return e.textContent})`);
ok("columns by strain type", tcols.join() === "Indica,Hybrid,Sativa,Other", tcols.join());
await click(".lld-tk .lld-add");
ok("a ticket adds to the cart", JSON.parse(await ev(`localStorage.getItem('ll_cart')`)).length === 1);

console.log("\n-- dashboard --");
await click('.lld-jar[data-size=""]');
await click('.lld-view[data-view="table"]');
ok("tiles render", (await ev(`document.querySelectorAll('.lld-tile').length`)) === 5);
ok("every in-stock product is a row", (await ev(`document.querySelectorAll('.lld-table tbody tr').length`)) === 30);
await click('.lld-th[data-s="cheap"]');
const tp = await ev(`[].map.call(document.querySelectorAll('.lld-table td.pr'),function(e){return parseFloat(e.textContent.slice(1))})`);
ok("header sorts by price", tp.every((v, i) => i === 0 || v >= tp[i - 1]));
await click('.lld-th[data-s="cheap"]');
const tp2 = await ev(`[].map.call(document.querySelectorAll('.lld-table td.pr'),function(e){return parseFloat(e.textContent.slice(1))})`);
ok("again reverses it", tp2.every((v, i) => i === 0 || v <= tp2[i - 1]));
ok("no sold-out option in the table either", (await ev(`[].every.call(document.querySelectorAll('.lld-table option'),function(o){return !/sold out/i.test(o.textContent)})`)));

console.log("\n-- remembered, and fits a phone --");
await boot(390);
ok("the view is remembered", await ev(`!!document.querySelector('.lld-table')`));
for (const v of ["table", "board", "cards"]) {
  await click(`.lld-view[data-view="${v}"]`);
  await wait(100);
  const w = await ev(`document.documentElement.scrollWidth`);
  ok(`no horizontal page scroll at 390px: ${v}`, w <= 390, w);
}
ok("no script errors", errs.length === 0, errs.join(" | "));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
process.exit(fails.length ? 1 : 0);

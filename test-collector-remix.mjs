/* test-collector-remix.mjs — the browser twin of test-dude-remix.mjs, plus the
 * three navigation shapes that are not paging.
 *
 *   node test-collector-remix.mjs
 *
 * WHY THIS EXISTS. `remixRoots()`/`balancedEnd()`/`rscRoots()` are supposed to
 * exist TWICE -- in api/coldwater.js and again in public/coldwater-collector.js
 * -- because a static file served onto a dispensary's origin cannot import from
 * api/. `remixRoots` was written on the server and never ported, so The Dude
 * Abides read richly on the scheduled lane and as FIVE ROWS on the operator's,
 * and nothing anywhere reported a disagreement. test-dude-remix.mjs pins the
 * server copy; this pins the browser copy, against the same shapes.
 *
 * THE FIXTURE IS BUILT TO BREAK THE TEMPTING IMPLEMENTATION, the same way the
 * server's is:
 *
 *   - the menu arrives as CAROUSELS OF TWELVE, so "largest array wins" reports a
 *     twelve-product dispensary and looks like a success;
 *   - a PRICE-TIER TABLE sits beside them -- {name:"Ounce (28g)", weight, price}
 *     -- which satisfies every test for a product and is longer than any single
 *     carousel, so length-alone picks it and reports five rows;
 *   - the deferred call's JSON is the THIRD argument, after two strings, one of
 *     which carries a bracket and an escaped quote to break a lazy scan;
 *   - the products sit NINE LEVELS DEEP, past the old depth-8 guard.
 *
 * And three navigation shapes that are each other's opposites: a load-more
 * button APPENDS rows, a pager REPLACES them, a tab switches catalogue.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";
const SHOP_PORT = 3498;
const fails = [];
const ok = (c, m, x = "") => {
  if (c) console.log("  ok   " + m + (x ? "   (" + x + ")" : ""));
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

/* ------------------------------------------------------------- the fixture --- */

const product = (name, variant, price) => ({
  name: name + " - " + variant,
  product_name: name,
  variant_name: variant,
  price,
  brand: "Test Brand",
  category: "Flower",
  image: "https://img.test/" + encodeURIComponent(name) + ".jpg",
  weight: "3.5",
  quantity: 4,
});

/* Fourteen carousels of twelve, overlapping on purpose — the same jar appears in
   several by design, which is why the union has to dedupe rather than concat. */
const carousels = [];
for (let c = 0; c < 14; c++) {
  carousels.push({
    name: "Carousel " + c, carousel_id: "id-" + c, total: 1449, limit: 12, offset: 0,
    products: Array.from({ length: 12 }, (_, i) => product("Strain " + ((c * 6 + i) % 40), "Bulk", 30 + i)),
  });
}
const DISTINCT_STRAINS = 40;

/* The weight table that won outright on length alone. */
const tiers = [
  { name: "Gram (1g)", weight: 1, price: 1000 },
  { name: "Two Grams (2g)", weight: 2, price: 1800 },
  { name: "Eighth (3.5g)", weight: 3.5, price: 3000 },
  { name: "Quarter (7g)", weight: 7, price: 5500 },
  { name: "Ounce (28g)", weight: 28, price: 5000 },
];

/* NINE LEVELS DEEP: root > state > loaderData > routeId > deferredKey >
   [carousel] > products > product. Past the old depth-8 guard. */
const remixContext = {
  basename: "/",
  state: { loaderData: { "routes/menu": { menuCarousels: carousels, weightTiers: tiers } } },
};

const shopHtml = `<!doctype html><html><head><title>Fixture Remix Dispensary</title></head><body>
<h1>Menu</h1>
<div role="tablist">
  <button role="tab" aria-selected="true">Flower</button>
  <button role="tab" aria-selected="false">Edibles</button>
</div>
<div id="menu"></div>
<div id="controls"><button id="more">Load more</button></div>
<script>window.__remixContext = ${JSON.stringify({ basename: "/", state: { loaderData: { root: {} } } })};</script>
<script>__remixContext.r("/:store?/:medrec/menu[x]", "carousels\\"Promise", ${JSON.stringify(remixContext)});</script>
<script>__remixContext.p("noise", null);</script>
<script>
/* LOAD-MORE AND TABS MUTATE PAGE STATE, not just the DOM, because that is what
   these menus actually do — the rows arrive on a fetch and land in component
   state, and the collector re-reads state on every tick. A DOM-only fixture
   would prove nothing here: layers 3 and 4 only run when page state found
   NOTHING, so with the Remix carousels present the painted cards are correctly
   never read, and the load-more click would have no observable effect. */
var shown = 0, tabName = "Flower";
window.__MENU_STATE = [];
function stateRow(tab, i){
  return { name: tab + " Card " + i, product_name: tab + " Card " + i, variant_name: "Bulk",
           price: 20 + i, brand: "Fixture Farms", category: tab,
           image: "https://img.test/" + tab + i + ".jpg", weight: "3.5",
           url: "/p/" + tab + "-" + i };
}
function render(){
  var rows = [], i;
  for (i = 0; i < shown; i++) rows.push(stateRow(tabName, i));
  window.__MENU_STATE = rows;
  var out = "";
  for (i = 0; i < shown; i++) {
    out += '<article class="card"><a href="/p/' + tabName + '-' + i + '">' +
           '<h3>' + tabName + ' Card ' + i + '</h3></a>' +
           '<div class="price">$' + (20 + i) + '.00</div>' +
           '<div class="weight">3.5g</div></article>';
  }
  document.getElementById("menu").innerHTML = out;
  document.getElementById("more").disabled = (shown >= 30);
}
document.getElementById("more").onclick = function(){ shown = Math.min(30, shown + 10); render(); };
[].forEach.call(document.querySelectorAll('[role=tab]'), function(t){
  t.onclick = function(){
    [].forEach.call(document.querySelectorAll('[role=tab]'), function(o){ o.setAttribute('aria-selected','false'); });
    t.setAttribute('aria-selected','true');
    tabName = t.innerText.trim(); shown = 0; render();
  };
});
render();
</script></body></html>`;

const shop = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(shopHtml);
});
await new Promise((r) => shop.listen(SHOP_PORT, r));

/* ---------------------------------------------------------------- driver --- */
/* Raw CDP over spawn(), the pattern the rest of this repo's suites use — no
   Playwright import, which is what keeps `dependencies` empty. */
const CHROME = chromePath();

const PORT = 9577;
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: proc } = await launchChrome(PORT, [], { userDataDir: "/tmp/_ll_remixtest" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); ready = r.ok; } catch {}
  if (!ready) await sleep(150);
}
if (!ready) { proc.kill(); console.error("Chromium did not start"); process.exit(2); }

const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp failed")); });
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } };
const send = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
const evaluate = async (expr, awaitPromise) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  return r.result && r.result.result ? r.result.result.value : undefined;
};

await send("Page.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP_PORT}/menu` });
await sleep(2500);
/* CLEAR THE BATCH BEFORE INJECTING, NOT AFTER. The collector's first act on
   injection is to harvest and merge, so reset() would arrive too late — and the
   batch is an 18-hour localStorage record shared by every run against this
   profile. Without this the suite inherits its own previous run: the first pass
   here published five price tiers, and the next two runs reported them as a
   live bug long after the code that produced them was fixed. A suite that can
   fail on yesterday's data is worse than no suite. */
await evaluate(`(function(){ try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return true })()`);
await evaluate(readFileSync("./public/coldwater-collector.js", "utf8"));
await sleep(1200);

console.log("\nthe Remix reader, in a browser\n");

const diag0 = await evaluate("JSON.stringify(window.__LL_COLLECT__.diag()||{})").then((s) => JSON.parse(s || "{}"));
const first = await evaluate("window.__LL_COLLECT__.batchList().length");

ok(!!diag0.remix && diag0.remix > 0, "remixRoots found the loader data in the markup", `${diag0.remix} roots`);
/* READ OUT OF THE FILE, NOT PINNED TO A DATE. This asserted /^2026-08-17\./
   and went red the moment the build was bumped -- a suite that has to be edited
   every time the thing it checks changes correctly is a suite people learn to
   edit without reading. What matters is that the collector under test is the
   one in the working tree, which is the question a stale bookmarklet raises. */
const BUILD_NOW = (readFileSync("public/collector-build.txt", "utf8") || "").trim();
ok(String(diag0.build || "") === BUILD_NOW,
   "the collector under test is the one in the working tree", diag0.build + " vs " + BUILD_NOW);

/* THE THREE NUMBERS THAT TELL THE BUGS APART. 5 is the tier table winning on
   length; 12 is one carousel winning as "largest array"; 40 is the union. */
ok(first !== 5, "the price-tier table did NOT win — this is the five-row bug", `${first} rows`);
ok(first !== 12, "one carousel did NOT win as 'largest array'", `${first} rows`);
ok(first >= DISTINCT_STRAINS, `the carousels were unioned into the full catalogue`, `${first} rows, want >= ${DISTINCT_STRAINS}`);
ok(diag0.union >= DISTINCT_STRAINS, "the union is reported in diagnostics", `union ${diag0.union}`);

const keys = String(diag0.pickedKeys || "");
ok(!/^name,weight,price$/.test(keys), "pickedKeys is not the tier shape", keys.slice(0, 40));

console.log("\nscroll, load-more and tabs\n");

/* The whole tree, which is what the button calls. */
await evaluate(`window.__LL_SCAN = {done:false};
  window.__LL_COLLECT__.autoAll(function(){}, function(list){ window.__LL_SCAN = {done:true, n:list.length}; }, {tabSettleMs:400, settleMs:500});
  true`);
for (let i = 0; i < 90; i++) {
  const st = await evaluate("JSON.stringify(window.__LL_SCAN)").then((s) => JSON.parse(s || "{}"));
  if (st.done) break;
  await sleep(1000);
}
const diag = await evaluate("JSON.stringify(window.__LL_COLLECT__.diag()||{})").then((s) => JSON.parse(s || "{}"));

ok(diag.tabsFound >= 2, "the category tabs were recognised as tabs", `${diag.tabsFound} found`);
ok(diag.tabsVisited >= 2, "...and each was visited", `${diag.tabsVisited} visited`);
ok((diag.loadMoreClicks || 0) >= 2, "the Load more button was pressed until it ran out", `${diag.loadMoreClicks} clicks`);

/* The DOM cards only exist after load-more is pressed, so their presence is the
   proof that scrolling persisted past the button rather than stopping at it. */
const names = await evaluate("JSON.stringify(window.__LL_COLLECT__.batchList().map(function(r){return r.name}))")
  .then((s) => JSON.parse(s || "[]"));
const flower = names.filter((n) => /^Flower Card /.test(n)).length;
const edibles = names.filter((n) => /^Edibles Card /.test(n)).length;
ok(flower > 10, "rows revealed by Load more are in the batch (first tab)", `${flower} cards`);
ok(edibles > 0, "and the second tab's rows are too — tabs did not overwrite", `${edibles} cards`);
ok(names.length > first, "the batch grew across the whole tree rather than resetting", `${first} -> ${names.length}`);

/* The tier rows must never reach the batch, however the scan got there. */
const tierNames = names.filter((n) => /^(Gram|Two Grams|Eighth|Quarter|Ounce) \(/.test(n));
ok(tierNames.length === 0, "no price tier was published as a product", tierNames.join(", ").slice(0, 120));

try { ws.close(); } catch {}
proc.kill();
shop.close();

console.log("\n" + (fails.length ? `FAILED (${fails.length})\n  ` + fails.join("\n  ") : "All assertions passed.") + "\n");
process.exit(fails.length ? 1 : 0);

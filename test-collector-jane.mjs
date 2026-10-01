/* test-collector-jane.mjs — a menu inside a shadow root, controls included.
 *
 *   node test-collector-jane.mjs
 *
 * GREEN TREE RELIEF HAS SAT AT 29 ROWS THROUGH EVERY OTHER FIX, and the reason
 * is a boundary rather than a parser. Jane renders its menu in OPEN SHADOW
 * ROOTS, and `document.querySelectorAll` does not cross a shadow boundary.
 *
 * The extractor already knew that: reactHarvest, the DOM scan and scrollers()
 * all walk shadow roots via deepAll(). The three CONTROL finders did not —
 * nextControl, moreControl and tabControls were written against the light DOM.
 * So on a Jane shop the scroller worked perfectly and the pager, the load-more
 * button and the category tabs were invisible.
 *
 * THAT FAILURE IS INDISTINGUISHABLE FROM THE TRUTH, which is what makes it
 * expensive: the run reports `pagedStop: "no next control"`, which reads as
 * "this shop has no pager" and sends you to look at scrolling. Two evenings
 * have gone that way on this shop already.
 *
 * The fixture puts EVERYTHING behind the boundary — cards, the load-more button
 * and the tabs — because a fixture that leaves the controls in the light DOM
 * passes against the bug it exists to catch.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";
const SHOP_PORT = 3503;
const fails = [];
const ok = (c, m, x = "") => {
  if (c) console.log("  ok   " + m + (x ? "   (" + x + ")" : ""));
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

/* Jane prices per weight as FIELDS rather than a variant array, which is why
   Green Tree's listings came through with one option each. Kept here so the
   size reader is exercised on the shape it actually meets. */
const PER_PAGE = 10, PAGES = 4;
const TOTAL = PER_PAGE * PAGES;

const shopHtml = `<!doctype html><html><head><title>Green Tree Fixture</title></head><body>
<h1>Menu</h1>
<div id="host"></div>
<script>
var host = document.getElementById("host");
/* OPEN root: traversable, which is the case the collector supports. */
var root = host.attachShadow({ mode: "open" });
var shown = ${PER_PAGE}, tab = "All";
function card(i){
  return '<article class="jane-card">' +
    '<div class="brand">Green Tree</div>' +
    '<div class="name">' + tab + ' Strain ' + i + '</div>' +
    '<div class="thc">THC 24.' + (i % 90) + '%</div>' +
    '<div class="price">$' + (28 + (i % 12)) + '.00</div>' +
    '<div class="w">3.5g</div>' +
    '</article>';
}
function render(){
  var html = '<div role="tablist">' +
      '<button role="tab" aria-selected="' + (tab === "All") + '">All</button>' +
      '<button role="tab" aria-selected="' + (tab === "Flower") + '">Flower</button>' +
    '</div><div id="list" style="max-height:400px;overflow:auto">';
  for (var i = 0; i < shown; i++) html += card(i);
  html += '</div>';
  /* The control lives INSIDE the shadow root, which is the whole point. */
  html += '<button id="more"' + (shown >= ${TOTAL} ? ' disabled' : '') + '>Load more</button>';
  root.innerHTML = html;
  var m = root.getElementById("more");
  if (m) m.onclick = function(){ shown = Math.min(${TOTAL}, shown + ${PER_PAGE}); render(); };
  [].forEach.call(root.querySelectorAll('[role=tab]'), function(t){
    t.onclick = function(){ tab = t.textContent.trim(); shown = ${PER_PAGE}; render(); };
  });
}
render();
</script></body></html>`;

const shop = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(shopHtml);
});
await new Promise((r) => shop.listen(SHOP_PORT, r));

/* ---------------------------------------------------------------- driver --- */
const CHROME = chromePath();
const PORT = 9583;
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: proc } = await launchChrome(PORT, [], { userDataDir: "/tmp/_ll_janetest" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 100 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch {}
  if (!up) await sleep(150);
}
if (!up) { proc.kill(); console.error("Chromium did not start"); process.exit(2); }
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp failed")); });
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } };
const send = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
const evaluate = async (e, awaitP) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: !!awaitP });
  return r.result && r.result.result ? r.result.result.value : undefined;
};

await send("Page.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP_PORT}/menu` });
await sleep(2000);
await evaluate(`(function(){try{localStorage.clear();sessionStorage.clear();}catch(e){}return true})()`);
await evaluate(readFileSync("./public/coldwater-collector.js", "utf8"));
await sleep(1200);

console.log("\nthe shadow boundary\n");

const first = await evaluate("window.__LL_COLLECT__.batchList().length");
ok(first > 0, "cards inside an open shadow root are read at all", `${first} rows`);
ok(first <= PER_PAGE + 2, "...and only the first page is mounted so far", `${first}`);

/* THE ASSERTION THIS FILE EXISTS FOR: the control is behind the boundary. */
const seesControl = await evaluate(`(function(){
  var light = document.querySelectorAll('button').length;
  var host = document.getElementById('host');
  var deep = host && host.shadowRoot ? host.shadowRoot.querySelectorAll('button').length : 0;
  return JSON.stringify({ light: light, deep: deep });
})()`);
const vis = JSON.parse(seesControl || "{}");
ok(vis.deep >= 3, "the fixture really does hide its controls in the shadow root",
   `light ${vis.light} (panel only), shadow ${vis.deep}`);

console.log("\nload-more and tabs, through the boundary\n");

await evaluate(`window.__LL_JANE = {done:false};
  window.__LL_COLLECT__.autoAll(function(){}, function(list){ window.__LL_JANE = {done:true, n:list.length}; },
    {tabSettleMs:500, settleMs:500});
  true`);
for (let i = 0; i < 90; i++) {
  const st = JSON.parse(await evaluate("JSON.stringify(window.__LL_JANE)") || "{}");
  if (st.done) break;
  await sleep(1000);
}
const diag = JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.diag()||{})") || "{}");
const rows = JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.batchList().map(function(r){return r.name}))") || "[]");

ok((diag.loadMoreClicks || 0) > 0, "the Load more button inside the shadow root was found and pressed",
   `${diag.loadMoreClicks} clicks`);
ok(diag.tabsFound >= 2, "the tabs inside the shadow root were found", `${diag.tabsFound}`);
ok(diag.tabsVisited >= 2, "...and visited", `${diag.tabsVisited}`);

const allRows = rows.filter((n) => /^All Strain /.test(n)).length;
const flowerRows = rows.filter((n) => /^Flower Strain /.test(n)).length;
ok(allRows === TOTAL, `the first tab yielded all ${TOTAL} rows, not one page of ${PER_PAGE}`, `${allRows}`);
ok(flowerRows === TOTAL, `and the second tab did too`, `${flowerRows}`);
ok(rows.length === TOTAL * 2, "both tabs are in the batch together", `${rows.length}`);

/* The historical number. If this ever reads 29 again, the boundary is back. */
ok(rows.length > 29, "and the shop is no longer stuck near its historical 29", `${rows.length}`);

try { ws.close(); } catch {}
proc.kill();
shop.close();

console.log("\n" + (fails.length ? `FAILED (${fails.length})\n  ` + fails.join("\n  ") : "All assertions passed.") + "\n");
process.exit(fails.length ? 1 : 0);

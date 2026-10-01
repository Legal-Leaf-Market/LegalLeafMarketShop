/* test-collector-iframe.mjs — the menu is in a frame this page cannot read.
 *
 * REPORTED AS "grab menu won't pull up on dutchie". A shop's own site embeds
 * its Dutchie menu in an IFRAME from dutchie.com, so the collector runs on the
 * shop's page, finds no products, and stops. Nothing is broken: the same-origin
 * policy is doing exactly its job, and this project does not get around it.
 *
 * WHAT WAS WRONG WAS THE INSTRUCTION. The panel said "Right-click the menu ->
 * This Frame -> Open Frame in New Tab", which is a different menu in every
 * browser, is behind a submenu in most, and does not exist on a phone at all.
 *
 * AN IFRAME'S src IS READABLE CROSS-ORIGIN -- only its contentDocument is not.
 * So the panel can hand over the exact address instead of describing a hunt for
 * it, and a Dutchie embed's own url IS the menu
 * (dutchie.com/embedded-menu/<slug>/products): opening it puts the collector on
 * a page it can read, first party, with nothing bypassed.
 *
 * TWO REAL ORIGINS. A same-origin iframe would be readable and would prove
 * nothing, so the fixture serves the shop on one port and the menu on another
 * -- different origins by port, which is what the browser actually enforces.
 *
 *   node test-collector-iframe.mjs
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

const SHOP = 3211, MENU = 3212, CDP = 9611;
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

const COLLECTOR = readFileSync("public/coldwater-collector.js", "utf8");
const EMBED = `/embedded-menu/house-of-dank-8-mile/products`;

/* The shop's own page: chrome, no menu, and the menu in a frame from elsewhere.
   Deliberately carries a couple of prices of its own (a "from $X" teaser is
   normal on these pages) so the panel cannot pass by reporting "no prices". */
const shopHtml = `<!doctype html><html><head><title>House of Dank 8 Mile</title></head><body>
  <header><h1>House of Dank</h1><p>Shop our menu below. Eighths from $25.00.</p></header>
  <iframe title="menu" width="100%" height="900" src="http://127.0.0.1:${MENU}${EMBED}"></iframe>
  <footer><p>Open 9am-10pm. Delivery from $45.00.</p></footer>
</body></html>`;

const menuHtml = `<!doctype html><html><head><title>Menu</title></head><body>
  <div class="products">
    ${Array.from({ length: 12 }, (_, i) => `
    <a class="product" href="/product/p${i}">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
      <div class="name">Strain ${i} Flower</div>
      <div class="price">$${30 + i}.00</div>
      <div class="w">3.5g</div>
    </a>`).join("")}
  </div>
</body></html>`;

const shopSrv = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" }); res.end(shopHtml);
}).listen(SHOP);
const menuSrv = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" }); res.end(menuHtml);
}).listen(MENU);

/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llifr" });

const tgt = await until(() => fetch(`http://127.0.0.1:${CDP}/json`).then(r => r.json()).then(t => {
  const p = t.find(x => x.type === "page"); if (!p) throw 0; return p;
}));
const s = new globalThis.WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const waiting = new Map();
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; waiting.set(i, res); s.send(JSON.stringify({ id: i, method, params }));
});
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable");

console.log("\nA menu in a frame this page cannot read\n");

await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
/* The batch accumulates across runs for 18 hours, so a previous run's rows
   would otherwise walk into this one (the lesson test-collector-remix.mjs
   learned the hard way). */
await ev(`localStorage.clear(); true`);
await send("Runtime.evaluate", { expression: COLLECTOR });
await wait(2500);

console.log("== it does not pretend to have found a menu ==");
const panelText = String(await ev(`(document.querySelector("#ll-collector-panel, [id^='ll-']")||document.body).innerText`));
ok("the panel says it could not read one", /Could not read a menu here/i.test(panelText),
   panelText.replace(/\s+/g, " ").slice(0, 90));

console.log("\n== it names the cause, rather than guessing ==");
ok("it identifies the cross-origin frame",
   /cross-origin iframe/i.test(panelText), panelText.replace(/\s+/g, " ").slice(0, 140));
/* The page carries prices of its own, so "no prices on this page" would be the
   wrong diagnosis and is the one this fixture rules out. */
ok("...and not 'there are no prices on this page'",
   !/no prices on this page/i.test(panelText));

console.log("\n== THE FIX IS A LINK, not a description of a right-click ==");
const links = await ev(`(function(){
  var a = document.querySelectorAll('a[href*="embedded-menu"]');
  return Array.prototype.map.call(a, function(x){ return x.getAttribute('href'); }).join('|');
})()`);
ok("the panel offers the frame's own address as a clickable link",
   String(links).indexOf(EMBED) >= 0, String(links).slice(0, 120));
ok("...pointing at the MENU's origin, not the shop's",
   String(links).indexOf(String(MENU)) >= 0 && String(links).indexOf("/" + SHOP + "/") < 0,
   String(links).slice(0, 120));
ok("...opening in a new tab so the shop's page is not lost",
   (await ev(`(document.querySelector('a[href*="embedded-menu"]')||{}).target`)) === "_blank");

console.log("\n== and the diagnostic carries it too, for a copied report ==");
const diag = String(await ev(`(document.getElementById('ll-diag')||{}).textContent||''`));
ok("the copyable blob names the frame url", diag.indexOf("embedded-menu") >= 0,
   diag.replace(/\s+/g, " ").slice(0, 120));

console.log("\n== the collector reads that menu once it is on its own page ==");
/* The other half of the claim: the address it hands over is one this tool can
   actually read, so following the instruction ends the problem. */
await send("Page.navigate", { url: `http://127.0.0.1:${MENU}${EMBED}` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
await ev(`localStorage.clear(); true`);
await send("Runtime.evaluate", { expression: COLLECTOR });
await wait(2500);
const found = await ev(`(function(){
  try { return (window.__LL_COLLECT__ && window.__LL_COLLECT__.batchList() || []).length; } catch(e){ return String(e); }
})()`);
ok("it finds the products there", Number(found) >= 12, found + " rows");

s.close(); ch.kill(); shopSrv.close(); menuSrv.close();
console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

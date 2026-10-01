/* "The strain drop down cuts off. it should go up not down."
 *
 * .straindrop always opened downward (top:calc(100% + 6px) in the base CSS), with nothing
 * checking whether that much room actually existed below the search field. On a short viewport,
 * or with the field scrolled down inside the filter panel, the picker's own max-height (320px)
 * runs past the bottom of the viewport and reads as cut off.
 *
 * Fixed additively (CLAUDE.md section 5): ll-strain-drop-flip watches #strainDrop's own "open"
 * class (which the engine's openStrainDrop()/renderStrainDrop() already toggle) and adds a
 * sibling "flip-up" class -- defined only in the additive stylesheet -- when there is less room
 * below the field than the dropdown needs and more room above than below.
 *
 * Run: node test-strain-drop-flip.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* Enough strains that the picker's natural height exceeds a short viewport, so the suite is not
   testing a dropdown that would fit regardless. */
const products = [];
for (let i = 0; i < 20; i++) {
  products.push({
    id: "flower__" + i, name: "Strain " + i + " THCa Flower", store: "Test Shop", storeKey: "testshop",
    domain: "example.test", platform: "shopify", cannabinoid: "THCa", category: "THCA Flower",
    type: "Sativa", image: "", url: "https://example.test/f" + i, inStock: true,
    startsAt: 40, sale: 40, perG: 1.43, ship: 5, badges: [],
    sizes: [["1/8 oz", 40, 3.5, String(i), true, "https://example.test/f" + i, "", 0]]
  });
}
const FEED = { meta: { updated: new Date(0).toISOString(), total: products.length, stores: [] }, products };

const PORT = 3512, CDP = 9364;
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

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_strainflip" });
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
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 500, deviceScaleFactor: 1, mobile: false });

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`localStorage.setItem('ll_age_ok','1')`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
await wait(600);

/* The filter panel is collapsed by default (site-wide) -- open it, or #fStrainSearch is not
   visible at all and every measurement below reads as a zero-size box. */
await ev(`(function(){ var b=document.getElementById('toggleFilters'); if(b) b.click(); })()`);
await wait(300);
ok("the filter panel actually opened", !(await ev(`document.getElementById('filterPanel').classList.contains('hidden')`)));

await ev(`(function(){ var f=document.getElementById('fStrainSearch'); if(f) f.scrollIntoView({block:'end'}); })()`);
await wait(300);
await ev(`(function(){ var si=document.getElementById('fStrainSearch'); if(si) si.dispatchEvent(new Event('focus')); })()`);
await wait(400);

const geo = await ev(`(function(){
  var drop=document.getElementById('strainDrop');
  var wrap=drop && drop.closest('.strainwrap');
  if(!drop||!wrap) return null;
  var dr=drop.getBoundingClientRect();
  return { flipUp: drop.classList.contains('flip-up'), dropTop: dr.top, dropBottom: dr.bottom,
    viewportH: window.innerHeight, rows: document.querySelectorAll('#strainDrop .sdname').length };
})()`);
console.log("cramped-viewport geometry:", JSON.stringify(geo));

ok("the picker actually rendered its rows", geo && geo.rows === 20, JSON.stringify(geo));
ok("cramped near the bottom of a short viewport: it flips upward", geo && geo.flipUp === true, JSON.stringify(geo));
ok("...and is fully within the viewport, top edge included", geo && geo.dropTop >= 0, JSON.stringify(geo));
ok("...and its bottom edge too, which top:calc(100%+6px) alone cannot guarantee",
  geo && geo.dropBottom <= geo.viewportH + 1, JSON.stringify(geo));

/* The counter-case: plenty of room below (field scrolled back to the top of a tall viewport)
   must NOT flip. A fix that always flips would look identical to a working one in the case
   above and still be wrong. */
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false });
await ev(`(function(){ window.scrollTo(0,0); })()`);
await wait(300);
await ev(`(function(){ var si=document.getElementById('fStrainSearch'); if(si) si.blur(); })()`);
await wait(200);
await ev(`(function(){ var si=document.getElementById('fStrainSearch'); if(si) si.dispatchEvent(new Event('focus')); })()`);
await wait(400);
const geo2 = await ev(`(function(){
  var drop=document.getElementById('strainDrop');
  var dr=drop.getBoundingClientRect();
  return { flipUp: drop.classList.contains('flip-up'), dropTop: dr.top, viewportH: window.innerHeight };
})()`);
console.log("plenty-of-room geometry:", JSON.stringify(geo2));
ok("plenty of room below: it does NOT flip", geo2 && geo2.flipUp === false, JSON.stringify(geo2));

ok("no uncaught errors", errs.length === 0, errs.join(" | ").slice(0, 500));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

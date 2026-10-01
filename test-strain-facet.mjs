/* "All the sub category parts are showing as strains ... bloating the list."
 *
 * strainFacet() rejects vocabulary it recognizes as junk (STRAIN_JUNK: wholesale,
 * grinder, tray, rolling, papers, lighter, ...), which was written against cannabis
 * product names. The gear catalogue is ~1,500 products across six stores (Grasscity,
 * Chill, Greek Glass, Zam, Mein-Grinder, Hitoki) and says plenty of glass/rig
 * vocabulary that list never anticipated -- banger, rig, downstem, ash catcher, dab
 * tool, terp pearl, splash guard -- so a glass listing whose name strainFacet() does
 * not recognize as junk was passing straight through and appearing as a "strain" in
 * the picker, right alongside real flower.
 *
 * The fix is structural rather than another vocabulary word: accessories/glass are
 * not flower and have no strain by definition, so both places that call strainFacet()
 * over the whole catalogue (groupByStrain's card-merge key, and rebuildFacets' strain
 * picker) now skip prodIsGlass(p) products outright, the same predicate the engine
 * already uses to route a product to the accessory card branch.
 *
 * Run: node test-strain-facet.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* Real gear names that are NOT strains and would previously slip past STRAIN_JUNK,
   mixed with one real flower product so a working strain facet still has something
   to show and this suite cannot pass vacuously against an empty picker. */
const FEED = {
  meta: { updated: new Date(0).toISOString(), total: 6, stores: [] },
  products: [
    { id: "flower__1", name: "Sour Diesel THCa Flower", store: "Test Shop", storeKey: "testshop",
      domain: "example.test", platform: "shopify", cannabinoid: "THCa", category: "THCA Flower",
      type: "Sativa", image: "", url: "https://example.test/f", inStock: true,
      startsAt: 40, sale: 40, perG: 1.43, ship: 5, badges: [],
      sizes: [["1/8 oz", 40, 3.5, "1", true, "https://example.test/f", "", 0]] },
    { id: "gg__1", name: "Blue Swirl Quartz Banger", store: "Greek Glass", storeKey: "greekglass",
      domain: "www.greekglassshop.com", cannabinoid: "Accessory", category: "Bangers",
      image: "", url: "https://www.greekglassshop.com/product/banger", inStock: true,
      startsAt: 30, sale: 30, perG: null, ship: 5, badges: [],
      sizes: [["One Size", 30, 0, "2", true, "https://www.greekglassshop.com/product/banger", ""]] },
    { id: "gg__2", name: "14mm Showerhead Perc Recycler Rig", store: "Greek Glass", storeKey: "greekglass",
      domain: "www.greekglassshop.com", cannabinoid: "Accessory", category: "Rigs",
      image: "", url: "https://www.greekglassshop.com/product/rig", inStock: true,
      startsAt: 120, sale: 120, perG: null, ship: 5, badges: [],
      sizes: [["One Size", 120, 0, "3", true, "https://www.greekglassshop.com/product/rig", ""]] },
    { id: "chill__1", name: "Titanium Dab Tool Ash Catcher", store: "Chill Steel Pipes", storeKey: "chill",
      domain: "chill.store", cannabinoid: "Accessory", category: "Accessories",
      image: "", url: "https://chill.store/product/catcher", inStock: true,
      startsAt: 20, sale: 20, perG: null, ship: 5, badges: [],
      sizes: [["One Size", 20, 0, "4", true, "https://chill.store/product/catcher", ""]] },
    { id: "zam__1", name: "Splash Guard Terp Pearl Set", store: "Zam Grinders", storeKey: "zamgrinders",
      domain: "zamgrinders.com", cannabinoid: "Accessory", category: "Accessories",
      image: "", url: "https://zamgrinders.com/product/pearls", inStock: true,
      startsAt: 15, sale: 15, perG: null, ship: 5, badges: [],
      sizes: [["One Size", 15, 0, "5", true, "https://zamgrinders.com/product/pearls", ""]] },
    { id: "hitoki__1", name: "Downstem Adapter 18mm to 14mm", store: "Hitoki", storeKey: "hitoki",
      domain: "hitoki.com", cannabinoid: "Accessory", category: "Accessories",
      image: "", url: "https://hitoki.com/product/adapter", inStock: true,
      startsAt: 12, sale: 12, perG: null, ship: 5, badges: [],
      sizes: [["One Size", 12, 0, "6", true, "https://hitoki.com/product/adapter", ""]] }
  ]
};

const PORT = 3506, CDP = 9358;
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

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_strainfacet" });
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
/* Google Fonts stalls the render-blocking <link> for ~13s in this proxy (CLAUDE.md section
   10); bigcartel.com is the live Greek Glass refresh public/engine.js fires on every load. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`localStorage.setItem('ll_age_ok','1')`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
await wait(600);

const cardCount = await ev(`document.querySelectorAll('#grid .card').length`);
ok("engine painted the grid", cardCount > 0, `${cardCount} cards`);

/* Opening the strain drop is what the engine itself uses to render STRAIN_ROWS (a
   focus event on #fStrainSearch), so this reads the real picker rather than a
   module-internal variable no external script can see. */
await ev(`(function(){ var si=document.getElementById('fStrainSearch'); if(si) si.dispatchEvent(new Event('focus')); })()`);
await wait(300);
const rows = await ev(`[].map.call(document.querySelectorAll('#strainDrop .sdname'), function(el){ return el.textContent.trim(); })`);
console.log("rendered strain rows:", JSON.stringify(rows));

ok("the real strain is still in the picker", rows.some(r => r.includes("Sour Diesel")), JSON.stringify(rows));

const GEAR_WORDS = ["Banger", "Recycler Rig", "Dab Tool", "Ash Catcher", "Terp Pearl", "Downstem", "Splash Guard", "Adapter"];
for (const w of GEAR_WORDS) {
  ok(`"${w}" gear did not leak into the strain picker`, !rows.some(r => r.includes(w)), JSON.stringify(rows));
}
ok("exactly one strain rendered, not the whole gear catalogue", rows.length === 1, JSON.stringify(rows));

ok("no uncaught errors", errs.length === 0, errs.join(" | ").slice(0, 500));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

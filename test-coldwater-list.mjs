/* /trip — the trip plan, driven in a real browser.

   THE BUG THIS EXISTS FOR: every card's add button is the engine's own .addbtn
   and writes the engine cart under "ll_cw:ll_cart"; this page used to read a
   different key, "ll_cw_list", written only by a parallel set of .cwl-add
   buttons. Six items added, an empty list, nothing logged. Both halves worked
   and never met, so the assertion that matters is the JOIN -- the page has to
   read the key the button writes, and that is asserted first.

   The rest is what a shopper actually gets: the mix-and-match unlock (only true
   once the group is satisfied), the three groupings, the exports, and Escape. */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
const CHROME = chromePath();
const PORT = 3496, CDP = 9351;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* Three products on one mix-and-match tier at one shop, plus one at a second
   shop so the grouping has something to group. The offer is a real string off
   Herbology's menu: "$30 or 3/$84" unlocks $28 EACH -- a per-item price, which
   is the number the list has to total with. */
const DEAL = "Mix & Match Pre-Packed Flower $30 or 3/$84";
const mk = (id, name, brand, cat) => ({
  id, name, store: "Sample Shop A", storeKey: "s1", brand, category: cat, type: "Indica",
  image: "", url: "https://example.test/" + id, startsAt: 30, sale: 30, perG: 8.57, shelfPerG: 8.57,
  deal: DEAL, dealPerG: 8, dealPerUnit: 28, dealMinQty: 3, dealMix: true, dealGroup: "Pre-Packed Flower",
  inStock: true, sizes: [["1/8 oz", 30, 3.5, 8.57, true, "https://example.test/" + id, "", 0]]
});
const FEED = {
  updated: new Date(0).toISOString(),
  roster: [
    { key: "s1", name: "Sample Shop A", addr: "1 Main St", phone: "(517) 555-0100" },
    { key: "s2", name: "Sample Shop B", addr: "2 Willowbrook Rd", phone: "(517) 555-0200" }
  ],
  products: [
    mk("s1__alpha", "Mix Test Alpha", "Redbud", "THCA Flower"),
    mk("s1__beta", "Mix Test Beta", "Redbud", "THCA Flower"),
    mk("s1__gamma", "Mix Test Gamma", "Cloud Cover", "THCA Flower"),
    { id: "s2__cart", name: "Sample Cart", store: "Sample Shop B", storeKey: "s2", brand: "Cloud Cover",
      category: "Concentrate", type: "", image: "", url: "https://example.test/cart",
      startsAt: 45, sale: 45, perG: 45, inStock: true, deal: "",
      sizes: [["1g", 45, 1, 45, true, "https://example.test/cart", "", 0]] }
  ]
};
const CART = [
  { id: "s1__alpha", name: "Mix Test Alpha", store: "Sample Shop A", storeKey: "s1", size: "1/8 oz", price: 30 },
  { id: "s1__beta",  name: "Mix Test Beta",  store: "Sample Shop A", storeKey: "s1", size: "1/8 oz", price: 30 },
  { id: "s1__gamma", name: "Mix Test Gamma", store: "Sample Shop A", storeKey: "s1", size: "1/8 oz", price: 30 },
  { id: "s2__cart",  name: "Sample Cart",    store: "Sample Shop B", storeKey: "s2", size: "1g",     price: 45 }
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  /* BOTH SPELLINGS. /api/market is the canonical name and /api/coldwater is the
     alias kept forever (ONE_CORE.md section 4), and this stub answered only the
     alias -- so the day the page moved to the canonical name the suite timed out
     waiting for an address that was never going to arrive, which reads as the
     page being broken rather than the stub being behind it. */
  if (u.pathname === "/api/market" || u.pathname === "/api/coldwater") {
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(FEED));
  }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const f = u.pathname === "/trip" ? "trip.html"
          : u.pathname === "/coldwater" ? "coldwater.html"
          : u.pathname.replace(/^\//, "");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_cwlist" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find(x => x.type === "page"); if (!p) throw 0; return p; });
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
const key = async k => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: k === "Escape" ? 27 : 0 })
  .then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: k === "Escape" ? 27 : 0 }));

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });

async function goto(path) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
}
/* THE TRIP IS NAMESPACED PER TOWN, and the page is shared by every city, so
   seeding means seeding BOTH halves: the context the city page publishes and the
   key that context resolves to. A flat key with no context is the pre-namespace
   fallback and is asserted separately at the end. */
const CTX = { slug: "coldwater", label: "Coldwater", market: "Coldwater, MI" };
const CART_KEY = "ll_cw:" + CTX.slug + ":ll_cart";
async function seed(n) {
  await ev(`localStorage.setItem('ll_cw:ctx', ${JSON.stringify(JSON.stringify(CTX))})`);
  await ev(`localStorage.setItem('${CART_KEY}', JSON.stringify(${JSON.stringify(CART.slice(0, n))}))`);
  await ev(`localStorage.removeItem('ll_cw_done')`);
  await goto("/trip?market=" + CTX.slug);
  /* The metadata arrives with the feed, and every deal figure depends on it. */
  await until(async () => { if (await ev(`/Main St/.test(document.getElementById('card').innerText)`)) return true; throw 0 }, 60);
}
const cardText = () => ev(`document.getElementById('card').innerText`);

console.log("\n/trip — the trip plan\n");

/* ---- THE JOIN, which is the bug ---------------------------------------- */
await goto("/trip");
await ev(`localStorage.clear()`);
await goto("/trip");
await wait(400);
ok("an empty list says so rather than rendering an empty card",
   /Nothing on your trip yet/.test(await cardText()));

await seed(1);
let txt = await cardText();
ok("an item written by the engine's own cart key appears on the list",
   /Mix Test Alpha/.test(txt), txt.split("\n").slice(0, 3).join(" | "));
ok("and it is filed under the shop, with where to go",
   /Sample Shop A/.test(txt) && /1 Main St/.test(txt), (txt.match(/Sample Shop A[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " "));
ok("the metadata joined by id, so the row carries brand and category too",
   /Redbud/.test(txt) && /THCA Flower/.test(txt), (txt.match(/1\/8 oz[^\n]*/) || [""])[0]);

/* ---- THE UNLOCK, which is the reason it is a list and not a notepad ----- */
ok("one of three: it says how many more are needed, not the unlocked price",
   /Add 2 more from Pre-Packed Flower/.test(txt), (txt.match(/Add \d+ more[^\n]*/) || [""])[0]);
ok("and the total is SHELF while the group is short",
   /\$30\.00/.test(txt) && !/\$84/.test(txt), (txt.match(/1 line[\s\S]{0,24}/) || [""])[0].replace(/\n/g, " "));

await seed(3);
txt = await cardText();
ok("three of three: the deal reads as unlocked", /deal unlocked/.test(txt), (txt.match(/[^\n]*unlocked[^\n]*/) || [""])[0]);
/* THE UNIT IS THE POINT. dealMath computes $28 EACH (84/3); the feed used to
   publish only dealPerG, and the list totalled three eighths at $8 each. */
ok("and it unlocks at the price of ONE, not at a price per gram",
   /\$28\.00 each/.test(txt), (txt.match(/[^\n]*each[^\n]*/) || [""])[0]);
ok("only now does the total use the mix price", /\$84\.00/.test(txt), (txt.match(/3 lines[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " "));
ok("and the shelf total is still shown so the saving is legible",
   /\$90\.00/.test(txt), (txt.match(/3 lines[\s\S]{0,40}/) || [""])[0].replace(/\n/g, " "));

/* ---- FOUR ITEMS, TWO SHOPS, THREE VIEWS -------------------------------- */
await seed(4);
txt = await cardText();
ok("a second shop is a second stop, not a second list",
   /Sample Shop B/.test(txt) && /2 items across 2 shops|4 items across 2 shops/.test(txt),
   (txt.match(/\d+ items across \d+ shops/) || [""])[0]);

const groupBy = async m => { await ev(`document.querySelector('[data-mode="${m}"]').click()`); await wait(250); return cardText(); };
let bt = await groupBy("brand");
ok("by brand regroups the same items", /Redbud/.test(bt) && /Cloud Cover/.test(bt) && !/1 Main St/.test(bt),
   bt.split("\n").slice(0, 2).join(" | "));
/* A Sapura deal must not read as satisfied by something bought at Lume, so the
   arithmetic stays per-shop however the view is sliced. */
ok("...and the shop's deal is still counted per shop, not per brand",
   /deal unlocked/.test(bt), (bt.match(/[^\n]*unlocked[^\n]*/) || [""])[0]);
let ct = await groupBy("category");
ok("by category regroups again", /THCA Flower/.test(ct) && /Concentrate/.test(ct), ct.split("\n").slice(0, 2).join(" | "));
await groupBy("store");

/* ---- EXPORTS ------------------------------------------------------------ */
const openMenu = async () => { await ev(`document.getElementById('exp').click()`); await wait(120); };
await openMenu();
ok("the save menu offers every route asked for",
   (await ev(`[].map.call(document.querySelectorAll('#expmenu [data-do]'),function(b){return b.getAttribute('data-do')}).join(',')`))
     === "photo,copy,pdf,jpeg,txt,csv,clear");

await ev(`document.querySelector('#expmenu [data-do="copy"]').click()`);
await wait(400);
/* Chromium headless refuses the clipboard, which is exactly the path the
   fallback exists for: the text has to appear on the page rather than nothing
   happening. */
const out = String(await ev(`(document.getElementById('out')||{}).value || ''`));
ok("copy falls back to showing the text rather than silently doing nothing", out.length > 0);
ok("the text export names the shop and its address",
   /SAMPLE SHOP A/.test(out) && /1 Main St/.test(out), out.split("\n").slice(0, 4).join(" | "));
ok("carries a tick box per item", /\[ \] Mix Test Alpha/.test(out));
ok("carries the unlocked unit price, not just the number",
   /deal unlocked: \$28\.00 each/.test(out), (out.match(/[^\n]*unlocked[^\n]*/) || [""])[0]);
ok("totals the whole trip, not only each stop", /TOTAL \$129\.00/.test(out), (out.match(/TOTAL[^\n]*/) || [""])[0]);
ok("and tells the reader to confirm before travelling", /confirm before you travel/.test(out));

/* ---- THE PICTURE -------------------------------------------------------- */
await openMenu();
await ev(`document.querySelector('#expmenu [data-do="photo"]').click()`);
await until(async () => { if (await ev(`!document.getElementById('shot').hidden`)) return true; throw 0 }, 40);
const shot = await ev(`(function(){
  var i=document.getElementById('shotimg');
  return {src:(i.src||'').slice(0,5), w:i.naturalWidth, h:i.naturalHeight, hint:document.getElementById('shothint').textContent};
})()`);
ok("Save to Photos renders an actual image", shot.src === "blob:", JSON.stringify(shot));
/* Drawn at 2x on a 1080-wide canvas, with the height measured from the laid-out
   content -- so the width is fixed and the height has to GROW with the list.
   A collapsed layout pass is the failure this catches, and it would show up as a
   height near the header's alone. */
ok("...at a size worth saving", shot.w === 2160 && shot.h > 600, `${shot.w}x${shot.h}`);
ok("...and says how to get it into Photos on a phone", /photos|Photos/.test(shot.hint), shot.hint);

/* ---- ESCAPE, at every depth -------------------------------------------- */
await key("Escape"); await wait(200);
ok("Escape closes the picture first", (await ev(`document.getElementById('shot').hidden`)) === true);
await openMenu();
await key("Escape"); await wait(200);
ok("then the menu", (await ev(`document.getElementById('expmenu').hidden`)) === true);
await key("Escape"); await wait(200);
ok("then the text box", (await ev(`!document.getElementById('out')`)) === true);
await key("Escape");
await until(async () => { if (/\/coldwater$/.test(String(await ev(`location.pathname`)))) return true; throw 0 }, 40);
ok("and then it gets you back to the shelf", /coldwater$/.test(String(await ev(`location.pathname`))));

/* ---- REMOVAL WRITES THE KEY THE ENGINE READS --------------------------- */
await seed(4);
await ev(`document.querySelector('[data-rm]').click()`);
await wait(300);
const left = await ev(`JSON.parse(localStorage.getItem('${CART_KEY}')||'[]').length`);
ok("removing a line writes the engine's own key, so the shelf agrees", left === 3, `${left} left`);

/* ---- AND THE PRE-NAMESPACE LIST IS NOT ORPHANED ------------------------
   Anybody who built a trip before the key carried a town has it under the flat
   spelling, and the city page lifts it across on next visit. Reaching this page
   directly with no context at all must still read it rather than showing an
   empty list, which would look exactly like the trip having been lost. */
await goto("/trip");
await ev(`localStorage.clear()`);
await ev(`localStorage.setItem('ll_cw:ll_cart', JSON.stringify(${JSON.stringify(CART.slice(0, 2))}))`);
await goto("/trip");
await wait(600);
const flat = await cardText();
ok("with no market resolved it still reads the pre-namespace key",
   /Mix Test Alpha/.test(flat), flat.split("\n").slice(0, 2).join(" | "));
ok("...and says 'My trip' rather than naming a town it does not know",
   (await ev(`document.title`)) === "My trip", await ev(`document.title`));

ok("no uncaught errors", errs.length === 0, errs.join(" | ").slice(0, 300));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

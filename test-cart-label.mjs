/* One cart, one wording.

   The engine has two card branches and they disagreed about what the button is
   called: the size-selecting branch renders "Add to Legal-Leaf Cart" and the
   accessory branch (Greek Glass, or anything the feed marks
   cannabinoid:"Accessory") rendered "Add to Cart" -- same button, same
   localStorage ll_cart, sitting side by side in one grid. This drives a real
   browser over a feed carrying one of each and asserts the two agree.

   It also asserts the fix does NOT reach /coldwater, which is generated from
   this same file and whose own block owns the wording there ("Add to Shopping
   List" -- that page has no cart, it has a list). That guard is the whole
   reason the block is conditional, and it fails silently if it breaks: the two
   blocks would just take turns rewriting the same button. */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";
const CHROME = chromePath();
const PORT = 3487, CDP = 9341;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* Two products, one per card branch. The accessory carries no sizes, which is
   what sends it down the branch that used to say "Add to Cart". */
const FEED = {
  meta: { updated: new Date(0).toISOString(), total: 2, stores: [{ name: "Test Shop", count: 2 }] },
  products: [
    {
      id: "flower__1", name: "Test Flower", store: "Test Shop", storeKey: "testshop",
      domain: "example.test", platform: "shopify", cannabinoid: "THCa", category: "THCA Flower",
      type: "Indica", strain: "Test Strain", image: "/favicon.svg", url: "https://example.test/f",
      inStock: true, startsAt: 40, sale: 40, perG: 1.43, ship: 5, badges: [],
      sizes: [["1/8 oz", 40, 3.5, 11.43, true, "https://example.test/f", "", 0]]
    },
    {
      id: "greekglass__rig", name: "Test Glass Rig", store: "Greek Glass", storeKey: "greekglass",
      domain: "www.greekglassshop.com", platform: "bigcartel", cannabinoid: "Accessory",
      category: "Glass", type: "", strain: "", image: "/favicon.svg",
      url: "https://www.greekglassshop.com/product/rig",
      inStock: true, startsAt: 70, sale: 63, perG: null, ship: 12, badges: [], coupon: "GG10",
      description: "A glass rig.", sizes: []
    }
  ]
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const ROUTES = { "/": "index.html", "/coldwater": "coldwater.html" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/products") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(FEED)); }
  if (u.pathname === "/api/coldwater") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(FEED)); }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const f = ROUTES[u.pathname] || u.pathname.replace(/^\//, "");
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
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_cartlbl" });
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

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* Google Fonts is refused by the proxies this repo is edited from, and a
   render-blocking <link> to it stalls every script after it for ~13s. */
/* bigcartel.com too: public/engine.js refreshes Greek Glass from
   api.bigcartel.com on top of its baked seed, so any suite serving
   public/index.html calls a real merchant on a runner with network.
   LL_NO_STORE_FETCH covers api/ code and cannot cover a browser. Blocking it
   also makes the run deterministic instead of dependent on somebody's shop. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });

async function goto(path) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
  await wait(400);   /* the relabel runs on rAF after the grid mutation */
}

const labels = `[].map.call(document.querySelectorAll('#grid .card .addbtn'),function(b){return (b.textContent||'').trim()})`;

console.log("\n/ — one cart, one wording\n");
await goto("/");

const cards = await ev(`document.querySelectorAll('#grid .card').length`);
ok("engine painted the grid", cards > 0, `${cards} cards`);

/* THE GRID PAGINATES, so "both branches agree" cannot be read off one screen:
   the engine renders a page at a time and the accessory seed fills the first
   one. Asserted against the unfiltered grid, "every button says X" passes while
   the grid holds only ONE of the two branches -- which is precisely the bug it
   claims to cover. So the accessory branch is filtered into view on purpose,
   and the other branch is asserted where it is actually decided: the engine's
   own literal, read out of the blob (below). */
const setCan = v => ev(`(function(){var s=document.getElementById('fCannabinoid'); if(!s) return "no select";
  s.value=${JSON.stringify(v)}; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value;})()`);

await setCan("Accessory"); await wait(600);
const acc = await ev(labels);
const accGG = await ev(`document.querySelectorAll('#grid .card .addbtn.ggbtn').length`);
ok("the accessory branch is on screen, which is the branch under test", accGG > 0, `${accGG} accessory cards`);
ok("no accessory button still reads the bare Add to Cart",
  acc.length > 0 && acc.every(x => !/(^|\s)Add to Cart$/.test(x)), JSON.stringify([...new Set(acc)]));
ok("every accessory button reads Add to Legal-Leaf Cart",
  acc.length > 0 && acc.every(x => x.indexOf("Add to Legal-Leaf Cart") >= 0), JSON.stringify([...new Set(acc)]));
ok("and they all read the same thing", new Set(acc).size === 1, JSON.stringify([...new Set(acc)]));

/* The relabel must survive a re-render: the grid is rebuilt on every filter and
   sort, and the engine sets the accessory label at render with no hook to
   attach to. This is what the MutationObserver is for -- and the filter pass
   above has already exercised it once. */
await setCan(""); await wait(600);
const after = await ev(labels);
ok("and it survives the grid re-rendering", after.length > 0 && after.every(x => x.indexOf("Add to Legal-Leaf Cart") >= 0), JSON.stringify([...new Set(after)]));

/* The guard. coldwater.html is generated from index.html, so this block travels
   there; cw-list-button owns the wording on that page and the two must not take
   turns rewriting the same button. */
console.log("\n/coldwater — and the block stands down where it does not belong\n");
await goto("/coldwater");
const cw = await ev(labels);
ok("Coldwater still says Add to Shopping List", cw.length > 0 && cw.every(x => x.indexOf("Add to Shopping List") >= 0), JSON.stringify([...new Set(cw)]));
ok("and nothing there was relabelled to the hemp cart", cw.every(x => x.indexOf("Legal-Leaf Cart") < 0), JSON.stringify([...new Set(cw)]));

ok("no uncaught errors", errs.length === 0, errs.join(" | ").slice(0, 300));

s.close(); ch.kill(); srv.close();

/* THE OTHER HALF, with no browser. The size-selecting branch's wording is the
   engine's own literal inside the blob and is not something the relabel touches
   -- so what has to be pinned is that the two strings are still the same string,
   and that the blob was NOT hand-edited to get there (CLAUDE.md section 5). If a
   future engine re-cut renames one branch, this is what notices. */
console.log("\nthe engine's own literals\n");
const html = await readFile("public/index.html", "latin1");
const blob = html.match(/var B="([A-Za-z0-9+/=]+)"/);
const engine = Buffer.from(blob[1], "base64").toString("latin1");
/* The engine writes the fullwidth plus as a JS escape, so these are the six
   ASCII characters backslash-u-f-f-0-b and not the character itself. Matching
   the character would silently never match. */
const WANT = '\\uff0b Add to Legal-Leaf Cart';
ok("the size-selecting branch renders Add to Legal-Leaf Cart",
  engine.includes(`canBuy?"${WANT}"`));
ok("and rewrites it to the same string on every size change",
  engine.includes(`okBuy?"${WANT}"`));
ok("the accessory branch is still untouched in the blob, so the relabel is doing real work",
  engine.includes('soldG?"Out of stock":"\\uff0b Add to Cart"'));

/* GREEK GLASS RENDERS ITS OWN BUTTON in plain HTML and JS, so its string is
   fixed at the source rather than relabelled. Same one cart (localStorage
   ll_cart) behind it and behind the engine's.
   THE THREE SATELLITES USED TO BE IN THIS LIST and are not any more, which is
   the point rather than an omission: /consumables, /devices and /international
   are generated from public/index.html now (tools/make-shelf.mjs), so they run
   the ENGINE and inherit the ll-cart-label relabel exactly as `/` does. A
   source search is the wrong question for them -- the engine's accessory
   literal travels inside the blob, unedited and unsearchable, and the wording
   is fixed at render. test-shelves.mjs asks the right question in a browser:
   every rendered button on a shelf says Add to Legal-Leaf Cart, and none says
   Shopping List. Asserting the file text here would fail against working pages,
   which is how a suite teaches people to delete it. */
console.log("\nthe pages that render their own button\n");
for (const f of ["greekglass.html"]) {
  const t = await readFile("public/" + f, "utf8");
  ok(`${f} offers no bare Add to Cart`, !/Add to Cart/.test(t));
  ok(`${f} says Add to Legal-Leaf Cart`, /Add to Legal-Leaf Cart/.test(t));
}
/* And the satellites are generated, so the check that matters here is that they
   still ARE -- a hand-edited one would silently stop inheriting everything. */
for (const f of ["consumables.html", "devices.html", "international.html"]) {
  const t = await readFile("public/" + f, "utf8");
  ok(`${f} is generated from index.html, so it inherits the relabel`,
     /id="ll-shelf"/.test(t) && /id="ll-cart-label"/.test(t));
}
console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

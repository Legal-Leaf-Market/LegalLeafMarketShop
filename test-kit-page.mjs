/* test-kit-page.mjs — /kit, driven against the REAL /api/kit handler.
 *
 * The page is a thin face over the endpoint, so what can go wrong is not the
 * arithmetic (test-kit.mjs owns that) but the join: a face that renders a
 * field the endpoint does not send, or quietly re-derives one it does.
 *
 * Four claims:
 *   1. THE SEED ROUND-TRIPS. A kit that cannot be linked to is a slot machine.
 *      The address bar must become the share link, and loading that link must
 *      rebuild the SAME kit.
 *   2. AN EMPTY ROLE IS RENDERED, NOT DROPPED. api/kit.js returns required
 *      roles it could not fill as product:null on purpose; a face that skips
 *      falsy rows turns "we could not fill this" into "this kit has five parts".
 *   3. THE CART IS THE SITE'S OWN SHAPE. A second shape here is a drawer that
 *      renders half a row, and localStorage does not complain.
 *   4. SHOPS AND SHIPPING ARE SHOWN. The multi-shop cost is the honest half of
 *      this feature and the easiest thing to quietly drop.
 *
 *     node test-kit-page.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
process.env.LL_NO_STORE_FETCH = "1";
import { launchChrome } from "./tools/chrome-path.mjs";
import kitHandler from "./api/kit.js";

const PORT = 3521, CDP = 9375;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* A feed with one of everything a dab kit needs, plus a shop-crossing part so
   the multi-shop path is real, plus flower so the consumable is real. */
const gear = (id, name, cat, price, extra = {}) => ({
  id, name, category: cat, cannabinoid: "Accessory", group: "gear",
  store: "Glass Co", storeKey: "glass", domain: "glass.test", cartDomain: "glass.test",
  platform: "shopify", image: "/favicon.svg", url: "https://glass.test/p/" + id,
  inStock: true, startsAt: price, sale: price, ship: 0, heat: "vaporizing",
  sizes: [["One Size", price, 0, "v" + id, true, "https://glass.test/p/" + id, "", 0]], ...extra,
});
const FEED = [
  gear("r1", "14mm Female Glass Dab Rig", "Bongs & Rigs", 110),
  gear("r2", "Mini Recycler Dab Rig", "Bongs & Rigs", 88),
  gear("b1", "14mm Male 90 Quartz Banger", "Parts & Tools", 22),
  gear("c1", "Bamboo Carb Cap", "Parts & Tools", 13),
  gear("t1", "Butane Torch", "Accessories", 20, { storeKey: "tools", store: "Tool Shop", ship: 6, heat: "" }),
  gear("d1", "Stainless Steel Dab Tool", "Parts & Tools", 10),
  gear("m1", "Silicone Dab Mat", "Storage & Trays", 15, { heat: "" }),
  gear("x1", "Isopropyl Cleaner 16oz", "Accessories", 12, { heat: "" }),
  { id: "f1", name: "Blue Dream THCA Flower", category: "THCA Flower", cannabinoid: "THCa",
    group: "cons", store: "Flower Co", storeKey: "flower", domain: "flower.test",
    cartDomain: "flower.test", platform: "shopify", image: "/favicon.svg",
    url: "https://flower.test/p/f1", inStock: true, startsAt: 40, sale: 40, perG: 1.43, ship: 0,
    sizes: [["28g", 40, 28, "vf1", true, "https://flower.test/p/f1", "", 0]] },
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  /* THE FIXTURE IS SERVED AS /api/products, NOT INJECTED. api/feed.js fetches
     this site's own feed off the request host, so pointing the handler at this
     server exercises the real loadCatalogue -- cache, error path and all --
     instead of a stub that only proves the stub works. */
  if (u.pathname === "/api/products") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ meta: { updated: "x", total: FEED.length, stores: [] }, products: FEED }));
  }
  if (u.pathname === "/api/kit") {
    const q = Object.fromEntries(u.searchParams.entries());
    const fake = { setHeader() {}, status(c) { this._c = c; return this }, json(b) { this._b = b; return this } };
    await kitHandler({ query: q, headers: { host: "127.0.0.1:" + PORT } }, fake);
    res.writeHead(fake._c || 200, { "content-type": "application/json" });
    return res.end(JSON.stringify(fake._b));
  }
  if (u.pathname.startsWith("/api/")) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  const base = u.pathname === "/" ? "/index.html" : u.pathname;
  for (const c of (extname(base) ? [base] : [base + ".html", join(base, "index.html")])) {
    try {
      const b = await readFile(join("public", c.replace(/^\//, "")));
      res.writeHead(200, { "content-type": MIME[extname(c)] || "application/octet-stream" });
      return res.end(b);
    } catch {}
  }
  res.writeHead(404).end("no");
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llkitpage" });
let t = null;
for (let i = 0; i < 90 && !t; i++) {
  try { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); t = j.find(x => x.type === "page"); } catch {}
  if (!t) await wait(250);
}
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
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

console.log("\nBuild a kit\n");
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/kit` });
await wait(1800);
await ev(`(()=>{const g=document.querySelector(".ll-age,.age-gate,#llAge");if(g)g.remove();return 1})()`);

group("THE TYPES COME FROM THE ENDPOINT");
ok("every kit type is offered", (await ev(`document.querySelectorAll("#kTypes .k-type").length`)) === 5,
   String(await ev(`document.querySelectorAll("#kTypes .k-type").length`)));
ok("one is selected on load", (await ev(`document.querySelectorAll('#kTypes .k-type[aria-pressed="true"]').length`)) === 1);
ok("...and the controls are up", (await ev(`document.getElementById("kCtl").hidden`)) === false);

group("BUILDING ONE");
await ev(`(()=>{const b=[...document.querySelectorAll("#kTypes .k-type")].find(x=>x.dataset.type==="dab");b.click();return 1})()`);
await ev(`document.getElementById("kRoll").click()`);
await wait(1500);
ok("a kit rendered", (await ev(`document.querySelectorAll("#kOut .k-row").length`)) > 0,
   String(await ev(`document.querySelectorAll("#kOut .k-row").length`)));
ok("the required rig role is filled",
   /Dab Rig/i.test(await ev(`document.querySelector("#kOut").innerText`)));
ok("every row states WHY that part won",
   (await ev(`[...document.querySelectorAll("#kOut .k-row:not(.miss) .k-why")].every(e=>e.textContent.trim().length>3)`)));
ok("the rig total is shown", /\$\d/.test(await ev(`document.querySelector("#kOut .k-tot").innerText`)),
   await ev(`document.querySelector("#kOut .k-tot").innerText`));

group("SHOPS AND SHIPPING ARE STATED, NOT HIDDEN");
/* The torch is at a second shop with $6 shipping, so this kit MUST span two. */
ok("the shops are listed", (await ev(`document.querySelectorAll("#kOut .k-shop").length`)) >= 2,
   String(await ev(`document.querySelectorAll("#kOut .k-shop").length`)));
ok("...and the multi-shop cost is said out loud",
   /different shops/i.test(await ev(`document.querySelector("#kOut").innerText`)));

group("AN EMPTY ROLE IS RENDERED, NOT DROPPED");
/* A face that filters falsy products turns "could not fill" into a shorter,
   confident-looking kit. The bong type has roles this feed cannot fill. */
await ev(`(()=>{const b=[...document.querySelectorAll("#kTypes .k-type")].find(x=>x.dataset.type==="bong");b.click();return 1})()`);
await ev(`document.getElementById("kRoll").click()`);
await wait(1500);
ok("unfillable roles are drawn", (await ev(`document.querySelectorAll("#kOut .k-row.miss").length`)) > 0,
   String(await ev(`document.querySelectorAll("#kOut .k-row.miss").length`)));
ok("...and say so in words",
   /Nothing on the shelf fills this/i.test(await ev(`document.querySelector("#kOut").innerText`)));

group("THE SEED ROUND-TRIPS");
await ev(`(()=>{const b=[...document.querySelectorAll("#kTypes .k-type")].find(x=>x.dataset.type==="dab");b.click();return 1})()`);
await ev(`document.getElementById("kRoll").click()`);
await wait(1500);
const url1 = await ev(`location.search`);
ok("the address bar became the share link", /seed=\d+/.test(url1) && /type=dab/.test(url1), url1);
const names1 = await ev(`[...document.querySelectorAll("#kOut .k-name")].map(e=>e.textContent).join("|")`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/kit${url1}` });
await wait(2200);
await ev(`(()=>{const g=document.querySelector(".ll-age,.age-gate,#llAge");if(g)g.remove();return 1})()`);
const names2 = await ev(`[...document.querySelectorAll("#kOut .k-name")].map(e=>e.textContent).join("|")`);
ok("loading that link rebuilds the SAME kit", !!names1 && names1 === names2,
   names1 === names2 ? "identical" : (names1 || "").slice(0, 40) + " vs " + (names2 || "").slice(0, 40));

group("THE CART IS THE SITE'S OWN SHAPE");
await ev(`localStorage.removeItem("ll_cart")`);
await ev(`document.getElementById("kCart").click()`);
await wait(400);
const cart = await ev(`(()=>{try{return JSON.parse(localStorage.getItem("ll_cart")||"[]")}catch(e){return null}})()`);
ok("the kit went into ll_cart", Array.isArray(cart) && cart.length > 0, cart ? cart.length + " items" : "none");
const KEYS = ["id","name","store","storeKey","domain","cartDomain","platform","ref","refLink","coupon","url","price","size","variantId"];
ok("...in the engine's own item shape",
   Array.isArray(cart) && cart.every(c => KEYS.every(k => k in c)),
   cart && cart[0] ? Object.keys(cart[0]).join(",") : "");
ok("...and pressing again does not duplicate",
   await (async () => { await ev(`document.getElementById("kCart").click()`); await wait(300);
     const c2 = await ev(`(JSON.parse(localStorage.getItem("ll_cart")||"[]")).length`);
     return c2 === cart.length; })(), String(cart.length));

group("THE PAGE ITSELF");
ok("the canonical is /kit", (await ev(`(document.querySelector("link[rel=canonical]")||{}).href||""`)).endsWith("/kit"));
ok("theme-color agrees with the family ground",
   (await ev(`(document.querySelector("meta[name=theme-color]")||{}).content`)) === "#080f14");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(400);
ok("no horizontal overflow at 390px", await ev(`document.documentElement.scrollWidth <= 391`),
   String(await ev(`document.documentElement.scrollWidth`)));
ok("no uncaught errors", errs.length === 0, errs.slice(0, 2).join(" | "));

try { ch.kill() } catch {}
srv.close();
console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);

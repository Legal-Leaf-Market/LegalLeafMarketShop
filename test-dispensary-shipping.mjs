/* test-dispensary-shipping.mjs -- the dispensary's Ship-to filter (public/shop-dispensary.js) in real Chromium.
 *
 * Owner, 25 Nov 2026: "block the products by shipping state like we did on Nicotia Market." Pins:
 *   - a store's limits come only from its SHIPPING entry; with a state picked, a product the shop will
 *     not send there leaves the shelf, the counts and the store tile say so, and a note says how many;
 *   - the THCa list applies to THCa products only;
 *   - a store with no verified entry is never hidden, and the note says its checkout decides;
 *   - the choice is remembered (localStorage and ?ship=), survives "Clear filters", and
 *     "Show every state" undoes it.
 * The real file ships with every entry empty (no store's policy has been read yet), so the fixture
 * rule is substituted into the served copy here. Production carries no test hook.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3567, CDP = 9687;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x !== "" ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { const v = await fn(); if (v) return v; } catch {} await wait(150); } throw new Error("timeout"); }

const STORES = { thcasmallbuds: "THCA Small Buds", puffweiser: "Puffweiser", blacktiecbd: "Black Tie CBD" };
function prod(key, i) {
  return {
    id: key + "-" + i, name: STORES[key] + " Strain " + i, store: STORES[key], storeKey: key, domain: key + ".test",
    platform: "shopify", cannabinoid: key === "thcasmallbuds" && i === 0 ? "CBD" : "THCa", category: "THCA Flower",
    type: "Hybrid", grow: "Indoor", potency: 20, image: "/favicon.svg", url: "https://" + key + ".test/products/s" + i,
    description: "<p>x</p>", inStock: true, ship: 0, badges: [], added: 1000 + i,
    sizes: [["3.5g", 20 + i, 3.5, key + i + "a", true, null], ["1 oz", 100 + i, 28, key + i + "c", true, null]],
  };
}
const feed = (key) => ({ products: Array.from({ length: 8 }, (_, i) => prod(key, i)), meta: {} });

const RULE = "thcasmallbuds: { never: ['CA'], thca: ['ID'], source: 'https://fixture.test/shipping', checked: '2026-11-25' },";
const page = (src) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<div style="display:grid;grid-template-columns:1fr"><section><div id="ll-dispensary" data-stores="thcasmallbuds,puffweiser,blacktiecbd" data-api="http://127.0.0.1:${PORT}/api/products"></div></section></div>
<script src="${src}" defer></script></body></html>`;

const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/products") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(JSON.stringify(feed(u.searchParams.get("store"))));
  }
  if (u.pathname === "/real.js" || u.pathname === "/fixture.js") {
    let js = await readFile("public/shop-dispensary.js", "utf8");
    if (u.pathname === "/fixture.js") {
      const line = /^ {4}thcasmallbuds: null,.*$/m;
      if (!line.test(js)) throw new Error("SHIPPING entry for thcasmallbuds not found; update this test");
      js = js.replace(line, "    " + RULE);
    }
    res.writeHead(200, { "content-type": "text/javascript" }); return res.end(js);
  }
  if (u.pathname === "/favicon.svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(await readFile("public/favicon.svg")); }
  res.writeHead(200, { "content-type": "text/html" }); res.end(page(u.pathname === "/real" ? "/real.js" : "/fixture.js"));
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_lldship" });
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
await send("Runtime.enable"); await send("Page.enable");

async function boot(path = "/", width = 1280) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(() => ev(`document.querySelectorAll('#ll-dispensary .lld-card').length>0`));
}
const count = () => ev(`parseInt(document.querySelector('#ll-dispensary .lld-count span').textContent,10)`);
const note = () => ev(`(document.querySelector('.lld-shipnote')||{}).textContent||''`);
const tile = (k) => ev(`document.querySelector('.lld-st[data-store="${k}"] small').textContent`);
const pick = (v) => ev(`(function(){var s=document.querySelector('.lld-ship');s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);

console.log("\n-- no state picked --");
await boot(); await ev(`localStorage.clear()`); await boot();
ok("every product is on the shelf", (await count()) === 24, await count());
ok("no shipping note", (await note()) === "");
ok("the picker offers every state plus 'any'", (await ev(`document.querySelectorAll('.lld-ship option').length`)) === 52);

console.log("\n-- a state the shop never ships to --");
await pick("CA");
ok("the shop's products leave the shelf", (await count()) === 16, await count());
ok("none of them is left", !(await ev(`/Small Buds Strain/.test(document.querySelector('.lld-grid').textContent)`)));
ok("its tile says it doesn't ship there", /doesn.t ship to CA/.test(await tile("thcasmallbuds")), await tile("thcasmallbuds"));
ok("the note says how many were hidden and from whom", /8 from THCA Small Buds/.test(await note()), await note());
ok("and that the other two are unconfirmed", /not confirmed where Puffweiser, Black Tie CBD ship/.test(await note()));
ok("the other shops are untouched", /8 in stock/.test(await tile("puffweiser")));
ok("the address bar carries ?ship=CA", (await ev(`new URL(location.href).searchParams.get('ship')`)) === "CA");

console.log("\n-- a THCa-only limit --");
await pick("ID");
ok("THCa products leave, the CBD one stays", (await count()) === 17, await count());
ok("the CBD product is still listed", await ev(`/Small Buds Strain 0/.test(document.querySelector('.lld-grid').textContent)`));
ok("the tile shows what is left, not 'doesn't ship'", /1 in stock/.test(await tile("thcasmallbuds")), await tile("thcasmallbuds"));

console.log("\n-- remembered, and undone --");
await boot();
ok("the state survives a reload", (await ev(`document.querySelector('.lld-ship').value`)) === "ID" && (await count()) === 17);
await ev(`document.querySelector('.lld-chip[data-cat="THCA Flower"]').click()`);
await ev(`document.querySelector('.lld-count .lld-clear').click()`);
ok("Clear filters keeps the ship-to state", (await ev(`document.querySelector('.lld-ship').value`)) === "ID");
await ev(`document.querySelector('.lld-ship-any').click()`);
ok("Show every state brings everything back", (await count()) === 24 && (await note()) === "");
ok("and forgets the state", (await ev(`localStorage.getItem('ll_ship_state')`)) === '""');
await boot("/?ship=CA");
ok("a ?ship= link sets the state", (await count()) === 16);

console.log("\n-- the shipped file: nothing verified yet --");
await ev(`localStorage.clear()`); await boot("/real");
await pick("CA");
ok("with no verified entry nothing is hidden", (await count()) === 24, await count());
ok("and the note says every shop's checkout decides", /not confirmed where THCA Small Buds, Puffweiser, Black Tie CBD ship/.test(await note()), await note());

console.log("\n-- phone --");
await ev(`localStorage.clear()`); await boot("/", 390); await pick("CA");
ok("no horizontal page scroll at 390px", (await ev(`document.documentElement.scrollWidth<=window.innerWidth+1`)));
ok("no script errors", errs.length === 0, errs.join(" | "));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} failed:\n - ${fails.join("\n - ")}` : "\nall passed");
process.exit(fails.length ? 1 : 0);

/* test-concierge-pin-depth.mjs — pinning a listing that is deep in the shelf.
 *
 * REPORTED LIVE, TWICE, IN DIFFERENT CLOTHES. First: "showing 0 of 2" over two
 * Durban Poison listings, which was the pin not clearing the filters that were
 * already on. Fixed. Then: four blue bongs asked for, "showing 2 of 4" -- and
 * this one is depth, not exclusion.
 *
 * WHY THE NEEDLE IS NOT ENOUGH ON ITS OWN. The pin narrows the shelf by typing
 * the longest phrase every pinned NAME shares into the engine's own search box.
 * For four bongs from three different makers that phrase is "bong" -- the only
 * word they share -- so the shelf narrows to every bong on the site, still
 * hundreds. The sweep then pages forward, and it used to stop after 24 clicks of
 * 12: about 300 cards. Anything past that could not be placed.
 *
 * A PAGE COUNT WAS ALWAYS THE WRONG BOUND. The cost of a click is the cost of
 * re-rendering the FILTERED shelf, so once a needle has narrowed it the clicks
 * are cheap and 24 is absurdly conservative; with no needle they are dear and 24
 * is generous. One number cannot be right for both. The clock is the thing
 * actually being protected -- a tab that locks up -- so the sweep watches that.
 *
 * THE FIXTURE IS DELIBERATELY DEEPER THAN THE OLD CAP: one pinned listing sits
 * near the front and the other past card 300, so a suite run against the old
 * code reports 1 of 2. Verified that way round before this was written.
 *
 *     node test-concierge-pin-depth.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const PORT = 3546, CDP = 9664;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 120) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* 480 bongs, so the shelf is ~40 pages of 12 -- comfortably past the old cap.
   Gear, because gear is what the report was about and it carries no per-gram,
   which is also the ordering the real shelf gives these. */
const N = 480;
const SHOPS = [["Grasscity", "gc"], ["Chill Steel Pipes", "chill"], ["Lookah", "lookah"], ["Greek Glass", "greekglass"]];
const prod = (i) => {
  const [store, storeKey] = SHOPS[i % SHOPS.length];
  return {
    id: "b" + i, name: "Filler Beaker Bong No " + i, store, storeKey, domain: "e.test", platform: "shopify",
    cannabinoid: "Accessory", category: "Bongs & Rigs", group: "devices", type: "", strain: "",
    image: "/favicon.svg", gallery: [], url: "https://e.test/b" + i, brand: "B", brandKey: "b",
    description: "A bong.", inStock: true, startsAt: 40 + (i % 90), sale: 40 + (i % 90), ship: 0, badges: [],
    sizes: [["One Size", 40 + (i % 90), 0, "b" + i + "a", true, "https://e.test/b" + i, "", 0]],
  };
};
const PRODUCTS = Array.from({ length: N }, (_, i) => prod(i));
/* The two the model would pin. Same shared word ("Bong") and nothing else, which
   is exactly what forces the generic needle. One is cheap so it ranks early; the
   other is dear so it ranks last. */
PRODUCTS[3].name = "Chill Bong - Mix & Match - Gloss Blue & Cosmos Bong Combo";
PRODUCTS[3].startsAt = PRODUCTS[3].sale = 1;
PRODUCTS[N - 1].name = 'Lookah 9.5" Cool Blue Evil Eye Glass Beaker Bong';
PRODUCTS[N - 1].startsAt = PRODUCTS[N - 1].sale = 999;
const TARGETS = [PRODUCTS[3], PRODUCTS[N - 1]];
const FEED = {
  meta: { updated: new Date(0).toISOString(), total: N, stores: SHOPS.map(([name]) => ({ name, count: N / 4 })) },
  products: PRODUCTS,
};

const SSE = [
  "event: text\ndata: " + JSON.stringify({ text: "Pinned those." }),
  "event: action\ndata: " + JSON.stringify({
    tool: "pin_products", title: "Blue bongs",
    items: TARGETS.map((p) => ({ id: p.id, name: p.name, store: p.store })),
  }),
  "event: done\ndata: " + JSON.stringify({ stopReason: "end_turn", register: "budtender" }),
].join("\n\n") + "\n\n";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/concierge") {
    if ((req.method || "GET").toUpperCase() === "POST") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      return res.end(SSE);
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ reads: "calm", picks: [] }));
  }
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(/products|market|coldwater/.test(u.pathname) ? FEED : { p: {} }));
  }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  for (const c of [f, f + ".html"]) {
    try { const b = await readFile(join("public", c));
      res.writeHead(200, { "content-type": MIME[extname(c)] || "application/octet-stream" }); return res.end(b); } catch {}
  }
  res.writeHead(404).end("no");
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llpindepth" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find((x) => x.type === "page"); if (!p) throw 0; return p });
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = [];
s.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

console.log("\nPinning past the old page cap\n");
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await ev(`localStorage.setItem('ll_age_ok','1'); localStorage.setItem('ll_conc_reg','budtender')`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card[data-pid]').length`)) > 0) return true; throw 0 }, 100);
await wait(1500);

const shelf = await ev(`(function(){return {cards:document.querySelectorAll('#grid .card[data-pid]').length,
  more:!!document.querySelector('#grid > .loadmore')};})()`);
ok("the shelf is paged, not fully rendered", shelf.more === true, JSON.stringify(shelf));

/* THE DEEP ONE MUST REALLY BE DEEP, or this suite proves nothing: it would pass
   against the old 24-click cap too. Counted by paging to it and reporting how
   many cards it took, then reloading to put the shelf back. */
const depth = await ev(`(function(){
  var want=${JSON.stringify(TARGETS[1].id)};
  for (var i=0;i<200;i++){
    if (document.querySelector('#grid .card[data-pid="'+want+'"]')) break;
    var b=document.querySelector('#grid > .loadmore'); if(!b) break; b.click();
  }
  return {cards:document.querySelectorAll('#grid .card[data-pid]').length,
          found:!!document.querySelector('#grid .card[data-pid="'+want+'"]')};})()`);
ok("the second target really does sit past the old ~300-card cap",
   depth.found && depth.cards > 300, JSON.stringify(depth));

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card[data-pid]').length`)) > 0) return true; throw 0 }, 100);
await wait(1500);

await ev(`(function(){ var f=document.querySelector('.llc-fab'); if(f) f.click(); })()`);
await wait(700);
await ev(`(function(){ var t=document.getElementById('llcIn'); if(t){ t.value='four blue bongs please'; }
  var g=document.getElementById('llcGo'); if(g) g.click(); })()`);
await wait(3000);

const sweep = await ev(`JSON.stringify(window.LL_pinLast||null)`);
console.log("  sweep: " + sweep);
const bar = await ev(`(document.getElementById("ll-pinbar")||{}).textContent || ""`);
ok("the pin ran", /Blue bongs/.test(bar), JSON.stringify(bar.slice(0, 80)));
ok("both listings are placed, however deep the second one was",
   /showing 2 of 2/.test(bar), JSON.stringify(bar.slice(0, 110)));
ok("...so it makes no excuse about reach", !/could not place/.test(bar));

const vis = await ev(`[].slice.call(document.querySelectorAll("#grid > .card"))
  .filter(function(c){ return getComputedStyle(c).display !== "none"; }).length`);
ok("and exactly the two are on screen", vis === 2, String(vis));

/* THE NEEDLE IS THE GENERIC ONE, which is what made this hard. Asserted so a
   future change that "fixes" this by picking a cleverer needle does not quietly
   remove the depth coverage this suite exists for. */
const q = await ev(`(document.getElementById("q")||{}).value || ""`);
ok("the shelf was narrowed by the only word the two names share",
   String(q).toLowerCase() === "bong", JSON.stringify(q));

/* THE BUDGET MUST NOT BE WHAT STOPPED IT. A pass that only just fits is a
   flake on a slower machine, and the diagnostic is there precisely so this can
   be asserted rather than inferred from the count. */
const sw = JSON.parse(sweep || "null");
ok("the sweep finished because it found them, not because time ran out",
   !!sw && sw.found === sw.want && sw.hitBudget === false, sweep);

ok("no page exceptions", errs.length === 0, errs.slice(0, 2).join(" | "));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall good");
process.exit(fails.length ? 1 : 0);

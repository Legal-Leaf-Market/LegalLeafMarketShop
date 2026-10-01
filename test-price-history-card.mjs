/* THE CARD HALF OF "CHEAPEST WE'VE SEEN".

   api/price-history.js records; this is what a shopper reads. The recorder was
   pinned when it shipped and every bug in it was silent; the display's failures
   are worse, because a wrong all-time low is the one number on this site
   somebody would screenshot and it is permanent in a way a wrong current price
   is not.

   THE FOUR THINGS THAT FAIL SILENTLY, and each of them looks like the feature
   working:

     1. NOT ENOUGH READINGS. A product seen twice has a low equal to its price.
        "Cheapest we have ever seen: exactly what it costs now" is true, useless
        and indistinguishable from a real claim.
     2. A PRICE THAT NEVER MOVED. This is the gate that decides whether the
        feature is worth having at all. Most prices do not move, so without it
        every card grows a gold badge three nights after the recorder starts,
        and a badge on everything is a badge on nothing. The suite therefore
        asserts a NEGATIVE on the common case, which is the assertion most
        likely to be deleted by somebody "fixing" a chip that will not appear.
     3. A STALE RECORD. The map is folded nightly, the shelf is scraped
        continuously. `atLow` in the record can be hours out of date, so the
        chip is decided against the LIVE feed instead -- and the record's own
        atLow is deliberately not consulted. Delete that and the chip claims an
        all-time low over a price that went up this morning.
     4. THE ROW LAYOUT DRIFTING. The block cannot import from api/ (the same
        wall behind public/js/overrides.js porting _applyOv and the collector
        porting rscRoots), and every twin in this repo has drifted at least
        once. So the endpoint publishes `cols` and the block looks names up in
        it -- and this suite reads BOTH files and holds the names together.
        Rename a column upstream and this goes red instead of the shelf going
        quiet.

   Half of it runs with no browser, because "the names agree" and "the chip is
   on the card" are two different claims.

     node test-price-history-card.mjs
*/
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const CHROME = chromePath();
const PORT = 3537, CDP = 9366;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

const HTML = await readFile("public/index.html", "utf8");
const REC = await readFile("api/price-history.js", "utf8");

/* The block, isolated. A document-wide regex goes green against the prose in a
   neighbouring block -- this file's own header names every gate it checks -- so
   the window is cut to the script tag and its comments are stripped before
   anything is asked of it. An empty window would pass every negative
   assertion vacuously, so the length is asserted first. */
const BLOCK = (HTML.match(/<script id="ll-price-history">([\s\S]*?)<\/script>/) || [, ""])[1];
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("\n-- the block exists at all --");
ok("ll-price-history block found", BLOCK.length > 2000, BLOCK.length + " chars");
ok("stripping comments left real code", CODE.length > 1500, CODE.length + " chars");
ok("ll-price-history-style block found", /<style id="ll-price-history-style">/.test(HTML));

console.log("\n-- gate 4: the row layout is looked up, never counted --");
const { COLS, priceOf: recPriceOf } = await import("./api/price-history.js");
ok("api/price-history.js exports COLS", Array.isArray(COLS) && COLS.length === 7, JSON.stringify(COLS));
const asked = [...CODE.matchAll(/\bg\(\s*"([a-zA-Z]+)"\s*\)/g)].map(m => m[1]);
ok("the block asks for columns by name", asked.length >= 6, asked.join(","));
const unknown = [...new Set(asked)].filter(k => !COLS.includes(k));
ok("every column the card asks for exists upstream", unknown.length === 0, unknown.length ? "missing: " + unknown.join(",") : COLS.join(","));
ok("the lookup goes through cols", /cols\.indexOf\(/.test(CODE));
/* row[0] would be the drift this whole arrangement exists to prevent. */
ok("no hardcoded row index", !/\brow\s*\[\s*\d/.test(CODE));

console.log("\n-- gate 4b: priceOf is the same expression the recorder records on --");
const norm = s => s.replace(/\s+/g, "");
const grab = src => norm((src.match(/Number\(\s*\(p\s*&&\s*\(([^)]*)\)\s*\)[^)]*\)/) || [, ""])[1]);
const a = grab(REC), b = grab(CODE);
ok("recorder's price expression read", a.length > 5, a);
ok("card's price expression read", b.length > 5, b);
ok("the two agree", a === b, a + "  vs  " + b);

console.log("\n-- the endpoint publishes cols --");
const mod = await import("./api/price-history.js");
let sent = null;
await mod.default({ method: "GET", query: {}, headers: {} }, {
  setHeader() {}, status() { return this }, json(j) { sent = j; return j },
});
ok("GET carries cols", Array.isArray(sent && sent.cols) && sent.cols.join() === COLS.join(), JSON.stringify(sent && sent.cols));

/* ------------------------------------------------------------------ browser */
const DAY = 86400000, today = Math.floor(Date.now() / DAY);
function prod(id, name, price) {
  return {
    id, name, store: "Test Shop", storeKey: "t", domain: "e.test", platform: "shopify",
    cannabinoid: "THCa", category: "THCA Flower", type: "Indica", strain: name,
    image: "/favicon.svg", url: "https://e.test/p/" + id, brand: "B", brandKey: "b",
    description: "Sentences about " + name + ".", inStock: true,
    startsAt: price, sale: price, perG: price / 28, ship: 5, badges: [], subTags: { trim: false },
    sizes: [["1 oz", price, 28, id + "o", true, "https://e.test/p/" + id, "", 0]]
  };
}
/* Six products, one per outcome. Each carries a DIFFERENT live price from the
   next so a chip landing on the wrong card cannot read as a pass. */
const FEED = {
  meta: { updated: new Date(0).toISOString(), total: 6, stores: [{ name: "Test Shop", count: 6 }] },
  products: [
    prod("pmove", "Moved Kush", 25),      /* at its low, and it has moved      -> CHIP */
    prod("pflat", "Flat Haze", 26),       /* never moved                       -> no chip */
    prod("pthin", "Thin Record OG", 27),  /* moved and low, but only 2 readings -> no chip */
    prod("pstale", "Stale Claim Diesel", 33), /* record says low, live says no  -> no chip */
    prod("pnew", "New Low Cookies", 19),  /* live UNDER the recorded low        -> CHIP */
    prod("pnone", "Unrecorded Glue", 31), /* no record at all                   -> no chip */
  ]
};
/* [low, lowAt, high, highAt, last, lastAt, n] */
const HIST = {
  v: 1, cols: COLS, updated: Date.now(), products: 5,
  p: {
    pmove:  [25, today - 3, 40, today - 20, 25, today, 12],
    pflat:  [26, today - 30, 26, today - 30, 26, today, 30],
    pthin:  [27, today - 1, 44, today - 2, 27, today, 2],
    pstale: [25, today - 9, 50, today - 40, 25, today - 1, 15],
    pnew:   [25, today - 5, 40, today - 30, 25, today, 12],
  }
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/price-history") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(HIST));
  }
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(/products|coldwater|market/.test(u.pathname) ? FEED : {}));
  }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llphist" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const pg = j.find(x => x.type === "page"); if (!pg) throw 0; return pg; });
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
/* Google Fonts stalls every script behind it for ~13s from the containers this
   repo is edited in; bigcartel is a real merchant public/engine.js refreshes
   Greek Glass from, and no suite here calls a real shop. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

for (let i = 0; i < 2; i++) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
  await ev(`localStorage.setItem('ll_age_ok','1')`);
}
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
/* The block draws only once BOTH reads have landed, which is the point of gate
   3 -- so wait for the function it publishes rather than for a timer. */
await until(async () => { if (await ev(`typeof window.LL_priceHistoryHTML==="function"`)) return true; throw 0 }, 80);
/* SOFT, and deliberately: the block paints once on load and then only from its
   MutationObserver, and the engine fills #grid asynchronously -- so removing
   that observer makes the FIRST chip never appear, not merely the reapplied
   one. A hard wait here dies with a stack trace and takes every later
   assertion's message with it; this reports the failure by name. */
const painted = await (async () => { try { await until(async () => {
  if (await ev(`!!document.querySelector('.card[data-pid="pmove"] .ll-lowtag')`)) return true; throw 0 }, 60); return true;
} catch { return false } })();
ok("a chip is painted at all", painted, painted ? "" : "no .ll-lowtag ever appeared - is the MutationObserver still armed?");

const tag = pid => ev(`(function(){var c=document.querySelector('.card[data-pid=${JSON.stringify(pid)}]');
  if(!c) return "NO CARD"; var t=c.querySelector('.ll-lowtag');
  return t ? {label:t.querySelector('b').textContent, price:t.querySelector('i').textContent, title:t.getAttribute('title')||""} : null; })()`);
const back = pid => ev(`window.LL_priceHistoryHTML(${JSON.stringify(pid)})`);

console.log("\n-- the chip appears exactly where the claim is true --");
const move = await tag("pmove");
ok("moved + enough + at low: chip is up", !!move && move.label === "Lowest we've seen", JSON.stringify(move));
ok("and it names the price, not just the claim", move && move.price === "$25.00", move && move.price);
ok("its tooltip carries the count and the high", !!move && /12 times/.test(move.title) && /\$40\.00/.test(move.title), move && move.title);

const nu = await tag("pnew");
ok("a live price UNDER the record is still a low", !!nu, JSON.stringify(nu));
ok("and the chip shows the live price, not the stored one", nu && nu.price === "$19.00", nu && nu.price);

console.log("\n-- and nowhere else, which is the half that decides the feature --");
ok("gate 2: a price that never moved gets no chip", (await tag("pflat")) === null);
ok("gate 1: two readings is not a history", (await tag("pthin")) === null);
ok("gate 3: a stale record does not outrank the live price", (await tag("pstale")) === null);
ok("a product with no record is untouched", (await tag("pnone")) === null);

console.log("\n-- the back panel says what the front will not --");
const bMove = await back("pmove"), bFlat = await back("pflat"), bStale = await back("pstale");
const bThin = await back("pthin"), bNone = await back("pnone");
ok("moved: cheapest and highest are both stated", /Cheapest we’ve seen/.test(bMove) && /Highest we’ve seen/.test(bMove) && /\$40\.00/.test(bMove), bMove.slice(0, 90));
ok("moved + at low: it says so in words", /lowest price we have recorded/.test(bMove));
ok("flat: 'steady at', and never dressed as a deal", /Steady at/.test(bFlat) && !/Cheapest/.test(bFlat) && !/lowest price we have recorded/.test(bFlat), bFlat.slice(0, 90));
ok("stale: the record prints, the low claim does not", /Cheapest we’ve seen/.test(bStale) && !/lowest price we have recorded/.test(bStale));
ok("stale: it says how far off the high it is", /below its high/.test(bStale), (bStale.match(/>[^<]*below its high[^<]*/) || [""])[0]);
ok("gate 1 covers the back too", bThin === "");
ok("no record, no panel", bNone === "");
ok("the reading count travels with every claim", /From 12 readings/.test(bMove) && /From 30 readings/.test(bFlat));

console.log("\n-- it reaches a real card back, not just a string --");
/* .cimg, not .cname: the picture is the flip target and the body now opens
   /p/<id>, so clicking the name here would navigate away and the assertions
   below would read an empty grid as a missing history panel. */
await ev(`document.querySelector('.card[data-pid="pmove"] .cimg').click()`);
await wait(300);
const inBack = await ev(`(function(){var b=document.querySelector('.card[data-pid="pmove"] .llflip-back .llb-hist');
  return b?b.textContent.replace(/\\s+/g," ").trim():""; })()`);
ok("flipping the card prints the history on it", /Cheapest/.test(inBack) && /\$25\.00/.test(inBack), inBack.slice(0, 110));
ok("and it sits under the spec list", await ev(`(function(){var i=document.querySelector('.card[data-pid="pmove"] .llb-in');
  if(!i) return false; var k=[...i.children].map(function(n){return n.className});
  return k.indexOf("llb-hist") > k.indexOf("llb-spec") && k.indexOf("llb-spec") >= 0; })()`));

console.log("\n-- it survives the grid re-rendering, which it does constantly --");
await ev(`(function(){var q=document.getElementById("q"); q.value="Moved"; q.dispatchEvent(new Event("input",{bubbles:true}));})()`);
await wait(600);
ok("chip is still up after a search re-render", !!(await tag("pmove")));
await ev(`(function(){var q=document.getElementById("q"); q.value=""; q.dispatchEvent(new Event("input",{bubbles:true}));})()`);
await wait(600);
ok("and the negatives are still negative after it", (await tag("pflat")) === null && (await tag("pstale")) === null);
ok("no chip is ever drawn twice on one card",
  (await ev(`[...document.querySelectorAll('#grid .card[data-pid]')].every(function(c){return c.querySelectorAll('.ll-lowtag').length<=1})`)) === true);

console.log("\n-- and it is quiet --");
ok("no uncaught exceptions", errs.length === 0, errs.join(" | ").slice(0, 200));

try { ch.kill() } catch {}
srv.close();
console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All price-history card checks passed."}`);
process.exit(fails.length ? 1 : 0);

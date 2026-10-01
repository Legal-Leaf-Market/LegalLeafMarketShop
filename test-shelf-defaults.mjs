/* What a first-time visitor lands on.

   Filters collapsed, sorted by Best $/g, and NOTHING FILTERED OUT.

   IT USED TO OPEN ON Ounce+, A $75 BUDGET, CBD OFF AND TRIM OFF, and between
   them those four hid most of the catalogue from a visitor who had asked for
   nothing -- reported as "too many products are being hidden as cbd or trim to
   start off". The load is a fresh clear-all state now, on the hemp shelf and on
   all three city pages, and every one of those filters is one click away in a
   panel the button offers to open.

   SORT IS NOT A FILTER and stays: ordering by best price per gram hides
   nothing, it is the whole proposition of the site, and a first screen sorted
   by "newest" answers a question nobody asked either.

   ALL OF IT ALREADY WORKED AND NONE OF IT WAS PINNED, which is the reason this
   suite exists. The engine's own defaults are the opposite -- sort "newest",
   inclCBD true, inclTrim true, panel open -- and the homepage block overrides
   them by driving the engine's OWN controls, because engine state is
   closure-scoped inside the blob and unreachable (CLAUDE.md section 5). That is
   the right approach and it rests entirely on control ids the engine owns:
   #fSort, #inclCBD, #inclTrim, #filterPanel, #fMinQty, #fBudget. Rename any one
   of them in an engine re-cut and the shop front silently opens splayed wide,
   sorted by newest, with CBD and shake diluting every comparison. Nothing
   errors. Nobody finds out.

   FOUR MOMENTS, because a default that holds at load and not afterwards is
   worse than no default: at first paint, once the live feed hot-swaps in, after
   a filter moves, and on a phone -- where .hidden is deliberately NOT the
   mechanism and the whole .filterwrap is a drawer parked off-screen instead.

   AND HIDDEN IS NOT REMOVED. CBD and Trim/Shake are off on arrival and one
   click away, which is a different claim from the class being set, so both are
   driven through the grid.

     node test-shelf-defaults.mjs
*/
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const CHROME = chromePath();
const PORT = 3499, CDP = 9353;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* One ordinary flower product, one CBD, one shake -- each priced so it clears
   the Ounce+ and $75 defaults, or it would be filtered out for the wrong reason
   and the CBD assertion would pass against an empty grid. */
function prod(id, name, cann) {
  return {
    id, name, store: "Test Shop", storeKey: "t", domain: "e.test", platform: "shopify",
    cannabinoid: cann || "THCa", category: "THCA Flower", type: "Indica", strain: name,
    image: "/favicon.svg", url: "https://e.test/p/" + id, brand: "B", brandKey: "b",
    description: "Sentences.", inStock: true, startsAt: 25, sale: 25, perG: 0.89,
    ship: 5, badges: [], subTags: { trim: /shake|trim/i.test(name) },
    sizes: [["1 oz", 25, 28, id + "o", true, "https://e.test/p/" + id, "", 0]]
  };
}
const FEED = {
  meta: { updated: new Date(0).toISOString(), total: 3, stores: [{ name: "Test Shop", count: 3 }] },
  products: [prod("a", "Alpha Gelato"), prod("b", "Beta Tincture", "CBD"), prod("c", "Gamma Shake")]
};
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const ROUTES = { "/": "index.html", "/coldwater": "coldwater.html" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(/products|coldwater/.test(u.pathname) ? FEED : {}));
  }
  const f = ROUTES[u.pathname] || u.pathname.replace(/^\//, "");
  try {
    const b = await readFile(join("public", f));
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(b);
  } catch { res.writeHead(404).end("no"); }
});
await new Promise(r => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llshelf" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const pg = j.find(x => x.type === "page"); if (!pg) throw 0; return pg; });
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
/* Google Fonts stalls every script behind it for ~13s from the containers this
   repo is edited in; bigcartel is a real merchant public/engine.js refreshes
   Greek Glass from, and no suite here calls a real shop. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });

async function goto(path, metrics) {
  await send("Emulation.setDeviceMetricsOverride", metrics);
  for (let i = 0; i < 2; i++) {
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
    await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
    await ev(`localStorage.setItem('ll_age_ok','1')`);
  }
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card').length`)) > 0) return true; throw 0 }, 80);
}
const DESKTOP = { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

const snap = () => ev(`(function(){
  var p=document.getElementById("filterPanel"), l=document.getElementById("filterToggleTxt");
  var cbd=document.getElementById("inclCBD"), tr=document.getElementById("inclTrim");
  return {hidden:!!(p&&p.classList.contains("hidden")),
          label:(l?l.textContent:"").trim(),
          cbdOn:!!(cbd&&cbd.classList.contains("on")),
          trimOn:!!(tr&&tr.classList.contains("on")),
          sort:(document.getElementById("fSort")||{}).value,
          minQty:(document.getElementById("fMinQty")||{}).value,
          budget:(document.getElementById("fBudget")||{}).value};})()`);
const names = () => ev(`[].map.call(document.querySelectorAll('#grid .card .cname'),function(n){return n.textContent.trim()})`);

console.log("\nWhat a first-time visitor lands on\n");

console.log("ON ARRIVAL");
await goto("/", DESKTOP);
let st = await snap();
ok("the filter panel is collapsed", st.hidden === true, JSON.stringify(st));
ok("...and the button offers to show it", /show/i.test(st.label), st.label);
ok("sorted by best price per gram, not by newest", st.sort === "pergram", st.sort);
ok("no quantity floor is applied", st.minQty === "0" || !st.minQty, st.minQty);
ok("...and no budget", !st.budget || st.budget === "0", st.budget);
ok("CBD is INCLUDED", st.cbdOn === true, JSON.stringify(st));
ok("Trim/Shake is INCLUDED", st.trimOn === true, JSON.stringify(st));
/* The toggle being on and the product being on the shelf are two different
   claims, and the second is the one that was reported. */
let n = await names();
ok("...and a CBD product is actually on the shelf", n.some(x => /Beta/.test(x)), n.join(" | "));
ok("...and a shake one too", n.some(x => /Gamma/.test(x)), n.join(" | "));
ok("along with ordinary flower", n.some(x => /Alpha/.test(x)), n.join(" | "));
/* THE WHOLE FIXTURE, because "nothing is hidden" is a claim about the total,
   not about three names. */
ok("nothing in the feed is filtered out on arrival",
   ["Alpha", "Beta", "Gamma"].every(x => n.some(y => y.includes(x))), n.join(" | "));

console.log("\nAND IT STAYS THAT WAY");
/* The two moments a re-render could quietly reopen it: the live hot swap, and
   any filter change, both of which rebuild the facets. */
await wait(2500);
st = await snap();
ok("still collapsed once the live feed has landed", st.hidden === true, JSON.stringify(st));
ok("...and still sorted by best $/g", st.sort === "pergram", st.sort);
ok("...and still hiding nothing", st.cbdOn === true && st.trimOn === true, JSON.stringify(st));
await ev(`(function(){var s=document.getElementById("fStore");
  s.value=s.options[1]?s.options[1].value:""; s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
await wait(400);
st = await snap();
ok("still collapsed after a filter moves", st.hidden === true, JSON.stringify(st));
ok("...with CBD and Trim still included", st.cbdOn === true && st.trimOn === true);
await ev(`(function(){var b=document.getElementById("clearStores"); if(b) b.click();
  var s=document.getElementById("fStore"); s.value=""; s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
await wait(300);

console.log("\nCOLLAPSED IS NOT UNREACHABLE");
await ev(`(function(){var b=document.getElementById("toggleFilters"); if(b) b.click();})()`);
await wait(300);
st = await snap();
ok("the toggle opens the panel", st.hidden === false, JSON.stringify(st));
ok("...and the button now offers to hide it", /hide/i.test(st.label), st.label);
await ev(`(function(){var b=document.getElementById("toggleFilters"); if(b) b.click();})()`);
await wait(200);

console.log("\nAND THE FILTERS STILL WORK");
/* Showing everything on arrival must not mean the filters stopped filtering --
   which is the failure mode of "just remove the defaults". */
await ev(`(function(){var c=document.getElementById("inclCBD"); if(c) c.click();})()`);
await wait(400);
n = await names();
ok("one click hides CBD", !n.some(x => /Beta/.test(x)), n.join(" | "));
await ev(`(function(){var c=document.getElementById("inclTrim"); if(c) c.click();})()`);
await wait(400);
n = await names();
ok("...and one click hides Trim/Shake", !n.some(x => /Gamma/.test(x)), n.join(" | "));
ok("...while ordinary flower stays", n.some(x => /Alpha/.test(x)), n.join(" | "));
/* Back on, so the phone pass below reads an untouched page. */
await ev(`(function(){var a=document.getElementById("inclCBD"), b=document.getElementById("inclTrim");
  if(a) a.click(); if(b) b.click();})()`);
await wait(300);

console.log("\nTWO THINGS IT MUST NOT DO");
/* Both were reasoned about in the block's own comment and both regress
   silently, which is exactly why they are asserted rather than trusted. */
/* SCOPED TO THE CODE, NOT THE BLOCK. The block's own comment argues about
   #toggleFilters and #bestDeals BY NAME while explaining why it never clicks
   them, so a whole-block regex goes red against the prose describing the very
   behaviour it is asserting. That has happened here before -- see the /library
   note in tools/make-coldwater.mjs, same trap. The window therefore starts at
   the IIFE, after the comment ends. */
const src = readFileSync("public/index.html", "latin1");
const head = src.indexOf("HOMEPAGE DEFAULTS");
const open = src.indexOf("(function(){", src.indexOf("======= */", head));
const block = src.slice(open, src.indexOf("\n})();", open) + 6);
ok("the defaults block was located, so the checks below are not vacuous",
   open > head && block.length > 400 && /filterPanel/.test(block), block.length + " chars");
/* #toggleFilters is ALSO bound to openSidebar() by the mobile drawer script, so
   a synthetic click would slide the filters open on every phone -- the exact
   opposite of the ask. */
ok("it never clicks #toggleFilters", !/toggleFilters/.test(block));
/* #bestDeals fires a toast reading "Sorted by best $/g", which would pop on
   every single page load. Setting #fSort reaches the same state silently. */
ok("it never clicks #bestDeals", !/bestDeals/.test(block));
/* The engine's toggle handler flips whatever it finds, so a blind click would
   turn CBD back ON if the engine ever ships it off by default. */
/* The mirror of what it used to be: the engine's handler flips whatever it
   finds, so a blind click would turn OFF a toggle that already arrived on. */
ok("the toggles are clicked only while still off",
   /!cbd\.classList\.contains\("on"\)\) cbd\.click\(\)/.test(block) &&
   /!trim\.classList\.contains\("on"\)\) trim\.click\(\)/.test(block));

console.log("\nON A PHONE THE MECHANISM IS DIFFERENT");
/* Mobile CSS neutralises .hidden (display:block!important) because there the
   whole .filterwrap IS the drawer -- so "collapsed" has to be measured as
   "parked off-screen", not as a class. */
await goto("/", PHONE);
const drawer = await ev(`(function(){
  var w=document.querySelector(".filterwrap");
  if(!w) return null;
  var r=w.getBoundingClientRect();
  return {onScreen: r.right>0 && r.left<window.innerWidth && r.height>0,
          left:Math.round(r.left), width:Math.round(r.width),
          overflowX: document.documentElement.scrollWidth > window.innerWidth+1};})()`);
ok("the filter drawer is parked off-screen", drawer && drawer.onScreen === false, JSON.stringify(drawer));
ok("...and does not push the page sideways", drawer && drawer.overflowX === false, JSON.stringify(drawer));
st = await snap();
ok("nothing is hidden on a phone either", st.cbdOn === true && st.trimOn === true, JSON.stringify(st));

console.log("\nA CITY PAGE INHERITS ALL OF IT");
/* Including the clear-all, which a walk-in shopper needs at least as much as a
   mail-order one: they are standing in a shop looking for what is on the shelf,
   not running somebody else's search. */
/* coldwater.html is generated FROM index.html, so this block travels with it --
   asserted rather than assumed, because the generator rewrites a lot on the way
   through and #fMinQty and #fBudget are among the things it touches. */
await goto("/coldwater", DESKTOP);
st = await snap();
ok("the panel is collapsed on a city page", st.hidden === true, JSON.stringify(st));
ok("...sorted by best $/g", st.sort === "pergram", st.sort);
ok("...with CBD and Trim included", st.cbdOn === true && st.trimOn === true, JSON.stringify(st));
/* Inherited from index.html now rather than corrected here: the generator's own
   cw-defaults block used to wait for the grid and clear these, and a copy of a
   rule is only ever one edit away from silently overriding the original. */
ok("...and no quantity floor, inherited rather than corrected on the way through",
   st.minQty === "0" || st.minQty === "" || st.minQty == null, String(st.minQty));
ok("...nor a budget", !st.budget || st.budget === "0", String(st.budget));

ok("no uncaught errors on any of it", errs.length === 0, errs.slice(0, 2).join(" | "));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : "All assertions passed.") + "\n");
try { s.close() } catch {}
ch.kill(); srv.close();
process.exit(fails.length ? 1 : 0);

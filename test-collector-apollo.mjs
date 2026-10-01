/* test-collector-apollo.mjs — the richest source on a Dutchie menu, invisible.
 *
 * FROM A LIVE READ OF A DUTCHIE MENU: __APOLLO_CLIENT__.cache.extract() held
 * 145 fully structured products -- names, brands, categories, weights, pricing,
 * specials -- against ~100 partially rendered DOM cards, and the collector
 * reported bestArray:0, fromState:0 and fell through to React props at 3 hits.
 *
 * TWO REASONS IT WAS INVISIBLE, and a fixture has to reproduce both or it
 * passes against the bug:
 *
 *   1. IT IS BEHIND A METHOD CALL. The window scan does pick up
 *      __APOLLO_CLIENT__ -- it matches the key test and it is an object -- but
 *      the products live inside an InMemoryCache and only come out of
 *      cache.extract(), which no property walk will ever call.
 *   2. WHAT COMES OUT IS A MAP, NOT AN ARRAY. Normalised, keyed
 *      "Product:abc123", so the largest-product-shaped-ARRAY contest cannot see
 *      it even once it is in hand.
 *
 * And a third that only bites downstream: nested objects are replaced with
 * {__ref:"Product:x"} pointers, so an unresolved product's variants read as a
 * list of pointers and no price is found -- indistinguishable from a menu that
 * does not publish sizes.
 *
 * THE FIXTURE IS BUILT TO LOSE WITHOUT THE FIX: a decoy array of tier rows sits
 * in __NEXT_DATA__ so there IS something for the old readers to find, and the
 * assertion is a NUMBER -- 40 strains, not 3.
 *
 *   node test-collector-apollo.mjs
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3251, CDP = 9651;
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

/* A normalised Apollo cache, the shape extract() really returns: products keyed
   by typename:id, their variants held as __ref pointers into the same map. */
const N = 40;
const cache = { ROOT_QUERY: { __typename: "Query", "menu({})": { __ref: "Menu:1" } }, "Menu:1": { __typename: "Menu" } };
for (let i = 0; i < N; i++) {
  const pid = "Product:p" + i, vid = "Variant:v" + i;
  cache[vid] = { __typename: "Variant", id: "v" + i, option: "3.5g", price: 30 + (i % 15) };
  cache[pid] = {
    __typename: "Product", id: "p" + i,
    name: "Apollo Strain " + i,
    brand: "House Brand", category: "Flower",
    slug: "apollo-strain-" + i,
    url: "https://shop.example/product/apollo-strain-" + i,
    /* THE POINTER, which is the third trap: unresolved, this is a list of refs
       and no price is found. */
    variants: [{ __ref: vid }],
  };
}

/* THE DECOY. Without something for the old readers to find, this suite would
   pass merely because nothing else answered -- and the live failure had exactly
   this shape: a small array WAS found and won. */
const decoy = { props: { pageProps: { priceTiers: [
  { name: "Ounce (28g)", weight: 28, price: 5000 },
  { name: "Half (14g)",  weight: 14, price: 2800 },
  { name: "Eighth (3.5g)", weight: 3.5, price: 900 },
] } } };

const page = `<!doctype html><html><head><title>Menu</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(decoy)}</script>
<div id="menu">rendered cards would be here</div>
<script>
  // The client object, with the cache reachable only through extract().
  window.__APOLLO_CLIENT__ = {
    cache: { extract: function () { return ${JSON.stringify(cache)}; } }
  };
</script>
</body></html>`;

const srv = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" }); res.end(page);
}).listen(PORT);

/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llapollo" });

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

console.log("\nApollo's cache: a map, behind a method call\n");

await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/menu` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
/* The batch accumulates for 18 hours, so a previous run would otherwise walk
   into this one -- the lesson test-collector-remix.mjs learned the hard way. */
await ev(`localStorage.clear(); true`);
await send("Runtime.evaluate", { expression: COLLECTOR });
await wait(2500);

const got = await ev(`(function(){
  var rows = (window.__LL_COLLECT__ && window.__LL_COLLECT__.batchList()) || [];
  var d = (window.__LL_COLLECT__ && window.__LL_COLLECT__.diag && window.__LL_COLLECT__.diag()) || {};
  function priced(r){
    return (r.sizes || []).some(function(z){ return z && z.price > 0; });
  }
  return JSON.stringify({
    total: rows.length,
    apolloNamed: rows.filter(function(r){ return String(r.name||"").indexOf("Apollo Strain") === 0; }).length,
    tiers: rows.filter(function(r){ return /Ounce|Eighth|Half/.test(String(r.name||"")); }).length,
    withPrice: rows.filter(priced).length,
    withGrams: rows.filter(function(r){ return (r.sizes||[]).some(function(z){ return z && z.grams > 0; }); }).length,
    apolloDiag: d.apollo || 0,
    sample: rows.slice(0,2).map(function(r){ return r.name + "|" + JSON.stringify(r.sizes||[]); })
  });
})()`);
const G = JSON.parse(String(got));

console.log("== the cache is read at all ==");
ok("the collector reports reading Apollo entries", G.apolloDiag > 0, String(G.apolloDiag));

console.log("\n== forty strains, not three tiers ==");
/* THE NUMBER IS THE ASSERTION. Against the unfixed collector the decoy wins and
   this is 3 -- which is a working capture of the wrong thing. */
ok("all forty Apollo products are found", G.apolloNamed === N, G.apolloNamed + " of " + N);
ok("...and the decoy price tiers did not win the contest", G.tiers === 0, String(G.tiers));

console.log("\n== the __ref pointers were resolved, so prices survive ==");
/* Unresolved, `variants` is a list of {__ref} and no price is found -- which
   looks exactly like a menu that does not publish sizes. */
ok("every row carries a real price", G.withPrice === G.total && G.total > 0,
   G.withPrice + " of " + G.total);
ok("...and a weight, so price-per-gram computes", G.withGrams === G.total,
   G.withGrams + " of " + G.total);
ok("a sampled row looks like a product, not a pointer",
   !/__ref/.test(String(G.sample.join(" "))), String(G.sample[0] || "").slice(0, 110));

s.close(); ch.kill(); srv.close();
console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

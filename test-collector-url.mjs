/* test-collector-url.mjs — a relative href is a link; a bare slug is not.
 *
 * THE OTHER HALF OF "it scraped everything perfectly and then only sent 14".
 * The collector's product-url line handled exactly one relative form:
 *
 *     if (href && href.charAt(0) === "/") href = location.origin + href;
 *
 * So "products/tear-gas-9", "./x" and "../menu/x" travelled unresolved. They
 * pass for links on the way out -- they are distinct strings, so the
 * distinct-url guard counts them and the batch reads healthy -- and then
 * api/coldwater-ingest.js requires ^https?: and bins every one. A capture that
 * looks complete in the panel and is 1% of itself on the shelf.
 *
 * A BARE SLUG IS DELIBERATELY STILL NOT A URL. Resolving "tear-gas-9" against
 * whatever page the operator happens to be on invents an address the shop does
 * not serve, and this codebase's standing rule is that a dead link on the shelf
 * is worse than an absent row. It is dropped -- but loudly now, with the
 * endpoint naming the count, which is the half that was missing.
 *
 * VERIFIED AGAINST THE UNFIXED COLLECTOR: nine assertions red, and one of them
 * is worse than a drop. `location.origin + href` on a SCHEME-RELATIVE url
 * ("//shop.example/product/x") produced
 * "http://127.0.0.1:3221//shop.example/product/x" -- an address that is
 * absolute, passes the endpoint's ^https?: test, is stored, is published, and
 * goes nowhere. The rest of this file argues that a missing row beats a wrong
 * one; that line was quietly manufacturing the wrong one.
 *
 *   node test-collector-url.mjs
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

const PORT = 3221, CDP = 9621;
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

/* Every relative form a real menu's JSON has been seen to carry, plus the two
   that must NOT become links. Served under a nested path, because resolving
   "products/x" against "/michigan/detroit/menu" is the case a naive
   location.origin + href gets wrong even when it fires. */
const PRODUCTS = [
  { name: "Absolute",     url: "https://shop.example/product/absolute", price: 30 },
  { name: "RootRelative", url: "/product/root-relative",                price: 31 },
  { name: "PathRelative", url: "product/path-relative",                 price: 32 },
  { name: "DotRelative",  url: "./product/dot-relative",                price: 33 },
  { name: "UpRelative",   url: "../product/up-relative",                price: 34 },
  { name: "SchemeRel",    url: "//shop.example/product/scheme-rel",     price: 35 },
  /* Not links, and each is a different reason. */
  { name: "BareSlug",     slug: "tear-gas-9",                           price: 36 },
  { name: "JsHref",       url: "javascript:void(0)",                    price: 37 },
];

const page = `<!doctype html><html><head><title>Menu</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { products: PRODUCTS.map((p, i) => ({
    id: "p" + i, name: p.name, brand: "Test", category: "Flower",
    url: p.url, slug: p.slug,
    image: "https://img.example/" + i + ".jpg",
    variants: [{ option: "3.5g", price: p.price }],
  })) } },
})}</script>
<div id="menu">the menu is in page state</div>
</body></html>`;

const srv = createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html" }); res.end(page);
}).listen(PORT);

/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llurl" });

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

console.log("\nResolving a product url the way the browser would\n");

/* Nested on purpose: "product/x" resolves against the DIRECTORY, so a page at
   /michigan/detroit/menu yields /michigan/detroit/product/x. location.origin +
   href would have produced /product/x -- right host, wrong page. */
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/michigan/detroit/menu` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
/* The batch accumulates for 18 hours, so a previous run would otherwise walk
   into this one -- the lesson test-collector-remix.mjs learned the hard way. */
await ev(`localStorage.clear(); true`);
await send("Runtime.evaluate", { expression: COLLECTOR });
await wait(2500);

const rows = await ev(`(function(){
  try {
    return (window.__LL_COLLECT__ && window.__LL_COLLECT__.batchList() || [])
      .map(function(p){ return p.name + " => " + p.url; }).join("\\n");
  } catch (e) { return "ERR " + e; }
})()`);
const map = {};
String(rows).split("\n").filter(Boolean).forEach(l => {
  const i = l.indexOf(" => "); map[l.slice(0, i)] = l.slice(i + 4);
});
const HOST = `http://127.0.0.1:${PORT}`;

console.log("== the five relative forms all resolve ==");
ok("an absolute url is left alone", map.Absolute === "https://shop.example/product/absolute", map.Absolute);
ok("a root-relative path resolves against the origin",
   map.RootRelative === HOST + "/product/root-relative", map.RootRelative);
/* THE ONE THAT WAS BROKEN, and the one a live menu actually carries. */
ok("a path-relative url resolves against the DIRECTORY, not the origin",
   map.PathRelative === HOST + "/michigan/detroit/product/path-relative", map.PathRelative);
ok("a ./ url resolves the same way",
   map.DotRelative === HOST + "/michigan/detroit/product/dot-relative", map.DotRelative);
ok("a ../ url climbs one level",
   map.UpRelative === HOST + "/michigan/product/up-relative", map.UpRelative);
ok("a scheme-relative url takes the page's scheme",
   map.SchemeRel === "http://shop.example/product/scheme-rel", map.SchemeRel);

console.log("\n== and the two that are not links fall back to the page ==");
/* NOT INVENTED, AND NOT DROPPED EITHER. Resolving "tear-gas-9" against whatever
   page the operator is standing on would produce an address the shop does not
   serve, so it is refused as an href -- and the row then takes the same
   location.href fallback the rendered-page layer has always taken. That is the
   established behaviour rather than a new one: captureKeyer already knows a url
   carrying many names is a page rather than an identity and keys those rows by
   name. The product is real, so it goes on the shelf pointing at the menu it
   came from; what must never happen is a confident link to nothing. */
const PAGE = HOST + "/michigan/detroit/menu";
ok("a bare slug does not become a product url", !/tear-gas-9/.test(map.BareSlug || ""), map.BareSlug);
ok("...it falls back to the page it was read from", map.BareSlug === PAGE, map.BareSlug);
ok("a javascript: href is not a product url", !/^javascript:/i.test(map.JsHref || ""), map.JsHref);
ok("...and falls back the same way", map.JsHref === PAGE, map.JsHref);

console.log("\n== six rows carry a url of their OWN, which is the number that broke ==");
/* THE ASSERTION THAT REPRODUCES THE BUG. Against the unfixed collector only
   Absolute and RootRelative resolved -- the other four travelled as raw
   relative strings, which the endpoint requires ^https?: of and bins. Two of
   six, against the live report's fourteen of 1,378. */
const own = Object.entries(map)
  .filter(([, u]) => /^https?:\/\//.test(String(u)) && u !== PAGE).length;
ok("six, not two", own === 6, own + " of " + Object.keys(map).length + " rows carry their own url");

console.log("\n== a batch left behind by the old collector is pruned, not carried ==");
/* THE FIX OUTLIVED ITS OWN BUG, AND THE BATCH DID NOT. localStorage holds rows
   captured before urls were resolved, with "products/x" in the url field -- and
   RE-CAPTURING CANNOT REPLACE THEM, because keyOf() keys on the url: the same
   product read again resolves to a different key and lands BESIDE its broken
   twin. So every send reports the same drop forever. Reported as "Sent 835 of
   1485. 650 rows were dropped" on a shop whose reader was working perfectly.

   The fixture is what that operator's tab actually holds: fossils under the
   collector's own key format, plus one good row that must survive. */
/* A fresh document, and a different path so Page.navigate really reloads --
   navigating to the url already shown is a no-op and the collector would never
   re-run. The batch key is scoped by HOST, so it is the same batch either way,
   which is the point. */
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/michigan/detroit/menu?again=1` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
await ev(`(function(){
  localStorage.clear();
  var KEY = "ll_collector_batch:" + location.host;   // same rule the collector uses
  var b = {};
  for (var i = 0; i < 6; i++) {
    b["u:products/fossil" + i] = { name: "Fossil " + i, url: "products/fossil" + i,
      sizes: [{ label: "1g", price: 10, grams: 1 }] };
  }
  b["u:https://shop.example/product/keeper"] = { name: "Keeper",
    url: "https://shop.example/product/keeper", sizes: [{ label: "1g", price: 11, grams: 1 }] };
  localStorage.setItem(KEY, JSON.stringify(b));
  localStorage.setItem(KEY + ":at", String(Date.now()));
  return true;
})()`);
await send("Runtime.evaluate", { expression: COLLECTOR });
await wait(2500);

/* NO REGEX IN THIS PROBE, DELIBERATELY. It is a JS string inside a template
   literal inside a JS file, and a backslash class survives none of that
   reliably -- the first draft of this block reached the page as a broken
   pattern, threw, and returned undefined, which read as "the collector did not
   load". Same trap the generator's own escaping note describes. indexOf needs
   no backslashes. */
const after = await ev(`(function(){
  var rows = (window.__LL_COLLECT__ && window.__LL_COLLECT__.batchList()) || [];
  function abs(r){ return String((r && r.url) || "").indexOf("http") === 0; }
  return JSON.stringify({
    fossils: rows.filter(function(r){ return String(r.name || "").indexOf("Fossil ") === 0; }).length,
    keeper:  rows.filter(function(r){ return r.name === "Keeper"; }).length,
    unstorable: rows.filter(function(r){ return !abs(r); }).length,
    total: rows.length,
    pruned: (window.__LL_COLLECT__ && window.__LL_COLLECT__.diag && window.__LL_COLLECT__.diag().batchPruned) || 0
  });
})()`);
const A = JSON.parse(String(after));
ok("the fossil rows are gone", A.fossils === 0, JSON.stringify(A));
ok("...and the collector counted exactly the six it removed", A.pruned === 6, String(A.pruned));
ok("...and every remaining row is one the endpoint will accept", A.unstorable === 0, String(A.unstorable));
/* Pruning must not become a second way to lose a good capture. */
ok("a row with a real url is untouched", A.keeper === 1, String(A.keeper));
/* This page's own products are re-read on injection, so the batch is not merely
   smaller -- it is smaller AND still holds this menu. */
ok("and the page's own products are still read", A.total > 1, A.total + " rows");

/* SAID OUT LOUD. A batch that shrinks on its own is the exact shape of the
   storage failure this file has been blamed for twice, so silence is not an
   option -- same rule the 18h expiry message already follows. */
const panelTxt = String(await ev(`(document.getElementById("ll-collector")||document.body).innerText`));
ok("the panel says rows were cleared and why", /older row\(s\) were cleared/i.test(panelTxt),
   panelTxt.replace(/\s+/g, " ").slice(0, 130));
ok("...and counts them", /\b6 older row/.test(panelTxt), panelTxt.replace(/\s+/g, " ").slice(0, 90));

s.close(); ch.kill(); srv.close();
console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

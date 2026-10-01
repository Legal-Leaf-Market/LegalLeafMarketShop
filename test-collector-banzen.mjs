/* test-collector-banzen.mjs — a brand page is not a product page.
 *
 *   node test-collector-banzen.mjs
 *
 * AUDITED ON THE LIVE SITE, 17 Aug 2026. Banzen publishes 1,465 products —
 * confirmed two independent ways, the sum of every category's own total_count
 * and the 1,465 urls in products-sitemap.xml, which agree exactly. A full
 * "Scan everything" of the Vape Pens category (308 products) returned TWELVE
 * rows, and the panel had been reporting "97 products" for a shop with 104
 * brands. Both numbers are brand counts.
 *
 * THE CAUSE IS KEYING, NOT SCROLLING, and that distinction is the whole reason
 * this file exists. Banzen links every card to a BRAND page
 * (/menu/brands/jeeter-365986). Those urls are not location.href, so the
 * collector's old test passed them, and 308 products from one brand landed on
 * one key and overwrote each other. It reads exactly like a truncated scan —
 * which is where two evenings went — and no amount of scrolling can fix it.
 *
 * The server's captureKeyer() has always had the missing half: a url carrying
 * more than one NAME is ambiguous and those rows key by name. The collector is
 * its documented twin and never got it. It collapses in the browser, so the
 * server's correct rule never even sees the rows.
 *
 * THE COUNTER-CASE IS WHAT MAKES THIS DELICATE, and it is asserted as hard as
 * the fix: the rendered-page and printed-text layers have NO per-card link and
 * fall back to location.href. Key on those and a whole menu collapses into ONE
 * row — the same failure an order of magnitude worse, and it would look like a
 * successful capture. And two genuinely different listings that share a title
 * (THCA Small Buds sells one strain as several) must still stay apart.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";
const SHOP_PORT = 3536;
const fails = [];
const ok = (c, m, x = "") => {
  if (c) console.log("  ok   " + m + (x ? "   (" + x + ")" : ""));
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

/* ---------------------------------------------------- the Banzen shape --- */
/* 5 brands x 12 products. Every product of a brand shares ONE brand url, which
   is exactly what the live menu does. Read by url alone this is 5 rows. */
const BRANDS = ["jeeter", "kushy-punch", "craft-hydroponic", "berry-green", "fruit-and-fuel"];
const PER_BRAND = 12;
const BANZEN = [];
BRANDS.forEach((b, bi) => {
  for (let i = 0; i < PER_BRAND; i++) {
    BANZEN.push({
      name: `${b.toUpperCase()} | Strain ${bi}-${i} | Vape Cartridge | 1g`,
      brand: b, category: "Vape Pens",
      image: `https://img.test/${b}-${i}.jpg`,
      /* THE BRAND PAGE — ONE url for all twelve of this brand's products, which
         is what the live menu does. The `i` must NOT appear here: putting it in
         gives every product its own url and the suite passes against the very
         bug it exists to catch. */
      url: `https://banzencoldwater.com/menu/brands/${b}-36${bi}`,
      options: ["1g"], prices: [40 + i],
    });
  }
});

/* The counter-case, on its own page: rows whose only url is the page itself. */
const NOLINK = Array.from({ length: 14 }, (_, i) => ({
  name: `Deli Flower Strain ${i}`, brand: "House", category: "Deli Flower",
  image: `https://img.test/deli-${i}.jpg`,
  options: ["3.5g"], prices: [30 + i],
  /* no url at all — the DOM/text layers fall back to location.href */
}));

/* Two different listings sharing a title, each with its own url. Must stay two. */
const SAMETITLE = [
  { name: "Blue Dream", brand: "A", category: "Flower", image: "https://img.test/a.jpg",
    url: "https://banzencoldwater.com/menu/products/blue-dream-111", options: ["3.5g"], prices: [30] },
  { name: "Blue Dream", brand: "B", category: "Flower", image: "https://img.test/b.jpg",
    url: "https://banzencoldwater.com/menu/products/blue-dream-222", options: ["3.5g"], prices: [35] },
];

/* A CATEGORY PAGE AS BANZEN ACTUALLY SERVES ONE: the payload states the
   category's total_count and carries NO product array, so the DOM layer has to
   answer. Card text is copied from the live domSample — potency first, brand
   second, the real title third, and the title itself contains pipes. */
const DOM_CARDS = 13;
const DECLARED_TOTAL = 235;
const BRAND_ROTA = ["JEETER", "BERRY GREEN", "FRUIT AND FUEL"];
const domCardsHtml = `<!doctype html><html><head><title>Infused Preroll</title></head><body>
<h1>Infused Preroll</h1><div id="menu">
${Array.from({ length: DOM_CARDS }, (_, i) => {
  const brand = BRAND_ROTA[i % BRAND_ROTA.length];
  return `<article class="card">
    <div class="thc">THC: ${(30 + i * 0.53).toFixed(2)}%</div>
    <div class="brand">${brand}</div>
    <div class="title">*Jeeter | Strain ${i} | 5pk | Baby Jeeter Infused Preroll | 2.5g</div>
    <div class="w">2.5 grams</div>
    <div class="price">$${(30 + i).toFixed(2)}</div>
  </article>`;
}).join("")}
</div>
<script>window.__CATEGORY_STATE = ${JSON.stringify({
  category: { slug: "infused-preroll", total_count: DECLARED_TOTAL, page: 1, per_page: 13 },
})};</script>
</body></html>`;

const page = (state) => `<!doctype html><html><head><title>Banzen Fixture</title></head><body>
<h1>Menu</h1><div id="menu"></div>
<script>window.__MENU_STATE = ${JSON.stringify(state)};</script>
</body></html>`;

const shop = createServer((req, res) => {
  const p = (req.url || "/").split("?")[0];
  res.writeHead(200, { "content-type": "text/html" });
  if (p === "/nolink") return res.end(page(NOLINK));
  if (p === "/sametitle") return res.end(page(SAMETITLE));
  if (p === "/domcards") return res.end(domCardsHtml);
  return res.end(page(BANZEN));
});
await new Promise((r) => shop.listen(SHOP_PORT, r));

/* ---------------------------------------------------------------- driver --- */
const CHROME = chromePath();

const PORT = 9581;
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: proc } = await launchChrome(PORT, [], { userDataDir: "/tmp/_ll_banzentest" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 100 && !up; i++) {
  try { up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch {}
  if (!up) await sleep(150);
}
if (!up) { proc.kill(); console.error("Chromium did not start"); process.exit(2); }
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("cdp failed")); });
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } };
const send = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params: params || {} })); });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const src = readFileSync("./public/coldwater-collector.js", "utf8");
async function visit(path) {
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP_PORT}${path}` });
  await sleep(1800);
  await evaluate(`(function(){try{localStorage.clear();sessionStorage.clear();}catch(e){}return true})()`);
  await evaluate(src);
  await sleep(1000);
  return {
    rows: JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.batchList()||[])") || "[]"),
    diag: JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.diag()||{})") || "{}"),
  };
}
await send("Page.enable");

console.log("\nbrand urls — 60 products behind 5 brand pages\n");
const a = await visit("/menu");
ok(a.rows.length === BRANDS.length * PER_BRAND,
   `all ${BRANDS.length * PER_BRAND} products survive, not ${BRANDS.length} brand rows`,
   `${a.rows.length} rows`);
ok(a.rows.length !== BRANDS.length, "the batch is not keyed by brand", `${a.rows.length}`);
ok(a.diag.ambiguousUrls === BRANDS.length,
   "each brand url is reported as ambiguous, so the cause is legible next time",
   `ambiguousUrls ${a.diag.ambiguousUrls}`);
const names = new Set(a.rows.map((r) => r.name));
ok(names.size === BRANDS.length * PER_BRAND, "every product kept its own name", `${names.size} distinct`);

console.log("\nthe counter-case — rows whose only url is the page itself\n");
const b = await visit("/nolink");
ok(b.rows.length === NOLINK.length,
   `a menu with no per-card links stays ${NOLINK.length} rows, not 1`, `${b.rows.length} rows`);
ok(b.rows.length !== 1, "the whole page did NOT collapse into a single row");

console.log("\ntwo listings, one title, different urls\n");
const c = await visit("/sametitle");
ok(c.rows.length === 2, "a shared title does not merge two real listings", `${c.rows.length} rows`);
ok(c.diag.ambiguousUrls === 0, "and neither url is flagged ambiguous", String(c.diag.ambiguousUrls));

console.log("\naccumulation — the second harvest must not undo the first\n");
/* The bug's signature was a batch that stopped growing. Re-harvesting the same
   page must be idempotent, and ambiguity must survive the round trip. */
await evaluate(`window.__LL_COLLECT__.harvest(); true`);
await sleep(400);
const again = JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.batchList()||[])") || "[]");
ok(again.length === c.rows.length, "re-harvesting the same page changes nothing",
   `${c.rows.length} -> ${again.length}`);

console.log("\ncoverage and the denominator — a DOM-answered page\n");
/* THE PAGE THE DIAGNOSTIC LIED ABOUT. Page state carries the category's own
   total_count and NO product array, so the DOM layer answers — which is exactly
   Banzen's category pages, and exactly where rowCoverage reported all zeros
   while withGrams in the same blob said 76 of 119. */
const d = await visit("/domcards");
ok(d.diag.via === "rendered page", "the DOM layer answered, as it does on these pages", d.diag.via);
ok(d.rows.length === DOM_CARDS, `all ${DOM_CARDS} painted cards were read`, `${d.rows.length}`);
ok(d.diag.rowCoverage && d.diag.rowCoverage.rows === d.rows.length,
   "rowCoverage now describes the batch, not one layer's contribution",
   JSON.stringify(d.diag.rowCoverage));
ok(d.diag.rowCoverage && d.diag.rowCoverage.grams > 0,
   "...so a DOM capture with weights no longer reports zero coverage",
   `grams ${d.diag.rowCoverage && d.diag.rowCoverage.grams}`);
ok(d.diag.stateCoverage && d.diag.stateCoverage.grams === 0,
   "the per-layer figure is kept separately, since 'state contributed nothing' is worth knowing",
   JSON.stringify(d.diag.stateCoverage));
ok(d.diag.pageSays === DECLARED_TOTAL,
   "the page's own declared total is read, so a row count has a denominator",
   `pageSays ${d.diag.pageSays}`);
ok(d.rows.length < d.diag.pageSays,
   "and this capture is correctly reported as a shortfall rather than a finished menu",
   `${d.rows.length} of ${d.diag.pageSays}`);

/* The name must be the product, not the brand and not the potency line — both
   of which sit above it on these cards. */
const titled = d.rows.filter((r) => /Baby Jeeter Infused Preroll/i.test(r.name || ""));
ok(titled.length === DOM_CARDS, "every row is named by its product title, not the brand above it",
   `${titled.length}/${DOM_CARDS} — e.g. ${(d.rows[0] || {}).name || "-"}`.slice(0, 90));
ok(!d.rows.some((r) => /^THC:/i.test(r.name || "")), "no row is named after its potency line");
ok(!d.rows.some((r) => String(r.name || "").trim() === "JEETER"), "and no row is named after its brand");

try { ws.close(); } catch {}
proc.kill();
shop.close();

/* ------------------------------------------- and the server agrees with it --- */
console.log("\nthe server twin, over the same rows\n");
const { captureKeyer } = await import("./api/coldwater-ingest.js");
const keyer = captureKeyer(BANZEN);
const keys = new Set(BANZEN.map((p) => keyer(p)));
ok(keys.size === BANZEN.length,
   "captureKeyer keys the same rows the same way — the two twins agree",
   `${keys.size} of ${BANZEN.length}`);

console.log("\n" + (fails.length ? `FAILED (${fails.length})\n  ` + fails.join("\n  ") : "All assertions passed.") + "\n");
process.exit(fails.length ? 1 : 0);

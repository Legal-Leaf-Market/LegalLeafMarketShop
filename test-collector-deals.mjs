/* test-collector-deals.mjs — deal capture, and the refusals that matter more.
 *
 *   node test-collector-deals.mjs
 *
 * THE FINDING THIS SUITE EXISTS FOR. `sizes[].sale` was null on all 5057 rows of
 * every shop, and the reason was one missing shape rather than a missing
 * feature. Everything downstream already worked: the ingest sanitiser keeps
 * `sale`, row() writes it into slot 7, toProduct() reads slot 7 as a real unit
 * price and folds it into perG while shelfPerG keeps the list price. The
 * collector simply never read a parallel sale ARRAY — which is precisely how
 * Dutchie ships a discount — so the site ranked discounted products at their
 * list price. Sapura renders $7.00 struck through beside $4.90; we stored $7.00.
 *
 * The assertions below are split deliberately. Capturing a discount is easy; the
 * dangerous half is capturing one that is NOT real — an off-by-one against the
 * price array prints a saving that does not exist, and that is the one number on
 * this site nobody would think to double-check.
 *
 * Runs the real collector in real Chromium against fixtures shaped from live
 * reads (DEALS-ANALYSIS.md §4), then puts the rows through the real ingest
 * sanitiser and the real toProduct() so "captured" and "reaches the shelf
 * correctly ranked" are two separate claims.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";
const SHOP_PORT = 3535;
const fails = [];
const ok = (c, m, x = "") => {
  if (c) console.log("  ok   " + m + (x ? "   (" + x + ")" : ""));
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

/* ------------------------------------------------------------- fixtures --- */
/* Shapes measured off Sapura, per DEALS-ANALYSIS.md §4. */
const MENU = [
  {
    /* The real one: six weights, six list prices, six discounted prices. */
    name: "Banana Puddintain Bulk (I)", product_name: "Banana Puddintain Bulk",
    brand: "KAI", category: "Flower", image: "https://img.test/kai.jpg",
    url: "https://shop.test/p/kai-bulk",
    Options: ["1g", "2g", "1/8oz", "1/4oz", "1/2oz", "1oz"],
    recPrices: [12, 24, 30, 60, 120, 210],
    recSpecialPrices: [11.4, 22.8, 28.5, 57, 114, 199.5],
    special: true,
    specialData: {
      saleSpecials: [{ specialName: "15% Off Bulk Flower (Over 2 Ounces)" }],
      bogoSpecials: [{ specialName: "BOGO 1.25g TrapHouse Bubble Hash infused PR" }],
    },
  },
  {
    /* A single-price product stating its discount on the object. */
    name: "Hy-R Animal Tree Preroll (H)", brand: "Hy-R", category: "Pre-Rolls",
    image: "https://img.test/hyr.jpg", url: "https://shop.test/p/hyr",
    Options: ["1g"], recPrices: [7.0], specialPrice: 4.9,
    posDiscountNames: ["30% Off All Hy-R Products"],
  },
  {
    /* A STALE SALE ARRAY: the promo ended and the numbers were left equal.
       "was $12, now $12" must never be published. */
    name: "Stale Promo Flower", brand: "Test", category: "Flower",
    image: "https://img.test/stale.jpg", url: "https://shop.test/p/stale",
    Options: ["1g", "3.5g"], recPrices: [12, 30], recSpecialPrices: [12, 33],
  },
  {
    /* AN OFF-BY-ONE ARRAY. Five prices, four sale prices. Pairing these by index
       prices an ounce at an eighth's discount and invents a saving. Refused. */
    name: "Ragged Array Flower", brand: "Test", category: "Flower",
    image: "https://img.test/ragged.jpg", url: "https://shop.test/p/ragged",
    Options: ["1g", "2g", "3.5g", "7g", "28g"],
    recPrices: [10, 19, 30, 55, 190],
    recSpecialPrices: [9, 17, 27, 50],
  },
  {
    /* No deal at all — the control. A shop with no promotion must stay clean. */
    name: "Plain Flower", brand: "Test", category: "Flower",
    image: "https://img.test/plain.jpg", url: "https://shop.test/p/plain",
    Options: ["3.5g"], recPrices: [40],
  },
];

const stateHtml = `<!doctype html><html><head><title>Deals Fixture</title></head><body>
<h1>Menu</h1><div id="menu"></div>
<script>window.__MENU_STATE = ${JSON.stringify(MENU)};</script>
</body></html>`;

/* A SECOND PAGE WITH NO PAGE STATE AT ALL, because the DOM layer only runs when
   everything above it found nothing — so the Banzen bug cannot be reproduced on
   a page that also carries a readable menu. Two pages, two layers, one suite. */
const domHtml = `<!doctype html><html><head><title>DOM Fixture</title></head><body>
<h1>Menu</h1><div id="menu">
${["North Coast | Heady Tropper | TIER 3 Special Sauce Rosin | 1g",
   "Sunset Sherbet Sale Edition | 1g",
   "Blue Dream | 1g"].map((n, i) => `
  <article class="card"><a href="/p/dom-${i}"><h3>${n}</h3></a>
    <div class="price">$${55 + i}.00</div><div class="weight">1g</div>
    ${i === 2 ? '<div class="promo">30% Off All Flower</div>' : ""}
  </article>`).join("")}
</div></body></html>`;

const shop = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  res.writeHead(200, { "content-type": "text/html" });
  res.end(path === "/dom" ? domHtml : stateHtml);
});
await new Promise((r) => shop.listen(SHOP_PORT, r));

/* ---------------------------------------------------------------- driver --- */
const CHROME = chromePath();

const PORT = 9579;
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: proc } = await launchChrome(PORT, [], { userDataDir: "/tmp/_ll_dealstest" });
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

await send("Page.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP_PORT}/menu` });
await sleep(2200);
/* The 18-hour batch is shared per origin; a suite that can fail on its own
   previous run is worse than no suite. */
await evaluate(`(function(){try{localStorage.clear();sessionStorage.clear();}catch(e){}return true})()`);
await evaluate(readFileSync("./public/coldwater-collector.js", "utf8"));
await sleep(1200);

const rows = JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.batchList()||[])") || "[]");
const by = (n) => rows.find((r) => (r.name || "").indexOf(n) >= 0);

console.log("\nsale prices — the field that was null on all 5057 rows\n");

const kai = by("Banana Puddintain");
ok(!!kai, "the six-weight listing was captured", kai ? `${kai.sizes.length} sizes` : "missing");
if (kai) {
  const withSale = kai.sizes.filter((s) => s.sale != null);
  ok(withSale.length === 6, "every one of the six weights carries its sale price", `${withSale.length}/6`);
  const oz = kai.sizes.find((s) => s.label === "1oz");
  ok(oz && oz.price === 210 && oz.sale === 199.5, "the ounce keeps its shelf price AND its sale price",
     oz ? `price ${oz.price}, sale ${oz.sale}` : "no 1oz row");
  const g = kai.sizes.find((s) => s.label === "1g");
  ok(g && g.sale === 11.4, "and the gram is paired with the right index, not shifted", g ? String(g.sale) : "-");
}

const hyr = by("Hy-R");
ok(hyr && hyr.sizes[0] && hyr.sizes[0].sale === 4.9,
   "a single-price product reads its discount off the object",
   hyr && hyr.sizes[0] ? `price ${hyr.sizes[0].price}, sale ${hyr.sizes[0].sale}` : "missing");

console.log("\nthe refusals — an invented discount is worse than a missing one\n");

const stale = by("Stale Promo");
if (stale) {
  ok(stale.sizes.every((s) => s.sale == null),
     "a sale price equal to or above the shelf price is refused",
     JSON.stringify(stale.sizes.map((s) => [s.price, s.sale])));
}
const ragged = by("Ragged Array");
if (ragged) {
  ok(ragged.sizes.every((s) => s.sale == null),
     "a sale array of the wrong length is refused outright, never zipped",
     JSON.stringify(ragged.sizes.map((s) => [s.price, s.sale])));
}
const plain = by("Plain Flower");
ok(plain && plain.sizes.every((s) => s.sale == null) && !plain.deal,
   "a product with no promotion stays clean");

console.log("\ndeal names — the shop's own words\n");

ok(kai && /^BOGO 1\.25g TrapHouse/.test(kai.deal || ""),
   "Dutchie's specialData name is read, BOGO bucket first", kai ? kai.deal : "-");
ok(kai && / \+1$/.test(kai.deal || ""),
   "a second special is counted, not concatenated into an essay", kai ? kai.deal : "-");
ok(hyr && /30% Off All Hy-R/.test(hyr.deal || ""),
   "posDiscountNames answers when there is no specialData", hyr ? hyr.deal : "-");

/* THE BANZEN BUG, on a page with no readable state — the only way the DOM layer
   runs at all. "Special Sauce" is a strain; it must never become a deal. */
await send("Page.navigate", { url: `http://127.0.0.1:${SHOP_PORT}/dom` });
await sleep(2000);
await evaluate(`(function(){try{localStorage.clear();sessionStorage.clear();}catch(e){}return true})()`);
await evaluate(readFileSync("./public/coldwater-collector.js", "utf8"));
await sleep(1200);
const domRows = JSON.parse(await evaluate("JSON.stringify(window.__LL_COLLECT__.batchList()||[])") || "[]");

const sauce = domRows.find((r) => /Special Sauce/i.test(r.name || ""));
ok(!!sauce, "the DOM-read card was captured", sauce ? sauce.name.slice(0, 40) : `${domRows.length} rows`);
ok(sauce && !sauce.deal, "a product's own name is never published as its deal",
   sauce ? JSON.stringify(sauce.deal) : "-");
const sherbet = domRows.find((r) => /Sherbet/i.test(r.name || ""));
ok(sherbet && !sherbet.deal, "nor when the name merely contains the word 'sale'",
   sherbet ? JSON.stringify(sherbet.deal) : "-");
const blue = domRows.find((r) => /Blue Dream/i.test(r.name || ""));
ok(blue && /30% Off All Flower/.test(blue.deal || ""),
   "a real promotion line on a card is still read", blue ? blue.deal : "-");

try { ws.close(); } catch {}
proc.kill();
shop.close();

/* ------------------------------------- through the server, to the ranking --- */
console.log("\nthrough ingest and toProduct — does it actually rank on the deal\n");

const { toProduct, variantRows } = await import("./api/coldwater.js");
if (typeof toProduct !== "function" || typeof variantRows !== "function") {
  console.log("  --   toProduct/variantRows not exported; ranking not checked");
  fails.push("toProduct not exported");
} else if (kai) {
  /* toProduct takes ROWS (arrays), not the collector's size objects — the same
     conversion the live capture path does in rawOf(). variantRows is that
     reader, so this exercises the real chain rather than a hand-built shape. */
  const rows7 = variantRows(kai, "sapura", kai.name);
  const oz7 = rows7.find((r) => r[0] === "1oz");
  ok(oz7 && oz7[7] === 199.5, "the captured sale price lands in row slot 7",
     oz7 ? JSON.stringify(oz7) : "no 1oz row");

  /* Signature is (store, product) — the store comes first. */
  const p = toProduct({ key: "sapura", name: "Sapura" }, { ...kai, sizes: rows7 });
  ok(p.shelfPerG != null && p.shelfPerG > 0, "shelfPerG still reports the label price", String(p.shelfPerG));
  ok(p.dealPerG != null, "dealPerG is computed from the captured sale price", String(p.dealPerG));
  ok(p.dealPerG < p.shelfPerG, "and it is cheaper than the shelf, so the ranking moves",
     `${p.dealPerG} < ${p.shelfPerG}`);
  ok(p.perG === p.dealPerG, "perG — what the engine sorts on — takes the deal price", String(p.perG));
  ok(p.dealBasis === "sale price", "and says why, so the card can explain the number", p.dealBasis);
}

console.log("\n" + (fails.length ? `FAILED (${fails.length})\n  ` + fails.join("\n  ") : "All assertions passed.") + "\n");
process.exit(fails.length ? 1 : 0);

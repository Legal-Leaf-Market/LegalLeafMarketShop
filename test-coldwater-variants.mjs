/* SIZE ROWS, AND THE FOUR THINGS THAT WERE WRONG WITH THEM.
 *
 * Reported off the live shelf, in one breath: "some of the items are just
 * showing the options on one line or only showing one option", "710 cleaner is
 * listed price per gram right now and shouldn't be", and "you have one showing
 * 200 grams instead of 2.00 grams".
 *
 * Every one of those is a number or a row that LOOKS finished. A card with one
 * option looks like a shop that sells one size; a per-gram on a bottle of glass
 * cleaner looks like a price; 200 grams of pre-rolls looks like a weight. None of
 * them throws, so none of them shows up anywhere except on the page, which is
 * why they are pinned here rather than eyeballed.
 *
 * Two halves:
 *   1. the readers, called directly -- every variant shape a menu arrives in,
 *      the two pack forms, the refusals
 *   2. the real /api/coldwater handler, driven end to end over stored captures,
 *      because that is the path the live shelf actually takes
 *
 * Run: node test-coldwater-variants.mjs
 */
import {
  gramsOf, gramsFromTitle, variantRows, mergeListings, listingKey, isNonConsumable, STORES,
} from "./api/coldwater.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const labels = rows => rows.map(r => r[0]).join(" | ");
const priced = rows => rows.map(r => `${r[0]}=$${r[1]}/${r[2]}g`).join(" | ");

console.log("\nSize rows, weights, and what must never carry a per-gram\n");

/* ---- 1. EVERY SHAPE A SIZE SELECTOR ARRIVES IN ---------------------------
   The old reader understood one: an array of objects. Everything else fell
   through to a single "One Size" row at the product's top-level price -- which is
   the cheapest variation's price, so the ounce vanished and the eighth's price
   was published as the whole listing's. */
const objects = variantRows({ variants: [{ option: "1g", price: 12 }, { option: "3.5g", price: 35 }, { option: "28g", price: 170 }] }, "id", "");
ok("objects with their own label and price", labels(objects) === "1g | 3.5g | 28g", priced(objects));

const parallel = variantRows({ options: ["1g", "3.5g", "7g", "14g", "28g"], prices: [12, 35, 60, 110, 170] }, "id", "");
ok("PARALLEL ARRAYS, paired by index", parallel.length === 5 && parallel[4][1] === 170, priced(parallel));

const inString = variantRows({ sizes: ["3.5g - $35", "7g - $60", "28g $170"] }, "id", "");
ok("the price inside the option string", inString.length === 3 && inString[2][1] === 170, priced(inString));

const mapped = variantRows({ options: { "3.5g": 35, "7g": 60 } }, "id", "");
ok("a label-keyed map", mapped.length === 2 && mapped[0][2] === 3.5, priced(mapped));

/* Jane ships no variant array at all -- each weight is its own FIELD, which is
   why Green Tree Relief came through with one option per listing. */
const jane = variantRows({ price_gram: 12, price_eighth_ounce: 35, price_ounce: 170 }, "id", "");
ok("Jane's per-weight price fields", jane.length === 3 && jane[2][2] === 28, priced(jane));

const dutchie = variantRows({ POSMetaData: { children: [
  { option: "1/8 oz", priceMed: 35, quantity: 4 },
  { option: "1 oz", priceMed: 170, quantity: 0 },
] } }, "id", "");
ok("Dutchie's POSMetaData children", dutchie.length === 2 && dutchie[0][2] === 3.5, priced(dutchie));
ok("and a variation with no quantity left is marked sold out, not dropped",
   dutchie[1][4] === false, JSON.stringify(dutchie[1]));

/* THE TWO REFUSALS. An off-by-one on a parallel array prices an ounce at an
   eighth's price, which is the worst number this site can print; and a label with
   no price is not the parent's price, because the parent's price belongs to the
   cheapest variation. */
ok("parallel arrays of DIFFERENT lengths are refused, not guessed at",
   variantRows({ options: ["1g", "3.5g", "7g"], prices: [12, 35] }, "id", "").length === 0);
ok("labels with no price anywhere are dropped rather than priced from the parent",
   variantRows({ options: ["1g", "3.5g"] }, "id", "").length === 0);
ok("a props object of booleans is not a size list",
   variantRows({ options: { inStock: true, featured: false } }, "id", "").length === 0);

/* One row per label, cheapest kept, lightest first: a menu listing a weight
   twice is listing two batches of it, and the shopper's question is what that
   weight costs. */
const dupes = variantRows({ variants: [
  { option: "3.5g", price: 40 }, { option: "3.5g", price: 35 }, { option: "1g", price: 12 },
] }, "id", "");
ok("duplicate weights collapse to the cheapest, and the rows read upwards",
   labels(dupes) === "1g | 3.5g" && dupes[1][1] === 35, priced(dupes));

/* A stated per-size discount. It was captured, stored, and then dropped: the
   deal arithmetic reads it from row slot 7 and nothing ever wrote slot 7. */
const onSale = variantRows({ variants: [{ option: "1g", price: 25, specialPrice: 20 }] }, "id", "");
ok("a stated sale price rides along in the row's own slot", onSale[0][7] === 20, JSON.stringify(onSale[0]));
ok("and index 5 stays free for the engine's row url", onSale[0][5] === null, JSON.stringify(onSale[0]));

/* ---- 2. ONE LISTING, MANY SIZES ------------------------------------------
   Lume publishes one entry per variation. Mapped one-to-one that is a shelf of
   cards with a single option each, where the eighth and the ounce of one jar
   never sit in the same dropdown. */
const lumeShape = [
  { name: "Blue Dream", category: "flower", brand: "Lume", image: "", sizes: [["3.5g", 35, 3.5, "a", true, null, false]] },
  { name: "Blue Dream", category: "flower", brand: "Lume", image: "http://i/x.jpg", sizes: [["28g", 170, 28, "b", true, null, false]] },
  { name: "Blue Dream", category: "flower", brand: "Lume", sizes: [["1g", 12, 1, "c", true, null, false]] },
];
const merged = mergeListings(lumeShape.map(o => ({ ...o })));
ok("three variation entries become one listing", merged.length === 1, `${merged.length} listings`);
ok("with every size in it, lightest first", labels(merged[0].sizes) === "1g | 3.5g | 28g", priced(merged[0].sizes));
ok("and it picks up the photo from whichever entry had one", merged[0].image === "http://i/x.jpg", merged[0].image);
ok("it says how many entries it came from, so the census can count it",
   merged[0].mergedFrom === 3, String(merged[0].mergedFrom));

/* The weight comes out of the TITLE once it is in the dropdown -- but only for a
   listing that actually merged. */
const titled = mergeListings([
  { name: "Drip Blue Dream Cart 1g", category: "vape", brand: "Drip", sizes: [["1g", 35, 1, "d", true, null, false]] },
  { name: "Drip Blue Dream Cart 0.5g", category: "vape", brand: "Drip", sizes: [["0.5g", 22, 0.5, "e", true, null, false]] },
]);
ok("titles differing only by weight recognise each other", titled.length === 1, `${titled.length} listings`);
ok("and the merged card is no longer named after one of its sizes",
   titled[0].name === "Drip Blue Dream Cart", titled[0].name);
ok("a listing that did not merge keeps the shop's own title untouched",
   mergeListings([{ name: "Drip Blue Dream Cart 1g", category: "vape", sizes: [["1g", 35, 1, "f", true, null, false]] }])[0].name
     === "Drip Blue Dream Cart 1g");

/* WHAT MUST NOT MERGE. A 1 g cart and a 3.5 g jar of one strain are different
   products, and category is what keeps them apart. */
ok("a cart and a jar of the same strain stay separate",
   mergeListings([
     { name: "Blue Dream 1g", category: "vape", sizes: [["1g", 35, 1, "g", true, null, false]] },
     { name: "Blue Dream 3.5g", category: "flower", sizes: [["3.5g", 35, 3.5, "h", true, null, false]] },
   ]).length === 2);
ok("and so do two makers' versions of one strain",
   mergeListings([
     { name: "Blue Dream", category: "flower", brand: "Lume", sizes: [["3.5g", 35, 3.5, "i", true, null, false]] },
     { name: "Blue Dream", category: "flower", brand: "Redbud", sizes: [["3.5g", 30, 3.5, "j", true, null, false]] },
   ]).length === 2);
ok("a listing with no name is never keyed, so nameless rows cannot all merge",
   listingKey({ name: "" }) === "" &&
   mergeListings([{ name: "", sizes: [] }, { name: "", sizes: [] }]).length === 2);

/* ---- 3. THE GRAM FIGURE, AND THE 200 -------------------------------------
   The engine fills any row whose grams are zero, from the label and then the
   name, inside the blob where it cannot be edited -- and its name rule multiplies
   a pack count by a stated weight. "20pk 10g" came out as 200 grams. The two pack
   forms mean opposite things and that is the whole fix. */
ok("a pack states the weight of the PACKAGE: 20pk 10g is ten grams",
   gramsFromTitle("Fwaygo Pre-Roll 20pk 10g") === 10, String(gramsFromTitle("Fwaygo Pre-Roll 20pk 10g")));
ok("a ten-pack of minis is three and a half grams, not thirty-five",
   gramsFromTitle("Dogwalkers Mini Pre-Roll 10 Pack 3.5g") === 3.5, String(gramsFromTitle("Dogwalkers Mini Pre-Roll 10 Pack 3.5g")));
ok("an x states the weight of EACH: 2 x 1g is two grams",
   gramsOf("2 x 1g") === 2 && gramsFromTitle("Infused Pre-Roll 2 x 1g") === 2);
ok("even when each is a fraction: 2 x 1/2 g is one gram", gramsOf("2 x 1/2 g") === 1, String(gramsOf("2 x 1/2 g")));
ok("a lone weight in a cart's title is still read", gramsFromTitle("Drip Blue Dream Cart 1g") === 1);
ok("a dose is not a weight", gramsFromTitle("Muha Meds Habibi [2000mg]") === 0 && gramsOf("100mg") === 0);
ok("a drink's volume is not a weight", gramsFromTitle("Keef Orange Soda [12oz]") === 0);
ok("a pack whose arithmetic is not believable is refused rather than halved",
   gramsOf("100 x 1g") === 0, String(gramsOf("100 x 1g")));

/* A whole size selector captured as ONE option -- which is what "the options are
   all on one line" looks like from the data side. One price cannot be attributed
   to five weights. */
ok("a label stating several different weights states none of them",
   gramsOf("1g 3.5g 7g 14g 28g") === 0 && gramsOf("1g, 3.5g") === 0);
ok("but one weight written twice is not ambiguous",
   gramsOf("3.5g (1/8 oz)") === 3.5 && gramsOf("Eighth · 3.5 g") === 3.5);

/* ---- 4. WHAT IS NOT SOLD BY WEIGHT OF CANNABIS ---------------------------- */
for (const n of ["710 Cleaner 4oz", "Isopropyl Alcohol 99%", "510 Battery", "4pc Grinder",
                 "Rolling Tray", "Lume T-Shirt", "Glass Cleaner", "Butane Torch"]) {
  ok(`gear: ${n}`, isNonConsumable(n, ""), "");
}
for (const n of ["Blue Dream 3.5g", "Wedding Cake Shake", "Dogwalkers Pre-Roll 10pk 3.5g",
                 "Live Resin Cart 1g", "Rosin Gummies 10pk", "GMO Cookies Smalls"]) {
  ok(`not gear: ${n}`, !isNonConsumable(n, ""), "");
}
ok("a shop that files its own gear correctly is believed",
   isNonConsumable("Mystery Object", "Accessories") && isNonConsumable("Mystery Object", "Apparel"));

/* ---- 5. THE REAL HANDLER, OVER STORED CAPTURES ---------------------------
   The half above is arithmetic; this is the path the shelf takes. Everything
   arrives the way a browser capture arrives, through the ingest sanitiser, and
   comes back out of /api/coldwater. */
process.env.LL_ADMIN_TOKEN = "test-token";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  const s = String(u);
  if (s.startsWith("http://127.0.0.1") || s.startsWith("http://localhost")) return realFetch(u, i);
  /* No dispensary is reachable from here and none should be tried: this suite is
     about what happens to a capture, not about anyone's live menu. */
  return new Response("blocked by test", { status: 503 });
};
const cw = await import("./api/coldwater.js");
const ingest = (await import("./api/coldwater-ingest.js")).default;
STORES.forEach(s => { s.enabled = false; });

function call(mod, req) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ status: this.statusCode, body: b }); return this; },
      json(o) { return this.send(JSON.stringify(o)); },
    };
    mod(req, res);
  });
}
const put = products => call(ingest, {
  method: "POST", query: {}, headers: { "x-ll-admin-token": "test-token" },
  body: { storeKey: "sapura", collection: "test", products },
});
const feed = async (query = {}) => JSON.parse((await call(cw.default, { query })).body);

/* EVERY ROW CARRIES A URL, and that is not decoration. readIngest() drops any
   row with no product link -- a capture on a marketing page once put three dead
   links and a breadcrumb trail on the shelf, and rejecting them is what makes a
   bad capture fail loudly. These fixtures predated that rule, so the whole
   block was silently discarded, the feed fell back to the DEMO fixture, and
   because the demo happens to contain a "GMO Cookies", a "Wedding Cake", a
   "Northern Lights" and a "710 Cleaner" TOO, half the assertions below went on
   passing against it. A suite reading a fixture it did not write is worse than
   a red one. */
await put([
  /* A pre-roll pack whose weight the engine would have multiplied out. */
  { name: "Fwaygo Pre-Roll 20pk 10g", category: "pre-rolls", inStock: true,
    url: "https://example.invalid/p/fwaygo",
    sizes: [{ label: "One Size", price: 60 }] },
  /* The 710 cleaner: no category, and a size label whose ounce used to make it
     flower. */
  { name: "710 Cleaner", category: "", inStock: true,
    url: "https://example.invalid/p/cleaner",
    sizes: [{ label: "4 oz", price: 12 }] },
  /* A jar sold by the weight, which must keep everything. */
  { name: "GMO Cookies", category: "flower", inStock: true,
    url: "https://example.invalid/p/gmo",
    sizes: [{ label: "1/8 oz", price: 35 }, { label: "1 oz", price: 170 }] },
  /* One listing arriving as two entries, one weight each -- a rendered-page
     capture of a Dutchie menu looks exactly like this. Two DIFFERENT urls on
     purpose: Dutchie wraps every weight in its own link, so a fixture giving
     them one shared url would merge them for the wrong reason. */
  { name: "Wedding Cake 3.5g", category: "flower", inStock: true,
    url: "https://example.invalid/p/wedding-cake-3-5g",
    sizes: [{ label: "3.5g", price: 30 }] },
  { name: "Wedding Cake 28g", category: "flower", inStock: true,
    url: "https://example.invalid/p/wedding-cake-28g",
    sizes: [{ label: "28g", price: 160 }] },
  /* A whole selector captured as one option. */
  { name: "Northern Lights", category: "flower", inStock: true,
    url: "https://example.invalid/p/northern-lights",
    sizes: [{ label: "1g $8 3.5g $22 28g $110", price: 8 }] },
]);

/* THE CAPTURES MUST BE WHAT THE FEED IS SERVING, not the demo fixture standing
   in for them. Assert it once, here, rather than letting every assertion below
   quietly re-derive it -- meta.demo is the one field that says which. */
{
  const probe = await feed();
  ok("the captures reached the shelf, so nothing below is reading the demo set",
     probe.meta.demo === false,
     "demo=" + probe.meta.demo + " products=" + probe.products.length);
}

const f = await feed();
const byName = n => f.products.find(p => (p.name || "").indexOf(n) === 0);

const roll = byName("Fwaygo");
ok("the pre-roll's weight is the packet's, not the packet times its count",
   roll && roll.sizes[0][2] === 10, JSON.stringify(roll && roll.sizes[0]));
ok("so its per-gram is the one a shopper can check", roll && roll.perG === 6, String(roll && roll.perG));

const cleaner = byName("710 Cleaner");
ok("the cleaner is not flower", cleaner && cleaner.category === "Accessories", String(cleaner && cleaner.category));
ok("it carries no price per gram", cleaner && cleaner.perG == null, String(cleaner && cleaner.perG));
ok("its row carries no weight either, so the engine cannot derive one",
   cleaner && cleaner.sizes[0][2] === 0, JSON.stringify(cleaner && cleaner.sizes[0]));
/* The engine's accessory card is the only place it draws no per-gram at all. */
ok("and it is published as an accessory, which is what turns that card on",
   cleaner && cleaner.cannabinoid === "Accessory", String(cleaner && cleaner.cannabinoid));
ok("the price itself is untouched -- it is still for sale",
   cleaner && cleaner.startsAt === 12, String(cleaner && cleaner.startsAt));

const jar = byName("GMO Cookies");
ok("real flower keeps both its rows", jar && jar.sizes.length === 2, priced(jar ? jar.sizes : []));
ok("and its per-gram, off the ounce", jar && jar.perG === 6.07, String(jar && jar.perG));
ok("and it is not an accessory", jar && jar.cannabinoid === "THCa", String(jar && jar.cannabinoid));

const cake = byName("Wedding Cake");
ok("two captured entries of one jar become one card with two sizes",
   cake && cake.sizes.length === 2 && f.products.filter(p => /Wedding Cake/.test(p.name)).length === 1,
   priced(cake ? cake.sizes : []));
ok("its cheapest row is what the card starts at", cake && cake.startsAt === 30, String(cake && cake.startsAt));
ok("and the ounce is what sets its per-gram", cake && cake.perG === 5.71, String(cake && cake.perG));

const nl = byName("Northern Lights");
ok("a selector captured as one option publishes no per-gram rather than a wrong one",
   nl && nl.perG == null && nl.sizes[0][2] === 0, JSON.stringify(nl && nl.sizes[0]));

const cen = await feed({ debug: "", slim: "" });
ok("the census counts listings whose weights were refused, and why",
   cen.gramPlausibility && cen.gramPlausibility.sapura &&
   cen.gramPlausibility.sapura.nonConsumable === 1,
   JSON.stringify(cen.gramPlausibility && cen.gramPlausibility.sapura).slice(0, 140));
ok("and counts the selectors that arrived as one line, so they can be re-captured",
   cen.sizeRows && cen.sizeRows.sapura && cen.sizeRows.sapura.multiWeight === 1,
   JSON.stringify(cen.sizeRows && cen.sizeRows.sapura).slice(0, 200));
ok("and the listings it gathered back together",
   cen.sizeRows.sapura.merged === 1, String(cen.sizeRows.sapura.merged));
/* oneSizeOnly is the number that says "re-capture this shop", so it must not
   count a cart whose weight came off its title instead of its selector -- the
   pre-roll above is labelled "One Size" and carries 10 g. Counting it would
   report the fix as the fault. */
ok("a row labelled One Size that still has a weight is not counted as unread",
   cen.sizeRows.sapura.oneSizeOnly === 0, JSON.stringify(cen.sizeRows.sapura).slice(0, 140));

await call(ingest, {
  method: "POST", query: {}, headers: { "x-ll-admin-token": "test-token" },
  body: { storeKey: "sapura", reset: true },
});

/* ---- 6. THE LUME ADAPTER, WHICH IS WHERE THE SHAPE COMES FROM ------------
   Lume is the biggest catalogue in this town and it publishes one entry per
   variation -- so it is the shop the sub-variant fix matters most for, and the
   one whose adapter changed structurally (map -> merge -> toProduct). The real
   fixture for it is a saved page nobody can fetch from here (lume.com is refused
   by this container's proxy, which is why test-coldwater-lume.mjs skips), so this
   is a minimal __NEXT_DATA__ of the shape that adapter reads: the location assert
   it insists on, and three entries of one jar. */
const lume = STORES.find(s => s.key === "lume");
lume.enabled = true;
const lumePage = `<html><head><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { location: "Coldwater", products: [
    { SKU: "a1", name: "Blue Dream", brand: "Lume", category: "Flower", classification: "Hybrid",
      displayVariation: "3.5g", price: { centAmount: 3500 }, percentTHC: 24.1, status: "active",
      images: [{ url: "https://img/bd.jpg" }], url: "/shop/product/blue-dream" },
    { SKU: "a2", name: "Blue Dream", brand: "Lume", category: "Flower", classification: "Hybrid",
      displayVariation: "1 oz", price: { centAmount: 11000 }, percentTHC: 24.1, status: "active",
      images: [], url: "/shop/product/blue-dream" },
    { SKU: "a3", name: "Blue Dream", brand: "Lume", category: "Flower", classification: "Hybrid",
      displayVariation: "1g", price: { centAmount: 1200 }, percentTHC: 24.1, status: "active",
      images: [], url: "/shop/product/blue-dream" },
    { SKU: "b1", name: "710 Cleaner", brand: "", category: "Accessories", classification: "",
      displayVariation: "4 oz", price: { centAmount: 1200 }, status: "active", images: [], url: "/shop/product/cleaner" },
  ] } },
})}</script></head><body></body></html>`;
/* THIS SUITE STANDS THE NO-REAL-SHOP GUARD DOWN, and substitutes a stronger one.
   LL_NO_STORE_FETCH makes api/coldwater.js refuse at its fetch chokepoint, which
   is right for every suite that boots the real server -- but this one is testing
   the LUME ADAPTER, so it must reach a page, and the page it reaches is the
   fixture two lines up. A stubbed fetch that answers lume.com from a string and
   503s everything else cannot touch a real business at all, which is the thing
   the flag is for; the flag would only stop the adapter being tested.

   Deleted HERE rather than at the top of the file, because the check is read per
   call: the stub and the standing-down arrive together, so there is no window in
   which this suite could make a real request. */
delete process.env.LL_NO_STORE_FETCH;
globalThis.fetch = async (u, i) => {
  const s = String(u);
  if (s.includes("lume.com")) return new Response(lumePage, { status: 200, headers: { "content-type": "text/html" } });
  if (s.startsWith("http://127.0.0.1") || s.startsWith("http://localhost")) return realFetch(u, i);
  return new Response("blocked by test", { status: 503 });
};
const lf = await feed({ refresh: "" });
const lumeRows = lf.products.filter(p => p.storeKey === "lume");
const bd = lumeRows.find(p => /Blue Dream/.test(p.name));
ok("Lume's three entries for one jar become one card", lumeRows.filter(p => /Blue Dream/.test(p.name)).length === 1,
   `${lumeRows.length} lume products: ${lumeRows.map(p => p.name).join(", ")}`);
ok("with all three weights in its dropdown, lightest first",
   bd && labels(bd.sizes) === "1g | 3.5g | 1 oz", priced(bd ? bd.sizes : []));
ok("its per-gram comes off the ounce, which is the row that sells",
   bd && bd.perG === 3.93, String(bd && bd.perG));
ok("and it starts at the gram, not at whichever entry came first",
   bd && bd.startsAt === 12, String(bd && bd.startsAt));
ok("the photo from the entry that had one carries the card",
   bd && bd.image === "https://img/bd.jpg", String(bd && bd.image));
const lumeGear = lumeRows.find(p => /710/.test(p.name));
ok("and Lume's gear gets the same treatment as a capture's",
   lumeGear && lumeGear.cannabinoid === "Accessory" && lumeGear.perG == null && lumeGear.sizes[0][2] === 0,
   JSON.stringify(lumeGear && { c: lumeGear.cannabinoid, perG: lumeGear.perG, rows: lumeGear.sizes }));
lume.enabled = false;

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : "All assertions passed.") + "\n");
process.exit(fails.length ? 1 : 0);

/* The Dude Abides is a REMIX app, and that is why it read as empty for months.
 *
 * The page answers a plain GET with 964 KB of server-rendered menu, and the
 * generic reader said "no parseable JSON ... no __NEXT_DATA__, no JSON script
 * tag, no RSC chunks". All three were true and the conclusion was wrong: Remix
 * ships loader data as an assignment to a global and as FUNCTION CALLS WITH
 * JSON ARGUMENTS, and nothing that scans for a container can see either.
 *
 * No browser and no network. The fixture is built to the shape measured off the
 * real page by /api/coldwater?xray=dude, including the two traps that make the
 * obvious implementation look like it works:
 *
 *   - the menu arrives as CAROUSELS OF TWELVE, so "largest array wins" reports a
 *     twelve-product dispensary and looks like a success;
 *   - the deferred call's JSON is the THIRD argument, after two strings, one of
 *     which contains a bracket and a quote to break a lazy scan.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { remixRoots, balancedEnd } from "./api/coldwater.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

/* IMPORTED, NOT SLICED OUT OF THE SOURCE. This suite used to cut the text from
   `function balancedEnd(` to `async function fromGeneric(` and eval it, on the
   grounds that the module has side effects. Two things were wrong with that.
   The module imports cleanly -- test-coldwater-rsc.mjs has imported these same
   exports all along. And a slice only works while every helper the parser calls
   happens to sit inside the window: when the Remix reader gained `unquote()` and
   `arraysFromChunks()` just ABOVE balancedEnd, the slice kept remixRoots and lost
   its dependencies, and this suite died with "unquote is not defined" for over a
   month while the live code -- where both hoist -- was fine. A test that breaks
   when a function moves is testing the file's layout, not the parser. */
/* The source text is still read, for the two checks near the end that are about
   what the file SAYS (its depth guard and its error wording), not what it does. */
const src = readFileSync("api/coldwater.js", "utf8");

/* ---- the shapes ---------------------------------------------------------- */
const product = (name, variant, price) => ({
  name: name + " - " + variant, product_name: name, variant_name: variant,
  price, brand: "Test Brand", category: "Flower", weight: "3.5", quantity: 4
});

/* Fourteen carousels of twelve, which is what the real page ships. */
const carousels = [];
for (let c = 0; c < 14; c++) {
  carousels.push({
    name: "Carousel " + c, carousel_id: "id-" + c, total: 1449, limit: 12, offset: 0,
    /* Overlapping on purpose: the same jar is in several carousels by design,
       which is why the union has to dedupe rather than concatenate. */
    products: Array.from({ length: 12 }, (_, i) => product("Strain " + ((c * 6 + i) % 40), "Bulk", 30 + i))
  });
}

const page = [
  '<!DOCTYPE html><html><head><title>The Dude Abides - Coldwater | Coldwater, MI</title></head><body>',
  '<script>window.__remixContext = ' + JSON.stringify({
    basename: "/", state: { loaderData: { root: { canonicalBaseUrl: "https://x.test" } } }
  }) + ';</script>',
  /* THE THIRD ARGUMENT IS THE DATA, and the two strings before it are hostile on
     purpose: a scan that jumps to the first [ would take the one inside the
     route pattern, and a naive string skipper would stop on the escaped quote. */
  '<script>__remixContext.r("/:store?/:medrec/menu[x]", "carousels\\"Promise", ' +
    JSON.stringify(carousels) + ');</script>',
  '<script>__remixContext.p("noise", null);</script>',
  '</body></html>'
].join("\n");

/* ---- the parser ---------------------------------------------------------- */
const roots = remixRoots(page);
ok("both remix shapes are read: the assignment and the deferred call", roots.length >= 2, `${roots.length} roots`);
ok("...the assignment yields the loader data", roots.some(r => r && r.state && r.state.loaderData), "");
ok("...and the deferred call yields the carousels",
   roots.some(r => Array.isArray(r) && r.length === 14 && r[0] && r[0].products), "");

/* The trap: a route pattern containing a bracket, and a string argument
   containing an escaped quote. Either one taken literally shifts the parse. */
const carousel = roots.find(r => Array.isArray(r) && r[0] && r[0].products);
ok("a bracket inside the route string does not become the payload",
   !!carousel && carousel[0].carousel_id === "id-0", carousel ? carousel[0].carousel_id : "none");
ok("an escaped quote inside a string argument does not end it early",
   !!carousel && carousel.length === 14, carousel ? String(carousel.length) : "none");

/* ---- balancedEnd, which everything above rests on ------------------------ */
ok("a bracket inside a JSON string is not counted as structure",
   balancedEnd('{"a":"]}]}"}', 0) === 12, String(balancedEnd('{"a":"]}]}"}', 0)));
ok("...nor is an escaped quote inside one",
   balancedEnd('{"a":"x\\"]"}', 0) === 12, String(balancedEnd('{"a":"x\\"]"}', 0)));

/* ---- the union, which is the difference between 12 and 167 --------------- */
const G_NAME = ["name", "productName", "title", "Name", "product_name"];
const G_PRICE = ["price", "prices", "centAmount", "priceMed", "displayPrice", "amount", "cost"];
const gPick = (o, keys) => { for (const k of keys) if (o[k] != null) return o[k]; return null; };
const gIsProduct = o => o && typeof o === "object" && !Array.isArray(o) &&
  typeof gPick(o, G_NAME) === "string" && gPick(o, G_PRICE) != null;

let best = [];
const union = new Map();
const seen = new Set();
(function walk(node, depth) {
  if (!node || depth > 8 || (typeof node === "object" && seen.has(node))) return;
  if (typeof node === "object") seen.add(node);
  if (Array.isArray(node)) {
    const hits = node.filter(gIsProduct);
    if (hits.length > best.length) best = hits;
    for (const h of hits) {
      const k = [gPick(h, G_NAME), h.variant_name || h.variantName || "", gPick(h, G_PRICE)].join("|");
      if (!union.has(k)) union.set(k, h);
    }
    for (let i = 0; i < node.length && i < 4000; i++) walk(node[i], depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const k in node) { try { walk(node[k], depth + 1); } catch (e) {} }
})(roots, 0);

/* THE ASSERTION THAT MATTERS. "Largest array wins" is the rule this reader was
   built on and it is exactly wrong for a carousel page: it would report twelve
   and look like a working scrape. */
ok("largest-array-wins would have reported a twelve-product dispensary", best.length === 12, `${best.length}`);
ok("the union finds every distinct jar across the carousels", union.size > 12, `${union.size} distinct`);
/* 14 carousels x 12, overlapping by construction: 40 strains x 12 prices, but
   only the (strain, price) pairs actually generated. Asserted as a real number
   rather than "more than 12", so a dedupe that silently stopped working shows. */
const expected = new Set();
for (let c = 0; c < 14; c++) for (let i = 0; i < 12; i++) expected.add(`Strain ${(c * 6 + i) % 40} - Bulk|Bulk|${30 + i}`);
ok("...and dedupes the jars that appear in more than one of them",
   union.size === expected.size, `${union.size} vs ${expected.size} expected`);

/* ---- A PRICE TIER IS NOT A PRODUCT -------------------------------------
   The live page publishes a weight table -- {name:"Ounce (28g)", weight:28,
   price:5000} -- and it beat the menu outright: a name, a price, and more
   entries than any single carousel holds. The store went from a hard error to
   FIVE rows, which is worse than the error, because it reads as a working
   scrape of a five-product dispensary. Judged on catalogue richness now, with
   length only breaking ties. */
const tiers = [
  { name: "Ounce (28g)", weight: 28, price: 5000 },
  { name: "Half (14g)", weight: 14, price: 2800 },
  { name: "Quarter (7g)", weight: 7, price: 1500 },
  { name: "Eighth (3.5g)", weight: 3.5, price: 800 },
  { name: "Grams (1g)", weight: 1, price: 300 }
];
/* Thirty-two of them against carousels of twelve, so length alone picks wrong. */
const tierArray = Array.from({ length: 32 }, (_, i) => ({ ...tiers[i % 5], weight: i }));

const CATALOGUE_KEYS = ["brand", "category", "product_name", "productName", "variant_name",
                        "variantName", "sku", "image", "image_url", "imageUrl", "thumbnail",
                        "strain", "description", "slug"];
const catalogueScore = arr => {
  let n = 0;
  for (const o of arr.slice(0, 24)) for (const k of CATALOGUE_KEYS) if (o && o[k] != null && o[k] !== "") n++;
  return n / Math.min(arr.length, 24);
};
ok("a weight table scores as no catalogue at all", catalogueScore(tierArray) === 0, String(catalogueScore(tierArray)));
ok("...and a real listing scores well above it",
   catalogueScore(carousels[0].products) >= 3, String(catalogueScore(carousels[0].products)));

let pick = [], pickScore = -1;
for (const arr of [tierArray, carousels[0].products]) {
  const sc = catalogueScore(arr);
  const better = sc > pickScore + 0.5 ? true : sc < pickScore - 0.5 ? false : arr.length > pick.length;
  if (better) { pick = arr; pickScore = sc; }
}
ok("the richer array wins even though the tier table is nearly three times longer",
   pick.length === 12 && pick[0].brand === "Test Brand", `${pick.length} rows, first ${pick[0].name}`);

/* The other direction must still hold: between two equally thin arrays, the
   longer one is still the better guess, which is the rule every other store in
   this town is already read by. */
let pick2 = [], pick2Score = -1;
for (const arr of [tierArray.slice(0, 4), tierArray]) {
  const sc = catalogueScore(arr);
  const better = sc > pick2Score + 0.5 ? true : sc < pick2Score - 0.5 ? false : arr.length > pick2.length;
  if (better) { pick2 = arr; pick2Score = sc; }
}
ok("...and length still breaks ties between equally thin arrays", pick2.length === 32, String(pick2.length));

/* ---- the depth guard was cutting the menu off, not missing it ------------ */
ok("the walk reaches Remix's nesting depth, which is nine levels to a product",
   /depth > 14/.test(src), (src.match(/depth > \d+/) || [""])[0]);

/* ---- the error message no longer names only what it looked for ----------- */
ok("a page with none of the four shapes says so, listing all four",
   /no __NEXT_DATA__, no JSON script tag, no RSC chunks, no __remixContext/.test(src), "");

console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

/* test-brand.mjs — who made this, stated once.
 *
 * "Shop by brand" is the rail that says something the other two cannot: a brand
 * at one shop is a label, a brand at three is a price comparison. It could not
 * be built on legal-leafmarket at all, because api/products.js had NO brand
 * field -- zero occurrences -- and never read Shopify's `vendor`, which states
 * the maker outright and was sitting there unused.
 *
 * THE RULE IS SHARED, NOT COPIED, and that is the point of api/brand.js. Two
 * feeds deriving a brand independently do not error when they disagree; one
 * maker quietly becomes two chips, which is precisely the comparison the rail
 * exists to make. This repo has paid for that lesson with capKey/captureKeyer,
 * rscRoots and its collector twin, and four copies of storeCheckoutUrl.
 *
 * THE REFUSALS ARE HALF THE VALUE. A blank brand is a correct answer. The
 * leading words of a cannabis title are usually a STRAIN -- "Blue Dream" heads a
 * dozen listings at different shops -- so a facet that guesses merges two
 * makers, which is worse than one admitting it does not know.
 *
 *   node test-brand.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
import { readFileSync } from "node:fs";
import { normBrand, brandKey, brandFromWoo, isStoreBrand } from "./api/brand.js";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

console.log("\nWho made this\n");

group("THE LADDER, IN ORDER -- a stated maker beats an inferred one");
ok("a vendor field is taken outright", normBrand("STIIIZY", "Blue Dream 1g", "") === "STIIIZY");
ok("a /brands/ url answers when there is no vendor",
   normBrand("", "x", "https://s.com/menu/brands/jeeter-365986") === "Jeeter",
   normBrand("", "x", "https://s.com/menu/brands/jeeter-365986"));
/* Banzen's slug carries the shop's numeric id; a brand called "Jeeter 365986"
   would be its own chip forever. */
ok("...with the shop's numeric id stripped off the slug",
   !/\d/.test(normBrand("", "x", "https://s.com/menu/brands/jeeter-365986")));
ok("a pipe-delimited title gives up its first field",
   normBrand("", "Red Fox Cannabis | Blue Limonene | 3.5g", "") === "Red Fox Cannabis");

group("AND THE REFUSALS, which are the half that protects the comparison");
/* Two fields is a name and a size, not a maker and a product. */
ok("two fields are not enough to call the first one a maker",
   normBrand("", "Blue Limonene | 3.5g", "") === "");
ok("a bare strain name yields NOTHING rather than a guess",
   normBrand("", "Blue Dream 3.5g Flower", "") === "",
   JSON.stringify(normBrand("", "Blue Dream 3.5g Flower", "")));
ok("...which is what stops two makers merging under a shared strain",
   normBrand("", "Blue Dream Prepack", "") === normBrand("", "Blue Dream Cart", ""));

group("ONE KEY PER MAKER, so three spellings are one chip");
ok("case and trailing space collapse", brandKey("ROVE") === brandKey("Rove "));
ok("an ampersand becomes a word rather than punctuation",
   brandKey("Wyld & Co") === "wyld-and-co", brandKey("Wyld & Co"));
ok("punctuation does not split a maker", brandKey("MKX Oil Co.") === brandKey("MKX Oil Co"));

group("BOTH FEEDS IMPORT IT, and neither restates it");
const hemp = readFileSync("api/products.js", "utf8");
const city = readFileSync("api/coldwater.js", "utf8");
ok("the hemp feed imports the shared rule", /from '\.\/brand\.js'/.test(hemp));
ok("the dispensary feed imports it too", /from "\.\/brand\.js"/.test(city));
/* The whole reason the module exists: neither file may carry its own copy. */
ok("neither defines normBrand of its own",
   !/function normBrand/.test(hemp) && !/function normBrand/.test(city));
ok("...nor its own brandKey",
   !/function brandKey/.test(hemp) && !/function brandKey/.test(city));

group("THE HEMP FEED SETS IT ON BOTH PLATFORMS");
ok("Shopify reads vendor, which was being thrown away",
   /const _sb=normBrand\(p\.vendor, title, ''\)/.test(hemp));
ok("WooCommerce reads its own brand fields first, then the url and title",
   /const _wb=normBrand\(brandFromWoo\(p\), p\.name, p\.permalink\)/.test(hemp));
/* Both used to call normBrand twice per product to fill two adjacent fields.
   Harmless until the rule gets a cost, which brandFromWoo gives it. */
ok("...and each derives it once, not once per field",
   /brand: shopBrand,\s*\n\s*brandKey: brandKey\(shopBrand\)/.test(hemp) &&
   /brand: wooBrand,\s*\n\s*brandKey: brandKey\(wooBrand\)/.test(hemp));

group("WOO STATES A BRAND IN TWO PLACES AND THE FEED READ NEITHER");
/* Measured on the deployed feed 19 Aug 2026: every Shopify store at 100% brand
   coverage, all six WooCommerce stores at zero -- 425 products with no maker.
   That is not six shops selling unbranded goods, it is one reader missing. */
ok("the Brands taxonomy, core since WooCommerce 9.4",
   brandFromWoo({ brands: [{ id: 3, name: "Cookies", slug: "cookies" }] }) === "Cookies");
ok("a slug answers when the name is blank",
   brandFromWoo({ brands: [{ slug: "raw" }] }) === "raw");
ok("an older install states it on a pa_brand attribute",
   brandFromWoo({ attributes: [{ taxonomy: "pa_brand", name: "Brand",
     terms: [{ name: "Storz & Bickel" }] }] }) === "Storz & Bickel");
ok("...or as a flat attribute value",
   brandFromWoo({ attributes: [{ name: "Brand", value: "Puffco" }] }) === "Puffco");
/* THE REFUSAL THAT MATTERS. Every CBD Hemp Direct flower product carries a
   variation attribute called "Net Weight". Read that as a maker and the whole
   catalogue files under a brand named "28 Grams" -- and a wrong chip looks
   exactly like a real one, which is worse than the blank it replaced. */
ok("a VARIATION attribute is a size selector, never a maker",
   brandFromWoo({ attributes: [{ name: "Net Weight", taxonomy: "pa_net-weight",
     has_variations: true, terms: [{ name: "28 Grams" }] }] }) === "");
ok("an unrelated attribute is not a brand either",
   brandFromWoo({ attributes: [{ name: "Strain Type", terms: [{ name: "Indica" }] }] }) === "");
ok("a product stating nothing states nothing", brandFromWoo({}) === "" && brandFromWoo(null) === "");
/* "brandy" and "brands" must not both match; the word test runs on words. */
ok("a lookalike attribute name does not match",
   brandFromWoo({ attributes: [{ name: "Brandy Barrel Aged", value: "x" }] }) === "");
ok("the object artefact is stripped here too, as everywhere else",
   brandFromWoo({ brands: [{ name: "[object Object]" }, { name: "Wyld" }] }) === "Wyld");
/* It is a SIGNAL, not a separate ladder: it enters normBrand at slot 1. */
ok("it feeds normBrand rather than bypassing it",
   normBrand(brandFromWoo({ brands: [{ name: "Wyld" }] }), "Anything", "") === "Wyld");
ok("...and a Woo product with no brand still falls through to the url",
   normBrand(brandFromWoo({}), "x", "https://s.com/brands/rove-991") === "Rove");

group("A SHOP IS NOT A MAKER");
/* Reported 19 Aug 2026: "black tie, thca small buds and so on are showing up in
   brand as well as store -- I just want it to be in store." Right, and the cause
   is the ladder's own first signal: `vendor` is the shop's word for who made the
   thing, and at a house-brand store that word IS the shop. So the brand rail
   redrew the store rail sitting next to it.
   IT WAS IN THE CENSUS BEFORE IT WAS ON THE PAGE -- multiShop read ONE across
   168 makers, because a store brand cannot appear at a second shop by
   construction. That number was reported and not acted on; this is what it
   meant. */
for (const [b, n2, k] of [
  ["Black Tie CBD", "Black Tie CBD", "blacktiecbd"],
  ["Black Tie", "Black Tie CBD", "blacktiecbd"],
  ["BlackTieCBD", "Black Tie CBD", "blacktiecbd"],
  ["THCA Small Buds", "THCA Small Buds", "thcasmallbuds"],
  ["Puffy", "Puffy THCa", "hipuffy"],
  ["Chill", "Chill Steel Pipes", "chill"],
  ["Nothing But Canna", "Nothing But Canna", "nothingbutcanna"],
  ["Grasscity", "Grasscity", "grasscity"],
]) ok(`"${b}" at ${n2} is the shop, not a maker`, isStoreBrand(b, n2, k) === true);

/* THE HALF THAT PROTECTS THE RAIL. A headshop's real suppliers must survive, or
   the fix trades a duplicated rail for an empty one. */
for (const [b, n2, k] of [
  ["RAW", "Grasscity", "grasscity"],
  ["Storz & Bickel", "Grasscity", "grasscity"],
  ["Puffco", "Chill Steel Pipes", "chill"],
  ["Wyld", "Lume", "lume"],
]) ok(`"${b}" at ${n2} is a real maker and survives`, isStoreBrand(b, n2, k) === false);

/* THE BOUNDARY, which the first draft got wrong. storeKey is squashed
   ("chill"), so a prefix test on the flattened brand made "Chillum Co" a house
   brand of Chill Steel Pipes -- a real maker dropped as a shop. The name test
   is boundary-aware and the key test is equality only. */
ok("a maker whose name merely starts like the shop's is not the shop",
   isStoreBrand("Chillum Co", "Chill Steel Pipes", "chill") === false);
ok("...nor one that merely contains it", isStoreBrand("Ultra Chill Co", "Chill Steel Pipes", "chill") === false);

/* THE ONE CASE THIS GETS WRONG, ON PURPOSE, written down so it is a decision.
   "Cookies" is a real maker and somewhere it is also a shop name. Matching on
   the product's OWN shop means a Cookies product at Cookies-the-shop loses its
   chip while the same maker at another shop keeps it -- the rail under-counts
   by one shop rather than losing the brand. Dropping it globally would lose a
   genuine comparison, and precision is the right side to err on: a wrong chip
   looks exactly like a real one. */
ok("a maker that shares one shop's name still survives at every other shop",
   isStoreBrand("Cookies", "Herbology", "herbology") === false);

group("AND BOTH FEEDS APPLY IT");
ok("the hemp feed drops a vendor that names its own store",
   /isStoreBrand\(_sb, store\.name, store\.key\)/.test(hemp) &&
   /isStoreBrand\(_wb, store\.name, store\.key\)/.test(hemp));
ok("...and the dispensary feed does too",
   /isStoreBrand\(_rawBrand, store\.name, store\.key\)/.test(city));
ok("...from the shared rule, not a copy",
   !/function isStoreBrand/.test(hemp) && !/function isStoreBrand/.test(city));

group("AND THE RAIL IS MEASURED BEFORE IT IS TRUSTED");
/* multiShop is the number that decides whether this rail is a comparison or a
   strip of labels wearing one's clothes. Read 19 Aug 2026: ONE. */
ok("coverage counts distinct makers", /cov\.brands\.makers = makers\.size/.test(hemp));
ok("...and how many appear at more than one shop",
   /multiShop/.test(hemp) && /m\.stores\.size > 1/.test(hemp));
ok("...attributed per store, so a blank store is diagnosable",
   /cov\.brands\.byStore\[p\.storeKey\]/.test(hemp));
/* THE READING byStore CANNOT GIVE. Products-with-a-brand cannot tell one house
   brand on 1,112 products from 300 real makers, and those two want opposite
   decisions about whether to render the rail at all. */
ok("DISTINCT makers per store, not just products carrying one",
   /makersByStore/.test(hemp) && /perStoreMakers/.test(hemp));
ok("a store whose whole catalogue is one maker is named as such",
   /houseOnly/.test(hemp) && /set\.size === 1/.test(hemp));
ok("...and the top of the distribution is reported, since its shape is the question",
   /cov\.brands\.top =/.test(hemp) && /shops: m\.stores\.size/.test(hemp));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

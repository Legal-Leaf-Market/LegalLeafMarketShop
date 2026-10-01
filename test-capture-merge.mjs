/* A capture may fill a gap. It may not make a field poorer.

   FROM ONE REPORT: "the blacktie subscription is a complicated pull. it needs
   to have a type and quantity drop down. and it currently has no picture
   either." Read out of the live feed with ?debug&find=subscription, that
   product was:

     image: ".../67377d17e4f4bdf16b5487e0_chevron-down.svg"
     sizes: [["One Size", 15, 0, "blacktiecbd-cap-0", true, null, false]]
     gallery: [four real Shopify product photographs]
     url:   ".../budtenders-choice-flower-subscription"   (no ref stamp)

   The `-cap-` id is the tell: a rendered-page CAPTURE had merged onto a
   perfectly good scrape and replaced three things with worse ones. The comment
   over the merge said "fill the gaps rather than overwrite wholesale" and the
   loop under it replaced every non-empty field, which is how all three
   symptoms arrived at once from one line.

   THREE RULES, and each is a different kind of wrong:

   1. RICHER WINS. A one-row capture must not replace a six-row scrape. That is
      the missing type-and-quantity dropdown.
   2. PRICING IS ATOMIC -- the rule api/coldwater-merge.js already states for the
      lanes. startsAt, sale and perG are DERIVED from sizes, so one lane's rows
      under another lane's per-gram is a card that is individually plausible and
      collectively nonsense, and the engine RANKS on that number.
   3. THE URL KEEPS ITS AFFILIATE STAMP. refUrl() stamps the scraped url; a
      captured link carries none. Overwriting it produces a link that works, a
      customer who buys, and a commission of zero, with nothing anywhere showing
      it went wrong.

     node test-capture-merge.mjs
*/
process.env.LL_NO_STORE_FETCH = "1";
import { readFileSync } from "node:fs";
import { captureVerdict, captureToProduct, nameFromUrl } from "./api/products.js";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

console.log("\nA capture may fill a gap\n");

/* The merge is inside the request handler and needs a live scrape to reach, so
   the RULES are read out of the shipped source and executed here. Same approach
   as test-catrow-pictures.mjs: a test that restated them would pass forever
   while the file did something else. */
const src = readFileSync("api/products.js", "utf8");
const block = src.slice(src.indexOf("A CAPTURE MAY FILL A GAP"),
                        src.indexOf("refreshed++;", src.indexOf("A CAPTURE MAY FILL A GAP")));
ok("the merge block was located, so the checks below are not vacuous",
   block.length > 800 && /seen\.sizes/.test(block), block.length + " chars");

/* Executed, not read: build the same seen/prod pair the handler would and run
   the shipped statements over it. */
function merge(seen, prod) {
  const body = block.slice(block.indexOf("const rows ="));
  new Function("seen", "prod", body)(seen, prod);
  return seen;
}
const scraped = () => ({
  image: "https://cdn.shopify.com/real-product.jpg",
  sizes: [["1/8 oz", 40, 3.5, "v1", true], ["1 oz", 200, 28, "v2", true],
          ["1/4 lb", 600, 112, "v3", true]],
  startsAt: 40, sale: 40, perG: 1.79, inStock: false,
  description: "The shop's own copy.",
  url: "https://shop.test/p/x?ref=coffeeandajoint",
});

group("1 · RICHER WINS");
/* The Black Tie shape exactly: one flat row, a UI icon, an unstamped url. */
const thin = {
  image: "https://cdn.test/chevron-down.svg",
  sizes: [["One Size", 15, 0, "blacktiecbd-cap-0", true]],
  startsAt: 15, sale: 15, perG: 0.88, inStock: true,
  description: "", url: "https://shop.test/p/x",
};
let m = merge(scraped(), thin);
ok("a one-row capture does not replace the variant ladder", m.sizes.length === 3,
   m.sizes.length + " rows");
ok("...so the type and quantity dropdown survives",
   m.sizes.map(r => r[0]).join(" | "), m.sizes.map(r => r[0]).join(" | "));
ok("a UI icon does not replace a real product photograph",
   m.image === "https://cdn.shopify.com/real-product.jpg", m.image);

group("2 · PRICING IS ATOMIC");
ok("prices did not travel without the rows they came from",
   m.startsAt === 40 && m.sale === 40 && m.perG === 1.79,
   `startsAt ${m.startsAt}, sale ${m.sale}, perG ${m.perG}`);
/* And the other way: a RICHER capture brings its prices with it, or the card
   shows one lane's rows under another lane's per-gram. */
const rich = {
  sizes: [["1/8 oz", 30, 3.5, "c1", true], ["1 oz", 150, 28, "c2", true],
          ["1/4 lb", 500, 112, "c3", true], ["1/2 lb", 900, 224, "c4", true]],
  startsAt: 30, sale: 30, perG: 1.34, inStock: true,
};
const m2 = merge(scraped(), rich);
ok("a richer capture does replace the rows", m2.sizes.length === 4, m2.sizes.length + " rows");
ok("...and its prices come with them", m2.sale === 30 && m2.perG === 1.34,
   `sale ${m2.sale}, perG ${m2.perG}`);

group("3 · THE URL KEEPS ITS AFFILIATE STAMP");
/* The one that costs money and shows no symptom. */
ok("a captured link never replaces the stamped one",
   m.url === "https://shop.test/p/x?ref=coffeeandajoint", m.url);
ok("...and the merge does not touch url at all", !/seen\.url/.test(block));

group("WHAT THE CAPTURE IS STILL FOR");
/* Three of these stores report most of their catalogue out of stock to a lambda
   and correctly to a browser. That is the reason this lane exists. */
ok("stock is taken from the capture, always", m.inStock === true, String(m.inStock));
const m3 = merge(scraped(), { inStock: false, sizes: [] });
ok("...including when it says sold out", m3.inStock === false, String(m3.inStock));
ok("a gap is still filled", merge({ image: "", sizes: [] }, thin).image === thin.image);
ok("...and copy only where there is none",
   merge({ description: "" }, { description: "captured copy" }).description === "captured copy" &&
   merge({ description: "kept" }, { description: "captured copy" }).description === "kept");

group("AND A CHEVRON IS NOT A PRODUCT PHOTO");
/* Upstream of all of it: whatever the collector returns IS the photo, and
   nothing asked whether it looked like one. */
const col = readFileSync("public/coldwater-collector.js", "utf8");
const ui = new Function(col.slice(col.indexOf("var UI_IMG ="), col.indexOf("function imageOf")) +
  "\nreturn looksLikeUi;")();
for (const bad of ["https://cdn.test/67377d17_chevron-down.svg", "https://x.test/i/caret-left.png",
                   "https://x.test/assets/sprite.svg", "https://x.test/logo.svg",
                   "https://x.test/img/arrow_right.png", "https://x.test/placeholder.png"])
  ok(`refused: ${bad.split("/").pop()}`, ui(bad) === true);
/* The refusal tests the PATH, so a product legitimately named "Arrow" keeps its
   photo -- precision over recall, the same rule isNonConsumable() states. */
for (const good of ["https://cdn.shopify.com/files/Purple_Kush_large_buds.jpg",
                    "https://cdn.test/products/arrowhead-kush-eighth.jpg",
                    "https://images.dutchie.com/abc123.png",
                    "https://x.test/wp-content/uploads/2026/05/collage1.png"])
  ok(`kept: ${good.split("/").pop()}`, ui(good) === false);
/* A card's first <img> is often a control, so the reader has to move on rather
   than give up -- otherwise the refusal trades furniture for nothing at all. */
ok("the rendered-page reader scans every image on the card, not just the first",
   /querySelectorAll\("img"\)/.test(col) && /q < ims\.length/.test(col));

group("AND THE OTHER SUBSCRIPTION'S MISSING WEIGHTS");
/* Found by the same ?debug&find= call. CBD Hemp Direct's rows are
   "Quantity: 1 Ounce" -> 28.35, "Quantity: 2 Ounces" -> 0, "4 Ounces" -> 0, so
   two of three sizes had no weight, no price per gram, and no place in the
   ranking the whole site is built on. \bounce\b cannot match the plural -- the
   boundary fails between the e and the s -- and where it did match it threw the
   quantity away. */
const gi = src.indexOf("function grams(");
const grams = new Function(src.slice(gi, src.indexOf("\n}", gi) + 2) + "; return grams;")();
for (const [label, want] of [
  ["Frequency: Monthly, Quantity: 1 Ounce", 28.35],
  ["Frequency: Monthly, Quantity: 2 Ounces", 56.7],
  ["Frequency: Every 2 Weeks, Quantity: 4 Ounces", 113.4],
  ["1 oz", 28.35], ["2oz", 56.7], ["half ounce", 14],
]) ok(`"${label}" -> ${want}g`, Math.abs(grams(label) - want) < 0.02, String(grams(label)));
/* THE REFUSALS MATTER AS MUCH: a wrong weight is a fabricated price per gram,
   and the engine ranks on it. These have to stay zero. */
for (const label of ["One Size", "10 pack", "1 1/4", '2 1/8"'])
  ok(`"${label}" is not a weight`, grams(label) === 0, String(grams(label)));
/* Pinned because the fraction and pound branches run BEFORE this one and an
   ordering change would break them silently. */
for (const [label, want] of [["1/8 oz", 3.5], ["1/4 lb", 113.4], ["Quarter Pound", 113.4]])
  ok(`"${label}" still reads ${want}g`, Math.abs(grams(label) - want) < 0.02, String(grams(label)));

group("A CAPTURED PRODUCT IS THE SHAPE THE ENGINE ACTUALLY READS");
/* Reported as Lookah's "logo and products are both NOT there" -- one cause with
   two faces, and it only became total at a shop with NO readable catalogue API,
   where every row is capture-only and has no scraped row to merge onto and
   inherit from.

   THE ENGINE'S OWN EXPRESSION IS RUN HERE, read back out of public/engine.js
   rather than restated, because the claim is about what that line does to this
   object -- and a paraphrase would pass while the page threw. */
{
  const engSrc = readFileSync("public/engine.js", "utf8");
  const otdLine = engSrc.split("\n").find(l => l.includes("const otd = p.sale + (p.badges"));
  ok("the engine still builds every card through an unguarded p.badges", !!otdLine,
     (otdLine || "").trim());
  const otdOf = new Function("p", (otdLine || "return 0").trim() + "; return otd;");

  const store = { key: "lookah", name: "Lookah", domain: "lookah.com", accessory: true, ref: "", coupon: "" };
  const cap = { name: "Lookah 9\" Shark Attack Glass Bong", category: "Bongs & Rigs",
                image: "https://www.lookah.com/x.jpg", inStock: true,
                url: "https://www.lookah.com/bongs-and-water-pipes/wpc1241gr.html",
                sizes: [{ label: "One Size", price: 104.65 }] };
  const v = captureVerdict(cap, store);
  ok("the capture is admitted", v.ok === true, JSON.stringify(v.reason || "ok"));
  const prod = captureToProduct(store, cap, v.cl);

  /* THE ONE THAT HID THE PRODUCTS. Without badges this throws a TypeError while
     the card is being built -- and the FILTER above it is guarded, so nothing
     fails until the shopper reaches the card. That is why 971 missing products
     looked like missing products rather than an error. */
  let threw = null;
  try { otdOf(prod); } catch (e) { threw = e.constructor.name + ": " + e.message; }
  ok("...and the engine can build its card without throwing", threw === null, String(threw));
  ok("...because a capture now carries an empty badge list, not none",
     Array.isArray(prod.badges) && prod.badges.length === 0, JSON.stringify(prod.badges));

  /* THE ONE THAT HID THE LOGO. The store strip keys a shop's favicon on the
     domain the FEED carries, gathered from any product of that shop -- so a shop
     whose every row is a capture had no mark at all. */
  ok("...and says where its shop lives, which is what the logo is keyed on",
     prod.domain === "lookah.com", String(prod.domain));

  /* THE QUIET ONE: a captured url carries no affiliate stamp, so a capture-only
     row at a shop with a real programme is a link that works, a customer who
     buys, and a commission of zero. */
  ok("a captured url is stamped where the shop has an id",
     captureToProduct({ ...store, key: "hitoki", name: "Hitoki", domain: "hitoki.com",
                        ref: "coffeeandajoint" }, cap, v.cl).url.includes("ref=coffeeandajoint"),
     captureToProduct({ ...store, key: "hitoki", ref: "coffeeandajoint" }, cap, v.cl).url);
  ok("...and left alone where it has none", prod.url.indexOf("ref=") < 0, prod.url);
  /* A shop with no url on the row at all used to fall back to store.site, which
     hemp shops do not have -- so the card reached the shelf with an empty link. */
  ok("...and a row with no url of its own still gets the shop's",
     captureToProduct(store, { ...cap, url: "" }, v.cl).url.indexOf("lookah.com") >= 0,
     captureToProduct(store, { ...cap, url: "" }, v.cl).url);
}

group("A NAME WITH NO LETTERS IN IT IS NOT A NAME");
/* Measured on the live shelf: 156 of Lookah's 971 rows -- one in six -- were
   called "(3)", "(25)", "(1)". Those are REVIEW COUNTS the collector read
   instead of the title, and isJunk() passed every one of them, because it
   screens for known junk WORDS and these have no words at all.
   They are not broken products. The urls beside them are real, correctly priced
   listings, so the fix is to RECOVER rather than refuse -- dropping them would
   delete 156 live listings to fix a display bug. Same posture as re-deriving
   grams from the label rather than demanding every shop be re-captured: the rows
   already stored ARE the shelf. */
{
  const store = { key: "lookah", name: "Lookah", domain: "lookah.com", accessory: true, ref: "" };
  const V = (name, url) => {
    const c = { name, url, sizes: [{ label: "One Size", price: 49.99 }] };
    const v = captureVerdict(c, store);
    return { ok: !!v.ok, name: c.name, reason: v.reason };
  };
  ok("a review count is replaced by the shop's own slug",
     V("(35)", "https://www.lookah.com/products/lookah-seahorse-pro-plus-gradient.html").name ===
     "Lookah Seahorse Pro Plus Gradient",
     V("(35)", "https://www.lookah.com/products/lookah-seahorse-pro-plus-gradient.html").name);
  ok("...and the row is admitted rather than dropped",
     V("(23)", "https://www.lookah.com/products/lookah-octopus.html").ok === true);
  /* THE COUNTER-CASE, and the one that makes this safe: a real title must never
     be overwritten by a slug, however much better the slug looks. */
  const real = "LOOKAH Load | 500 mAh Smallest 510 Vape Battery";
  ok("...while a real title is never replaced",
     V(real, "https://www.lookah.com/vaporizers/load.html").name === real, V(real, "x").name);
  /* A LISTING PAGE IS NOT A PRODUCT and its slug makes a convincing name. 44 of
     Lookah's rows were captured off /all-products.html with no per-row link, so
     the url they carry is the page the operator was standing on -- without this
     they come back named "All Products", 44 times, which is worse than the
     number they had. */
  ok("a listing-page slug is refused, not turned into a product name",
     V("(3)", "https://www.lookah.com/all-products.html").reason === "namelessRow",
     JSON.stringify(V("(3)", "https://www.lookah.com/all-products.html")));
  ok("...but only the LAST segment is tested, so /products/<thing> is unaffected",
     nameFromUrl("https://www.lookah.com/products/mini-dragon-egg.html") === "Mini Dragon Egg",
     nameFromUrl("https://www.lookah.com/products/mini-dragon-egg.html"));
  ok("...and a row with neither a name nor a usable url is still refused",
     V("(9)", "").reason === "namelessRow", JSON.stringify(V("(9)", "")));
}

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

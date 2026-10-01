/* test-descriptions.mjs — the sentences, on the back of the card.
 *
 * "One thing we've tried a few times and I would really love to nail globally is
 * grabbing the DESCRIPTION, the sentences, and putting them on the back."
 *
 * IT HAD BEEN TRIED, AND TWO INDEPENDENT FAULTS KEPT IT FROM LANDING. Neither
 * errored; a card back is simply blank when the field is missing, which looks
 * exactly like a shop that writes no copy.
 *
 *   1. THE NAME. public/engine.js renders `p.description` -- three call sites --
 *      and api/coldwater.js has always emitted exactly that. api/products.js
 *      emitted `desc`, which ONLY devices.html and international.html read,
 *      because those two render their own cards. So the two "fastened" pages
 *      worked, and the main grid on legal-leafmarket showed nothing, and so did
 *      every city page, for the same reason.
 *   2. THE GATE. `store.accessory ? plainDesc(...) : ''` limited it to accessory
 *      stores on purpose, to hold the payload down. But the 300-character cut at
 *      a word boundary is what actually bounds the cost, and it applies to every
 *      store equally.
 *
 * And WooCommerce stores had no description field at ALL, so no rename could
 * have reached them.
 *
 * WHAT THIS PINS is the contract between the two feeds and the one renderer:
 * whatever produces a product, the field is called `description`, it is plain
 * text, and it is bounded.
 *
 *   node test-descriptions.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
import { readFileSync } from "node:fs";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

const products = readFileSync("api/products.js", "utf8");
const engine = readFileSync("public/engine.js", "latin1");

console.log("\nThe sentences, on the back of the card\n");

group("ONE NAME, AND IT IS THE ONE THE RENDERER READS");
/* The renderer is the fixed point: it is inside the engine blob and is not
   edited, so both feeds have to meet IT rather than each other. */
ok("the engine renders p.description", /p\.description/.test(engine));
ok("the hemp feed emits `description`", /\bdescription:\s*plainDesc\(/.test(products));
ok("...on Shopify products", /description: plainDesc\(p\.body_html/.test(products));
/* Woo had none at all, so this is not a rename -- it is a field that never
   existed, and no amount of fixing the name would have reached those stores. */
ok("...and on WooCommerce products, which had no description field at all",
   /description: plainDesc\(p\.short_description \|\| p\.description/.test(products));

group("AND IT IS NO LONGER ACCESSORY-ONLY, which is what 'globally' means");
ok("the store.accessory gate is gone",
   !/store\.accessory \? plainDesc/.test(products));
/* The alias is deliberate: devices.html and international.html render their own
   card backs off `desc`, and dropping it would break the two pages that were
   already working -- the opposite of the ask. */
ok("`desc` survives as an alias so the two working pages keep working",
   /desc: plainDesc\(p\.body_html/.test(products));

group("BOUNDED, because payload was the reason for the gate");
/* The cut is what makes global affordable, so it is asserted rather than
   assumed: a card back is not a product page and the vendor link is right
   there. */
ok("every emission passes a 300-character cap",
   (products.match(/plainDesc\([^)]*,\s*300\)/g) || []).length >= 4,
   (products.match(/plainDesc\([^)]*,\s*300\)/g) || []).length + " call sites");
ok("...cut at a word boundary rather than mid-word",
   /const sp = t\.slice\(0, cap\)|lastIndexOf\(' '\)/.test(products));

group("PLAIN TEXT, because this is third-party copy from a scraped page");
/* It goes through esc() in the browser and is never inserted as HTML. Stripping
   here is belt as well as braces, and it is also what stops a card back
   rendering "<p>" and "&nbsp;" at a shopper. */
ok("script and style blocks are removed", products.includes("<script[\\s\\S]*?<\\/script>"));
ok("tags are stripped", /replace\(\/<\[\^>\]\+>\/g, ''\)/.test(products));
ok("entities are decoded, so a card never prints &amp;", /&amp;\/gi, '&'/.test(products));

group("THE CITY FEED ALREADY AGREED, and still must");
const coldwater = readFileSync("api/coldwater.js", "utf8");
ok("api/coldwater.js emits description on its products", /^\s*description,$/m.test(coldwater));
/* The census exists because a zero here is ambiguous -- a shop that writes no
   copy and a capture path that cannot see any look identical on the shelf. */
ok("...and reports coverage per store, so a blank back is diagnosable",
   /out\.descriptions = desc/.test(coldwater));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

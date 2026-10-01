/* test-catrow-pictures.mjs — which product becomes the face of a category.
 *
 * The "Shop by category" rail puts a REAL PRODUCT PHOTO on each chip, chosen by
 * a scoring table (cw-catrow's PREFER). Two reports, one root cause seen from
 * opposite ends:
 *
 *   "topicals is a picture of flower"   -- Topicals had positive terms and NO
 *      negative ones, and every product started at 1 (1.5 with a short title).
 *      So on that table anything qualified, and the first short-titled product
 *      in the bucket became the face of the shelf. It was a bud.
 *
 *   "disposables is an emoji"           -- cw-catsplit promotes Carts,
 *      Disposables and Drinks out of their parent category, so #fCategory offers
 *      all three. PREFER had none of them, so scoreFor fell through HINTS to the
 *      PARENT's table -- and Vaporizers scores -6 for the word "disposable" ON
 *      PURPOSE, because a disposable is a bad picture of a cart. Every
 *      disposable therefore scored negative in its own category, no photo was
 *      ever accepted, and the chip kept its drawn mark.
 *
 * Neither failed loudly. A category with a wrong picture and a category with no
 * picture both render perfectly.
 *
 * IT RUNS THE SHIPPED CODE, NOT A PARAPHRASE OF IT. The scorer lives inside a
 * shared rails file, so this reads PREFER, HINTS and scoreFor back out of
 * public/js/rails.js and executes them. A test that restated the table would
 * pass forever while the page did something else -- which is the whole failure
 * mode this suite exists for.
 *
 *   node test-catrow-pictures.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

/* READ OUT OF public/js/rails.js, which is where the scorer lives now. It used
   to be read out of the generated public/coldwater.html, because that was the
   only place the rail existed -- 65KB injected by tools/make-coldwater.mjs and
   unavailable to legal-leafmarket, the page every city page is generated FROM.
   Reading the shared file is what this suite always meant: the shipped code
   rather than a paraphrase of it, and now it is the code shipped to every page
   rather than to one generated copy of one town. */
const page = readFileSync("public/js/rails.js", "latin1");
const grab = (re, what) => {
  const m = page.match(re);
  if (!m) { console.error("Could not find " + what + " in public/js/rails.js"); process.exit(2); }
  return m[0];
};
const PREFER = grab(/var PREFER = \{[\s\S]*?\n  \};/, "the PREFER table");
const HINTS  = grab(/var HINTS = \[[\s\S]*?\n  \];/, "the HINTS list");
const PSTORE = grab(/var PREFER_STORE = \{[\s\S]*?\};/, "the PREFER_STORE table");
const SCORE  = grab(/function scoreFor\(cat, name, store\)\{[\s\S]*?\n  \}/, "scoreFor");
const scoreFor = new Function(PREFER + "\n" + HINTS + "\n" + PSTORE + "\n" + SCORE +
                              "\nreturn scoreFor;")();

/* THE MIDDLE TIER IS GONE, AND ITS REMOVAL IS THIS SUITE'S THIRD REPORT.
   It used to read: a product matching only a NEGATIVE floors at 0.05, still
   usable because "an empty chip misrepresents a shelf that does carry the
   thing", and merely beaten by anything neutral. Reported anyway, a third time:
   "topicals is flower currently in the picture".

   And the argument was wrong on its own terms, because the alternative was
   never an empty chip. Every category has a DRAWN MARK under the photograph --
   Topicals has its own, at /img/cat/topical.svg -- so refusing a bud costs a
   photograph and yields a picture of a tube of balm. What the 0.05 tier bought
   was the licence to publish a bud as the face of Topicals whenever that shelf
   was thin, which is the entire failure this suite is named for.

     positive match  a real picture of this category
     NEUTRAL 0.25    matched nothing in the table -- usable, unremarkable
     REFUSED 0       matched a negative and nothing else. Not a candidate.

   The negative lists now do what they have always said they did. */
const NEUTRAL = 0.25;
const REFUSED = 0;
const usable  = (cat, name, store) => scoreFor(cat, name, store) > REFUSED;
const beats   = (cat, good, bad) => scoreFor(cat, good) > scoreFor(cat, bad);
const refused = (cat, name) => scoreFor(cat, name) === REFUSED;

console.log("\nWhich product becomes the face of a category\n");

group("THE TWO REPORTS, in their exact shape");
ok("a disposable is the preferred picture of Disposables",
   beats("Disposables", "Torch Live Resin Disposable 1g", "510 Cartridge 1g"),
   scoreFor("Disposables", "Torch Live Resin Disposable 1g") + " vs " +
   scoreFor("Disposables", "510 Cartridge 1g"));
ok("...and the AIO spelling the menus also use scores the same way",
   scoreFor("Disposables", "Wyld Disposable AIO 2g") > 1);
ok("a balm BEATS a bud for Topicals",
   beats("Topicals", "Releaf Balm 1oz", "Blue Dream 3.5g Flower"),
   scoreFor("Topicals", "Releaf Balm 1oz") + " vs " +
   scoreFor("Topicals", "Blue Dream 3.5g Flower"));
/* THE OPERATOR'S CALL, REVERSED ON THE THIRD REPORT. This used to assert the
   bud was still usable "so the chip is never empty". The chip is never empty
   either way -- it falls back to a drawn topical -- so what that bought was a
   bud on the Topicals chip. */
ok("...and the bud is refused outright, not merely outranked",
   refused("Topicals", "Blue Dream 3.5g Flower"),
   String(scoreFor("Topicals", "Blue Dream 3.5g Flower")));
/* AND IT MUST LOSE TO ANYTHING NEUTRAL, which is the half that was missing.
   The example has to be a product Topicals' table says NOTHING about -- a
   gummy will not do, since that word is in its negative list too, and picking
   it first is how this assertion went red on its own author. A grinder matches
   neither side, so it is the neutral tier by definition. */
ok("...and loses to a product the table merely does not recognise",
   beats("Topicals", "4pc Grinder", "Blue Dream 3.5g Flower"),
   scoreFor("Topicals", "4pc Grinder") + " vs " + scoreFor("Topicals", "Blue Dream 3.5g Flower"));
ok("...which is the refused tier against the neutral one",
   scoreFor("Topicals", "Blue Dream 3.5g Flower") === REFUSED &&
   scoreFor("Topicals", "4pc Grinder") === NEUTRAL,
   scoreFor("Topicals", "Blue Dream 3.5g Flower") + " / " + scoreFor("Topicals", "4pc Grinder"));

group("THE THREE CHIPS REPORTED WEARING THE WRONG PICTURE");
/* "Edibles is currently showing a picture of flower ... it needs to be gummies
   or chocolate. Pick one of those." Chocolate was a NEGATIVE here -- written
   when a negative merely lost a tie, and turned into a refusal when the
   last-resort tier was removed. So every chocolate edible stopped being a
   candidate, and a flower product misfiled under Edibles, matching nothing at
   all, took the chip on the neutral tier. */
ok("a gummy is the preferred picture of Edibles",
   beats("Edibles", "Wyld Raspberry Gummies 10pk", "Blue Dream 3.5g Flower"),
   scoreFor("Edibles", "Wyld Raspberry Gummies 10pk") + " vs " +
   scoreFor("Edibles", "Blue Dream 3.5g Flower"));
ok("...and chocolate is a candidate again, not a refusal",
   usable("Edibles", "Dark Chocolate Bar 100mg"), String(scoreFor("Edibles", "Dark Chocolate Bar 100mg")));
/* THE ACTUAL REPORTED PICTURE, refused outright rather than merely outranked:
   a bud is not an unflattering edible, it is a different product. */
ok("...while flower is refused as the face of Edibles",
   refused("Edibles", "Blue Dream 3.5g Flower"), String(scoreFor("Edibles", "Blue Dream 3.5g Flower")));

/* "Trim and shake is currently, like, a disposable vape ... you can even find
   something with trim or shake in the title and go with that." The sub-tag is
   set from title, tags AND description, so a listing reaches this bucket with a
   title that says nothing about shake -- and with no table every candidate
   scored a flat 1, so the winner was whichever rendered first. */
ok("a listing that says shake in its title is the preferred picture",
   beats("Trim/Shake", "Sour Diesel Shake Ounce", "Torch Live Resin Disposable 1g"),
   scoreFor("Trim/Shake", "Sour Diesel Shake Ounce") + " vs " +
   scoreFor("Trim/Shake", "Torch Live Resin Disposable 1g"));
ok("...and a disposable is refused outright", refused("Trim/Shake", "Torch Live Resin Disposable 1g"),
   String(scoreFor("Trim/Shake", "Torch Live Resin Disposable 1g")));
ok("...with trim scoring the same as shake, since they are one facet",
   scoreFor("Trim/Shake", "Hand Trim Ounce") === scoreFor("Trim/Shake", "Hand Shake Ounce"));

/* "Can you just make wholesale some more flower? Maybe the budget buds one
   specifically that's in cellophane." Named, so it is ranked first by name --
   and only ranked, so the next best bulk flower still wins if it is gone. */
ok("Budget Buds leads the Wholesale chip, as asked for by name",
   beats("Wholesale", "Budget Buds THCA Flower Pound", "Bulk Indoor Flower Pound"),
   scoreFor("Wholesale", "Budget Buds THCA Flower Pound") + " vs " +
   scoreFor("Wholesale", "Bulk Indoor Flower Pound"));
ok("...but any bulk flower still beats a cart, so the chip survives it going away",
   beats("Wholesale", "Bulk Indoor Flower Pound", "Live Resin Cart 1g"),
   scoreFor("Wholesale", "Bulk Indoor Flower Pound") + " vs " +
   scoreFor("Wholesale", "Live Resin Cart 1g"));
ok("...and a cart is refused as the face of Wholesale",
   refused("Wholesale", "Live Resin Cart 1g"), String(scoreFor("Wholesale", "Live Resin Cart 1g")));

group("the split facets are scored on their own terms, not their parent's");
ok("a cartridge loses to a disposable on Disposables",
   beats("Disposables", "Wyld Disposable AIO 2g", "510 Cartridge 1g"));
ok("a cart wins on Carts", beats("Carts", "Drip Live Resin Cart 1g", "Disposable AIO 2g"));
ok("a seltzer wins on Drinks", beats("Drinks", "Rosin Seltzer 12oz", "Blue Dream Flower 3.5g"));

group("A CURATED CATEGORY MUST MATCH SOMETHING, which the base score used to defeat");
/* This is the general form of the Topicals bug: a table that lists what a good
   picture looks like should reject a product matching none of it, rather than
   accepting it on the base score and a short title. */
/* A GUMMY IS ON TOPICALS' NEGATIVE LIST, and writing this assertion is what
   proved the entry could never fire: the stem was \bgumm\b, whose trailing
   boundary fails between "m" and "i", so "Gummies 10pk" matched nothing at all
   and scored the NEUTRAL tier. A negative that cannot match is worse than no
   negative, because it reads as handled. Asserted at the last-resort tier now,
   which is what the table always meant to say. */
ok("a gummy is refused on Topicals, never a preference",
   refused("Topicals", "Gummies 10pk"),
   String(scoreFor("Topicals", "Gummies 10pk")));
ok("a prepack beats a disposable for flower",
   beats("THCA Flower", "Blue Dream Prepack 3.5g", "Blue Dream Disposable"));
ok("...and beats shake, which is a different product to a shopper",
   beats("THCA Flower", "Blue Dream Prepack 3.5g", "Sour Diesel Shake 28g"));
ok("rosin beats a cart for Concentrate",
   beats("Concentrate", "Fwaygo Live Rosin 1g", "Live Resin Cart 1g"));

group("and a category NOBODY has described still gets a picture");
/* api/coldwater.js keeps a word normCategory did not recognise rather than
   discarding it, so the strip has to answer for categories no table has seen.
   "Any photo beats no photo" is right there, and must not be broken by the
   stricter rule above. */
ok("an unlisted category accepts any photographed product",
   usable("Budder", "Some Unlisted Thing"), String(scoreFor("Budder", "Some Unlisted Thing")));
/* An uncurated category scores 1+ and a floor-scored one 0.25, so a described
   category still prefers its own kind over a stranger. */
ok("...and outranks a floor-scored candidate elsewhere",
   scoreFor("Budder", "Some Unlisted Thing") > NEUTRAL);
ok("...and still prefers a curated match where HINTS finds it a table",
   scoreFor("Glassware", "4pc Grinder") > scoreFor("Glassware", "Nondescript Item Name Here"),
   scoreFor("Glassware", "4pc Grinder") + " vs " + scoreFor("Glassware", "Nondescript Item Name Here"));

group("A ZERO IS A REFUSAL, NOT AN EMPTY CHIP -- and the difference is the drawn mark");
/* The old claim here was that NOTHING scores zero, because a zero was read as
   an empty chip. It is not: chipFor falls back to iconFor(), a drawn mark
   commissioned for exactly this. So the claim inverts -- what matters is that
   every category still finds SOMETHING on a realistic shelf, while the products
   its table calls bad are refused rather than ranked last. */
{
  const shelf = ["Blue Dream 3.5g Flower", "Gummies 10pk", "Releaf Balm 1oz",
                 "510 Cartridge 1g", "Wyld Disposable AIO 2g", "Rosin Seltzer 12oz",
                 "4pc Grinder", "Sour Diesel Shake 28g", "Lume T-Shirt"];
  const cats = ["THCA Flower", "Pre-rolls", "Vaporizers", "Carts", "Disposables",
                "Concentrate", "Edibles", "Drinks", "Topicals", "Accessories", "Apparel"];
  const empty = cats.filter(c => !shelf.some(n => scoreFor(c, n) > REFUSED));
  ok("every category still finds a candidate on a mixed shelf",
     empty.length === 0, empty.join(", ") || cats.length + " categories");
  /* AND THE REFUSALS ARE REAL, which is the half that makes the above non-trivial:
     if nothing were ever refused the assertion above would pass vacuously. */
  const refusals = [];
  for (const c of cats) for (const n of shelf) if (scoreFor(c, n) === REFUSED) refusals.push(c + " / " + n);
  ok("...while the products a table calls bad are refused outright",
     refusals.length > 0, refusals.length + " refused, e.g. " + refusals.slice(0, 3).join(" | "));
  ok("...including the exact pair that was reported",
     refusals.includes("Topicals / Blue Dream 3.5g Flower"));
}

group("WHOSE PHOTOGRAPH, where the name cannot decide it");
/* "for concentrate, use one of hipuffy's pics". A name cannot express that --
   every shop's badder is called badder -- so the preference is on the store,
   and it is a TIE-BREAK rather than a filter. */
ok("a Puffy rosin beats the same rosin from another shop on Concentrate",
   scoreFor("Concentrate", "Live Rosin 1g", "Puffy THCa") >
   scoreFor("Concentrate", "Live Rosin 1g", "Grasscity"),
   scoreFor("Concentrate", "Live Rosin 1g", "Puffy THCa") + " vs " +
   scoreFor("Concentrate", "Live Rosin 1g", "Grasscity"));
/* IT CANNOT RESCUE A REFUSED PRODUCT, which is what keeps it safe: a Puffy vape
   is still a bad picture of concentrate, and the shop preference must not buy
   it the chip. */
ok("...but it cannot lift a product the category refuses",
   refused("Concentrate", "Puffy Live Resin Cart 1g", "Puffy THCa"),
   String(scoreFor("Concentrate", "Puffy Live Resin Cart 1g", "Puffy THCa")));
/* AND A GOOD PICTURE FROM ANYWHERE STILL BEATS A MEDIOCRE ONE FROM THE NAMED
   SHOP, so the rail never trades correctness for provenance. */
ok("...and a curated match elsewhere still beats a neutral one from Puffy",
   scoreFor("Concentrate", "Fwaygo Live Rosin 1g", "Grasscity") >
   scoreFor("Concentrate", "Nondescript Item", "Puffy THCa"),
   scoreFor("Concentrate", "Fwaygo Live Rosin 1g", "Grasscity") + " vs " +
   scoreFor("Concentrate", "Nondescript Item", "Puffy THCa"));
ok("...and no other category quietly inherited a shop preference",
   scoreFor("Topicals", "Releaf Balm 1oz", "Puffy THCa") ===
   scoreFor("Topicals", "Releaf Balm 1oz", "Grasscity"));

group("the tables the rail actually ships with");
for (const cat of ["Carts", "Disposables", "Drinks", "Topicals"]) {
  ok(cat + " has its own entry rather than inheriting one",
     new RegExp('"' + cat + '":').test(PREFER));
}
/* Every curated table needs at least one negative term, because the positives
   alone cannot tell a bad candidate from an unrecognised one -- that is exactly
   what put a bud on the Topicals chip. */
{
  /* THE LAST ENTRY WAS INVISIBLE TO THIS CHECK, which is how Apparel kept a
     positives-only table for as long as it happened to sit at the end: the
     pattern required the trailing comma that separates entries, and the final
     one has none. It surfaced the moment two tables were added after it -- a
     check that silently skips one item is worse than none, because the count it
     prints looks complete. Matched up to "]]" followed by a comma OR the close
     of the object. */
  const bare = [];
  for (const m of PREFER.matchAll(/"([^"]+)":\s*\[([\s\S]*?)\]\]\s*(?=,|\n\s*\};)/g)) {
    if (!/,\s*-\d/.test(m[2])) bare.push(m[1]);
  }
  /* And the count is asserted, so a pattern that stops matching cannot pass by
     finding nothing to complain about. */
  const seen = [...PREFER.matchAll(/"([^"]+)":\s*\[\[/g)].map(m => m[1]);
  const checked = [...PREFER.matchAll(/"([^"]+)":\s*\[([\s\S]*?)\]\]\s*(?=,|\n\s*\};)/g)].map(m => m[1]);
  ok("...and every table in the file was actually examined",
     checked.length === seen.length,
     checked.length + " of " + seen.length + ": missed " +
     (seen.filter(x => !checked.includes(x)).join(", ") || "none"));
  ok("every curated category states what a BAD picture of it looks like too",
     bare.length === 0, bare.join(", ") || "all have negatives");
}

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

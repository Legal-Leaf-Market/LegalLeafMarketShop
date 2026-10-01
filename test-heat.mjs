/* test-heat.mjs — combustion or vaporizing.
 *
 * Every claim this file makes fails SILENTLY in production. A device filed
 * under the wrong heat still renders, still prices, still sorts; it is simply
 * on the wrong wall, and the only person who finds out is a shopper who came
 * for a dab rig and got handed a beaker.
 *
 * Four things are pinned, and they are four different kinds of claim:
 *
 *   1. THE TRAPS. Each one is a real product name off the live feed that
 *      produces a confident wrong answer under the obvious implementation.
 *   2. THE ORDER. The ladder's order IS the rule (same as classify()'s
 *      synthetics ladder), so it is asserted directly rather than inferred
 *      from a verdict that several orderings would produce.
 *   3. THE SHELVES AGREE WITH THE CLASSIFIER. api/shelves.js imports the
 *      verdict constants rather than restating them, and this proves the
 *      import is load bearing: a product the classifier calls combusting
 *      must land on /combustion and must NOT land on /vaporizers.
 *   4. THE THIRD BUCKET IS REAL. "" is a verdict, not a failure, and the two
 *      heat shelves deliberately do not sum to the gear shelf.
 *
 *     node test-heat.mjs
 */
import { COMBUSTION, VAPOR, STORE_DEFAULT, heatOf } from "./api/heat.js";
import { SHELVES, shelfFor } from "./api/shelves.js";
import { readFileSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`);
  if (!c) fails.push(n);
};
const group = m => console.log("\n" + m);

/* Gear, the way both feeds say it. */
const g = (name, extra = {}) => ({ name, cannabinoid: "Accessory", ...extra });
/* Not gear. */
const flower = name => ({ name, cannabinoid: "THCa", category: "THCA Flower" });

console.log("\nCombustion or vaporizing\n");

/* ------------------------------------------------------------------ */
group("TRAP A: A DEVICE WORD INSIDE A FLOWER NAME");
/* This repo has already shipped this bug twice -- "Pound Cake" read as a
   pound, "Special Sauce Rosin" read as a deal -- so the gate is inside
   heatOf() rather than in its callers.

   THE FIRST DRAFT OF THIS BLOCK PASSED VACUOUSLY, which is worth writing down
   because it is the failure mode of every guard in this repo. It used the two
   real names that prompted the gate -- "Zangbanger THCA Flower" and
   "Headbanger #7" -- and NEITHER of them can reach a ladder at all, because
   the banger test requires a word boundary and "Zangbanger" has a `g` where
   that boundary would be. So the whole block stayed green with the gate
   DELETED. Verified against exactly that edit.

   These four are strains that genuinely trip a ladder: pipe, cone, bowl and
   bong are all real strain words AND real device words. Delete the gate and
   every one of them comes back combusting. */
for (const n of ["Pipe Dream THCA Flower",
                 "Ice Cream Cone THCA Flower",
                 "Cereal Bowl THCA Flower",
                 "Bong Water OG Flower"]) {
  const asGear = heatOf(g(n));
  ok(`flower is never a device: ${n}`, heatOf(flower(n)) === "", heatOf(flower(n)) || "(none)");
  /* ...and prove the name really does reach a ladder, so the assertion above
     cannot be passing for the word-boundary reason instead of for the gate. */
  ok(`  ...and that same name DOES get a verdict as gear`, asGear !== "", asGear || "(none)");
}
/* The two names that prompted the gate, kept as regression cases even though
   the word boundary already refuses them: if the banger test is ever loosened
   to drop its boundary, these go red before a shopper sees a strain on the
   hardware wall. */
for (const n of ["Zangbanger THCA Flower", "Headbanger #7 THCA Flower (Smalls)"]) {
  ok(`flower is never a device: ${n}`, heatOf(flower(n)) === "", heatOf(flower(n)) || "(none)");
  ok(`  ...and the word boundary refuses it even as gear`, heatOf(g(n)) === "", heatOf(g(n)) || "(none)");
}

/* And the counter-case, or the gate could pass by refusing everything. */
ok("...while the same word on gear IS answered",
   heatOf(g("GC Quartz Banger - 14mm")) === VAPOR, heatOf(g("GC Quartz Banger - 14mm")));

/* ------------------------------------------------------------------ */
group("TRAP B: A COIL IS A VAPE PART AND A PERC IS A BONG PART");
ok("a coil perc beaker is combusting", heatOf(g("Coil Perc Beaker Bong")) === COMBUSTION);
ok("...and a real vape coil is not vetoed by it",
   heatOf(g("5PCS Seahorse Coil IV Replacement - Quartz")) === VAPOR);
/* The veto must be narrow: it suppresses the coil signal, never the whole
   product, or a dab rig with a showerhead perc would fall out of vaporizing. */
ok("...and a dab rig keeps its verdict despite carrying a perc",
   heatOf(g('Lookah 9.4" Cool Mystic Wizard Glass Dab Rig with Showerhead Perc')) === VAPOR);

/* ------------------------------------------------------------------ */
group("TRAP C: A TORCH IS DELIBERATELY UNCLASSIFIED");
ok("a bare torch asserts nothing", heatOf(g("Blazer Big Buddy Butane Torch")) === "");
ok("...but a dab torch is explicit", heatOf(g("Lookah Dab Torch Kit")) === VAPOR);

/* ------------------------------------------------------------------ */
group("THE ORDER IS THE RULE");
/* Both of these carry a word from BOTH ladders. Under the opposite order they
   come back combusting, and nothing would error. */
ok("vaporizer beats bong", heatOf(g("Dry Herb Vaporizer Bong Attachment")) === VAPOR);
ok("dab rig beats glass", heatOf(g("14mm Glass Dab Rig")) === VAPOR);
/* The owner's own rule, stated in these terms: glass defaults to combusting
   unless it is explicitly a dab rig. */
ok("...and a bare bong still defaults to combusting",
   heatOf(g('Tataoo 16" Cool Skull Percolator Ice Beaker Glass Bong')) === COMBUSTION);
ok("...as does a water pipe", heatOf(g("LOOKAH Glass WPC4001 Water Pipe")) === COMBUSTION);

/* ------------------------------------------------------------------ */
group("THE STORE DEFAULT IS LAST, AND ALMOST EMPTY");
/* Hitoki's laser IGNITES the flower -- the owner named it specifically -- and
   neither "Saber Solo" nor "Trident" contains a word either ladder tests. */
ok("Hitoki's laser is combustion", heatOf(g("Saber Solo", { storeKey: "hitoki" })) === COMBUSTION);
ok("...and the default only fires when both ladders came back empty",
   heatOf(g("Hitoki Saber Recycler Kit Dab Rig", { storeKey: "hitoki" })) === VAPOR,
   "an explicit dab rig at Hitoki is still vaporizing");
ok("...and a store with no default gets no verdict from its key alone",
   heatOf(g("LOOKAH BEAR - Blue", { storeKey: "lookah" })) === "");
/* A blunt instrument kept blunt: if this map grows past a handful, the rule
   has stopped being about names and started being about shops. */
ok("the store-default map is still small", Object.keys(STORE_DEFAULT).length <= 3,
   Object.keys(STORE_DEFAULT).join(",") || "(empty)");

/* ------------------------------------------------------------------ */
group("THE THIRD BUCKET IS A REAL ANSWER");
for (const n of ["4 Piece Tank Weed Grinder with Kief Catcher",
                 "Rolling Tray - Large",
                 "Glass Storage Jar 4oz",
                 "Isopropyl Cleaning Solution 16oz"]) {
  ok(`heats nothing: ${n}`, heatOf(g(n)) === "", heatOf(g(n)) || "(none)");
}

/* ------------------------------------------------------------------ */
group("THE SHELVES READ THE CLASSIFIER, NOT A COPY OF IT");
const vap = shelfFor("vaporizers"), comb = shelfFor("combustion");
ok("/vaporizers is registered", !!vap);
ok("/combustion is registered", !!comb);
const bong = { ...g("Glass Beaker Bong"), group: "gear" };
bong.heat = heatOf(bong);
const rig = { ...g("Glass Dab Rig"), group: "gear" };
rig.heat = heatOf(rig);
const grinder = { ...g("4 Piece Grinder"), group: "gear" };
grinder.heat = heatOf(grinder);

ok("a bong lands on /combustion", comb.test(bong) === true);
ok("...and NOT on /vaporizers", vap.test(bong) === false);
ok("a dab rig lands on /vaporizers", vap.test(rig) === true);
ok("...and NOT on /combustion", comb.test(rig) === false);
/* The two heat shelves deliberately do not sum to the gear shelf. */
ok("a grinder is gear and on NEITHER heat shelf",
   grinder.group === "gear" && !vap.test(grinder) && !comb.test(grinder));
/* An equality test, not a negation: a product with no verdict must not fall
   onto a heat shelf by default, which is what `!== COMBUSTION` would do. */
ok("...and a product with no heat field at all reaches neither",
   !vap.test({ group: "gear" }) && !comb.test({ group: "gear" }));

/* ------------------------------------------------------------------ */
group("THE VERDICT WORD IS NOT THE SLUG");
/* Held apart on purpose so api/shelves.js must IMPORT the constants rather
   than restate a matching literal -- and so test-shelves.mjs's registry grep,
   which cannot tell a definition from a comparison, stays blunt. */
const slugs = SHELVES.map(s => s.slug);
ok("no verdict is spelled the same as a shelf slug",
   !slugs.includes(COMBUSTION) && !slugs.includes(VAPOR),
   `${COMBUSTION} / ${VAPOR} vs ${slugs.join(", ")}`);
const heatSrc = readFileSync("api/heat.js", "utf8");
for (const s of slugs) {
  ok(`api/heat.js never spells "${s}" in a quoted string`,
     !new RegExp('["\'`]' + s + '["\'`]').test(heatSrc));
}
/* And the link is an import, not a coincidence. */
ok("api/shelves.js imports the verdicts rather than restating them",
   /import\s*\{[^}]*\bCOMBUSTION\b[^}]*\}\s*from\s*['"]\.\/heat\.js['"]/.test(
     readFileSync("api/shelves.js", "utf8")));

/* ------------------------------------------------------------------ */
group("THE FEED STAMPS IT");
const prodSrc = readFileSync("api/products.js", "utf8");
ok("api/products.js imports heatOf", /import\s*\{[^}]*\bheatOf\b[^}]*\}\s*from\s*['"]\.\/heat\.js['"]/.test(prodSrc));
ok("...and stamps p.heat beside p.group", /p\.heat\s*=\s*heatOf\(p\)/.test(prodSrc));

console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);

/* WILL IT FIT, HOW BIG, WHAT IS IT, HOW LONG DOES IT LAST.

   A missing spec is a blank row nobody notices. A WRONG one is a shopper
   buying a 14mm banger for an 18mm rig because we said it fits -- and they
   find out after the parcel arrives. So the counter-cases here are weighted
   at least as heavily as the hits, and most of this file is refusals.

     node test-specs.mjs
*/
import { specsOf, jointOf, threadOf, heightOf, materialOf, capacityOf } from "./api/specs.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const eq = (label, got, want) => ok(label, got === want, JSON.stringify(got) + (got === want ? "" : " want " + JSON.stringify(want)));

/* A gear product, so the isGear gate lets it through. Category is what that
   gate reads, so it is the field that matters here. */
const gear = (name, description = "") => ({
  id: "g", name, description, category: "Bongs & Rigs", cannabinoid: "Accessory",
  storeKey: "grasscity", store: "Grasscity",
});

console.log("\n-- JOINT: the one that costs money to get wrong --");
eq("a stated joint", jointOf("14mm female joint beaker"), "14mm female");
eq("...male", jointOf("18mm male bowl"), "18mm male");
eq("the precise spellings are the same fittings", jointOf("18.8mm joint"), "18mm");
eq("...and 14.5", jointOf("14.5mm"), "14mm");
eq("an adapter states two", jointOf("14mm to 18mm adapter"), "14mm / 18mm");
console.log("  -- and what it refuses --");
eq("TRAP B: a banger's bucket is not a joint", jointOf("25mm quartz banger"), "");
eq("wall thickness is not a joint", jointOf("4mm thick glass"), "");
eq("a grinder's diameter is not a joint", jointOf("63mm 4-piece grinder"), "");
eq("a parts listing is refused, not truncated", jointOf("fits 10mm 14mm 18mm 19mm"), "");

console.log("\n-- THREAD --");
eq("stated as a thread", threadOf("510 thread battery"), "510 thread");
eq("...the other way round", threadOf("threading: 810"), "810 thread");
eq("...and compatibility counts", threadOf("510 compatible cartridge"), "510 thread");
console.log("  -- and what it refuses --");
eq("a bare number is a model, not a thread", threadOf("Lookah Seahorse 510"), "");
eq("...even next to prose", threadOf("510 of these were sold"), "");

console.log("\n-- HEIGHT: traps C and D --");
eq("a labelled height", heightOf('12" tall beaker'), '12"');
eq("...the word", heightOf("height: 8 inches"), '8"');
eq("...centimetres", heightOf("height 30cm"), "30 cm");
eq("a lone measurement is a height", heightOf('a 7" bubbler'), '7"');
console.log("  -- and what it refuses --");
eq("TRAP C: `in` is a preposition", heightOf("Made in USA"), "");
eq("...comes in black", heightOf("comes in black"), "");
eq("...6 in stock", heightOf("6 in stock"), "");
eq("TRAP D: a footprint is not a height", heightOf('5" x 3" x 3"'), "");
ok("...unless one of them is labelled", heightOf('5" tall x 3" wide') === '5"', heightOf('5" tall x 3" wide'));

console.log("\n-- MATERIAL: trap E, specific beats generic --");
eq("borosilicate is not just glass", materialOf("borosilicate glass tube"), "Borosilicate glass");
eq("quartz is not just glass", materialOf("quartz banger glass"), "Quartz");
eq("plain glass still answers", materialOf("glass spoon pipe"), "Glass");
eq("wood", materialOf("hand carved rosewood pipe"), "Wood");
eq("silicone", materialOf("silicone dab mat"), "Silicone");
eq("nothing stated, nothing claimed", materialOf("4-piece grinder"), "");

console.log("\n-- BATTERY --");
eq("a stated capacity", capacityOf("650mAh battery"), "650 mAh");
eq("...spaced", capacityOf("1500 mAh"), "1500 mAh");
console.log("  -- and what it refuses --");
eq("mg is not mAh", capacityOf("500mg cartridge"), "");
eq("an implausible cell is refused", capacityOf("99999mAh"), "");

console.log("\n-- TRAP A: flower is not hardware, and this repo has shipped that bug twice --");
const flower = (name) => ({ id: "f", name, description: "", category: "THCA Flower",
                            cannabinoid: "THCa", storeKey: "blacktie", store: "Black Tie CBD" });
for (const n of ["Zangbanger THCA Flower", "THCa Flower - Headbanger #7 (Smalls)",
                 "Pound Cake", "Special Sauce Rosin", "Glass Slipper 14mm Smalls"]) {
  const got = specsOf(flower(n));
  ok(`no specs for "${n}"`, Object.keys(got).length === 0, JSON.stringify(got));
}
/* And the same strings DO answer as gear, or the gate is doing nothing and the
   refusals above pass for the wrong reason. */
ok("...while the same words on real gear still parse",
   specsOf(gear("Glass Slipper 14mm banger")).joint === "14mm",
   JSON.stringify(specsOf(gear("Glass Slipper 14mm banger"))));

console.log("\n-- the whole object, on a product that states everything --");
const full = specsOf(gear(
  "Chill Steel Pipes 12\" Beaker",
  "<p>Heavy 18mm female joint, borosilicate glass, 12\" tall. Ships with a 510 thread adapter.</p>"));
console.log("  " + JSON.stringify(full));
ok("joint", full.joint === "18mm female", full.joint);
ok("material is the specific one", full.material === "Borosilicate glass", full.material);
ok("height", full.height === '12"', full.height);
ok("thread", full.thread === "510 thread", full.thread);
ok("HTML in the description does not leak into a value",
   !Object.values(full).some((v) => /[<>]/.test(v)), JSON.stringify(full));

console.log("\n-- and a product that states nothing gets nothing --");
const bare = specsOf(gear("Rolling Tray"));
ok("no keys at all, so a card can decide not to draw a heading",
   Object.keys(bare).length === 0, JSON.stringify(bare));

console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All spec checks passed."}`);
process.exit(fails.length ? 1 : 0);

/* The synthetics, and the lane that had no gate.
 *
 * Reported as "we are pulling in a bunch of stuff from Binoid manually right now
 * that should be excluded ... any delta eight, any of the synthetic cannabinoids
 * should be excluded. They always used to be. Now they're slipping through."
 *
 * TWO INDEPENDENT FAULTS, and the first one is why this looked like a classifier
 * bug and was not one.
 *
 * 1. THE CAPTURE LANE RAN NO GATE. normShopify() and normWoo() each apply four
 *    -- isJunk, notCannabis, Apparel/Merch, excluded(). captureToProduct() applied
 *    none, and never called classify() at all, so a captured row carried NO
 *    cannabinoid field: outside the exclusion AND outside the engine's own
 *    cannabinoid filter. Measured live: seven "THCa THCp Super Blend Disposable"
 *    rows on the shelf, category "", in the same request where the SCRAPE was
 *    correctly refusing 128 Delta-8, 39 Delta-9 and 6 THCP products from Binoid.
 *
 * 2. THE VOCABULARY HAD HOLES, and one of them was visible in the source the
 *    whole time: 'Delta-11' was in EXCLUDE with no branch of classify() able to
 *    produce it. An exclusion that reads as enforced and enforces nothing. THC-O,
 *    HHC-O, THCjd, HXY and the -P forms (Delta Extrax writes THCP as "D9P", which
 *    \bd9\b cannot match) had no branch either.
 *
 * The assertion that outlives both is the symmetric one: every token in EXCLUDE
 * must be one classify() can EMIT, and every synthetic classify() emits must be
 * in EXCLUDE. Two claims, both of which had failed, neither of which errors.
 *
 *   node test-synthetics.mjs
 */
import { classify, excluded, captureVerdict, EXCLUDE, SYNTHETIC_WORD } from "./api/products.js";
import { readFileSync } from "node:fs";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);
const cann = name => classify(String(name).toLowerCase(), String(name).toLowerCase(), name).cannabinoid;

console.log("\nThe synthetics, and the lane that had no gate\n");

group("THE TWO LISTS AGREE, IN BOTH DIRECTIONS");
/* A vocabulary of names chosen to make every branch fire. If a token in EXCLUDE
   has no name here that produces it, that token is decoration -- which is exactly
   what Delta-11 was. */
const PRODUCERS = {
  "Δ8": "Delta 8 THC Gummies", "Δ9": "Delta 9 Gummies", "Δ10": "Delta 10 Vape",
  "Δ11": "Delta 11 Gummies", "Δ6": "Delta 6a10a Cartridge",
  HHC: "HHC Vape Cartridge", HHCO: "HHC-O Disposable", THCO: "THC-O Acetate Vape",
  THCP: "THCP Gummies", THCV: "THCV Tincture", THCB: "THC-B Cartridge",
  THCH: "THC-H Disposable", THCM: "THC-M Blend", THCJD: "THCjd Vape", HXY: "HXY-11-THC Gummy",
  PHC: "PHC Gummies",
};
const unproducible = EXCLUDE.filter(t => !PRODUCERS[t] || cann(PRODUCERS[t]) !== t);
ok("every token in EXCLUDE is one classify() can emit", unproducible.length === 0,
   unproducible.map(t => t + " <- " + (PRODUCERS[t] ? '"' + PRODUCERS[t] + '" gave ' + cann(PRODUCERS[t]) : "no example")).join("; "));
const unlisted = Object.keys(PRODUCERS).filter(t => cann(PRODUCERS[t]) === t && !excluded(t));
ok("...and every synthetic classify() emits is in EXCLUDE", unlisted.length === 0, unlisted.join(", "));
ok("EXCLUDE grew rather than being rewritten",
   ["Δ8", "Δ9", "Δ10", "HHC", "THCP", "THCV", "THCB", "THCH", "THCM", "PHC"].every(excluded),
   EXCLUDE.length + " tokens");

group("THE TWO PRODUCTS THAT WERE LIVE ON THE SHELF");
/* Read out of the production feed with ?debug&slim&find=blend on 20 Aug 2026.
   Both were publishing; neither should have been. */
ok('"THCa THCp Super Blend Disposable: Sunset Dream" is THCP, not THCa',
   cann("THCa THCp Super Blend Disposable: Sunset Dream") === "THCP",
   cann("THCa THCp Super Blend Disposable: Sunset Dream"));
ok('"THCA + D9P 2G Cartridge Duo | Adios Blend - Extrax" is THCP, not THCa',
   cann("THCA + D9P 2G Cartridge Duo | Adios Blend - Extrax") === "THCP",
   cann("THCA + D9P 2G Cartridge Duo | Adios Blend - Extrax"));
ok("...and both are refused", excluded(cann("THCa THCp Super Blend Disposable: Sunset Dream")) &&
   excluded(cann("THCA + D9P 2G Cartridge Duo | Adios Blend - Extrax")));

group("A BLEND CONTAINING A SYNTHETIC IS A SYNTHETIC PRODUCT");
/* The ladder returns the FIRST match and every synthetic sits above thca, so the
   order is the rule. If somebody reorders it, a blend starts publishing as flower. */
for (const [n, want] of [
  ["THCa THCp Super Blend", "THCP"],
  ["THCA + Delta 8 Live Resin Gummies", "Δ8"],
  ["Delta 9 + THCA Cartridge", "Δ9"],
  ["HHC + THCA Disposable", "HHC"],
  ["CBD + D9P Tincture", "THCP"],
]) ok('"' + n + '" -> ' + want, cann(n) === want, cann(n));

group("AND THE COUNTER-CASES, WHICH COST MORE TO GET WRONG");
/* A false positive here deletes live inventory. Every one of these is a real
   listing shape from this catalogue. */
for (const [n, want] of [
  ["Blue Dream THCA Flower", "THCa"],
  ["Cheap Indoor THCA Flower Ounce", "THCa"],
  ["Binoid Good Night CBD Oil - Sleep Blend", "CBD"],
  ["Full Spectrum CBD Oil 1000mg", "CBD"],
  ["CBD Tincture Oil", "CBD"],                 // "thc oil" trap, one letter away from THC-O
  ["THC Oil Free Sample", "THCa"],             // ...and the trap itself: NOT THC-O
  ["Delta Extrax Live Rosin THCA Flower", "THCa"],  // brand called Delta, no digit
  ["Pound Cake THCA Smalls", "THCa"],
  ["Gelato 41 THCA Pre-Roll", "THCa"],
  ["CBG Flower 1oz", "CBD"],
]) ok('"' + n + '" stays ' + want, cann(n) === want, cann(n));
ok("...so none of them is refused", ["Blue Dream THCA Flower", "THC Oil Free Sample",
  "Delta Extrax Live Rosin THCA Flower", "Pound Cake THCA Smalls", "CBD Tincture Oil"]
  .every(n => !excluded(cann(n))));

group("SYNTHETIC_WORD ANSWERS 'WHETHER', NOT 'WHICH'");
/* It is the title-first CBD override's test. That override used to carry its own
   hand-copied half of the vocabulary and had fallen six tokens behind, so the rule
   written to protect CBD listings could relabel a "CBD + D9P" product as CBD. */
for (const n of ["delta 8 gummies", "d9p cartridge", "thc-o vape", "hhc-o disposable",
                 "thcjd blend", "hxy-11-thc", "delta 11 gummy", "6a10a cart"])
  ok('SYNTHETIC_WORD sees "' + n + '"', SYNTHETIC_WORD.test(n));
for (const n of ["blue dream thca flower", "cbd tincture oil", "delta extrax thca flower",
                 "pound cake thca smalls", "cbg flower 1oz"])
  ok('...and does not see "' + n + '"', !SYNTHETIC_WORD.test(n), n);
ok("a CBD product whose name also names a synthetic is NOT relabelled CBD",
   cann("CBD + D9P Tincture") !== "CBD", cann("CBD + D9P Tincture"));

group("THE CAPTURE LANE NOW RUNS THE SAME FOUR GATES");
const v = c => captureVerdict(c);
ok("a captured synthetic is refused, and the reason names it",
   v({ name: "THCa THCp Super Blend Disposable: Sunset Dream" }).reason === "excluded:THCP",
   v({ name: "THCa THCp Super Blend Disposable: Sunset Dream" }).reason);
ok("...as is one the SHOP filed under a synthetic category",
   v({ name: "Sunset Dream Disposable", category: "Delta 8" }).reason === "excluded:Δ8",
   v({ name: "Sunset Dream Disposable", category: "Delta 8" }).reason);

/* HARDWARE CARRIES NO CANNABINOID, AND THIS GATE DID NOT KNOW IT.
   captureVerdict() ran classify() bare, so a captured torch came back with
   classify()'s default -- "THCA Flower", cannabinoid "THCa" -- and would have
   entered the PER-GRAM RANKING, which is exactly what `accessory:true` exists to
   prevent. It could not be reached until the collector could send a gear shop's
   capture to the market this feed reads (Hitoki, YLLVAPE), and it would have
   shipped the moment that worked. */
const gearStore = { key: "hitoki", name: "Hitoki", accessory: true };
const torch = { name: "Hitoki Trident Laser Lighter" };
ok("a captured torch from a gear shop is Accessory, not flower",
   captureVerdict(torch, gearStore).cl.cannabinoid === "Accessory",
   JSON.stringify(captureVerdict(torch, gearStore).cl));
ok("...and it is admitted rather than refused", captureVerdict(torch, gearStore).ok === true);
/* THE COUNTER-CASE, so this cannot be satisfied by blanketing everything as
   Accessory: a consumable shop's flower is still flower. */
ok("...while the same gate leaves a consumable shop's flower alone",
   captureVerdict({ name: "Blue Dream THCA Flower" }, { key: "hipuffy", name: "Puffy THCa" })
     .cl.cannabinoid === "THCa",
   JSON.stringify(captureVerdict({ name: "Blue Dream THCA Flower" }, { key: "hipuffy" }).cl));
/* AND THE EXCLUSIONS STILL RUN ON A GEAR SHOP -- the accessory override replaces
   the classification, so a delta-8 disposable sold by a headshop must not walk
   through the synthetics gate wearing an Accessory label. */
ok("...and a synthetic is still refused even at a gear shop",
   captureVerdict({ name: "Delta 8 Disposable 2g" }, gearStore).reason === "excluded:Δ8",
   String(captureVerdict({ name: "Delta 8 Disposable 2g" }, gearStore).reason));
ok("junk is refused", v({ name: "Package Protection" }).reason === "junk");
ok("apparel is refused", v({ name: "Blue Dream THCA Flower T-Shirt" }).reason === "apparel",
   v({ name: "Blue Dream THCA Flower T-Shirt" }).reason);
ok("a non-cannabis active is refused",
   v({ name: "Amanita Muscaria Gummies" }).reason === "notCannabis");
ok("a nameless row is refused rather than published blank",
   v({ name: "  " }).reason === "noName");

group("...AND STILL ADMITS WHAT THE LANE EXISTS FOR");
const good = v({ name: "Blue Dream THCA Flower", category: "Flower" });
ok("real flower passes", good.ok === true, JSON.stringify(good.reason || "ok"));
ok("...carrying a cannabinoid, which a captured row never had before",
   good.cl && good.cl.cannabinoid === "THCa", good.cl && good.cl.cannabinoid);
ok("...and a category, so it is filterable on the shelf",
   good.cl && good.cl.category === "THCA Flower", good.cl && good.cl.category);
const cbd = v({ name: "Binoid Good Night CBD Oil - Sleep Blend" });
ok("a real CBD capture passes too", cbd.ok === true && cbd.cl.cannabinoid === "CBD",
   cbd.cl && cbd.cl.cannabinoid);

group("AND THE GATE IS ACTUALLY CALLED");
/* "The gate exists" and "the gate is called" are two different claims, and this
   whole report is what the second one failing looks like: captureVerdict()'s four
   checks all existed, in normShopify() and normWoo(), and the capture loop simply
   did not reach them. The merge sits inside the request handler and needs a live
   scrape to run, so the wiring is read out of the shipped source -- the same
   approach test-capture-merge.mjs takes to the merge rules themselves.
   This proves the ORDER of the calls, not their behaviour; the behaviour is every
   assertion above. Window the code and assert the window was found, or an empty
   slice passes vacuously (the /library lesson, four times over now). */
const src = readFileSync("api/products.js", "utf8");
const loop = src.slice(src.indexOf("for (const c of rows) {"),
                       src.indexOf("refreshed++;", src.indexOf("for (const c of rows) {")));
ok("the capture loop was located, so the checks below are not vacuous",
   loop.length > 400 && /captureToProduct\(/.test(loop), loop.length + " chars");
const iGate = loop.indexOf("captureVerdict("), iBuild = loop.indexOf("captureToProduct(");
ok("it asks captureVerdict() at all", iGate >= 0);
ok("...before it builds the product, not after", iGate >= 0 && iGate < iBuild,
   "verdict@" + iGate + " build@" + iBuild);
ok("...and a refusal is dropped under a lane-named reason rather than published",
   /drop\(store,\s*["']capture:["']\s*\+\s*v\.reason\)/.test(loop) && /continue;/.test(loop));
ok("...and the verdict's classification is handed to the builder",
   /captureToProduct\(store,\s*c,\s*v\.cl\)/.test(loop));
/* The scrape paths must keep theirs too -- a fix that moved the gate rather than
   adding one would pass everything above. */
for (const fn of ["normShopify", "normWoo"]) {
  const w = src.slice(src.indexOf("function " + fn + "("), src.indexOf("function " + fn + "(") + 1400);
  ok(fn + "() still runs the exclusion itself", /excluded\(cl\.cannabinoid\)/.test(w));
}

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

/* CARTS, DISPOSABLES AND CONCENTRATES ARE THREE PURCHASES, NOT ONE.
 *
 * A cart needs a battery you already own. A disposable is ready the moment it
 * leaves the counter. A concentrate needs a rig. A shopper is choosing between
 * those three, and "Vaporizers" answers a question nobody asked.
 *
 * ORDER IS THE WHOLE RULE, and getting it backwards does not fail -- it lies,
 * the same way reading "1/8 oz" before the fraction rule published a $10 eighth
 * at four cents a gram. Every case below is a real product name off the live
 * Coldwater feed, chosen because it carries MORE THAN ONE of the words: those
 * are the only ones the ordering decides, and the only ones worth pinning.
 *
 * No browser, no network. */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

const src = readFileSync("api/coldwater.js", "utf8");
const seg = src.slice(src.indexOf("const CATEGORY_HINTS = ["),
                      src.indexOf("/* THE THINGS THAT ARE NOT SOLD BY WEIGHT"));
const HINTS = new Function(seg + "; return CATEGORY_HINTS;")();
const cat = n => { for (const [re, l] of HINTS) if (re.test(n)) return l; return ""; };

console.log("\ncarts vs disposables vs concentrates\n");

/* THE AMBIGUOUS ONES, which is the entire point. Each of these names two of the
   three categories, so each is decided by the order alone. */
const contested = [
  ["Jeeter Double Rainbow Disposable Cart 2g", "Disposables",
   "says both words; the one that decides what you do with it is disposable"],
  ["MKX Oil Co. Zaja Blasted Disposable Vape (S)", "Disposables",
   "disposable beats the bare word vape"],
  ["Flow Blue Milk Live Resin Cart 1g", "Carts",
   "names the extract it is filled with and still needs a battery"],
  ["Mitten Extracts Gushers Max Pro Disposable Cart 3g", "Disposables", ""],
  ["Anarchy AIO 1g", "Disposables", "all-in-one is a disposable by another name"],
  ["STIIIZY Blue Dream Pod 1g", "Carts", "a pod is a cart with a proprietary fitting"],
];
for (const [name, want, why] of contested) {
  const got = cat(name);
  ok(`${want.padEnd(12)} ${name}`, got === want, got === want ? why : `got ${got}`);
}

/* THE UNAMBIGUOUS ONES, which must not have moved. Splitting a category is the
   easiest way to break the two either side of it. */
const settled = [
  ["Wojo Co Oishii Live Rosin 1g", "Concentrates"],
  ["Apex Solventless Death of a Skrawberry Rosin", "Concentrates"],
  ["Church Cannabis Company Church | Battery", "Accessories"],
  ["LuvBuds Doppleganger: Dual Battery 510 Thread", "Accessories"],
  ["Pro Gro Moonmelon Preroll 1g", "Pre-Rolls"],
  ["Soap | Pro Gro | Deli Flower", "Flower"],
  ["Wyld Sour Apple Gummies 10x20mg", "Edibles"],
  ["RISE | RSO Cream | 1oz | Topical", "Topicals"],
  ["Sapura 5 Panel Black Hat", "Apparel"],
];
for (const [name, want] of settled) {
  const got = cat(name);
  ok(`${want.padEnd(12)} ${name}`, got === want, got === want ? "" : `got ${got}`);
}

/* A BATTERY IS AN ACCESSORY, NOT A CART, and it is the trap in this direction:
   the accessory rule sits BELOW the cart rule, so "510" in a battery's name
   would take it if the cart rule were any looser. */
ok("a 510 battery is gear, not a cart",
   cat("LuvBuds Doppleganger: Dual Battery 510 Thread") === "Accessories");

console.log("\ndrinks are their own aisle\n");
const drinks = [
  ["Cann Grapefruit Rose Social Tonic Seltzer", "Drinks"],
  ["Keef Classic Root Beer Soda 10mg", "Drinks"],
  ["Happy Hemp Lemonade 100mg", "Drinks"],
];
for (const [name, want] of drinks) ok(`${want.padEnd(12)} ${name}`, cat(name) === want, cat(name));
/* Dosed rather than drunk: a tincture belongs with the edibles it behaves like. */
ok("a tincture stays with edibles", cat("Mary's Medicinals Tincture 500mg") === "Edibles",
   cat("Mary's Medicinals Tincture 500mg"));
ok("...and so does a dropper", cat("Vlasic CBD Drops 500mg") === "Edibles",
   cat("Vlasic CBD Drops 500mg"));

/* The engine has never heard of these three, so they must be declared or every
   product carrying one is counted as an unknown label by the exit assert. */
console.log("\nthe new labels are declared, not smuggled\n");
for (const c of ["Carts", "Disposables", "Drinks"]) {
  ok(`${c} is in ENGINE_CATEGORIES`,
     new RegExp('"' + c + '"').test(src.slice(src.indexOf("const ENGINE_CATEGORIES"),
                                               src.indexOf("const TO_ENGINE"))));
}

console.log(fails.length ? `\n${fails.length} FAILED:\n - ` + fails.join("\n - ") + "\n" : "\nAll assertions passed.\n");
process.exit(fails.length ? 1 : 0);

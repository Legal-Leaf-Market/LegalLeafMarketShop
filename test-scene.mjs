/* test-scene.mjs — what a curated shop carries, and what it turns away.
 *
 * api/scene.js is an ALLOWLIST, which fails in the opposite direction from
 * everything else in this repo. The synthetics gate fails by admitting a
 * Δ8 product; this fails by REFUSING something good, silently, and the shop
 * just quietly has a hole in it. So both directions are pinned, and the
 * refusals are pinned as hard as the admissions.
 *
 *   1. THE DEFAULT IS REFUSE. A big catalogue's fridges, office chairs and
 *      kitchen scales must not need a rule each -- if they do, the design is
 *      a blocklist wearing an allowlist's clothes.
 *   2. THE ADMIT RULES ARE SPECIFIC. `gaming chair` in, `office chair` out;
 *      `gaming laptop` in, business ultrabook out. A bare noun on any rung
 *      is the failure mode, and it is asserted directly.
 *   3. VETOES ARE COLLISIONS ONLY, and stay a backstop rather than the
 *      mechanism.
 *   4. EVERY REFUSAL CARRIES A REASON, because an allowlist you cannot audit
 *      slowly strangles the shop.
 *
 *     node test-scene.mjs
 */
import { SCENE_CATS, ADMIT, VETO, sceneVerdict, sceneCat, inScene } from "./api/scene.js";
import { readFileSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const cat = name => sceneCat({ name });

console.log("\nThe scene classifier\n");

/* ------------------------------------------------------------------ */
group("WHAT THE SHOP CARRIES");
const ADMITS = [
  ["Battlestation", ["Razer BlackWidow V4 Mechanical Keyboard", "Artisan Keycap - Sakura Resin",
    "Glorious XL Extended Mousepad", "Secretlab TITAN Evo Gaming Chair", "Govee RGB Light Strip 5m"]],
  ["Displays",      ["LG 27GP850 27in 165Hz Gaming Monitor", "The Portable Monitor 15.6in 1080p"]],
  ["Audio",         ["SteelSeries Arctis Nova Pro Headset", "Moondrop Aria In-Ear Monitors",
    "Fosi Audio BT20A Bluetooth Amplifier"]],
  ["Power & cables",["Anker 737 GaN Charger 120W", "UGREEN USB-C Docking Station 9-in-1"]],
  ["Play",          ["8BitDo Ultimate Bluetooth Controller", "Analogue Pocket Retro Handheld",
    "Sanwa Arcade Stick Buttons 30mm", "Nintendo Switch OLED Dock"]],
  ["Capture",       ["Elgato Stream Deck MK.2", "Elgato Cam Link 4K Capture Card", "Shure SM7B Streaming Microphone"]],
  ["Build",         ["ANYCUBIC Kobra 2 3D Printer", "Noctua NH-D15 CPU Cooler",
    "Samsung 990 Pro 2TB NVMe SSD", "Lian Li O11 Dynamic PC Case"]],
  ["Collect",       ["Good Smile Nendoroid Hatsune Miku", "Pokemon Scarlet Booster Box",
    "Chessex Dice Set - 7 Polyhedral", "Studio Ghibli Wall Scroll Poster"]],
  ["Wear",          ["Genshin Impact Cosplay Wig", "Anime Enamel Pin Set"]],
];
for (const [want, names] of ADMITS) {
  for (const n of names) ok(`${want}: ${n.slice(0, 42)}`, cat(n) === want, cat(n) || "(refused)");
}
ok("every department is reachable",
   new Set(ADMITS.map(a => a[0])).size === SCENE_CATS.length,
   ADMITS.length + " of " + SCENE_CATS.length);

/* ------------------------------------------------------------------ */
group("THE DEFAULT IS REFUSE — no rule needed for any of these");
/* NOT ONE of these is named in VETO. They are refused because nobody wrote a
   word for them, which is the whole design: a blocklist against "everything a
   big catalogue sells that is not gaming" leaks by construction. */
for (const n of ["Samsung 28 cu ft French Door Refrigerator", "Ninja Air Fryer 5.5L",
                 "CeraVe Moisturizer 16oz", "Kitchen Digital Scale 5kg",
                 "Garden Hose Reel 50ft", "Stanley Tape Measure 25ft",
                 "Yoga Mat 6mm Non-Slip", "Cordless Drill 20V Lithium",
                 "Reading Glasses +1.5"]) {
  const v = sceneVerdict({ name: n });
  ok(`refused with no rule of its own: ${n.slice(0, 40)}`,
     !v.ok && v.reason === "notScene", v.reason);
}

/* ------------------------------------------------------------------ */
group("THE ADMIT RULES ARE SPECIFIC, NOT BARE NOUNS");
/* Each pair is one word away from each other. If any rung is ever loosened to
   the bare noun, the right-hand side starts being admitted. */
/* THE RIGHT-HAND SIDE MUST NOT BE COVERED BY A VETO, or this block proves
   nothing about the admit rung's specificity. The first draft used "Office
   Chair", "Baby Monitor" and "Car Audio Amplifier" -- all three refused a step
   EARLIER by a veto, so loosening Battlestation's rung to a bare \bchair\b
   left the suite fully green. Verified against exactly that edit. These are
   collisions no veto touches, so only the rung's own specificity can refuse
   them. */
const PAIRS = [
  ["Secretlab TITAN Gaming Chair", "Dining Chair Solid Oak Set of 4"],
  ["ASUS ROG Strix Gaming Laptop", "Dell Latitude Business Laptop"],
  ["LG 27in 165Hz Gaming Monitor", "Water Quality Monitor Test Kit"],
  ["Fosi Audio Bluetooth Amplifier", "Fender Guitar Amplifier 40W"],
  ["Elgato Stream Deck MK.2", "Deck Stain Waterproof 5L"],
  ["Anker 737 GaN Charger 120W", "AA Battery Charger 8-Bay"],
];
/* ...and that premise is asserted, not assumed. */
for (const [, bad] of PAIRS) {
  ok(`  premise: "${bad.slice(0, 34)}" is not covered by a veto`,
     !/^veto:/.test(sceneVerdict({ name: bad }).reason), sceneVerdict({ name: bad }).reason);
}
for (const [good, bad] of PAIRS) {
  ok(`in:  ${good.slice(0, 38)}`, inScene({ name: good }), cat(good) || "(refused)");
  ok(`out: ${bad.slice(0, 38)}`, !inScene({ name: bad }), sceneVerdict({ name: bad }).reason);
}

/* ------------------------------------------------------------------ */
group("VETOES ARE A BACKSTOP, NOT THE MECHANISM");
for (const [n, why] of [
  ["Omron Blood Pressure Monitor", "veto:medical"],
  ["Pioneer Car Audio Amplifier 1200W", "veto:automotive"],
  ["HP LaserJet Printer Toner Cartridge", "veto:office"],
  ["Dog Chew Toy Rope", "veto:pet"],
  ["Bridal Lace Wedding Dress", "veto:apparel-generic"],
  ["$50 Amazon Gift Card", "veto:not-a-product"],
]) {
  ok(`${why}: ${n.slice(0, 36)}`, sceneVerdict({ name: n }).reason === why, sceneVerdict({ name: n }).reason);
}
/* THE RESTRICTED VETO IS NOT TIDINESS. A scene shop that accidentally lists a
   vape has the same publisher-approval problem that keeps Legal-Leaf Market
   off Impact's gaming programmes in the first place -- which is the entire
   reason that site is separate from this one. */
for (const n of ["Delta 8 Gummies 25mg", "Glass Beaker Bong 18 inch", "THCA Flower Ounce", "Vape Juice 60ml"]) {
  ok(`restricted: ${n.slice(0, 36)}`, sceneVerdict({ name: n }).reason === "veto:restricted",
     sceneVerdict({ name: n }).reason);
}
ok("the veto list stays short enough to be a backstop", VETO.length <= 12, VETO.length + " entries");
/* EVERY VETO MUST BE LOAD BEARING, proven rather than assumed.
 *
 * The first draft of api/scene.js had ten vetoes and TWO OF THEM GUARDED
 * NOTHING -- `appliance` and `beauty` were written against fridges and
 * moisturiser, which the allowlist already refuses by default because no admit
 * rung comes near them. Dead code that looks like a guard is worse than no
 * code: the next person reads the list, believes refrigerators are handled,
 * and loosens a rung.
 *
 * So each survivor carries a probe that the ADMIT rungs WOULD wrongly admit
 * without it. If a veto is ever added with no leaking probe, this goes red and
 * says the veto guards nothing. Note the probes are deliberately awkward
 * strings -- "Office Chair with RGB Light", "Wedding Hoodie" -- because an
 * easy probe is how the first draft convinced itself.
 */
const LEAKS = {
  "medical":         "Hearing Aid Headphones",
  "automotive":      "Motorcycle Bluetooth Headset",
  "office":          "Office Chair with RGB Light",
  "industrial":      "Industrial CNC Machine Controller",
  "apparel-generic": "Wedding Hoodie Custom",
  "pet":             "Aquarium RGB Light Strip",
  "restricted":      "THC Poster Print",
  "not-a-product":   "Mechanical Keyboard Masterclass Course",
};
const admitsOnly = h => { for (const [c, re] of ADMIT) if (re.test(h)) return c; return ""; };
for (const [name] of VETO) {
  const probe = LEAKS[name];
  ok(`veto "${name}" has a probe`, !!probe, probe || "NONE - is this veto dead?");
  if (!probe) continue;
  ok(`  ...that the allowlist WOULD admit without it`, !!admitsOnly(probe),
     admitsOnly(probe) || "nothing - this veto guards nothing");
  ok(`  ...and that the veto actually catches`, sceneVerdict({ name: probe }).reason === "veto:" + name,
     sceneVerdict({ name: probe }).reason);
}


/* ------------------------------------------------------------------ */
group("EVERY REFUSAL CARRIES A REASON");
ok("a nameless row says so", sceneVerdict({}).reason === "noName");
ok("an unknown product says notScene", sceneVerdict({ name: "Widget 3000" }).reason === "notScene");
ok("a vetoed product names its veto", /^veto:/.test(sceneVerdict({ name: "Baby Monitor" }).reason));
ok("an admitted product carries no reason", sceneVerdict({ name: "Mechanical Keyboard" }).reason === "");
/* The category and the tags join the name, so a shop's own taxonomy helps. */
ok("the shop's own category is read too",
   sceneCat({ name: "BX-9 Pro", category: "Mechanical Keyboards" }) === "Battlestation");

/* ------------------------------------------------------------------ */
group("IT IS AN ADMISSION GATE, NOT A SHELF AND NOT AN OVERLAY");
const src = readFileSync("api/scene.js", "utf8");
/* Same registry guard test-shelves.mjs runs: nothing outside api/shelves.js
   should spell a shelf slug, and this file is new enough to be the one that
   reintroduces the problem. */
const { SHELVES } = await import("./api/shelves.js");
for (const s of SHELVES.map(x => x.slug)) {
  ok(`never spells the shelf slug "${s}"`, !new RegExp('["\'`]' + s + '["\'`]').test(src));
}
ok("it exports the departments so a fork's registry need not restate them",
   Array.isArray(SCENE_CATS) && SCENE_CATS.length >= 8, SCENE_CATS.length + " departments");
ok("...and every department is one an admit rung can actually emit",
   ADMIT.every(([c]) => SCENE_CATS.includes(c)),
   ADMIT.map(a => a[0]).filter(c => !SCENE_CATS.includes(c)).join(",") || "all present");
ok("...and every declared department has a rung that emits it",
   SCENE_CATS.every(c => ADMIT.some(([a]) => a === c)),
   SCENE_CATS.filter(c => !ADMIT.some(([a]) => a === c)).join(",") || "all reachable");

console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);

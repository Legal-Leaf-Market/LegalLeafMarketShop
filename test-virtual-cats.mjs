/* test-virtual-cats.mjs — the four category chips that could never have a photo,
 * and the one shop that could never have a logo.
 *
 * FOUR CHIPS SHOWED A DRAWN MARK WHERE THE REST SHOWED PHOTOGRAPHS: "vape,
 * drink, trim/shake, and cbd/cbg all don't have pics, they just have emojis in
 * the faceted circles". Not a thin shelf and not a scoring miss -- a KEY THAT
 * CANNOT OCCUR.
 *
 * Those four are not values of p.category. They are SUB-TAGS: cross-cutting
 * labels the engine overlays on the base category and then pushes into
 * #fCategory as though they were categories. So a shake jar's data-cat is
 * "THCA Flower", the feed states no such category either, and rails.js scores a
 * pool keyed on the feed's category with the grid's data-cat as its fallback.
 * Neither source can produce "Trim/Shake". Nothing errors; the chips just never
 * get a candidate, which looks exactly like a category with no photographs.
 *
 * AND GREEK GLASS HAD NO LOGO for the mirror-image reason: the store strip keys
 * a favicon on the domain the feed carries, and Greek Glass is deliberately kept
 * OUT of /api/products (CLAUDE.md section 7). A shop that is not in the feed has
 * no domain in the feed. Its domain is on the page regardless -- the engine's
 * baked seed carries it -- so feed-meta.js reads that as a gap-fill.
 *
 * THE TESTS ARE THE ENGINE'S OWN AND ARE TWINNED ON PURPOSE. subTagOn() is
 * inside the blob and cannot be imported, the same way _applyOv cannot be
 * imported by public/js/overrides.js. So the first group here reads the three
 * literals back out of public/engine.js -- which is byte-identical to the
 * decoded blob -- and fails if either copy moves. A silent drift would mean the
 * chip advertised a different shelf from the filter behind it.
 *
 *   node test-virtual-cats.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

const engine = readFileSync("public/engine.js", "utf8");
const meta   = readFileSync("public/js/feed-meta.js", "utf8");

console.log("\nThe virtual categories, and the shop the feed cannot describe\n");

group("THE TWINNED TESTS MATCH THE ENGINE'S OWN, LITERAL FOR LITERAL");
/* A regex that drifts here does not fail: the chip simply describes a different
   set from the facet it faces, and both render perfectly. */
for (const name of ["VAPE_RE", "DRINK_SUB_RE"]) {
  const re = new RegExp("var " + name + " = (/.*?/i);");
  const a = (engine.match(re) || [])[1];
  const b = (meta.match(re) || [])[1];
  ok(name + " is the engine's own", !!a && a === b, a ? a.slice(0, 46) + "..." : "not found in engine.js");
}
/* The trim test is short enough to inline in the engine's SUBTAG_DEFS rather
   than being hoisted to a named constant, so it is matched where it lives. */
ok("the trim test is the engine's own",
   /trim:\s*\{[^}]*\/trim\|shake\/i\.test/.test(engine) && /TRIM_RE = \/trim\|shake\/i/.test(meta));
ok("...and the CBD test is the engine's own",
   /cbd:\s*\{[^}]*cannabinoid\|\|""\)===\"CBD\"/.test(engine.replace(/\s+/g, "")) ||
   /cbd:\s*\{[\s\S]{0,120}cannabinoid[\s\S]{0,40}"CBD"/.test(engine),
   "engine keys CBD on cannabinoid");
/* AN OVERRIDE WINS OVER THE REGEX, exactly as subTagOn does it, or an admin
   decision would reach the grid and not the chip. */
ok("an admin override wins over the regex, as subTagOn does",
   /hasOwnProperty\.call\(ov, key\)/.test(meta) && /hasOwnProperty\.call\(ov, key\)/.test(engine));

group("THE FOUR ARE KEYED BY THE OPTION VALUE, NOT THE PRINTED LABEL");
/* The CBD facet's option value is "CBD" while it PRINTS "CBD/CBG" (canLabel), and
   the chip is a face for the option. Keying on the label would miss every time
   and look exactly like the bug being fixed. */
ok("the CBD pool is keyed \"CBD\", which is what #fCategory carries",
   /\["cbd", "CBD"\]/.test(meta) && /canLabel/.test(engine));
for (const k of ['"Vape"', '"Drinks"', '"Trim/Shake"'])
  ok("...and " + k + " is a pool key", meta.includes('["' + (k === '"Vape"' ? "vape" : k === '"Drinks"' ? "drink" : "trim") + '", ' + k + "]"));

group("AND THE POOLS COME OUT OF A REAL FEED");
/* Executes the shipped file rather than restating it: the tap is installed over
   a stubbed fetch, the fixture is served through it, and LL_META is read back. */
const FEED = { products: [
  { id: "p1", name: "Blue Dream Flower 3.5g", store: "Puffy THCa", domain: "hipuffy.com",
    category: "THCA Flower", cannabinoid: "THCa", image: "/a.jpg" },
  { id: "p2", name: "Sour Diesel Shake Ounce", store: "Black Tie CBD", domain: "blacktie.com",
    category: "THCA Flower", cannabinoid: "THCa", image: "/b.jpg" },
  { id: "p3", name: "Live Resin Cart 1g", store: "Puffy THCa", domain: "hipuffy.com",
    category: "Concentrate", cannabinoid: "THCa", image: "/c.jpg" },
  { id: "p4", name: "Rosin Seltzer 12oz", store: "Nothing But Canna", domain: "nbc.com",
    category: "Edibles", cannabinoid: "THCa", image: "/d.jpg" },
  { id: "p5", name: "Calm Tincture 30ml", store: "Bloomz Hemp", domain: "bloomz.com",
    category: "Topicals", cannabinoid: "CBD", image: "/e.jpg" },
  /* The override case: named like a whole bud, flagged as an offcut by the feed.
     The regex alone would miss it, which is the whole point of reading subTags
     first. */
  { id: "p6", name: "Budget Buds Ounce", store: "CBD Hemp Direct", domain: "cbdhemp.direct",
    category: "THCA Flower", cannabinoid: "THCa", image: "/f.jpg", subTags: { trim: true } },
  /* And the inverse: "Grape Milkshake" is a whole-bud strain. The feed says so,
     and that must overrule the name test rather than the other way round. */
  { id: "p7", name: "Grape Milkshake 3.5g", store: "Puffy THCa", domain: "hipuffy.com",
    category: "THCA Flower", cannabinoid: "THCa", image: "/g.jpg", subTags: { trim: false } }
] };

const dispatched = [];
globalThis.window = {
  LL_GREEKGLASS_SEED: [
    /* The engine's baked Greek Glass seed, in the shape it really has. */
    { id: "gg1", name: "GG Lava Lamp Rig", store: "Greek Glass", storeKey: "greekglass",
      domain: "www.greekglassshop.com", cannabinoid: "Accessory", category: "Rigs" },
    /* A row for a shop the FEED also carries, with a DIFFERENT domain, to prove
       the fill never overwrites. (The real cross-sell seed is Greek Glass only;
       this is here so the gap-fill rule itself is exercised rather than assumed.) */
    { id: "s1", name: "Seed Flower", store: "Puffy THCa", domain: "stale-seed-domain.example",
      cannabinoid: "THCa", category: "THCA Flower" }
  ],
  fetch: async () => new Response(JSON.stringify(FEED), { headers: { "content-type": "application/json" } })
};
globalThis.document = { dispatchEvent: e => dispatched.push(e) };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
globalThis.location = { origin: "http://x" };

const { pathToFileURL } = await import("node:url");
await import(pathToFileURL(process.cwd() + "/public/js/feed-meta.js").href);
await window.fetch("/api/products");
await new Promise(r => setTimeout(r, 60));

const M = window.LL_META || {};
const pool = M.catPool || {};
const names = c => (pool[c] || []).map(x => x.n);

ok("the tap built LL_META at all", !!M.catPool, Object.keys(pool).join(", ") || "nothing");
ok("Trim/Shake has a pool", names("Trim/Shake").includes("Sour Diesel Shake Ounce"),
   JSON.stringify(names("Trim/Shake")));
ok("...and the feed's flag beats the name, both ways",
   names("Trim/Shake").includes("Budget Buds Ounce") &&
   !names("Trim/Shake").includes("Grape Milkshake 3.5g"),
   JSON.stringify(names("Trim/Shake")));
ok("Vape has a pool", names("Vape").includes("Live Resin Cart 1g"), JSON.stringify(names("Vape")));
ok("Drinks has a pool", names("Drinks").includes("Rosin Seltzer 12oz"), JSON.stringify(names("Drinks")));
ok("CBD has a pool", names("CBD").includes("Calm Tincture 30ml"), JSON.stringify(names("CBD")));
/* THE OVERLAY IS ADDITIVE, not a re-filing: a cart is still a Concentrate. */
ok("...and a virtual facet does not empty the base category",
   names("Concentrate").includes("Live Resin Cart 1g"), JSON.stringify(names("Concentrate")));

group("THE SHOP TRAVELS WITH THE PHOTOGRAPH");
ok("every pool entry carries its store",
   Object.values(pool).every(l => l.every(x => typeof x.s === "string" && x.s)),
   JSON.stringify((pool["Concentrate"] || [])[0] || null));

group("AND WHICH LISTINGS ARE OFFCUTS, FOR THE SHELF");
ok("the trim map is published for shelf-shuffle.js",
   !!M.trim && M.trim.p2 === 1 && M.trim.p6 === 1, JSON.stringify(M.trim));
ok("...and a whole-bud listing is not in it", !M.trim.p7 && !M.trim.p1, JSON.stringify(M.trim));

group("THE ONE SHOP THE FEED CANNOT DESCRIBE");
ok("Greek Glass gets its domain from the engine's cross-sell seed",
   (M.domains || {})["Greek Glass"] === "www.greekglassshop.com",
   JSON.stringify(M.domains));
/* GAP-FILL ONLY. The feed is the authority for any shop it does carry, and a
   seed row is older than the feed by construction. */
ok("...without overwriting a shop the feed does carry",
   M.domains["Puffy THCa"] === "hipuffy.com", M.domains["Puffy THCa"]);

group("AND THE BRAND RAIL'S TWO VOCABULARIES, WHICH ONLY DIFFER ON A CITY PAGE");
/* The brand tallies are keyed on the word the FEED states; #fCategory carries the
   word the ENGINE states. On the hemp shelf those are the same string, so a
   browser test there passes whether or not the translation works -- it is a city
   page that says "Flower" where the engine says "THCA Flower", and a rail keyed
   on the wrong one empties instead of narrowing.
   Driven here rather than in the browser because the risk is the LOOKUP, and the
   shipped functions are read back out of rails.js so this cannot pass against a
   paraphrase. */
const railsSrc = readFileSync("public/js/rails.js", "utf8");
const grabFn = (re, what) => {
  const m = railsSrc.match(re);
  if (!m) { console.error("could not find " + what + " in rails.js"); process.exit(2); }
  return m[0];
};
const xlate = new Function("doc", "meta",
  "var window={LL_railsMeta:function(){return meta;}};" +
  "var document=doc;" +
  grabFn(/var ALIAS = \{\};[\s\S]*?\n  \}\n/, "learnCats") +
  grabFn(/  function within\(e, f\)\{[\s\S]*?\n  \}/, "within") +
  "return {learn:learnCats, within:within, alias:ALIAS};")

/* A city page's shapes: the feed's word on the product, the engine's on the card. */
const CITY = { catOf: { p1: "Flower", p2: "Flower", p3: "Vaporizers" } };
const cards = [
  { pid: "p1", cat: "THCA Flower" }, { pid: "p2", cat: "THCA Flower" },
  { pid: "p3", cat: "Concentrate" }
];
const fakeDoc = { querySelectorAll: () => cards.map(c => ({
  getAttribute: k => (k === "data-pid" ? c.pid : k === "data-cat" ? c.cat : null) })) };
const X = xlate(fakeDoc, CITY);
X.learn();
ok("the engine's word is learned from the cards, not copied from the engine",
   (X.alias["THCA Flower"] || []).indexOf("Flower") >= 0, JSON.stringify(X.alias));

/* A maker with two flower products and one cart, tallied in the FEED's words. */
const maker = { n: 3, perStore: { Lume: 3 },
                perCat: { Flower: 2, Vaporizers: 1 },
                perPair: { "Lume\u0000Flower": 2, "Lume\u0000Vaporizers": 1 } };
ok("a category the engine renamed still finds its products",
   X.within(maker, { store: "", cat: "THCA Flower" }) === 2,
   String(X.within(maker, { store: "", cat: "THCA Flower" })));
ok("...and narrows further with a shop on top of it",
   X.within(maker, { store: "Lume", cat: "THCA Flower" }) === 2,
   String(X.within(maker, { store: "Lume", cat: "THCA Flower" })));
ok("...while a shop alone counts the whole maker there",
   X.within(maker, { store: "Lume", cat: "" }) === 3);
ok("...and no facet at all is the whole catalogue",
   X.within(maker, { store: "", cat: "" }) === 3);
/* AN UNANSWERABLE CATEGORY COUNTS ZERO HERE -- and that is exactly why render()
   may not treat a zero as an answer. There is a real window where the table has
   no entry: the frame in which the selection changes before the grid repaints.
   within() reports what it knows; the caller decides that erasing EVERY maker
   means the facet was unanswered, not that the shelf is empty. An empty rail
   reads as broken; a rail that has not narrowed yet merely looks unhelpful for
   one frame. */
ok("an unlearned category counts nothing, so the caller must not read it as an answer",
   X.within(maker, { store: "", cat: "Never Seen" }) === 0);
/* AND THE FALLBACK IS FOR THE CATEGORY AXIS ONLY, which is the correction that
   followed: it first covered the store axis too, on the reasoning that "a
   shopper could not have picked a shop the engine does not offer". They can, and
   it means something -- only SIX of the sixteen shops carry a branded product at
   all, so "no makers here" is the normal answer for a shop, and reading it as
   "unanswerable" put all 155 makers back on the rail. Reported as "the store and
   brand currently are not faceting together at all".
   A store facet is never translated, so a zero there is a real zero. */
ok("...and render() gives the benefit of the doubt to the CATEGORY axis only",
   /if \(!list\.length && f\.cat && !catKnown\)/.test(railsSrc));
ok("...and only while the word is genuinely unknown",
   /var catKnown = !f\.cat \|\| \(ALIAS\[f\.cat\]/.test(railsSrc) &&
   /e3\.perCat\[f\.cat\]/.test(railsSrc));
/* THE HEMP SHELF IS THE DEGENERATE CASE and must keep working with no alias at
   all: there the feed's word IS the engine's, so the direct lookup answers. */
const plain = xlate({ querySelectorAll: () => [] }, {});
ok("and where the two vocabularies agree, no translation is needed",
   plain.within({ n: 9, perCat: { "THCA Flower": 4 } }, { store: "", cat: "THCA Flower" }) === 4);

group("AND A CITY PAGE ACTUALLY PUBLISHES THEM");
/* The rail can only translate what the page hands it. A generator that stopped
   emitting these would leave the dispensary rail wide open again, silently. */
const gen = readFileSync("tools/make-coldwater.mjs", "utf8");
ok("the generated meta carries the three tallies",
   /perStore: \{\}, perCat: \{\}, perPair: \{\}/.test(gen), "");
ok("...and the feed's own word per product id", /catOf\[x\.id\] = String\(x\.category\)/.test(gen));
ok("...and publishes it on the object the rail reads",
   /LL_COLDWATER_META\.catOf = catOf/.test(gen));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);

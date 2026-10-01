/* /p/<id> IS A PAGE NOW, NOT A CARD BLOWN UP.

   It began as a share target: something to paste into a DM, where a card is
   exactly right -- somebody taps a link and gets an object. As the destination
   for every product on the shelf it was the wrong shape, and the owner said so:
   a page should explain, not conceal. Everything that used to be behind a flip
   is on the page, and there is a shelf of substitutes under it.

   WHAT THIS PINS, in rough order of how badly it would fail silently:

     1. THE SIMILAR SHELF EXISTS AND IS RANKED. A dead-end product page is the
        thing this rebuild was for, and "0 similar" renders as a perfectly
        normal page with nothing wrong on it.
     2. IT PREFERS OTHER SHOPS. This is the inversion from the sister site this
        was ported from, which nudges toward the SAME vendor because one
        checkout beats two. Here the whole proposition is comparison, so six
        more products from the shop you are already looking at is the least
        useful shelf it could draw -- and it is exactly what a copied weight
        would produce.
     3. NOTHING IS OUT OF STOCK on it. "Here is something else you cannot buy."
     4. NO FLIP MACHINERY SURVIVES. Three hundred lines of it were removed; a
        leftover setFlipped() reference throws at runtime and takes the size
        picker with it, which is the difference between a page that looks fine
        and a page nobody can buy from. The suite parses the shipped inline
        script rather than trusting a grep, because that is how the last two of
        these were found.
     5. THE PALETTE IS THE SITE'S. This page shipped white with a leaf-green
        accent long after the rest of the site went cold blue.
     6. /p/pick STILL PAGES. It shares every line of this renderer and is the
        one caller with more than one slide.

     node test-product-page.mjs
*/
process.env.LL_NO_STORE_FETCH = "1";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

/* Four shops on purpose: with one, "prefers another shop" cannot be measured,
   and with two it passes half the time by luck. One row is out of stock and one
   has no image, because both must be refused. */
const SHOPS = [["Black Tie CBD", "blacktie"], ["THCA Small Buds", "thcasmallbuds"],
               ["CBD Hemp Direct", "cbdhempdirect"], ["Puffy", "hipuffy"]];
const NAMES = ["Blue Dream Premium THCA Flower", "Wedding Cake Smalls", "Gelato 41 Indoor",
               "Northern Lights THCA", "Sour Diesel Shake", "Blue Dream Smalls",
               "Runtz Exotic Indoor", "Zkittlez THCA Flower"];
const prod = (i) => {
  const [store, storeKey] = SHOPS[i % 4];
  const price = 40 + i * 3;
  return {
    id: "px" + i, name: NAMES[i % 8] + " " + (i + 1), store, storeKey,
    domain: "e.test", platform: "shopify", cannabinoid: "THCa", category: "THCA Flower",
    type: ["Indica", "Sativa", "Hybrid"][i % 3], strain: "Blue Dream", grow: "Indoor",
    image: i === 7 ? "" : "https://e.test/img/" + i + ".jpg", gallery: [],
    url: "https://e.test/p/" + i, brand: "B", brandKey: "b",
    description: "A dense, resinous flower.", inStock: i !== 9,
    startsAt: price, sale: price, perG: price / 28, ship: 0, badges: [], subTags: { trim: false },
    sizes: [["3.5 g", 15 + i, 3.5, "px" + i + "a", true, "", "", 0],
            ["1 oz", price, 28, "px" + i + "b", true, "", "", 0]],
  };
};
/* TWO DECOYS, BUILT TO WIN. The first draft of this suite marked one ordinary
   row out of stock and one without a photo, and asserted neither appeared --
   which passed with both filters DELETED, because neither was ever going to
   reach the top six on merit. A refusal is only tested by something that would
   otherwise be admitted.

   These two are the target's near-twins: same category, same strain words, a
   price within a couple of dollars, and a different shop, which is every signal
   the ranker rewards. They should score at or near the top of the shelf. One is
   sold out and one has no picture, so neither may appear at all. */
const TARGET_PRICE = 40 + 3 * 3;
const decoy = (id, over) => ({
  id, name: "Northern Lights THCA Reserve", store: "Black Tie CBD", storeKey: "blacktie",
  domain: "e.test", platform: "shopify", cannabinoid: "THCa", category: "THCA Flower",
  type: "Indica", strain: "Northern Lights", grow: "Indoor",
  image: "https://e.test/img/decoy.jpg", gallery: [],
  url: "https://e.test/p/" + id, brand: "B", brandKey: "b",
  description: "A dense, resinous flower.", inStock: true,
  startsAt: TARGET_PRICE + 1, sale: TARGET_PRICE + 1, perG: (TARGET_PRICE + 1) / 28,
  ship: 0, badges: [], subTags: { trim: false },
  sizes: [["1 oz", TARGET_PRICE + 1, 28, id + "b", true, "", "", 0]],
  ...over,
});
const DECOY_GONE = decoy("decoy-gone", { inStock: false });
const DECOY_BLIND = decoy("decoy-blind", { image: "" });
const FEED = { meta: { updated: new Date(0).toISOString() },
               products: [...Array.from({ length: 40 }, (_, i) => prod(i)), DECOY_GONE, DECOY_BLIND] };

const PORT = 3615;
const feed = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(FEED));
});
await new Promise((r) => feed.listen(PORT, "127.0.0.1", r));

const mod = await import("./api/share.js");
async function render(query) {
  const out = { status: 200, body: "" };
  const res = {
    setHeader() {}, status(c) { out.status = c; return this },
    send(b) { out.body = b; return this }, end(b) { if (b) out.body = b; return this },
    json(j) { out.body = JSON.stringify(j); return this },
  };
  await mod.default({ method: "GET", url: "/p/x", query, headers: { host: "127.0.0.1:" + PORT } }, res);
  return out;
}

const TARGET = "px3";                       /* Puffy, so "another shop" is meaningful */
const page = await render({ id: TARGET });
ok("the page renders", page.status === 200 && page.body.length > 4000, page.status + ", " + page.body.length + " bytes");

console.log("\n-- it is a page --");
ok("breadcrumb", /class="crumb"/.test(page.body));
ok("two columns", /class="pgrid"/.test(page.body));
ok("the name is the h1", /<h1 id="pname">[^<]{3,}</.test(page.body));
ok("the description is ON the page, not behind a turn", /id="pdesc"/.test(page.body));
ok("the size picker is on it", /id="size"/.test(page.body));
ok("the lab panel is on it", /id="labwrap"/.test(page.body));
ok("and the facts are chips", /class="chips"/.test(page.body));

console.log("\n-- 1. the shelf, which is the reason for the rebuild --");
const cards = [...page.body.matchAll(/class="scard" href="([^"]+)"/g)].map((m) => m[1]);
ok("More like this is drawn", /class="similar"/.test(page.body));
ok("with a full shelf of substitutes", cards.length === 6, cards.length + " cards");
ok("every card links to its own product page", cards.every((h) => /\/p\/px\d+$/.test(h)), cards.slice(0, 2).join(" "));
ok("and never back to the product you are on", !cards.some((h) => h.endsWith("/p/" + TARGET)));

const shops = [...page.body.matchAll(/class="sstore">([^<]*)</g)].map((m) => m[1]);
const names = [...page.body.matchAll(/class="sname">([^<]*)</g)].map((m) => m[1]);
console.log("  shelf: " + JSON.stringify(names.map((n, i) => n + " @ " + shops[i])));

console.log("\n-- 2. it prefers ANOTHER shop, which is this site's whole point --");
const target = FEED.products.find((p) => p.id === TARGET);
const elsewhere = shops.filter((s) => s !== target.store).length;
ok("most of the shelf is other shops", elsewhere > shops.length / 2, elsewhere + " of " + shops.length);
ok("...and more than one shop is represented", new Set(shops).size >= 3, [...new Set(shops)].join(", "));

console.log("\n-- 3. what it refuses --");
/* Proof the decoys are adversarial rather than merely absent: rank the pool
   with each one made admissible and check it actually wins a place. A refusal
   assertion whose subject could never have been admitted is worth nothing. */
const wouldRank = async (fix) => {
  const patched = FEED.products.map((p) => (p.id === fix.id ? { ...p, ...fix.make } : p));
  const saved = FEED.products;
  FEED.products = patched;
  const r = await render({ id: TARGET });
  FEED.products = saved;
  return [...r.body.matchAll(/class="sname">([^<]*)</g)].map((m) => m[1]);
};
const goneAdmitted = await wouldRank({ id: "decoy-gone", make: { inStock: true } });
ok("the sold-out decoy WOULD rank if it were in stock",
   goneAdmitted.includes(DECOY_GONE.name), goneAdmitted.slice(0, 3).join(" | "));
ok("...so refusing it means something", !names.includes(DECOY_GONE.name));

const blindAdmitted = await wouldRank({ id: "decoy-blind", make: { image: "https://e.test/i.jpg" } });
ok("the photoless decoy WOULD rank if it had a photo",
   blindAdmitted.includes(DECOY_BLIND.name), blindAdmitted.slice(0, 3).join(" | "));
ok("...so refusing it means something too", !names.includes(DECOY_BLIND.name));

console.log("\n-- 4. no flip machinery survives --");
const scripts = [...page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
/* ANY block, not the FIRST one. The claim here is that the page still carries its
   behaviour inline; which position that block occupies is not part of it. Pinning
   scripts[0] made this fail the moment a short block was added ahead of the big
   one -- measured 1571 / 17159 / 1889 characters, so the page ships 17KB of inline
   script and this read the 1.5KB one and called the feature missing. The three
   parse checks below already cover every block, and section 4's real subject is
   the flip machinery being gone, which is asserted by name underneath. */
ok("the page ships inline script",
   scripts.length >= 1 && scripts.some(b => b.length > 2000),
   scripts.map(b => b.length).join("/") + " chars across " + scripts.length + " blocks");
/* PARSED, NOT GREPPED. Removing the flip left an orphaned fragment mid-function
   twice over, and both times the file itself still parsed -- it is the SHIPPED
   string that has to, and only running it through a parser says so. */
for (let i = 0; i < scripts.length; i++) {
  let good = true, why = "";
  try { new Function(scripts[i]); } catch (e) { good = false; why = String(e.message); }
  ok(`inline script ${i + 1} parses`, good, why);
}
const all = scripts.join("\n");
for (const dead of ["setFlipped", "sizeCard", "toBack", "toFront"]) {
  ok(`no ${dead}() left behind`, !new RegExp("\\b" + dead + "\\b").test(all));
}
ok("and no flip markup", !/class="flip"|class="face |id="toBack"/.test(page.body));

console.log("\n-- 5. the site's palette, not the one it was recoloured away from --");
const css = page.body.slice(page.body.indexOf(":root{color-scheme"));
const accent = (css.match(/--accent:\s*(#[0-9a-fA-F]{3,6})/) || [])[1];
const family = (readFileSync("public/index.html", "utf8").match(/--leaf:\s*(#[0-9a-fA-F]{3,6})/) || [])[1];
ok("index.html states the family accent", !!family, family);
ok("this page uses it", accent && accent.toLowerCase() === family.toLowerCase(), accent + " vs " + family);
/* By hue rather than by a list of known literals, the way test-library-style
   asks it: a list only ever catches what somebody already thought of. */
const greens = [...page.body.matchAll(/#([0-9a-fA-F]{6})\b/g)]
  .map((m) => m[1]).filter((h) => {
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return g > r + 40 && g > b + 40;
  });
ok("no green dominates any colour on the page", greens.length === 0, greens.join(", "));

console.log("\n-- 8. specs, where the merchant stated them --");
{
  /* A GEAR PRODUCT THAT STATES EVERYTHING, and a flower one that states the
     same words. The second is the assertion that matters: "Glass Slipper 14mm"
     is a plausible strain name, and this repo has twice shipped a device word
     matching a flower listing. */
  const rig = {
    id: "rig1", name: 'Chill Steel Pipes 12" Beaker', store: "Chill", storeKey: "chill",
    domain: "e.test", platform: "shopify", cannabinoid: "Accessory", category: "Bongs & Rigs",
    type: "", strain: "", grow: "", image: "https://e.test/r.jpg", gallery: [],
    url: "https://e.test/p/rig1", brand: "Chill", brandKey: "chill",
    description: '<p>Heavy 18mm female joint, borosilicate glass, 12" tall.</p>',
    inStock: true, startsAt: 90, sale: 90, perG: null, ship: 0, badges: [], subTags: {},
    sizes: [["One Size", 90, 0, "rig1a", true, "", "", 0]],
  };
  const strain = { ...rig, id: "str1", name: "Glass Slipper 14mm Smalls",
    cannabinoid: "THCa", category: "THCA Flower", store: "Black Tie CBD", storeKey: "blacktie",
    description: "<p>A dense indoor flower.</p>" };
  const saved = FEED.products;
  FEED.products = [...saved, rig, strain];

  const r = await render({ id: "rig1" });
  ok("the gear page renders", r.status === 200, String(r.status));
  ok("it draws a Specifications table", /Specifications/.test(r.body));
  for (const [label, value] of [["Joint", "18mm female"], ["Material", "Borosilicate glass"], ["Height", '12"']]) {
    ok(`  ${label}: ${value}`, new RegExp("<td>" + label + "</td><td>" + value.replace(/"/g, "&quot;") + "</td>").test(r.body),
       (r.body.match(new RegExp("<td>" + label + "</td><td>[^<]*</td>")) || ["(absent)"])[0]);
  }
  ok("...and says whose numbers they are", /own listing/.test(r.body));

  const f = await render({ id: "str1" });
  ok("a flower listing gets NO spec table, even carrying 14mm in its name",
     !/Specifications/.test(f.body));

  /* And a gear product that states nothing draws no heading at all -- a
     "Specifications" header over an empty table reads as a page that failed. */
  const bare = { ...rig, id: "bare1", name: "Rolling Tray", description: "<p>A tray.</p>" };
  FEED.products = [...saved, bare];
  const b = await render({ id: "bare1" });
  ok("no specs stated, no heading drawn", !/Specifications/.test(b.body));
  FEED.products = saved;
}

console.log("\n-- 7. it says who pays us --");
{
  /* THE FTC ASKS FOR A DIFFERENT SENTENCE THAN THE ONE THIS PAGE ALREADY HAD.
     "Ranking is never affected by commission" is a claim about integrity, and a
     shopper can read it and still not learn that we are paid at all. The page
     exists to hand somebody an affiliate-stamped link, so the disclosure has to
     be on it, near the link.

     Asserted as the SITE'S OWN SENTENCE, read out of index.html rather than
     typed here: two wordings of one promise is how a promise starts drifting,
     and this file would otherwise become the second copy. */
  const shelf = readFileSync("public/index.html", "utf8");
  const m = shelf.match(/Affiliate disclosure:[^<]{20,400}/);
  ok("the shelf states a disclosure", !!m, m ? m[0].slice(0, 60) + "..." : "(none)");
  const norm = (x) => String(x).replace(/\s+/g, " ").trim();
  ok("the product page carries the same one, word for word",
     m && norm(page.body).includes(norm(m[0])),
     m ? norm(m[0]).slice(0, 70) + "..." : "");
  ok("...and /p/pick does too", m && norm((await render({ id: "pick" })).body).includes(norm(m[0])));
}

console.log("\n-- 6. /p/pick still pages, and 404 is still 404 --");
const pick = await render({ id: "pick" });
ok("the weekly pick renders as a page", pick.status === 200 && /class="pgrid"/.test(pick.body));
ok("...with its slide nav intact", /id="prev"/.test(pick.body) && /id="next"/.test(pick.body) && /id="count"/.test(pick.body));
ok("...and its own shelf", (pick.body.match(/class="scard"/g) || []).length === 6);
const missing = await render({ id: "no-such-product" });
ok("a product that is gone still 404s", missing.status === 404, String(missing.status));
ok("...without pretending to have substitutes", !/class="scard"/.test(missing.body));

feed.close();
console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All product page checks passed."}`);
process.exit(fails.length ? 1 : 0);

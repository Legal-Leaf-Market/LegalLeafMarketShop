/* api/shelves.js — what a shelf IS, stated once.
 *
 * The hemp catalogue is published on four surfaces: `/` shows everything, and
 * /consumables, /devices and /international show a slice of it. Until now each
 * slice was a 120KB hand-written page that fetched /api/products and rendered
 * its own cards, its own filters and its own sort -- none of the engine, none
 * of the rails, none of the card flip, and a `Add to Legal-Leaf Cart` button
 * wired up a third time.
 *
 * THE SLICE IS THE ONLY THING THAT DIFFERS, and this file is that difference.
 * Same argument as api/markets.js: a behaviour every shelf shares is not a
 * behaviour a shelf file gets to own, and one `if (shelf === "devices")` added
 * at 1am is invisible in every test because every other shelf keeps passing.
 *
 * THE PREDICATES WERE MEASURED OFF THE PAGES THEY REPLACE, not invented:
 *
 *   prodIsGlass(p) = p.cannabinoid === "Accessory" || p.storeKey === "greekglass"
 *   prodGroup(p)   = !prodIsGlass(p) ? "cons" : (isGlassAccessory(p) ? "glass" : "devices")
 *
 * /consumables claimed ["cons"], /devices claimed ["devices","glass"], and
 * /international ran in "intl" mode and returned on p.intl===true before the
 * group path was reached. So /devices claimed the whole of prodIsGlass and
 * /consumables claimed its complement -- which makes the split between "glass"
 * and "devices" a distinction NO PAGE EVER RENDERED. isGlassAccessory(), a
 * fifteen-line regex triplicated across all three files with a comment warning
 * that the copies would drift, decides nothing anybody sees. It is not ported.
 *
 * And Greek Glass is deliberately kept out of /api/products (CLAUDE.md §7), so
 * the storeKey half of prodIsGlass can never be true on this feed. What is left
 * is exactly `cannabinoid === "Accessory"`, which the feed already publishes and
 * the engine already honours.
 *
 * `group` is published per product so a page never has to re-derive it; `test`
 * is what /api/products?shelf= filters on. Both come from here.
 *
 * THE HEAT SHELVES ARE A SECOND AXIS, NOT A SECOND GROUP. /vaporizers and
 * /combustion both slice the SAME gear that /devices holds -- "we need to do
 * combustion devices and vaporizing devices", which is how a head shop sorts
 * its wall and is orthogonal to the eight gear buckets: a banger is Parts &
 * Tools AND vaporizing, a bong is Bongs & Rigs AND combusting. So they are
 * not a partition of `group` and they deliberately do not sum to it -- a
 * grinder is gear and is on neither, because it heats nothing. The verdict
 * itself is api/heat.js; nothing about the rule lives here.
 */

import { COMBUSTION, VAPOR } from './heat.js';

/* One product, one group. Kept as a function rather than folded into `test`
   because the feed publishes it per row and the shelves read it back. */
function shelfGroup(p) {
  if (!p) return "";
  return p.cannabinoid === "Accessory" || p.storeKey === "greekglass" ? "gear" : "cons";
}

const SHELVES = [
  {
    slug: "consumables",
    label: "Consumables",
    heading: "CONSUMABLES",
    title: "Consumables: Compare THCA Flower, Edibles, Vapes & CBD | Legal-Leaf Market",
    description: "Compare THCA flower, edibles, vapes and CBD by price per gram across trusted stores. Live prices, in-stock only, no sponsored ranking.",
    test: p => shelfGroup(p) === "cons",
  },
  {
    slug: "devices",
    label: "Devices & Misc",
    heading: "DEVICES &amp; MISC",
    title: "Devices & Misc: Vaporizers, Pipes & Grinders | Legal-Leaf Market",
    description: "Compare vaporizers, bongs and rigs, pipes, grinders and rolling gear across trusted stores. Live prices and real stock.",
    test: p => shelfGroup(p) === "gear",
  },
  {
    slug: "international",
    label: "International",
    heading: "INTERNATIONAL",
    title: "International: Worldwide-Shipping Grinders, Trays & Gear | Legal-Leaf Market",
    description: "Gear from vendors that ship worldwide, with prices in their own currency alongside the dollar.",
    /* NOT A GROUP. International is a shipping property, orthogonal to what the
       thing is -- an international vendor's products ALSO appear on their group
       shelf, which is what the note on the old inPage() meant. */
    test: p => p && p.intl === true,
  },
  {
    slug: "vaporizers",
    label: "Vaporizers",
    heading: "VAPORIZERS",
    title: "Vaporizers: Dry Herb Vapes, Dab Pens, E-Rigs & 510 Batteries | Legal-Leaf Market",
    description: "Every device that heats without burning, compared across stores: dry herb vaporizers, dab pens, e-rigs, enails, 510 batteries and the bangers and coils that feed them.",
    /* NOT `heat` READ OFF A GROUP. The feed stamps the verdict per product in
       api/heat.js, and "" is a real answer there, so this is an equality test
       rather than a negation -- a product with no verdict belongs on neither
       heat shelf and must not fall onto this one by default. */
    test: p => p && p.heat === VAPOR,
  },
  {
    slug: "combustion",
    label: "Combustion",
    heading: "COMBUSTION",
    title: "Combustion: Bongs, Glass Pipes, Rolling Papers & Ash Catchers | Legal-Leaf Market",
    description: "Everything you light: bongs and water pipes, hand pipes and chillums, rolling papers, bowls, downstems and ash catchers, compared across stores.",
    test: p => p && p.heat === COMBUSTION,
  },
];

const BY_SLUG = new Map(SHELVES.map(s => [s.slug, s]));

function shelfFor(slug) {
  return BY_SLUG.get(String(slug || "").trim().toLowerCase()) || null;
}

export { SHELVES, shelfFor, shelfGroup };

/* api/brand.js — who MADE this, stated once.
 *
 * Lifted out of api/coldwater.js because api/products.js needs the same answer
 * and there is no version of "both feeds derive a brand" that ends well with two
 * copies of the rule. This repo has paid for that lesson repeatedly: capKey and
 * captureKeyer, rscRoots and its collector twin, storeCheckoutUrl four times
 * over. A brand facet is worse than most of them, because a maker split across
 * two spellings does not error -- it just quietly becomes two chips, and the
 * whole point of the rail is that a brand at three shops is a price comparison.
 *
 * SMALL ON PURPOSE. The hemp scraper is the hot path -- sixteen stores per
 * refresh -- and importing the 3,100-line dispensary reader to get two string
 * functions would put that whole module in every cold start. Four functions and
 * a regex have no such cost.
 *
 BRAND, WHICH THE SHELF NEEDS AND THE FEED WAS THROWING AWAY.
 *
 * The same cart is stocked at four of these shops, and which shop is cheapest
 * for it is the one comparison nobody in this market publishes. toProduct() was
 * dropping `brand` on the floor entirely, so it was not even in the payload.
 *
 * Worse, what little brand there was had been corrupted: the collector stringified
 * an OBJECT brand, so 1,132 products -- 44% of the shelf, every Sapura and
 * Herbology row -- were published with "[object Object]" in their title. That is
 * fixed at the capture end, and stripped here too, because the captures ARE the
 * shelf and a repull should not be the price of removing it.
 *
 * FOUR SIGNALS, best first, because each shop states it differently:
 *   1. the feed's own brand field, once it is unwrapped
 *   2. the product URL -- Banzen links to /menu/brands/<slug>-<id>/ for 443 of 458
 *   3. a pipe-delimited title -- Herbology writes "Brand | Strain | 3.5g", 440 of 441
 *   4. nothing. Leave it blank; a guessed brand merges two companies' products.
 *
 * The leading-words guess that would cover Lume and Green Tree is NOT here on
 * purpose: "Blue Dream" leads a dozen titles at different shops and is a strain,
 * not a maker, and a brand facet that silently merges makers is worse than one
 * that admits it does not know. That inference belongs against a vocabulary built
 * from signals 1-3, which is a separate change with its own evidence.
 */

const OBJ_ARTEFACT = /\[object [A-Za-z]+\]/g;

function cleanName(n) {
  return String(n || "").replace(OBJ_ARTEFACT, "").replace(/\s+/g, " ")
    .replace(/^[\s|,\-]+/, "").trim();
}

function brandFromUrl(u) {
  const m = String(u || "").match(/\/brands?\/([^/?#]+)/i);
  if (!m) return "";
  /* Banzen's slug carries the shop's numeric id on the end: strip it, then
     title-case the hyphens back into words. */
  return m[1].replace(/-\d{3,}$/, "").split("-").filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").trim();
}

/* WooCommerce states a brand in TWO places and the feed was reading neither.
 *
 * The note this replaces in api/products.js said "Woo's Store API has no vendor
 * field", which was true of core Woo and stopped being true when Brands were
 * merged into WooCommerce 9.4: `brands` is a real taxonomy on the products
 * response. Older installs put it on a `pa_brand` product attribute instead.
 * Both are the SHOP'S OWN WORD for who made the thing, which is signal 1 above --
 * not the leading-words guess normBrand deliberately refuses.
 *
 * Measured 19 Aug 2026 on the deployed feed: every Shopify store reported 100%
 * brand coverage from `vendor` while all six WooCommerce stores reported zero,
 * 425 products with no maker at all. That is not sixteen shops selling unbranded
 * goods, it is one reader missing.
 *
 * The attribute pass skips anything with `has_variations`, because a variation
 * attribute is a SIZE SELECTOR -- reading "Net Weight" as a maker would file
 * every CBD Hemp Direct flower product under a brand called "28 Grams", which is
 * worse than the blank it replaces: a wrong chip looks like a real one.
 */
function brandFromWoo(p) {
  if (!p || typeof p !== "object") return "";
  const list = Array.isArray(p.brands) ? p.brands : [];
  for (const b of list) {
    const n = cleanName(b && (b.name || b.slug));
    if (n) return n;
  }
  const attrs = Array.isArray(p.attributes) ? p.attributes : [];
  for (const a of attrs) {
    if (!a || a.has_variations) continue;
    const label = String(a.taxonomy || a.name || "").toLowerCase();
    if (!/\bbrands?\b/.test(label.replace(/[^a-z]+/g, " "))) continue;
    const terms = Array.isArray(a.terms) ? a.terms : [];
    for (const t of terms) {
      const n = cleanName(t && (t.name || t.slug));
      if (n) return n;
    }
    const v = cleanName(a.value);
    if (v) return v;
  }
  return "";
}

/* A SHOP IS NOT A MAKER, AND SHOPIFY CANNOT TELL YOU THE DIFFERENCE.
 *
 * Reported 19 Aug 2026: "black tie, thca small buds and so on are showing up in
 * brand as well as store -- I just want it to be in store." Exactly right, and
 * the cause is signal 1 above: `vendor` is the shop's own word for who made the
 * thing, and at a house-brand store that word IS the shop. So every Black Tie
 * product came through with brand "Black Tie CBD", and the brand rail redrew the
 * store rail sitting next to it.
 *
 * IT WAS VISIBLE IN THE CENSUS BEFORE IT WAS VISIBLE ON THE PAGE. multiShop read
 * ONE across 168 makers -- a store brand can never appear at a second shop by
 * construction -- and that number was reported and then not acted on. This is
 * what it meant.
 *
 * A brand at one shop is a label; a brand at three is a price comparison, which
 * is the entire reason the rail exists. A label that duplicates the chip beside
 * it is worse than no chip: it doubles the rail and compares nothing.
 *
 * MATCHED ON THE PRODUCT'S OWN SHOP, not on a list of all shops. "Cookies" is a
 * real maker and somewhere it is also a shop name; dropping it everywhere
 * because one retailer shares the name would lose a genuine comparison. The
 * counter-case survives here: a Cookies product at Cookies-the-shop loses its
 * chip, the same product at another shop keeps it. That is the one case this
 * gets wrong, it costs a shop count rather than a whole brand, and precision is
 * the right side to err on -- a wrong chip looks exactly like a real one.
 *
 * PREFIX, NOT EQUALITY, because a shop and its house brand rarely spell it the
 * same: vendor "Black Tie" against store "Black Tie CBD", "Chill" against "Chill
 * Steel Pipes", "Puffy" against "Puffy THCa". The boundary test is what stops
 * "Chill" matching a shop called "Chillum Co".
 */
function isStoreBrand(brand, storeName, storeKey) {
  const b = brandKey(brand);
  if (!b) return false;
  const starts = (a, c) => a === c || a.indexOf(c + "-") === 0 || c.indexOf(a + "-") === 0;
  const n = brandKey(storeName);
  if (n && starts(b, n)) return true;
  /* storeKey is already squashed ("blacktiecbd"), so it is compared without the
     separators -- and by EQUALITY ONLY. A prefix test here has no word boundary
     to stop at, so "Chillum Co" flattens to "chillumco" and matches the store
     key "chill", which would drop a real maker as a house brand. The name test
     above already does the boundary-aware work; this is the safety net for a
     vendor that spells itself without spaces ("BlackTieCBD" against the store
     "Black Tie CBD"), which equality catches on its own. */
  const flat = b.replace(/-/g, "");
  const k = String(storeKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return !!k && flat === k;
}

function normBrand(raw, name, url) {
  let b = cleanName(raw);
  if (b) return b;
  b = brandFromUrl(url);
  if (b) return b;
  /* "Red Fox Cannabis | Blue Limonene | 3.5g" -- the maker is the first field.
     Only when there are at least two more, so a stray pipe is not a brand. */
  const parts = cleanName(name).split("|").map(x => x.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[0];
  return "";
}

/* One key per maker, so "ROVE", "Rove" and "rove " are one chip rather than three
   -- the same failure the category vocabulary had. */
function brandKey(b) {
  return String(b || "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-");
}

export { OBJ_ARTEFACT, cleanName, brandFromUrl, brandFromWoo, normBrand, brandKey, isStoreBrand };

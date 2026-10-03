// Per-product share page, server rendered, at /p/<id> (see the rewrite in vercel.json).
//
// WHY THIS EXISTS
//
// Instagram, Facebook and every other link-preview crawler reads Open Graph tags
// out of the HTML the server returns. None of them run JavaScript. This site is
// static HTML plus a client-side render from /api/products, and every page ships
// the same site-level og: tags pointing at /og-image.png, so pasting ANY link into
// a DM produced one identical generic card: "Compare Legal Hemp Deals by Price Per
// Gram". There was no per-product URL to paste in the first place.
//
// So this route is the only thing on the site that can produce a product card: it
// looks the product up server side and emits og: tags carrying that product's own
// name, price and image, plus a real page for the human who taps it.
//
// It deliberately does NOT re-run the scrape. It fetches the site's own
// /api/products, which is CDN cached (see vercel.json), so a warm hit is one cheap
// request rather than twenty store scrapes.
//
// SAFETY NOTE: every field here originates in a third party store's product feed,
// which means product names and image URLs are untrusted input being written into
// HTML. Everything goes through esc(), and image/link URLs are restricted to https
// so a poisoned feed row cannot smuggle javascript: into an href or break out of an
// attribute.

import { specsOf, SPEC_ORDER } from './specs.js';
import { SHELVES } from './shelves.js';
import { MARKETS } from './markets.js';

const SITE = 'https://legal-leafmarket.com';

/* ------------------------------------------------------------------ *
 * THE CRUMB IS A BACK, NOT A HOME                                     *
 * ------------------------------------------------------------------ *
 *
 * "You should just be hitting back to the same spot, not hitting home again.
 *  Why would you hit home and refresh again? Get them back to the same spot.
 *  It should be like when you tab over to Reels on Facebook, and you come back
 *  to your main feed, and it's there."
 *
 * The only way off this page was `<a href="https://legal-leafmarket.com/">`,
 * and every word of that is wrong for somebody coming back:
 *
 *   - IT GOES TO `/`. A shopper browsing /devices who opens a bong and clicks
 *     it lands on the HOME shelf. Their shelf is not merely re-sorted, it is a
 *     different shelf. That is the "hitting home again".
 *   - IT IS A FRESH NAVIGATION, so the browser cannot use its back/forward
 *     cache and the whole shelf is torn down and built again from nothing.
 *     Measured: eight full grid repaints, then a two-and-a-half second pause,
 *     then a jump to the old scroll position. A reload with a teleport on the
 *     end.
 *   - AND IT DEFEATS shelf-return.js, which is sitting right there ready to put
 *     the shelf back -- its snapshot is keyed on the path it was taken from, so
 *     landing on `/` from a /devices snapshot discards it entirely.
 *
 * A `history.back()` costs none of that: the browser restores the previous
 * entry from its own cache, which is the actual Reels behaviour -- same cards,
 * same order, same pixel, no fetch, no rebuild, no restore logic needed.
 *
 * THE HREF STAYS A REAL LINK to that same shelf, and that is not belt and
 * braces. Middle-click and ctrl-click must keep meaning "open in a new tab",
 * a crawler must see a real destination, and somebody who reached this page
 * with no history to go back to still needs the link to work -- in which case
 * shelf-return does its slower job and the result is still the right shelf.
 */

/* Every path that IS a shelf, from the registries rather than a list kept here:
   one `if (path === "/devices")` in this file is exactly the drift api/shelves.js
   and api/markets.js exist to prevent. `/` is the whole catalogue and is not in
   either registry, so it is named once. */
function shelfPaths() {
  const out = { '/': 'the shelf' };
  for (const s of SHELVES) out['/' + s.slug] = s.label;
  for (const k of Object.keys(MARKETS || {})) {
    const m = MARKETS[k];
    if (m && m.slug) out['/' + (m.urlSlug || m.slug)] = m.label || m.slug;
  }
  return out;
}

const FALLBACK_IMG = SITE + '/og-image.png';

/* Tab icon for /p/<id> and /p/pick, which had none and so showed the browser's blank default
   sheet next to a page whose whole job is to look deliberate when someone opens it from a DM.
 *
 * Inlined as a data URI rather than a file: one fewer request on a page that is usually opened
 * on mobile data, and nothing to 404 if /public ever moves. Kept as READABLE SVG source with
 * encodeURIComponent at the end, not a base64 blob, so the next person can actually edit it.
 *
 * The @media query inside the SVG is the reason it is SVG at all: browsers apply the VIEWER's
 * colour scheme to it, so the mark is white-on-forest in a light tab strip and mint-on-near-black
 * in a dark one, instead of one of the two looking like a sticker. Verified by rendering at 16,
 * 24, 32, 64 and 128 in both schemes; 16 is the size that actually matters and drove the lobe
 * width, since thin lobes turn to mush there.
 *
 * RETINTED WITH THE PAGE. It was a leaf in #4ec97a on #1c7a3e -- the green this
 * site was recoloured away from -- so the tab was still flying the old flag next
 * to a page that no longer is. It is the accent and its dark step now. Not the
 * site's own /favicon.svg, which is a six-stop rainbow leaf and does not survive
 * being shrunk to a 16px mark or being asked to invert for a light tab strip;
 * this one is a silhouette, which is what that size can carry.
 *
 * Safari before 16 ignores SVG favicons and falls back to the default sheet. That is the same
 * blank sheet it shows today, so this is strictly an improvement with no PNG fallback needed. */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<style>.bg{fill:#0f1216}.lf{fill:#4ec9ff}@media(prefers-color-scheme:light){.bg{fill:#1787c4}.lf{fill:#fff}}
</style>
<rect class="bg" width="64" height="64" rx="15"/>
<g class="lf" transform="translate(32,53)">
<path d="M0 0C-7.2-12-5-23 0-30 5-23 7.2-12 0 0Z"/>
<path d="M0 0C-7.2-12-5-23 0-30 5-23 7.2-12 0 0Z" transform="rotate(38) scale(.86)"/>
<path d="M0 0C-7.2-12-5-23 0-30 5-23 7.2-12 0 0Z" transform="rotate(-38) scale(.86)"/>
<path d="M0 0C-7.2-12-5-23 0-30 5-23 7.2-12 0 0Z" transform="rotate(72) scale(.66)"/>
<path d="M0 0C-7.2-12-5-23 0-30 5-23 7.2-12 0 0Z" transform="rotate(-72) scale(.66)"/>
<rect x="-2" y="-2" width="4" height="9" rx="2"/></g></svg>`;
const FAVICON_URI = 'data:image/svg+xml,' + encodeURIComponent(FAVICON_SVG.replace(/\n/g, ''));

// Text into HTML, for both element bodies and quoted attribute values.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A URL is only allowed through if it is really https. Anything else, including
// javascript: and data:, is dropped rather than sanitised into something plausible.
function httpsOnly(u, fallback = '') {
  try {
    const parsed = new URL(String(u));
    return parsed.protocol === 'https:' ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

/* A crawler decides whether to show a picture from the tags alone. Given
   og:image:width and og:image:height it can lay the card out on the first scrape;
   without them it has to fetch and measure the image first, and what goes out in
   the meantime is a card with no picture in it. That was survivable while og:image
   was the listing's lead photo, because those few URLs were already in Meta's cache
   from earlier shares. It stopped being survivable when the advertised ROW's own
   photo took over: a per-variant URL nothing has ever scraped is now the normal
   case, so the send that matters is the one that renders bare.

   Dimensions are only ever stated when they are true:

   - our own og-image.png is 1200x630, measured,
   - a Shopify CDN url can be ASKED for a square 1200 (that CDN reads width, height
     and crop as query params), and it never upscales past the original, so what
     comes back is at most 1200 and always square. The ratio the card lays out on
     holds either way, which is the part a wrong number would visibly break.

   Any other host ships with no dimensions rather than with a guess. */
const OG_SQUARE = 1200;
const SHOPIFY_CDN = /(^|\.)cdn\.shopify\.com$|\.myshopify\.com$/;

function imageType(pathname) {
  const m = /\.(jpe?g|png|webp|gif|avif)$/i.exec(String(pathname));
  if (!m) return '';
  const ext = m[1].toLowerCase();
  return 'image/' + (ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext);
}

function ogImageMeta(u) {
  let url;
  try {
    url = new URL(String(u));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.origin === SITE && url.pathname === '/og-image.png') {
    return { url: url.toString(), w: 1200, h: 630, type: 'image/png' };
  }
  if (SHOPIFY_CDN.test(url.hostname.toLowerCase())) {
    url.searchParams.set('width', String(OG_SQUARE));
    url.searchParams.set('height', String(OG_SQUARE));
    url.searchParams.set('crop', 'center');
    return { url: url.toString(), w: OG_SQUARE, h: OG_SQUARE, type: imageType(url.pathname) };
  }
  return { url: url.toString(), w: null, h: null, type: imageType(url.pathname) };
}

function money(n, cur = 'USD') {
  const v = Number(n);
  if (!isFinite(v)) return '';
  const sym = cur === 'EUR' ? '€' : '$';
  return sym + (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
}

// "1oz" reads better than "28g" in a card, and the ounce is the unit the pick of
// the week is chosen on.
function weightLabel(g) {
  const grams = Number(g);
  if (!isFinite(grams) || grams <= 0) return '';
  const oz = grams / 28;
  if (Math.abs(oz - Math.round(oz)) < 0.06 && oz >= 1) {
    const n = Math.round(oz);
    return n + 'oz';
  }
  if (Math.abs(grams - 3.5) < 0.01) return 'eighth, 3.5g';
  if (Math.abs(grams - 7) < 0.01) return 'quarter, 7g';
  if (Math.abs(grams - 14) < 0.01) return 'half, 14g';
  return grams + 'g';
}

// The cheapest size that is actually in stock decides the headline price, so the
// card never advertises a number the shopper cannot get.
function headline(p) {
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const usable = sizes
    .map((s) => ({ label: s && s[0], price: Number(s && s[1]), grams: Number(s && s[2]) }))
    .filter((s) => isFinite(s.price) && s.price > 0);
  if (!usable.length) {
    return { price: Number(p.sale) || Number(p.startsAt) || null, weight: '', perG: p.perG };
  }
  usable.sort((a, b) => a.price - b.price);
  const cheapest = usable[0];
  return {
    price: cheapest.price,
    weight: weightLabel(cheapest.grams) || cheapest.label || '',
    perG: p.perG,
  };
}

// Exactly the item addToCart() in consumables.html pushes, field for field. The
// size row layout is [label, price, grams, variantId, ?, url, ?], so the per-size
// URL at s[5] wins over the product URL when the store gave us one.
function cartItem(p, idx) {
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  let s = idx != null && sizes[idx] ? sizes[idx] : null;
  if (!s) {
    const usable = sizes.filter((x) => isFinite(Number(x && x[1])) && Number(x[1]) > 0);
    usable.sort((a, b) => Number(a[1]) - Number(b[1]));
    s = usable[0] || null;
  }
  return {
    id: p.id, name: p.name, store: p.store, storeKey: p.storeKey, domain: p.domain,
    cartDomain: p.cartDomain || '', platform: p.platform || 'shopify',
    /* refParam travels with the item because the site cart builds the multi-item checkout URL
       from it, and the name is not always "ref": CBD Hemp Direct tracks on sld, Nothing But Canna
       on sca_ref. Dropping it here would hand the cart a link that works and pays nobody. */
    ref: p.ref || '', refParam: p.refParam || '', refLink: p.refLink || '', coupon: p.coupon || '',
    /* Same reason, for WooCommerce specifically: the site cart builds ?add-to-cart=<id> from the
       variation id, falling back to the parent when the product is simple, and sends it to the
       store's own cart path. Without these two the link degrades to the bare product page with
       an empty cart, which is what the owner reported on CBD Hemp Direct. */
    productId: p.productId || '', cartPath: p.cartPath || '',
    /* And slot 8, the chosen variation's attribute query, because the parent id and variation id
       are NOT sufficient on their own: Woo's handler answers a bare ?add-to-cart=<variation id>
       with "please choose product options by visiting <product>" and an empty cart. Omitting it
       here degraded every Woo product shared through /p/<id> and /p/pick to exactly the failure
       this pair was added to fix, on the size the shopper was actually shown. */
    attrQuery: (s && s[8]) || '',
    url: (s && s[5]) || p.url || '',
    price: s ? s[1] : p.sale,
    size: s ? s[0] : 'One Size',
    variantId: s ? s[3] : '',
    cur: p.cur || 'USD',
  };
}

/* ---- /p/pick: the weekly pick, computed rather than curated ----
 *
 * "An ounce under $50" is a query, not an editorial decision, so the pick
 * resolves from live data on every request. It cannot advertise a product that
 * sold out or a price that moved, and there is no weekly step where somebody
 * pastes a product id into a link.
 *
 * Among the rows that qualify it leads with the one CLOSEST TO THE CAP, not the
 * cheapest per gram. That reversed on 10 Aug 2026, and the reason is what this
 * card is for: it is the first thing a stranger sees in a DM, and the cheapest
 * qualifying row was a $20 ounce, which reads as bargain bin and makes the whole
 * offer look worse than it is. The cap is the promise, so spending it is the
 * point.
 *
 * This is deliberately NOT a value claim, and no copy makes one. The card states
 * the size, the price and the per gram figure and leaves it there, and the DM
 * that carries it says "under $50" rather than "the best value we could find".
 * Ranking on price per gram is what the comparison page is for, and it is one
 * tap away on every one of these cards.
 *
 * It ranks SIZE ROWS, not products: a product's headline perG can come from a
 * quarter pound, which is not an ounce. Equal prices break on per gram and then
 * on id, so the choice is stable between requests rather than flipping with feed
 * ordering.
 *
 * The weight window is a BAND, not a floor, and this ordering makes it MORE load
 * bearing rather than less. With a floor alone a quarter pound at $45 clears a
 * 28g floor and clears the cap, so the card would read "4oz $45" under a message
 * promising an ounce: wrong promise, and now it sorts straight to the top rather
 * than having to be cheap per gram to get there. The band keeps the pick to the
 * thing that was actually advertised.
 */
/* pickAll ranks every qualifying size row, dearest first. What reaches the
   slideshow is a composed mix of that ranking rather than its top ten: see POOL_MIX
   below for why taking the top ten produced a wall of trim. */

/* Does a size row's own label say "ounce"? Sub-ounce fractions are excluded first,
   because "1/4 oz" contains "oz" while being a quarter. */
var SUB_OUNCE = /(eighth|quarter|half|1\s*\/\s*8|1\s*\/\s*4|1\s*\/\s*2)/i;
var OUNCE_WORD = /(^|[^a-z])(oz|ounce)s?([^a-z]|$)/i;
function namesAnOunce(label) {
  var t = String(label || '');
  if (SUB_OUNCE.test(t)) return false;
  return OUNCE_WORD.test(t);
}

/* Trim and shake are flower's offcuts, and per gram they are the cheapest thing in
   the feed, so leading with the dearest ounce inside a $50 cap lands on them often
   rather than rarely: at that price a trim ounce outbids most whole-bud ounces.
   Carrying them is fine, letting somebody find out after buying is not, so the card
   says which it is instead of leaving the product name to imply it.

   Word boundaries, not a substring test, and the reason is in the live ids: Black
   Tie sells both "thca-flower-trim-shake" and "grape-milkshake-greenhouse-thca-
   flower", and a substring test brands that second one, a whole-bud strain, as
   shake. Checked against every id in coa-blacktie.js, coa-data.js and
   coa-thcaking.js (that last one now an archive, its store delisted 10 Aug 2026;
   none of the examples here came from it): the real ones all name it as its own
   word ("cheap-thca-flower-trim", "thca-shake-indoor", "dank-thca-trim"), and
   "milkshake" is the only near-miss, which is exactly what a boundary excludes. Do not loosen this to a
   substring without re-checking those ids, the same rule the exclusion regexes on
   the sister sites are held to. */
var TRIM_WORD = /(^|[^a-z])(trim|shake)s?([^a-z]|$)/i;
function isTrimShake(text) {
  return TRIM_WORD.test(String(text || ''));
}

/* The feed's own verdict, and it outranks the title, because it was reached with evidence this
   page cannot see. products.js sets `offcut` at scrape time off title + tags + body_html, so a
   store that only admits the grade in its marketing copy is still caught: CBD Hemp Direct sells
   "Budget Buds THCA Flower" whose description says the category "may feature shake, trim, and
   smalls", and the title alone reads as whole buds. Descriptions cannot ship in the feed (payload
   doubles), so the boolean travels instead of the copy.

   Falls back to the title test when the flag is absent, which is any older cached feed and every
   test fixture written before it existed. */
function isTrimProduct(p) {
  if (p && p.offcut === true) return true;
  return isTrimShake(p && p.name);
}

/* Rows often inherit their weight from the PRODUCT TITLE rather than their own
   label: on a multi-strain listing titled "... Smalls Ounce", every strain row is
   tagged 28g even though the row itself says only the strain. That inference is
   usually right, but it goes wrong when the same product also sells a row that
   explicitly IS an ounce at a price above the cap. Picking a title-inferred row
   from such a product advertises an ounce under $50 when the product's actual
   ounce costs more, which is the case the user hit: an $80 ounce with a cheaper
   smaller quantity underneath it.

   So a row whose own label names an ounce is judged on its own price, while a row
   relying on the title's inference is rejected outright when the product has an
   explicitly-ounce row over the cap. */
function ounceRowOverCap(sizes, maxPrice) {
  for (var j = 0; j < sizes.length; j++) {
    var row = sizes[j];
    if (!namesAnOunce(row && row[0])) continue;
    if (Number(row[1]) > maxPrice) return true;
  }
  return false;
}

/* ---- the mix ----
 *
 * Ranking alone produced a slideshow of almost nothing but trim, and for a
 * structural reason rather than a fluke: trim is the cheapest thing per gram, so
 * within a fixed budget it is always the most weight available, and once the order
 * became "dearest inside the cap" the trim ounces swept the top of the list. Ten
 * slides of offcuts is not a shop window.
 *
 * So the pool is composed to a fixed mix rather than taken off the top of one
 * ranking. Each bucket is filled dearest-first from its own rows, and the buckets
 * are laid out in this order, so slide one and the shared card are always a
 * whole-bud THCa ounce.
 *
 * THCa alone is allowed to REPEAT a listing, and only after every distinct listing
 * has been used. A multi-strain ounce sold at four prices then fills two or three
 * slides with a different row selected on each, which is a real second option to a
 * shopper (different strain, different price) rather than padding. Trim and CBD are
 * caps, not targets: they never repeat, and if the feed has fewer than the cap the
 * pool is simply shorter. Nothing backfills across buckets, because the whole point
 * is that trim cannot expand into the space THCa leaves.
 *
 * THREE OF THE SIX THCa SLOTS ARE RESERVED FOR THCA SMALL BUDS, and this is the one
 * genuinely editorial thing on the card, so it is written down rather than buried.
 *
 * The reason on the record is the owner's: six-plus months of personal orders from
 * that store, price to quality they say cannot be matched, and enough confidence to
 * put their own name behind it in a DM. THE REASON IS NOT THE COMMISSION. Small Buds
 * pays (ref coffeeandajoint, coupon JACOBKENNEDY) and so do most of the others, and
 * per CLAUDE.md payout is never an input to how a merchant is treated. A vouch and a
 * kickback look identical from outside, which is exactly why the file has to say
 * which one it was: this is a vouch.
 *
 * Two limits keep it honest:
 *
 *   - It is a FLOOR, not a filter, and it moves nothing else. The comparison grid
 *     still sorts on price, discount, recency or shuffle, exactly as the footer
 *     promises. This reserves slides in one marketing slideshow.
 *   - It cannot invent inventory. If fewer than three Small Buds rows qualify under
 *     the cap, the pool takes what exists and the rest fills normally. Nothing is
 *     padded past what the store is actually selling that day.
 *
 * The remaining three THCa slots are SPREAD across as many other shops as the feed
 * allows, one listing per store per round, so the half of the slideshow that is not
 * reserved is genuinely a survey rather than a second store's block.
 *
 * The pick is therefore no longer purely computed. The query still decides what is
 * eligible and the ranking still decides the order inside every bucket, but the
 * composition is now part editorial. No copy on the card claims otherwise: it states
 * the size, the price and the per gram figure, and it never called itself the best
 * anything.
 */
var POOL_MIX = [
  { key: 'thca', want: 6, repeat: true, reserve: { storeKey: 'thcasmallbuds', min: 3 }, spread: true },
  { key: 'trim', want: 3, repeat: false },
  { key: 'cbd', want: 1, repeat: false },
];
var PICK_POOL = POOL_MIX.reduce(function (n, s) { return n + s.want; }, 0);

/* Trim wins over cannabinoid: a shopper who thinks they are buying buds and gets
   offcuts has been misled about the more material thing. CBD comes off the
   classifier's own cannabinoid field (products.js: cbd/cbg/cbn/hemp all land on
   'CBD'), and an absent field means THCa there too, so it means THCa here.
   Anything else the classifier recognises, the D8/HHC/THCP family, belongs to none
   of the three and is left out of the pool rather than quietly counted as THCa. */
/* Takes either a size row or a bare label. The row is preferred: slot 7 is the feed's
   own per-row grade, which sees the store's category and description and so catches a
   row whose label alone gives nothing away. */
function bucketOf(p, row) {
  var isRow = Array.isArray(row);
  var rowLabel = isRow ? row[0] : row;
  var rowTrim = (isRow && row[7] != null) ? !!row[7] : isTrimShake(rowLabel);
  if (isTrimProduct(p) || rowTrim) return 'trim';
  var c = String((p && p.cannabinoid) || 'THCa');
  if (c === 'CBD') return 'cbd';
  if (c === 'THCa') return 'thca';
  return null;
}

/* Dearest first, so the card leads with the most the budget buys rather than the least.
   Two rows at the same price are separated by per gram, which at a fixed price means the
   bigger ounce, and then by key so the ordering, and therefore every ?i= link, is stable
   between requests instead of following feed order. Shared by the ranking and by the
   composer, so a re-sort after composition cannot drift from it. */
function byDearest(a, b) {
  if (a.price !== b.price) return b.price - a.price;
  if (a.perG !== b.perG) return a.perG - b.perG;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/* One slide per listing first, so ten slides are ten different shops wherever the feed
   allows it. `rows` arrives dearest-first, so this takes the dearest qualifying row of
   each distinct listing in turn. */
function takeDistinct(rows, taken, seen, upTo) {
  for (var j = 0; j < rows.length && taken.length < upTo; j++) {
    if (seen[rows[j].product.id]) continue;
    seen[rows[j].product.id] = 1;
    taken.push(rows[j]);
  }
}

/* Only then, and only where the slot allows it, a second row from a listing already
   used. Each carries its own index, so the slide opens with that row selected and its
   own price and photo. */
function takeRepeats(rows, taken, upTo, repeated) {
  for (var k = 0; k < rows.length && taken.length < upTo; k++) {
    if (taken.indexOf(rows[k]) === -1) { taken.push(rows[k]); repeated.push(rows[k]); }
  }
}

/* Reorders rows so stores alternate: every shop's dearest qualifying row, then every
   shop's second, and so on. Feeding takeDistinct() this order is what stops one large
   catalogue taking every unreserved slot just because it lists the most ounces.

   `defer` (the reserved store) goes to the very end rather than into the rotation: it
   already holds its floor, and it should only take an unreserved slot when literally
   nothing else can fill one. */
function spreadByStore(rows, defer) {
  var order = [], byStore = {}, deferred = [];
  for (var i = 0; i < rows.length; i++) {
    var sk = String((rows[i].product && rows[i].product.storeKey) || '');
    if (defer && sk === defer) { deferred.push(rows[i]); continue; }
    if (!byStore[sk]) { byStore[sk] = []; order.push(sk); }
    byStore[sk].push(rows[i]);
  }
  var out = [], round = 0, moved = true;
  while (moved) {
    moved = false;
    for (var s = 0; s < order.length; s++) {
      var q = byStore[order[s]];
      if (round < q.length) { out.push(q[round]); moved = true; }
    }
    round++;
  }
  return out.concat(deferred);
}

function composePool(ranked) {
  var out = [];
  for (var m = 0; m < POOL_MIX.length; m++) {
    var slot = POOL_MIX[m];
    var rows = ranked.filter(function (r) { return r.bucket === slot.key; });
    var seen = {};
    var taken = [];
    var repeated = [];

    /* The reserved floor is filled FIRST, out of that store's rows alone, so it cannot
       be crowded out by a dearer row from anywhere else. It is a floor and not a quota:
       if the store has fewer qualifying rows than the floor asks for, this simply takes
       what it has and the rest of the slot fills normally below. */
    if (slot.reserve) {
      var mine = rows.filter(function (r) {
        return r.product && r.product.storeKey === slot.reserve.storeKey;
      });
      var floor = Math.min(slot.reserve.min, slot.want);
      takeDistinct(mine, taken, seen, floor);
      if (slot.repeat) takeRepeats(mine, taken, floor, repeated);
    }

    var rest = rows.filter(function (r) { return taken.indexOf(r) === -1; });
    if (slot.spread) rest = spreadByStore(rest, slot.reserve && slot.reserve.storeKey);
    takeDistinct(rest, taken, seen, slot.want);
    if (slot.repeat) takeRepeats(rest, taken, slot.want, repeated);

    /* WHICH rows are in the bucket is now part editorial. What ORDER they run in is
       not, and must not become so: slide one is the card that goes in a DM, and the
       rule for it has been "the dearest ounce the cap allows" since the $20 lead read
       as bargain bin and made the whole offer look worse than it is. Filling the
       reserved floor first and then leaving it there would have handed slide one to
       whichever store holds the reservation, at whatever price they happen to charge.

       So the bucket is re-sorted on the same comparator the ranking uses, and the
       reservation buys presence in the ten rather than the front of them. Distinct
       listings are sorted and run BEFORE any repeat, which keeps the other rule the
       composer has always had: a second row from a shop already shown never displaces
       a shop that has not been shown at all. The lead is still the dearest row in the
       bucket either way, since the dearest row of any listing is taken in the distinct
       pass, so a repeat can never be the dearest thing here. */
    var first = taken.filter(function (r) { return repeated.indexOf(r) === -1; });
    first.sort(byDearest);
    repeated.sort(byDearest);
    out = out.concat(first, repeated);
  }
  return out;
}

function pickAll(list, opts, limit) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (!p || p.inStock === false) continue;
    if (opts.category && p.category !== opts.category) continue;
    var sizes = Array.isArray(p.sizes) ? p.sizes : [];
    var pricierOunce = ounceRowOverCap(sizes, opts.maxPrice);
    for (var j = 0; j < sizes.length; j++) {
      var price = Number(sizes[j] && sizes[j][1]);
      var grams = Number(sizes[j] && sizes[j][2]);
      if (!isFinite(price) || price <= 0) continue;
      if (!isFinite(grams) || grams < opts.minGrams) continue;
      if (opts.maxGrams && grams > opts.maxGrams) continue;
      if (price > opts.maxPrice) continue;
      /* A row that names an ounce itself stands on its own price. One relying on
         the title's inferred weight does not, when this product's real ounce is
         over the cap. */
      if (pricierOunce && !namesAnOunce(sizes[j][0])) continue;
      out.push({ product: p, index: j, price: price, perG: price / grams, key: p.id + '#' + j,
        bucket: bucketOf(p, sizes[j]) });
    }
  }
  out.sort(byDearest);
  return limit ? out.slice(0, limit) : out;
}

function pickBest(list, opts) {
  return pickAll(list, opts, 1)[0] || null;
}

function noPick(canonical, opts) {
  return page({
    title: 'No pick right now: Legal-Leaf Market',
    ogTitle: 'Legal-Leaf Market',
    ogDesc: 'Compare legal hemp prices across trusted stores by price per gram.',
    ogImage: FALLBACK_IMG,
    canonical,
    noindex: true,
    /* A pick with nothing to show is a real signal, not a non-event: it means the
       offer went out with no product behind it. */
    track: { page: 'pick', outcome: 'empty', maxPrice: opts.maxPrice },
    body: `<h1>Nothing qualifies right now</h1>
<p class="meta">No in-stock ounce under ${esc(money(opts.maxPrice))} in the feed at the moment.
Rather than show you something that is not the deal it claims to be, here is everything.</p>
<a class="buy" href="${SITE}/consumables">Compare every store</a>`,
  });
}

/* The weight is named rather than implied, because "this 1oz is trim/shake" is a
   sentence a shopper checks against what they think they are buying, where a bare
   "trim" is a word they can skim past next to a photo of buds. It names the row on
   screen, so it follows the dropdown. */
function flagText(kind, weight) {
  const w = weight || 'size';
  return kind === 'cbd'
    ? 'This ' + w + ' is CBD, non-psychoactive'
    : 'This ' + w + ' is trim/shake, not whole buds';
}

function description(p, h, flags) {
  const bits = [];
  if (h.weight) bits.push(h.weight);
  if (h.perG) bits.push(money(h.perG, p.cur) + ' per gram');
  if (p.store) bits.push('at ' + p.store);
  if (p.inStock === false) bits.push('out of stock');
  const lead = bits.join(', ');
  /* First, ahead of the price. This is the shared card's own text, so on a trim or
     CBD listing it is the line that has to arrive with the link rather than waiting
     for somebody to open the page and read a banner. */
  const notes = [];
  if (flags && flags.trim) notes.push(flagText('trim', h.weight) + '.');
  if (flags && flags.cbd) notes.push(flagText('cbd', h.weight) + '.');
  const head = notes.length ? notes.join(' ') + ' ' : '';
  return head + (lead
    ? lead + '. Compared against every other store on Legal-Leaf Market.'
    : 'Compared against every other store on Legal-Leaf Market.');
}

/* The spec table. Absent entirely when the merchant stated nothing, because a
   "Specifications" heading over one row is worse than no heading -- it reads as
   a page that failed to load the rest. */
function specTable(p) {
  const sp = specsOf(p);
  const rows = SPEC_ORDER.filter(([k]) => sp[k])
    .map(([k, label]) => `<tr><td>${esc(label)}</td><td>${esc(sp[k])}</td></tr>`);
  if (!rows.length) return '';
  return `<h2 style="font-size:13px;color:var(--muted);margin:16px 0 6px">Specifications</h2>
    <table class="lab">${rows.join('')}</table>
    <p class="fine">Taken from ${esc(p.store || 'the store')}'s own listing. We do not measure
    hardware ourselves, so anything they did not state is not shown rather than estimated.</p>`;
}

/* ---- MORE LIKE THIS: which other products are real substitutes -------------

   Ported in spirit from the sister site's rankSimilar(), and re-weighted for
   what this catalogue actually compares. There, "similar" means a gift somebody
   would like as much; here it means A PRODUCT SOMEBODY COULD BUY INSTEAD, which
   is a stricter question and the whole proposition of the site.

   FOUR SIGNALS, and the order of their weights is the argument:

     category (+3)  A grinder is not a substitute for an ounce of flower. This
                    is the only near-disqualifier; everything else is a nudge.
     price    (+3)  Scored as a RATIO, not a difference, so $40 against $80 is
                    as far apart as $400 against $800 -- which is how a budget
                    actually feels. Below 0.4 it scores nothing at all.
     name     (+3.6 max) Token overlap, capped at three words. "Blue Dream" and
                    "Blue Dream Smalls" are the same strain; one shared word is
                    weak evidence and four is not four times as strong.
     per-gram (+1)  Only where both have one. Two flower listings at a similar
                    $/g are competing for the same shopper by definition.

   A DIFFERENT SHOP IS WORTH MORE THAN THE SAME ONE, which is the inversion
   worth noticing: the sister site nudges TOWARD the same vendor, because one
   checkout beats two when you are buying gifts. This site exists to compare
   shops, so landing on six more products from the store you are already looking
   at is the least useful shelf it could draw. Same store scores nothing; a
   different one gets +0.6.

   Out of stock is excluded outright -- "here is something else you cannot buy"
   is worse than showing nothing. */
const SIM_STOP = new Set([
  'the','and','with','for','a','an','of','in','on','to','by','set','pack','new',
  'thca','thc','cbd','hemp','flower','strain','premium','indoor','exotic','top',
  'shelf','best','quality','free','shipping','sale','oz','ounce','gram','grams',
]);
function simTokens(s) {
  return String(s || '')
    .toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 2 && !SIM_STOP.has(t));
}
function priceAffinity(a, b) {
  if (!(a > 0) || !(b > 0)) return 0;
  const ratio = a > b ? b / a : a / b;
  return ratio < 0.4 ? 0 : (ratio - 0.4) / 0.6;
}
function rankSimilar(target, pool, limit = 6) {
  if (!target) return [];
  const tTok = new Set(simTokens(target.name));
  const tPrice = Number(target.sale || target.startsAt) || 0;
  const scored = [];
  for (const c of pool || []) {
    if (!c || c.id === target.id) continue;
    if (!c.image) continue;                        /* a shelf of blanks is not a shelf */
    if (c.inStock === false) continue;             /* see the note above */
    const cPrice = Number(c.sale || c.startsAt) || 0;
    if (!(cPrice > 0)) continue;

    let score = 0;
    if (c.category && c.category === target.category) score += 3;
    score += priceAffinity(tPrice, cPrice) * 3;

    let overlap = 0;
    for (const t of simTokens(c.name)) if (tTok.has(t)) overlap++;
    score += Math.min(overlap, 3) * 1.2;

    if (target.perG > 0 && c.perG > 0) score += priceAffinity(target.perG, c.perG);
    /* The inversion: a different shop is the point of this site. */
    if (c.storeKey && c.storeKey !== target.storeKey) score += 0.6;

    if (score <= 0) continue;
    scored.push({ p: c, score });
  }
  /* Tie-break on id so the same product always draws the same shelf -- this is
     rendered server side and cached, and a shelf that reshuffled per request
     would make the CDN copy differ from the next one for no reason. */
  scored.sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1));
  return scored.slice(0, limit).map((x) => x.p);
}

/* The markup for it. Every field is third-party feed text, so every field goes
   through esc() and every URL through httpsOnly() -- same rule as the rest of
   this file, and the reason it is stated again here is that this section is the
   one place a SECOND product's fields are written into the page. */
function similarSection(list) {
  if (!list || !list.length) return '';
  const cards = list.map((p) => {
    const img = httpsOnly(p.image, '');
    const price = money(Number(p.sale || p.startsAt) || 0, p.currency || 'USD');
    const perG = p.perG > 0 ? money(p.perG, p.currency || 'USD') + '/g' : '';
    return `<a class="scard" href="${esc(SITE)}/p/${encodeURIComponent(p.id)}">
      <div class="sshot">${img ? `<img src="${esc(img)}" alt="" loading="lazy"/>` : ''}</div>
      <div class="sbody">
        <div class="sname">${esc(p.name)}</div>
        <div class="sstore">${esc(p.store || '')}</div>
        <div class="sprice">${esc(price)}${perG ? ` <span class="sperg">${esc(perG)}</span>` : ''}</div>
      </div></a>`;
  }).join('');
  return `<section class="similar">
    <h2>More like this</h2>
    <div class="sgrid">${cards}</div>
  </section>`;
}

/* ---- analytics ----
 * Mirrors the LL.track block in index.html rather than inventing a second scheme:
 * same va() call, same ll_sid session id, same ll_events ring buffer. The first
 * of those is a queue with nothing reading it now: the script that drained it
 * was the previous host's own analytics, served from a path that only existed
 * there, and it left with the host (Oct 2026). The stub stays so LL.track is
 * the same function on every page; what reports is gtag and the beacon below.
 *
 * It also beacons to /api/track. On this page the whole point is that people land,
 * tap, and leave within a second or two, and a beacon survives that unload where a
 * normal fetch can be cut off. api/track.js already exists as the event sink and
 * forwards to LL_EVENTS_WEBHOOK when one is configured.
 */
function analytics(track) {
  var payload = JSON.stringify(track).replace(/</g, '\\u003c');
  return `<script>
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
window.LL = window.LL || {};
(function () {
  function sid() {
    try {
      var k = 'll_sid', s = sessionStorage.getItem(k);
      if (!s) { s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem(k, s); }
      return s;
    } catch (e) { return ''; }
  }
  var BASE = ${payload};
  // Whatever brought them here: the DM link's own tags, if it carried any.
  try {
    var q = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
      var v = q.get(k); if (v) BASE[k.replace('utm_', '')] = v;
    });
  } catch (e) {}
  LL.track = function (name, props) {
    props = Object.assign({}, BASE, props || {});
    props.sid = sid();
    try { if (typeof window.va === 'function') va('event', Object.assign({ name: name }, props)); } catch (e) {}
    try { if (typeof window.gtag === 'function') gtag('event', name, props); } catch (e) {}
    try {
      var k = 'll_events', a = JSON.parse(localStorage.getItem(k) || '[]');
      a.push({ t: Date.now(), name: name, props: props });
      if (a.length > 250) a = a.slice(-250);
      localStorage.setItem(k, JSON.stringify(a));
    } catch (e) {}
    try {
      var body = JSON.stringify({ name: name, props: props, ts: Date.now() });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      else fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  };
})();
window.addEventListener('load', function () { try { LL.track('page_view', {}); } catch (e) {} });
<\/script>`;
}

/* ---- the back of the card ----
 *
 * This repo is deliberately strict about not claiming a lab test it cannot prove:
 * attachLab() refuses to attach numbers from a sheet shared across strains, and
 * tagCoaScope() exists because printing "lab-tested" on a link to a store's
 * results directory was a measured false-specificity bug. So this panel follows
 * the same rules: the badge needs p.labTested or coaScope 'product', the COA link
 * is worded from what the document actually is, and every field is omitted when
 * absent rather than rendered as a zero or a dash. coa-data.js says outright:
 * never assume a field exists.
 */
/* "1 oz" and "1oz" are the same fact twice. Compare on alphanumerics only, so a
   row already labelled with its weight does not render "1 oz - 1oz - $39". */
function saysWeightAlready(variant, label) {
  const n = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const v = n(variant), l = n(label);
  return !!l && !!v && v.indexOf(l) !== -1;
}

function pct(v) {
  return typeof v === 'number' && isFinite(v) ? (Math.round(v * 100) / 100) + '%' : '';
}

const FLAG_WORDS = {
  coa_stale: 'the certificate is not recent',
  safety_not_pass: 'the safety panel is not marked pass on the certificate',
  coa_page_1_only: 'only the first page of the certificate was read',
};

function coaLine(p) {
  const url = httpsOnly(p.coa);
  if (!url) return '';
  const scope = p.coaScope;
  const label = scope === 'product'
    ? "View this product's certificate"
    : scope === 'store'
      ? "View the store's shared compliance sheet"
      : "Browse the store's lab results page";
  const note = scope === 'product'
    ? ''
    : scope === 'store'
      ? ' This one sheet covers several of their products, so it is not specific to this batch.'
      : ' That is a directory of results, not this batch\'s certificate.';
  return `<tr><td>Certificate</td><td><a href="${esc(url)}" rel="nofollow noopener" target="_blank">${esc(label)}</a>${esc(note)}</td></tr>`;
}

function labPanel(p) {
  const d = p.lab && typeof p.lab === 'object' ? p.lab : null;
  const tested = p.labTested === true || p.coaScope === 'product';
  const rows = [];

  if (d) {
    /* totalThc is the decarboxylated figure, which coa-data.js calls the number a
       buyer actually gets, so it leads. */
    if (pct(d.totalThc)) rows.push(`<tr><td>Total THC</td><td><span class="big">${esc(pct(d.totalThc))}</span></td></tr>`);
    if (pct(d.thca)) rows.push(`<tr><td>THCa</td><td>${esc(pct(d.thca))}</td></tr>`);
    if (pct(d.d9)) rows.push(`<tr><td>Delta-9</td><td>${esc(pct(d.d9))}</td></tr>`);
    if (pct(d.cbd)) rows.push(`<tr><td>CBD</td><td>${esc(pct(d.cbd))}</td></tr>`);
    if (pct(d.total)) rows.push(`<tr><td>Total cannabinoids</td><td>${esc(pct(d.total))}</td></tr>`);
    if (Array.isArray(d.minors) && d.minors.length) {
      const bits = d.minors.slice(0, 5)
        .filter((m) => Array.isArray(m) && m[0])
        .map((m) => m[0] + ' ' + (pct(m[1]) || '')).join(', ');
      if (bits) rows.push(`<tr><td>Minors</td><td>${esc(bits.trim())}</td></tr>`);
    }
    if (d.lab) rows.push(`<tr><td>Lab</td><td>${esc(d.lab)}</td></tr>`);
    if (d.tested) rows.push(`<tr><td>Tested</td><td>${esc(d.tested)}</td></tr>`);
    if (d.sample) rows.push(`<tr><td>Sample</td><td>${esc(d.sample)}</td></tr>`);
  } else if (typeof p.potency === 'number' && p.potency > 0) {
    /* No certificate matched, so this is the store's own claim and is labelled as
       one rather than dressed up as a measurement. */
    rows.push(`<tr><td>Listed potency</td><td>${esc(pct(p.potency))} <span style="color:var(--muted)">as stated by the store, not from a certificate we have read</span></td></tr>`);
  }

  const kind = [p.cannabinoid, p.type, p.grow].filter(Boolean).join(' · ');
  if (kind) rows.push(`<tr><td>Type</td><td>${esc(kind)}</td></tr>`);
  const coa = coaLine(p);
  if (coa) rows.push(coa);

  const tags = [];
  if (tested) tags.push('<span class="tag ok">lab tested</span>');
  if (d && typeof d.trust === 'number') tags.push(`<span class="tag">certificate confidence ${esc(String(d.trust))}/100</span>`);

  let caution = '';
  if (d && Array.isArray(d.flags) && d.flags.length) {
    const worded = d.flags.map((f) => FLAG_WORDS[f] || String(f).replace(/_/g, ' '));
    caution = `<p class="caution">Worth knowing: ${esc(worded.join('; '))}.</p>`;
  }
  if (!d && !tested) {
    caution = '<p class="caution">No certificate has been matched to this product, so there are no measured numbers to show. That is a gap in what the store published, not a claim either way about the batch.</p>';
  }

  return (tags.length ? '<div>' + tags.join('') + '</div>' : '') +
    caution +
    (rows.length ? `<table class="lab">${rows.join('')}</table>` : '');
}

function page({ title, ogTitle, ogDesc, ogImage, canonical, body, noindex, track }) {
  /* Falling back to the site image rather than emitting a bare og:image: a card with
     the wrong picture still renders, a card with an unfetchable one renders as a
     link. */
  const shot = ogImageMeta(ogImage) || ogImageMeta(FALLBACK_IMG);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<link rel="icon" href="${FAVICON_URI}"/>
<link rel="canonical" href="${esc(canonical)}"/>
${noindex ? '<meta name="robots" content="noindex"/>' : ''}
<meta name="description" content="${esc(ogDesc)}"/>
<meta property="og:type" content="product"/>
<meta property="og:site_name" content="Legal-Leaf Market"/>
<meta property="og:locale" content="en_US"/>
<meta property="og:url" content="${esc(canonical)}"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="${esc(shot.url)}"/>
<meta property="og:image:secure_url" content="${esc(shot.url)}"/>${shot.type ? `
<meta property="og:image:type" content="${esc(shot.type)}"/>` : ''}${shot.w ? `
<meta property="og:image:width" content="${shot.w}"/>
<meta property="og:image:height" content="${shot.h}"/>` : ''}
<meta property="og:image:alt" content="${esc(ogTitle)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(ogTitle)}"/>
<meta name="twitter:description" content="${esc(ogDesc)}"/>
<meta name="twitter:image" content="${esc(shot.url)}"/>
<meta name="twitter:image:alt" content="${esc(ogTitle)}"/>
<style>
/* THE SITE'S OWN PALETTE, AND THIS PAGE WAS THE LAST ONE STILL PAINTED GREEN.
   It shipped white-by-default with an accent in the leaf green the rest of the
   site was recoloured away from -- so following a card from a cold blue shelf
   landed on a bright page in another brand's colours. The old value is
   deliberately NOT quoted here: this comment ships inside the stylesheet, and a
   by-hue "is this page still green" check reads a hex in prose exactly as it
   reads one in a rule. test-library-style.mjs has been fooled that way before. Same fault
   /greekglass had and the same fix: the family values, stated once.
   Dark-first now, because every other page on this site is. */
:root{color-scheme:dark;--bg:#080f14;--fg:#eaf2f6;--muted:#9fb4c2;--dim:#7d94a2;
  --line:#22303a;--accent:#4ec9ff;--accent-dk:#1787c4;--gold:#f0b93c;
  --panel:rgba(16,27,35,.72);--glass-line:rgba(120,180,215,.22);--chip:#15242e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
/* A PAGE, NOT A CARD. 640px was the width of one flip card on a phone; a
   product page has two columns on a laptop and one on a phone. */
.wrap{max-width:1080px;margin:0 auto;padding:18px 18px 56px}
.crumb{font-size:13px;font-weight:700;color:var(--dim);margin:0 0 14px}
.crumb a{color:var(--muted);text-decoration:none}
.crumb a:hover{color:var(--accent);text-decoration:underline}
.crumb span{margin:0 7px;opacity:.6}
.pgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:start}
@media (max-width:820px){.pgrid{grid-template-columns:1fr;gap:20px}}
/* THE PHOTO KEEPS ITS OWN BOX so a late image cannot shift the column, which is
   the one thing the flip card genuinely got right and is worth carrying over. */
.shotwrap{position:relative;aspect-ratio:1/1;border-radius:16px;overflow:hidden;
  border:1px solid var(--glass-line);background:#0d1720}
/* THE PHOTO STAYS WITH THE READING. A square photo beside a details column that
   runs to the lab panel leaves half a screen of nothing on the left, and the
   thing a shopper most wants while reading the numbers is the picture of what
   the numbers are about. Sticky only where there are two columns -- on a phone
   the photo is above the text and pinning it would eat the screen. */
@media (min-width:821px){ .shotwrap{position:sticky;top:18px} }
.detail{display:flex;flex-direction:column;gap:11px;min-width:0}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
.chips span{font-size:11px;font-weight:800;letter-spacing:.04em;padding:5px 10px;border-radius:999px;
  background:var(--chip);color:var(--muted);border:1px solid var(--glass-line)}
a{color:inherit}
.shot{width:100%;height:100%;object-fit:cover;display:block}

/* THE FLIP IS GONE, AND THAT IS THE POINT OF THIS REBUILD.

   What used to be here was a card: one box, two faces, the photo on the front
   and every fact hidden behind a turn. It was built to be shared into a DM,
   where a card is exactly right -- somebody taps a link and gets an object.

   As a PRODUCT PAGE it is the wrong shape, and the owner said so: a page should
   explain, not conceal. Everything the back held is simply on the page now,
   beside the photo, readable without a gesture and scrolled like any other
   document. The flip machinery that went with it -- measuring the back's
   height, sizing the container to the face on show, fading the overlay pills
   through the turn, keeping two copies of the trim banner because one would
   render mirrored -- is gone too, because none of it was about the product.

   WHAT SURVIVES IS EVERYTHING THAT WAS NEVER ABOUT THE CARD: the og: tags, the
   size picker and its variant thumbnail, the lab panel, the COA line, the cart
   item, /p/pick's slide nav, and every esc() on every field. Those were hard
   won and none of them cared what shape the page was. */
.shot{width:100%;height:100%;object-fit:cover;display:block}

/* Overlay controls still sit on the photo, because they still cost no vertical
   space there. They are /p/pick's slide nav only now -- the flip button they
   used to sit beside has nothing left to do. */
.ov{position:absolute;z-index:2;border:none;cursor:pointer;font:inherit;font-weight:700;
  border-radius:999px;padding:9px 14px;color:#fff;background:rgba(8,15,20,.66);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);line-height:1}
.ov:hover{background:rgba(8,15,20,.82)}

.tsb{background:#a3261a;color:#fff;font-weight:800;font-size:13px;line-height:1.3;
  letter-spacing:.04em;text-transform:uppercase;text-align:center;padding:10px 12px;
  backface-visibility:hidden;-webkit-backface-visibility:hidden}
/* CBD is information, not a warning about getting less than was advertised, so it
   is blue rather than red. Both keep white text on a solid fill. */
.tsb.cbd{background:#12558f}
.shotwrap .tsbwrap{position:absolute;z-index:3;top:0;left:0;right:0;
  display:flex;flex-direction:column;gap:2px;transition:opacity .2s ease}
/* On the back they are blocks at the top of the panel rather than overlays, so they
   sit above the size dropdown: the banner and the choice it qualifies are read in
   that order. */
/* The spacing hangs off each BAR rather than the wrapper, so a listing with no
   banners carries no gap where they would have been: a hidden child contributes
   nothing, while a wrapper margin would survive both of them being hidden. */
.detail .tsbwrap{display:flex;flex-direction:column}
.detail .tsb{border-radius:10px;padding:11px 12px;margin:0 0 10px}

/* Slideshow arrows and position, on the photo so they cost no vertical space. */
.ov.nav{top:50%;transform:translateY(-50%);font-size:24px;padding:6px 14px;line-height:1}
.ov.nav.prev{left:10px}
.ov.nav.next{right:10px}
.ov.count{bottom:14px;left:12px;font-size:12px;font-weight:700;padding:7px 11px;cursor:default}

/* Getting back to the photo has to be obvious, so it is a real button and there is
   one at each end of the back panel. */

/* Back panel */
.lab{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 10px}
.lab td{padding:4px 0;border-bottom:1px solid var(--line);vertical-align:top}
.lab td:first-child{color:var(--muted);padding-right:10px;white-space:nowrap}
.lab tr:last-child td{border-bottom:none}
.big{font-size:26px;font-weight:800;line-height:1.1}
.tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  padding:3px 7px;border-radius:5px;background:var(--line);color:var(--muted);margin:0 4px 4px 0}
.tag.ok{background:var(--accent);color:#fff}
.caution{font-size:13px;color:var(--muted);margin:0 0 10px}
.pickfield{margin:12px 0 4px}
.pickfield label{display:block;font-size:13px;font-weight:700;margin-bottom:5px}
select{width:100%;font:inherit;padding:11px;border-radius:9px;border:1px solid var(--line);
  background:var(--bg);color:var(--fg)}
select.needs{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent);
  animation:glow 1.1s ease-in-out 3}
@keyframes glow{0%,100%{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 20%,transparent)}
  50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 55%,transparent)}}
@media (prefers-reduced-motion:reduce){select.needs{animation:none}}
/* The variant's photo, on the BACK beside the dropdown. The card's big photo is on
   the other face, so swapping only that one is invisible at the exact moment the
   shopper is choosing. This is the confirmation that the thing they picked is the
   thing they were looking at. */
.vshot{display:flex;align-items:center;gap:10px;margin:9px 0 0}
/* An author display rule outranks the UA sheet's [hidden]{display:none}, so without
   this the empty thumbnail box shows before anything has been chosen. */
.vshot[hidden]{display:none}
.vshot img{width:56px;height:56px;flex:0 0 56px;object-fit:cover;border-radius:9px;
  border:1px solid var(--line);background:var(--bg)}
.vshot span{font-size:12px;color:var(--muted);line-height:1.35}
@media (prefers-reduced-motion:no-preference){.vshot img{transition:opacity .18s ease}}
.hint{font-size:13px;color:var(--muted);margin:8px 0 0;min-height:18px}
.hint.warn{color:var(--accent);font-weight:600}
h1{font-size:22px;line-height:1.25;margin:18px 0 6px}
.price{font-size:28px;font-weight:800;margin:10px 0 2px}
.meta{color:var(--muted);font-size:15px;margin:0 0 18px}
.buy{display:block;width:100%;text-align:center;background:var(--accent);color:#fff;text-decoration:none;font:inherit;font-weight:700;padding:15px;border:none;border-radius:10px;margin:0 0 10px;cursor:pointer}
.buy:disabled{opacity:.7;cursor:default}
.alt{display:block;text-align:center;text-decoration:none;font-weight:600;padding:13px;border-radius:10px;border:1px solid var(--line);margin:0 0 10px}
.fine{color:var(--muted);font-size:13px;margin-top:22px;border-top:1px solid var(--line);padding-top:14px}
/* ---- MORE LIKE THIS -------------------------------------------------------
   The half of a product page that turns a dead end into a shelf. Landing here
   from a DM or a card used to offer exactly two moves: buy, or leave. */
.similar{margin:40px 0 0}
.similar h2{font-size:18px;margin:0 0 12px}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.scard{display:block;text-decoration:none;color:inherit;border:1px solid var(--glass-line);
  border-radius:14px;overflow:hidden;background:var(--panel);transition:border-color .14s,transform .12s}
.scard:hover{border-color:var(--accent);transform:translateY(-2px)}
.sshot{aspect-ratio:1/1;background:#0d1720;overflow:hidden}
.sshot img{width:100%;height:100%;object-fit:cover;display:block}
.sbody{padding:9px 10px 11px}
.sname{font-size:12.5px;line-height:1.35;font-weight:600;color:var(--fg);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}
.sstore{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--dim);margin-top:5px}
.sprice{font-size:15px;font-weight:900;color:var(--accent);margin-top:4px}
.sperg{font-size:11px;color:var(--muted);font-weight:700}

/* ---- THE THREAD. Somebody's opinion under a page of measured facts, so it is
   quoted rather than boxed and never dressed to look like another one. ------ */
.thread{margin:34px 0 0;scroll-margin-top:18px}
.thread h2{font-size:18px;margin:0 0 4px}
.thread .tnote{font-size:12px;color:var(--dim);margin:0 0 14px}
.cmt{border-top:1px solid var(--glass-line);padding:12px 0}
.cmt:first-of-type{border-top:0}
.cmt .who{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}
.cmt .who b{color:var(--gold);font-weight:900}
.cmt .when{color:var(--dim);font-weight:600;letter-spacing:0;text-transform:none}
.cmt p{margin:6px 0 0;font-size:14px;line-height:1.6;color:var(--fg)}
.cmt.none{color:var(--muted);font-size:14px;border:0;padding:4px 0 0}
.cform{margin-top:18px;border-top:1px solid var(--glass-line);padding-top:16px;display:flex;
  flex-direction:column;gap:9px;max-width:560px}
.cform input,.cform textarea{font:inherit;font-size:14px;padding:10px 12px;border-radius:10px;
  background:var(--chip);color:var(--fg);border:1px solid var(--glass-line);width:100%}
.cform textarea{min-height:96px;resize:vertical}
.cform button{font:inherit;font-size:14px;font-weight:800;padding:11px 16px;border-radius:12px;
  border:0;cursor:pointer;background:linear-gradient(90deg,var(--accent-dk),var(--accent));
  color:#04202b;align-self:flex-start}
.cform button:disabled{opacity:.55;cursor:default}
.cform .cmsg{font-size:12.5px;color:var(--muted);margin:0}
.cform .cmsg.bad{color:#ef9a9a}
.cform .cmsg.good{color:var(--accent)}
</style>
</head>
<body><div class="wrap">
${body}
</div>
${analytics(track || { page: 'share' })}
</body>
</html>`;
}

function notFound(canonical) {
  return page({
    title: 'Product not found: Legal-Leaf Market',
    ogTitle: 'Legal-Leaf Market',
    ogDesc: 'Compare legal hemp prices across trusted stores by price per gram.',
    ogImage: FALLBACK_IMG,
    canonical,
    noindex: true,
    track: { page: 'share', outcome: 'not_found' },
    body: `<h1>That product is gone</h1>
<p class="meta">Stock moves and listings disappear. The comparison is still live.</p>
<a class="buy" href="${SITE}/consumables">Browse every store</a>`,
  });
}

export default async function handler(req, res) {
  const rawId = String((req.query && req.query.id) || '').trim();
  const rawSize = (req.query && req.query.s) != null ? parseInt(req.query.s, 10) : NaN;
  const sizeIndex = Number.isInteger(rawSize) && rawSize >= 0 ? rawSize : null;
  const canonical = SITE + '/p/' + encodeURIComponent(rawId);

  // A crawler must never be handed a stale-forever card, and must never be made
  // to wait on a cold scrape either. Ten minutes at the edge with a long
  // stale-while-revalidate is the compromise.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');

  if (!rawId) return res.status(404).send(notFound(canonical));

  /* A price cap and a minimum weight, both overridable, so the same route can
     answer "an ounce under $50" or "a quarter under $25" later without a second
     endpoint. The cap is a budget the pick spends, not just a ceiling it stays
     under, so moving ?max= moves the advertised price with it. */
  const isPick = rawId.toLowerCase() === 'pick';
  const pickOpts = {
    maxPrice: Number(req.query && req.query.max) > 0 ? Number(req.query.max) : 50,
    /* A full ounce is 28g and stores label it 28 to 31.5. The floor was 25, which
       admitted a short row and still called the offer an ounce; it is now a true
       ounce. The ceiling keeps a half (14g) out below and two ounces (56g) out
       above. */
    minGrams: Number(req.query && req.query.g) > 0 ? Number(req.query.g) : 28,
    maxGrams: Number(req.query && req.query.gmax) > 0 ? Number(req.query.gmax) : 31.5,
    /* ?category=any drops the filter, which is the first thing to try if the pick
       comes up empty: the classifier may label an ounce as something else. */
    category: (function (c) {
      if (!c) return 'THCA Flower';
      return String(c).toLowerCase() === 'any' ? null : String(c);
    })(req.query && req.query.category),
  };

  let product = null;
  let chosenIndex = sizeIndex;
  let rank = 0;
  let pool = 0;
  let candidates = [];
  /* Hoisted so "More like this" can be ranked at render time. `list` below is
     scoped to the fetch's own success branch, and the shelf is drawn well after
     it -- reading it there was a ReferenceError waiting for the first request
     that got past the feed. */
  let catalogue = [];
  try {
    // Same origin, so this rides the CDN cache /api/products already populates
    // instead of triggering another twenty-store scrape.
    const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'legal-leafmarket.com';
    const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    const r = await fetch(`${proto}://${host}/api/products`, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const data = await r.json();
      const list = Array.isArray(data && data.products) ? data.products : [];
      catalogue = list;
      if (isPick) {
        /* composePool does the deduping, per bucket rather than globally: one slide
           per listing first, and a THCa listing repeated with a different row only
           once the distinct ones run out. A listing selling both buds and trim can
           appear in both buckets, once with each row advertised, since those are two
           different offers and each slide's dropdown still holds the rest. */
        candidates = composePool(pickAll(list, pickOpts));
        /* THE LEAD IS ALWAYS A THCa WHOLE-FLOWER ROW, OR THERE IS NO PICK.
           POOL_MIX runs thca -> trim -> cbd and composePool concatenates in that
           order, so slide one is already a THCa row whenever the THCa bucket has
           anything in it. This is the case where it does not: with no qualifying THCa
           ounce the pool silently slid down to the next bucket and /p/pick opened on a
           CBD flower, under a route whose entire pitch is a $50 THCa ounce. A CBD
           ounce is real inventory and keeps its slide; it is not the thing this page
           opens with, and trim is not "whole flower" either.
           Emptying the pool here hands the request to noPick(), which answers 200 with
           an honest "nothing qualifies" rather than a 404 or a substitute. */
        if (candidates.length && candidates[0].bucket !== 'thca') candidates = [];
        pool = candidates.length;
        const wanted = parseInt(req.query && req.query.i, 10);
        rank = Number.isInteger(wanted) && wanted > 0 ? Math.min(wanted, pool - 1) : 0;
        const chosen = candidates[rank];
        if (chosen) { product = chosen.product; chosenIndex = chosen.index; }
      } else {
        product = list.find((p) => p && p.id === rawId) || null;
      }
    }
  } catch {
    product = null;
  }

  if (!product) {
    /* A pick that found nothing is not a broken link, it is an honest "nothing
       qualifies", so it answers 200 with a real page rather than a 404. */
    return isPick
      ? res.status(200).send(noPick(canonical, pickOpts))
      : res.status(404).send(notFound(canonical));
  }

  /* ---- one slide ----
   * Everything the page shows for a single product, built server side so the
   * slideshow can swap slides without another round trip and without duplicating
   * the lab panel's honesty rules in the client. */
  /* `limit` carries the pick's own constraints when this is a pick slide. Without
     it the dropdown offered EVERY priced row of the product, so a page advertising
     an ounce under $50 happily let a quarter pound at $175 be selected and added:
     the product qualified, the row did not, and nothing downstream re-checked.
     A plain /p/<id> share passes no limit, because there the page makes no claim
     about weight or budget and a product's real sizes are the honest thing to
     show. */
  function buildSlide(prod, rowIndex, marked, limit) {
    const cur = prod.cur || 'USD';
    const head = rowIndex != null && Array.isArray(prod.sizes) && prod.sizes[rowIndex]
      ? (function (row) {
          const g = Number(row[2]);
          return {
            price: Number(row[1]),
            weight: weightLabel(g) || String(row[0] || ''),
            perG: g > 0 ? Math.round((Number(row[1]) / g) * 100) / 100 : prod.perG,
          };
        })(prod.sizes[rowIndex])
      : headline(prod);

    const priced = (Array.isArray(prod.sizes) ? prod.sizes : [])
      .filter((row) => isFinite(Number(row && row[1])) && Number(row[1]) > 0);
    const rows = (Array.isArray(prod.sizes) ? prod.sizes : [])
      .map((row, i) => ({ i, row }))
      .filter(({ row }) => isFinite(Number(row && row[1])) && Number(row[1]) > 0)
      .filter(({ row, i }) => {
        if (!limit) return true;
        /* The row the pick actually chose always survives, so the advertised deal
           can never be filtered off its own page by a rounding edge. */
        if (i === rowIndex) return true;
        const price = Number(row[1]);
        const grams = Number(row[2]);
        if (price > limit.maxPrice) return false;
        if (!isFinite(grams) || grams < limit.minGrams) return false;
        if (limit.maxGrams && grams > limit.maxGrams) return false;
        return true;
      })

      .map(({ i, row }) => {
        const price = Number(row[1]);
        const grams = Number(row[2]);
        /* The row's own label, which on multi-strain listings is the strain and
           grade. It is the only thing distinguishing one row from another, so it
           leads and the normalised weight follows only when not already stated. */
        const variant = String(row[0] || '').trim();
        const label = weightLabel(grams) || String(row[0] || 'One size');
        return {
          i,
          label,
          display: variant
            ? (saysWeightAlready(variant, label) ? variant : variant + ' · ' + label)
            : label,
          price,
          perG: grams > 0 ? Math.round((price / grams) * 100) / 100 : null,
          isPick: marked && i === rowIndex,
          /* Per row, because a listing can sell whole buds and trim side by side.
             The banner follows the dropdown for exactly that case.

             Slot 7 is the feed's own answer for this row, decided at scrape time from
             the same word-boundary test. It is preferred where present because the
             scraper sees the store's category and description as well as the label:
             a row called "Ounce" under a listing the store files as shake is trim,
             and nothing in the label says so. The label test stays as the fallback
             for feeds that predate the flag. */
          trim: row[7] != null ? !!row[7] : isTrimShake(variant),
          /* The variant's own photo, row[6] in the feed (Shopify's
             variant.featured_image, plus any admin override). 35% of live size rows
             carry one and 460 listings give each variant a DIFFERENT one, which is
             exactly the multi-strain case where the product photo is the wrong
             picture for the row being bought. Same httpsOnly gate as the product
             image, since it comes from the same third-party feed. */
          img: httpsOnly(row[6], ''),
          item: cartItem(prod, i),
        };
      });

    /* A product can carry a headline price with no priced size rows at all.
       headline() falls back to sale/startsAt, so the page would show a price the
       gate could never let anyone add. The site's own addToCart covers that case
       with a "One Size" line, so offer exactly that. Raised on PR #23. */
    if (!rows.length && Number(head.price) > 0 &&
        !(limit && Number(head.price) > limit.maxPrice)) {
      rows.push({
        i: -1,
        label: head.weight || 'One size',
        display: head.weight || 'One size',
        price: Number(head.price),
        perG: head.perG || null,
        isPick: false,
        /* This row is synthesised from a weight, not a strain label, so it can
           carry no trim wording of its own. The product name still speaks for it. */
        trim: false,
        item: cartItem(prod, null),
      });
    }

    /* When the pick's constraints hide some of a product's real sizes, say so.
       Otherwise a single-option dropdown reads like a bug rather than a budget. */
    const hiddenCount = limit ? priced.length - rows.length : 0;
    const limitNote = hiddenCount > 0
      ? hiddenCount + (hiddenCount === 1 ? ' other size' : ' other sizes') +
        ' this store sells ' + (hiddenCount === 1 ? 'is' : 'are') + ' not shown here: ' +
        'this page is the ounce under ' + money(limit.maxPrice, cur) + '.'
      : '';

    const priceText = head.price != null ? money(head.price, cur) : '';
    /* The photo shown, and shared, is the CHOSEN row's own where the store gave it
       one: this page advertises a specific row at a specific price, so the product's
       lead photo is the wrong picture whenever the variant has its own. baseImg is
       kept alongside it as the fallback for rows that carry none, so switching to
       one of those returns to the product photo instead of leaving the previous
       variant's picture on screen. */
    const baseImg = httpsOnly(prod.image, FALLBACK_IMG);
    const headRow = rows.find((r) => r.i === rowIndex);
    /* Two flags, not one. trimProd is the whole listing, so it holds whatever row
       is chosen; trim is the state to show right now, which before a choice is
       made means the row this page is advertising. */
    const trimProd = isTrimProduct(prod);
    /* Product-level only, since a cannabinoid is a property of the plant and not of
       the size somebody buys. It does not follow the dropdown the way trim does. */
    const cbd = String(prod.cannabinoid || 'THCa') === 'CBD';
    const trimNow = trimProd || !!(headRow && headRow.trim);
    return {
      pid: prod.id,
      name: String(prod.name || ''),
      store: String(prod.store || ''),
      /* The three facts the page prints as chips and the breadcrumb. They were
         never on the card, which had no room for them and no breadcrumb to put
         one in. */
      cat: String(prod.category || ''),
      cann: String(prod.cannabinoid || ''),
      type: String(prod.type || ''),
      img: (headRow && headRow.img) || baseImg,
      baseImg,
      priceText,
      weight: head.weight || '',
      perG: head.perG || null,
      trimProd,
      trim: trimNow,
      cbd,
      desc: description(prod, head, { trim: trimNow, cbd }),
      ogTitle: priceText
        ? `${prod.name} ${head.weight ? '(' + head.weight + ') ' : ''}${priceText}`
        : String(prod.name || 'Legal-Leaf Market'),
      lab: labPanel(prod),
      sizes: rows,
      limitNote,
      canAdd: rows.length > 0,
      cur,
      size: rows.length ? (rows.find((r) => r.isPick) || rows[0]).item.size : '',
      value: head.price != null ? Number(head.price) : null,
    };
  }

  /* The pick is a slideshow over the qualifying pool; a plain /p/<id> is a single
     slide with no controls. */
  const slides = isPick && candidates.length
    ? candidates.map((c) => buildSlide(c.product, c.index, true, pickOpts))
    : [buildSlide(product, chosenIndex, false)];
  const slide = slides[isPick ? rank : 0] || slides[0];
  const total = slides.length;

  /* SIX SUBSTITUTES, RANKED. Drawn from the same catalogue the handler already
     fetched, so this costs no request -- the shelf is the reason to have a page
     rather than a card, and it must not be the reason the page is slow.

     On /p/pick the target is whichever slide is showing, and the shelf is NOT
     re-drawn as the shopper pages through: the section is rendered once, server
     side, for the slide the URL asked for. Re-ranking per slide client-side
     would mean shipping the whole catalogue to the browser to do it. */
  const similar = rankSimilar(
    isPick && candidates.length ? candidates[rank].product : product,
    catalogue,
    6,
  );

  const optionsFor = (sl) => sl.sizes.map((r) => {
    const bits = [r.display, money(r.price, sl.cur)];
    if (r.perG) bits.push(money(r.perG, sl.cur) + '/g');
    if (r.isPick) bits.push('this week\'s pick');
    return `<option value="${r.i}">${esc(bits.join(' · '))}</option>`;
  }).join('');

  const payload = JSON.stringify({
    slides: slides.map((sl) => ({
      pid: sl.pid, name: sl.name, store: sl.store, img: sl.img, baseImg: sl.baseImg,
      priceText: sl.priceText,
      weight: sl.weight, perG: sl.perG, desc: sl.desc, lab: sl.lab, cur: sl.cur,
      canAdd: sl.canAdd, value: sl.value, limitNote: sl.limitNote,
      /* Both, because the client needs to tell "this whole listing is trim" from
         "the row being advertised is", and only the first survives a change of
         size. */
      trim: sl.trim, trimProd: sl.trimProd, cbd: sl.cbd,
      sizes: sl.sizes.map((r) => ({
        i: r.i, label: r.label, display: r.display, price: r.price, perG: r.perG,
        isPick: r.isPick, img: r.img, item: r.item, trim: r.trim,
      })),
    })),
    start: isPick ? rank : 0,
    isPick,
  }).replace(/</g, '\\u003c');

  const ogTitle = slide.ogTitle;
  const ogDesc = slide.desc;
  const img = slide.img;

  /* THE PAGE. Two columns on a laptop, one on a phone, and nothing hidden.

     The order down the details column is the order a shopper decides in: who
     sells it, what it is, what it costs, what it is like, what size, then buy,
     then the lab numbers that justify the price, then the small print. The old
     card put the middle four behind a turn. */
  const crumbCat = slide.cat || '';
  const body = `<nav class="crumb">
  <a href="${esc(SITE)}/" id="llBack" data-home="1">Legal-Leaf Market</a>${crumbCat ? `<span>&rsaquo;</span>${esc(crumbCat)}` : ''}
</nav>
<script>
/* See shelfPaths() in api/share.js for why this is a back rather than a home. */
(function(){
  var SHELF = ${JSON.stringify(shelfPaths())};
  var a = document.getElementById("llBack");
  if (!a) return;
  var from = null;
  try {
    if (document.referrer) {
      var u = new URL(document.referrer);
      if (u.origin === location.origin && Object.prototype.hasOwnProperty.call(SHELF, u.pathname)) from = u.pathname;
    }
  } catch (e) {}
  if (!from) return;                       /* arrived from a search engine or nowhere: home is right */

  a.href = from;
  a.removeAttribute("data-home");
  a.textContent = "\u2039 Back to " + (from === "/" ? "the shelf" : SHELF[from]);
  a.addEventListener("click", function(e){
    /* The modifiers keep meaning what they mean everywhere else on the web; a
       synthetic navigation would silently take that away. */
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    /* Only when there is actually an entry to go back to. history.length is 1
       for a tab whose first page is this one, and back() there does nothing at
       all -- the link has to win instead of the click being swallowed. */
    if (history.length > 1) { e.preventDefault(); history.back(); }
  });
})();
</script>
<div class="pgrid">
  <div class="shotwrap">
    <img class="shot" id="shot" src="${esc(img)}" alt="${esc(slide.name)}"/>
    <div class="tsbwrap">
      <div class="tsb" id="tsbF"${slide.trim ? '' : ' hidden'}>${esc(flagText('trim', slide.weight))}</div>
      <div class="tsb cbd" id="cbdF"${slide.cbd ? '' : ' hidden'}>${esc(flagText('cbd', slide.weight))}</div>
    </div>
    ${total > 1 ? `<button class="ov nav prev" id="prev" type="button" aria-label="Previous">&#8249;</button>
    <button class="ov nav next" id="next" type="button" aria-label="Next">&#8250;</button>
    <span class="ov count" id="count">${(isPick ? rank : 0) + 1} of ${total}</span>` : ''}
  </div>

  <div class="detail">
    <div class="eyebrow">${esc(slide.store)}</div>
    <h1 id="pname">${esc(slide.name)}</h1>
    <div class="price" id="price">${esc(slide.priceText)}${slide.weight ? ' <span class="meta">' + esc(slide.weight) + '</span>' : ''}</div>
    <p class="meta" id="pdesc">${esc(slide.desc)}</p>

    <div id="pickwrap">
      ${slide.canAdd ? `<div class="pickfield">
        <label for="size">Choose your size</label>
        <select id="size">
          <option value="">Select a size...</option>
          ${optionsFor(slide)}
        </select>
        <!-- No src attribute until something is chosen. An empty one resolves to
             the page's own URL, so the browser re-requests this page as an image:
             a second render of the pick for every view of it. -->
        <div class="vshot" id="vshot" hidden>
          <img id="vimg" alt=""/>
          <span id="vcap"></span>
        </div>
        <p class="hint" id="hint2">The price updates once you choose.</p>
        <p class="caution" id="limitnote"${slide.limitNote ? '' : ' hidden'}>${esc(slide.limitNote)}</p>
      </div>` : `<p class="caution">This store has not published a buyable size for this
      product, so it cannot be added to a cart here. The comparison below still has it.</p>`}
    </div>

    <button class="buy" id="add" type="button"${slide.canAdd ? '' : ' hidden'}>Add to cart</button>
    <p class="hint" id="hint">${slide.canAdd
      ? 'Pick a size to see its price per gram.'
      : 'The lab numbers are below.'}</p>

    <div class="detail-tsb tsbwrap">
      <div class="tsb" id="tsbB" hidden></div>
      <div class="tsb cbd" id="cbdB" hidden></div>
    </div>

    ${specTable(isPick && candidates.length ? candidates[rank].product : product)}

    <h2 style="font-size:13px;color:var(--muted);margin:16px 0 6px">What the lab found</h2>
    <div id="labwrap">${slide.lab}</div>

    <div class="chips">${[slide.cat, slide.cann, slide.type].filter(Boolean)
      .map((t) => `<span>${esc(t)}</span>`).join('')}</div>

    <a class="alt" href="${esc(SITE)}/consumables">Compare every store on Legal-Leaf Market</a>
    <p class="fine" id="fine">Price and stock come from ${esc(slide.store)}'s own feed and can move without notice.
    Legal-Leaf Market does not take the order or hold the stock. Ranking is never affected by commission.</p>
    <!-- THE DISCLOSURE, WORD FOR WORD AS THE SHELF STATES IT.
         The line above says ranking is never affected by commission, which is a
         claim about INTEGRITY and is not the same statement -- somebody can read
         it and still not know we are paid at all. The FTC asks for the second
         one, near the link, and this page's entire purpose is to hand a shopper
         an affiliate-stamped link.
         Copied verbatim from public/index.html rather than reworded, because two
         wordings of one promise is how a promise starts drifting. -->
    <p class="fine">Affiliate disclosure: Legal-Leaf Market may earn a commission on qualifying
    purchases made through links on this site, at no extra cost to you, coupon savings are yours
    either way.</p>
  </div>
</div>
${similarSection(similar)}
<section class="thread" id="comments">
  <h2>What people said</h2>
  <!-- SAID PLAINLY, BECAUSE THE ALTERNATIVE IS IMPLYING SOMETHING UNTRUE. There
       are no accounts here: a name is whatever somebody typed, and nothing is
       verified. Every comment is read before it appears, which is the only
       claim this page can actually make. -->
  <p class="tnote">Read before they appear. Names are not verified, and nothing here is advice.</p>
  <div id="cmtlist"><p class="cmt none">Loading&hellip;</p></div>
  <form class="cform" id="cform">
    <input id="cname" type="text" maxlength="40" placeholder="Your name (optional)" autocomplete="off"/>
    <textarea id="cbody" maxlength="1200" placeholder="What did you make of it?" required></textarea>
    <button type="submit" id="csend">Post comment</button>
    <p class="cmsg" id="cmsg"></p>
  </form>
</section>
<script>
(function(){
  var D = ${payload};
  var at = D.start;
  /* NO FLIP CONTAINER ANY MORE. Everything this used to measure -- the back's
     height, the container's height, which face was showing -- was the card's
     geometry, and a page has none of it: the document scrolls, which is the one
     scroll everybody already understands.
     (No backticks anywhere in this script: it is itself inside a template
     literal, and one would end the string mid-comment.) */
  var sel = document.getElementById('size');
  var add = document.getElementById('add');
  var hint = document.getElementById('hint');
  var priceEl = document.getElementById('price');

  function cur(){ return D.slides[at]; }
  function money(n, c){
    if (typeof n !== 'number' || !isFinite(n)) return '';
    return (c === 'EUR' ? '\\u20ac' : '$') + (Math.round(n * 100) / 100).toFixed(2).replace(/\\.00$/, '');
  }
  function chosen(){
    var s = document.getElementById('size');
    if (!s || s.value === '') return null;
    var i = parseInt(s.value, 10), z = cur().sizes;
    for (var k = 0; k < z.length; k++) if (z[k].i === i) return z[k];
    return null;
  }

  /* The photo follows the choice. The feed carries a per-variant
     image on about a third of size rows, and on a multi-strain listing each strain
     has its own, so the product's lead photo is the wrong picture for the row being
     bought. A row with no image of its own falls back to the product photo rather
     than leaving the previous variant's picture up. */
  function showPhoto(c){
    var sl = cur(), shot = document.getElementById('shot');
    var wrap = document.getElementById('vshot');
    var vimg = document.getElementById('vimg');
    var vcap = document.getElementById('vcap');
    var src = (c && c.img) || sl.baseImg || sl.img;
    if (shot && src) { shot.src = src; shot.alt = c ? sl.name + ', ' + c.display : sl.name; }
    if (!wrap || !vimg) return;
    if (!c) { wrap.hidden = true; vimg.removeAttribute('src'); if (vcap) vcap.textContent = ''; return; }
    vimg.src = src;
    vimg.alt = c.display;
    if (vcap) {
      vcap.textContent = c.img
        ? c.display
        : c.display + '. This store publishes one photo for every size.';
    }
    wrap.hidden = false;
  }

  /* The banner tracks the row on screen, not just the listing. A shopper moving to
     a trim row on a mixed listing has to see it appear, and one moving off it has
     to see it go, or the card states something about a row nobody is looking at.
     A listing that is trim throughout holds it whatever is chosen. Both faces are
     set together, since the card can be flipped either way when the choice moves. */
  function showTrim(c){
    var sl = cur();
    var on = !!sl.trimProd || (c ? !!c.trim : !!sl.trim);
    /* The weight named in the banner is the row's, so it tracks the choice too: a
       banner reading "this 1oz" while a 2oz is selected states the wrong thing
       about the right product. */
    var w = (c ? c.label : sl.weight) || 'size';
    set('tsbF', on, 'This ' + w + ' is trim/shake, not whole buds');
    set('tsbB', on, 'This ' + w + ' is trim/shake, not whole buds');
    set('cbdF', !!sl.cbd, 'This ' + w + ' is CBD, non-psychoactive');
    set('cbdB', !!sl.cbd, 'This ' + w + ' is CBD, non-psychoactive');
    function set(id, vis, text){
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = !vis;
      if (vis) el.textContent = text;
    }
  }

  function wireSelect(){
    var s = document.getElementById('size');
    if (!s) return;
    s.addEventListener('change', function(){
      s.classList.remove('needs');
      var c = chosen(), sl = cur();
      var h2 = document.getElementById('hint2');
      showPhoto(c);
      showTrim(c);
      if (!c) { hint.textContent = 'Choose a size to see the exact price.'; hint.className = 'hint'; return; }
      priceEl.innerHTML = '';
      priceEl.appendChild(document.createTextNode(money(c.price, sl.cur)));
      var w = document.createElement('span');
      w.className = 'meta';
      w.textContent = ' ' + c.label + (c.perG ? ' \\u00b7 ' + money(c.perG, sl.cur) + ' per gram' : '');
      priceEl.appendChild(w);
      if (add) add.textContent = 'Add ' + c.label + ' for ' + money(c.price, sl.cur) + ' to cart';
      hint.textContent = 'Adding ' + c.display + ', ' + money(c.price, sl.cur) + ', from ' + sl.store + '.';
      hint.className = 'hint';
      if (h2) h2.textContent = 'Ready. Flip back or add it now.';
      try { LL.track('size_selected', { size: c.label, value: c.price }); } catch (e) {}
    });
  }
  wireSelect();

  /* ---- the slideshow ----
   * Slides swap in place rather than reloading, so moving through the ten picks is
   * instant. The selection is reset on every move: carrying a choice from one
   * product to the next is how somebody ends up adding a thing they never saw. */
  function optionHtml(sl){
    var out = '\\u003coption value=""\\u003eSelect a size...\\u003c/option\\u003e';
    for (var k = 0; k < sl.sizes.length; k++) {
      var r = sl.sizes[k];
      var bits = [r.display, money(r.price, sl.cur)];
      if (r.perG) bits.push(money(r.perG, sl.cur) + '/g');
      if (r.isPick) bits.push("this week's pick");
      var o = document.createElement('option');
      o.value = String(r.i);
      o.textContent = bits.join(' \\u00b7 ');
      out += o.outerHTML;
    }
    return out;
  }

  function render(){
    var sl = cur();
    document.getElementById('shot').src = sl.img;
    document.getElementById('shot').alt = sl.name;
    document.getElementById('pname').textContent = sl.name;
    priceEl.innerHTML = '';
    priceEl.appendChild(document.createTextNode(sl.priceText));
    if (sl.weight) {
      var w = document.createElement('span');
      w.className = 'meta';
      w.textContent = ' ' + sl.weight;
      priceEl.appendChild(w);
    }
    document.getElementById('pdesc').textContent = sl.desc;
    /* Reset to the new slide's own state, since the choice does not survive a slide
       change and a banner left up from the last product would be about nothing. */
    showTrim(null);
    document.getElementById('labwrap').innerHTML = sl.lab;
    document.getElementById('fine').textContent = 'Price and stock come from ' + sl.store +
      "'s own feed and can move without notice. Legal-Leaf Market does not take the order or " +
      'hold the stock. Ranking is never affected by commission.';

    var wrap = document.getElementById('pickwrap');
    if (sl.canAdd) {
      wrap.innerHTML = '\\u003cdiv class="pickfield"\\u003e\\u003clabel for="size"\\u003e1. Choose your size\\u003c/label\\u003e' +
        '\\u003cselect id="size"\\u003e' + optionHtml(sl) + '\\u003c/select\\u003e' +
        '\\u003cdiv class="vshot" id="vshot" hidden\\u003e\\u003cimg id="vimg" alt=""/\\u003e' +
        '\\u003cspan id="vcap"\\u003e\\u003c/span\\u003e\\u003c/div\\u003e' +
        '\\u003cp class="hint" id="hint2"\\u003eThe price updates once you choose.\\u003c/p\\u003e' +
        '\\u003cp class="caution" id="limitnote"\\u003e\\u003c/p\\u003e\\u003c/div\\u003e';
      /* Set as text, and hidden when empty. Every slide's dropdown is already built
         under the pick's constraints, but only this line says so, and a
         single-option dropdown with no explanation reads as a bug. */
      var ln = document.getElementById('limitnote');
      ln.textContent = sl.limitNote || '';
      ln.hidden = !sl.limitNote;
      wireSelect();
    } else {
      wrap.innerHTML = '\\u003cp class="caution"\\u003eThis store has not published a buyable size for this ' +
        'product, so it cannot be added to a cart here. The comparison below still has it.\\u003c/p\\u003e';
    }
    if (add) {
      add.hidden = !sl.canAdd;
      add.disabled = false;
      add.textContent = 'Add to cart';
    }
    hint.className = 'hint';
    hint.textContent = sl.canAdd
      ? 'Pick a size to see its price per gram.'
      : 'The lab numbers are below.';

    var c = document.getElementById('count');
    if (c) c.textContent = (at + 1) + ' of ' + D.slides.length;

    /* Keep the URL in step so a slide can still be shared, without adding a
       history entry per tap. */
    try {
      var q = new URLSearchParams(location.search);
      q.set('i', String(at));
      history.replaceState(null, '', location.pathname + '?' + q.toString());
    } catch (e) {}
  }

  function go(delta){
    var n = D.slides.length;
    if (n < 2) return;
    var from = at;
    at = (at + delta + n) % n;
    render();
    try { LL.track('slide', { from: from, to: at, pid: cur().pid }); } catch (e) {}
  }

  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  if (prev) prev.addEventListener('click', function(){ go(-1); });
  if (next) next.addEventListener('click', function(){ go(1); });

  document.addEventListener('keydown', function(e){
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  });

  /* Swipe, since this lands on a phone from a DM. Only a clearly horizontal drag
     counts, or scrolling the page would flick through the slides. */
  var x0 = null, y0 = null;
  /* The photo box, which is what a thumb is on when it swipes. It used to be
     .front -- one of two faces inside the card -- and there is only one now. */
  var frontFace = document.querySelector('.shotwrap');
  frontFace.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  frontFace.addEventListener('touchend', function(e){
    if (x0 == null || !e.changedTouches.length) return;
    var dx = e.changedTouches[0].clientX - x0;
    var dy = e.changedTouches[0].clientY - y0;
    x0 = y0 = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? 1 : -1);
  }, { passive: true });


  /* ---- THE THREAD ------------------------------------------------------
     Fetched rather than rendered into the page, for one reason: this page is
     CDN cached for its product, and comments are approved on a different clock
     from the one the catalogue is scraped on. Baking them in would serve a
     thread as stale as the cache window, and the whole point of reading one is
     that it is current.

     Every value is written with textContent, never innerHTML. The server
     refuses angle brackets on the way in and this refuses to interpret them on
     the way out -- defence at one layer is defence nowhere, and this is the one
     place on the site where the text came from a stranger. */
  (function(){
    var list = document.getElementById('cmtlist');
    var form = document.getElementById('cform');
    if (!list || !form) return;
    var pid = cur().pid;

    function when(ms){
      var d = Number(ms); if (!d) return '';
      try { return new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); }
      catch(e){ return ''; }
    }
    function draw(rows){
      list.textContent = '';
      if (!rows || !rows.length) {
        var p0 = document.createElement('p');
        p0.className = 'cmt none';
        p0.textContent = 'Nobody has said anything about this one yet.';
        list.appendChild(p0); return;
      }
      for (var i = 0; i < rows.length; i++) {
        var c = rows[i];
        var wrap = document.createElement('div'); wrap.className = 'cmt';
        var who = document.createElement('div'); who.className = 'who';
        who.textContent = c.name || 'Anonymous';
        if (c.staff) { var b = document.createElement('b'); b.textContent = ' Legal-Leaf'; who.appendChild(b); }
        var w = when(c.at);
        if (w) { var sp = document.createElement('span'); sp.className = 'when'; sp.textContent = ' \u00b7 ' + w; who.appendChild(sp); }
        var body = document.createElement('p');
        body.textContent = c.body || '';
        wrap.appendChild(who); wrap.appendChild(body); list.appendChild(wrap);
      }
    }
    function load(){
      fetch('/api/comments?id=' + encodeURIComponent(pid), {headers:{accept:'application/json'}})
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ draw(j && j.comments); })
        .catch(function(){ draw([]); });
    }
    load();

    var msg = document.getElementById('cmsg');
    var send = document.getElementById('csend');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var body = (document.getElementById('cbody').value || '').trim();
      if (!body) return;
      send.disabled = true;
      msg.className = 'cmsg'; msg.textContent = 'Sending\u2026';
      fetch('/api/comments', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ productId: pid, name: document.getElementById('cname').value || '', body: body })
      }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
        .then(function(o){
          send.disabled = false;
          if (!o.ok) { msg.className = 'cmsg bad'; msg.textContent = (o.j && o.j.error) || 'That did not send.'; return; }
          msg.className = 'cmsg good';
          msg.textContent = (o.j && o.j.note) || 'Thanks.';
          document.getElementById('cbody').value = '';
          /* An admin's own comment is live immediately, so the thread is worth
             re-reading; a stranger's is not, and re-reading would show them
             nothing and read as the post having failed. */
          if (o.j && o.j.status === 'ok') load();
        })
        .catch(function(){ send.disabled = false; msg.className = 'cmsg bad'; msg.textContent = 'That did not send.'; });
    });
  })();

  if (add) add.addEventListener('click', function(){
    var c = chosen(), s = document.getElementById('size');
    /* Nobody adds a mystery item to a cart. No selection means walk them to the
       choice rather than guessing on their behalf. */
    if (!c) {
      /* This used to turn the card over, because the dropdown lived on the back.
         On a page it is already on screen -- so the equivalent of "walk them to
         the choice" is to put it in front of them and focus it, rather than to
         move anything. */
      if (s) {
        s.classList.add('needs');
        try { s.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        catch (err) { s.scrollIntoView(); }
        setTimeout(function(){ try { s.focus({ preventScroll: true }); } catch (err) { s.focus(); } }, 240);
      }
      hint.textContent = 'Choose a size first, so you know exactly what you are adding.';
      hint.className = 'hint warn';
      var h2 = document.getElementById('hint2');
      if (h2) h2.textContent = 'Pick one of these, then add to cart.';
      try { LL.track('add_blocked_no_size', {}); } catch (e) {}
      return;
    }
    var cart = [];
    try { cart = JSON.parse(localStorage.getItem('ll_cart')) || []; } catch (e) { cart = []; }
    cart.push(c.item);
    try { localStorage.setItem('ll_cart', JSON.stringify(cart)); } catch (e) {}
    try { LL.track('add_to_cart', { store: c.item.store, storeKey: c.item.storeKey,
      product: c.item.name, size: c.label, value: c.item.price, cur: c.item.cur }); } catch (e) {}
    add.textContent = 'Added, opening your cart...';
    add.disabled = true;
    location.href = ${JSON.stringify(SITE + '/consumables#cart')};
  });
})();
<\/script>`;

  return res.status(200).send(
    page({
      title: ogTitle + ': Legal-Leaf Market',
      ogTitle,
      ogDesc,
      ogImage: img,
      canonical,
      body,
      track: {
        page: isPick ? 'pick' : 'share',
        rank: isPick ? rank : null,
        of: isPick ? pool : null,
        pid: product.id,
        store: product.store,
        storeKey: product.storeKey,
        size: slide.size,
        value: slide.value,
        perG: slide.perG,
        cur: slide.cur,
      },
    })
  );
}

// Exported for tests. Not part of the route contract.
export const __test = { esc, httpsOnly, money, weightLabel, headline, description, cartItem, pickBest, pickAll, PICK_POOL, saysWeightAlready, namesAnOunce, ounceRowOverCap, isTrimShake, isTrimProduct, bucketOf, composePool, POOL_MIX };

/* api/coldwater.js — live menus for the Coldwater, Michigan dispensary cluster.
 *
 * Answers in the SAME shape as /api/products ({products, meta}) because
 * public/coldwater.html runs the same base64 engine as index.html and simply
 * has its fetch path repointed here. Keep the shape; the engine, the drawer and
 * the COA modal all depend on it.
 *
 * ---------------------------------------------------------------------------
 * STATUS. All seven Coldwater shops have been read from their own page source.
 * SEVEN SHOPS, SIX PLATFORMS -- there is no single integration to write here,
 * and that is the headline finding:
 *
 *   Lume              own Next.js, server-rendered   ADAPTER BUILT, needs a cookie
 *   Green Tree Relief Jane, store 5187               wired, enabled
 *   Sapura            Dutchie                        WALLED (Cloudflare challenge)
 *   Exclusive         Dutchie                        WALLED, same wall
 *   The Dude Abides   Flowhub                        id recorded, adapter to write
 *   Herbology         Cannavate                      id recorded, product call to find
 *   Banzen            Tymber/Blaze                   slug recorded, product call to find
 *
 * The two Dutchie stores answer a server-side request with a Cloudflare bot
 * interstitial. That is a deliberate control against automated clients, so it is
 * not something to engineer around: the route in is the merchant asking Dutchie
 * for their own feed. Their ids stay recorded and Sapura stays enabled so the
 * probe keeps reporting the state of it rather than the question being forgotten.
 *
 * Nothing here can be tested against a live host -- every menu platform is
 * refused by the egress proxy in the containers this repo is edited from. Two
 * consequences, both deliberate: adapters fail LOUDLY, naming what came back
 * (see fromDutchie), and the one adapter that is finished is tested against a
 * saved real page instead (test-coldwater-lume.mjs).
 *
 * Until a store actually returns rows this route serves the DEMO set at the
 * bottom, whose shop names are deliberately placeholders ("Sample Shop A").
 * Publishing an invented price against a named local business is the one thing
 * this file must never do, and a demo fixture is exactly how that happens by
 * accident.
 * ---------------------------------------------------------------------------
 *
 * ON READING THESE MENUS AT ALL. This is the same thing api/products.js has done
 * for sixteen hemp storefronts since the beginning, under the rule in CLAUDE.md:
 * what gates a source is whether there is a lawful, public catalogue to read, and
 * that is a per-merchant question. So the courtesies below are load bearing rather
 * than decorative — they are what makes this survivable rather than a week from an
 * IP ban:
 *
 *   - ONE request per store per refresh, sequential, with SPACING_MS between.
 *   - A 30-minute warm cache plus CDN s-maxage, so real traffic almost never
 *     reaches a shop.
 *   - A descriptive User-Agent with a contact URL, so anyone who wants us to stop
 *     can find us without having to guess.
 *   - Per-store `enabled` flag: a kill switch that needs no deploy reasoning, and
 *     the first thing to flip if a shop asks.
 *   - Every product carries `url` straight back to the shop's own listing. This
 *     sends them traffic; it is the honest argument for being here at all.
 *   - `?debug` reports each store's robots.txt disposition so it is a fact on the
 *     record rather than an assumption.
 */

import { readIngest, readIngestMany } from "./coldwater-ingest.js";
/* WHO MADE THIS, stated once. These lived here and api/products.js needed the
   same answer; two copies of a brand rule do not error, they quietly split one
   maker into two chips, which is the opposite of what a brand rail is for. */
import { OBJ_ARTEFACT, cleanName, brandFromUrl, normBrand, brandKey, isStoreBrand } from "./brand.js";
import { mergeProducts } from "./coldwater-merge.js";

const UA = "LegalLeafMarket/1.0 (+https://legal-leafmarket.com/coldwater; price comparison; contact via site)";
const TIMEOUT_MS = 9000;
const SPACING_MS = 700;      // between stores, never concurrent
const CACHE_MS = 30 * 60e3;

/* ------------------------------------------------------ towns and stores ---
 * BOTH MOVED TO api/market-stores.js, and the move is what step 6 was for.
 *
 * This file had its OWN town registry beside the one in api/markets.js -- five
 * towns against eight -- and its resolver fell back to Coldwater for anything
 * missing from its copy. So ?town=lansing, a market that is registered and
 * spelled correctly, served Coldwater's shelf. Measured, not theorised.
 *
 * It could not have gone red anywhere: falling back IS the right answer for a
 * mistyped ?town=, and with two registries the resolver has no way to tell a
 * typo from a city it was never told about. One registry is the fix; there is
 * no version of two that is safe.
 *
 * The roster left with it because a shop list is data about a place, and this
 * is the file that reads menus. Adding a city must never require editing the
 * reader -- that is the pressure that puts a per-city branch somewhere it looks
 * at home.
 */
import {
  STORES, TOWNS, DEFAULT_TOWN, townKey, lumeStore, LUME_TOWNS,
} from "./market-stores.js";

/* Michigan CRA statewide average retail ounce, June 2026. Used only to stamp a
   benchmark into meta so the page can show it; never to invent a product price. */
const MI_AVG_OZ = 58.18;

/* ----------------------------------------------------------------- http --- */
/* THE ONE SWITCH THAT KEEPS A TEST RUNNER OFF A REAL SHOP'S SERVER.
 *
 * Every outbound request this route makes goes through get(). LL_NO_STORE_FETCH
 * makes it refuse, and that exists because of something CI made visible rather
 * than because of a preference.
 *
 * The browser suites boot the real server.mjs and call /api/coldwater?refresh.
 * In the containers this repo is edited from, the egress proxy answers 403 to
 * every dispensary host instantly, so the feed falls through to stored captures
 * and the suites pass. A GitHub runner has ORDINARY NETWORK ACCESS. The same
 * line of test code then fetches https://dudeabides-willow.dispensary.shop/menu
 * -- a real business, on every push, on every branch.
 *
 * That is not a flaky test. It is the opposite of the promise this file makes in
 * its own header and in CLAUDE.md section 7: one request per store per refresh,
 * a 30-minute cache, spacing between stores, and a User-Agent with a contact url
 * so anyone who wants us to stop can ask. A suite firing `?refresh` at a shop
 * every time somebody pushes a commit looks, from that shop's side, exactly like
 * the thing those courtesies exist to promise we are not.
 *
 * So the guarantee is here, at the single chokepoint, rather than in each
 * suite's discipline -- the same argument as anyInStock() and captureKeyer():
 * a rule restated in nine places is a rule that is wrong in one of them.
 *
 * It REPORTS rather than pretending, because a silent empty store is
 * indistinguishable from a shop that has closed (see fromDutchie, which fails
 * loudly for the same reason). The refusal lands in meta.stores[].err.
 *
 * READ PER CALL, NOT AT MODULE LOAD, and that is not a style choice. A suite
 * that sets process.env at the top of its own file sets it AFTER its imports
 * have run -- ESM evaluates imports first -- so a load-time constant would
 * already be false by the time the suite's own line executes, and the guard
 * would be silently inert exactly where it was most explicitly asked for. It
 * also lets a suite that installs its own fetch stub stand this down for itself,
 * which one does; see test-coldwater-variants.mjs.
 */
const noStoreFetch = () => /^(1|true|yes)$/i.test(String(process.env.LL_NO_STORE_FETCH || ""));

async function get(url, opts) {
  /* THROWS rather than returning a not-ok response, and that is deliberate.
     Five call sites build their own message from `r.status`, so a returned
     refusal came out as "http 0 :: " -- which names neither the cause nor the
     switch, and reads exactly like a shop that timed out. Throwing means the
     one sentence written here is the one an operator reads, in all five, with
     nothing restated. Every caller already catches, because a bad store must
     never take the whole feed down. */
  if (noStoreFetch()) {
    throw new Error("refused: LL_NO_STORE_FETCH is set, so no request was made to " +
                    (() => { try { return new URL(url).host; } catch (e) { return String(url).slice(0, 60); } })());
  }
  const ctl = new AbortController();
  /* Per-call override. Banzen's /menu aborted at the 9s default and read as a
     failure; it is a server-rendered page in the Lume mould, so it is simply
     BIG. A timeout is not a wall, and the two must not look alike in the
     output -- that is how a readable store gets written off. */
  const t = setTimeout(() => ctl.abort(), (opts && opts.timeout) || TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*", ...(opts && opts.headers) },
      ...(opts && opts.method ? { method: opts.method, body: opts.body } : {}),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text, hdr: n => r.headers.get(n) };
  } finally { clearTimeout(t); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* robots.txt, reported not enforced-by-guess. We record what it says for the
   path we would read; acting on it is a per-store decision made in STORES. */
async function robotsNote(site) {
  if (!site) return "no site";
  try {
    const u = new URL(site);
    const r = await get(u.origin + "/robots.txt");
    if (!r.ok) return `robots ${r.status}`;
    const disallowAll = /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*$/im.test(r.text);
    return disallowAll ? "robots: disallow /" : "robots: ok";
  } catch (e) { return "robots: unreachable"; }
}

/* ------------------------------------------------------------- adapters --- */
/* Each returns an array of products in the engine's shape, or throws.
   They are written from the documented public shapes of each platform's menu
   API. NONE has been exercised against a live host from here — see the header.
   Treat the field mapping as the thing to verify first when you connect one. */

function money(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; }

/* Rows are [label, price, grams, variantId, inStock, url, offcut, sale] — the
   same seven slots api/products.js emits, so slot 7 (offcut, index 6) keeps
   meaning what it means, plus an eighth.
 *
 * INDEX 5 IS THE ROW'S OWN URL and must stay that way: the engine reads it when a
 * grouped card builds a cart link ("grouped rows carry their own product url in
 * slot 5"), so a price parked there would be handed to the browser as an address.
 *
 * INDEX 7 IS A STATED SALE PRICE, and it was already being read: toProduct's deal
 * loop consults r[7] and has since it was written, while nothing in this file
 * ever set it -- so every discount a shop states per size was captured, stored by
 * the ingest sanitiser, and then dropped on the floor here. It is a parameter now.
 * The engine ignores slots it does not know, which is why the eighth is safe to
 * add rather than borrow. */
function row(label, price, grams, id, inStock, offcut, sale) {
  const p = money(price), s = money(sale);
  return [label, p, Number(grams) || 0, String(id || ""), inStock !== false, null, !!offcut,
          (s != null && s > 0 && p != null && s < p) ? s : null];
}

/* EVERY SHAPE A SIZE SELECTOR ARRIVES IN, read into real rows.
 *
 * Reported as "some items only show one option in the drop down" and "the options
 * are all on one line". Both are this function's absence. The old code understood
 * exactly one shape -- an array of OBJECTS each carrying its own label and price
 * -- and every other shape fell through to a single "One Size" row at the
 * product's top-level price. Silently: no error, a card that looks complete, and
 * the ounce (the row that sells) missing entirely.
 *
 * The shapes these menus actually use:
 *
 *   1. [{option:"3.5g", price:35}, ...]        the one that already worked
 *   2. ["1g","3.5g","7g"] + prices:[12,35,60]  PARALLEL ARRAYS, paired by index
 *   3. ["3.5g - $35", "7g - $60"]              the price inside the string
 *   4. {"3.5g":35, "7g":60}                    a label-keyed map
 *   5. price_gram / price_eighth_ounce / ...   Jane states each weight as its
 *                                              own FIELD, with no array at all
 *
 * TWO REFUSALS, both deliberate. Parallel arrays of different lengths are not
 * paired -- an off-by-one there prices an ounce at an eighth's price, which is
 * the worst wrong number this site can print. And a label with no price is
 * dropped rather than published at the parent's price, because the parent's price
 * belongs to the cheapest variation and stamping it on all of them makes every
 * size look like the cheapest one.
 *
 * DELIBERATE TWIN of the reader in public/coldwater-collector.js, for the same
 * reason rscRoots() is duplicated there: a static file served onto a
 * dispensary's origin cannot import from api/. Change one, change the other. */
const V_CONTAINERS = ["variants", "sizes", "options", "weights", "variations", "priceTiers"];
const V_LABEL = ["option", "label", "name", "title", "weight", "displayVariation",
                 "variation", "size", "unit", "weight_label", "optionName", "display"];
const V_PRICE = ["price", "priceMed", "priceRec", "recPrice", "medPrice", "price_med",
                 "priceDisplay", "unitPrice", "amount", "cost", "value"];
/* `sale` IS THIS CODEBASE'S OWN NAME FOR THE FIELD and it was the one spelling
   missing. The collector emits sizes[].sale, the ingest sanitiser stores
   sizes[].sale, and rawOf() passes z.sale into row() by hand -- so the live
   capture path worked while variantRows(), the shared reader everything else
   goes through, silently dropped it. A vocabulary list that omits the local
   vocabulary is the kind of gap that only shows up from the far end of the
   chain, which is where this was found. */
const V_SALE = ["sale", "specialPrice", "salePrice", "discountedPrice", "discountPrice", "saleprice"];
const V_PARALLEL = ["prices", "Prices", "recPrices", "medPrices", "priceList",
                    "variantPrices", "optionPrices", "priceRange"];
/* Jane names each weight as a field. Same labels and grams the Jane adapter
   already uses, so a captured Jane menu and a scraped one agree. */
const JANE_PRICE_FIELDS = ["half_gram", "gram", "two_gram", "eighth_ounce", "quarter_ounce", "half_ounce", "ounce"];

function vPick(o, keys) {
  for (const k of keys) {
    const v = o && o[k];
    if (v != null && v !== "" && typeof v !== "object") return v;
  }
  return null;
}
/* "3.5g - $35", "1 g | 12.00", "Ounce $170" -- a label and a price in one string. */
function splitLabelPrice(s) {
  const str = String(s);
  const m = str.match(/^(.*?)[\s\-|:–—]*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
  if (!m || !m[1].trim()) return null;
  const price = money(String(m[2]).replace(/,/g, ""));
  if (price == null) return null;
  return { label: m[1].replace(/[\s\-|:]+$/, "").trim(), price };
}

function variantRows(o, idBase, offcutName) {
  const rows = [];
  const oc = lab => OFFCUT_RE.test(String(lab || "")) || OFFCUT_RE.test(String(offcutName || ""));
  const push = (label, price, id, live, sale) => {
    if (price == null) return;
    rows.push(row(label || "One Size", price, gramsOf(label), id, live, oc(label), sale));
  };

  let vs = null;
  for (const k of V_CONTAINERS) {
    const v = o && o[k];
    if (Array.isArray(v) && v.length) { vs = v; break; }
  }
  if (!vs && o && o.POSMetaData && Array.isArray(o.POSMetaData.children) && o.POSMetaData.children.length) {
    vs = o.POSMetaData.children;
  }

  if (vs) {
    const parallel = V_PARALLEL.map(k => o[k]).find(v => Array.isArray(v) && v.length === vs.length);
    vs.forEach((v, i) => {
      if (v && typeof v === "object") {
        push(String(vPick(v, V_LABEL) || "One Size"), money(vPick(v, V_PRICE)),
             idBase + "-" + i, (v.quantity == null || v.quantity > 0) && v.inStock !== false && v.available !== false,
             money(vPick(v, V_SALE)));
        return;
      }
      /* A string or a number. Its own price first, then the parallel array. */
      const own = splitLabelPrice(v);
      if (own) { push(own.label, own.price, idBase + "-" + i, true, null); return; }
      if (parallel) push(String(v), money(parallel[i]), idBase + "-" + i, true, null);
      /* No price anywhere: dropped, for the reason in the header. */
    });
  }

  /* A label-keyed map, which is how a couple of these menus serialise a swatch
     set. Rejected unless every value looks like money, so a props object full of
     booleans cannot become a size list. */
  if (!rows.length && o && typeof o === "object") {
    for (const k of V_CONTAINERS) {
      const v = o[k];
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const ent = Object.entries(v).filter(([, p]) => money(p) != null && money(p) > 0);
      if (ent.length && ent.length === Object.keys(v).length) {
        ent.forEach(([lab, p], i) => push(lab, money(p), idBase + "-" + i, true, null));
        break;
      }
    }
  }

  /* Jane's per-weight fields. Last, because a menu carrying both an array and
     these is stating the same thing twice. */
  if (!rows.length && o) {
    for (const k of JANE_PRICE_FIELDS) {
      const p = money(o["price_" + k]);
      if (p != null && p > 0) push(labelFor(k), p, idBase + "-" + k, true, null);
    }
  }

  return dedupeRows(rows);
}

/* One row per label, cheapest kept. A menu that lists the same weight twice is
   listing two batches of it, and the shopper's question is what that weight
   costs -- so the low price is the honest answer rather than whichever batch the
   feed happened to serialise first. Sorted by weight so the dropdown reads
   upwards, which is also the order every menu board in this town uses. */
function dedupeRows(rows) {
  const best = new Map();
  for (const r of rows || []) {
    if (!r || r[1] == null) continue;
    const k = String(r[0] || "").trim().toLowerCase();
    const prev = best.get(k);
    if (!prev || r[1] < prev[1]) best.set(k, r);
  }
  return [...best.values()]
    .sort((a, b) => (a[2] || 0) - (b[2] || 0) || (a[1] || 0) - (b[1] || 0))
    .slice(0, 12);
}

/* THE WEIGHT IS IN THE TITLE, IN BRACKETS, and Green Tree writes every one of
 * theirs that way: "Gold Crown Baja Blast [.7g]", "Jeeter Cannalope [.5g]",
 * "DNK Frosted Alien [1g]". Their size rows carry no weight at all, so the whole
 * shop reported withGrams:0 and contributed NOTHING to price per gram - which is
 * the one thing this page is for.
 *
 * ONLY GRAMS AND OUNCES. "[2000mg]" is a DOSE, not a weight: it is how much
 * cannabinoid is in an edible, and reading it as two grams of product would put
 * a $25 gummy pack on the shelf at $12.50/g and rank it against flower. "[10pk]"
 * is a count and "[12oz]" on a drink is volume. A wrong per-gram ranks first
 * because it is cheapest, which is exactly the failure gramsOf() and the sanity
 * guard already exist to prevent - so anything that is not plainly a weight is
 * refused here rather than guessed. */
function gramsFromName(name) {
  const m = String(name || "").match(/\[\s*(\d*\.?\d+)\s*(g|gram|grams|oz|ounces?)\s*\]/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (!isFinite(n) || n <= 0) return 0;
  /* "[12oz]" IS A DRINK. Cannabis is sold by the eighth, quarter, half and
     ounce, so a bracketed ounce above one is fluid volume -- Keef's 12oz soda
     would otherwise land as 336 g and put a $6 can on the shelf at under two
     cents a gram, first in every ranking. Above an ounce, refuse rather than
     lean on the per-gram sanity guard: the guard is a backstop for parses
     nobody predicted, not a licence to feed it ones we did. */
  if (/^o/i.test(m[2])) return n <= 1 ? n * 28 : 0;
  /* And a bracketed gram figure above an ounce is not a gram figure either. */
  return n <= 28 ? n : 0;
}

/* THE WEIGHT IN AN UNBRACKETED TITLE, and this one exists to stop the ENGINE
 * guessing rather than to answer a question the feed had.
 *
 * The engine fills in any row whose grams are zero, from the row label, then
 * from the product name, then from a per-cartridge default -- all inside the
 * base64 blob, which is not editable (CLAUDE.md section 5). Its name rule
 * MULTIPLIES a pack count by a stated weight, so "Fwaygo Pre-Roll 20pk 10g"
 * came out as 200 grams and the card printed a per-gram built on it. Reported
 * exactly that way: "one showing 200 grams instead of 2.00 grams".
 *
 * THE TWO PACK FORMS MEAN OPPOSITE THINGS, and that is the whole fix:
 *
 *   "2 x 1g"     states the weight of EACH unit  -> the package is 2 g
 *   "20pk 10g"   states the weight of the PACKAGE -> the package is 10 g
 *
 * Michigan packaging carries the net weight of what is inside it, because Metrc
 * requires it, so a ten-pack of minis printed with "3.5g" is three and a half
 * grams in total and not thirty-five. The engine multiplies both forms; this
 * reads them apart and publishes the answer, and a row that already carries
 * grams is never handed to the engine's guess in the first place.
 *
 * Same refusals as the bracket rule above: never mg (a dose), never an ounce
 * figure above one (fluid volume), nothing over an ounce of flower-in-a-title. */
function gramsFromTitle(name) {
  const s = String(name || "").toLowerCase();
  const bracketed = gramsFromName(name);
  if (bracketed) return bracketed;

  /* "2 x 1g" / "2x1g" / "2 × 1g" -- each. Bounded at 50 units, like the
     engine's own packCount, so a stray year or SKU cannot become a multiplier. */
  let m = s.match(/(\d{1,2})\s*(?:x|×)\s*([\d.]*\.?\d+)\s*(?:g\b|grams?\b)/);
  if (m) {
    const n = parseInt(m[1], 10), w = parseFloat(m[2]);
    if (n > 0 && n <= 50 && w > 0 && n * w <= 224) return n * w;
  }
  /* "1g x 2", the same statement written backwards. */
  m = s.match(/([\d.]*\.?\d+)\s*(?:g\b|grams?\b)\s*(?:x|×)\s*(\d{1,2})\b/);
  if (m) {
    const w = parseFloat(m[1]), n = parseInt(m[2], 10);
    if (n > 0 && n <= 50 && w > 0 && n * w <= 224) return n * w;
  }
  /* "20pk 10g", "10 pack 3.5g", "5ct 2.5g" -- the weight is the package's, so it
     is taken as it stands. This is the branch the 200 g came from. */
  if (/\d{1,2}\s*(?:pk|pack|ct|count|pc|pcs)\b/.test(s)) {
    m = s.match(/([\d.]*\.?\d+)\s*(?:g\b|grams?\b)/);
    if (m) { const w = parseFloat(m[1]); if (w > 0 && w <= 28) return w; }
    return 0;
  }
  /* A lone gram figure in the title, which is how every cart in this town states
     its weight ("Drip Blue Dream Cart 1g"). Bounded at an ounce: above that it
     is a bulk description or a dose, not this product's weight. */
  m = s.match(/([\d.]*\.?\d+)\s*(?:g\b|grams?\b)/);
  if (m) { const w = parseFloat(m[1]); if (w > 0 && w <= 28) return w; }
  return 0;
}

const OFFCUT_RE = /\b(shake|trim|smalls?|popcorn)\b/i;

/* CATEGORY, WHICH THE FEED WAS PUBLISHING RAW.
 *
 * `category: o.category || ""` passed each shop's own word straight through, and
 * the engine builds its dropdown as [...new Set(P.map(p => p.category))]. So the
 * filter was literally the union of six vocabularies. Counted over the live feed:
 * 28 distinct values for 9 real concepts, one concept spelled three ways --
 *
 *   flower / Flower / FLOWER            pre-rolls / Pre-Rolls / PRE_ROLLS
 *   edibles / Edible / EDIBLES          concentrates / Concentrate / CONCENTRATES
 *
 * -- so a shopper picking "Flower" saw one shop's flower and none of the other
 * two's. Case, plural and the underscore each split a category silently.
 *
 * NORMALISING HERE RATHER THAN IN THE COLLECTOR IS THE POINT: 2,567 products are
 * already captured, and the captures ARE the shelf. Doing it server-side repairs
 * them in place instead of asking for every shop to be walked again, which is the
 * same reasoning as re-deriving grams from the label.
 */
/* THE ENGINE'S VOCABULARY IS THE FEED'S VOCABULARY, and this is not a style
 * choice -- it is the only defence against a category splitting in two.
 *
 * The engine runs its OWN normCategory over everything it renders, and it only
 * rewrites a product when one of its NAME rules fires. When none matches, the
 * feed's string passes through verbatim. So any label the feed spells
 * differently from the engine produces TWO options in #fCategory: the engine's
 * spelling for every row a name rule caught, and the feed's for every row it did
 * not. Measured live on 16 Aug 2026:
 *
 *     Pre-Rolls  (6)      <- 7 rows the engine's name rules never touched
 *     Pre-rolls  (737)    <- everything else
 *
 * One byte of difference, two chips in the rail, two filter entries, and a
 * shopper who picks the wrong one sees six products. Nothing errors.
 *
 * The engine is inside the base64 blob and is not edited (CLAUDE.md sections 5
 * and 11), so the fix is to hand it input it will not need to rewrite: emit its
 * own spelling and the rewrite becomes idempotent. Read out of the DECODED blob
 * rather than guessed -- THCA Flower (42 occurrences), Concentrate (15),
 * Pre-rolls (8), Accessories (14), Edibles (12), Topicals (9), Apparel (1).
 *
 * VAPORIZERS IS DELIBERATELY NOT FOLDED. The engine has no such label at all --
 * it files a cart as Concentrate, a sub-tag. Folding 953 vape products into
 * Concentrate would merge the two biggest categories in the town, and whether a
 * shopper wants carts and dabs in one bucket is a product decision rather than a
 * spelling bug. The assert below reports it instead, so that choice gets made
 * deliberately rather than by a regex.
 */
const ENGINE_CATEGORIES = new Set([
  "THCA Flower", "Pre-rolls", "Concentrate", "Edibles", "Topicals",
  "Accessories", "Apparel", "Vaporizers", "Trim/Shake", "Seeds & Clones",
  /* THREE OF THESE ARE NEW AND THE ENGINE HAS NEVER HEARD OF THEM, which is
     deliberate rather than an oversight. The engine unions the feed's distinct
     category values into its own filter, so a value it does not know still
     becomes a facet -- that is how "Pre-rolls (0)" once appeared. What it will
     NOT do is leave them alone: its normCategory forces anything vape-shaped
     into Concentrate on the way in ("carts/disposables are a SUB-category of
     Concentrate. Guarantee the Concentrate bucket here so a cheap cart never
     slips to flower"), so these three arrive correctly and are then overwritten.
     Beating that is a page-side job -- the engine consults a manual category
     override BEFORE any of its own rules and returns it unconditionally -- and
     it is the other half of this change. The feed being right is the half that
     has to come first, and it is the half that is testable without a browser. */
  "Carts", "Disposables", "Drinks",
]);

/* Internal labels keep their own spellings, because the rest of this file keys
   on them (GRAM_BOUNDS). The alignment happens once, at the boundary. */
const TO_ENGINE = {
  "Flower": "THCA Flower",
  "Pre-Rolls": "Pre-rolls",
  "Concentrates": "Concentrate",
};
/* Per-invocation census of labels the engine has never heard of, read by
   ?debug&slim. Declared before engineCategory uses it. */
const UNCANON = new Map();

function engineCategory(label) {
  const v = String(label || "");
  if (!v) return "";
  const mapped = TO_ENGINE[v] || v;
  /* THE EXIT ASSERT. A label the engine does not know becomes a phantom dropdown
     option the moment one row escapes its name rules, which is how this bug
     arrives next time under a different word. Reported, never corrected:
     silently folding an unknown label into a known one would hide a store's real
     vocabulary, and that is worth knowing. */
  if (!ENGINE_CATEGORIES.has(mapped)) UNCANON.set(mapped, (UNCANON.get(mapped) || 0) + 1);
  return mapped;
}

const CATEGORY_RULES = [
  [/^(flower|bud|buds)$/, "Flower"],
  [/^(pre[\s_-]?rolls?|prerolls?|joints?)$/, "Pre-Rolls"],
  [/^(vaporizers?|vapes?|carts?|cartridges?|disposables?)$/, "Vaporizers"],
  /* EVERYTHING YOU SWALLOW IS ONE CATEGORY. A drink, a tincture, a gummy and a
     chocolate bar are the same decision to a shopper -- "something that is not
     smoked" -- and splitting them turned Edibles into four thin filter entries
     where two of them held one and two products. The form is still in the name
     if somebody wants it; the FILTER wants the fewest useful buckets. */
  /* SPRAYS AND MISTS ARE HERE AND NOT IN TOPICALS, which is a deliberate
     departure from the report that found them. Six YouMist SKUs (3 x 2 stores)
     arrive filed as Pre-Rolls at Sapura and Exclusive -- wrong at the source, so
     no case fold repairs them -- and the obvious fix is a topical rule. But this
     list already files `tinctures` and `sublinguals` as Edibles under the rule
     stated above it: everything you swallow is one category, because a drink, a
     tincture and a gummy are the same decision to a shopper. A 200mg oral THC
     spray is that same decision. Sending it to Topicals would put a thing you
     dose under your tongue beside the balms and salves, which is a worse answer
     than the one it replaces. */
  [/^(edibles?|gummies|gummy|beverages?|drinks?|seltzers?|sodas?|tinctures?|sublinguals?|sprays?|mists?|oral[\s_-]?sprays?)$/, "Edibles"],
  /* THE FORMS A MENU USES INSTEAD OF THE WORD. A shop that files by
     "Budder" and "Shatter" is not offering a different KIND of thing from one
     that files by "Concentrates" -- it is being more specific, and a filter
     that keeps the distinction turns one useful entry into a long tail nobody
     can shop by. Measured: dropping o.type sent Sapura down its subcategory
     branch and the town went from 11 distinct categories to 39. */
  [/^(concentrates?|extracts?|dabs?|budder|batter|badder|shatter|crumble|sugar|wax|kief|hash|rosin|live[\s_-]?rosin|live[\s_-]?resin|resin|sauce|diamonds?|distillate)$/, "Concentrates"],
  [/^(singles?|infused|infused[\s_-]?pre[\s_-]?rolls?|infused[\s_-]?pre[\s_-]?roll[\s_-]?packs?|packs?|blunts?)$/, "Pre-Rolls"],
  [/^(bulk[\s_-]?flower|infused[\s_-]?flower|infused[\s_-]?buds?|shake[\s_-]?trim|smalls)$/, "Flower"],
  [/^(baked[\s_-]?goods|chocolates?|mints?|capsules?[\s_-]?tablets?|gummies|live[\s_-]?resin[\s_-]?gummies|chews?|syrups?|honey|lozenges?|caramels?|taffy)$/, "Edibles"],
  [/^(balms?|salves?|lotions?|creams?|applicators?)$/, "Topicals"],
  [/^(papers?[\s_-]?rolling[\s_-]?supplies|glassware|batteries|battery|lighters?|grinders?|trays?|dab[\s_-]?tools?|rolling[\s_-]?papers?)$/, "Accessories"],
  [/^(topicals?)$/, "Topicals"],
  [/^(accessories|accessory|gear|hardware)$/, "Accessories"],
  [/^(apparel|merch|merchandise|clothing)$/, "Apparel"],
  [/^(seeds?|clones?)$/, "Seeds & Clones"],
  [/^(cbd)$/, "CBD"],
];

/* A STRAIN TYPE IS NOT A CATEGORY, and Green Tree published 24 products whose
   category was "hybrid", "sativa" or "indica" -- identical to their own `type`
   field on every single row. The collector's category fell back to `o.type`,
   which on a dispensary menu means the strain, so the shop's entire catalogue
   arrived filed under three words that are not product categories at all. The
   fallback is fixed in the collector; this drops the values already stored,
   so name inference below can answer instead of the filter offering "hybrid". */
/* `cbd` ALONE JOINED THIS LIST, and it was found by the exit assert rather than
   by anybody looking. 14 products arrive with a feed category of "CBD", which
   named a cannabinoid and not a product form -- CBD what, flower or gummies? --
   and it passed through verbatim into a phantom "CBD" filter entry the moment a
   row escaped the engine's name rules. Exactly the pre-roll split, a second
   time, under a different word. Treating it as not-a-category sends those rows
   to the name heuristics, which can actually answer the question. */
const NOT_A_CATEGORY = /^(hybrid|indica|sativa|indica[\s_-]?hybrid|sativa[\s_-]?hybrid|n\/?a|not[\s_]?applicable|none|other|misc|uncategori[sz]ed|thc|cbd|cbd[\s_-]?thc)$/i;

/* INFERENCE, for the 474 products (18% of the feed) that arrive with no category
   at all -- Banzen 458/458 and Exclusive 11/11, both read through the rendered
   page and the printed text, which carry no category because none is printed in
   a machine-readable place.
 *
 * ORDER IS THE WHOLE FUNCTION, exactly as in gramsOf(). "Live Resin Cart" is a
 * vape, not a concentrate; "Rosin Pre-Roll" is a pre-roll, not a concentrate. So
 * the most specific form wins and the raw material is tested last.
 *
 * A MISS RETURNS EMPTY ON PURPOSE. "Muha Meds Habibi [2000mg]" could be a cart or
 * an edible, and this file suppresses an implausible per-gram rather than publish
 * it for the same reason: a blank reads as missing data, a wrong category reads as
 * an answer and puts the product in a filter where nobody looking for it will
 * look -- and hides it from everyone who was. */
const CATEGORY_HINTS = [
  [/\b(pre[\s-]?rolls?|preroll|joints?|blunts?|doobie|dogwalker)\b/i, "Pre-Rolls"],
  /* THREE PURCHASES, NOT ONE. A cart needs a battery you already own, a
     disposable is ready the moment it leaves the counter, and a concentrate
     needs a rig. A shopper is choosing between those three, and lumping them as
     "Vaporizers" answers a question nobody asked.
     ORDER IS THE WHOLE RULE HERE, and getting it backwards does not fail, it
     lies -- the same class of bug as reading "1/8 oz" before the fraction rule.
     A DISPOSABLE CART IS A DISPOSABLE: it says both words, and the one that
     decides what you do with it is "disposable", so that test runs first. A LIVE
     ROSIN CART IS A CART, not concentrate, for the same reason -- it names the
     extract it is filled with, and you still need a battery. */
  /* A BATTERY IS GEAR, AND IT HAS TO BE DECIDED BEFORE THE CART RULE. "Dual
     Battery 510 Thread" carries 510, so the cart rule takes it otherwise -- and
     a battery filed under Carts is exactly the thing a shopper who came for a
     cart does not want, on the one page where the difference is the point. The
     accessory rule further down cannot save it: first match wins. */
  [/\bbatter(y|ies)\b/i, "Accessories"],
  [/\b(disposable|dispo|all[\s-]?in[\s-]?one|aio)\b/i, "Disposables"],
  [/\b(carts?|cartridges?|pods?|510)\b/i, "Carts"],
  /* "Vape" on its own is the word a menu uses when it has not decided either.
     It stays a cart, because that is the commoner of the two and the one a
     battery-owner is scanning for. */
  [/\bvapes?\b/i, "Carts"],
  [/\b(gumm(y|ies)|chocolates?|edible|chews?|brownies?|cookies?|candy|mints?|lozenges?|caramels?|taffy|syrup|hard\s*candy)\b/i, "Edibles"],
  /* DRINKS ARE THEIR OWN SHELF. A seltzer and a gummy are both "edibles" only
     to somebody writing a taxonomy; in a shop they are different aisles. A
     tincture and a dropper stay with edibles, because they are dosed rather
     than drunk. */
  [/\b(seltzers?|sodas?|lemonade|beverages?|drinks?|teas?|waters?|shots?)\b/i, "Drinks"],
  [/\b(tinctures?|drops?|dropper)\b/i, "Edibles"],
  [/\b(balms?|salves?|lotions?|creams?|patch(es)?|topicals?|roll[\s-]?on)\b/i, "Topicals"],
  [/\b(rosin|resin|shatter|badder|batter|budder|wax|hash|kief|diamonds?|sauce|crumble|concentrates?|distillate|ryo)\b/i, "Concentrates"],
  [/\b(shirts?|hoodies?|hats?|beanies?|socks?|apparel|tee)\b/i, "Apparel"],
  [/\b(grinders?|lighters?|trays?|papers?|batter(y|ies)|pipes?|bongs?|rigs?|torch|cases?|accessor|dab\s*tools?|dabbers?|nails?|bangers?|carb\s*caps?)\b/i, "Accessories"],
  [/\b(flower|buds?|smalls|shake|trim|popcorn)\b/i, "Flower"],
];

/* THE THINGS THAT ARE NOT SOLD BY WEIGHT OF CANNABIS, and the reason this is its
 * own list rather than a category check.
 *
 * "710 Cleaner" was on the shelf with a price per gram. Two separate faults put
 * it there and either one alone was enough:
 *
 *   1. It has no category on the menu, no hint below matched it, and
 *      normCategory's last resort reads an ounce in a SIZE label as flower --
 *      "cannabis is sold by the eighth, quarter, half and ounce". A four-ounce
 *      bottle of glass cleaner is not, and it was filed under Flower.
 *   2. Even with the category right, the engine fills any row whose grams are
 *      zero by reading the label itself, inside the blob where it cannot be
 *      edited (CLAUDE.md section 5). "4 oz" comes back as 28 g and the card
 *      prints a per-gram built on it. Suppressing perG in the feed is invisible
 *      to that.
 *
 * So this list does two things at once: it answers the category, and it flips
 * `cannabinoid` to "Accessory", which is the ONE switch the engine already
 * honours -- its accessory card renders no per-gram, no size dropdown and no
 * strain at all, so there is nothing left for it to guess with.
 *
 * PRECISION OVER RECALL, deliberately. A miss costs nothing: the product keeps a
 * per-gram nobody wants, exactly as today. A false positive takes the per-gram
 * off a real flower listing, which is the one number this page exists for. So
 * every word here is a thing you cannot smoke, and near-misses are left out on
 * purpose -- "cone" and "wrap" are pre-roll forms, "jar" and "bag" are how flower
 * is packaged, and "pen" is half the vape catalogue. */
const NON_CONSUMABLE_NAME = new RegExp("\\b(" + [
  /* solvents and cleaning */
  "710\\s*cleaner", "cleaners?", "cleaning", "iso(?:propyl)?\\s*(?:alcohol|solution)?",
  "resolution", "wipes?", "soak", "descal",
  /* hardware */
  "batter(?:y|ies)", "chargers?", "usb", "grinders?", "lighters?", "torch(?:es)?",
  "hemp\\s*wick", "rolling\\s*machines?", "ashtrays?", "trays?", "poker",
  "pipes?", "bongs?", "bubblers?", "rigs?", "bangers?", "downstems?",
  "carb\\s*caps?", "dab\\s*(?:tools?|mats?)", "dabbers?", "quartz", "titanium",
  "screens?", "humidors?", "boveda", "grip\\s*bags?", "odor\\s*proof", "smell\\s*proof",
  /* merch */
  "t[\\s-]?shirts?", "shirts?", "hoodies?", "sweatshirts?", "beanies?", "socks?",
  "stickers?", "keychains?", "lanyards?", "totes?", "mugs?", "gift\\s*cards?",
  "merch(?:andise)?", "apparel",
].join("|") + ")\\b", "i");

/* A shop that files its own gear correctly is believed outright. These are the
   normCategory labels, not the shops' words, so one test covers every spelling
   of them the town uses. */
const NON_CONSUMABLE_CATS = new Set(["Accessories", "Apparel", "Seeds & Clones"]);

/* A CONSUMABLE SIGNAL OUTRANKS A GEAR WORD IN THE SAME NAME.
 *
 * The gear list matches a word anywhere in the title, which is right for "710
 * Cleaner" and wrong the moment a strain or a product line happens to contain
 * one. Measured live on 16 Aug 2026, ten genuine pre-rolls were flagged as gear
 * and dropped out of Pre-rolls entirely:
 *
 *   9 x "Breeze Canna | ... Bangers | Infused Preroll 5pk | 3.5g"  -> "banger"
 *   1 x "Cheech and Chong Sour Red Beanie ... Infused Preroll 6-pack" -> "beanie"
 *
 * The near-miss that proves it is a word problem rather than a store problem:
 * "Cheech and Chong Pink Mustache Cryos Infused Preroll 6-pack" classifies
 * correctly, because Mustache is not on the list.
 *
 * So a name that ALSO says outright what it is -- a preroll, a blunt, a joint,
 * an n-pack, a weight -- is believed over an incidental gear word. This is
 * deliberately not a widening of the gear list's precision: a bong named
 * "Blunt Force" is not rescued by this, because "blunt" as a word does not
 * appear... which is exactly why the signals are specific forms rather than
 * loose stems. A product that is genuinely both (a pipe sold with a preroll)
 * does not exist in this catalogue, and if it ever does it should be filed by
 * the shop rather than guessed here.
 */
const CONSUMABLE_SIGNAL = /\b(pre[\s_-]?rolls?|prerolls?|blunts?|joints?|infused|\d+\s*(?:pk|pack)\b|\d+(?:\.\d+)?\s*g\b|eighth|ounce)\b/i;

function isNonConsumable(name, category) {
  if (NON_CONSUMABLE_CATS.has(String(category || ""))) return true;
  const n = String(name || "");
  if (!NON_CONSUMABLE_NAME.test(n)) return false;
  /* The gear word fired. Does the name also say, in its own words, that this is
     something you consume? If so the gear word was incidental. */
  return !CONSUMABLE_SIGNAL.test(n);
}

/* BRAND, WHICH THE SHELF NEEDS AND THE FEED WAS THROWING AWAY.
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

/* STRIPPED SERVER-SIDE AS WELL AS AT CAPTURE, and that is not belt and braces.
   The collector cleans what IT reads, but a capture already in the store was
   written before that existed, and anything posting to /api/coldwater/ingest
   directly never runs the collector at all. The engine escapes what it renders,
   so a body_html reaching the card prints "<p>" and "&nbsp;" at the shopper
   instead of a paragraph. Same reasoning as normalising categories here rather
   than only at capture: the captures ARE the shelf. */
function cleanDesc(v) {
  return String(v || "")
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim().slice(0, 1200);
}





function normCategory(raw, name, sizes) {
  const s = String(raw || "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (s && !NOT_A_CATEGORY.test(s)) {
    const flat = s.replace(/-/g, "");
    for (const [re, label] of CATEGORY_RULES) {
      if (re.test(s) || re.test(flat)) return label;
    }
    /* An unrecognised word is still the shop's own answer, so it is kept rather
       than discarded -- just given one consistent casing so three spellings of
       it cannot split into three filter entries. */
    return String(raw).trim().replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  const n = String(name || "");
  /* GEAR FIRST, because the last resort below is what filed a four-ounce bottle
     of "710 Cleaner" under Flower and put a price per gram on it. The hints
     already catch a grinder and a battery; this catches the solvents, the merch
     and the glass that nobody thought to list. */
  if (NON_CONSUMABLE_NAME.test(n)) return /\b(shirts?|hoodies?|beanies?|socks?|apparel|merch|totes?|mugs?)\b/i.test(n) ? "Apparel" : "Accessories";
  for (const [re, label] of CATEGORY_HINTS) if (re.test(n)) return label;
  /* Last resort, and only for a weight nobody sells anything else by: an eighth,
     a quarter, a half or an ounce is flower (or its offcuts) essentially always,
     where a concentrate is sold by the gram. */
  for (const r of (sizes || [])) {
    if (/\b(eighth|quarter|half|ounce|oz)\b|\d\s*\/\s*\d\s*oz/i.test(String(r && r[0] || ""))) return "Flower";
  }
  return "";
}

/* DEAL ARITHMETIC, and the line between what may be computed and what may not.
 *
 * A multi-buy offer that is not in the per-gram number makes the ranking wrong:
 * "5 for $100" on a $25 cart is $20, and a site that sorts by price per gram
 * while ignoring that puts the wrong shop first on exactly the products people
 * came for. So the unambiguous forms are computed.
 *
 * The ambiguous ones are refused outright, because a confident wrong number is
 * worse than a missing one -- it looks authoritative. "Mix and match" spans
 * different items at different sizes; a bare "BOGO" is buy-one-get-one FREE in
 * some shops and HALF OFF in others; "bundle" and "special" carry no arithmetic
 * at all. None of those produce a figure here.
 *
 * Everything computed carries its qualifying quantity, because the price is
 * conditional: $20 each is true at five, not at one, and a card that hides that
 * is lying by omission even with the right arithmetic.
 */
function dealMath(text, price) {
  const t = String(text || "");
  if (!t || price == null || !(price > 0)) return null;

  /* MIX AND MATCH, which was refused wholesale and is 237 of Herbology's 348
     offers -- 79% of their catalogue ranking at shelf price on a page whose job
     is ranking. The blanket refusal was right about the general form and wrong
     about this one, and the difference is written in the offer itself:

       Mix & Match Vapes $7.50 or 10/$70
       Mix & Match Edibles $6 or 4/$20
       Mix & Match Pre-Packed Flower $30 or 3/$84

     THE OFFER NAMES ITS OWN TIER PRICE, and that is what makes it computable.
     "$7.50 or 10/$70" applies to the $7.50 items; a $25 vape in the same shop is
     covered by a different line ("$25 or 2/$45"). So the stated unit price is
     matched against the ROW price, and a row that is not on that tier is refused
     -- which is the guard the general mix-and-match objection was really about.
     Checked against the live feed: every one of these strings names a price that
     is present as a row on the products carrying it.

     What stays true is that the quantity is met with OTHER products, so this
     cannot be printed as a plain per-gram. It travels with `mix:true` and the
     group name, and the card says "4 for $20, mix & match across Edibles" --
     without that the number is a lie by omission even though the arithmetic is
     right. A bare "mix and match" with no tier price is still refused below. */
  let mm = t.match(/mix\s*(?:and|&|n)\s*match\s+(.*?)\s*\$\s*([\d,]+(?:\.\d+)?)\s*(?:or|,)?\s*(\d+)\s*(?:for|\/)\s*\$\s*([\d,]+(?:\.\d+)?)/i);
  if (mm) {
    const unitStated = parseFloat(mm[2].replace(/,/g, ""));
    const n = parseInt(mm[3], 10);
    const total = parseFloat(mm[4].replace(/,/g, ""));
    const group = String(mm[1] || "").replace(/\s+/g, " ").trim();
    /* Same tier, real saving, real quantity. Any of those failing means this
       offer is not about this row. */
    if (n > 1 && total > 0 && unitStated > 0 &&
        Math.abs(price - unitStated) < 0.005 && total / n < price) {
      return { unit: total / n, minQty: n, basis: mm[0].trim(), mix: true, group };
    }
    return null;
  }
  if (/mix\s*(and|&|n)\s*match/i.test(t)) return null;      // no tier price, no unit price

  /* A MULTI-BUY TOTAL IS ABSOLUTE, and that is what makes it dangerous applied
     to the wrong row. "OZs $90 or 2/$160" is an OUNCE offer; its $80 unit price
     owes nothing to the price of the row it is tested against, so on a $10 gram
     row it computes $80 for one gram and publishes it as a saving. The caller's
     min() keeps that out of the ranking, but the card would still print
     "$80.00/g at 2+" beside a $10 gram. So a total that does not beat the row's
     own price is not this row's offer, and is refused rather than shown. */
  const bulk = (n, total, basis) =>
    (n > 1 && total > 0 && total / n < price)
      ? { unit: total / n, minQty: n, basis } : null;

  /* "5 for $100" -- N of the same thing at a stated total. */
  let m = t.match(/(\d+)\s*for\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
  if (m) {
    const hit = bulk(parseInt(m[1], 10), parseFloat(m[2].replace(/,/g, "")), m[0].trim());
    if (hit) return hit;
  }

  /* "2/$160" -- the same offer written with a slash, which is how Herbology
     writes every one of theirs ("Flower OZs $90 or 2/$160"). 466 of their 597
     products carried an offer that the "for" rule above could not read, so the
     whole catalogue ranked at shelf price.

     THE DOLLAR SIGN IS THE ENTIRE GUARD and it is not decoration: a slash
     between two bare numbers is far more often a WEIGHT ("1/8 oz") or a date
     than an offer, and reading "1/8" as "one for $8" would put an eighth on the
     page at eight dollars an ounce. Requiring $ immediately after the slash
     means a weight can never match, because no shop writes "1/$8 oz". */
  m = t.match(/(\d+)\s*\/\s*\$\s*([\d,]+(?:\.\d+)?)/);
  if (m) {
    const hit = bulk(parseInt(m[1], 10), parseFloat(m[2].replace(/,/g, "")), m[0].trim());
    if (hit) return hit;
  }

  /* "buy 2 get 1 free" -- pay for N, take N+M. The word FREE is required: a
     bare "buy 2 get 1" leaves the discount unstated. */
  m = t.match(/buy\s*(\d+)\s*get\s*(\d+)\s*free/i);
  if (m) {
    const n = parseInt(m[1], 10), extra = parseInt(m[2], 10);
    if (n > 0 && extra > 0) return { unit: (price * n) / (n + extra), minQty: n + extra, basis: m[0].trim() };
  }

  /* "20% off" -- applies to a single unit, so no minimum. */
  /* \b and {1,3}: without them "120% off" matches the "20" inside it and comes
     back as a legitimate fifth off. Capture the whole number, then reject it. */
  m = t.match(/\b(\d{1,3})\s*%\s*off/i);
  if (m) {
    const pct = parseInt(m[1], 10);
    if (pct > 0 && pct < 100) return { unit: price * (1 - pct / 100), minQty: 1, basis: m[0].trim() };
  }

  return null;
}

/* WHAT A GRAM FIGURE MAY PLAUSIBLY BE, per category, and why a ceiling is not
 * fussiness. A pre-roll reached the shelf at 200 grams (see gramsFromTitle), and
 * the reason a wrong weight is worse than a missing one never changes: the page
 * RANKS on price per gram, so an inflated weight makes something look like the
 * cheapest thing in town.
 *
 * Bounds are per category because the honest range differs by an order of
 * magnitude between them -- a pound of flower is real at 448 g and a pound of
 * pre-rolls is not a product. They are still deliberately loose: this catches
 * arithmetic, not pricing.
 *
 * Categories NOT listed keep whatever they had, on purpose. Edibles, drinks and
 * topicals state the weight of a gummy or a bottle, which is a different quantity
 * from grams of cannabis and arguably should carry no per-gram at all -- but that
 * is a judgement about what to publish rather than a parse error, so it is
 * reported in the census (see gramPlausibility) and left for a decision instead
 * of being changed quietly here. */
const GRAM_BOUNDS = {
  "Pre-Rolls": [0.2, 20],
  "Vaporizers": [0.1, 10],
  "Concentrates": [0.1, 100],
  "Flower": [0.5, 500],
  "Trim/Shake": [0.5, 500],
};
const GRAM_BOUNDS_ANY = [0.05, 500];

/* ONE LISTING, MANY SIZES -- the other half of "make it a true sub variant".
 *
 * Several of these menus do not publish a product with a size selector at all:
 * they publish one product PER VARIATION. Lume is the clearest case -- its
 * catalogue is a flat list where the same flower appears once per weight, each
 * entry carrying a `displayVariation` and a single price -- and the rendered-page
 * capture path does the same thing, because Dutchie wraps every weight in its own
 * link. Mapped one-to-one, that is a shelf full of cards with one option each,
 * where the eighth and the ounce of the same jar are two separate products that
 * never sit in the same dropdown. Which is exactly what was reported.
 *
 * So variations are gathered back into the listing they came from, BEFORE
 * toProduct runs -- it computes startsAt, per-gram and stock across the rows, and
 * all three are wrong if it only ever sees one of them.
 *
 * THE KEY IS DELIBERATELY NARROW: same shop, same category, same brand, same name
 * once a trailing weight is stripped off it. Category is in there because a 1 g
 * cart and a 3.5 g jar of one strain are different products that must not merge,
 * and stripping the trailing weight is what lets "Blue Dream 3.5g" and
 * "Blue Dream 28g" recognise each other. Two genuinely distinct listings that
 * agree on all four are two batches of one thing, and offering them as one
 * dropdown of sizes is what a shopper wanted anyway.
 *
 * NOT the engine's groupByStrain, which merges on strain alone and will happily
 * put a cart and a jar on one card. This is stricter on purpose. */
function listingKey(o) {
  const name = String(o.name || "").toLowerCase()
    /* A trailing weight, in the forms these titles use: "... 3.5g", "... (1g)",
       "... - 1/8 oz", "... | Eighth". Only at the END, so "1g Cart Blue Dream"
       keeps its identity. */
    .replace(/[\s,\-|(\[]*\b(\d+(?:\.\d+)?\s*(?:g|gram|grams|oz|ounces?)|\d+\s*\/\s*\d+\s*(?:g|oz)|eighth|quarter|half|ounce)\b\s*[)\]]?\s*$/i, "")
    .replace(/\s+/g, " ").trim();
  if (!name) return "";
  return [name, String(o.category || "").toLowerCase(), String(o.brand || "").toLowerCase()].join("|");
}

/* The trailing weight, off the DISPLAYED title, and only once a merge has
   actually happened. "Blue Dream Cart 1g" is the right name for a listing that
   sells one weight and the wrong one for a card whose dropdown now offers 0.5 g
   and 1 g -- the weight moved into the selector, so it comes out of the title.
   Untouched on a listing that did not merge, because there the title is simply
   what the shop called it. */
function stripTrailingWeight(name) {
  const cut = String(name || "")
    .replace(/[\s,\-|(\[]*\b(\d+(?:\.\d+)?\s*(?:g|gram|grams|oz|ounces?)|\d+\s*\/\s*\d+\s*(?:g|oz)|eighth|quarter|half|ounce)\b\s*[)\]]?\s*$/i, "")
    .replace(/[\s,\-|]+$/, "").trim();
  /* Never return something so short it stops being a name. */
  return cut.length >= 3 ? cut : String(name || "");
}

function mergeListings(raws) {
  const out = [], byKey = new Map();
  for (const o of raws || []) {
    if (!o) continue;
    const key = listingKey(o);
    const prev = key && byKey.get(key);
    if (!prev) { if (key) byKey.set(key, o); out.push(o); continue; }
    prev.name = stripTrailingWeight(prev.name);
    prev.mergedFrom = (prev.mergedFrom || 1) + 1;
    prev.sizes = dedupeRows((prev.sizes || []).concat(o.sizes || []));
    /* The first entry wins on identity and the others fill in its blanks: a
       variation with a photo where the first had none is still this listing's
       photo. */
    for (const f of ["image", "description", "brand", "thc", "coa", "url", "batch", "packagedDate", "deal", "type"]) {
      if (!prev[f] && o[f]) prev[f] = o[f];
    }
    /* Any variation in stock makes the listing in stock; the ROW carries which
       weight is actually gone (slot 5), which is the question that matters. */
    if (o.inStock !== false) prev.inStock = true;
  }
  return out;
}

function toProduct(store, o) {
  const sizes = (o.sizes || []).filter(r => r && r[1] != null);
  const category = normCategory(o.category, o.name, sizes);

  /* NON-CONSUMABLES LOSE THE WEIGHT ITSELF, not just the per-gram, and that
     ordering is the point: the engine re-derives grams from the row label for any
     row that has none, so a "4 oz" bottle of cleaner would come back at 28 g
     however carefully this file nulled perG. Zeroing the weight is what stops the
     arithmetic; `cannabinoid: "Accessory"` below is what stops the engine
     starting it again. Two independent stops, because either alone is a
     half-measure. */
  const nonConsumable = isNonConsumable(o.name, category);
  let description = cleanDesc(o.description);

  /* AND THE LABEL HAS TO STOP SAYING "4 OZ", which is a second, separate stop.
     Zeroing the weight is not enough on its own, because the engine re-derives one
     from the label: its own gramsFromLabel reads "4 oz" as 112 grams, its "an
     ounce or more of product is only ever sold as flower" rule then fires, and the
     bottle of cleaner is filed under THCA Flower -- putting something nobody can
     smoke inside the Flower facet. Measured on the demo shelf before this: the
     engine reported ["710 Cleaner","THCA Flower","Accessory"]. After: Accessories.

     THE SIZE MOVES TO THE DESCRIPTION, which is the one place on that card that
     is printed and never parsed. The two tempting alternatives are both worse:
       - leaving it in the label is what the engine misreads;
       - folding it into the TITLE breaks a join. The engine renames what it
         renders (its strain parser strips a trailing parenthetical), while the
         shopping list and the deal chip look products up by the title the engine
         PRINTED -- so a title the feed extended is a title the list can no longer
         find. Measured: "710 Cleaner (4 oz)" rendered as "710 Cleaner".

     ONLY WHERE THERE IS ONE ROW. Gear sold in two bottle sizes needs its labels
     to tell them apart, and one description cannot. Those keep the shop's labels
     and the engine keeps mis-filing them; `gearWeightLabels` in the census counts
     them, because a handful is a curiosity and a hundred is another look. */
  if (nonConsumable && sizes.length === 1 && weightsIn(String(sizes[0][0] || "")).length) {
    const stated = String(sizes[0][0]).trim();
    if (stated && description.toLowerCase().indexOf(stated.toLowerCase()) < 0) {
      description = (stated + (description ? ". " + description : "")).slice(0, 1200);
    }
    sizes[0][0] = "One Size";
  }

  const gramNotes = [];
  for (const r of sizes) {
    if (!(r[2] > 0)) continue;
    if (nonConsumable) { gramNotes.push({ label: r[0], grams: r[2], why: "non-consumable" }); r[2] = 0; continue; }
    const [lo, hi] = GRAM_BOUNDS[category] || GRAM_BOUNDS_ANY;
    if (r[2] < lo || r[2] > hi) {
      gramNotes.push({ label: r[0], grams: r[2], why: "implausible for " + (category || "an uncategorised product") });
      r[2] = 0;
    }
  }

  const inStock = o.inStock !== false && (!sizes.length || sizes.some(r => r[4] !== false));
  const prices = sizes.map(r => r[1]).filter(n => n != null);
  const startsAt = prices.length ? Math.min.apply(null, prices) : money(o.price);
  let perG = null;
  for (const r of sizes) { if (r[2] > 0 && r[1] != null) { const p = r[1] / r[2]; if (perG == null || p < perG) perG = Math.round(p * 100) / 100; } }

  /* THE SHELF NUMBER IS KEPT, and the deal number is computed beside it. The
     engine sorts on perG, so a deal that is not folded in leaves the ranking
     wrong; but a per-gram that no longer equals price divided by grams needs
     the offer printed next to it or the card reads as an arithmetic error.
     Both travel: shelfPerG is what the label says, perG is what it costs at the
     qualifying quantity, and dealMinQty is that quantity. */
  /* PER-GRAM SANITY. This number is the whole product, and tonight it shipped a
     $10 eighth at four cents a gram because one regex read "1/8 oz" as eight
     ounces. The parser is fixed and pinned, but the class of bug is not: any
     future label form that fools gramsOf() produces a figure that LOOKS real,
     ranks first because it is cheapest, and is the first thing a local shopper
     screenshots.

     So an implausible figure is suppressed rather than published. The card shows
     no per-gram instead of a wrong one -- an absence reads as missing data, a
     wrong number reads as a lie. The bounds are deliberately wide, because this
     is a guard against arithmetic errors and not a judgement about pricing:
     nothing legitimate is under a quarter a gram, and nothing is over a thousand.
     The rejected value is kept so the census can count how often this fires --
     a rising count means a parser problem, not a pricing one. */
  const MIN_PERG = 0.25, MAX_PERG = 1000;
  let perGSuppressed = null;
  if (perG != null && (perG < MIN_PERG || perG > MAX_PERG)) { perGSuppressed = perG; perG = null; }

  const shelfPerG = perG;
  let dealPerG = null, dealPerUnit = null, dealMinQty = null, dealBasis = "", dealMix = false, dealGroup = "";
  for (const r of sizes) {
    if (!(r[2] > 0) || r[1] == null) continue;
    /* A stated sale price on the row is already a real unit price. */
    const stated = (r[7] != null && r[7] > 0 && r[7] < r[1]) ? r[7] : null;
    const d = dealMath(o.deal, r[1]);
    const unit = stated != null ? stated : (d ? d.unit : null);
    if (unit == null) continue;
    const p = Math.round((unit / r[2]) * 100) / 100;
    if (dealPerG == null || p < dealPerG) {
      dealPerG = p;
      /* THE PRICE OF ONE OF THEM, carried beside the per-gram because they are
         different quantities and only one of them is what a shopper hands over.
         dealMath already computes it (total / n) and this dropped it on the
         floor, so the shopping list -- the one surface that has to add up what a
         basket costs -- had nothing to add up with. It reached for dealPerG
         instead, which is per GRAM: a $30 eighth on a 3-for-$84 offer unlocked
         at "$8.00 each" and totalled a three-item basket at $24. Right
         arithmetic, wrong unit, and it looked like a bargain rather than a bug. */
      dealPerUnit = Math.round(unit * 100) / 100;
      dealMinQty = stated != null ? 1 : d.minQty;
      dealBasis = stated != null ? "sale price" : d.basis;
      /* The quantity for a mix-and-match is met with OTHER products, so the card
         has to say so or the per-gram reads as this product's own price. */
      dealMix = stated == null && !!(d && d.mix);
      dealGroup = (stated == null && d && d.group) ? d.group : "";
    }
  }
  if (dealPerG != null && dealPerG < perG) perG = dealPerG;
  /* The deal arithmetic can produce nonsense too, if the offer text was
     misread. Same bounds, same suppression. */
  if (dealPerG != null && (dealPerG < MIN_PERG || dealPerG > MAX_PERG)) {
    dealPerG = null; dealPerUnit = null; dealMinQty = null; dealBasis = "";
  }
  const _rawBrand = normBrand(o.brand, o.name, o.url);
  const _brand = isStoreBrand(_rawBrand, store.name, store.key) ? "" : _rawBrand;
  return {
    id: store.key + "__" + (o.slug || o.id || Math.abs(hash(o.name || "")).toString(36)),
    image: o.image || "", gallery: o.gallery || [],
    /* cleanName here as well as at the join: these run over CAPTURES ALREADY
       STORED, and 1,132 of them carry the artefact in the name right now. */
    name: cleanName(o.name) || "", store: store.name, storeKey: store.key,
    /* Carried at last. The engine ignores an unknown field, and the brand strip
       is built from it -- see the cw-brandrow block in tools/make-coldwater.mjs. */
    /* Rendered by the engine into .ggdesc with its own See-more toggle, so it
       needs no additive block -- it only ever needed a value. */
    /* Computed above rather than inline: a piece of gear has its stated bottle
       size moved in here, where the card prints it and nothing parses it. */
    description,
    /* A SHOP IS NOT A MAKER. A dispensary that files its own-label products
       under its own name would put the store's chip on the brand rail beside
       the store rail -- the same duplication reported on the hemp shelf, where
       Shopify's `vendor` produced it. Derived once here rather than twice,
       which is also what these two lines used to do. */
    brand: _brand,
    brandKey: brandKey(_brand),
    domain: store.site ? safeHost(store.site) : "",
    /* "THCa" and not "THC": the engine's own cannabinoid filter offers exactly
       THCa / CBD / Botanical, and a value outside that set drops the product out
       of the filter AND out of the per-gram display path. State-legal flower is
       sold as total THC, so this is a vocabulary match rather than a chemistry
       claim -- if the Coldwater catalogue ever needs its own word, add it to the
       engine's filter first, not here. */
    /* "Accessory" ON GEAR, and it is the one value here that changes how the
       engine renders rather than how it filters. Its accessory-card branch draws
       no price per gram, no size dropdown and no strain -- which is exactly what
       a bottle of glass cleaner needs, and the only way to stop the engine
       deriving a weight from "4 oz" inside the blob. The cannabinoid FILTER
       offers THCa / CBD / Botanical, so picking one correctly excludes gear while
       "All" still shows it. */
    cannabinoid: nonConsumable ? "Accessory" : "THCa",
    /* Aligned to the engine's own spelling HERE rather than in normCategory,
       because GRAM_BOUNDS and the gear rules above key on the internal label.
       One translation, at the boundary. */
    category: engineCategory(category),
    nonConsumable,
    /* The mirror of the category bug, and it ran the other way: the collector's
       `type` fell back to `o.category`, so Lume published 85 products whose
       STRAIN was "accessories" and 50 whose strain was "edibles". Both fallbacks
       are removed at the capture end; here the junk placeholders every menu
       emits are dropped, because "N/A" (152 at Sapura) and "NOT_APPLICABLE"
       (307 at Herbology) are the shop saying it does not know, and repeating
       that back as a strain is worse than leaving it blank. */
    type: NOT_A_CATEGORY.test(String(o.type || "").trim()) && !/^(hybrid|indica|sativa)/i.test(String(o.type || "").trim())
      ? "" : String(o.type || "").trim(),
    grow: "",
    badges: [], startsAt, sale: startsAt, perG,
    ship: null, added: 0, inStock,
    coa: o.coa || "", ref: "", coupon: "",
    url: o.url || store.site || "",
    potency: o.thc != null ? Number(o.thc) : null,
    /* THE ENGINE SORTS AND FILTERS ON lab.totalThc, NOT ON potency, and that is
       why "Strongest (Total THC)" appeared to do nothing: every product scored
       -1 and the comparator fell through to alphabetical. The THC filter
       (fMinThc) reads the same field, so it was silently passing everything too.
       potency feeds the card's own display; lab.totalThc is what the sort and
       the filter actually consult, so both are set from the one measurement.

       ONLY totalThc. The engine's lab object also carries thca, d9 and CBD from
       a Certificate of Analysis this feed has not read -- inventing those would
       be worse than omitting them. See the cw-lab-honesty block in the
       generator, which suppresses the card's "Lab Verified" badge here for the
       same reason: this figure is the shop's published number, not a COA we
       transcribed. */
    lab: (o.thc != null && isFinite(Number(o.thc)) && Number(o.thc) > 0)
      ? { totalThc: Number(o.thc) } : null,
    /* Carried through wherever a feed offers them. `batch` is the state
       track-and-trace package tag, which is the only durable key a lab result
       could ever be joined on; `packagedDate` is freshness, which no comparison
       site shows. Nothing renders either yet -- they are here so the catalogue
       does not have to be re-read the day something does. */
    /* The shop's own multi-buy offer, carried verbatim. Not folded into
       startsAt or perG: those are shelf prices, and quietly discounting them
       would make every comparison on the page depend on a rule we guessed. */
    deal: o.deal || "",
    shelfPerG, dealPerG, dealPerUnit, dealMinQty, dealBasis, dealMix, dealGroup, perGSuppressed,
    /* What weights were refused and why, so the census can count them. Nothing
       renders this; it is the difference between "this shop has no weights" and
       "this shop's weights are being thrown away", which used to look identical. */
    gramNotes: gramNotes.length ? gramNotes : null,
    batch: o.batch || "",
    packagedDate: o.packagedDate || "",
    subTags: { trim: OFFCUT_RE.test(String(o.name || "")) },
    /* How many per-variation entries were gathered into this listing, so the
       census can say whether a shop publishes size selectors or one card per
       weight. 1 means it arrived whole. Nothing renders it. */
    mergedFrom: o.mergedFrom || 1,
    sizes,
  };
}
function safeHost(u) { try { return new URL(u).host; } catch (e) { return ""; } }
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

/* Dutchie's embedded menus are served by a GraphQL endpoint the visitor's own
   browser calls. `dispensaryId` is the value to discover; the query name and the
   field set below are what the discovery script should confirm before trusting. */
/* Written from Dutchie's documented embedded-menu shape and NOT exercised against
   a live host, because dutchie.com is refused by the proxy here. So it is built
   to fail LOUDLY and usefully: every failure names what actually came back, and
   /api/coldwater?debug&probe dumps the head of the raw response. When you run it
   somewhere with real network access, the error text is the spec. */
async function fromDutchie(store, probe) {
  if (!store.dispensaryId) throw new Error("no dispensaryId");
  const body = JSON.stringify({
    operationName: "FilteredProducts",
    variables: { productsFilter: { dispensaryId: store.dispensaryId, Status: "Active" }, page: 0, perPage: 100 },
    query: "query FilteredProducts($productsFilter:ProductFilterInput!,$page:Int,$perPage:Int){filteredProducts(productsFilter:$productsFilter,page:$page,perPage:$perPage){products{id Name Image brandName type strainType POSMetaData{children{option quantity priceMed}} THCContent{range unit}}}}",
  });
  const r = await get(store.graphqlUrl || "https://dutchie.com/graphql", {
    method: "POST", body,
    headers: { "content-type": "application/json", origin: "https://dutchie.com", referer: "https://dutchie.com/" },
  });
  if (probe) probe.raw = r.text.slice(0, 900);
  if (!r.ok) throw new Error("http " + r.status + " :: " + r.text.slice(0, 200));

  let j;
  try { j = JSON.parse(r.text); }
  catch (e) { throw new Error("not JSON, starts: " + r.text.slice(0, 120)); }

  if (j.errors) throw new Error("graphql errors: " + JSON.stringify(j.errors).slice(0, 240));

  const fp = (j.data || {}).filteredProducts;
  if (!fp) throw new Error("no data.filteredProducts; data keys = " + Object.keys(j.data || {}).join(",") + "; top keys = " + Object.keys(j).join(","));

  const list = fp.products || [];
  if (!list.length) throw new Error("0 products; filteredProducts keys = " + Object.keys(fp).join(","));
  if (probe) probe.first = JSON.stringify(list[0]).slice(0, 600);

  return list.map(p => {
    const kids = (((p.POSMetaData || {}).children) || []);
    const sizes = kids.map((c, i) => {
      const g = gramsOf(c.option);
      return row(c.option || "One Size", c.priceMed, g, (p.id || "") + "-" + i, (c.quantity == null || c.quantity > 0), OFFCUT_RE.test(c.option || ""));
    });
    return toProduct(store, {
      id: p.id, name: p.Name, image: p.Image, category: p.type, type: p.strainType,
      thc: ((p.THCContent || {}).range || [])[0],
      url: store.site, sizes,
    });
  });
}

/* Jane (iheartjane) exposes a per-store menu product feed. store_id is the value
   to discover. Same caveat: verify the field names against a real response. */
async function fromJane(store, probe) {
  if (!store.storeId) throw new Error("no storeId");
  const r = await get(`https://api.iheartjane.com/v1/stores/${encodeURIComponent(store.storeId)}/menu_products?per_page=100`);
  if (probe) probe.raw = r.text.slice(0, 900);
  if (!r.ok) throw new Error("http " + r.status + " :: " + r.text.slice(0, 200));

  let j;
  try { j = JSON.parse(r.text); }
  catch (e) { throw new Error("not JSON, starts: " + r.text.slice(0, 120)); }

  const list = j.menu_products || j.products || [];
  if (!list.length) throw new Error("0 products; response keys = " + Object.keys(j).slice(0, 15).join(","));
  if (probe) probe.first = JSON.stringify(list[0]).slice(0, 600);

  return list.map(p => {
    const sizes = [];
    for (const k of ["gram", "half_gram", "two_gram", "eighth_ounce", "quarter_ounce", "half_ounce", "ounce"]) {
      const price = p["price_" + k];
      if (price != null) sizes.push(row(labelFor(k), price, gramsFor(k), (p.product_id || p.id) + "-" + k, true, OFFCUT_RE.test(p.name || "")));
    }
    return toProduct(store, {
      id: p.product_id || p.id, name: p.name, image: (p.photos && p.photos[0] && p.photos[0].urls && p.photos[0].urls.original) || p.image_urls && p.image_urls[0],
      category: p.kind, type: p.category, thc: p.percent_thc, url: store.site, sizes,
    });
  });
}
const JANE_UNITS = { gram:["1 g",1], half_gram:["0.5 g",0.5], two_gram:["2 g",2], eighth_ounce:["Eighth · 3.5 g",3.5], quarter_ounce:["Quarter · 7 g",7], half_ounce:["Half · 14 g",14], ounce:["Ounce · 28 g",28] };
const labelFor = k => (JANE_UNITS[k] || [k, 0])[0];
const gramsFor = k => (JANE_UNITS[k] || [k, 0])[1];

/* "1/8 oz", "3.5g", "eighth", "1 oz" -> grams. Returns 0 when it cannot tell,
   which makes perG null rather than wrong. */
/* EVERY WEIGHT A LABEL STATES, fraction-aware, in grams. Used only to decide
   whether a label states ONE weight or several -- see the ambiguity guard in
   gramsOf(). Fractions are consumed before bare numbers are read, or the 8 in
   "1/8 oz" would come back as a second, contradictory weight and the guard
   would refuse a label that is perfectly clear. */
function weightsIn(s) {
  const out = [];
  let rest = String(s);
  rest = rest.replace(/(\d+)\s*\/\s*(\d+)\s*(?:oz\b|ounces?\b)/g, (all, n, d) => {
    if (+d) out.push((+n / +d) * 28);
    return " ";
  });
  rest = rest.replace(/(\d+)\s*\/\s*(\d+)\s*(?:g\b|grams?\b)/g, (all, n, d) => {
    if (+d) out.push(+n / +d);
    return " ";
  });
  rest.replace(/([\d.]*\.?\d+)\s*(?:g\b|grams?\b)/g, (all, n) => { out.push(parseFloat(n)); return " "; });
  rest.replace(/([\d.]*\.?\d+)\s*(?:oz\b|ounces?\b)/g, (all, n) => { out.push(parseFloat(n) * 28); return " "; });
  return out.filter(n => isFinite(n) && n > 0);
}

/* "N x Wg" -- a count times the weight of EACH unit, so the total is the product
   of the two. W may itself be a fraction ("2 x 1/2 g").

   THREE ANSWERS, NOT TWO, and the third is the useful one: 0 means "not this
   form, carry on reading", a number means the total, and NaN means "this IS a
   pack and its arithmetic is not believable". A count above 50 or a total over
   half a pound is a bulk line or a misread SKU digit, and falling through to the
   plain gram rule there would publish the weight of ONE unit as the weight of
   the packet -- a per-gram that is a hundred times too high, which is quieter
   than one that is too low but no more true. */
function packEach(s) {
  const W = "(?:(\\d+)\\s*\\/\\s*(\\d+)|([\\d.]*\\.?\\d+))\\s*(?:g\\b|grams?\\b)";
  const val = (n, d, plain) => (d ? (+d ? +n / +d : 0) : parseFloat(plain));
  const total = (n, w) => (n > 0 && n <= 50 && w > 0 && n * w <= 224) ? n * w : NaN;

  let m = String(s).match(new RegExp("(\\d{1,3})\\s*(?:x|\u00d7)\\s*" + W, "i"));
  if (m) return total(parseInt(m[1], 10), val(m[2], m[3], m[4]));
  m = String(s).match(new RegExp(W + "\\s*(?:x|\u00d7)\\s*(\\d{1,3})\\b", "i"));
  if (m) return total(parseInt(m[4], 10), val(m[1], m[2], m[3]));
  return 0;
}

function gramsOf(label) {
  const s = String(label || "").toLowerCase().trim();
  if (!s) return 0;

  /* A LABEL THAT STATES SEVERAL DIFFERENT WEIGHTS STATES NONE OF THEM, and this
     is the guard for the capture that arrives as one row reading "1g 3.5g 7g
     14g 28g" -- a whole size selector read as a single option, which is what
     "the options are all on one line" looks like from the data side. One price
     cannot be attributed to five weights, so no per-gram is derived from it.
     The rows themselves are widened at the source (variantRows below); this is
     the backstop for captures already stored, and it fires BEFORE every rule
     because each of those rules would happily return the first weight it saw.

     Repeats of the SAME weight are not ambiguous: "3.5g (1/8 oz)" and
     "Eighth - 3.5 g" both say one thing twice, which is why this compares
     values rather than counting matches. */
  const seen = weightsIn(s);
  if (seen.length > 1) {
    const lo = Math.min.apply(null, seen), hi = Math.max.apply(null, seen);
    /* A pack form is a count and a weight, not two weights, so it never reaches
       here -- it has exactly one weight expression. */
    if (hi - lo > 0.01) return 0;
  }

  /* THE "EACH" PACK FORM, and it has to run before the fraction rules because
     "2 x 1/2 g" IS a fraction -- read fraction-first it comes back as half a
     gram, which is the weight of one of the two things in the packet. It cannot
     be confused with "1/8 oz" the way the ounce rule was, because it requires an
     x between a count and a weight and a bare fraction has none.

     The other pack form needs no rule at all: "10pk 3.5g" states the weight of
     the PACKAGE, so rule 6 below answers it correctly by taking the figure as it
     stands. The engine multiplies both forms, which is where a 20-pack printed
     with 10 g became 200 g -- see gramsFromTitle above. */
  const each = packEach(s);
  if (Number.isNaN(each)) return 0;        // a pack whose arithmetic is not believable
  if (each) return each;

  /* ORDER IS THE WHOLE BUG. "1/8 oz" used to reach the ounce rule first, whose
     [\d.]+ happily matched the 8 AFTER the slash -- eight ounces, 224 g, and a
     $10 eighth published at four cents a gram. Fractions must be read as
     fractions before any bare number is read as a quantity. */

  /* 1. A fraction of an ounce, written as one: "1/8 oz", "1/2oz". */
  let m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:oz\b|ounce)/);
  if (m) { const n = +m[1], d = +m[2]; if (d) return (n / d) * 28; }

  /* 2. A fraction of a gram, same trap in the other unit. */
  m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:g\b|gram)/);
  if (m) { const n = +m[1], d = +m[2]; if (d) return n / d; }

  /* 2b. THE POUND, WHICH NOTHING HERE COULD READ. Every rule below is written
     in ounces and grams, so a bulk THCa catalogue -- which is what THCA Small
     Buds is -- came back with not one row carrying a weight: "withGrams":0
     against 170 products, so no price-per-gram, no ranking and no "best $/g"
     badge on the entire store. That is the site's whole proposition missing
     for a shop that sells nothing but bulk.

     These MUST be read before the named ounce fractions below, and that
     ordering is the same trap as "1/8 oz" reaching the ounce rule: a pound
     label falling through to /\bquarter\b/ does not fail, it returns 7 g for
     113 and publishes a $180 quarter-pound at $25.71/g instead of $1.59/g.
     Inside the MIN_PERG/MAX_PERG bounds, so nothing catches it downstream -- a
     confident wrong number, which is worse than none.

     A pound is 16 of the 28 g ounces this file already uses, not 453.59.
     Internal consistency beats metric precision: every figure on the shelf is
     comparable to every other, which is the only thing the number is for. */
  m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:lbs?\b|pounds?\b)/);
  if (m) { const n = +m[1], d = +m[2]; if (d) return (n / d) * 448; }
  if (/\bquarter\s*(?:lb|lbs|pound)/.test(s)) return 112;
  if (/\bhalf\s*(?:lb|lbs|pound)/.test(s)) return 224;
  if (/\beighth\s*(?:lb|lbs|pound)/.test(s)) return 56;
  /* QP and HP, the trade's own shorthand and how these dropdowns are actually
     labelled. THE WHOLE LABEL, not a prefix: "HP Sauce Gummies" is a product
     and two letters that common cannot be read as a weight on the strength of
     appearing first. A parenthetical gloss is still the same label. */
  if (/^q\.?\s*p\.?\s*(?:\(.*\))?$/.test(s)) return 112;
  if (/^h\.?\s*p\.?\s*(?:\(.*\))?$/.test(s)) return 224;

  /* 3. Named fractions. */
  if (/\beighth\b/.test(s)) return 3.5;
  if (/\bquarter\b/.test(s)) return 7;
  if (/\bhalf\b/.test(s)) return 14;

  /* 4. A bare fraction with no unit is an ounce fraction on these menus. */
  m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) { const n = +m[1], d = +m[2]; if (d) return (n / d) * 28; }

  /* 5. An unqualified ounce. */
  if (!/\d/.test(s) && /\bounce\b|\boz\b/.test(s)) return 28;

  /* 6. Explicit grams. The \b matters: without it "10 mg" reads as 10 grams. */
  m = s.match(/([\d.]+)\s*(?:g\b|grams?\b)/);
  if (m) return parseFloat(m[1]);

  /* 7. Explicit ounces. */
  m = s.match(/([\d.]+)\s*(?:oz\b|ounces?\b)/);
  if (m) return parseFloat(m[1]) * 28;

  /* 8. Explicit pounds, and the unqualified one. The unqualified rule is the
     WHOLE label rather than a word inside it, because POUND CAKE IS A STRAIN
     and textHarvest() offers this function the printed line above a price as
     a candidate size. Read loosely, a $45 eighth of Pound Cake becomes 448 g
     at ten cents a gram, ranks first because it is cheapest, and is the first
     thing a shopper screenshots. The ounce rule below it can afford to be
     loose; nobody names a strain Ounce. */
  m = s.match(/([\d.]+)\s*(?:lbs?\b|pounds?\b)/);
  if (m) return parseFloat(m[1]) * 448;
  if (/^(?:one\s+)?(?:lbs?|pounds?)\.?$/.test(s)) return 448;

  return 0;
}

/* Lume: read their own page and lift the server-rendered catalogue out of
   __NEXT_DATA__. No API to reverse and no third party in the path -- this is the
   HTML their site hands every visitor.

   The location assert is the whole safety story. Lume picks the store from a
   cookie, so a missing or stale one does not error, it quietly serves a
   DIFFERENT store's prices. Publishing Okemos prices under a Coldwater heading
   is worse than publishing nothing, so a mismatch is a hard failure that names
   what it got. */
async function fromLume(store, probe) {
  const r = await get(store.menuUrl || "https://www.lume.com/shop/all", {
    headers: {
      accept: "text/html,application/xhtml+xml",
      ...(store.storeCookie ? { cookie: store.storeCookie } : {}),
    },
  });
  if (probe) probe.raw = r.text.slice(0, 400);
  if (!r.ok) throw new Error("http " + r.status);

  const m = r.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ in page (" + r.text.length + " bytes)");

  let pp;
  try { pp = JSON.parse(m[1]).props.pageProps; }
  catch (e) { throw new Error("__NEXT_DATA__ did not parse: " + e.message); }

  const loc = pp.location || (pp.initialState && pp.initialState.storeSelection) || "";
  const want = store.expectLocation || "Coldwater";
  if (String(loc).toLowerCase() !== want.toLowerCase())
    throw new Error(`wrong store: page says "${loc}", expected "${want}" -- set storeCookie`);

  const list = pp.products || [];
  if (!list.length) throw new Error("0 products; pageProps keys = " + Object.keys(pp).slice(0, 20).join(","));
  if (probe) probe.first = JSON.stringify(list[0]).slice(0, 700);

  /* LUME PUBLISHES ONE ENTRY PER VARIATION, so this maps to raw listings first and
     merges them before toProduct sees any of it -- otherwise the same jar arrives
     as an eighth card and an ounce card, each with one option in its dropdown,
     and startsAt / per-gram / stock are all computed over one row. */
  const raws = list.map(p => {
    const cents = p.price && p.price.centAmount;
    const price = cents != null ? cents / 100 : null;
    const label = p.displayVariation || p.variation || "One Size";
    const grams = gramsOf(label);
    const offcut = OFFCUT_RE.test(p.name || "") || OFFCUT_RE.test(p.subcategory || "");
    return ({
      id: p.SKU || p.batchSKU,
      name: [p.brand, p.name].filter(Boolean).join(" ").trim() || p.name,
      image: (p.images && p.images[0] && p.images[0].url) || "",
      category: p.category || "",
      type: p.classification || p.strain || "",
      thc: p.percentTHC,
      url: p.url ? "https://www.lume.com" + p.url : store.site,
      /* Metrc package tag and pack date ride along: nothing renders them yet, but
         the tag is what a lab result would ever be joined on, and throwing it
         away here would mean re-scraping the whole catalogue to get it back. */
      batch: p.batchName || "",
      packagedDate: p.packagedDate || "",
      sizes: [row(label, price, grams, p.SKU || p.batchSKU, String(p.status || "").toLowerCase() !== "inactive", offcut)],
    });
  });
  return mergeListings(raws).map(o => toProduct(store, o));
}

/* WooCommerce Store API, on the shop's OWN domain.
   Sapura's menu page is a 47 KB shell with nothing but a Dutchie loader in it,
   and Dutchie answers a server with a Cloudflare challenge. But the same page
   declares WordPress 7.0.2 + WooCommerce 10.9.4, exposes /wp-json/, and carries
   woo-variation-swatches and the variable-product templates. So there is a
   second, first-party catalogue on sapuralife.com that has nothing to do with
   Dutchie -- and wc/store/v1 is public and unauthenticated by default.

   WHAT THIS PROBABLY IS, said plainly rather than oversold: state-legal cannabis
   sales run through the licensed POS, which is what Dutchie fronts. So this Woo
   store most likely holds the non-plant goods -- accessories and apparel -- and
   possibly nothing else. That is still real Sapura inventory and it is still
   worth having; it is simply not the flower menu, and nobody should assume it is
   until the probe says otherwise.

   Money arrives in MINOR UNITS here (api/products.js learned that the hard way
   from CBD Hemp Direct), so divide by 10^currency_minor_unit rather than by a
   hardcoded 100. */
async function fromWoo(store, probe) {
  const base = (store.wooBase || "").replace(/\/+$/, "");
  if (!base) throw new Error("no wooBase");
  const url = base + "/wp-json/wc/store/v1/products?per_page=100&orderby=id&order=asc";
  const r = await get(url);
  if (probe) probe.raw = r.text.slice(0, 900);
  if (!r.ok) throw new Error("http " + r.status + " :: " + r.text.slice(0, 200));

  let list;
  try { list = JSON.parse(r.text); }
  catch (e) { throw new Error("not JSON, starts: " + r.text.slice(0, 120)); }

  if (!Array.isArray(list)) throw new Error("expected an array; got keys = " + Object.keys(list || {}).slice(0, 12).join(","));
  if (!list.length) throw new Error("0 products (Woo is installed but its catalogue is empty or hidden)");
  if (probe) probe.first = JSON.stringify(list[0]).slice(0, 700);

  return list.map(p => {
    const pr = p.prices || {};
    const minor = Number(pr.currency_minor_unit != null ? pr.currency_minor_unit : 2);
    const div = Math.pow(10, minor);
    const price = pr.price != null && pr.price !== "" ? Number(pr.price) / div : null;
    const label = "One Size";
    const cat = ((p.categories || [])[0] || {}).name || "";
    return toProduct(store, {
      id: p.id, name: p.name || "",
      image: ((p.images || [])[0] || {}).src || "",
      category: cat, type: "",
      url: p.permalink || store.site,
      sizes: [row(label, price, gramsOf(p.name || ""), p.id, p.is_in_stock !== false, OFFCUT_RE.test(p.name || ""))],
    });
  });
}

/* GENERIC SERVER-SIDE READER, and the one that should have been written first.
 *
 * fromLume() is hand-fitted to Lume's payload. That was right for the richest
 * feed here, and wrong as a general habit: a bespoke adapter per storefront is
 * five adapters to write and five to re-write the next time anyone redesigns.
 *
 * This is the collector's rule moved server-side. Rather than know a shape, walk
 * the page's own JSON -- __NEXT_DATA__, embedded application/json, ld+json --
 * and keep the largest array of things carrying BOTH a name and a price. That
 * single test already covers every Next.js storefront in this town: Flowhub
 * (The Dude Abides, 960 KB server-rendered), Tymber (Banzen), and Lume itself.
 *
 * It works on The Dude Abides because their STOREFRONT answers a plain server
 * GET with 200 even though their API origin is challenged -- the page is served,
 * so read the page.
 */
const G_NAME  = ["name", "productName", "title", "Name", "product_name"];
const G_PRICE = ["price", "prices", "centAmount", "priceMed", "displayPrice", "amount", "cost"];

/* The variant arrays these platforms use, by every name they use for them. */
const G_VARIANTS = ["variants", "sizes", "options", "weights"];
function gVariants(o) {
  for (const k of G_VARIANTS) if (Array.isArray(o[k]) && o[k].length) return o[k];
  if (o.POSMetaData && Array.isArray(o.POSMetaData.children) && o.POSMetaData.children.length) return o.POSMetaData.children;
  return null;
}

function gPick(o, keys) { for (const k of keys) if (o[k] != null) return o[k]; return null; }
function gIsProduct(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const n = gPick(o, G_NAME);
  if (typeof n !== "string" || n.length < 2 || n.length > 200) return false;
  if (gPick(o, G_PRICE) != null) return true;
  /* A PRICE IN THE VARIANTS COUNTS. Requiring one on the product itself was
     silently wrong for exactly the catalogues this reader exists to read: a
     flower listing with an eighth, a quarter and an ounce very often carries no
     top-level price at all, because there isn't one -- the price belongs to the
     weight. Such a product was rejected here and the array it was in never won
     the "largest array of product-shaped objects" contest, so a fully readable
     menu came back as "found no array of name+price objects". The downstream
     code already handles variant-only pricing; only this gate disagreed. */
  const vs = gVariants(o);
  return !!(vs && vs.some(v => v && typeof v === "object" && gPick(v, G_PRICE) != null));
}
/* Dollars, cents and {centAmount} all turn up. Getting this wrong by 100x would
   poison the feed, so: explicit minor units win, then an object, then a bare
   number -- and a bare integer over 1000 is cents, because nobody sells a
   $1,200 eighth. Same rule as the collector, deliberately. */
function gMoney(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v.centAmount != null) {
      const d = v.fractionDigits != null ? v.fractionDigits : (v.currency_minor_unit != null ? v.currency_minor_unit : 2);
      return Number(v.centAmount) / Math.pow(10, d);
    }
    for (const k in v) { const m = gMoney(v[k]); if (m != null) return m; }
    return null;
  }
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return null;
  return (Number.isInteger(n) && n > 1000) ? n / 100 : n;
}

/* Recover JSON from a Next.js App Router (RSC) streamed payload.
 *
 * The page carries its data as a run of self.__next_f.push([1,"<chunk>"])
 * calls, where each chunk is a JS string literal holding a slice of the flight
 * stream. Concatenated, that stream is a sequence of "<id>:<json>" rows -- but
 * the rows are not reliably newline-delimited once a chunk boundary lands mid
 * value, so splitting on \n loses data. Scan for balanced JSON instead, which
 * does not care where the chunk seams fell.
 *
 * ONLY ARRAYS-OF-OBJECTS ARE HUNTED, starting at a literal [{ -- that is the
 * shape a product list has, and it keeps this from attempting a parse at every
 * one of the ~40,000 braces in a megabyte of flight data. Everything else about
 * the page is left alone.
 */
function rscRoots(text) {
  const roots = [];
  const pushes = text.match(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\[\s\S])*")\]\)/g);
  if (!pushes || !pushes.length) return roots;

  let buf = "";
  for (const p of pushes) {
    const lit = p.match(/\[1,("(?:[^"\\]|\\[\s\S])*")\]/);
    if (lit) buf += unquote(lit[1]);
  }
  return arraysFromChunks([buf]);
}

/* JSON SHIPPED AS ESCAPED TEXT INSIDE JS STRING LITERALS, WHICH IS HOW BOTH
   STREAMING FRAMEWORKS THIS READER MEETS DELIVER A MENU. Next's App Router
   pushes `self.__next_f.push([1,"...")`; Remix's deferred loaders push
   `__remixContext.streamController.enqueue("...")`. Same idea, same escaping,
   and -- the part that matters -- the payload is SPLIT ACROSS SEVERAL CALLS at
   arbitrary points, so each literal is a fragment and only the concatenation is
   parseable. That is why the chunks are joined before anything is scanned.

   Written once and shared, because a second copy of this is exactly what this
   codebase keeps paying for: rscRoots() had it and remixRoots() did not, and
   the consequence was The Dude Abides publishing its price tier table as nine
   products for weeks. */
function arraysFromChunks(chunks, cap = 40) {
  let buf = "";
  for (const c of chunks) buf += c;
  const out = [];
  if (!buf) return out;
  let i = 0, tried = 0;
  while (i < buf.length && out.length < cap && tried < 400) {
    const at = buf.indexOf("[{", i);
    if (at < 0) break;
    tried++;
    const end = balancedEnd(buf, at);
    if (end < 0) { i = at + 2; continue; }
    try {
      const v = JSON.parse(buf.slice(at, end));
      if (Array.isArray(v) && v.length) { out.push(v); i = end; continue; }
    } catch (e) { /* not a complete value here */ }
    i = at + 2;
  }
  return out;
}

/* Unescape one JS string literal into the bytes it stands for. JSON.parse is the
   unescaper -- these are JSON-style escapes -- and it never evaluates page
   script. Returns "" for anything it cannot read. */
function unquote(lit) { try { return JSON.parse(lit); } catch (e) { return ""; } }

/* Index just past the value starting at `start`, or -1 if it never closes.
   String-aware, so a bracket inside a product description cannot end it. */
function balancedEnd(s, start) {
  let depth = 0, inStr = false, esc = false;
  const cap = Math.min(s.length, start + 4e6);
  for (let i = start; i < cap; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/* REMIX HYDRATION, and why neither existing pass could see it.
 *
 * The Dude Abides answers a plain GET with 964 KB of server-rendered menu and
 * this reader said "no parseable JSON ... no __NEXT_DATA__, no JSON script tag,
 * no RSC chunks" for months. All three of those were true and the conclusion was
 * wrong: the shop is a REMIX app, and Remix ships its loader data as
 *
 *     window.__remixContext = { ... };                     <- the assignment
 *     __remixContext.r("route", "key", [ ... ]);           <- deferred data
 *
 * The first is an assignment to a global rather than a script tag, and the
 * second is a FUNCTION CALL WITH JSON ARGUMENTS -- not a tag, not an assignment,
 * not an RSC push. Nothing that scanned for a container could find it, and the
 * error message named the three things it had looked for, which read as "the
 * page is empty" rather than as "I know four shapes and this is a fifth".
 *
 * The arguments are walked rather than pattern-matched, because the interesting
 * one is not always in the same position and a regex that assumed it would be is
 * how this class of reader breaks on the next redesign.
 */
function skipJsString(s, i) {
  /* i points AT the opening quote. */
  for (let j = i + 1, esc = false; j < s.length; j++) {
    const c = s[j];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') return j + 1;
  }
  return s.length;
}

/* REMIX RENAMED ITSELF, AND THE READER HAS TO KNOW BOTH NAMES. React Router 7
   is Remix's successor and ships the identical hydration payload and deferred
   stream under `__reactRouterContext`. A reader that knows only the old name
   reads the synchronous half of such a page and none of the deferred half --
   which looks exactly like a shop with a tiny menu rather than like a reader
   that is one word out of date. Accepting both can only ever find MORE payloads:
   what actually gets published is still decided by the catalogue scorer. */
const REMIX_GLOBALS = ["__remixContext", "__reactRouterContext"];

function remixRoots(text) {
  const out = [];
  for (const g of REMIX_GLOBALS) {
    const at = text.indexOf(g + " =");
    if (at < 0) continue;
    const b = text.indexOf("{", at);
    if (b >= 0) {
      const end = balancedEnd(text, b);
      if (end > 0) { try { out.push(JSON.parse(text.slice(b, end))); } catch (e) {} }
    }
  }
  /* Every __remixContext.<fn>( call, and every JSON-shaped argument inside it.
     Capped, because a runaway match on a megabyte of markup is a timeout rather
     than an error and those are the hardest to diagnose. */
  /* A DOTTED PATH, NOT ONE LEVEL. The call that carries the deferred menu is
     `__remixContext.streamController.enqueue(`, and a single-segment pattern
     matches `__remixContext.streamController` and then demands a `(` where the
     next `.` actually is -- so it never fires on the one call that matters. */
  const re = /(?:__remixContext|__reactRouterContext)(?:\.[a-zA-Z_$][\w$]*)+\(/g;
  let m;
  /* THE STRING ARGUMENTS ARE THE DEFERRED MENU, AND THEY USED TO BE SKIPPED.
     A Remix route that defers its slow loader -- which a dispensary menu always
     is -- ships nothing but the CHEAP data in the `__remixContext = {...}`
     global above, and streams the rest as
     `__remixContext.streamController.enqueue("<escaped json>")`.
     This loop walked past those: it steps over a string looking for a JSON
     argument AFTER it, which is right for the calls whose payload really is a
     later argument, and blind for the ones where the payload IS the string.
     The Dude Abides is the second kind. Measured against the real reader before
     this line existed: the tier table parsed, the products did not, and the shop
     published `Ounce / Half / Quarter / Eighth / Grams` as nine products.
     Collected across the WHOLE page and joined once, because the stream splits
     mid-JSON and no single chunk parses on its own. */
  const chunks = [];
  while ((m = re.exec(text)) && out.length < 80) {
    let i = m.index + m[0].length;
    for (let guard = 0; guard < 8 && i < text.length; guard++) {
      while (i < text.length && (text[i] === " " || text[i] === "," || text[i] === "\n" || text[i] === "\t")) i++;
      const c = text[i];
      if (c === '"') {
        const from = i;
        i = skipJsString(text, i);
        if (chunks.length < 400) chunks.push(unquote(text.slice(from, i)));
        continue;
      }
      if (c === "[" || c === "{") {
        const end = balancedEnd(text, i);
        if (end < 0) break;
        try { out.push(JSON.parse(text.slice(i, end))); } catch (e) {}
        i = end;
        continue;
      }
      break;   /* a number, null, or the closing paren: nothing more to read */
    }
  }
  for (const arr of arraysFromChunks(chunks)) out.push(arr);
  return out;
}

async function fromGeneric(store, probe) {
  const url = store.menuUrl || store.site;
  if (!url) throw new Error("no menuUrl");
  const r = await get(url, { timeout: 20000, headers: { accept: "text/html,application/xhtml+xml" } });
  if (probe) probe.raw = r.text.slice(0, 300);
  if (!r.ok) throw new Error("http " + r.status + " :: " + r.text.slice(0, 160));

  /* WHICH READER ANSWERED, COUNTED PER SOURCE. Four extractors feed `roots` and
     the probe only ever reported the total, so a page that parsed but parsed the
     WRONG THING was indistinguishable from one where three readers found nothing
     and the fourth found a stray blob. Diagnosing The Dude Abides from a
     container with no egress cost two wrong hypotheses before this existed --
     the scorer was blamed, then gIsProduct, and both were working correctly.
     Same rule the collector already follows: a failure names its cause. */
  const tally = { nextData: 0, jsonTags: 0, rsc: 0, remix: 0 };
  const roots = [];
  const nd = r.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nd) { try { roots.push(JSON.parse(nd[1])); tally.nextData++; } catch (e) {} }
  const tags = r.text.match(/<script[^>]+type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g) || [];
  for (const t of tags.slice(0, 40)) {
    const m = t.match(/>([\s\S]*)</);
    if (m) { try { roots.push(JSON.parse(m[1])); tally.jsonTags++; } catch (e) {} }
  }
  /* THE APP ROUTER DOES NOT SHIP __NEXT_DATA__, and that is the whole reason
     this reader reported "no parseable JSON in 960541 bytes (page may render
     client-side)" against The Dude Abides -- a page that server-renders its
     entire menu. The bytes were there and the diagnosis was wrong. Next's App
     Router streams its payload as a series of self.__next_f.push([1,"..."])
     calls instead, so the JSON is present but escaped inside JS string
     literals rather than sitting in a script tag. See rscRoots(). */
  for (const root of rscRoots(r.text)) { roots.push(root); tally.rsc++; }
  for (const root of remixRoots(r.text)) { roots.push(root); tally.remix++; }

  /* WHAT THE PAGE ACTUALLY IS, read off its own markers rather than guessed.
     When every reader comes back thin, the next move depends entirely on which
     framework is shipping the menu -- and cycling through readers on a hunch is
     what the Lookah note warns against, because each attempt is a real request
     to somebody else's site. Presence here is a fact about the HTML; it says a
     payload of that shape EXISTS, which is a different claim from having parsed
     it, and the gap between the two columns is the bug. */
  if (probe) {
    probe.readers = tally;
    probe.bytes = r.text.length;
    probe.markers = {
      nextData:   /id="__NEXT_DATA__"/.test(r.text),
      nextFlight: /self\.__next_f/.test(r.text),
      remixCtx:   /window\.__remixContext/.test(r.text),
      remixStream:/__remixRouteModules|window\.__reactRouter/.test(r.text),
      apollo:     /__APOLLO_STATE__/.test(r.text),
      nuxt:       /window\.__NUXT__/.test(r.text),
      sveltekit:  /__sveltekit_/.test(r.text),
      routerData: /__staticRouterHydrationData/.test(r.text),
      jsonTags:   (r.text.match(/<script[^>]+type="application\/(?:ld\+)?json"/g) || []).length,
      /* REMIX RENAMED ITSELF. React Router 7 ships the same streaming payload
         under __reactRouterContext, so a reader that only knows __remixContext
         sees the synchronous half and none of the deferred half -- which is
         exactly the shape of this bug. Counted separately from remixCtx so the
         two cannot be confused. */
      reactRouterCtx: /__reactRouterContext/.test(r.text),
      streamCtl:  (r.text.match(/streamController/g) || []).length,
      enqueue:    (r.text.match(/\.enqueue\(/g) || []).length,
    };
    /* THE ACTUAL SYNTAX, not a guess at it. Two deploy cycles were spent
       inferring how this page spells its streaming call; an excerpt around the
       first one answers it in a single look and costs 400 bytes. */
    const at = r.text.search(/streamController|__reactRouterContext|\.enqueue\(/);
    probe.streamSample = at < 0 ? "" : r.text.slice(Math.max(0, at - 80), at + 320);
  }
  if (!roots.length) throw new Error("no parseable JSON in " + r.text.length + " bytes (no __NEXT_DATA__, no JSON script tag, no RSC chunks, no __remixContext)");

  const seen = new Set();
  let best = [], bestScore = -1;
  /* A PRICE TIER IS NOT A PRODUCT, and it satisfies every test that says one is.
     The Dude Abides publishes a weight table -- {name:"Ounce (28g)", weight:28,
     price:5000} -- thirty-two of them, and it won outright: a name, a price,
     more of them than any single carousel holds. The store went from a hard
     error to five rows, which is worse than the error because it looks like a
     working scrape of a five-product dispensary.
     So an array is judged on how much CATALOGUE it carries, not only on length.
     A real listing has a brand, a category, a picture or its own product name; a
     tier has a weight and a price. Length still breaks ties, so every store that
     was reading correctly before is unaffected. */
  const CATALOGUE_KEYS = ["brand", "category", "product_name", "productName", "variant_name",
                          "variantName", "sku", "image", "image_url", "imageUrl", "thumbnail",
                          "strain", "description", "slug"];
  const catalogueScore = arr => {
    let n = 0;
    for (const o of arr.slice(0, 24)) for (const k of CATALOGUE_KEYS) if (o && o[k] != null && o[k] !== "") n++;
    return n / Math.min(arr.length, 24);
  };
  /* THE UNION, BESIDE THE LARGEST ARRAY, because a carousel menu has neither
     shape the "largest array wins" rule was written for. The Dude Abides ships
     its page as roughly fourteen carousels of TWELVE products each -- "Best
     Selling", "New", "On Sale" and so on -- so the largest single array is 12
     and the page actually carries about 167. Taking the largest would have
     reported a twelve-product dispensary and looked like a success.
     Deduped on name plus variant plus price, since the same jar appears in
     several carousels by design. A facet or a filter cannot get in here: it has
     no price, and gIsProduct requires one on the object or in its variants. */
  const union = new Map();
  /* DEPTH 14, NOT 8. Remix nests its loader data as
     root > state > loaderData > <routeId> > <deferredKey> > [carousel] >
     products > product, which is nine levels down before a product is even
     visible -- so the menu was being cut off by the guard rather than missed by
     the parser. The `seen` set is what actually stops this running away; the
     depth number is a belt, and it was buckled too tight. */
  (function walk(node, depth) {
    if (!node || depth > 14 || (typeof node === "object" && seen.has(node))) return;
    if (typeof node === "object") seen.add(node);
    if (Array.isArray(node)) {
      const hits = node.filter(gIsProduct);
      if (hits.length) {
        const sc = catalogueScore(hits);
        /* Clearly richer wins outright; similarly rich, longer wins. */
        const better = sc > bestScore + 0.5 ? true
                     : sc < bestScore - 0.5 ? false
                     : hits.length > best.length;
        if (better) { best = hits; bestScore = sc; }
      }
      for (const h of hits) {
        const k = [gPick(h, G_NAME), h.variant_name || h.variantName || "", gPick(h, G_PRICE)].join("|");
        if (!union.has(k)) union.set(k, h);
      }
      for (let i = 0; i < node.length && i < 4000; i++) walk(node[i], depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const k in node) { try { walk(node[k], depth + 1); } catch (e) {} }
  })(roots, 0);

  if (union.size > best.length) best = [...union.values()];
  if (probe) probe.shape = { roots: roots.length, largestArray: best.length, union: union.size };

  if (!best.length) throw new Error("parsed " + roots.length + " JSON roots, found no array of name+price objects");
  if (probe) probe.first = JSON.stringify(best[0]).slice(0, 700);

  /* A PRICE LIST IS NOT A MENU, AND PUBLISHING ONE IS WORSE THAN PUBLISHING
     NOTHING. The Dude Abides ships a weight table -- {name:"Ounce (28g)",
     weight:28, price:7500} and 32 more like it -- and its actual menu lives in
     957KB of server-rendered MARKUP, in no JSON payload at all. Measured: no
     __NEXT_DATA__, no JSON script tags, no RSC chunks, no streaming
     (streamController 0, .enqueue( 0), three __remixContext roots holding 33
     objects of which every one is a tier.
     So the scorer did its job and there was simply nothing better in the page.
     What it published was `Ounce / Half / Quarter / Eighth / Grams` as nine
     products, on a public city page, with no images, no categories and no THC.

     THREE OUTCOMES LOOK IDENTICAL FROM A ROW COUNT AND NEED OPPOSITE RESPONSES
     -- walled, empty, errored -- which is why this refuses rather than returns.
     A shop reporting an error gets looked at and handed to the operator's
     bookmarklet lane, which reads rendered markup in a real browser and is the
     right tool for a page like this. A shop quietly serving its price list
     looks like a working scrape of a nine-product dispensary and gets left
     alone for weeks, which is exactly what happened.

     THE TEST IS CATALOGUE SIGNAL, NOT A NAME PATTERN. Matching "Ounce" or
     "Eighth" would be a guess about one shop's vocabulary and would refuse a
     real listing called "Ounce of Gelato". A genuine menu row carries a brand,
     a category, an image, a slug, a description or a product name -- something
     beyond a label and a number. Anything that carries NONE of those, across
     the whole sample, is a price list whatever it is called. */
  const bestScore2 = catalogueScore(best);
  if (bestScore2 < 0.25) {
    throw new Error("found " + best.length + " name+price rows with no catalogue signal " +
      "(no brand, category, image, slug or description on any of them) -- this looks like a " +
      "price tier table rather than a menu, so nothing was published. The menu is probably in " +
      "rendered markup: use the bookmarklet lane for this shop.");
  }

  const out = [];
  for (const o of best) {
    const name = String(gPick(o, G_NAME) || "").trim();
    if (!name) continue;
    /* One reader for every variant shape, so this path and the collector agree
       about what a size selector is -- see variantRows() for the five shapes and
       the two refusals. It replaces an inline block that understood only an array
       of objects, which is why a menu publishing parallel option/price arrays
       came out with a single "One Size" row at the cheapest variation's price. */
    const sizes = variantRows(o, name, name);
    if (!sizes.length) {
      const p = gMoney(gPick(o, G_PRICE));
      if (p == null) continue;
      const lab = String(o.displayVariation || o.variation || o.weight || o.size || "One Size");
      sizes.push(row(lab, p, gramsOf(lab), name, o.inStock !== false, OFFCUT_RE.test(lab) || OFFCUT_RE.test(name)));
    }
    let img = o.image || o.imageUrl || (Array.isArray(o.images) && o.images[0]);
    if (img && typeof img === "object") img = img.url || img.src || "";
    let href = o.url || o.permalink || o.link || "";
    if (href && href.charAt(0) === "/") { try { href = new URL(url).origin + href; } catch (e) {} }

    out.push({
      id: o.id || o.SKU || name,
      name: cleanName([o.brand && (o.brand.name || o.brand), name]
        .filter(v => typeof v === "string" && v).join(" ")) || cleanName(name),
      brand: (o.brand && (o.brand.name || o.brand)) || "",
      image: String(img || ""), category: String(o.category || o.kind || o.subcategory || ""),
      type: String(o.strain || o.strainType || o.classification || ""),
      thc: o.percentTHC != null ? o.percentTHC : o.thc,
      url: String(href || url), batch: String(o.batchName || o.batch || ""),
      packagedDate: String(o.packagedDate || ""),
      sizes,
    });
  }
  if (!out.length) throw new Error("found " + best.length + " candidates but none produced a priced row");
  /* A page listing one entry per weight is gathered back into one listing with a
     row per weight, for the reason mergeListings() gives. Storefronts that
     already publish a variant array are untouched by it: their key is unique per
     listing, so nothing merges. */
  return mergeListings(out).map(o => toProduct(store, o));
}

const ADAPTERS = { dutchie: fromDutchie, jane: fromJane, lume: fromLume, woo: fromWoo, generic: fromGeneric };

/* ----------------------------------------------------------------- diag --- */
/* /api/coldwater?diag=<key|all>
 *
 * A manual probe bench. One adapter failing tells you that route is shut; it does
 * NOT tell you the shop has no readable catalogue, and conflating those two is a
 * mistake this file made once already -- Sapura was written off after three
 * endpoints when the embedded-menu loader, which exists precisely to be fetched
 * by other people's websites, had never been tried at all.
 *
 * So: candidates per store, tried in order, every one reported with status,
 * content-type, size and the first bytes. GET only, sequential, spaced, never
 * cached. It is a bench, not a hot path -- nothing here runs for a visitor.
 */
const DIAG = {
  sapura: [
    /* Built to be loaded cross-origin by the merchant's own site, so it cannot
       be gated the way the GraphQL API is. The first thing to have tried. */
    ["embed loader",      "https://dutchie.com/api/v2/embedded-menu/6226401db296a22c98dfb676.js"],
    ["embed menu json",   "https://dutchie.com/api/v2/embedded-menu/6226401db296a22c98dfb676"],
    /* The loader turned out to be a thin iframe bootstrapper -- no api paths and
       no graphql strings anywhere in its 43 KB. So the data is fetched by
       whatever is INSIDE the iframe, and these are the iframe's own address.
       If any of them server-renders, the catalogue is in the HTML. */
    ["iframe root",       "https://dutchie.com/embedded-menu/6226401db296a22c98dfb676"],
    ["iframe products",   "https://dutchie.com/embedded-menu/6226401db296a22c98dfb676/products"],
    ["dispensary page",   "https://dutchie.com/dispensary/sapura"],
    /* The same bundle references seo-utils.dutchie.com, which is Dutchie's own
       crawler-facing service. A menu platform that runs SEO utilities is
       rendering menu content for crawlers somewhere; this asks where. */
    ["seo utils root",    "https://seo-utils.dutchie.com/"],
    ["seo utils menu",    "https://seo-utils.dutchie.com/menu/6226401db296a22c98dfb676"],
    ["dutchie robots",    "https://dutchie.com/robots.txt"],
    ["dutchie sitemap",   "https://dutchie.com/sitemap.xml"],
    /* The WP REST index lists every registered route. If Woo is exposing
       anything at all this names it, instead of us guessing paths. */
    ["wp rest index",     "https://sapuralife.com/wp-json/"],
    ["woo store products","https://sapuralife.com/wp-json/wc/store/v1/products?per_page=5"],
    ["woo any visibility","https://sapuralife.com/wp-json/wc/store/v1/products?per_page=5&catalog_visibility=any"],
    ["woo categories",    "https://sapuralife.com/wp-json/wc/store/v1/products/categories"],
    ["wp v2 product",     "https://sapuralife.com/wp-json/wp/v2/product?per_page=5"],
    ["product sitemap",   "https://sapuralife.com/product-sitemap.xml"],
    ["sitemap index",     "https://sapuralife.com/sitemap_index.xml"],
  ],
  greentree: [
    ["jane menu products","https://api.iheartjane.com/v1/stores/5187/menu_products?per_page=5"],
    ["jane store",        "https://api.iheartjane.com/v1/stores/5187"],
    ["jane embed",        "https://api.iheartjane.com/v1/stores/5187/menu_products_json"],
    ["site page",         "https://greentreerelief.com/coldwater/"],
  ],
  dude: [
    ["flowhub menu",      "https://origin.dispensary.shop/api/v1/stores/22ef2975-9e8d-466c-9d88-8e6230a04d65/products?limit=5"],
    ["flowhub store",     "https://origin.dispensary.shop/api/v1/stores/22ef2975-9e8d-466c-9d88-8e6230a04d65"],
    ["storefront",        "https://dudeabides-willow.dispensary.shop/"],
    ["storefront menu",   "https://dudeabides-willow.dispensary.shop/menu"],
  ],
  banzen: [
    ["tymber site",       "https://banzencoldwater.com/menu"],
    ["tymber api",        "https://banzencoldwater.com/api/v1/menu/products?limit=5"],
  ],
  herbology: [
    ["shophcc site",      "https://www.shophcc.com/"],
    ["cannavate api",     "https://www.shophcc.com/api/products?retailerId=6c36404c-574a-474d-b4a5-1188d351deb4&limit=5"],
  ],
  lume: [
    ["shop all",          "https://www.lume.com/shop/all"],
    ["locations",         "https://www.lume.com/locations"],
  ],
  /* OTHER TOWNS. Not Coldwater shops -- these are here because the town choice
     turned out to be the wrong question.
     Michigan's two biggest border markets are New Buffalo (#1 city in the state,
     $45.9M in Jan-Feb 2026 alone) and Monroe (#2, and the highest dollar velocity
     per store in 2025 at ~$34,500/day). Both dwarf Coldwater. And Lume trades in
     BOTH of them, plus Morenci and Petersburg on the Ohio line.
     So the adapter already written and tested for Coldwater is the same adapter
     for the two largest markets in Michigan. Measure that rather than assume it:
     if these store pages carry the same __NEXT_DATA__ catalogue, one cookie and
     one adapter cover roughly thirty towns at once and the town becomes a
     configuration line rather than a project. */
  "lume-monroe": [
    ["store page",        "https://www.lume.com/stores/monroe-mi-dispensary"],
  ],
  "lume-newbuffalo": [
    ["store page",        "https://www.lume.com/stores/new-buffalo-mi-dispensary"],
  ],
  /* Monroe's Telegraph Road strip, for a platform read on a 20-shop town. More
     shops is more chances of a readable one, which is the opposite of the
     Coldwater problem. */
  "monroe-jars": [
    ["jars monroe",       "https://jarscannabis.com/michigan/monroe-telegraph/"],
  ],
  "monroe-mint": [
    ["mint monroe",       "https://mintcannabis.com/michigan/monroe/"],
  ],
};

/* /api/coldwater?dissect=<key>
 *
 * Fetch an asset the shop itself publishes and report what it talks to. The
 * embed loader came back 200 with 43 KB of JavaScript, which means Dutchie
 * serves it to anybody -- it has to, it is the script the merchant's own page
 * loads. That bundle names the endpoint it calls and the shape it calls with, so
 * reading it replaces guessing operation names.
 *
 * This reads a published client to learn a documented request shape. It is not a
 * way around the challenge on the GraphQL host, and if the answer turns out to be
 * "the bundle calls the same gated endpoint", that is the answer and the route is
 * a merchant conversation after all.
 *
 * URLs come from the table below and never from the query string: an endpoint
 * that fetches whatever it is told is an SSRF hole, and this one is public.
 */
const DISSECT = {
  sapura: ["https://dutchie.com/api/v2/embedded-menu/6226401db296a22c98dfb676.js"],
  greentree: ["https://greentreerelief.com/coldwater/"],
  dude: ["https://dudeabides-willow.dispensary.shop/"],
  banzen: ["https://banzencoldwater.com/menu"],
  herbology: ["https://www.shophcc.com/"],
};

async function runDissect(which) {
  const urls = DISSECT[which];
  if (!urls) return { error: "no dissect target for " + which, known: Object.keys(DISSECT) };
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    if (i) await sleep(SPACING_MS);
    const url = urls[i];
    try {
      const r = await get(url, { headers: { accept: "*/*", referer: "https://sapuralife.com/" } });
      const b = r.text || "";
      const uniq = a => Array.from(new Set(a));
      out.push({
        url, status: r.status, bytes: b.length,
        /* Absolute urls, then bare hosts, then anything that looks like an API
           path. Between them these almost always name the real data endpoint. */
        urls: uniq((b.match(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&'*+,;=%-]{6,120}/g) || [])).slice(0, 40),
        hosts: uniq((b.match(/[a-z0-9-]+(?:\.[a-z0-9-]+){1,3}\.(?:com|io|net|org|co|dev|app)/gi) || []).map(s => s.toLowerCase())).slice(0, 30),
        apiPaths: uniq((b.match(/["'`](\/(?:api|graphql|v\d)[a-zA-Z0-9._~/-]{0,60})["'`]/g) || [])).slice(0, 30),
        graphql: uniq((b.match(/(?:operationName|query\s+\w+|persistedQuery|sha256Hash)[^,}"']{0,60}/g) || [])).slice(0, 25),
      });
    } catch (e) {
      out.push({ url, error: String((e && e.message) || e) });
    }
  }
  return out;
}

async function runDiag(which) {
  const keys = which === "all" ? Object.keys(DIAG) : [which];
  const out = {};
  for (const k of keys) {
    const cands = DIAG[k];
    if (!cands) { out[k] = [{ error: "no candidates defined" }]; continue; }
    out[k] = [];
    for (let i = 0; i < cands.length; i++) {
      const [label, url] = cands[i];
      if (i) await sleep(SPACING_MS);
      const t0 = Date.now();
      try {
        /* 25s, not the 9s the live path uses. Banzen's /menu aborted at 9s and
           reported as an error, which is indistinguishable from a wall in the
           output -- and it is almost certainly just a big server-rendered page
           like Lume's 4.5 MB one. A bench that cannot tell "slow" from "blocked"
           writes off readable stores. */
        const r = await get(url, { timeout: 25000, headers: { accept: "*/*", referer: "https://legal-leafmarket.com/coldwater" } });
        const body = r.text || "";
        out[k].push({
          label, url,
          status: r.status,
          type: (r.hdr("content-type") || "").split(";")[0],
          bytes: body.length,
          ms: Date.now() - t0,
          /* The tell is almost always in the first couple of hundred bytes:
             a Cloudflare title, a JSON array, an HTML shell, a JS loader. */
          head: body.slice(0, 260).replace(/\s+/g, " "),
        });
      } catch (e) {
        out[k].push({ label, url, error: String((e && e.message) || e), ms: Date.now() - t0 });
      }
    }
  }
  return out;
}

/* ================================================================= XRAY ===
 *
 * ONE SCRIPT THAT TRIES EVERY ANGLE ON A PAGE, so that "we could not read this
 * shop" is a finding with evidence under it rather than a shrug.
 *
 * The bench above (?diag=) answers "does this URL respond", which is the first
 * question and never the last. When a page answers 200 with a megabyte of HTML
 * and the reader still finds nothing -- The Dude Abides, exactly, reported for
 * months as "no parseable JSON, no __NEXT_DATA__, no JSON script tag, no RSC
 * chunks" -- the useful question is what IS in there, and answering it by
 * pasting 964 KB into a terminal is not a method.
 *
 * IT RUNS SERVER-SIDE ON PURPOSE. The containers this repo is edited from have
 * their egress refused by a proxy, so no local script and no local browser can
 * see these hosts at all; the deployed function can. That is the difference
 * between "ask the owner to go and look" and "look".
 *
 * WHAT IT IS NOT. It reads what a plain GET is served, with no stealth headers,
 * no fingerprint work and no solver -- so a challenged host stays challenged and
 * is REPORTED as such (`walled`). Defeating a bot challenge is the one thing
 * this project does not do, and a probe that quietly tried would make that
 * promise a lie in the one file whose job is telling the truth about sources.
 *
 * URLS COME FROM THE TABLE, NEVER FROM THE QUERY STRING. This endpoint is
 * public; one that fetched whatever it was told is an SSRF hole pointed at
 * Vercel's network. Adding a shop is one line here and a deploy, which is a
 * two-minute loop and the right price for not having that hole.
 */
const XRAY = {
  dude:        "https://dudeabides-willow.dispensary.shop/menu",
  "dude-home": "https://dudeabides-willow.dispensary.shop/",
  /* The two Dutchie surfaces the collector is actually run on. The embedded menu
     is what a shop's own site frames; the dispensary page is where somebody
     lands from a search. Their CSP is the thing being read here, not their
     catalogue -- the bookmarklet cannot install on either. */
  dutchie:     "https://dutchie.com/embedded-menu/northeast-alternatives-coldwater/products",
  "dutchie-home": "https://dutchie.com/",
  banzen:      "https://banzencoldwater.com/menu",
  herbology:   "https://www.shophcc.com/",
  greentree:   "https://greentreerelief.com/coldwater/",
  exclusive:   "https://www.exclusivemi.com/dispensaries/locations/coldwater/",
  sapura:      "https://sapuralife.com/coldwater-weed-dispensary/",
  lume:        "https://www.lume.com/shop/all",
};

/* Every state-shaped global these stacks actually use. The point of naming them
   is that a MISS is informative: a page with none of these is not a SPA whose
   payload we failed to find, it is a page that renders on the server and has to
   be read as markup. */
const XRAY_GLOBALS = [
  "__NEXT_DATA__", "self.__next_f", "__NUXT__", "__NUXT_DATA__", "__remixContext",
  "__reactRouterContext", "__staticRouterHydrationData", "__APOLLO_STATE__",
  "__PRELOADED_STATE__", "__INITIAL_STATE__", "__INITIAL_DATA__", "__data.json",
  "__sveltekit", "astro-island", "Shopify.", "wp-json", "livewire",
  "window.__RUNTIME__", "__STATE__", "__gatsby", "_sharedData",
];

/* Platform tells, so a shop is identified by what it IS rather than by which
   adapter we happened to try. */
const XRAY_PLATFORMS = [
  ["dutchie", /dutchie\.com|embedded-menu/i],
  ["jane", /iheartjane|janeapi|jane-menu/i],
  ["flowhub", /flowhub|dispensary\.shop|origin\.dispensary/i],
  ["tymber", /tymber|_next\/static.*tymber/i],
  ["dispense", /dispenseapp|dispense\.app/i],
  ["meadow", /getmeadow|meadow\.cloud/i],
  ["greenrush", /greenrush/i],
  ["woocommerce", /wp-content|wc-ajax|woocommerce/i],
  ["shopify", /cdn\.shopify\.com|Shopify\.theme/i],
  ["next.js", /\/_next\/static\//i],
  ["nuxt", /\/_nuxt\//i],
  ["remix", /__remixContext|remix-run/i],
  ["react", /data-reactroot|react-dom|__reactProps\$/i],
  ["cloudflare-challenge", /Just a moment|cf-browser-verification|__cf_chl/i],
];

function xrayScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 400) {
    const attrs = m[1] || "", body = m[2] || "";
    const grab = n => { const a = attrs.match(new RegExp(n + '="([^"]*)"', "i")); return a ? a[1] : ""; };
    const src = grab("src");
    /* Host plus path, parsed ONCE and inside the guard: a src of "" or of
       something the URL parser refuses would otherwise throw here and take the
       whole probe down, which is the opposite of what a diagnostic is for. */
    let where = src;
    if (src) {
      try { const u = new URL(src, "https://x/"); where = u.hostname + u.pathname; }
      catch (e) { where = "?" + src.slice(0, 40); }
    }
    out.push({ id: grab("id"), type: grab("type"), src: where.slice(0, 90), len: body.length, body });
  }
  return out;
}

async function runXray(which, find) {
  const url = XRAY[which];
  if (!url) return { error: "no xray target for " + which, known: Object.keys(XRAY) };
  const t0 = Date.now();
  let r;
  try {
    r = await get(url, { timeout: 25000, headers: { accept: "text/html,application/xhtml+xml,*/*" } });
  } catch (e) {
    return { url, error: String((e && e.message) || e), ms: Date.now() - t0 };
  }
  const html = r.text || "";
  const scripts = xrayScripts(html);
  const inline = scripts.filter(s => !s.src);

  /* THE LARGEST INLINE SCRIPT IS ALMOST ALWAYS THE PAYLOAD, whatever it is
     called, so it is reported by size rather than by a name we hoped for. */
  const biggest = inline.slice().sort((a, b) => b.len - a.len).slice(0, 3)
    .map(s => ({ id: s.id, type: s.type, len: s.len, head: s.body.slice(0, 700).replace(/\s+/g, " ") }));

  const globals = {};
  for (const g of XRAY_GLOBALS) {
    const n = html.split(g).length - 1;
    if (n) globals[g] = n;
  }
  const platforms = XRAY_PLATFORMS.filter(([, re2]) => re2.test(html)).map(([n]) => n);

  /* JSON KEYS, counted. This is the measurement that separates "the data is
     here in a shape I did not expect" from "the data is genuinely not here" --
     a page carrying 400 "price": keys has a catalogue in it somewhere. */
  const keys = {};
  /* Counted by literal substring rather than by a built regex, for two reasons:
     a pattern assembled out of quotes and backslashes is the escaping trap this
     repo keeps falling into, and the ESCAPED form is the one that matters most
     here. A Next.js RSC payload is JSON inside a JS string literal, so on the
     wire its keys are backslash-quoted -- and a naive "price": search misses
     exactly the pages this probe exists to diagnose. */
  const count = (hay, needle) => hay.split(needle).length - 1;
  for (const k of ["price", "prices", "productName", "product_name", "strain", "thc", "brand",
                   "category", "weight", "variants", "inStock", "quantity", "menuProducts", "products"]) {
    const plain  = count(html, JSON.stringify(k) + ":");
    const esc    = count(html, JSON.stringify(JSON.stringify(k)).slice(1, -1) + ":");
    const single = count(html, "'" + k + "':");
    if (plain + esc + single) keys[k] = { plain, escaped: esc, single };
  }

  /* Money in the MARKUP rather than in a payload means the menu is text on the
     page, which is a different reader entirely -- and the one The Dude needs if
     everything above comes back empty. */
  const prices = html.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) || [];
  const apis = [...new Set((html.match(/https?:\/\/[^"'\s<>\\]{6,120}(?:\/api\/|graphql|\.json)[^"'\s<>\\]{0,60}/gi) || []))].slice(0, 25);

  const out = {
    url, finalUrl: r.url || url, status: r.status,
    type: (r.hdr("content-type") || "").split(";")[0],
    bytes: html.length, ms: Date.now() - t0,
    /* Named rather than inferred from a row of zeroes: walled, empty and
       errored look identical from a count and need opposite responses. */
    walled: /Just a moment|cf-browser-verification|Attention Required|Access denied/i.test(html.slice(0, 4000)),
    /* WHAT THE PAGE WILL LET US RUN ON IT, which is a different question from
       what it contains and the one that decides whether the bookmarklet can
       install at all. A bookmarklet's own javascript: URL is exempt from CSP in
       every browser that supports them -- it is a user action -- but a <script
       src> it INJECTS is not, and neither is the fetch that posts the capture.
       So script-src decides whether the collector loads, connect-src decides
       whether the capture can be sent, and the two fail in completely different
       ways: nothing happens at all, versus a perfect read that cannot leave.
       Reported verbatim rather than interpreted, because a directive list is
       short and any summary of one loses the exception that mattered. */
    csp: (function(){
      const h = r.hdr("content-security-policy") || r.hdr("content-security-policy-report-only") || "";
      if (!h) {
        /* A meta CSP counts, and a page that sets one usually sets ONLY one. */
        const m = html.match(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*content=["']([^"']+)/i);
        return m ? { via: "meta", policy: m[1].slice(0, 1200) } : { via: "none", policy: "" };
      }
      const pick = name => {
        const m = h.match(new RegExp("(?:^|;)\\s*" + name + "\\s+([^;]+)", "i"));
        return m ? m[1].trim().slice(0, 400) : "";
      };
      return {
        via: r.hdr("content-security-policy") ? "header" : "report-only",
        scriptSrc: pick("script-src") || pick("default-src"),
        connectSrc: pick("connect-src") || pick("default-src"),
        /* The two that decide the two failure modes, then the whole thing so a
           directive nobody thought of is still visible. */
        policy: h.slice(0, 1200),
      };
    })(),
    platforms, globals, jsonKeys: keys,
    scripts: { total: scripts.length, inline: inline.length, external: scripts.length - inline.length },
    jsonScriptTags: scripts.filter(s => /json/i.test(s.type))
      .map(s => ({ id: s.id, type: s.type, len: s.len, head: s.body.slice(0, 300).replace(/\s+/g, " ") })).slice(0, 10),
    biggestInline: biggest,
    externalScripts: scripts.filter(s => s.src).map(s => s.src).slice(0, 20),
    priceHits: prices.length,
    priceSamples: prices.slice(0, 8),
    apiUrls: apis,
    /* What the markup itself looks like where the money is -- the fastest way to
       tell a rendered menu from a price in a footer. */
    aroundFirstPrice: (function(){
      const i = html.search(/\$\s?\d/);
      return i < 0 ? "" : html.slice(Math.max(0, i - 320), i + 320).replace(/\s+/g, " ");
    })(),
    title: (html.match(/<title[^>]*>([\s\S]{0,160})<\/title>/i) || [, ""])[1].trim(),
  };

  /* A LITERAL substring search, never a regex from the query string: a caller
     supplying (a+)+b would hang the function, and everything this is used for is
     "does the word 'Runtz' appear, and in what". */
  if (find) {
    const needle = String(find).slice(0, 60);
    const hits = [];
    let at = -1;
    while ((at = html.indexOf(needle, at + 1)) >= 0 && hits.length < 8) {
      hits.push(html.slice(Math.max(0, at - 220), at + 220).replace(/\s+/g, " "));
    }
    out.find = { needle, count: hits.length, contexts: hits };
  }
  return out;
}

/* ---------------------------------------------------------------- cache ---
 * ONLY THE SCRAPE IS CACHED, NEVER THE CAPTURES, and the difference is the
 * whole reason this exists in this shape.
 *
 * Caching the finished payload meant a browser capture could be stored
 * correctly and still not appear for up to half an hour, because the feed was
 * answering from a payload assembled before the capture existed. Reported as
 * "the tool refreshes the grab but the live site is not updating even when I
 * ctrl shft r" -- and a hard reload cannot help, because nothing about the
 * staleness was in the browser.
 *
 * What is expensive here is talking to seven shops over the network. Reading
 * captures is one cheap read from the same backend the ingest endpoint just
 * wrote to. So the scrape is cached and the captures are applied fresh on every
 * single request: the costly half is protected, the half that changes when the
 * operator does something is never stale.
 */
/* KEYED BY TOWN, and it became a one-line bug the moment towns existed: a single
   global cache serves whichever town asked first to every town that asks next,
   so a request for Monroe would be answered with Coldwater's scrape and the
   expectLocation guard -- which runs at FETCH time, not at serve time -- would
   never see it. Exactly the failure the town scoping was added to prevent,
   reintroduced one layer down. */
const CACHE = new Map();   // town -> { at, scraped }

/* ---------------------------------------------------------------- route --- */
export default async function handler(req, res) {
  const q = req.query || {};
  const debug = "debug" in q;
  const refresh = "refresh" in q;
  /* THE TOWN, RESOLVED ONCE AND APPLIED EVERYWHERE BELOW, AGAINST THE REGISTRY
     AND NOT AGAINST A LOCAL COPY OF IT. An UNREGISTERED value falls back to
     Coldwater rather than erroring: ?town= is a URL somebody can mistype, and
     the default shelf is a better answer than a blank page. A REGISTERED one
     resolves to itself even when no shop is wired to it yet, which is the part
     that was wrong -- see the note at the head of this file. A market with an
     empty roster serves the demo fixture, which says so in `meta.demo` and on
     the page; the one thing it must never do is quietly serve another town.
     Every store with no `town` is a Coldwater store, so a request with no
     parameter behaves exactly as it did before this existed. */
  const town = townKey(q.town);
  const inTown = st => (st.town || DEFAULT_TOWN) === town;
  const ROSTER = STORES.filter(inTown);

  if (q.dissect) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const r = await runDissect(String(q.dissect));
    return res.status(200).send(JSON.stringify({ dissect: String(q.dissect), results: r }, null, 2));
  }

  if (q.xray) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const r = await runXray(String(q.xray), q.find ? String(q.find) : "");
    return res.status(200).send(JSON.stringify({ xray: String(q.xray), result: r }, null, 2));
  }

  /* Probe bench, answered before anything else and never cached. */
  if (q.diag) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const results = await runDiag(String(q.diag));
    return res.status(200).send(JSON.stringify({ diag: String(q.diag), results }, null, 2));
  }

  const products = [];
  const stores = [];
  const probes = {};
  const wantProbe = "probe" in q;

  /* Serve the SCRAPE from cache when it is warm; the captures below are read
     fresh regardless. Copied out rather than referenced, because the capture
     merge splices this array and assigns into these store rows -- handing it
     the cached objects would corrupt the cache for every later request. */
  const cached = CACHE.get(town);
  const scrapeWarm = !refresh && !wantProbe && cached && cached.scraped && (Date.now() - cached.at < CACHE_MS);
  if (scrapeWarm) {
    products.push(...cached.scraped.products);
    stores.push(...cached.scraped.stores.map(o => ({ ...o })));
  } else {
    const live = ROSTER.filter(s => s.enabled && s.platform !== "none" && ADAPTERS[s.platform]);
    for (let i = 0; i < live.length; i++) {
      const s = live[i];
      if (i) await sleep(SPACING_MS);
      const t0 = Date.now();
      const probe = wantProbe ? {} : null;
      try {
        const got = await ADAPTERS[s.platform](s, probe);
        products.push(...got);
        stores.push({ name: s.name, count: got.length, ms: Date.now() - t0 });
      } catch (e) {
        stores.push({ name: s.name, count: 0, err: String((e && e.message) || e), ms: Date.now() - t0 });
      }
      if (probe) probes[s.key] = probe;
    }
    /* Stash BEFORE the captures are merged in, so the cache holds the scrape
       and only the scrape. */
    if (!wantProbe) {
      CACHE.set(town, { at: Date.now(), scraped: { products: products.slice(), stores: stores.map(o => ({ ...o })) } });
    }
  }

  /* Menus captured by the operator's own browser (api/coldwater-ingest.js).
     Read for EVERY store, not just disabled ones, and taken as authoritative
     where present: a human looked at that page, which beats an adapter's guess
     about a platform nobody here can reach. It is also the only route to the
     three shops behind a bot challenge. */
  /* ONE READ FOR THE WHOLE ROSTER. This was `await readIngest(s.key)` inside the
     loop -- one sequential round trip per shop, on every request. Invisible at
     seven shops and the entire hot path at a statewide roster, where it is 800
     sequential reads before a byte is sent.
     Caching the result would be the wrong fix and is deliberately not done: the
     scrape is cached and the captures are not, so that a capture appears the
     moment it is stored (reported once as "the tool refreshes the grab but the
     live site is not updating"). Batched, not cached -- same freshness, one
     round trip. */
  /* THE TOWN GOES WITH THE READ, and it is not optional. This called
     readIngestMany(keys) with no second argument, so the market resolved
     through the same default a mistyped ?town= takes -- coldwater -- and every
     city page read the PILOT's capture namespace.
   *
     It could not fail loudly, and it did not: Detroit's roster keys have no
     rows under coldwater, so the shelf simply showed nothing new and every
     capture made after the write path was namespaced looked like storage
     failing. Worse, it was not even empty. Captures taken BEFORE the write path
     was fixed sit in exactly that namespace under exactly these keys, so the
     page served a frozen pre-fix snapshot -- House of Dank at 1,869 rows and
     Ascend at 454, unchanged all evening -- while four fresh captures totalling
     2,714 rows sat in ll:detroit:ingest: and never appeared. The install page,
     which passes ?market=, listed all four. Two screens, both confident, both
     reading a different store.
   *
     Fifth in this family and the last of the three paths: the POST namespaces
     (fixed in the third-registry commit), the status GET namespaces (the fourth
     roster), and this, the read the shelf itself does. A market argument that
     DEFAULTS is the shape of every one of them -- see the note in
     api/coldwater-ingest.js. */
  const capsByStore = await readIngestMany(ROSTER.map(s => s.key), town);
  for (const s of ROSTER) {
    try {
      const cap = capsByStore.get(s.key);
      if (!cap || !Array.isArray(cap.products) || !cap.products.length) continue;
      /* THE RAW SHAPE, named rather than inline because the ladder below maps
         EACH LANE separately -- a harvest and a hand capture of the same shop
         are two layers, not one list, and each needs its own sub-variant merge
         before rank can decide between them field by field. */
      const rawOf = p => ({
        id: p.name, name: [p.brand, p.name].filter(Boolean).join(" ").trim() || p.name,
        image: p.image, category: p.category, type: p.type, thc: p.thc, coa: p.coa,
        /* THE FOURTH WHITELIST. A captured field crosses the collector, the
           ingest sanitiser, THIS mapping and toProduct, and every one of them
           names its fields explicitly -- so a value added to three of the four
           arrives empty with nothing anywhere saying why. That is how the card
           back stayed blank while the engine had been rendering it all along. */
        description: p.description,
        brand: p.brand,
        deal: p.deal,
        url: p.url || s.site, batch: p.batch, packagedDate: p.packagedDate,
        /* GRAMS ARE RECOMPUTED FROM THE LABEL, not taken from the capture.
           The collector worked out grams at capture time, so every menu read
           before gramsOf() was fixed has "1/8 oz" stored as 224 g -- and those
           captures are the shelf. Re-deriving here repairs them in place
           instead of requiring every shop to be captured again. The stored
           value survives only where the label yields nothing, since a label
           that says nothing about weight cannot correct one. */
        sizes: dedupeRows((p.sizes || []).map((z, i) =>
          /* The title weight is the PRODUCT's, so it is only an answer when the
             product is one row. On a listing with several sizes it would put
             the same grams against every one of them.
             gramsFromTitle rather than gramsFromName since the 200 g report: the
             bracket form was only ever half of how these titles state a weight,
             and an unbracketed "20pk 10g" left the row at zero for the engine to
             multiply out for itself. */
          row(z.label, z.price,
              gramsOf(z.label) || ((p.sizes || []).length === 1 ? gramsFromTitle(p.name) : 0) || z.grams,
              s.key + "-" + i,

              p.inStock !== false, OFFCUT_RE.test(z.label || p.name || ""),
              /* The shop's own stated discount for THIS size, which the collector
                 and the ingest sanitiser have both been carrying all along. */
              z.sale))),
      });
      /* TWO MERGES, AND THEY ANSWER DIFFERENT QUESTIONS. mergeListings runs
         WITHIN one lane's capture, because Dutchie wraps every weight in its own
         link and a rendered-page capture of one jar arrives as an eighth entry
         and an ounce entry. mergeProducts runs ACROSS lanes. Running the first
         per lane rather than over the pooled rows matters: pooling would let a
         harvest's eighth and a hand capture's ounce fuse into one listing whose
         sizes came from two different readings at two different times. */
      const mapLane = rows => mergeListings((rows || []).map(rawOf)).map(o => toProduct(s, o));

      /* THE LADDER, replacing a splice that deleted this store's scraped rows
         outright. That splice was right for one capture source and destructive
         for two: a thin 30-row manual capture would delete a 200-row harvest,
         and the shelf would go backwards while looking freshly updated. The
         double-listing it was written to prevent is now prevented by the
         row-level join instead, which is the correct place for it.

         Rank decides, not array order (api/coldwater-merge.js). The operator's
         lane sits on top by requirement, and no lane deletes a row it merely
         did not see. */
      const scraped = products.filter(p => p.storeKey === s.key);
      const layers = [{ source: "adapter", products: scraped }];
      /* One layer per capture lane, so a harvest and a hand capture of the same
         shop resolve against each other by rank rather than by which was stored
         first. Pre-lane records arrive as a single `manual` lane. */
      const capLanes = Array.isArray(cap.lanes) && cap.lanes.length
        ? cap.lanes
        : [{ lane: "manual", products: cap.products, capturedAt: cap.capturedAt }];
      for (const L of capLanes) {
        const rows = mapLane(L.products);
        /* capturedAt travels with the layer, which is what lets a stale lane be
           demoted below a fresh one rather than winning on rank alone. Adapter
           rows are produced in THIS request and carry none, which is correct:
           they cannot be stale. */
        if (rows.length) layers.push({ source: L.lane || "manual", products: rows, capturedAt: L.capturedAt || "" });
      }
      const merged = mergeProducts(layers, { colour: cap.colour || null });

      for (let i = products.length - 1; i >= 0; i--) if (products[i].storeKey === s.key) products.splice(i, 1);
      products.push(...merged);

      const seen = stores.find(x => x.name === s.name);
      /* ONLY LANES THAT ACTUALLY CONTRIBUTED ROWS. Naming every layer we
         assembled reported "adapter+manual" for a store whose adapter had just
         returned a 403 and nothing else -- crediting a lane for work it did not
         do, in the one field an operator reads to find out which lane is
         broken. An empty layer is not a source. */
      const viaLanes = layers.filter(l => l.products.length).map(l => l.source).join("+");
      const note = { name: s.name, count: merged.length, via: viaLanes, capturedAt: cap.capturedAt };

      if (seen) Object.assign(seen, note); else stores.push(note);
    } catch (e) { /* a bad capture must never take the whole feed down */ }
  }

  const usingDemo = products.length === 0;
  if (usingDemo) products.push(...demo());

  /* BRAND, SECOND PASS: match the makers this market has NAMED against the
     titles of the shops that do not name them.
   *
   * Drip is the case that motivated it and it is the whole argument. Herbology
   * states the brand ("Drip | Distillate 510 Cart | Blue Dream | 1g") and Lume
   * does not ("Drip Blue Dream Cart 1g") -- same maker, same 1g cart, same
   * strain, $7.50/g against $7.00/g. Without this pass those two never meet, and
   * "which shop is cheapest for the cart I actually buy" is the one comparison
   * this market has nobody publishing.
   *
   * WHY THIS IS NOT THE LEADING-WORDS GUESS I REFUSED. The vocabulary is not
   * invented; every entry was stated outright by some shop, in its own brand
   * field or its own pipe-delimited title. This only recognises a known maker in
   * a title that omitted the field. Three guards keep it honest:
   *
   *   - PREFIX ONLY, on a word boundary. "Amnesia" is a real brand here AND a
   *     word inside "Slerp Amnesia Haze ... Cart", where the maker is Slerp. A
   *     mid-title match would merge a strain into a brand, so only the start of
   *     the title counts.
   *   - LONGEST WINS, so "Old School Hash Co." is not read as "Old School".
   *   - STATED TWICE, so one shop's typo cannot become a rule for the town.
   *
   * The count is reported in ?debug&slim as `inferred`, separately from
   * `stated`, because a facet that merges two companies is worse than one that
   * admits ignorance -- and if that number ever runs away, this pass is why. */
  {
    const stated = new Map();
    for (const p of products) {
      if (!p.brand || !p.brandKey) continue;
      const e = stated.get(p.brandKey) || { disp: p.brand, n: 0 };
      e.n++; stated.set(p.brandKey, e);
    }
    const vocab = [...stated.entries()]
      .filter(([, e]) => e.n >= 2 && e.disp.length >= 3)
      .map(([k, e]) => ({ k, disp: e.disp }))
      .sort((a, b) => b.disp.length - a.disp.length);       // longest first
    for (const p of products) {
      if (p.brand) continue;
      const n = String(p.name || "");
      for (const v of vocab) {
        const d = v.disp;
        if (n.length <= d.length) continue;
        if (n.slice(0, d.length).toLowerCase() !== d.toLowerCase()) continue;
        if (!/[\s|,\-]/.test(n.charAt(d.length))) continue;   // word boundary, not "Driphouse"
        p.brand = d; p.brandKey = v.k; p.brandInferred = true;
        break;
      }
    }
  }

  const payload = {
    products,
    meta: {
      updated: new Date().toISOString(),
      total: products.length,
      /* When every store fails the route falls back to the fixture -- but the
         per-store errors are the ONLY record of why, so they must survive that
         fallback. Replacing them with a single "Demo fixture" row (which this
         did) turned a diagnosable failure into a black box: the probe came back
         empty and the reason was simply gone. Say both things instead. */
      stores: usingDemo ? [{ name: "Demo fixture", count: products.length }].concat(stores) : stores,
      /* Derived, never hardcoded -- this string is what the page prints and
         what a fan-out would otherwise get wrong. */
      market: TOWNS[town].market,
      town,
      benchmarkOzUSD: MI_AVG_OZ,
      benchmarkPerGUSD: Math.round((MI_AVG_OZ / 28) * 100) / 100,
      demo: usingDemo,
      probes: wantProbe ? probes : undefined,
      note: usingDemo
        ? "No store is connected yet. These are placeholder rows with placeholder shop names, not any real dispensary's prices."
        : "Live shop menus, cached up to 30 minutes. Verify at the shop before you drive.",
    },
  };

  /* The cache was already written above, holding the scrape alone. Nothing to
     stash here: this payload has captures merged into it and must never be
     served to a later request, which is exactly the bug this shape fixes. */
  return send(res, payload, debug, q, scrapeWarm, ROSTER);
}

/* ROSTER IS PASSED, NOT CLOSED OVER. This is a top-level function, so reading
   the handler's town-scoped roster from here was a ReferenceError that only
   fired on ?debug -- the one path a browser suite does not exercise and an
   operator hits first. The suite caught it; the signature is the fix. */
async function send(res, payload, debug, q, cached, roster0) {
  /* SHORT ON PURPOSE. The origin now re-reads captures every request, but the
     CDN would happily serve a ten-minute-old copy of the merged answer and the
     operator would see exactly the same "I captured it and nothing changed"
     they reported. Thirty seconds is short enough that a capture feels
     immediate and long enough to shield the origin from a burst; the
     stale-while-revalidate window keeps a cold lambda off the critical path.
     The expensive scrape is protected by CACHE_MS regardless, so this costs
     almost nothing. */
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!debug) return res.status(200).send(JSON.stringify(payload));

  const roster = [];
  for (const s of (roster0 || STORES)) {
    roster.push({
      key: s.key, name: s.name, addr: s.addr, phone: s.phone, area: s.area,
      platform: s.platform, enabled: !!s.enabled,
      /* The collector install page (/coldwater-collect) builds its shop list
         from this roster rather than keeping its own copy, so the page cannot
         drift out of step with STORES the way vercel.json and server.mjs did
         (CLAUDE.md section 3). It needs somewhere to send the operator, which
         is what these two are for: menuUrl where a store has a direct menu,
         the shop's own site otherwise. */
      site: s.site || "", menuUrl: s.menuUrl || "",
      note: s.note || "",
      robots: "robots" in q ? await robotsNote(s.site) : "not checked (add &robots)",
    });
  }
  const out = {
    meta: payload.meta,
    cached,
    /* THIS TOWN'S, not the whole state's. It sits beside a per-town roster and
       reads as its summary, so counting every enabled store everywhere makes a
       city with nothing wired up report the pilot's number -- the same class of
       answer as the resolver bug at the head of this file, one field along. */
    connected: (roster0 || STORES).filter(s => s.enabled).length,
    roster,
    howToConnect: "node tools/discover-coldwater.mjs   (run it from a machine with normal network access)",
    probeHint: "add &probe to see the head of each store's raw response and its first product",
  };
  /* IMAGE CENSUS. "Why has this product no picture" is unanswerable from a
     card, and sampling cannot answer it either -- the same mistake BUDTENDER_PLAN
     made about terpenes. So count the whole feed, per store, and name a few of
     the ones that came through empty so they can be looked at on the shop's own
     site. A store at 0% is a capture-path problem; a store at 90% with a few
     gaps is usually the shop genuinely having no photo. */
  const img = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!img[k]) img[k] = { total: 0, withImage: 0, missing: 0, examples: [] };
    img[k].total++;
    if (p.image) img[k].withImage++;
    else {
      img[k].missing++;
      if (img[k].examples.length < 5) img[k].examples.push(p.name);
    }
  }
  for (const k of Object.keys(img)) {
    img[k].pct = img[k].total ? Math.round((img[k].withImage / img[k].total) * 100) + "%" : "n/a";
  }
  out.images = img;

  /* POTENCY AND BATCH CENSUS, and the cross-shop join underneath it.
     "Can we show THC strength" and "can we reach a lab result" are both
     coverage questions, and coverage cannot be sampled -- that is the mistake
     BUDTENDER_PLAN made about terpenes while 36 products carried full panels.

     The batch tag is the interesting one. In Michigan every package carries a
     state track-and-trace (Metrc) tag, and that tag is the ONLY durable key a
     lab result can be joined on: names drift, prices change, SKUs are per-shop,
     a tag is the package. So the census also reports tags seen at MORE THAN ONE
     shop, with the price spread, because the same physical batch at two prices
     is the one comparison nobody in this market publishes. */
  const pot = {};
  const byBatch = new Map();
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!pot[k]) pot[k] = { total: 0, withThc: 0, withBatch: 0, thcRange: [null, null] };
    pot[k].total++;
    /* ZERO IS NOT A POTENCY. Counting it as one reported "thcPct 100%" for five
       shops whose every product came through at 0 -- a census that says the data
       is perfect when the data is absent is worse than no census, because it
       closes the question. Only Lume genuinely carries THC. */
    if (p.potency != null && isFinite(p.potency) && p.potency > 0) {
      pot[k].withThc++;
      const lo = pot[k].thcRange[0], hi = pot[k].thcRange[1];
      pot[k].thcRange[0] = lo == null ? p.potency : Math.min(lo, p.potency);
      pot[k].thcRange[1] = hi == null ? p.potency : Math.max(hi, p.potency);
    }
    const tag = String(p.batch || "").trim().toUpperCase();
    if (tag) {
      pot[k].withBatch++;
      if (!byBatch.has(tag)) byBatch.set(tag, []);
      byBatch.get(tag).push({ store: p.storeKey, name: p.name, startsAt: p.startsAt, perG: p.perG });
    }
  }
  for (const k of Object.keys(pot)) {
    pot[k].thcPct = pot[k].total ? Math.round((pot[k].withThc / pot[k].total) * 100) + "%" : "n/a";
    pot[k].batchPct = pot[k].total ? Math.round((pot[k].withBatch / pot[k].total) * 100) + "%" : "n/a";
  }
  out.potency = pot;

  const shared = [];
  for (const [tag, rows] of byBatch) {
    const stores = new Set(rows.map(r => r.store));
    if (stores.size < 2) continue;
    const prices = rows.map(r => r.perG).filter(n => n != null);
    shared.push({
      batch: tag, stores: Array.from(stores), name: rows[0].name,
      perG: rows.map(r => ({ store: r.store, perG: r.perG, startsAt: r.startsAt })),
      spreadPerG: prices.length > 1 ? Math.round((Math.max(...prices) - Math.min(...prices)) * 100) / 100 : null,
    });
  }
  /* LINK CENSUS. Before any talk of building carts, the prior question is
     whether a product even has its own URL: a deep link to the item is worth
     more than a filled cart nobody can verify, and it is the thing an "add to
     cart" would have to start from. A url equal to the shop's front page is a
     link to nowhere in particular, so those are counted separately. */
  const links = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!links[k]) links[k] = { total: 0, deep: 0, frontPage: 0, none: 0, examples: [] };
    links[k].total++;
    const u = String(p.url || "");
    const home = String((STORES.find(s => s.key === k) || {}).site || "");
    if (!u) links[k].none++;
    else if (home && (u === home || u === home.replace(/\/$/, ""))) links[k].frontPage++;
    else {
      links[k].deep++;
      if (links[k].examples.length < 2) links[k].examples.push(u.slice(0, 120));
    }
  }
  for (const k of Object.keys(links)) {
    links[k].deepPct = links[k].total ? Math.round((links[k].deep / links[k].total) * 100) + "%" : "n/a";
  }
  out.links = links;

  /* DEAL CENSUS. Multi-buy offers are the reason a shopper picks one shop over
     another on carts, so "are we pulling in their deals" needs a number rather
     than an impression.

     CAPTURED AND COMPUTED ARE DIFFERENT QUESTIONS, and counting only the first
     is how the slash form hid. This census reported Herbology at 78% while
     dealMath refused every one of those 466 offers, because "2/$160" is not
     "2 for $160" -- so the capture looked healthy, the ranking was at shelf
     price, and the number on this page said everything was fine.

     So `priced` counts the offers that actually produced a per-gram, and
     `unpriced` keeps the text of the ones that did not. Some refusals are
     correct and expected -- "mix and match" and a bare "BOGO" are refused on
     purpose -- so this is not a figure to drive to zero. It is a list to READ:
     a form appearing in `unpricedExamples` hundreds of times is a parser gap,
     the same way a rising perGramSanity count is. */
  const deals = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!deals[k]) deals[k] = { total: 0, withDeal: 0, priced: 0, unpriced: 0, examples: [], unpricedExamples: [] };
    deals[k].total++;
    if (p.deal) {
      deals[k].withDeal++;
      if (deals[k].examples.length < 4) deals[k].examples.push(p.deal);
      if (p.dealPerG != null) deals[k].priced++;
      else {
        deals[k].unpriced++;
        if (deals[k].unpricedExamples.length < 4 && !deals[k].unpricedExamples.includes(p.deal)) {
          deals[k].unpricedExamples.push(p.deal);
        }
      }
    }
  }
  for (const k of Object.keys(deals)) {
    deals[k].pct = deals[k].total ? Math.round((deals[k].withDeal / deals[k].total) * 100) + "%" : "n/a";
    deals[k].pricedPct = deals[k].withDeal ? Math.round((deals[k].priced / deals[k].withDeal) * 100) + "%" : "n/a";
  }
  out.deals = deals;

  /* CATEGORY CENSUS. The engine builds its filter as the SET of these values, so
     the number of distinct ones IS the dropdown, and 28 of them for 9 concepts is
     what "categories are all jacked" looks like from the data side. `distinct`
     is the figure to watch: if it climbs back toward the store count times the
     concept count, a shop's vocabulary is escaping normCategory again. */
  const catCount = {}, catByStore = {};
  let uncategorised = 0;
  for (const p of payload.products) {
    const k = p.storeKey || "?", c = p.category || "";
    if (!c) uncategorised++;
    catCount[c || "(none)"] = (catCount[c || "(none)"] || 0) + 1;
    if (!catByStore[k]) catByStore[k] = { total: 0, none: 0, cats: {} };
    catByStore[k].total++;
    if (!c) catByStore[k].none++; else catByStore[k].cats[c] = (catByStore[k].cats[c] || 0) + 1;
  }
  out.categories = {
    distinct: Object.keys(catCount).filter(c => c !== "(none)").length,
    uncategorised,
    counts: catCount,
    perStore: catByStore,
  };

  /* BRAND CENSUS. `crossShop` is the number this feature exists for: a brand
     carried at one shop is a label, a brand carried at three is a PRICE
     COMPARISON, and it is the one this market has nobody publishing. `inferred`
     is reported apart from `stated` because inference is the part that can go
     wrong quietly -- if it runs away, two companies are being merged. */
  const bseen = new Map();
  let bStated = 0, bInferred = 0, bNone = 0, artefacts = 0;
  for (const p of payload.products) {
    if (/\[object /.test(p.name || "")) artefacts++;
    if (!p.brand) { bNone++; continue; }
    if (p.brandInferred) bInferred++; else bStated++;
    const e = bseen.get(p.brandKey) || { disp: p.brand, stores: new Set(), n: 0 };
    e.stores.add(p.storeKey); e.n++; bseen.set(p.brandKey, e);
  }
  const cross = [...bseen.values()].filter(e => e.stores.size > 1)
    .sort((a, b) => b.stores.size - a.stores.size || b.n - a.n);
  out.brands = {
    distinct: bseen.size,
    stated: bStated,
    inferred: bInferred,
    none: bNone,
    /* Must read 0. It counted 1,132 -- 44% of the shelf -- when the collector
       stringified an object brand into every Sapura and Herbology title. */
    nameArtefacts: artefacts,
    crossShop: cross.length,
    crossShopExamples: cross.slice(0, 12).map(e => ({
      brand: e.disp, products: e.n, stores: [...e.stores].sort(),
    })),
  };

  /* DESCRIPTION CENSUS. The engine has rendered p.description since before this
     page existed and nothing ever set it, so every Coldwater card was blank on
     the back and no number said so. A store at 0% is either a shop that writes
     none or a capture path that cannot see them -- the rendered-page and
     printed-text layers genuinely have none to find, so read this next to the
     `via` each store reports rather than as a fault on its own. */
  const desc = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!desc[k]) desc[k] = { total: 0, withDesc: 0, avgLen: 0, chars: 0, examples: [] };
    desc[k].total++;
    const d = String(p.description || "");
    if (d) {
      desc[k].withDesc++;
      desc[k].chars += d.length;
      if (desc[k].examples.length < 2) desc[k].examples.push(d.slice(0, 90));
    }
  }
  for (const k of Object.keys(desc)) {
    desc[k].pct = desc[k].total ? Math.round((desc[k].withDesc / desc[k].total) * 100) + "%" : "n/a";
    desc[k].avgLen = desc[k].withDesc ? Math.round(desc[k].chars / desc[k].withDesc) : 0;
    delete desc[k].chars;
  }
  out.descriptions = desc;

  /* STOCK CENSUS, and ZERO IS THE READING THAT MEANS SOMETHING IS WRONG. This is
     the opposite of perGramSanity below. Six dispensaries reported 2,567 products
     and 3,160 size rows with NOT ONE sold out, which is not a fact about
     Coldwater -- it is a field nobody was reading. A sold-out ounce published as
     available is a drive across town, and the site asserts it. */
  const stock = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!stock[k]) stock[k] = { products: 0, oos: 0, rows: 0, rowsOos: 0 };
    stock[k].products++;
    if (p.inStock === false) stock[k].oos++;
    for (const r of (p.sizes || [])) { stock[k].rows++; if (r && r[4] === false) stock[k].rowsOos++; }
  }
  for (const k of Object.keys(stock)) {
    stock[k].oosPct = stock[k].products ? Math.round((stock[k].oos / stock[k].products) * 100) + "%" : "n/a";
    stock[k].note = (stock[k].oos === 0 && stock[k].rowsOos === 0)
      ? "nothing sold out anywhere - check the capture reads stock before believing it" : "";
  }
  out.stock = stock;

  /* SIZE-ROW CENSUS, and it exists because "some items only show one option" and
     "the options are all on one line" were both reported from the live shelf and
     NO NUMBER anywhere said so. A shop that genuinely sells one size and a shop
     whose size selector nobody parsed look identical from outside, which is why
     this reports them apart:
       oneRow      -- listings offering a single size. Real for a cart, a symptom
                      for flower.
       oneSizeOnly -- that single row is labelled "One Size"/"Each", i.e. no
                      weight was read at all. THIS is the shape of an unparsed
                      selector, and it is the number to watch.
       multiWeight -- one row whose label states several weights ("1g 3.5g 7g"),
                      which is a whole selector captured as one option. gramsOf
                      refuses to price those, so they show no per-gram until the
                      shop is captured again.
       merged      -- listings gathered from per-variation entries (Lume, and any
                      rendered-page capture). A high number here is the fix
                      working, not a fault.
     A store reading oneSizeOnly near its own total needs re-capturing with the
     bookmarklet: the collector reads shapes now that it could not read then, and
     no server-side repair can invent rows that were never captured. */
  const rowsCensus = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    const c = rowsCensus[k] || (rowsCensus[k] = {
      products: 0, rows: 0, oneRow: 0, oneSizeOnly: 0, multiWeight: 0, merged: 0,
      withGrams: 0, examples: [],
    });
    const sizes = p.sizes || [];
    c.products++;
    c.rows += sizes.length;
    if ((p.mergedFrom || 1) > 1) c.merged++;
    if (sizes.some(r => r && r[2] > 0)) c.withGrams++;
    const multi = sizes.filter(r => r && weightsIn(String(r[0] || "")).length > 1);
    if (multi.length) {
      c.multiWeight++;
      if (c.examples.length < 4) c.examples.push({ name: p.name, why: "several weights in one label", label: multi[0][0] });
    }
    if (sizes.length === 1) {
      c.oneRow++;
      /* AND NO WEIGHT EITHER, AND NOT GEAR. A row labelled "One Size" that still
         carries grams is a cart whose weight was read off its title, and a piece
         of gear has one weightless option because that is what it is -- neither is
         an unparsed selector. Counting either would report the fix as the fault
         and bury the shops that genuinely need re-capturing. */
      if (!p.nonConsumable &&
          /^(one size|each|default|n\/?a|single)$/i.test(String(sizes[0][0] || "").trim()) && !(sizes[0][2] > 0)) {
        c.oneSizeOnly++;
        if (c.examples.length < 4) c.examples.push({ name: p.name, why: "one row, no weight read", label: sizes[0][0] });
      }
    }
  }
  for (const k of Object.keys(rowsCensus)) {
    const c = rowsCensus[k];
    c.avgRows = c.products ? Math.round((c.rows / c.products) * 100) / 100 : 0;
    c.oneSizeOnlyPct = c.products ? Math.round((c.oneSizeOnly / c.products) * 100) + "%" : "n/a";
    c.note = c.products && c.oneSizeOnly / c.products > 0.5
      ? "most listings carry no weight at all - re-capture this shop before reading anything else here"
      : "";
  }
  out.sizeRows = rowsCensus;

  /* WHAT WAS REFUSED A WEIGHT, and why. Non-consumables are expected to appear
     here -- a bottle of glass cleaner losing its per-gram is this working. An
     "implausible for" entry is the other kind: a label form that produced a
     number outside what that category can be, which is where the 200 g pre-roll
     came from. Those are worth reading one by one. */
  const grams = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    const g = grams[k] || (grams[k] = { products: 0, nonConsumable: 0, refused: 0, gearWeightLabels: 0, examples: [] });
    g.products++;
    if (p.nonConsumable) g.nonConsumable++;
    /* Gear whose row labels still state a weight, which only happens where there
       is more than one of them (see toProduct). The engine will read those as
       flower; a handful is a curiosity, a hundred is worth another look. */
    if (p.nonConsumable && (p.sizes || []).some(r => r && weightsIn(String(r[0] || "")).length)) g.gearWeightLabels++;
    for (const n of (p.gramNotes || [])) {
      g.refused++;
      if (g.examples.length < 5) g.examples.push({ name: p.name, cat: p.category, ...n });
    }
  }
  out.gramPlausibility = grams;

  /* CATEGORY VOCABULARY, and zero is the expected reading.
     A label here is one the ENGINE has never heard of, which means the moment a
     row escapes the engine's own name rules it becomes a second filter entry
     beside the real one -- the pre-roll split (Pre-Rolls 6 / Pre-rolls 737) and
     the phantom "CBD" entry were both this, found by eye and by this assert
     respectively. Anything listed needs either a TO_ENGINE entry or a place in
     NOT_A_CATEGORY; it is reported rather than folded automatically, because
     guessing which known label an unknown one meant would hide a store's real
     vocabulary. */
  out.categoryVocab = {
    unknownToEngine: Object.fromEntries([...UNCANON.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)),
    engineKnows: [...ENGINE_CATEGORIES],
    folded: TO_ENGINE,
  };

  /* How often the sanity guard fires, and on what. Zero is the expected reading;
     anything else names a label form gramsOf() does not understand yet. */
  const sanity = {};
  for (const p of payload.products) {
    const k = p.storeKey || "?";
    if (!sanity[k]) sanity[k] = { total: 0, suppressed: 0, examples: [] };
    sanity[k].total++;
    if (p.perGSuppressed != null) {
      sanity[k].suppressed++;
      if (sanity[k].examples.length < 4) {
        sanity[k].examples.push({ name: p.name, rejectedPerG: p.perGSuppressed, sizes: (p.sizes || []).slice(0, 2) });
      }
    }
  }
  out.perGramSanity = sanity;

  out.sharedBatches = {
    distinctTags: byBatch.size,
    seenAtMoreThanOneShop: shared.length,
    examples: shared.slice(0, 10),
  };

  if (payload.meta.probes) out.probes = payload.meta.probes;
  if (!("slim" in q)) out.sample = payload.products.slice(0, 3);
  return res.status(200).send(JSON.stringify(out, null, 2));
}

/* ----------------------------------------------------------------- demo --- */
/* Placeholder shop names ON PURPOSE. Prices are plausible Michigan numbers so
   the grid, the sorting and the per-gram maths are all exercised, but nothing
   here is attributed to a real business. Delete this the day a store connects. */
function demo() {
  const S = { key: "demo", name: "Sample Shop A", site: "" };
  const T = { key: "demo2", name: "Sample Shop B", site: "" };
  const mk = (st, name, cat, type, thc, rows) => toProduct(st, {
    id: name.toLowerCase().replace(/\W+/g, "-"), name, category: cat, type, thc,
    sizes: rows.map((r, i) => row(r[0], r[1], r[2], name + "-" + i, true, OFFCUT_RE.test(name))),
  });
  return [
    mk(S, "GMO Cookies", "Flower", "Indica", 28.6, [["1 g",12,1],["Eighth · 3.5 g",35,3.5],["Half · 14 g",110,14],["Ounce · 28 g",170,28]]),
    mk(S, "Wedding Cake", "Flower", "Hybrid", 27.2, [["1 g",10,1],["Eighth · 3.5 g",30,3.5],["Ounce · 28 g",160,28]]),
    mk(T, "Blue Dream", "Flower", "Hybrid", 24.1, [["1 g",8,1],["Eighth · 3.5 g",22,3.5],["Ounce · 28 g",110,28]]),
    mk(T, "Northern Lights", "Flower", "Indica", 21.3, [["Eighth · 3.5 g",18,3.5],["Ounce · 28 g",88,28]]),
    mk(S, "Grape Ape Smalls", "Flower", "Indica", 19.8, [["Eighth · 3.5 g",12,3.5],["Ounce · 28 g",58,28]]),
    mk(T, "Sour Diesel Shake", "Flower", "Sativa", 18.2, [["Half · 14 g",18,14],["Ounce · 28 g",30,28]]),
    mk(S, "Live Resin Cart", "Vape", "Hybrid", 82.4, [["0.5 g",22,0.5],["1 g",35,1]]),
    mk(T, "Distillate Cart", "Vape", "Sativa", 88.1, [["1 g",18,1]]),
    mk(S, "Infused Pre-Roll", "Pre-roll", "Hybrid", 38.5, [["1 g",12,1]]),
    mk(T, "Rosin Gummies", "Edible", "Hybrid", null, [["10 × 10 mg",12,0]]),
    /* GEAR, because every one of these shops sells some and because a placeholder
       catalogue with none of it cannot exercise the path where the whole bug was:
       a four-ounce bottle of glass cleaner was on the live shelf with a price per
       gram, filed under Flower. It is here so the accessory card is provable in a
       browser rather than only in arithmetic (test-coldwater-page.mjs drives it),
       and it is one row out of eleven. */
    mk(S, "710 Cleaner", "Accessories", "", null, [["4 oz",12,0]]),
  ];
}

export {
  STORES, gramsOf, OFFCUT_RE, rscRoots, remixRoots, balancedEnd, dealMath,
  /* Exported to be tested directly. Every one of these decides a NUMBER on the
     card rather than a layout, and all four have shipped a wrong one: the weight
     read off a title, the weight read off a size selector nobody parsed, the
     listing that arrived as five one-option cards, and the glass cleaner with a
     price per gram. */
  gramsFromTitle, variantRows, mergeListings, listingKey, isNonConsumable, dedupeRows,
  /* Exported so a suite can check that a captured sale price actually MOVES THE
     RANKING. The whole chain -- sizes[].sale, row() slot 7, dealPerG, perG --
     existed and worked for months while the collector never captured a sale
     price, so every part passed its own test and the shelf still ranked
     discounted products at their list price. The end of the chain is the only
     place that gap was visible. */
  toProduct,
  /* The category vocabulary, exported for the same reason: a label the engine
     does not share splits a filter entry in two and nothing errors. */
  normCategory, engineCategory, ENGINE_CATEGORIES, TO_ENGINE, GRAM_BOUNDS, UNCANON,
  TOWNS, DEFAULT_TOWN, townKey, lumeStore, LUME_TOWNS,
};

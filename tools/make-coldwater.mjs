/* tools/make-coldwater.mjs — generate public/coldwater.html FROM public/index.html.
 *
 * WHY A GENERATOR AND NOT A HAND-WRITTEN PAGE. The brief was "identical to
 * Legal-Leaf, different catalogue and colour scheme". Retyping the design would
 * guarantee drift the first time index.html changes; deriving it guarantees the
 * opposite. Re-run this after any index.html change and the two stay in step.
 *
 * WHAT IT MUST NOT DO (CLAUDE.md §5 / §5a):
 *   - never decode, re-encode, reformat or touch the base64 engine line. It is
 *     copied through byte-for-byte, and the run ASSERTS its md5 is unchanged.
 *   - never re-serialise the file. Every edit is a targeted replacement on one
 *     line, done in ISO-8859-1 so bytes 0x80-0xFF round-trip 1:1 and the
 *     non-ASCII inventory cannot shift.
 *   - never introduce a BOM or change line endings.
 *
 * The colour swap is two things: a CSS custom-property override appended in
 * <head> (additive, the way §5 asks for), plus a literal recolour of the leaf
 * green baked into the inline nav SVGs, which are attribute fills that no
 * variable can reach. That recolour is applied ONLY to lines that are not the
 * blob.
 *
 * The catalogue swap is a fetch shim, also in <head>, also additive. The engine
 * hardcodes "/api/products" in five places inside the blob; the shim rewrites
 * that one path prefix to "/api/coldwater" before the engine is appended to the
 * document, so the blob itself needs no edit. Everything else about the engine —
 * rendering, filters, sorting, the drawer, the COA modal — runs unchanged,
 * because the endpoint answers in the same {products, meta} shape.
 *
 *   node tools/make-coldwater.mjs            # write public/coldwater.html
 *   node tools/make-coldwater.mjs --check    # verify only, non-zero on drift
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

import { marketOf, DEFAULT_MARKET } from "../api/markets.js";

/* ------------------------------------------------------------- the market ---
 * STEP 4 OF ONE_CORE.md: a city page is meta + config, and nothing else about it
 * is city-shaped. This is where that becomes true.
 *
 * Everything below that used to say "Coldwater" now derives from the registry,
 * so generating a second city is `--market lansing` rather than a second copy of
 * this file. The six things that were town-specific are the title, the
 * description, the canonical url, the og:url, the output path and the overrides
 * market -- and they are six because they were COUNTED, not guessed:
 * test-one-core.mjs generates two cities and asserts the diff is confined to
 * exactly those.
 *
 * The geographic hook ("at I-69 exit 13") lives in the registry rather than here
 * for the same reason: it is editorial, true of one place, and written into the
 * generator it would be a per-city branch in the one file that must not have any.
 */
const argMarket = (() => {
  const i = process.argv.indexOf("--market");
  return i > 0 ? process.argv[i + 1] : DEFAULT_MARKET;
})();
const MK = marketOf(argMarket);
const argOut = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 ? process.argv[i + 1] : null;
})();

const SRC = "public/index.html";
const OUT = argOut || ("public/" + MK.slug + ".html");
const CHECK = process.argv.includes("--check");
const ENC = "latin1"; // Node's name for ISO-8859-1. Byte-preserving both ways.

const md5 = s => createHash("md5").update(Buffer.from(s, ENC)).digest("hex");
const nonAscii = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) n++; return n; };

const src = readFileSync(SRC, ENC);
/* The trip page is a separate static file, not generated from index.html -- but
   it is the other half of one feature, and the half that broke. Read here so the
   checks below can assert the two agree about which key holds the list. */
const LIST = readFileSync("public/trip.html", "utf8");
if (src.charCodeAt(0) === 0xFEFF) { console.error("FAIL: source carries a BOM"); process.exit(1); }

const lines = src.split("\n");

/* The engine line is the one absurdly long line holding var B="...". Find it by
   shape rather than by number, so an edit above it cannot silently repoint us. */
const blobIdx = lines.findIndex(l => l.length > 100000 && l.includes('var B="'));
if (blobIdx < 0) { console.error("FAIL: could not find the engine line"); process.exit(1); }
const blobMd5Before = md5(lines[blobIdx]);
const blobLenBefore = lines[blobIdx].length;

/* ---------------------------------------------------------------- edits --- */

let edits = 0;
const swap = (idx, from, to) => {
  if (!lines[idx].includes(from)) return false;
  lines[idx] = lines[idx].split(from).join(to);
  edits++;
  return true;
};
/* Apply to the first line matching `test`, skipping the blob line outright. */
const swapWhere = (test, from, to) => {
  for (let i = 0; i < lines.length; i++) {
    if (i === blobIdx) continue;
    if (test(lines[i]) && lines[i].includes(from)) return swap(i, from, to);
  }
  return false;
};

const TITLE = `${MK.label} Cannabis Prices: Compare Every Dispensary by Price Per Gram`;
const DESC  = `Compare live menus from the ${MK.label}, Michigan dispensaries` +
              `${MK.blurb ? " " + MK.blurb : ""}. ` +
              "Sorted by real price per gram, filtered by shop, strain and category. Adults 21+.";

swapWhere(l => l.includes("<title>"),
  "<title>Legal-Leaf Market: Compare Legal Hemp Deals by Price Per Gram</title>",
  `<title>${TITLE}</title>`);
swapWhere(l => l.includes('rel="canonical"'),
  'href="https://legal-leafmarket.com/"',
  `href="https://legal-leafmarket.com/${MK.slug}"`);
swapWhere(l => l.includes('og:url'),
  'content="https://legal-leafmarket.com/"',
  `content="https://legal-leafmarket.com/${MK.slug}"`);
swapWhere(l => l.includes('og:title'),
  'content="Legal-Leaf Market: Compare Legal Hemp Deals by Price Per Gram"',
  `content="${TITLE}"`);
swapWhere(l => l.includes('twitter:title'),
  'content="Legal-Leaf Market: Compare Legal Hemp Deals by Price Per Gram"',
  `content="${TITLE}"`);
for (const key of ["og:description", "twitter:description", 'name="description"']) {
  swapWhere(l => l.includes(key),
    'content="Compare legal hemp prices across trusted stores',
    `content="${DESC}" data-was="Compare legal hemp prices across trusted stores`);
}
/* THE HERO IS THE ONE THING A VISITOR READS FIRST, and it was the pilot's name
   typed as a literal -- so the second city shipped with a correct <title>, a
   correct canonical, a correct feed, a correct banner, and COLDWATER CANNABIS
   across the top of the page. Every machine-readable thing about it was right
   and the only human-readable one was wrong, which is why the diff between two
   generated cities did not catch it: both files carried the same literal, so
   the line did not differ. test-detroit-live.mjs reads it out of a rendered
   page instead, which is the only place this shows up. */
swapWhere(l => l.includes("<h1>LEGAL-LEAF MARKET</h1>"),
  "<h1>LEGAL-LEAF MARKET</h1>", `<h1>${MK.label.toUpperCase()} CANNABIS</h1>`);

/* THE INHERITED AFFILIATE LINE IS FALSE ON THIS PAGE, and that is a worse
   problem than the missing disclaimer it sits next to. index.html's footer says
   Legal-Leaf Market "may earn a commission on qualifying purchases made through
   links on this site" -- true of the hemp side, where refUrl() stamps a tracking
   parameter onto every product link. It is not true here. No Coldwater
   dispensary has a programme with this site, every outbound link on this page is
   untracked, and nothing on it is paid placement. Leaving the sentence in place
   would have the page claim a commercial relationship with seven local shops
   that do not know it exists.

   So the disclosure is replaced rather than deleted -- a page that says nothing
   about money is not the same as one that says there is none. */
swapWhere(l => l.includes("Affiliate disclosure:"),
  "Affiliate disclosure: Legal-Leaf Market may earn a commission on qualifying purchases made through links on this site, at no extra cost to you, coupon savings are yours either way.",
  "No affiliation, and no commission: this page is not affiliated with, endorsed by, "
  + "sponsored by or connected to any dispensary, brand or product shown on it. "
  + "Every outbound link here is untracked, nothing is paid placement, and no shop "
  + "pays to appear or to rank. Shop and brand names, logos and product photographs "
  + "belong to their respective owners and are used only to identify what is being "
  + "compared. Prices and availability are read from each shop&#x2019;s own public menu, "
  + "can be out of date or wrong, and are not an offer &#x2014; always confirm with the "
  + "shop before you travel.");

/* The nav glyphs hardcode the leaf green as an SVG stroke attribute. No custom
   property reaches an attribute, so recolour the literal — everywhere EXCEPT
   the blob, which swapWhere/this loop both refuse to touch. */
let svgHits = 0;
for (let i = 0; i < lines.length; i++) {
  if (i === blobIdx) continue;
  if (lines[i].includes("#4ade80")) {
    const before = lines[i];
    lines[i] = lines[i].split("#4ade80").join("#4ec9ff");
    if (lines[i] !== before) svgHits++;
  }
}

/* ------------------------------------------------------- injected head ---- */

const INJECT = `<!-- ============================================================
     COLDWATER OVERLAY. Generated by tools/make-coldwater.mjs from
     index.html; do not hand-edit this file, edit the generator.
     Two additive blocks, in the spirit of CLAUDE.md section 5: the
     engine blob is byte-identical to index.html's and is never touched.
     (Section marks are spelled out on purpose -- this file's generator
     asserts the non-ASCII inventory matches index.html exactly, and a
     stray high byte in a comment is enough to trip it.)
     ============================================================ -->
<!-- THE TWO HOSTS THE STORE STRIP TALKS TO, warmed at parse time. The strip
     itself cannot be built until /api/coldwater has answered, so without this
     the DNS lookup and the TLS handshake for a shop's mark start late and land
     on the critical path of something a shopper is already looking at.
     crossorigin because these are fetched as anonymous images; without the
     attribute the warmed connection is not the one the <img> ends up using. -->
<link rel="preconnect" href="https://www.google.com" crossorigin>
<link rel="preconnect" href="https://icons.duckduckgo.com" crossorigin>

<script id="cw-cart-isolate">
/* TWO PAGES, TWO CARTS, AND THEY WERE ONE.
   This page is generated from index.html, so it carries the SAME engine -- and
   the engine stores its cart in localStorage under "ll_cart". Same origin, same
   key, so a dispensary product added here landed in the hemp site's cart and a
   hemp product landed here. On / the drawer then tried to build a vendor
   checkout URL for a Coldwater item that has no such thing, and the checkout
   read as broken or missing. Reported as "you took away the checkout feature
   all together" -- nothing was removed; the two carts were never separated.

   They are genuinely different products. Legal-Leaf checks out to a vendor's
   own cart; Coldwater cannot and must not -- these shops sell at a counter, a
   cart across six of them is not a thing anyone can buy, and the answer here is
   the shopping list.

   The key lives INSIDE the base64 blob and the blob is never edited (CLAUDE.md
   section 5), so the storage is namespaced underneath it instead. This runs in
   <head>, before the engine, and rewrites only that one key -- everything else
   passes through untouched.

   AND THE NAMESPACE CARRIES THE TOWN, because two cities are two trips. The
   prefix was a flat "ll_cw:", which was right while there was one dispensary
   page and silently wrong at two: a jar added in Lansing and a jar added in
   Coldwater would land in one list, and the list is a route somebody drives.
   That is the same failure as the shared cart this block exists to fix, one
   level in.

   THE ONE-TIME LIFT IS WHY THERE IS NO PER-CITY CASE HERE. Moving the prefix
   orphans whatever is under the old key, and the pilot is the only page that
   has ever written one -- so the tempting fix is to keep "ll_cw:" for Coldwater
   and namespace everyone else, which is exactly the per-city branch this
   architecture exists to prevent. Instead every city runs the same lift: if my
   key is empty and the flat one is not, take it once. Only the pilot will ever
   find anything there, and no line of code knows that. */
(function(){
  try {
    var NS = "ll_cw:${MK.slug}:", OLD = "ll_cw:", HIT = /^ll_cart/;
    var ls = window.localStorage;
    try {
      /* Read every key BEFORE writing any. localStorage enumeration is live, so
         setItem inside the loop shifts the indices under it and the pass skips
         entries -- with one cart key that is invisible and with two it is a lost
         list. An already-namespaced key cannot match here anyway: HIT is
         anchored, and "coldwater:ll_cart" does not start with "ll_cart". */
      var olds = [];
      for (var i = 0; i < ls.length; i++) {
        var kk = ls.key(i);
        if (kk && kk.indexOf(OLD) === 0 && HIT.test(kk.slice(OLD.length))) olds.push(kk);
      }
      for (var j = 0; j < olds.length; j++) {
        var to = NS + olds[j].slice(OLD.length);
        if (ls.getItem(to) == null) ls.setItem(to, ls.getItem(olds[j]));
      }
    } catch (e) { /* a full or refused store leaves the old list, not a crash */ }

    /* WHO THIS PAGE IS, PUBLISHED FOR /trip TO READ. That page is
       shared by every city and has no generator behind it, so it cannot know
       the town from its own source -- it resolves one at runtime, and this is
       the record it resolves from. Written on every load so it always names the
       town last browsed, which is the one whose trip a shopper is holding. */
    try {
      ls.setItem("ll_cw:ctx", JSON.stringify(
        { slug: "${MK.slug}", label: "${MK.label}", market: "${MK.market}" }));
    } catch (e) {}
    /* THE SAME FACT, IN MEMORY, for code that runs on this page rather than on
       /trip. public/js/rails.js is shared with legal-leafmarket now, and one
       thing on the brand rail is not shared: "Your town not here? Bring it on"
       is recruitment copy addressed to somebody looking at a CITY page, and on
       the national hemp shelf it is addressed to nobody. localStorage would be
       the wrong place to ask -- it survives the visit, so the hemp page would
       inherit whichever town was browsed last and print the note anyway. */
    window.LL_TOWN = { slug: "${MK.slug}", label: "${MK.label}", market: "${MK.market}" };
    var get = ls.getItem.bind(ls), set = ls.setItem.bind(ls), del = ls.removeItem.bind(ls);
    var map = function(k){ return HIT.test(String(k)) ? NS + k : k; };
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: function(k){ return get(map(k)); },
      setItem: function(k, v){ return set(map(k), v); },
      removeItem: function(k){ return del(map(k)); },
      clear: function(){ return ls.clear(); },
      key: function(i){ return ls.key(i); },
      get length(){ return ls.length; },
    }});
  } catch (e) { /* a browser refusing this leaves the shared key, not a crash */ }
})();
</script>

<style id="cw-palette">
  /* Same tokens as index.html's :root, same roles, cold instead of green.
     Only the accent family and the ground move; --gold and --red are shared
     across the family (see css/tokens.css) and stay put. */
  :root{
    --bg:#080f14;
    --panel:rgba(16,27,35,.72); --panel2:rgba(8,16,22,.85);
    --glass:rgba(12,24,32,.42); --glass-line:rgba(120,180,215,.22);
    --line:#22303a;
    --text:#eaf2f6; --muted:#9fb4c2; --dim:#7d94a2;
    --leaf:#4ec9ff; --leaf2:#22a8e8; --leaf3:#1787c4;
    --sage:#4ec9ff; --sage-dk:#22a8e8;
    --accent:#4ec9ff; --accent-dk:#1787c4; --accent-rgb:78,201,255;
    --chip:#15242e;
  }
  /* The hero rule under the wordmark is a green gradient in the base sheet. */
  .hero .title .u{background:linear-gradient(90deg,#4ec9ff,#22a8e8,#1787c4)}
  /* Greek Glass is a Big Cartel glass shop cross-sold on the hemp site. It has
     nothing to do with a Coldwater dispensary, so its floating shop pill goes. */
  .gg-float{display:none!important}
  /* THE CONCIERGE IS OFF HERE, AND THIS IS NOT A STYLE CHOICE.
     /api/concierge reads /api/products -- the national mail-order hemp feed. On
     this page that bot would answer a shopper standing on Willowbrook Road by
     recommending THCa flower shipped to their door: two markets that are close
     cousins to us and completely separate to a customer, one of them a
     dispensary they can walk into and one of them a parcel.
     Worse than the seed bug, because a chat bot ASSERTS things in prose rather
     than just displaying them. A wrong card is a wrong card; a wrong sentence is
     advice.
     It comes back when it reads /api/coldwater and is locked to this town --
     free to offer another Michigan town, but only if the shopper says yes
     first, never by wandering there on its own.

     THE SELECTOR WAS WRONG AND HID NOTHING. #ll-concierge is the <script> tag,
     and [id^="ll-concierge"] only ever matched that and its <style>: both
     invisible already. The widget BUILDS its button at runtime as .llc-fab and
     its window as .llc-panel, so the stop never touched either. The button has
     been sitting in the bottom-right corner of this page the whole time and the
     only thing actually stopping it was the fetch refusal -- a visible button
     that errors, which is the worst of the three possible states. Surfaced as
     "the button is tiny ... and it also is over top of another button", because
     it was covering the trip tally. */
  #ll-concierge,[id^="ll-concierge"],.ll-concierge,
  .llc-fab,.llc-panel,[class^="llc-"]{display:none!important}
</style>
<script id="cw-no-greekglass">
/* GREEK GLASS OFF.
   The engine carries a baked-in Greek Glass accessory cross-sell: 34 seed
   products assigned to window.LL_GREEKGLASS_SEED, concatenated into the product
   list, and live-refreshed from api.bigcartel.com. That is a hemp-site
   cross-sell and it has no business on a Coldwater dispensary page -- it was
   showing rigs and wine glasses beside the flower, and putting "Greek Glass (34)"
   in the store filter.

   All of it lives inside the blob, which is not edited (section 5). So neuter the
   channel instead, from <head>, before the blob is decoded: reads of the seed
   return an empty array and writes to it are swallowed. That kills the seed AND
   the live refresh, because the refresh path ends in an assignment this setter
   eats. The fetch to Big Cartel is short-circuited below as well, so the page
   does not make a pointless cross-origin request for a catalogue it will
   discard. */
(function(){
  function blank(name){
    try{
      Object.defineProperty(window, name, {
        configurable: true,
        get: function(){ return []; },
        set: function(){ /* swallowed on purpose */ }
      });
    }catch(e){ /* non-fatal: the engine treats an absent seed as no seed */ }
  }
  blank("LL_GREEKGLASS_SEED");

  /* AND THE MAIN SEED, which is the bigger of the two problems.
     The engine ships Legal-Leaf's own hemp catalogue baked into the blob and
     paints it INSTANTLY, then hot-swaps live data in when the feed answers --
     "Renders seed instantly, then hot-swaps in live data when it arrives", in
     its own words, and "if it fails, the baked seed stays".
     On a Coldwater page that means several seconds of THCa flower from sixteen
     mail-order hemp shops, under a heading that says COLDWATER CANNABIS, before
     anything Coldwater appears. Reported exactly that way: "it is clearly just
     the same that is pulling". And on a feed error it is not a flash, it is the
     permanent state.
     An empty grid that fills in a moment is honest. Another market's catalogue
     wearing this one's name is not, so the seed is blanked here and the page has
     nothing to show until /api/coldwater answers. */
  blank("LL_MAIN_SEED");
})();
</script>
<script id="cw-endpoint">
/* The engine hardcodes "/api/products" in five places inside the base64 blob,
   which section 5 forbids editing. So repoint the PATH instead: this
   shim runs in <head>, long before the blob is decoded and appended, and
   rewrites that one prefix to /api/coldwater. Everything downstream is
   unchanged because /api/coldwater answers in the same {products, meta} shape
   the engine has accepted since the Apps Script days.

   Deliberately narrow. It only touches same-origin paths that BEGIN with
   /api/products, so the store-side cart calls the engine also makes
   (/cart, /cart.php, /remote/v1/cart/add) and the Big Cartel fetch are
   untouched. Query strings ride along unchanged. */
(function(){
  /* THE ENDPOINT IS MARKET-NEUTRAL NOW (step 5). It used to be "/api/coldwater",
     which made the word ambiguous on every city page: is this string the city or
     the endpoint? test-one-core.mjs had to mask it before it could diff two
     cities, and that mask is gone with this line. /api/coldwater still works and
     always will -- it is an alias, not a deprecation. */
  var FROM = "/api/products", TO = "/api/market", TOWN = "${MK.slug}";
  var real = window.fetch;
  if (typeof real !== "function") return;
  /* THE TOWN TRAVELS WITH THE REPOINT, and leaving it out was the whole bug this
     step found. Generating a second city produced a page whose shim still said
     plain "/api/coldwater" -- so a Lansing page would have served Coldwater's
     shelf under a Lansing heading. That is precisely the failure the ?town=
     scoping exists to prevent, arriving in the new architecture by a route the
     scoping never sees. It was invisible until two cities were generated and
     diffed, which is why step 4 is a diff and not a read-through.

     Appended as a QUERY PARAMETER rather than baked into TO, because the engine
     calls this endpoint with its own query already ("?refresh") and
     concatenating two paths would produce "?town=x?refresh". */
  function repoint(u){
    if (typeof u !== "string" || u.indexOf(FROM) !== 0) return null;
    var rest = u.slice(FROM.length);
    var sep = rest.indexOf("?") === 0 ? "&" : "?";
    return TO + rest + sep + "town=" + TOWN;
  }
  /* The engine also refreshes the Greek Glass cross-sell from Big Cartel. With
     the seed neutered above nothing would render, but the request would still go
     out -- so answer it with an empty list rather than reach a third party for a
     catalogue this page discards. */
  function isGG(u){ return typeof u === "string" && u.indexOf("api.bigcartel.com") > -1; }
  var EMPTY = function(){ return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };

  /* THE CONCIERGE DOES NOT ANSWER ON THIS PAGE, and the CSS hide above is not
     enough on its own. api/concierge.js reads /api/products -- the national
     mail-order hemp catalogue -- so here it would answer a shopper standing on
     Willowbrook Road by recommending THCa flower shipped to their door.
     Hiding the button stops the shopper reaching it; stopping the request is
     what stops it ANSWERING, which matters because the widget is one additive
     block in index.html that a future edit could rename, and because a hidden
     element still has a console, a devtools "unhide", and a paid model call
     behind it. Two independent stops, on purpose.
     It comes back the moment it reads /api/coldwater and is locked to this
     town: free to offer another Michigan town, but only if the shopper says
     yes first, never by wandering there on its own. */
  /* Same-origin only, and absolute forms too: a Request object carries a fully
     resolved .url, so a bare path test would pass on the string call and miss
     the Request one -- the kind of half-cover that reads as working. */
  function isConcierge(u){
    if (typeof u !== "string") return false;
    return u.indexOf("/api/concierge") === 0 ||
           u.indexOf(location.origin + "/api/concierge") === 0;
  }
  var OFFTOWN = function(){
    return new Response(JSON.stringify({
      error: "off-town",
      detail: "The concierge reads the national hemp catalogue and is not scoped to Coldwater yet, so it is off on this page rather than recommending mail-order flower to a walk-in shopper."
    }), { status: 501, headers: { "content-type": "application/json" } });
  };

  /* TAP THE FEED FOR EACH SHOP'S DOMAIN. The "Shop by store" strip draws each
     shop's own mark, and the only place a domain exists on this page is the
     feed itself -- every product carries a store name and a domain. Reading it
     here means no logo table to commit and nothing extra to keep in step with
     the roster. Keyed by store NAME because that is what the engine puts in the
     #fStore option value, and the strip is a face for that select. Cloned, so
     the engine still gets an unread body. */
  function tap(p){
    return p.then(function(res){
      try{
        res.clone().json().then(function(j){
          var d = {}, deals = {};
          (j && j.products || []).forEach(function(x){
            if (!x) return;
            if (x.store && x.domain && !d[x.store]) d[x.store] = x.domain;
            /* Keyed on the printed name, because that is the only handle the
               additive layer has on an engine-rendered card. */
            if (x.name && (x.deal || x.dealPerG != null)) {
              deals[String(x.name).trim().toLowerCase()] = {
                text: x.deal || "", perG: x.dealPerG, minQty: x.dealMinQty, shelf: x.shelfPerG,
                mix: !!x.dealMix, group: x.dealGroup || ""
              };
            }
          });
          /* BRANDS, grouped as the strip needs them: how many products, and
             HOW MANY SHOPS. The second number is the whole feature -- a brand at
             one shop is a label, a brand at three is a price comparison. */
          var brands = {}, catOf = {};
          (j && j.products || []).forEach(function(x){
            if (!x || !x.brandKey || !x.brand) return;
            var e = brands[x.brandKey] || (brands[x.brandKey] = { disp: x.brand, n: 0, stores: [], img: "",
                                                                  perStore: {}, perCat: {}, perPair: {} });
            e.n++;
            if (e.stores.indexOf(x.store) < 0) e.stores.push(x.store);
            /* WHERE EACH MAKER'S PRODUCTS ACTUALLY ARE, so the brand strip can
               answer the other two. Reported on the hemp shelf first -- "the
               brand strip is not faceted to the others, it isn't filtering or
               changing when I click on the other circles" -- and it is the same
               here for the same reason: the store and category strips are faces
               for controls the engine owns, and the brand strip is built from
               the feed, so it said the same thing under every filter.
               Three tallies rather than one, so no count is ever estimated. */
            var st = String(x.store || "");
            if (st) e.perStore[st] = (e.perStore[st] || 0) + 1;
            var ct = String(x.category || "");
            if (ct) {
              e.perCat[ct] = (e.perCat[ct] || 0) + 1;
              if (st) { var pk = st + "\u0000" + ct; e.perPair[pk] = (e.perPair[pk] || 0) + 1; }
            }
            /* THE BRAND'S PICTURE IS ITS OWN PRODUCT PHOTO. There is no logo
               table to commit and keep in step, and the favicon trick the store
               strip uses needs a domain, which a brand does not have here. The
               feed already carries 96-100% image coverage, so the first product
               photo this maker has IS a picture of the brand -- and if it has
               none, the tinted monogram still answers. */
            if (!e.img && x.image) e.img = x.image;
          });
          /* THE FEED'S OWN WORD FOR EACH PRODUCT'S CATEGORY, keyed on the id the
             card carries in data-pid. THE TALLY ABOVE IS KEYED ON THE FEED'S
             VOCABULARY AND #fCategory CARRIES THE ENGINE'S, which on a city page
             are genuinely different words -- the note below this block spells out
             why a map built from the feed's words missed every lookup. Publishing
             this pair lets rails.js LEARN the translation off rendered cards,
             where data-pid and data-cat sit in the same element and cannot
             disagree, rather than either side twinning normCategory. */
          (j && j.products || []).forEach(function(x){
            if (x && x.id && x.category) catOf[x.id] = String(x.category);
          });
          /* NO CATEGORY MAP IS BUILT HERE, and the reason is worth keeping: the
             obvious version of it silently never matched. The feed publishes
             "Flower", "Vaporizers", "Pre-Rolls"; the engine puts every product
             through its OWN normCategory and files those same rows under
             "THCA Flower", "Concentrate" (a cart is a sub-tag of it) and
             "Pre-rolls" -- which is what ends up in #fCategory, and therefore
             what the category strip is keyed on. A picture map built from the
             feed's vocabulary missed every lookup, threw nothing, and left a
             strip of glyphs on a feed with 96% image coverage.
             So cw-catrow reads its pictures off the engine's own rendered cards
             instead, where the classification and the photograph sit together. */
          /* WHAT THE SHOPPING LIST NEEDS, keyed on the printed title like the
             deal chip, because that is the only handle an additive layer has on
             a card the engine rendered. */
          /* CATEGORY PICTURES COME FROM THE FEED, NOT FROM THE SCREEN.
             Reading them off the rendered grid could only ever see the cards
             currently drawn -- forty of them, from whichever shops sorted first
             -- so six of the eight categories had no product on screen and kept
             their drawn mark. Reported as "you got two real pictures in there
             out of eight". The feed has 5,000 products with 96% image coverage
             and it already speaks the ENGINE's category vocabulary (toProduct
             runs engineCategory() before publishing), so it is both complete and
             correctly keyed. Eight candidates per category is enough for the
             chooser to have a real choice and small enough to hand over. */
          var catPool = {};
          (j && j.products || []).forEach(function(x){
            if (!x || !x.image || !x.category) return;
            var b = catPool[x.category] || (catPool[x.category] = []);
            if (b.length < 40) b.push({ n: String(x.name || ""), img: x.image });
          });

          var byName = {};
          (j && j.products || []).forEach(function(x){
            if (!x || !x.name) return;
            byName[String(x.name).trim().toLowerCase()] = {
              store: x.store || "", storeKey: x.storeKey || "",
              startsAt: x.startsAt, perG: x.perG, shelfPerG: x.shelfPerG,
              deal: x.deal || "", mix: !!x.dealMix, group: x.dealGroup || "",
              /* THE UNLOCKED PRICE OF ONE, not per gram. This said dealPerG,
                 which is a different quantity: on a 3-for-$84 offer a $30 eighth
                 came through as "$8.00 each". */
              minQty: x.dealMinQty, unit: x.dealPerUnit, perGDeal: x.dealPerG, cat: x.category || "",
              brand: x.brand || "", url: x.url || "",
              /* FRESHNESS OF THE PRICE, not of the row. api/coldwater-merge.js
                 stamps these from whichever lane won the pricing block, because
                 a card can carry a fresh description over a three-week-old
                 price and only one of those misleads anybody. */
              asOf: x.asOf || "", stale: !!x.stale, ageDays: x.ageDays,
              priceLane: x.priceLane || "",
              /* The operator's own observations. Rendered by cw-colour. */
              colour: x.colour || null
            };
          });
          window.LL_COLDWATER_META = window.LL_COLDWATER_META || {};
          window.LL_COLDWATER_META.byName = byName;
          window.LL_COLDWATER_META.roster = (j && j.roster) || [];
          window.LL_COLDWATER_META.domains = d;
          window.LL_COLDWATER_META.deals = deals;
          window.LL_COLDWATER_META.brands = brands;
          window.LL_COLDWATER_META.catOf = catOf;
          window.LL_COLDWATER_META.catPool = catPool;
          /* THE SENTENCES, for the flip back. Same field name and same key as
             public/js/feed-meta.js publishes on the hemp shelf, because the
             card back is one block in public/index.html reading whichever
             publisher the page has -- a second name here would leave every city
             page with a blank back and nothing to show for it. */
          var desc = {};
          (j && j.products || []).forEach(function(x){
            if (x && x.id && x.description) desc[x.id] = String(x.description);
          });
          window.LL_COLDWATER_META.desc = desc;
          /* THE THREE LABELS THE ENGINE WOULD FLATTEN, keyed by the feed's own
             product id -- which is exactly the key the engine's manual-category
             override is looked up by. See cw-catsplit. */
          var SPLIT = { Carts: 1, Disposables: 1, Drinks: 1 };
          var catById = {};
          (j && j.products || []).forEach(function(x){
            if (x && x.id && SPLIT[x.category]) catById[x.id] = x.category;
          });
          window.LL_COLDWATER_META.catById = catById;
          try { document.dispatchEvent(new CustomEvent("ll-meta")); } catch (e) {}
        }).catch(function(){});
      }catch(e){}
      return res;
    });
  }

  window.fetch = function(input, init){
    try{
      if (typeof input === "string"){
        if (isGG(input)) return Promise.resolve(EMPTY());
        if (isConcierge(input)) return Promise.resolve(OFFTOWN());
        var s = repoint(input);
        if (s) return tap(real.call(this, s, init));
      } else if (input && typeof input.url === "string"){
        if (isGG(input.url)) return Promise.resolve(EMPTY());
        if (isConcierge(input.url)) return Promise.resolve(OFFTOWN());
        var r = repoint(input.url);
        if (r) return tap(real.call(this, new Request(r, input), init));
      }
    }catch(e){ /* fall through to the untouched call */ }
    return real.apply(this, arguments);
  };
})();
</script>
`;

/* The REAL </head>, which is the line that is nothing but </head>.
   Matching on `includes` instead put this block at line 12, because the
   age-gate comment up there contains the literal string "</head>" while
   explaining that three pages lack one. The override then parsed BEFORE the
   main stylesheet and lost every token to it -- and it looked like it worked,
   because the separate #4ade80 recolour had already changed --leaf by hand.
   A cascade bug that passes one spot-check is exactly the kind this file is
   supposed to make impossible, so assert the position too. */
/* Second additive block, at the end of <body> so it runs AFTER the engine.
   The engine opens the filter panel on "Ounce+ (28g), budget $75" -- Legal-Leaf's
   whole proposition, a cheap ounce shipped to your door. On a dispensary page
   that preset hides the shop: a Michigan ounce runs $58-$170 and most counter
   traffic buys an eighth. Measured on the demo feed, the defaults rendered 1 of
   10 products. These are select/input defaults the engine assigns at init, not
   HTML attributes, so they cannot be patched in the markup -- hence a correction
   after the fact, the way ll-trim-label and ll-checkout-fix do it. */
const FRESHNESS = `<style id="cw-freshness-style">
/* WHEN THIS PRICE WAS LAST SEEN, on the card, per store.
   The site's global "Live" stamp is true of the FEED and says nothing about any
   particular shop, which is exactly the wrong granularity once the shelf spans
   more than one town: a statewide page renders a shop harvested an hour ago and
   a shop last walked three weeks ago identically, and the older one RANKS
   BETTER, because prices fall and the engine sorts on per-gram. Under a quiet
   statewide launch there is no local audience to catch that, so it has to be
   printed. */
.cw-asof{
  display:block;margin-top:6px;font-size:11.5px;line-height:1.35;
  color:var(--muted,#9fb4c2);letter-spacing:.01em;
}
.cw-asof.cw-stale{
  color:#f6c667;font-weight:600;
}
.cw-asof .cw-dot{
  display:inline-block;width:6px;height:6px;border-radius:50%;
  background:#4ade80;margin-right:5px;vertical-align:middle;
}
.cw-asof.cw-stale .cw-dot{background:#f6c667}
</style>
<script id="cw-freshness">
/* Additive, like every other block here: the engine renders the card and this
   writes one line into it afterwards. Nothing in the blob is touched.

   KEYED ON THE PRINTED TITLE, the same handle the deal chip and the shopping
   list use, because that is the only thing an additive layer has to join on --
   the engine renames what it renders (its strain parser strips a trailing
   parenthetical) and drops the feed's id before the card exists.

   REAPPLIES ON MUTATION for the reason the trim chip and the THC relabel do:
   the grid re-renders on every filter and every sort, with no hook to attach
   to. */
(function(){
  function meta(){ return (window.LL_COLDWATER_META && window.LL_COLDWATER_META.byName) || null; }

  /* Relative, because an ISO timestamp is not something a shopper converts in
     their head while standing in a car park. Days once it is past a day; the
     exact figure is the feed's and is on the element as a title attribute for
     anyone who wants it. */
  function ago(iso, ageDays){
    var d = (typeof ageDays === "number" && isFinite(ageDays)) ? ageDays : null;
    if (d === null){
      var t = Date.parse(iso || "");
      if (!isFinite(t)) return "";
      d = Math.max(0, (Date.now() - t) / 86400000);
    }
    if (d < 0.042) return "just now";
    if (d < 1){
      var h = Math.round(d * 24);
      return h <= 1 ? "1 hour ago" : h + " hours ago";
    }
    var days = Math.round(d);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  function paint(){
    var by = meta();
    if (!by) return;
    var cards = document.querySelectorAll("#grid .card");
    for (var i = 0; i < cards.length; i++){
      var c = cards[i];
      var h = c.querySelector("h3, .cname, .pname");
      var name = h ? String(h.textContent || "").trim().toLowerCase() : "";
      if (!name) continue;
      var m = by[name];
      /* NO STAMP IS THE RIGHT ANSWER FOR A LIVE ADAPTER ROW. Those are fetched
         during the request and carry no capturedAt, because they cannot be
         stale -- printing "just now" on them would be true and would also train
         the eye to ignore the line where it matters. */
      if (!m || !m.asOf) { var oldNone = c.querySelector(".cw-asof"); if (oldNone) oldNone.remove(); continue; }

      var txt = ago(m.asOf, m.ageDays);
      if (!txt) continue;
      /* PLAIN HYPHEN, NOT AN EM DASH, and the reason is the one CLAUDE.md 5a
         exists for. This block is a JS template literal in the generator, so a
         u2014 escape written here is evaluated AT GENERATION TIME and lands in
         the page as a real em dash -- which fails the non-ASCII inventory assert
         against index.html. It broke the build exactly that way. Escaping the
         backslash would also work and would be one more backslash to get wrong
         on the next edit; not needing the glyph is simpler. */
      var label = m.stale ? ("Price " + txt + " - check before you drive") : ("Price seen " + txt);

      var el = c.querySelector(".cw-asof");
      if (!el){
        el = document.createElement("span");
        el.className = "cw-asof";
        var host = c.querySelector(".ggdesc") || c.querySelector(".cbody") || c;
        host.appendChild(el);
      }
      el.className = "cw-asof" + (m.stale ? " cw-stale" : "");
      el.innerHTML = '<span class="cw-dot"></span>';
      el.appendChild(document.createTextNode(label));
      el.setAttribute("title", "Read from " + (m.priceLane || "the shop") + " at " + m.asOf);
    }
  }

  /* COALESCED, AND childList WITHOUT subtree. Both halves are load bearing and
     the first draft had neither, which is what made /coldwater unresponsive
     while the stores loaded.

     paint() MUTATES INSIDE #grid -- it appends a node to each card. Observing
     the subtree meant every one of those appends fired the observer, which
     called paint(), which appended again: a feedback loop, re-walking ~2,972
     cards on every pass until the tab stopped answering. Watching only #grid's
     direct children means the engine's re-render is still caught (it replaces
     them) while our own edits inside a card are not.

     The rAF flag is the second half: the engine's re-render lands as a burst of
     records, and one pass per frame is the most that can ever be useful. Same
     shape the THC relabel already used -- it was there to be copied and this
     block did not copy it. */
  var queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    var run = window.requestAnimationFrame || function(f){ return setTimeout(f, 16); };
    run(function(){ queued = false; paint(); });
  }
  document.addEventListener("ll-meta", schedule);
  var grid = document.getElementById("grid");
  if (grid && window.MutationObserver){
    new MutationObserver(schedule).observe(grid, { childList: true });
  }
  /* The feed may land before or after this script, so poll -- but STOP once it
     has, rather than running a full-grid pass every 250ms for ten seconds on a
     catalogue this size. */
  var tries = 0;
  var iv = setInterval(function(){
    if (meta()) { clearInterval(iv); schedule(); return; }
    if (++tries > 40) clearInterval(iv);
  }, 250);
  schedule();
})();
</script>
`;

const COLOUR = `<style id="cw-colour-style">
/* WHAT A PERSON SAW, kept visibly apart from what a machine read.
   Colour outranks every automated lane in the feed (api/coldwater-merge.js), but
   on the card it must not be dressed as catalogue data: "last two jars" is
   somebody's word, and a shopper is entitled to know which of the two they are
   reading. So it gets its own block, its own rule, and a plain-language
   attribution rather than being blended into the product text. */
.cw-colour{
  display:block;margin-top:8px;padding:8px 10px;
  border-left:2px solid var(--gold,#d4af37);
  background:rgba(212,175,55,.06);
  border-radius:0 6px 6px 0;
  font-size:12.5px;line-height:1.45;color:#dfe5ea;
}
.cw-colour .cw-cnote{display:block}
.cw-colour .cw-cmeta{
  display:block;margin-top:4px;font-size:11px;color:var(--muted,#9fb4c2);
}
.cw-colour .cw-cflag{
  display:inline-block;margin:4px 6px 0 0;padding:1px 7px;border-radius:20px;
  font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
}
.cw-colour .cw-cshelf{background:#123524;color:#6ee7a8}
.cw-colour .cw-cdeal{background:#3a2a10;color:#f6c667}
.cw-colour .cw-cpick{background:#1b2b3d;color:#8fc7f0}
</style>
<script id="cw-colour">
/* Additive, keyed on the printed title, reapplied on mutation -- the same three
   constraints every block on this page works under, and for the same reasons
   (the engine renames what it renders, and the grid re-renders on every filter
   and sort with no hook to attach to).

   NO GLYPHS. Decoration is CSS only -- the dot and the pills are border-radius,
   not characters. A backslash-u escape written anywhere in this block, INCLUDING
   IN A COMMENT, is evaluated when the generator builds the page rather than by
   the browser, so it lands as a real character and fails the non-ASCII inventory
   assert against index.html. The freshness stamp broke the build that way once,
   and the first draft of THIS comment broke it again by quoting the escape it
   was warning about. Describe them in words; never spell one out. */
(function(){
  function meta(){ return (window.LL_COLDWATER_META && window.LL_COLDWATER_META.byName) || null; }

  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function when(iso){
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = Math.max(0, (Date.now() - t) / 86400000);
    if (d < 1) return "today";
    var days = Math.round(d);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  function paint(){
    var by = meta();
    if (!by) return;
    var cards = document.querySelectorAll("#grid .card");
    for (var i = 0; i < cards.length; i++){
      var c = cards[i];
      var h = c.querySelector("h3, .cname, .pname");
      var name = h ? String(h.textContent || "").trim().toLowerCase() : "";
      var m = name ? by[name] : null;
      var col = m && m.colour;

      var old = c.querySelector(".cw-colour");
      /* A product with no observation gets nothing at all -- an empty quote box
         on every card would make the ones that DO carry a note invisible. */
      if (!col){ if (old) old.remove(); continue; }

      var flags = "";
      if (col.onShelf) flags += '<span class="cw-cflag cw-cshelf">On the shelf</span>';
      if (col.staffPick) flags += '<span class="cw-cflag cw-cpick">Staff pick</span>';
      if (col.observedDeal) flags += '<span class="cw-cflag cw-cdeal">' + esc(col.observedDeal) + '</span>';

      var seen = when(col.seenAt);
      /* THE ATTRIBUTION IS NOT DECORATION. Without it this reads as the shop's
         own copy. It is a person's word, and it is dated because a dated
         observation can be judged and an undated one has to be taken on faith. */
      var attribution = "Seen in store" + (seen ? ", " + seen : "");

      var html = "";
      if (col.note) html += '<span class="cw-cnote">' + esc(col.note) + "</span>";
      html += flags;
      html += '<span class="cw-cmeta">' + esc(attribution) + "</span>";

      var el = old;
      if (!el){
        el = document.createElement("div");
        el.className = "cw-colour";
        var host = c.querySelector(".ggdesc") || c.querySelector(".cbody") || c;
        host.appendChild(el);
      }
      el.innerHTML = html;
    }
  }

  /* COALESCED, AND childList WITHOUT subtree. Both halves are load bearing and
     the first draft had neither, which is what made /coldwater unresponsive
     while the stores loaded.

     paint() MUTATES INSIDE #grid -- it appends a node to each card. Observing
     the subtree meant every one of those appends fired the observer, which
     called paint(), which appended again: a feedback loop, re-walking ~2,972
     cards on every pass until the tab stopped answering. Watching only #grid's
     direct children means the engine's re-render is still caught (it replaces
     them) while our own edits inside a card are not.

     The rAF flag is the second half: the engine's re-render lands as a burst of
     records, and one pass per frame is the most that can ever be useful. Same
     shape the THC relabel already used -- it was there to be copied and this
     block did not copy it. */
  var queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    var run = window.requestAnimationFrame || function(f){ return setTimeout(f, 16); };
    run(function(){ queued = false; paint(); });
  }
  document.addEventListener("ll-meta", schedule);
  var grid = document.getElementById("grid");
  if (grid && window.MutationObserver){
    new MutationObserver(schedule).observe(grid, { childList: true });
  }
  var tries = 0;
  var iv = setInterval(function(){
    if (meta()) { clearInterval(iv); schedule(); return; }
    if (++tries > 40) clearInterval(iv);
  }, 250);
  schedule();
})();
</script>
`;

const COLOUR_ADMIN = `<style id="cw-colour-admin-style">
/* The operator's own layer, given a way in. Everything else the admin console
   edits is an OVERRIDE -- a correction to what a machine read. Colour is the
   opposite: it is the thing no reader can produce, and until now it existed as
   an API with no interface, which is the same as not existing. */
#cwca{position:fixed;left:14px;bottom:64px;z-index:2147483000;display:none}
#cwca.on{display:block}
#cwca .cwca-btn{
  background:var(--gold,#d4af37);color:#131313;border:0;border-radius:9px;
  padding:9px 14px;font:700 13px/1 system-ui,sans-serif;cursor:pointer;
  box-shadow:0 6px 18px rgba(0,0,0,.4)
}
#cwca-panel{
  position:fixed;left:14px;bottom:110px;width:min(360px,calc(100vw - 28px));
  background:#12171c;border:1px solid #2b323b;border-radius:12px;padding:14px;
  z-index:2147483000;display:none;font:13px/1.5 system-ui,sans-serif;color:#e6e8ea;
  box-shadow:0 14px 40px rgba(0,0,0,.5);max-height:70vh;overflow:auto
}
#cwca-panel.on{display:block}
#cwca-panel h4{margin:0 0 10px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#9fb4c2}
#cwca-panel label{display:block;margin:9px 0 3px;font-size:11.5px;color:#9fb4c2}
#cwca-panel input[type=text],#cwca-panel textarea,#cwca-panel select{
  width:100%;background:#0e1216;color:#e6e8ea;border:1px solid #2b323b;
  border-radius:7px;padding:7px 9px;font:13px system-ui,sans-serif
}
#cwca-panel textarea{height:56px;resize:vertical}
#cwca-panel .row{display:flex;gap:14px;align-items:center;margin-top:9px}
#cwca-panel .row label{margin:0;font-size:12.5px;color:#e6e8ea;display:flex;gap:6px;align-items:center}
#cwca-panel .acts{display:flex;gap:8px;margin-top:13px}
#cwca-panel button{border:0;border-radius:8px;padding:8px 13px;font:700 12.5px system-ui;cursor:pointer}
#cwca-save{background:#1f9d5a;color:#04140b;flex:1}
#cwca-del{background:#3a2226;color:#ff9b9b}
#cwca-close{background:#242b33;color:#c3c9d1}
#cwca-msg{margin-top:9px;font-size:11.5px;color:#9fb4c2;min-height:1.2em}
</style>
<script id="cw-colour-admin">
/* WRITES COLOUR, NEVER PRODUCTS. It posts only a \`colour\` array to
   /api/coldwater/ingest, so nothing here can add, remove or reprice a row -- the
   worst it can do is annotate the wrong product, which the next save corrects.

   THE TOKEN IS THE COLLECTOR'S, not a second one. The bookmarklet already keeps
   it in this origin's sessionStorage under ll_admin_token; asking for it twice
   would train the operator to paste it in more places than necessary. It is
   never written to localStorage and never leaves this origin.

   AN EMPTY SAVE IS A DELETE, matching the endpoint: the lane that outranks every
   automated source has to be correctable, or a note that stops being true is
   permanent. */
(function(){
  var TOKEN_KEY = "ll_admin_token";
  function isAdmin(){ try{ return sessionStorage.getItem("ll_admin_ok") === "1"; }catch(e){ return false; } }
  function meta(){ return (window.LL_COLDWATER_META && window.LL_COLDWATER_META.byName) || null; }

  var wrap = document.createElement("div");
  wrap.id = "cwca";
  wrap.innerHTML = '<button class="cwca-btn" id="cwca-open">Shelf note</button>';
  document.body.appendChild(wrap);

  var panel = document.createElement("div");
  panel.id = "cwca-panel";
  panel.innerHTML =
    '<h4>Shelf note</h4>' +
    '<label for="cwca-prod">Product (exactly as printed on the card)</label>' +
    '<input type="text" id="cwca-prod" list="cwca-names" placeholder="Blue Dream">' +
    '<datalist id="cwca-names"></datalist>' +
    '<label for="cwca-note">Note</label>' +
    '<textarea id="cwca-note" placeholder="last two jars on the shelf"></textarea>' +
    '<label for="cwca-deal">Deal seen in store</label>' +
    '<input type="text" id="cwca-deal" placeholder="B2G1 at the counter">' +
    '<div class="row">' +
      '<label><input type="checkbox" id="cwca-shelf"> On the shelf</label>' +
      '<label><input type="checkbox" id="cwca-pick"> Staff pick</label>' +
    '</div>' +
    '<label for="cwca-token">Admin token</label>' +
    '<input type="text" id="cwca-token" placeholder="paste once per tab">' +
    '<div class="acts">' +
      '<button id="cwca-save">Save note</button>' +
      '<button id="cwca-del">Clear</button>' +
      '<button id="cwca-close">Close</button>' +
    '</div>' +
    '<div id="cwca-msg"></div>';
  document.body.appendChild(panel);

  var $ = function(id){ return document.getElementById(id); };
  function msg(t, bad){ var m = $("cwca-msg"); m.textContent = t; m.style.color = bad ? "#ff9b9b" : "#9fb4c2"; }

  /* Only visible in admin mode, and re-checked rather than assumed: the gate is
     in sessionStorage and the page can be open when it is set. */
  function sync(){ wrap.className = isAdmin() ? "on" : ""; if(!isAdmin()) panel.className = ""; }
  sync();
  setInterval(sync, 1500);

  /* The card's printed title is the handle, the same one the deal chip and the
     shopping list use -- the engine renames what it renders, so the feed's id is
     not something an operator can see. */
  function fillNames(){
    var by = meta(); if (!by) return;
    var dl = $("cwca-names"); if (!dl || dl.childElementCount) return;
    var names = Object.keys(by).slice(0, 400);
    var html = "";
    for (var i=0;i<names.length;i++) html += '<option value="' + names[i].replace(/"/g,"&quot;") + '">';
    dl.innerHTML = html;
  }
  document.addEventListener("ll-meta", fillNames);
  setTimeout(fillNames, 1200);

  $("cwca-open").onclick = function(){
    panel.className = panel.className ? "" : "on";
    if (panel.className) {
      try{ $("cwca-token").value = sessionStorage.getItem(TOKEN_KEY) || ""; }catch(e){}
      fillNames(); msg("");
    }
  };
  $("cwca-close").onclick = function(){ panel.className = ""; };

  function send(clear){
    var name = ($("cwca-prod").value || "").trim();
    if (!name) { msg("Name the product first.", true); return; }
    var token = ($("cwca-token").value || "").trim();
    if (!token) { msg("Admin token required.", true); return; }
    try{ sessionStorage.setItem(TOKEN_KEY, token); }catch(e){}

    /* The card's printed title may carry the brand, and rowKey joins on brand +
       name -- so the whole printed string goes in as the name and the brand is
       left blank. Wrong-but-consistent beats clever: the same string is what the
       merge will look the row up by. */
    var obs = { name: name };
    if (!clear) {
      var note = ($("cwca-note").value || "").trim();
      var deal = ($("cwca-deal").value || "").trim();
      if (note) obs.note = note;
      if (deal) obs.observedDeal = deal;
      if ($("cwca-shelf").checked) obs.onShelf = true;
      if ($("cwca-pick").checked) obs.staffPick = true;
      if (!note && !deal && !obs.onShelf && !obs.staffPick) {
        msg("Nothing to save. Use Clear to remove a note.", true); return;
      }
    }

    msg(clear ? "Clearing..." : "Saving...");
    /* THE MARKET IS STAMPED IN AT BUILD TIME, and it was the pilot's name typed
       as a literal. Colour is the lane that outranks every other and is never
       overwritten by an automated one (api/coldwater-merge.js), so an
       observation written on a second city's page did not merely land in the
       wrong namespace -- it attached PERMANENTLY to a Coldwater card, where
       nothing downstream would ever correct it. The endpoint is the canonical
       market-neutral name too; /api/coldwater/ingest still works and is kept
       forever as an alias, but a generated page should not be the thing keeping
       a town's name in a route. */
    fetch("/api/market/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-ll-admin-token": token },
      body: JSON.stringify({ storeKey: (meta() && meta()[name.toLowerCase()] || {}).storeKey || "", market: "${MK.slug}", colour: [obs] })
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(o){
        if (!o.ok) { msg((o.j && o.j.error) || "Refused.", true); return; }
        msg(clear ? "Cleared. Reload to see the card update." : "Saved. Reload to see it on the card.");
        if (!clear) { $("cwca-note").value = ""; $("cwca-deal").value = ""; }
      })
      .catch(function(e){ msg(String(e && e.message || e), true); });
  }
  $("cwca-save").onclick = function(){ send(false); };
  $("cwca-del").onclick = function(){ send(true); };
})();
</script>
`;

const FEED = `<style id="cw-feed-style">
/* THE LOAD-MORE BAR IS A GRID CELL, and that is the whole "ragged last row".
   The engine appends it into #grid alongside the cards, so on a four-column
   layout twelve cards fill three rows and the bar sits alone in a fourth --
   reported as "two rows of four and a third row of one ... it looks really
   shitty". Spanning it fixes the shape without touching the blob, and it reads
   better anyway: a full-width bar is a control, a lonely square is a broken
   card. */
#grid .loadmore{grid-column:1 / -1;display:flex;align-items:center;justify-content:center;
  min-height:52px;border-radius:12px;cursor:pointer;
  border:1px dashed var(--glass-line,rgba(78,201,255,.28));
  background:rgba(78,201,255,.05);color:var(--accent,#4ec9ff);
  font:700 13px/1 inherit;letter-spacing:.02em}
#grid .loadmore:hover{background:rgba(78,201,255,.10)}
/* A card the row-trimmer is holding back. Hidden rather than removed, because
   the engine owns these nodes and re-renders from its own list. */
#grid .card.cw-partial{display:none}
/* FOUR ACROSS, so "rows of four" is a fact rather than whatever the viewport
   happened to give. The engine's own auto-fill grid drew five, three or an
   awkward four-and-a-bit depending on width, which is why a page of forty still
   did not land on a clean row. Stepped down at real breakpoints rather than
   forced everywhere: four 300px cards do not fit a phone. */
@media(min-width:1080px){#grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}}
@media(min-width:760px) and (max-width:1079px){#grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
@media(min-width:520px) and (max-width:759px){#grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
</style>

<script id="cw-feed">
/* THE SHELF SHOULD LOOK LIKE A SHELF.
   Three complaints, one block, and they are not the same problem.

   1. NINE PRODUCTS IS NOT A SHOP. The engine opens on PAGE = 12 and that
      constant lives inside the blob (CLAUDE.md section 5), so it cannot be
      changed here. What CAN be done is what a shopper does: press Load more.
      The bar is a real DOM node with the engine's own handler on it, so
      clicking it is the engine's own paging, not a reimplementation of it --
      which matters, because "shown" is a closure variable and anything that
      tried to set it directly would be guessing.

   2. ALWAYS FULL ROWS. Two causes. The bar itself was a grid cell (see the
      style above), and the last row of CARDS is only full by luck: the engine
      pages in twelves, which divides by 1, 2, 3, 4 and 6, so a full page is
      always a full row -- but a FILTERED set of, say, 26 leaves two cards
      stranded. Where more products exist, the stragglers are held back to the
      row boundary rather than shown as a gap-toothed row. Where there are no
      more, they are shown, because hiding real products to make a rectangle
      would be choosing tidiness over the catalogue.

   3. IT SHOULD READ AS A FEED. The engine's default sort is "featured", which
      clusters by store and by collection -- so the top of the shelf is a wall
      of one shop. A walk-in shopper is not browsing a shop, they are browsing a
      town. So the opening view is INTERLEAVED: round-robin across shops, and
      within each shop the strongest card first, where strong means it has a
      photograph, a price per gram, and a good one. Only ever the opening view:
      the moment somebody sorts, searches or filters, they have asked a specific
      question and the answer is the engine's own order, untouched.

   NOTHING HERE CHANGES WHICH PRODUCTS ARE ON THE SHELF -- only how many are
   drawn at once and in what order. The counts, the facets and the filters are
   all still the engine's. */
(function(){
  var FLOOR = 40;            /* "at least forty to start" */
  var MAX_CLICKS = 8;        /* 12 a click: a hard stop, so a feed that never
                                satisfies the floor cannot spin forever. */
  var busy = false, lastSig = "";

  function grid(){ return document.getElementById("grid"); }
  function cards(g){ return g ? g.querySelectorAll(".card") : []; }

  /* Read the real column count off the rendered grid rather than guessing from
     a breakpoint: this page has two rails above it and the shell width is a
     token, so a hardcoded 4 would be wrong on half the widths it ships to. */
  function cols(g){
    try {
      var t = window.getComputedStyle(g).gridTemplateColumns;
      var n = t && t !== "none" ? t.trim().split(/\\s+/).length : 0;
      return n > 0 ? n : 1;
    } catch (e) { return 1; }
  }

  /* ---- 1. open on a full shelf ------------------------------------------ */
  function topUp(){
    var g = grid(); if (!g) return;
    var bar = g.querySelector(".loadmore");
    if (!bar) return;                                  /* everything is shown */
    if (cards(g).length >= FLOOR) return;
    /* The engine's own handler, so paging stays the engine's. */
    for (var i = 0; i < MAX_CLICKS && cards(g).length < FLOOR; i++) {
      var b = g.querySelector(".loadmore");
      if (!b) break;
      b.click();
    }
  }

  /* ---- 2. no gap-toothed last row --------------------------------------- */
  function trimToRows(){
    var g = grid(); if (!g) return;
    var list = cards(g);
    for (var i = 0; i < list.length; i++) list[i].classList.remove("cw-partial");
    /* With nothing more to load, a short row is the catalogue rather than a
       layout fault, and hiding real products to square it off would be worse
       than the gap. */
    if (!g.querySelector(".loadmore")) return;
    var c = cols(g);
    if (c < 2) return;
    var over = list.length % c;
    for (var j = 0; j < over; j++) list[list.length - 1 - j].classList.add("cw-partial");
  }

  /* ---- 3. a town, not a shop -------------------------------------------- */
  /* "UNTOUCHED" IS A FACT ABOUT THE SHOPPER, NOT ABOUT THE CONTROLS.
     Two attempts read it off the controls and both were wrong in production.
     Testing for an EMPTY value failed because #fSort ships set to "pergram".
     Learning each control's opening value failed for a subtler reason: this
     block runs as soon as the grid exists, the engine fills its selects and
     then SETS their values a tick later, so the "default" captured was often
     the empty string and every later render looked filtered. Both times the
     rotation stood down on every page load and the shelf opened on a wall of
     one shop -- reported as "it is interweaved across shops, that's not true,
     I see just Banzen by default".
     A trusted event is the actual question being asked. Nothing but a real
     human gesture sets this, so there is no timing to get wrong: the shelf is
     the opening shelf until somebody touches a control. */
  /* THE OPENING SHELF IS DEALT OUT, NOT LISTED, and that code now lives in
     public/js/shelf-shuffle.js -- inherited from index.html like the rails and
     the photo viewer, so the hemp shelf, the three generated shelves and every
     city page get one implementation. It also gained a second axis there: no shop twice
     in a row AND no category twice in a row where there is a choice.
     What stays here is the SEQUENCING, which is this block's job: the shelf has
     to be topped up before it is dealt, and trimmed after. */
  function paint(){
    if (busy) return;
    busy = true;
    /* THE SHUFFLE MOVED TO public/js/shelf-shuffle.js and is called rather than
       carried, because index.html loads it and every city page inherits it --
       the same move the three rails and the photo viewer made. It stays inside
       this paint cycle rather than running its own observer, because the order
       matters: top the shelf up, THEN deal it out, THEN trim the short last
       row. Two observers reordering one grid is a fight that shows up as cards
       twitching rather than as an error, which is why the shared file arms its
       own driver only where this block is absent. */
    try { topUp(); if (window.LL_shuffle) window.LL_shuffle(grid()); trimToRows(); }
    finally { busy = false; }
  }

  var queued = false;
  function schedule(){
    if (queued || busy) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; paint(); });
  }

  var g0 = grid();
  if (g0 && window.MutationObserver) new MutationObserver(schedule).observe(g0, { childList: true });
  /* The engine re-renders on every control, and a filter that reduces the shelf
     needs the row trim recomputed even when the card count did not change. */
  document.addEventListener("change", schedule, true);
  document.addEventListener("input", schedule, true);
  window.addEventListener("resize", function(){ lastSig = ""; schedule(); }, { passive: true });
  document.addEventListener("ll-meta", function(){ lastSig = ""; schedule(); });
  schedule();
})();
</script>

`
const CATSPLIT = `<script id="cw-catsplit">
/* CARTS, DISPOSABLES AND CONCENTRATES, ON THE PAGE.
 *
 * The feed already classifies these as three things. The engine then throws that
 * away, and it is not a bug -- it is a deliberate rule with its reason written
 * beside it:
 *
 *     VAPE: carts/disposables are a SUB-category of Concentrate. Guarantee the
 *     Concentrate bucket here so a cheap cart never slips to flower.
 *
 * That rule is right for the hemp shelf, where a mis-filed cart could land among
 * the ounces and undercut them on price per gram. It is wrong here, where a cart
 * needs a battery, a disposable needs nothing, a concentrate needs a rig, and
 * choosing between the three IS the shopping.
 *
 * THE ENGINE ALREADY HAS THE LEVER, so nothing is patched and the blob is not
 * touched (CLAUDE.md section 5). Its normCategory consults a MANUAL category
 * override before any of its own rules and returns it unconditionally --
 * intended for the admin console, and a category assertion is exactly what this
 * is. The map is keyed on the feed's own product id, which is the same id the
 * feed publishes, so the join is exact rather than by printed title.
 *
 * MUTATED, NOT REPLACED. window.LL_MANUAL_CAT and the engine's closure variable
 * are the same object; assigning a new one would leave the engine reading the
 * old.
 *
 * THE ENTRIES CARRY NO name FIELD, DELIBERATELY. The engine's lookup falls back
 * to matching any entry's own name against the product's when the id misses, so an
 * entry with a name would be applied to a same-named product at another shop.
 * Without one, only the exact id matches, which is the only claim being made.
 *
 * AND THEY ARE MARKED SO AN OPERATOR CANNOT PUBLISH THEM. These are derived from
 * the feed on every load, not decisions anybody made, and the admin console can
 * push its override batch to /api/overrides -- which would freeze one afternoon's
 * classification into shared storage and outlive the rule that produced it.
 * exportBatch is wrapped to drop them. */
(function(){
  var MARK = "cwSplit";
  var applied = false;

  function meta(){
    try { return (window.LL_COLDWATER_META && window.LL_COLDWATER_META.catById) || null; }
    catch (e) { return null; }
  }

  function apply(){
    if (applied) return;
    var by = meta();
    if (!by) return;
    var map = window.LL_MANUAL_CAT;
    if (!map || typeof map !== "object") return;
    if (!window.LL_admin || typeof window.LL_admin.reprocess !== "function") return;

    var n = 0;
    for (var id in by) {
      if (!Object.prototype.hasOwnProperty.call(by, id)) continue;
      /* A real manual decision outranks this: somebody looked at the product. */
      if (Object.prototype.hasOwnProperty.call(map, id)) continue;
      map[id] = { cat: by[id], t: 0, cwSplit: true };
      n++;
    }
    if (!n) return;
    applied = true;
    guardExport();
    /* Re-runs the engine's own ingest over the raw feed: normCategory sees the
       overrides, the facets are rebuilt from the result, and the grid redraws.
       Nothing here re-implements any of that. */
    try { window.LL_admin.reprocess(); } catch (e) { applied = false; }
    dropVapeFacet();
  }

  /* The console can push its batch to shared storage. These are not decisions
     and must not travel. */
  function guardExport(){
    var A = window.LL_admin;
    if (!A || typeof A.exportBatch !== "function" || A.exportBatch.__cwGuarded) return;
    var orig = A.exportBatch.bind(A);
    var wrapped = function(){
      var b = orig.apply(null, arguments);
      try {
        if (b && b.cat) {
          var out = {};
          for (var k in b.cat) {
            if (!Object.prototype.hasOwnProperty.call(b.cat, k)) continue;
            if (b.cat[k] && b.cat[k][MARK]) continue;
            out[k] = b.cat[k];
          }
          b.cat = out;
        }
      } catch (e) {}
      return b;
    };
    wrapped.__cwGuarded = true;
    A.exportBatch = wrapped;
  }

  /* THE VIRTUAL "VAPE" FACET GOES, because Carts and Disposables now say the
     same thing better.
     It is not a category -- it is one of the engine's SUB-TAGS, a cross-cutting
     label that overlays the base category and surfaces as an extra option in
     #fCategory ("Vape is a virtual sub-category of Concentrate"). On the hemp
     shelf it is the only way to narrow to vape-shaped products at all, which is
     why it exists. Here it is a third answer to a question that now has two
     better ones, sitting between them in the same dropdown and the same rail.
     REMOVED FROM THE FACET, NOT FROM THE ENGINE. The sub-tag itself still works
     and still tags products; what goes is the redundant CHOICE. And if it was
     the current selection when it disappears the grid would be filtered by a
     control the shopper can no longer see, so that is cleared first. */
  function dropVapeFacet(){
    var sel = document.getElementById("fCategory");
    if (!sel) return;
    var opt = sel.querySelector('option[value="Vape"]');
    if (!opt) return;
    if (sel.value === "Vape") {
      sel.value = "";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    opt.remove();
  }
  /* The engine rewrites its options on every reprocess and every facet rebuild,
     so this is reapplied rather than run once -- same reason the rails observe. */
  (function(){
    var sel = document.getElementById("fCategory");
    if (sel && window.MutationObserver) {
      new MutationObserver(function(){ dropVapeFacet(); })
        .observe(sel, { childList: true, subtree: true });
    }
    dropVapeFacet();
    document.addEventListener("ll-meta", dropVapeFacet);
  })();

  /* The feed and the engine arrive independently, so this waits for both rather
     than assuming an order. Bounded: a page where either never turns up simply
     keeps the engine's own classification, which is what it did before. */
  var tries = 0;
  var iv = setInterval(function(){ apply(); if (applied || ++tries > 80) clearInterval(iv); }, 250);
  document.addEventListener("ll-meta", apply);
  apply();
})();
</script>

`
const ESCAPE = `<script id="cw-escape">
/* ESCAPE GETS YOU OUT OF ANYTHING.
   Audited across this page: the ONLY thing that closed on Escape was the photo
   viewer, which is additive and wired its own. The engine binds Escape to
   exactly one control -- the strain search dropdown -- so the cart drawer, the
   watchlist drawer, the lab modal, the COA modal, the how-it-works modal, the
   sign-in modal and the colour editor all trapped a keyboard user and made a
   phone user hunt for an x. Reported against the list, which is where it is
   most obvious, and true of every overlay on the page.

   IT CLOSES THINGS THE WAY A PERSON WOULD, rather than by hiding them. The
   engine's own close paths do real work -- closeAll() clears several elements at
   once, the drawer restores the page's scroll -- so this presses the control
   that is already there: the overlay's own close button, or failing that its
   backdrop, and only as a last resort takes the "open" class off. Hiding an
   overlay whose backdrop is a separate element is how you get a page that looks
   closed and cannot be clicked.

   TOPMOST FIRST, because these stack: a COA opened from a card sits over the
   drawer that opened the card, and one Escape should peel one layer. Ordered by
   computed z-index, ties broken by document order, which is what the browser
   paints by anyway.

   The photo viewer is deliberately NOT in the list. It binds its own handler in
   cw-photo-zoom and sits above everything; two handlers on one key is how you
   get an overlay that closes the thing behind it as well. */
(function(){
  var SEL = [
    "#cwca-panel",                                        /* colour editor */
    "#llAdmin",                                           /* admin console */
    "#strainModal", "#coaModal", "#howModal",             /* .modal-ov, engine */
    "#authModal", "#authOv",
    "#ggCoModal", "#ggCoOverlay", "#hpCoModal", "#hpCoOverlay",
    "#cartDrawer", "#watchDrawer"
  ].join(",");

  function shown(el){
    if (!el || !el.getBoundingClientRect) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    /* A drawer parked off-screen is styled as visible and translated away, which
       is how these are animated -- so position is part of "is it open". */
    if (r.width < 2 || r.height < 2) return false;
    return r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
  }

  function topmost(){
    var open = [];
    var all = document.querySelectorAll(SEL);
    for (var i = 0; i < all.length; i++) if (shown(all[i])) open.push(all[i]);
    if (!open.length) return null;
    open.sort(function(a, b){
      var za = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
      var zb = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
      if (za !== zb) return za - zb;
      return (a.compareDocumentPosition(b) & 4) ? -1 : 1;
    });
    return open[open.length - 1];
  }

  function press(el){
    var b = el.querySelector('[data-close],.modal-x,.drawer-x,.cwca-x,#cwca-close,[aria-label*="lose"],[aria-label*="Close"]');
    if (b && typeof b.click === "function") { b.click(); return true; }
    return false;
  }

  function close(el){
    if (press(el)) return true;
    /* The drawers share one backdrop and the engine's own handler on it calls
       closeAll(), which clears more than the drawer -- so the backdrop is a
       better lever than the drawer itself. */
    var back = document.getElementById("overlay");
    if (back && shown(back) && (el.id === "cartDrawer" || el.id === "watchDrawer")) { back.click(); return true; }
    var had = el.classList.contains("open") || el.classList.contains("on");
    el.classList.remove("open"); el.classList.remove("on");
    if (back && back.classList) back.classList.remove("open");
    return had;
  }

  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape" && e.key !== "Esc") return;
    /* A typed Escape inside a field belongs to the field -- the engine's own
       strain box clears itself with it, and stealing that would be a regression
       dressed as a fix. */
    var t = e.target;
    if (t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) {
      var host = t.closest ? t.closest(SEL) : null;
      if (!host) return;
    }
    var el = topmost();
    if (!el) return;
    if (close(el)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
</script>

`
const TAIL = `<style id="cw-no-hemp-nav">
/* THE HEMP CATALOGUE'S NAV HAS NO BUSINESS HERE. /consumables, /devices,
   /international and /wholesale are pages of the national mail-order hemp shelf
   behind /api/products. On a city page they are pills that take a walk-in
   shopper standing on Willowbrook Road to a completely different market -- the
   same reasoning that turns the concierge off here, and worse in one way,
   because a link needs no model to mislead: it just goes.

   /wholesale WAS MISSED FOR A WHILE, and it is the worst of the four to miss.
   It reads /api/products the same as the others, but it also offers something a
   Michigan shopper cannot lawfully act on: bulk hemp by the pound. Wholesale in
   this state is a licensee-only, Metrc-tracked transaction between businesses,
   so a "Wholesale" pill on a Detroit dispensary page is not merely the wrong
   catalogue -- it is an invitation whose only honest answer is that this is not
   what that word means here.

   /library AND /reels DELIBERATELY STAY. The rule is not "hide the hemp site's
   nav", it is "do not send a shopper to another market's CATALOGUE". The
   Library is long-form writing about the plant, its history and how it works in
   the body, and Reels is the family's own video -- neither offers anything for
   sale to anybody, so both read the same standing in Detroit as in Coldwater.
   Hiding them would cost the city page the only two pages on this site that are
   about cannabis rather than about a shelf.

   HIDDEN IN CSS AND THEN REMOVED FROM THE DOM, both, for the reason the
   concierge gets two stops. The CSS lands with the stylesheet so the pills
   never flash before the script runs; the removal is what makes "taken off"
   true rather than "not shown" -- otherwise they stay tabbable, they stay in
   the accessibility tree, and they stay a link a crawler can follow off this
   page into the wrong catalogue. The anchors are not deleted from the source
   because they arrive inside index.html's own markup, and cutting lines that
   carry SVG would change this file's non-ASCII inventory -- the one thing the
   generator refuses to let happen (CLAUDE.md 5a). */
#pageConsumables,#pageDevices,#pageInternational,#pageWholesale{display:none!important}
</style>
<script id="cw-no-hemp-nav-js">
(function(){
  var IDS = ["pageConsumables", "pageDevices", "pageInternational", "pageWholesale"];
  function strip(){
    for (var i = 0; i < IDS.length; i++) {
      var el = document.getElementById(IDS[i]);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
  strip();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", strip);
  /* The nav is static markup rather than something the engine rebuilds, so one
     late pass is enough insurance without an observer running forever. */
  setTimeout(strip, 1200);
})();
</script>
<style id="cw-trim-chip-cw">
/* THE TRIM CHIP, IN THIS PAGE'S OWN COLOUR, AND OUT OF THE PHOTO'S WAY.
   index.html paints it #a3261a, a warning red that belongs to the hemp shelf's
   palette. On the cold-blue Coldwater ground it reads as an error state rather
   than as a label, so it takes the page's own accent -- the same swap the nav
   glyphs get.

   AND IT ONLY SHOWS WHEN THE CARD IS BEING LOOKED AT. It sits over the picture,
   and the picture is most of what a shopper has to judge flower with -- which is
   the whole reason the photo now opens full screen. A permanent chip covering
   part of it trades one thing people need for another. Hover, focus-within and
   touch (:active) all count as looking; on a phone, where there is no hover,
   the chip is visible for the tap that opens the card and then gone.

   IT IS NOT DELETED, and that distinction is the point: hiding an offcut label
   outright would sell shake as flower, which is exactly what the banner exists
   to prevent. It is still in the DOM, still read out, still there the moment
   the card is engaged -- and the grid chip and the card banner still agree. */
.ll-trim-tag{
  background:rgba(78,201,255,.16)!important;
  border:1px solid rgba(78,201,255,.55)!important;
  color:#bfe8ff!important;
  opacity:0;transition:opacity .16s ease;pointer-events:none}
.card:hover .ll-trim-tag,
.card:focus-within .ll-trim-tag,
.card:active .ll-trim-tag{opacity:1}
/* Nothing hovers on a touch screen, so a device that cannot hover keeps the
   label up rather than hiding it from everyone who is not using a mouse. */
@media(hover:none){.ll-trim-tag{opacity:1}}
</style>
<!-- THE PHOTO VIEWER MOVED TO public/js/photo-view.js AND
     public/css/photo-view.css. The expand control and the full-screen viewer
     were four blocks here and nothing in any of them was city-specific, so they
     now live in public/index.html -- the file this generator READS -- and every
     city page inherits them the way it inherits the engine and the rails.
     They move TOGETHER because they are one feature: a .cw-expand button on a
     page with no viewer behind it is a control that does nothing. -->

<style id="cw-list-button-style">
/* ONE COLOUR FOR ONE ACTION. The engine paints an accessory card's add button
   green and every other card's blue, which on this page put two colours and two
   wordings on the same button in the same grid. The distinction it encodes --
   gear versus consumable -- is not one a shopper acts on differently here:
   every card adds to the same shopping list. */
.card .addbtn{background:var(--leaf)!important;color:#06202b!important;
  border-color:var(--leaf)!important}
.card .addbtn:hover{filter:brightness(1.08)}
</style>
<style id="cw-banner-style">
  #cw-banner{
    max-width:var(--shell,min(1500px,94vw));margin:14px auto 0;padding:13px 17px;
    border:1px solid var(--gold,#f0b93c);border-left-width:4px;border-radius:10px;
    background:rgba(240,185,60,.09);color:var(--text,#eaf2f6);
    font-family:var(--sans,system-ui);font-size:14.5px;line-height:1.5;
  }
  #cw-banner b{color:var(--gold,#f0b93c)}
  #cw-banner span{color:var(--muted,#9fb4c2)}
</style>
<script id="cw-banner">
/* SAY WHAT THE GRID IS SHOWING.
   /api/coldwater sets meta.demo when no dispensary is connected and it has
   fallen back to placeholder rows. Nothing surfaced that, so a page of eight
   sample products was indistinguishable from a page of real ones -- and the
   engine's own stamp reads "Live <date>" either way, which makes it worse than
   silent, it makes it wrong.
   That ambiguity cost a round of debugging on its own: eight placeholder cards
   were read as the engine being stuck on its baked seed. So the page now states
   which it is, in the one place nobody can miss. */
(function(){
  function show(html){
    if (document.getElementById("cw-banner-el")) return;
    var el = document.createElement("div");
    el.id = "cw-banner-el";
    el.setAttribute("role","status");
    el.innerHTML = html;
    var grid = document.querySelector(".grid-wrap") || document.querySelector("#grid");
    if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid);
    else document.body.appendChild(el);
    el.id = "cw-banner";
  }
  /* IT ASKS ABOUT THIS TOWN, and it used to ask about the pilot's.
     This literal is already an /api/ path, so the fetch shim above -- which
     repoints /api/products -- never sees it, and it carried no ?town= at all.
     On a second city that is the worst failure this page can have: the grid
     shows placeholder products under a real city's name while the banner reads
     the PILOT's meta.demo, sees a connected shop, and stays silent. Sample
     prices, a real place name, no warning. The town is stamped in at build time
     for the same reason the shim's is. */
  fetch("/api/market?town=${MK.slug}", { headers: { accept: "application/json" } })
    .then(function(r){ return r.json(); })
    .then(function(j){
      var m = (j && j.meta) || {};
      if (m.demo){
        show('<b>Sample catalogue.</b> No ${MK.label} dispensary is connected to this page yet, '
           + 'so these are placeholder products under placeholder shop names &mdash; '
           + '<span>not any real shop\\'s prices.</span> The price-per-gram maths is real; the inventory is not.');
      }
    })
    .catch(function(){ /* the grid still speaks for itself */ });
})();
</script>
<!-- THE OUNCE AND THE BUDGET USED TO BE CLEARED HERE, and they are not any
     more because there is nothing left to clear. public/index.html opened the
     shelf on Ounce+ and a $75 budget, which is a mail-order default and wrong
     for somebody standing in a shop, so this block waited for the grid and
     corrected them. That source now opens on a fresh clear-all state for every
     surface -- "too many products are being hidden" was reported on the hemp
     shelf too -- so a copy here would be a second statement of one rule, and
     the only way the two could ever differ is a change to index.html that this
     silently overrode. test-shelf-defaults.mjs asserts a city page still lands
     with no quantity floor and no budget, which is the proof it is inherited
     rather than restated. -->
<!-- THE THREE RAILS MOVED TO public/js/rails.js AND public/css/rails.css.
     Shop by store, shop by category, shop by brand and the carousel handler
     under them were 65KB of injection here, and every byte of it was
     city-agnostic -- measured, not assumed: zero template interpolations across
     all five blocks, and three references to one feed-shaped global. They now
     live in public/index.html, which is the file this generator READS, so every
     city page inherits them the way it inherits the engine.
     DO NOT REINTRODUCE A COPY HERE. Two copies of a rail is the failure this
     repo keeps paying for -- rscRoots and its collector twin, capKey and
     captureKeyer, the collector keyOf() that never got captureKeyer's ambiguity
     rule -- and a rail is a good candidate for it, because a maker split across
     two spellings does not error, it quietly becomes two chips.
     WHAT STAYS HERE IS THE DATA. cw-endpoint publishes LL_COLDWATER_META with
     domains, brands and catPool off /api/coldwater; rails.js reads whichever
     publisher a page has through window.LL_railsMeta(). -->
<script id="cw-thc-label">
/* SAY "THC", NOT "THCa", ON A DISPENSARY PAGE.
   Chemically the flower in a Michigan jar IS mostly THCa before it is heated,
   and on the hemp site that distinction is the entire product -- "THCa flower"
   is what is being sold and what the law turns on. Here it is jargon. A shopper
   walking into a Coldwater shop reads a label that says THC, compares numbers
   that say THC, and "THCa" reads either as a different drug or as a mistake.
   Same molecule, different audience.

   THE FEED STILL SAYS THCa AND MUST. The engine's cannabinoid filter accepts
   exactly THCa, CBD and Botanical -- any other value drops the product out of
   the filter AND out of the per-gram display path (see the note beside
   cannabinoid: "THCa" in api/coldwater.js). So this relabels what is PRINTED
   and never what is stored: option .value is untouched, only its text, which is
   why filtering keeps working while the page reads like a dispensary.

   Text nodes only, so no attribute, value or class can be caught by it. Runs on
   mutation because the grid re-renders on every filter and sort with no hook to
   attach to -- the same reason the trim chip on the hemp site works this way. */
(function(){
  /* TWO RULES, AND THE ORDER MATTERS. The engine labels its flower category
     "THCA Flower". The general rule alone would make that "THC Flower" -- an
     improvement, still not what anyone calls it. On a rec menu the category is
     simply Flower; the cannabinoid is a separate filter and says THC there.
     Case-insensitive, since a shop writing "THCA" means the same thing. */
  var RULES = [
    [/THCa\\s+Flower\\b/gi, "Flower"],
    [/THCa\\b/gi, "THC"]
  ];
  var SKIP = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1 };

  function relabel(root){
    if (!root) return;
    /* Option text is a child text node, so the walker covers the filter too. */
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){
        if (!n.nodeValue || !/THCa/i.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (n.parentNode && SKIP[n.parentNode.nodeName]) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var hits = [], n;
    while ((n = w.nextNode())) hits.push(n);
    for (var i = 0; i < hits.length; i++) {
      var v = hits[i].nodeValue;
      for (var r = 0; r < RULES.length; r++) v = v.replace(RULES[r][0], RULES[r][1]);
      hits[i].nodeValue = v;
    }
  }

  relabel(document.body);
  var queued = false;
  new MutationObserver(function(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; relabel(document.body); });
  }).observe(document.body, { childList:true, subtree:true, characterData:true });
})();
</script>
<script id="cw-gear-card">
/* NOTHING HERE SHIPS, INCLUDING THE GEAR.
   api/coldwater.js publishes a bottle of glass cleaner, a battery or a t-shirt
   with cannabinoid "Accessory", which is the one switch the engine already
   honours: its accessory-card branch draws no price per gram, no size dropdown
   and no strain. That is exactly right for a thing that is not sold by weight of
   cannabis -- and it is the ONLY way to get there, because the engine re-derives
   grams from the row label for any row that has none, so "4 oz" on a cleaner
   comes back as 28 g however carefully the feed nulls its per-gram.

   The branch is written for Greek Glass, a mail-order glass shop, so it prints
   two things that are false in Coldwater: an "out the door (incl. est. ship)"
   line, and "Ships from <shop>". These shops sell at a counter. Same treatment
   as the THCa relabel above -- what is PRINTED is corrected, nothing stored is
   touched -- and for the same reason: the branch is inside the base64 engine
   (CLAUDE.md section 5) and is not edited.

   Cards only, by class, so the phrase cannot be caught anywhere else on the
   page. Reapplied on mutation because the grid re-renders on every filter and
   sort with no hook to attach to. */
(function(){
  /* EVERY CARD SAYS THE SAME THING, and it did not: gear cards were relabelled
     to "Add to list" with a green button while everything else kept the
     engine's blue "Add to Legal-Leaf Cart" and "Checkout at <shop>". Two
     wordings and two colours for one action, side by side in the same grid.

     The blue ones were the wrong half. THERE IS NO CHECKOUT HERE -- these are
     dispensary menus, cw-no-vendor-checkout already disarms the vendor cart and
     sends the button to the shopping list, so "Checkout at Banzen" promises
     something the page cannot do. The label is corrected for every card rather
     than for the ones that happened to be classified as gear.

     Only the wording and the colour. The button still does what
     cw-no-vendor-checkout made it do. */
  function relabel(){
    var btns = document.querySelectorAll(".card .addbtn");
    for (var b = 0; b < btns.length; b++) {
      var t = btns[b].textContent || "";
      /* Matches the engine's own wording and the earlier gear relabel, so a
         card that has already been through this is left alone. */
      if (/add to (cart|legal-leaf cart|list)\\b/i.test(t) && !/shopping list/i.test(t)) {
        btns[b].textContent = t.replace(/add to (?:legal-leaf cart|cart|list)/i, "Add to Shopping List");
      }
    }
    var foots = document.querySelectorAll(".card .coa");
    for (var f = 0; f < foots.length; f++) {
      var ft = foots[f].textContent || "";
      if (/checkout at|ships?\s+from/i.test(ft)) {
        foots[f].textContent = ft.replace(/checkout at|ships?\s+from/i, "At the counter,");
      }
    }
  }

  function fix(){
    relabel();
    var cards = document.querySelectorAll(".card.gg");
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.getAttribute("data-cw-gear") === "1") continue;
      c.setAttribute("data-cw-gear", "1");
      /* The shipping estimate is not wrong here so much as meaningless: there is
         no delivery to estimate, and "$0.00" reads as a promise of free shipping.
         Removed rather than rewritten. */
      var otd = c.querySelector(".otd");
      if (otd) otd.remove();
      var foot = c.querySelector(".coa");
      if (foot && /ships?\\s+from/i.test(foot.textContent || "")) {
        foot.textContent = foot.textContent.replace(/ships?\\s+from/i, "At the counter,");
      }
    }
  }
  fix();
  var queued = false;
  try {
    new MutationObserver(function(){
      if (queued) return;
      queued = true;
      requestAnimationFrame(function(){ queued = false; fix(); });
    }).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
})();
</script>
<style id="cw-deal-style">
/* The offer is the reason a shopper picks one shop over another on carts, and
   it is not something the engine knows about. Gold, because that is what
   "saving" already means across the family. */
.ll-deal{display:inline-block;margin:6px 0 0;padding:3px 9px;border-radius:999px;
  background:rgba(240,185,60,.14);border:1px solid rgba(240,185,60,.45);
  color:var(--gold);font-size:11px;font-weight:700;letter-spacing:.02em;line-height:1.5}
</style>
<script id="cw-deal">
/* SHOW THE SHOP'S OWN OFFER ON THE CARD.
   Sapura's carts run on multi-buy deals -- "5 for $100", "buy 10 for", mix and
   match. A comparison site that shows the shelf price and hides the offer tells
   a shopper $25 each for something they would pay $20 for, and the per-gram
   number that is the whole point of this page is wrong on exactly the products
   people came for.

   DELIBERATELY NOT ARITHMETIC. The chip prints the shop's words and changes no
   price. "5 for $100" is unambiguous; "buy 2 get 1" is not -- is the free one
   the cheapest, the same size, the same brand? -- and a per-gram figure derived
   from a rule we guessed would be worse than the omission it replaced, because
   it would look authoritative. So: state the offer, leave the maths honest, let
   the shopper read it.

   Additive and mutation-driven for the same reason as the trim chip: the grid
   re-renders on every filter and sort with no hook to attach to. */
(function(){
  var DEALS = {};

  function learn(){
    try {
      var d = window.LL_COLDWATER_META && window.LL_COLDWATER_META.deals;
      if (d) DEALS = d;
    } catch (e) {}
  }

  function paint(){
    learn();
    var cards = document.querySelectorAll("#grid .card");
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.querySelector(".ll-deal")) continue;
      /* Match on the printed title, which is what the engine renders and the
         only handle available from outside the blob. */
      var t = c.querySelector("h3, .name, .title");
      /* String.fromCharCode(10) rather than a newline escape: this line lives in
         a template literal, where "\\n" collapses into a real line break and
         breaks the string outright -- the third time that trap has bitten in
         this file. A character code cannot be collapsed. */
      var raw = t ? t.textContent : (c.innerText || "").split(String.fromCharCode(10))[1];
      var key = String(raw || "").trim().toLowerCase();
      var deal = DEALS[key];
      if (!deal) continue;
      var chip = document.createElement("div");
      chip.className = "ll-deal";
      /* THE QUALIFYING QUANTITY IS NOT OPTIONAL. Once the deal price is folded
         into the per-gram figure, that figure no longer equals price divided by
         grams -- so the card must say what it is true AT. "$20.00/g" alone on a
         $25 cart reads as an arithmetic error; "$20.00/g at 5+" reads as an
         offer, which is what it is. */
      var txt = deal.text || "";
      if (deal.perG != null) {
        /* A plain hyphen, not a middot. Any character above 0x7F written here
           lands in the generated file as a real byte and trips this generator's
           own non-ASCII inventory assert (CLAUDE.md section 5a) -- which is
           exactly what it caught on the first run of this block. */
        txt += (txt ? " - " : "") + "$" + Number(deal.perG).toFixed(2) + "/g";
        if (deal.minQty > 1) txt += " at " + deal.minQty + "+";
        /* MIX AND MATCH HAS TO SAY SO. The arithmetic is right, but the quantity
           is met with OTHER products in the group -- so "$28.00/g at 3+" on its
           own claims you must buy three of THIS item, which is false and would
           send someone to the counter arguing. Naming the group is what makes
           the number honest rather than merely correct. */
        if (deal.mix) txt += deal.group ? " - mix & match across " + deal.group : " - mix & match";
      }
      chip.textContent = txt;
      (t && t.parentNode ? t.parentNode : c).appendChild(chip);
    }
  }

  var queued = false;
  new MutationObserver(function(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; paint(); });
  }).observe(document.body, { childList: true, subtree: true });
  paint();
  var n = 0, iv = setInterval(function(){ paint(); if (++n > 40) clearInterval(iv); }, 300);
})();
</script>
<style id="cw-lab-honesty">
/* NO "LAB VERIFIED" BADGE HERE. The engine paints that badge on any product
   carrying a lab object, and its tooltip says "We read this product's
   Certificate of Analysis - the numbers are measured, not advertised". On this
   page the THC figure comes from the SHOP'S OWN MENU, which in Michigan is the
   state-tested number but is still not a certificate we read and transcribed.
   The engine needs lab.totalThc to sort and filter by strength (see the note in
   api/coldwater.js), so the field is set and this claim is withdrawn -- the
   number stays, the assertion about where it came from goes. */
.cb.lab{display:none!important}
</style>
<script id="cw-lab-honesty-title">
/* Same correction on the chip's tooltip, which says the figure was "Measured
   from the lab report, not the advertised THCa". Accurate on the hemp site,
   where COAs are read; not here. The visible text -- "24.5% total THC" -- is
   true either way and is left alone. */
(function(){
  var SAY = "Total THC as published by the shop's own menu.";
  function fix(){
    var els = document.querySelectorAll(".labthc[title], .strainbtn[title]");
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute("title") !== SAY) els[i].setAttribute("title", SAY);
    }
  }
  var queued = false;
  new MutationObserver(function(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; fix(); });
  }).observe(document.body, { childList: true, subtree: true });
  fix();
})();
</script>
<script id="cw-photo-last">
/* CARDS WITH NO PHOTO SINK TO THE BOTTOM.
   Not a data fix -- the census says Lume is at 96% and two shops are at 0%, and
   that gap closes by re-capturing, not by CSS. But a shelf reads as broken when
   blank plates are scattered through it, and it reads as finished when they sit
   together at the end. The order WITHIN the sunk group is left alone, so
   whatever the engine's sort decided still holds among them.

   The engine owns the grid and re-renders it on every filter and sort, so this
   runs after each render rather than once. Moving a node does not detach its
   listeners, and the engine's card handling is delegated, so a reorder is safe.

   Images resolve late, so a broken one is only detectable after it fails: the
   error listener is captured at document level and re-sinks. */
(function(){
  var grid = document.getElementById("grid");
  if (!grid) return;

  function missingPhoto(card){
    var im = card.querySelector("img");
    if (!im) return true;
    var src = im.getAttribute("src") || im.currentSrc || "";
    if (!src) return true;
    /* complete && naturalWidth 0 is a load that finished and failed. A pending
       image is NOT treated as missing, or every card would sink on first paint
       and jump about as the photos arrive. */
    if (im.complete && im.naturalWidth === 0) return true;
    return false;
  }

  var busy = false;
  function sink(){
    if (busy) return;
    var cards = grid.querySelectorAll(".card");
    if (!cards.length) return;
    var move = [];
    for (var i = 0; i < cards.length; i++) if (missingPhoto(cards[i])) move.push(cards[i]);
    if (!move.length) return;
    /* Already all at the end? Then there is nothing to do, and doing it anyway
       would churn the DOM on every mutation for no reason. */
    var tail = true;
    for (var j = 0; j < move.length; j++) {
      if (cards[cards.length - move.length + j] !== move[j]) { tail = false; break; }
    }
    if (tail) return;
    busy = true;
    for (var k = 0; k < move.length; k++) grid.appendChild(move[k]);
    busy = false;
  }

  var queued = false;
  new MutationObserver(function(){
    if (queued || busy) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; sink(); });
  }).observe(grid, { childList: true, subtree: true });

  document.addEventListener("error", function(e){
    var t = e.target;
    if (t && t.tagName === "IMG" && grid.contains(t)) sink();
  }, true);

  sink();
  var n = 0, iv = setInterval(function(){ sink(); if (++n > 40) clearInterval(iv); }, 300);
})();
</script>
<style id="cw-list-style">
/* THE LIST LIVES ON /trip, AND THERE IS ONLY ONE OF IT.
   This block used to render a second, parallel list here: its own .cwl-add
   buttons on every card, its own "ll_cw_list" storage key, its own panel. The
   engine's own .addbtn -- the one every card actually shows, reading
   "Add to Shopping List" -- writes the engine cart instead, namespaced to
   "ll_cw:<town>:ll_cart" by cw-cart-isolate. Two lists, and the one a shopper could
   reach was not the one either surface read: six items added, an empty list,
   and nothing anywhere reporting a fault, because both halves worked.

   So the parallel machinery is gone. One button writes one key, /trip
   reads that key, and all this block keeps is the count -- a floating tally that
   opens the trip plan, because the drawer's "See my list" is two taps away
   behind a cart icon and the number is the thing that makes somebody look. */
/* THE CORNER IS SHARED, so this claims it explicitly rather than by luck. The
   concierge FAB parks at exactly the same 16/16 with z-index 9996 and was drawn
   on top of this one -- the tally was there, correct, and unreadable. That
   widget is stopped properly now (see cw-palette), and this sits above the old
   z-index anyway so a future one cannot bury it silently again. */
#cwl-fab{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;
  padding:14px 20px;border-radius:999px;text-decoration:none;
  border:1px solid var(--gold,#d8b25a);background:var(--bg2,#101b21);color:var(--gold,#d8b25a);
  font:700 15px/1 inherit;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.5)}
#cwl-fab[hidden]{display:none}
#cwl-fab:hover{background:#16242f}
</style>

<script id="cw-list">
/* THE COUNT, and nothing else.
   The whole reason this page has a list rather than a checkout is that a cart
   cannot span shops and spanning shops IS this page -- the answer is usually
   "the ounce is cheapest here and the cart is cheapest there". These shops sell
   at a counter rather than to a door, and mechanically there is nothing to check
   out to: Dutchie and Jane carts are session state inside their own apps with no
   public add-to-cart contract. The deliverable is a route with a list per stop,
   and it is rendered on its own page (/trip) because that page can be
   a homescreen shortcut, works offline, and is the thing somebody actually holds
   in the shop.

   READ THE ENGINE'S KEY LITERALLY. cw-cart-isolate rewrites only keys matching
   /^ll_cart/, so the namespaced spelling passes through it unchanged and means
   the same thing here and on /trip, which has no shim -- and the town
   is IN the spelling, because two cities are two trips. The link carries the
   town as well, so a list opened from here is this town's even when the shopper
   last browsed another one. */
(function(){
  var KEY = "ll_cw:${MK.slug}:ll_cart", LIST = "/trip?market=${MK.slug}";

  function count(){
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v.length : 0;
    } catch (e) { return 0; }
  }

  var fab = document.createElement("a");
  fab.id = "cwl-fab";
  fab.href = LIST;
  fab.hidden = true;
  document.body.appendChild(fab);

  function paint(){
    var n = count();
    fab.hidden = n === 0;
    fab.textContent = "My trip (" + n + ")";
  }

  /* The engine writes its cart on every add and re-renders the grid at the same
     time, so observing the grid catches the change without patching the blob.
     The storage event covers a second tab; the interval is the backstop for an
     add that does not touch the grid at all (the drawer's own quantity steppers
     do exactly that), and one read of one localStorage key per second costs
     nothing measurable. */
  paint();
  var grid = document.getElementById("grid");
  if (grid) { try { new MutationObserver(paint).observe(grid, { childList: true, subtree: true }); } catch (e) {} }
  document.addEventListener("click", function(){ setTimeout(paint, 30); }, true);
  window.addEventListener("storage", paint);
  setInterval(paint, 1000);
})();
</script>

<style id="cw-drawer-style">
/* ONE BUTTON, AND IT LOOKS LIKE THE ONE THING TO DO. The per-shop controls it
   replaces were the engine's vendor-checkout links, styled as five equal
   buttons down the body -- so the drawer read as five errands rather than one
   list. */
#cartFoot .cw-golist{display:block;margin:12px 0 2px;padding:14px 16px;border-radius:12px;
  text-align:center;text-decoration:none;cursor:pointer;
  font:800 15px/1 inherit;letter-spacing:.01em;
  background:var(--leaf,#4ec9ff);color:#04202b;border:1px solid var(--leaf,#4ec9ff)}
#cartFoot .cw-golist:hover{filter:brightness(1.08)}
#cartFoot .cw-golist-sub{display:block;margin-top:8px;text-align:center;
  font-size:11.5px;color:var(--muted,#8fa6b3)}
</style>

<script id="cw-drawer">
/* THE DRAWER IS A SHOPPING LIST FOR ONE TOWN, NOT A CART PER SHOP.
 *
 * index.html carries an "ll-checkout-fix" block that rewrites the drawer's
 * anchors into vendor cart URLs -- Shopify /cart/<variant>:<qty>, Woo
 * ?add-to-cart= -- and this page inherits it because it is generated from that
 * file. None of it can work for a Coldwater shop: Dutchie and Jane carts are
 * session state inside their own apps with no public add-to-cart contract, these
 * shops sell at a counter rather than to a door, and a cart cannot span seven of
 * them anyway, which is the entire point of the page.
 *
 * THE FIRST FIX WAS HALF A FIX. It relabelled each of those per-shop buttons to
 * "See my list", which left the drawer showing a Sapura list, an Exclusive list
 * and a Banzen list -- three buttons to the same page, reported as exactly that.
 * The engine groups the cart by store and hangs a checkout control off each
 * group, so relabelling them preserved the shape of the thing that was wrong.
 * They are REMOVED now, and one primary button goes in the footer where the
 * total already is.
 *
 * The wording changes with it. "Legal-Leaf Cart", "checkout at each store", and
 * a footer promising that each link "pre-fills the cart, applies your coupon and
 * affiliate ref" are all true of the hemp shelf and all false here -- there is
 * no checkout, no coupon and no affiliate link in this town. A drawer that
 * describes a thing it cannot do is the promise this whole file exists to avoid
 * making.
 *
 * REAPPLIED RATHER THAN RUN ONCE, because renderCart rebuilds #cartBody and
 * #cartFoot from scratch on every add, every remove and every open. Each step is
 * idempotent and marked, so the observer watching for those rewrites is not
 * retriggered by this one -- which would be a loop rather than a bug you notice.
 */
(function(){
  var LIST = "/trip?market=${MK.slug}";
  var TOWN  = ${JSON.stringify(MK.label)};
  var TITLE = TOWN + " Cannabis Shopping List";
  var SUB   = "One list for the whole town \\u00b7 buy it at the counter";
  var NOTE  = "Prices are what each shop published when this page loaded. Nothing is " +
              "reserved and nothing is bought here \\u2014 confirm at the counter.";
  var EMPTY = "Your " + TOWN + " list is empty.<br/>Add anything from the shelf to start " +
              "planning a trip across the shops.";

  function paint(){
    var drawer = document.getElementById("cartDrawer");
    if (!drawer) return;

    var h2 = drawer.querySelector(".dhead h2");
    if (h2 && h2.textContent !== TITLE) h2.textContent = TITLE;
    var sub = drawer.querySelector(".dhead p");
    if (sub && sub.textContent !== SUB) sub.textContent = SUB;

    var body = document.getElementById("cartBody");
    if (body) {
      /* The engine's per-store checkout control, in all three shapes it builds:
         an <a> for a URL platform, a <button> for the two handoff modals. */
      var gone = body.querySelectorAll('.checkout, [data-checkout], a[href*="/cart"], a[href*="add-to-cart"]');
      for (var i = 0; i < gone.length; i++) gone[i].remove();

      var empty = body.querySelector(".dempty");
      if (empty && empty.getAttribute("data-cw") !== "1") {
        empty.setAttribute("data-cw", "1");
        empty.innerHTML = EMPTY;
      }
    }

    var foot = document.getElementById("cartFoot");
    /* An empty cart empties the footer too, and a button to an empty list is a
       dead end -- so this follows the engine's own emptiness rather than
       deciding its own. */
    if (!foot || !foot.firstChild) return;

    var note = foot.querySelector("p");
    if (note && note.textContent !== NOTE) note.textContent = NOTE;

    if (!foot.querySelector(".cw-golist")) {
      var a = document.createElement("a");
      a.className = "cw-golist";
      a.href = LIST;
      a.textContent = "See my " + TOWN + " list \\u2192";
      foot.appendChild(a);
      var s2 = document.createElement("span");
      s2.className = "cw-golist-sub";
      s2.textContent = "Grouped by shop, brand or category \\u00b7 save, print or share it";
      foot.appendChild(s2);
    }
  }

  var queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; paint(); });
  }

  try {
    var d = document.getElementById("cartDrawer");
    if (d && window.MutationObserver) new MutationObserver(schedule).observe(d, { childList: true, subtree: true });
  } catch (e) {}
  /* The drawer is opened from a control the engine owns, and its contents are
     built at that moment -- so the open itself is a cue, not only the mutation. */
  document.addEventListener("click", function(){ setTimeout(schedule, 0); }, true);
  schedule();
})();
</script>

`;

/* ------------------------------------------------ admin category vocabulary ---
 * The console's own category list came over with it from index.html, and it is
 * the HEMP shelf's vocabulary: it offers "Drinks" and "Wholesale", which do not
 * exist in this town, and omits Vaporizers, Accessories and Apparel, which are
 * three of its biggest facets. An operator reclassifying a mislabelled vape here
 * had no "Vaporizers" to pick.
 *
 * Set to the engine's own vocabulary instead -- the same set api/coldwater.js
 * folds the feed into (ENGINE_CATEGORIES there), so a value chosen in this panel
 * is a value the filter already has an entry for. Choosing a category the engine
 * has never heard of is how the Pre-Rolls/Pre-rolls split happened; a dropdown
 * that can produce one is the same bug with a nicer interface.
 */
const CW_CATS = 'var CATS=["THCA Flower","Pre-rolls","Concentrate","Vaporizers","Edibles","Topicals","Accessories","Apparel"];';
let catsPatched = 0;
for (let i = 0; i < lines.length; i++) {
  if (i === blobIdx) continue;
  if (/^\s*var CATS=\[/.test(lines[i])) { lines[i] = "  " + CW_CATS; catsPatched++; }
}

/* ---------------------------------------------------- overrides namespace ---
 * THE ADMIN CONSOLE IS ALREADY HERE, inherited wholesale from index.html along
 * with everything else this generator copies -- the adminmode keystroke, the PIN
 * gate, the Category Control panel, and the server sync. That is a good thing:
 * one console, two shelves, nothing to keep in step.
 *
 * What was NOT good is that all three of its /api/overrides calls were
 * unnamespaced, so the Coldwater page was sharing the hemp shelf's override
 * batch in both directions:
 *
 *   - every VISITOR to /coldwater pulled the hemp batch on load and let
 *     importBatch() apply it to the dispensary catalogue. Overrides key on
 *     product identity and "Blue Dream" exists in both shelves, so a rename or
 *     an image fix made for a mail-order hemp product was landing on a Michigan
 *     dispensary card.
 *   - every admin EDIT made on /coldwater wrote into the hemp shelf's batch.
 *
 * Neither errors. It is the ll_cart mistake exactly, and the first person to
 * notice would have been a shopper looking at a wrong photo.
 *
 * api/overrides.js is namespaced now (llm keeps the original key byte for byte,
 * so nothing the hemp shelf has saved moves); this points this page's three call
 * sites at its own market. Asserted below, because a missing parameter here is
 * invisible in the rendered page and only shows up as a wrong product.
 */
const OV_GET = 'fetch("/api/overrides",{cache:"no-store"})';
const OV_POST = 'fetch("/api/overrides",{method:"POST",';
let ovGets = 0, ovPosts = 0;
for (let i = 0; i < lines.length; i++) {
  if (i === blobIdx) continue;                       // never touch the engine blob
  if (lines[i].includes(OV_GET)) {
    lines[i] = lines[i].split(OV_GET).join(`fetch("/api/overrides?market=${MK.slug}",{cache:"no-store"})`);
    ovGets++;
  }
  if (lines[i].includes(OV_POST)) {
    lines[i] = lines[i].split(OV_POST).join(`fetch("/api/overrides?market=${MK.slug}",{method:"POST",`);
    ovPosts++;
  }
}

/* ------------------------------------------------- extract the engine ------
 * ONE ENGINE, NOT ONE PER CITY. This is step 3 of ONE_CORE.md and the reason the
 * whole plan works: the 250 KB engine stops being a base64 line inside every
 * city page and becomes one file every city page loads.
 *
 * At one city that is a wash. At thirty it is the difference between a 20 MB
 * repo of generated HTML that must all be regenerated whenever the engine
 * changes, and one file. It is also the difference between a browser downloading
 * 250 KB per city visited and downloading it once for the whole site.
 *
 * THIS IS A MOVE, NOT AN EDIT, which is what makes it safe under CLAUDE.md 5 and
 * 11. The same bytes come out; the assert below re-encodes the written file and
 * compares against the original base64 string, so "byte-identical" is proven on
 * every build rather than hoped for.
 *
 * ---------------------------------------------------------------------------
 * IT ALSO FIXES A LIVE MOJIBAKE BUG, and that IS a behaviour change, so it is
 * stated here rather than slipped in.
 *
 * The decoded engine is valid UTF-8 and carries 120 high bytes -- real
 * multi-byte characters like the degree sign in "360º Grinder". But the boot
 * path was `s.text = window.atob(B)`, and atob returns a LATIN1 byte string: each
 * UTF-8 byte becomes its own character. So the live page has been rendering
 * "360Âº Grinder" in about forty places, and has since the blob was created.
 *
 * Written as a real .js file and served as UTF-8, those characters are simply
 * correct. Nothing else about the engine changes -- same bytes, decoded once at
 * build time by something that knows what encoding they are in, instead of at
 * run time by something that does not.
 * ---------------------------------------------------------------------------
 */
const ENGINE_OUT = "public/engine.js";
const blobB64 = (lines[blobIdx].match(/var B="([A-Za-z0-9+/=]+)"/) || [])[1];
if (!blobB64) { console.error("FAIL: could not read the base64 out of the engine line"); process.exit(1); }
const engineBytes = Buffer.from(blobB64, "base64");
writeFileSync(ENGINE_OUT, engineBytes);
/* Re-encode what was actually written and compare to what we started with. A
   helper that fails this would corrupt the engine in a way no diff would show,
   which is the exact warning in CLAUDE.md 5a. */
const engineRoundTrips = readFileSync(ENGINE_OUT).toString("base64") === blobB64;
const engineHighBytes = readFileSync(ENGINE_OUT).filter(b => b > 127).length;
const engineIsUtf8 = (() => {
  try { new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(ENGINE_OUT)); return true; }
  catch (e) { return false; }
})();

/* Replace the whole boot IIFE -- the blob line and the atob that ran it -- with
   one tag at the same position. Position matters: the original appended the
   decoded script to document.body at parse time, so a synchronous tag in the
   same place runs at the same moment against the same DOM. */
let bootStart = -1, bootEnd = -1;
for (let i = blobIdx; i >= 0 && i > blobIdx - 8; i--) {
  if (lines[i].trim() === "<script>") { bootStart = i; break; }
}
for (let i = blobIdx; i < lines.length && i < blobIdx + 20; i++) {
  if (lines[i].trim() === "</script>") { bootEnd = i; break; }
}
if (bootStart < 0 || bootEnd < 0) { console.error("FAIL: could not bound the engine boot block"); process.exit(1); }
const bootLines = bootEnd - bootStart + 1;
/* DERIVED, NEVER TYPED. The line-count assert below needs to know how many
   lines went in; a hand-kept constant beside a list is a number that drifts
   the first time somebody adds a comment line, and the assert it feeds is
   what catches an injection landing twice. */
const ENGINE_TAG = [
  '<!-- THE ENGINE, shared by every city page. Extracted from the base64 blob at',
  '     build time; see tools/make-coldwater.mjs. Synchronous and in the same',
  '     position the decoded script used to be appended, so it runs at the same',
  '     moment against the same DOM. -->',
  '<script src="/engine.js"></script>',
  '<script>',
  '  /* Parity with the boot block this replaced, which reported a decode failure',
  '     into #count rather than only to the console. A missing engine is now a',
  '     network failure rather than a decode one, but it looks identical to a',
  '     shopper -- an empty page -- so it still says so. */',
  '  if (!window.LL_admin && !window.__LL_ENGINE_OK__) setTimeout(function(){',
  '    if (window.LL_admin || window.__LL_ENGINE_OK__) return;',
  '    var d = document.getElementById("count");',
  '    if (d && !d.textContent.trim()) d.textContent = "Engine did not load.";',
  '  }, 4000);',
  '</script>'];
const ENGINE_TAG_LINES = ENGINE_TAG.length;
lines.splice(bootStart, bootLines, ...ENGINE_TAG);

const headIdx = lines.findIndex((l, i) => i !== blobIdx && l.trim() === "</head>");
if (headIdx < 0) { console.error("FAIL: no standalone </head>"); process.exit(1); }
const mainStyleIdx = lines.findIndex((l, i) => i !== blobIdx && l.trim() === "<style>");
if (mainStyleIdx < 0 || mainStyleIdx > headIdx) { console.error("FAIL: cannot locate the base stylesheet"); process.exit(1); }
lines.splice(headIdx, 0, INJECT.replace(/\n$/, ""));
let injectedLines = INJECT.replace(/\n$/, "").split("\n").length;

const bodyIdx = lines.findIndex((l, i) => i !== blobIdx && l.trim() === "</body>");
if (bodyIdx < 0) { console.error("FAIL: no standalone </body>"); process.exit(1); }
lines.splice(bodyIdx, 0, TAIL + FRESHNESS + COLOUR + COLOUR_ADMIN + ESCAPE + FEED + CATSPLIT);
injectedLines += (TAIL + FRESHNESS + COLOUR + COLOUR_ADMIN + ESCAPE + FEED + CATSPLIT).split("\n").length;

/* ------------------------------------------------------------- verify ----- */

const out = lines.join("\n");
const newBlobIdx = lines.findIndex(l => l.length > 100000 && l.includes('var B="'));

/* THE RAILS ARE NOT IN `out` ANY MORE, and their checks follow them rather than
   being deleted. public/js/rails.js is loaded by public/index.html, so a city
   page inherits it the way it inherits the engine -- and these assertions still
   have to run somewhere, because every one of them is pinning a mistake that was
   made once already.
   PER-RAIL SCOPING IS KEPT DELIBERATELY. A document-wide regex is how a check
   goes green against the prose in a neighbouring block, which has happened here
   twice; railBlock() gives each assertion the same narrow window the
   out.split('id="cw-...")[1] form used to. */
const rails = readFileSync("public/js/rails.js", "utf8");
/* Same story for the photo viewer: four blocks that were injected here and are
   now inherited from public/index.html. The assertions follow the code. */
const photo = readFileSync("public/js/photo-view.js", "utf8");
/* And the opening-shelf shuffle, which moved out of cw-feed for the same
   reason: index.html loads it, so every city page inherits one copy. */
const shuffle = readFileSync("public/js/shelf-shuffle.js", "utf8");
const photoCss = readFileSync("public/css/photo-view.css", "utf8");
const railsCss = readFileSync("public/css/rails.css", "utf8");
const RAIL_TITLES = ["CAROUSEL BEHAVIOUR", "THE FACET PAIR", "SHOP BY STORE",
                     "SHOP BY CATEGORY", "SHOP BY BRAND"];
function railBlock(title) {
  const i = rails.indexOf(title);
  if (i < 0) return "";
  let end = rails.length;
  for (const t of RAIL_TITLES) { const j = rails.indexOf(t); if (j > i && j < end) end = j; }
  return rails.slice(i, end);
}

const checks = [
  /* THE BLOB IS GONE FROM THE PAGE ON PURPOSE, so the old md5-of-the-line assert
     cannot run. Its job moves to the extracted file, and the check is stronger
     than it was: re-encode what was actually written and compare it to the
     base64 we started from. Byte-identical is proven, not assumed. */
  ["engine round-trips byte-identically", engineRoundTrips, "re-encoded === original base64"],
  ["engine is out of the page", newBlobIdx < 0, `blob line index ${newBlobIdx}`],
  ["engine is loaded from one shared file", (out.match(/<script src="\/engine\.js"><\/script>/g) || []).length === 1, ""],
  ["engine file is valid UTF-8", engineIsUtf8, ""],
  /* 120 is the number CLAUDE.md 5a records. If it doubled, something
     double-encoded it; if it went to zero, something stripped it. */
  ["engine keeps its 120 high bytes", engineHighBytes === 120, `${engineHighBytes} high bytes`],
  /* The atob path is what turned those 120 bytes into mojibake. It must not
     survive, or the page would decode an engine it no longer carries. */
  ["the atob boot path is gone", !/window\.atob\(_b\)/.test(out), ""],
  ["the page is much smaller without it", out.length < 500000, `${out.length} bytes`],
  ["non-ASCII inventory unchanged", nonAscii(out) === nonAscii(src), `${nonAscii(out)} vs ${nonAscii(src)}`],
  ["no CRLF introduced", (out.match(/\r/g) || []).length === (src.match(/\r/g) || []).length, ""],
  ["no BOM", out.charCodeAt(0) !== 0xFEFF, ""],
  /* The engine extraction REMOVES the boot block (blob line + atob IIFE) and puts
     a shorter tag in its place, so the arithmetic carries that delta explicitly
     rather than the assert being loosened to a range. A line count that drifts
     silently is how an injection lands twice. */
  ["line count = source + injected - boot + tag",
    out.split("\n").length === src.split("\n").length + injectedLines - bootLines + ENGINE_TAG_LINES,
    `${out.split("\n").length} vs ${src.split("\n").length + injectedLines - bootLines + ENGINE_TAG_LINES}`],
  ["overlay present once", (out.match(/id="cw-palette"/g) || []).length === 1, ""],
  /* Two pages, two carts. Same origin and the same "ll_cart" key put dispensary
     products into the hemp site's cart, where no vendor checkout URL exists. */
  ["the cart is isolated from the hemp site", (out.match(/id="cw-cart-isolate"/g) || []).length === 1, ""],
  /* A page that cannot check out must not offer a checkout. */
  ["the vendor checkout is disarmed here", (out.match(/id="cw-drawer"/g) || []).length === 1, ""],
  /* The first fix RELABELLED each per-shop checkout control to "See my list",
     which left one button per shop pointing at one page -- the shape of the
     thing that was wrong, preserved. They are removed now. */
  ["...by removing the per-shop controls, not renaming them",
    /gone\[i\]\.remove\(\)/.test(out) && !/textContent = "See my list"/.test(out), ""],
  ["one primary button, in the footer where the total already is",
    /className = "cw-golist"/.test(out) && /#cartFoot \.cw-golist\{/.test(out), ""],
  ["the drawer is retitled for this town rather than the hemp shelf",
    /Cannabis Shopping List/.test(out) && /TOWN \+ " Cannabis Shopping List"/.test(out), ""],
  ["...and stops promising a checkout, a coupon and an affiliate ref it does not have",
    /reserved and nothing is bought here/.test(out), ""],
  ["and it points at the shopping list instead",
    out.indexOf('var LIST = "/trip?market=' + MK.slug + '"') >= 0, ""],
  /* Positioned against the engine's SCRIPT TAG now that the blob is gone. Same
     guarantee, same reason: the isolation has to be in place before the engine
     builds a cart, and `var B="` no longer exists to measure against. */
  ["and the isolation runs before the engine",
    out.indexOf('id="cw-cart-isolate"') < out.indexOf('<script src="/engine.js">'), ""],
  ["endpoint shim present once", (out.match(/id="cw-endpoint"/g) || []).length === 1, ""],
  ["THC relabel present once", (out.match(/id="cw-thc-label"/g) || []).length === 1, ""],
  /* Gear is published with cannabinoid "Accessory" so the engine's own accessory
     card renders it -- no per-gram, no size dropdown, and nothing left for it to
     derive a weight from. That card is written for a mail-order glass shop, so
     the two shipping lines it prints have to go on a page about walk-in shops. */
  ["the accessory card is de-shipped for a walk-in page",
    (out.match(/id="cw-gear-card"/g) || []).length === 1, ""],
  ["and it corrects what is printed rather than what is stored",
    /otd\.remove\(\)/.test(out) && /At the counter,/.test(out), ""],
  /* THE RAILS ARRIVE AS A FILE NOW, inherited from public/index.html rather than
     injected here, so "present once" is a question about the page's script tags
     and about rails.js having the section -- both halves, because a page that
     loads the file and a file that still contains the rail are different
     failures. */
  ["the shared rails file is loaded, once", (out.match(/src="\/js\/rails\.js"/g) || []).length === 1, ""],
  ["...and its stylesheet with it", (out.match(/href="\/css\/rails\.css"/g) || []).length === 1, ""],
  ["...and no copy of a rail was left behind in the generator",
    !/id="cw-logorow"|id="cw-catrow"|id="cw-brandrow"|id="cw-carousel"|id="cw-facet-pair"/.test(out), ""],
  ["store logo strip present once", railBlock("SHOP BY STORE").length > 2000, ""],
  ["category strip present once", railBlock("SHOP BY CATEGORY").length > 2000, ""],
  /* Two stops, asserted separately, the way the concierge's are: the CSS keeps
     them from flashing, the removal is what makes them gone. */
  ["the hemp catalogue's nav is hidden here", (out.match(/id="cw-no-hemp-nav"/g) || []).length === 1, ""],
  ["the shared photo viewer is loaded, once", (out.match(/src="\/js\/photo-view\.js"/g) || []).length === 1, ""],
  ["...and its stylesheet with it", (out.match(/href="\/css\/photo-view\.css"/g) || []).length === 1, ""],
  ["...and no copy of it was left behind in the generator",
    !/id="cw-photo-zoom"|id="cw-expand"/.test(out), ""],
  ["full-screen photo present once", /id = "cwZoom"/.test(photo), ""],
  ["the trim chip is recoloured for this page once", (out.match(/id="cw-trim-chip-cw"/g) || []).length === 1, ""],
  /* Hidden, never deleted: an offcut label that is gone sells shake as flower,
     which is the failure the banner exists to prevent. */
  ["and it is hidden by opacity rather than removed", /\.ll-trim-tag\{[^}]*opacity:0/.test(out.replace(/\s+/g, "")), ""],
  ["photo styles present once", /#cwZoom\{/.test(photoCss.replace(/\s+/g, "")), ""],
  /* Bound to any card <img> rather than to a class the engine owns: a selector
     into the blob is a feature that stops working with no error. */
  ["the photo opener does not depend on an engine class name",
    /t\.tagName !== "IMG"/.test(photo) && /#grid \.card, #drawer/.test(photo), ""],
  ["and actually removed, not just not shown", (out.match(/id="cw-no-hemp-nav-js"/g) || []).length === 1, ""],
  ["all four hemp-shelf pages are named",
    /#pageConsumables,#pageDevices,#pageInternational,#pageWholesale/.test(out), ""],
  /* The other half of the rule, and the half a "hide the hemp nav" reading gets
     wrong: the Library and Reels are writing and video, not a catalogue, so
     they belong on a city page as much as on the hemp one. */
  /* Scoped to the SELECTOR and the IDS array, not to the blocks around them.
     Two near misses on the way here, and both are the reason this is worth the
     precision: a document-wide search cannot work because the nav anchors carry
     id="pageLibrary" in index.html's own markup, and a whole-block search
     cannot work either because the note above argues about /library and /reels
     by name -- so the check went red against prose explaining the very
     behaviour it was asserting. */
  ["and the two pages that sell nothing are left alone",
    !/(Library|Reels)/.test(
      (out.match(/^#page[A-Za-z,#]*\{display:none!important\}$/m) || [""])[0] +
      (out.match(/var IDS = \[[^\]]*\]/) || [""])[0]
    ), ""],
  /* Same rule as the store and brand rails: face the engine's own control rather
     than filtering behind its back, or the chips and the dropdown will disagree
     about what the grid is showing. */
  ["category strip drives the engine's own #fCategory, not its own filter",
    /getElementById\("fCategory"\)/.test(railBlock("SHOP BY CATEGORY")), ""],
  /* The engine nests every real category under an optgroup, so .options-style
     iteration would have to be told about the nesting -- and the group parents
     ("All Consumables") are values a chip must NOT offer, since they are the
     parent of the chips beside them. */
  ["and skips the engine's synthetic group rows rather than chipping them",
    /v\.indexOf\("__"\) === 0/.test(rails), ""],
  ["the facet pair present once", railBlock("THE FACET PAIR").length > 300, ""],
  ["and it is defined before both rails that mount into it",
    rails.indexOf("THE FACET PAIR") < rails.indexOf("SHOP BY STORE") &&
    rails.indexOf("THE FACET PAIR") < rails.indexOf("SHOP BY CATEGORY"), ""],
  ["store and category ask for their column by name, so they cannot swap sides",
    (rails.match(/CW_facetSlot\("store"\)/g) || []).length === 1 &&
    (rails.match(/CW_facetSlot\("cat"\)/g) || []).length === 1, ""],
  ["the divider is its own grid track, so it lands on the shell's midpoint",
    /\.lrpair\{display:grid;grid-template-columns:1fr 1px 1fr/.test(railsCss) &&
    (rails.match(/class="lrsplit"/g) || []).length === 1, ""],
  ["and it turns horizontal when the pair stacks, rather than disappearing",
    /\.lrsplit\{width:auto;height:1px/.test(railsCss), ""],
  /* A rail of 104px chips inside a grid track sizes to min-content unless told
     otherwise, and then it widens the page instead of scrolling itself. */
  ["the columns can shrink, so a rail scrolls instead of widening the page",
    /\.lrpair>\.lrpair-col\{min-width:0\}/.test(railsCss), ""],
  /* THE ARROWS ARE GONE, and the three things that replace them are asserted
     instead -- a rail with no arrows and no working gesture is a dead row of
     circles, which is worse than the buttons were. Wheel, drag and the fade. */
  /* AUDITED: before this block the only thing on the page that closed on Escape
     was the photo viewer. Every engine overlay trapped you. */
  ["Escape closes overlays, once, for the topmost one",
    (out.match(/id="cw-escape"/g) || []).length === 1, ""],
  ["...and presses the overlay's own close control rather than hiding it",
    /\[data-close\]/.test(out.split('id="cw-escape"')[1].split("</script>")[0]), ""],
  ["...and leaves the photo viewer to its own handler, so one press peels one layer",
    !/cwZoom/.test(out.split('id="cw-escape"')[1].split("</script>")[0]), ""],
  /* "The logos load really slowly and not always show up" -- three faults, and
     the third is the one that is not slowness at all. */
  ["a store chip always has a monogram under the mark, so none can render blank",
    /class="limg mono" data-letter=/.test(rails), ""],
  ["the mark is fetched eagerly: lazy on a horizontal rail is close to never",
    /loading="eager" fetchpriority="low"/.test(rails), ""],
  ["...with a second provider to try before giving up",
    /icons\.duckduckgo\.com\/ip3\//.test(rails), ""],
  ["...revealed only once it has decoded, so a slow lookup is not a white hole",
    /naturalWidth > 1/.test(rails) && /\.fimg\.ok\{opacity:1\}/.test(railsCss), ""],
  /* THE WORST OF THE THREE: the strip builds itself from #fStore the moment that
     select has options, which is well before /api/coldwater has answered, and
     nothing re-rendered it when the domains arrived. */
  ["the strip redraws when the feed announces itself, not only when the select moves",
    /addEventListener\("ll-meta", schedule\)/.test(out), ""],
  ["...and both favicon hosts are preconnected so the handshake is not on the critical path",
    /rel="preconnect" href="https:\/\/www\.google\.com"/.test(out) &&
    /rel="preconnect" href="https:\/\/icons\.duckduckgo\.com"/.test(out), ""],
  /* A signature guard that matches an EMPTY box is a rail that never comes back. */
  ["an emptied rail rebuilds itself rather than matching its own signature",
    (rails.match(/sig !== lastSig \|\| !box\.firstChild/g) || []).length === 2, ""],
  /* The category rail shows a real product photo again, curated rather than
     first-wins -- a drawn mark reads as a placeholder beside photographic
     brand marks, which is what "the category emojis really suck" meant. */
  ["a category chip prefers a real product photo",
    /var PREFER = \{/.test(rails) && /class="bimg"/.test(railBlock("SHOP BY CATEGORY")), ""],
  ["...curated by what the category actually looks like, not by whichever card sorted first",
    /scoreFor\(cat, /.test(rails) && /sc > \(SCORE\[cat\] \|\| 0\)/.test(rails), ""],
  ["...on the white plate the brand rail uses",
    /\(pic \? " photo" : " mono cat"\)/.test(rails), ""],
  /* "You're only loading, like, nine ... two rows of four and a third row of
     one ... and it still doesn't do full rows." Three faults, one block. */
  ["the shelf opens on a full one, not on one page of twelve",
    /var FLOOR = 40;/.test(out), ""],
  ["...by pressing the engine's own Load more, since PAGE lives in the blob",
    /b\.click\(\)/.test(out.split('id="cw-feed"')[1].split("</script>")[0]), ""],
  ["...with a hard stop, so a feed that never satisfies it cannot spin",
    /MAX_CLICKS/.test(out), ""],
  ["the load-more bar spans the row instead of sitting in a cell",
    /#grid \.loadmore\{grid-column:1 \/ -1/.test(out), ""],
  ["a short last row is held back only while there is more to load",
    /if \(!g\.querySelector\("\.loadmore"\)\) return;/.test(out), ""],
  ["the shared shuffle is loaded, once", (out.match(/src="\/js\/shelf-shuffle\.js"/g) || []).length === 1, ""],
  /* THESE READ THE SHARED FILE'S SOURCE, so they name what it is doing rather
     than how it spells it -- one deal function taking the axis as an argument,
     called once per axis. An earlier pair named byStore and byCategoryOnly and
     went red the day those were folded into one, with the behaviour unchanged.
     Assert the call, which cannot survive the behaviour being dropped. */
  ["the opening shelf is dealt across shops",
    /dealRounds\(cards, storeOf/.test(shuffle) && /window\.LL_shuffle/.test(shuffle), ""],
  /* THE SECOND AXIS, which the city block never had: one shop's flower used to
     run as a block down the page even when the shops were mixed. */
  ["...and across categories too", /catOf\(/.test(shuffle) && /lastCat/.test(shuffle), ""],
  ["...with a single-shop page dealt on that axis alone",
    /dealRounds\(cards, catOf/.test(shuffle), ""],
  /* THE THIRD AXIS, and the one the other two cannot see: an offcut is a
     sub-tag, so a shake jar sits in its shop's bucket under data-cat="THCA
     Flower" and reads as a jar of buds. Assert the split and the ratio, not the
     spelling -- a shelf ranked by price per gram opens on shake the moment
     either is dropped. */
  ["...and offcuts held to a ratio rather than leading it",
    /trimMap\(/.test(shuffle) && /allowCut/.test(shuffle) && /var GAP =/.test(shuffle), ""],
  /* A FEED IS DIFFERENT EVERY TIME YOU OPEN IT. The deal had no randomness in it
     at all until 20 Aug 2026, so every visitor saw the same shelf on every visit. */
  ["...and dealt fresh on each load, not the same order every time",
    /Math\.random\(\)/.test(shuffle) && /shuffledCopy/.test(shuffle), ""],
  /* The sequencing stays here, because it is this block's job: top the shelf up,
     deal it, then trim the short last row. Two drivers on one grid is a fight
     that shows as cards twitching rather than as an error, so the shared file
     arms its own observer only where this block is absent. */
  ["cw-feed calls it rather than carrying a copy",
    /window\.LL_shuffle\(grid\(\)\)/.test(out) && !/function interleave\(\)/.test(out), ""],
  ["...and the shared driver stands down when this block is present",
    /getElementById\("cw-feed"\)/.test(shuffle), ""],
  /* Two earlier versions read "unfiltered" off the CONTROLS and both stood down
     on every load in production -- one because #fSort ships set to "pergram",
     one because the engine sets its select values a tick after this block runs.
     A trusted event has no timing to get wrong. */
  ["...and 'unfiltered' is a fact about the shopper, not a guess at the controls",
    /e\.isTrusted/.test(shuffle) && /var touched = false;/.test(shuffle), ""],
  ["the rotation never puts the same shop twice in a row",
    /k2 === last/.test(shuffle), ""],
  ["...and four cards across, so rows of four are a fact not a viewport accident",
    /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/.test(out), ""],
  /* The stop that was written against the script tag rather than the button it
     builds, so the widget was visible on this page for months and only the
     fetch refusal was doing anything. */
  ["the concierge stop names the button the widget actually builds",
    /\.llc-fab,\.llc-panel/.test(out), ""],
  ["...and the trip tally is not buried under whatever else claims that corner",
    /#cwl-fab\{position:fixed;right:16px;[^}]*z-index:9999/.test(out), ""],
  /* The hover wash on a card photo is a local literal in index.html, a hot pink
     ported from Nicotia. On a cold-blue shelf it is the one warm thing on the
     page and it reads as an alert rather than as an invitation. */
  ["the card photo's hover wash is this page's blue, not the hemp site's pink",
    /#grid \.card \.cimg::after\{background:rgba\(78,201,255/.test(photoCss), ""],
  ["a photo has an explicit expand control rather than the whole picture meaning two things",
    /b\.className = "cw-expand"/.test(photo) && /Expand photo to full view/.test(photo), ""],
  ["...and the picture itself is left to flip the card",
    /if \(inCard && !expand\) return;/.test(photo), ""],
  ["a thumbnail is not magnified into mush",
    /function capToNatural\(\)/.test(photo) && /nw \* 2/.test(photo), ""],
  /* The engine flattens carts and disposables into Concentrate on the way in,
     by a rule with its reason written beside it. This asserts the feed's answer
     back over it through the engine's OWN manual-category override rather than
     patching the blob. */
  ["the category split is asserted through the engine's own override",
    (out.match(/id="cw-catsplit"/g) || []).length === 1 && /LL_MANUAL_CAT/.test(out), ""],
  ["...keyed on the feed's product id, which is what that override reads",
    /catById/.test(out), ""],
  ["...carrying no name, so it cannot match a same-named product elsewhere",
    !/name:\s*by\[id\]/.test(out) && /cat: by\[id\], t: 0, cwSplit: true/.test(out), ""],
  ["...and marked so an operator cannot publish a derived split as a decision",
    /__cwGuarded/.test(out) && /exportBatch/.test(out), ""],
  ["the redundant virtual Vape facet is gone, now that Carts and Disposables say it better",
    /function dropVapeFacet\(\)/.test(out), ""],
  ["...and a shopper sitting on it is not left filtered by a control they cannot see",
    /if \(sel\.value === "Vape"\)/.test(out), ""],
  ["no nudge arrows survive on any rail",
    !/lrnav/.test(out), ""],
  ["a vertical wheel over a rail scrolls it sideways",
    /addEventListener\("wheel"/.test(rails) && /box\.scrollLeft = next/.test(rails), ""],
  /* THE GESTURE PEOPLE ACTUALLY REACH FOR. A two-finger sideways swipe is
     deltaX, and the handler used to discard exactly that -- so the rail moved
     for a vertical wheel and refused the one motion a trackpad user would try.
     Reported as having to click and drag. */
  ["...and a two-finger sideways swipe moves it too",
    /Math\.abs\(e\.deltaX\) > Math\.abs\(e\.deltaY\)/.test(rails), ""],
  /* The release is now axis-aware and has to stay that way: a VERTICAL gesture
     at a stop is handed back so the page scrolls instead of the cursor sitting
     over a dead zone, while a horizontal one is kept -- letting that through at
     the edge is a browser BACK navigation, which throws away the filters
     somebody just set. */
  ["...and does not swallow the page's own scroll at either end",
    /!sideways && \(\(next <= 0 && d < 0\)/.test(rails), ""],
  ["a mouse can drag a rail",
    /drag\.box\.scrollLeft = drag\.left - dx/.test(rails), ""],
  ["...without a release over a chip counting as a click on it",
    /d\.moved >= 4/.test(rails), ""],
  ["the fade is what says there is more, and it is driven by real scroll state",
    /can-next/.test(rails) && /box\.scrollLeft < max - 2/.test(rails), ""],
  /* Section 5a: the page's non-ASCII inventory must match index.html, so a
     category glyph has to reach the file as an escape and never as a character.
     The inventory check above would catch a raw emoji; this names the cause. */
  ["category glyphs are escapes, not characters",
    rails.includes('var LEAF = "\\ud83c\\udf3f"') && rails.includes('"Edibles": "\\ud83c\\udf6c"'), ""],
  /* THE ENGINE RENAMES CATEGORIES, and keying the strip on the feed's words
     instead matched nothing while erroring nowhere: /api/coldwater says "Flower"
     and #fCategory says "THCA Flower". The picture is read off the engine's own
     card, and the glyph map answers to both vocabularies. */
  ["category pictures are keyed on the engine's own classification, not the feed's",
    /querySelectorAll\("#grid \.card\[data-cat\]"\)/.test(rails), ""],
  ["and the glyph map answers to the engine's words as well as the feed's",
    /"THCA Flower": LEAF, "Flower": LEAF/.test(rails) &&
    /"Concentrate": GEM, "Concentrates": GEM/.test(rails), ""],
  /* Both strips read "Name (12)" off an option, and both are written inside a
     template literal where a single-escaped \s silently becomes a bare "s" --
     which leaves the count glued to the name and still looks right. */
  ["the count parse survived escaping in both strips",
    rails.split('match(/^(.*?)\\s*\\((\\d+)\\)\\s*$/)').length - 1 === 2, ""],
  ["brand strip present once", railBlock("SHOP BY BRAND").length > 2000, ""],
  ["freshness stamp present once", (out.match(/id="cw-freshness"/g) || []).length === 1, ""],
  ["colour block present once", (out.match(/id="cw-colour"/g) || []).length === 1, ""],
  /* THE FEEDBACK LOOP, asserted structurally. paint() appends inside #grid, so
     observing the subtree makes every one of its own edits fire the observer.
     That is what made /coldwater unresponsive while stores loaded. Both blocks
     must watch direct children only, and must coalesce. */
  ["freshness observes childList WITHOUT subtree",
    !/subtree:\s*true/.test(out.split('id="cw-freshness"')[1].split("</script>")[0]), ""],
  ["colour observes childList WITHOUT subtree",
    !/subtree:\s*true/.test(out.split('id="cw-colour"')[1].split("</script>")[0]), ""],
  ["freshness coalesces through a frame",
    /requestAnimationFrame/.test(out.split('id="cw-freshness"')[1].split("</script>")[0]), ""],
  ["colour coalesces through a frame",
    /requestAnimationFrame/.test(out.split('id="cw-colour"')[1].split("</script>")[0]), ""],
  /* A full-grid pass every 250ms for ten seconds is its own cost on a 2,972
     product catalogue; the poll exists only to wait for the feed. */
  ["freshness stops polling once the feed lands",
    /clearInterval\(iv\); schedule\(\); return;/.test(out.split('id="cw-freshness"')[1].split("</script>")[0]), ""],

  ["colour styles present once", (out.match(/id="cw-colour-style"/g) || []).length === 1, ""],
  /* The observation is a person's word. Without the attribution it reads as the
     shop's own copy, which is the one thing this block must not do. */
  ["colour is attributed to a person, not the shop",
    /Seen in store/.test(out.split('id="cw-colour"')[1].split("</script>")[0]), ""],
  /* A note is free text from a phone in a shop and goes in via innerHTML. */
  ["colour escapes what it prints",
    /function esc\(/.test(out.split('id="cw-colour"')[1].split("</script>")[0]), ""],
  /* An empty quote box on every card would hide the ones that carry a note. */
  ["a product with no observation renders nothing",
    /if \(!col\)\{ if \(old\) old\.remove\(\); continue; \}/.test(out.split('id="cw-colour"')[1].split("</script>")[0]), ""],

  ["freshness styles present once", (out.match(/id="cw-freshness-style"/g) || []).length === 1, ""],
  /* The whole point is per-STORE granularity, so it must read the per-row asOf
     the merge stamps rather than the feed's global updated stamp. */
  ["freshness reads the row's own asOf",
    /m\.asOf/.test(out.split('id="cw-freshness"')[1].split("</script>")[0]), ""],
  /* A live adapter row carries no capturedAt and must get NO stamp -- printing
     "just now" on it would be true and would train the eye to ignore the line
     where it matters. */
  ["a row with no asOf gets no stamp",
    /if \(!m \|\| !m\.asOf\)/.test(out.split('id="cw-freshness"')[1].split("</script>")[0]), ""],
  /* The grid re-renders on every filter and sort with no hook to attach to. */
  ["freshness reapplies on mutation",
    /MutationObserver/.test(out.split('id="cw-freshness"')[1].split("</script>")[0]), ""],

  ["brand strip drives the engine's own search box, not its own filter",
    /getElementById\("q"\)/.test(railBlock("SHOP BY BRAND")), ""],
  ["deal chip present once", (out.match(/id="cw-deal"/g) || []).length === 1, ""],
  ["photo sort present once", (out.match(/id="cw-photo-last"/g) || []).length === 1, ""],
  ["lab-verified claim withdrawn", (out.match(/id="cw-lab-honesty"/g) || []).length === 1, ""],
  ["modal close fix inherited from index.html", (out.match(/id="ll-modal-close-fix"/g) || []).length === 1, ""],
  ["logo strip styles present once", /\.logorow\{/.test(railsCss) && /\.lchip\{/.test(railsCss), ""],
  /* Two independent stops on the concierge, asserted separately, because
     either one alone is a half-measure: the CSS keeps a shopper from opening
     it, the shim keeps it from answering (and from spending) if it is ever
     reached another way. If index.html renames the widget, the first of these
     fails here rather than on the live page. */
  /* THIS ASSERTION IS WHY THE BUG SURVIVED. It checked that a rule mentioning
     #ll-concierge and display:none existed -- which it did, and which hid a
     <script> tag that was never visible. It said nothing about the BUTTON the
     widget builds at runtime, so it passed for months while the widget sat in
     the corner of the page. It now names the runtime class instead. */
  ["concierge hidden by the overlay",
    /\.llc-fab[^{]*\{display:none!important\}|\.llc-fab,\.llc-panel/.test(out.replace(/\s+/g, "")) ||
    /llc-fab/.test(out.split("cw-palette")[1].split("</style>")[0]), ""],
  ["concierge requests refused by the shim", out.includes('u.indexOf("/api/concierge") === 0'), ""],
  ["concierge widget still present to hide", (out.match(/id="ll-concierge"/g) || []).length === 1, ""],
  ["meta edits applied", edits >= 7, `${edits} edits`],
  /* The inherited affiliate claim is false on this page: no Coldwater shop has a
     programme with this site and every outbound link here is untracked. */
  ["the hemp side's affiliate-commission claim is gone",
    !/may earn a commission on qualifying purchases/.test(out), ""],
  ["and a non-affiliation notice stands in its place",
    /not affiliated with, endorsed by, sponsored by or connected to any dispensary/.test(out), ""],
  ["which also names whose logos and photos these are",
    /belong to their respective owners/.test(out), ""],
  ["and the brand rail says it where the marks actually are",
    /no affiliation or endorsement/.test(rails), ""],
  ["shopping list present once", (out.match(/id="cw-list"/g) || []).length === 1, ""],
  ["the page asks for the next town", /href="\/ambassador"/.test(rails), ""],
  /* ...and asks it only where "your town" means something. The rail is shared
     with legal-leafmarket now, where that copy is addressed to nobody. */
  ["...only on a page that IS a town, which this one publishes in memory",
    /window\.LL_TOWN = \{ slug:/.test(out) && /window\.LL_TOWN \? document\.getElementById\("cwl-amb"\)/.test(rails), ""],
  ["one carousel behaviour serves every rail", railBlock("CAROUSEL BEHAVIOUR").length > 1000, ""],
  /* The brand rail inherited the arrows and the fade CSS but nothing that
     updated them, so it had the markup and none of the feel. */
  ["and it syncs every rail, not just the store strip",
    /function syncAll\(\)\{ var r = allRails\(\)/.test(rails.replace(/\s+/g, " ").replace(/\{ /g, "{")) ||
    /function syncAll/.test(rails), ""],
  ["list styles present once", (out.match(/id="cw-list-style"/g) || []).length === 1, ""],
  ["one add-button colour for every card", (out.match(/id="cw-list-button-style"/g) || []).length === 1, ""],
  ["and one wording, applied to every card rather than to gear alone",
    /querySelectorAll\("\.card \.addbtn"\)/.test(out) && /Add to Shopping List/.test(out), ""],
  /* THE LIST IS THE ENGINE'S CART, and this is the assertion that would have
     caught the feature being dead on arrival. The button every card shows is the
     engine's own .addbtn, which writes localStorage "ll_cart" -- namespaced to
     "ll_cw:<town>:ll_cart" here by cw-cart-isolate. /trip used to read
     a SECOND key, "ll_cw_list", written only by a parallel set of .cwl-add
     buttons that the one-button pass left orphaned. Both halves worked; they
     never met. Nothing errored, nothing logged, and the only symptom was an
     empty list.

     THE TOWN IS IN THE KEY, and asserting the exact spelling is what stops the
     two halves drifting apart again -- this time as two cities' jars in one
     shopping route, which reads as a bug in the list rather than in the key. */
  ["the page's list count reads the key the add button writes",
    out.indexOf('"ll_cw:' + MK.slug + ':ll_cart"') >= 0, ""],
  ["and the trip link carries this town",
    (out.match(new RegExp('/trip\\?market=' + MK.slug, "g")) || []).length >= 2, ""],
  ["the context the shared trip page resolves from names this town",
    out.indexOf('"ll_cw:ctx"') >= 0 && out.indexOf('label: "' + MK.label + '"') >= 0, ""],
  /* The old key may be NAMED in a comment -- the story of the bug is worth
     keeping. What must not survive is a read or a write against it. */
  ["and no second list key is read or written on it",
    !/Item\(\s*"ll_cw_list"/.test(out) && !/KEY\s*=\s*"ll_cw_list"/.test(out), ""],
  /* The trip page is SHARED by every city, so it cannot carry a town in its
     source the way this one does -- it builds the same key from the market it
     resolves at runtime. Assert the construction, which is the half that has to
     agree with the spelling above. */
  ["the trip page builds that same key from its resolved market",
    /"ll_cw:" \+ CTX\.slug \+ ":ll_cart"/.test(LIST), ""],
  ["...and resolves that market rather than naming one",
    /market=\(\[a-z0-9-\]\+\)/.test(LIST) && /ll_cw:ctx/.test(LIST), ""],
  ["...and does not read the hemp cart, which is what the bare key means there",
    !/getItem\("ll_cart"/.test(LIST), ""],
  /* A mix-and-match price is only true once the group is satisfied, so the
     total must not quote it early. */
  ["the trip totals at shelf until a mix group is actually satisfied",
    /g && g\.have >= g\.need && it\.unit != null/.test(LIST), ""],
  ["and exports plain text rather than needing an integration",
    /function asText\(\)/.test(LIST), ""],
  ["...a spreadsheet, a picture and a PDF as well",
    /function asCsv\(\)/.test(LIST) && /function paint\(\)/.test(LIST) && /window\.print\(\)/.test(LIST), ""],
  ["...and the picture is drawn from the same model as the page, not a library",
    /html2canvas|jspdf|cdn\./i.test(LIST) === false, ""],
  /* One list, grouped three ways, because "which shop", "which brand" and
     "what kind of thing" are the three questions a trip actually raises. */
  ["the trip groups by shop, brand and category",
    /data-mode="store"/.test(LIST) && /data-mode="brand"/.test(LIST) && /data-mode="category"/.test(LIST), ""],
  ["and Escape gets you out of it",
    /e\.key !== "Escape"/.test(LIST), ""],
  ["colour editor present once", (out.match(/id="cw-colour-admin"/g) || []).length === 1, ""],
  ["colour editor styles present once", (out.match(/id="cw-colour-admin-style"/g) || []).length === 1, ""],
  /* It must be invisible to a shopper. The gate is the same sessionStorage flag
     the console sets, re-checked rather than read once at load. */
  ["colour editor is gated on admin mode",
    /sessionStorage\.getItem\("ll_admin_ok"\)/.test(out.split('id="cw-colour-admin"')[1].split("</script>")[0]), ""],
  /* It writes annotations, never catalogue rows. A UI that could post products
     could delete a shelf; this one cannot reach that code path at all. */
  ["colour editor posts colour and never products",
    !/products:/.test(out.split('id="cw-colour-admin"')[1].split("</script>")[0]), ""],
  /* Reuses the collector's token key rather than teaching the operator to paste
     it somewhere new. */
  ["colour editor reuses the collector's token key",
    /ll_admin_token/.test(out.split('id="cw-colour-admin"')[1].split("</script>")[0]), ""],
  ["admin categories are this town's, not the hemp shelf's", catsPatched === 1, `${catsPatched} lists patched`],
  ["...and offer Vaporizers, which the hemp list omits", /var CATS=\[[^\]]*"Vaporizers"/.test(out), ""],
  ["...and no longer offer Wholesale, which does not exist here", !/var CATS=\[[^\]]*"Wholesale"/.test(out), ""],
  ["overrides pull is namespaced to this market", ovGets >= 2, `${ovGets} GET call sites`],
  ["overrides write is namespaced to this market", ovPosts === 1, `${ovPosts} POST call sites`],
  /* The failure this guards is silent in both directions: a visitor seeing the
     hemp shelf's renames on a dispensary card, and an admin edit here landing on
     the hemp shelf. */
  ["no unnamespaced /api/overrides call survives",
    !/fetch\("\/api\/overrides",/.test(out), ""],
  /* THE OUTCOME, NOT THE ACTION, and scoped to what this was ever about.
     It asserted svgHits > 0 -- that this generator had CHANGED some lines --
     which held only while index.html was still green. The palette is backported
     now, so the source is already cold and the loop correctly does nothing;
     asserting the edit count would have failed the build for the change
     succeeding.
     Scoped to SVG ATTRIBUTES because the first rewrite was not: a bare search
     for the green caught .cw-asof .cw-dot, which is a STATUS colour -- green is
     fresh, amber is stale -- and has nothing to do with branding. A palette
     check that swallows a status light is how a stale badge quietly turns the
     wrong colour. */
  ["no leaf green survives in the nav glyphs",
    !/(stroke|fill)="#4ade80"/.test(out), svgHits + " lines recoloured here"],
  ["override sits AFTER the base stylesheet", headIdx > mainStyleIdx, `head ${headIdx} > style ${mainStyleIdx}`],
];

let bad = 0;
for (const [name, pass, extra] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${extra ? "   (" + extra + ")" : ""}`);
  if (!pass) bad++;
}
if (bad) { console.error(`\n${bad} check(s) failed — not writing.`); process.exit(1); }

if (CHECK) {
  if (!existsSync(OUT)) { console.error(`\n--check: ${OUT} missing`); process.exit(1); }
  const cur = readFileSync(OUT, ENC);
  if (cur !== out) { console.error(`\n--check: ${OUT} is stale, re-run without --check`); process.exit(1); }
  console.log(`\n${OUT} is up to date with ${SRC}.`);
} else {
  writeFileSync(OUT, Buffer.from(out, ENC));
  console.log(`\nwrote ${OUT} — ${Buffer.byteLength(out, ENC)} bytes, engine blob copied verbatim.`);
}

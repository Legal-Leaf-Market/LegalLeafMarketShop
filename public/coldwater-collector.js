/* coldwater-collector.js — read the menu you are looking at, send it to your own site.
 *
 * WHAT THIS IS. A bookmarklet / userscript that runs in YOUR browser, on a
 * dispensary page you have open, and posts what is on screen to
 * /api/coldwater/ingest. It automates "copy the menu I am looking at".
 *
 * WHY IT EXISTS. Dutchie and Jane answer a server-side request with a Cloudflare
 * challenge. That challenge is there to tell a script from a person -- and a
 * person looking at a dispensary menu is exactly who the page is for. So instead
 * of pretending to be a browser from a server, this IS a browser, driven by the
 * person the page was served to. Nothing is bypassed, because nothing was
 * denied: the page rendered.
 *
 * It does not touch anything it was not shown. No hidden endpoints, no tokens
 * lifted from the host page, no requests the page did not already make. It reads
 * rendered state and posts it to your own API with your own admin token.
 *
 * ── INSTALL: BOOKMARKLET ────────────────────────────────────────────────────
 * Make a bookmark whose URL is:
 *
 *   javascript:(function(){var s=document.createElement('script');
 *   s.src='https://legal-leafmarket.com/coldwater-collector.js?'+Date.now();
 *   document.body.appendChild(s);})();
 *
 * Open a dispensary menu, let it finish loading, click the bookmark.
 *
 * ── INSTALL: USERSCRIPT (Tampermonkey / Violentmonkey) ──────────────────────
 * Same file, with a header. Auto-runs and adds the button itself:
 *
 *   // ==UserScript==
 *   // @name         Legal-Leaf Coldwater collector
 *   // @match        https://dutchie.com/*
 *   // @match        https://*.dispensary.shop/*
 *   // @match        https://www.lume.com/*
 *   // @match        https://banzencoldwater.com/*
 *   // @match        https://www.shophcc.com/*
 *   // @match        https://greentreerelief.com/*
 *   // @require      https://legal-leafmarket.com/coldwater-collector.js
 *   // ==/UserScript==
 *
 * ── THE THREE WAYS A MENU HIDES, AND THEY ARE NOT THE SAME ──────────────────
 * Each of these was diagnosed from a real Coldwater shop, and each needs a
 * different response. Confusing them costs an evening, which is how this list
 * was written.
 *
 *   CROSS-ORIGIN IFRAME (Dutchie on a shop's own site). The same-origin policy
 *   means a bookmarklet on sapuralife.com cannot read inside it. Not a bug to
 *   work around: open the frame's own URL in a tab (right-click the menu ->
 *   "This Frame" -> "Open Frame in New Tab", or go straight to
 *   dutchie.com/embedded-menu/<id>) and run it there.
 *
 *   SHADOW DOM (Jane, at Green Tree Relief). The menu is a web component, so
 *   its cards live in a shadow root and document.querySelectorAll does not
 *   reach them. There is NO IFRAME to open -- hunting for one finds nothing and
 *   wastes the time. Open roots are traversed here; a closed one is the page
 *   saying no, and is reported as such.
 *
 *   COMPONENT STATE (Dutchie, Flowhub). Nothing in the markup and nothing on a
 *   global: the menu is a React hook value on a component above the DOM nodes.
 *   Read by walking the fiber tree, the same thing React devtools does.
 */
(function () {
  "use strict";

  /* A FLAG THE LOADER CAN SEE. Plenty of dispensary sites ship a
     Content-Security-Policy that forbids a script from another origin, and when
     one does, the injected <script> simply never runs: no error the bookmarklet
     can catch, no panel, nothing. The operator clicks the bookmark and the page
     sits there, which reads as "the collector is broken" rather than "this site
     blocked it". So the loader waits for this flag and says which of the two
     happened. Set FIRST, before any work that could throw. */
  try { window.__LL_COLLECTOR__ = "1"; } catch (e) {}

  /* POST BACK TO WHEREVER THIS FILE CAME FROM, not to a baked-in hostname.
     document.currentScript is the tag the loader just injected, so a collector
     served from a Vercel preview posts to that preview and a collector served
     from production posts to production. Hardcoding the live origin meant every
     test capture landed in the live catalogue, which is the wrong default for a
     tool whose entire job is writing to the shelf. Pasted into a console there
     is no currentScript, so production stays the fallback. */
  /* WHICH SHELF THIS CAPTURE BELONGS TO. Read off the script's own query
     string, so one collector serves both markets and the bookmarklet decides:
     ?market=llm writes to the national mail-order hemp feed behind
     /api/products, anything else writes to the Coldwater dispensary shelf.

     DEFAULTS TO COLDWATER on purpose. Every bookmarklet already installed
     carries no market at all, and it must keep writing exactly where it always
     has -- a capture landing on the wrong shelf is the same class of mistake as
     the two pages sharing one cart, and it would be discovered by a shopper
     rather than by us. */
  /* PASTED SOURCE HAS NO document.currentScript, and both of the things read
     off it matter: which shelf the capture lands on, and which origin it is
     sent to. Console paste is the method the install page RECOMMENDS under a
     strict CSP -- so the one path most likely to be used on a difficult shop
     was also the one that silently defaulted to the Coldwater shelf and to
     production, whatever page the operator copied it from.

     So an explicit override is honoured first. The install page's "Copy
     collector source" button prepends one line setting it, which makes a
     pasted collector carry the same market and origin as the bookmarklet built
     on that same page. Nothing else sets it, and a bookmarklet ignores it,
     because currentScript is there and wins. */
  function selfSrc() {
    try {
      if (document.currentScript && document.currentScript.src) return document.currentScript.src;
    } catch (e) {}
    try { return window.__LL_COLLECTOR_SRC__ || ""; } catch (e) { return ""; }
  }
  /* THE MARKET IS A SLUG NOW, NOT A COIN FLIP. This used to read "llm or
     coldwater", collapsing every other value to the pilot -- so the first
     bookmarklet built for a second city would have captured that city's menus
     into COLDWATER's namespace. Silent, and found by a shopper rather than by
     us: exactly the class of mistake the two-pages-one-cart bug was.

     "llm" keeps its special meaning (the national mail-order hemp feed behind
     /api/products); anything else is a city slug and is passed through as
     given. An unknown slug is safe because the server resolves it through the
     one registry -- marketKey() falls back to the default rather than minting a
     namespace nobody can find again. Absent still means coldwater, because
     every bookmarklet already installed carries no market at all and must keep
     writing exactly where it always has. */
  /* THE PARAMETER IS NOW A FALLBACK, NOT THE ANSWER. It stays exactly as it
     was -- every bookmarklet already installed carries one and must keep
     working -- but the SHOP decides, because a shop cannot be wrong about which
     city it is in and a bookmarklet saved last week can. See MARKET below. */
  var MARKET_PARAM = (function () {
    try {
      var me = selfSrc();
      var m = me && me.match(/[?&]market=([a-z0-9-]+)/i);
      return m ? m[1].toLowerCase() : "";
    } catch (e) { return ""; }
  })();
  var MARKET = MARKET_PARAM || "coldwater";
  var API = (function () {
    try {
      var me = selfSrc();
      if (me) return new URL(me).origin + "/api/coldwater/ingest";
    } catch (e) {}
    return "https://legal-leafmarket.com/api/coldwater/ingest";
  })();
  var TOKEN_KEY = "ll_admin_token";      // sessionStorage, this tab only
  var STORE_KEY = "ll_collector_store";  // remembered between runs

  /* ---------------------------------------------------------- extraction --- */

  /* Platform-agnostic on purpose. Rather than a selector per site -- which
     breaks the first time anyone ships a redesign -- walk the page's own
     JavaScript state and look for arrays of things that LOOK like products: an
     object carrying a name and a price. That one rule already covers every
     Next.js storefront here (Lume, Flowhub, Tymber) plus anything else that
     server-renders its state, and it degrades to the DOM scan below when a page
     keeps its data somewhere unreachable. */
  var NAME_KEYS  = ["name", "productName", "title", "Name", "product_name"];
  var PRICE_KEYS = ["price", "prices", "centAmount", "priceMed", "displayPrice", "price_med", "amount", "cost"];

  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) if (o[keys[i]] != null) return o[keys[i]];
    return null;
  }
  /* Variant arrays, by every name these platforms give them. */
  function variantsOf(o) {
    /* `Options` IS CAPITALISED ON DUTCHIE, and the lowercase spelling alone meant
       a listing priced purely per weight -- Options ["1g","1/8oz","1oz"] with
       recPrices alongside and no top-level price -- had no variants at all, so
       it fell through to the single "One Size" row this list exists to prevent.
       Both spellings, because a key name is the platform's choice and not ours. */
    var keys = ["variants", "sizes", "options", "Options", "weights", "Weights",
                "variations", "priceTiers"];
    for (var i = 0; i < keys.length; i++) if (Array.isArray(o[keys[i]]) && o[keys[i]].length) return o[keys[i]];
    if (o.POSMetaData && Array.isArray(o.POSMetaData.children) && o.POSMetaData.children.length) return o.POSMetaData.children;
    return null;
  }
  /* A PRICE ARRAY RUNNING ALONGSIDE A LABEL ARRAY, which is how several of these
     menus serialise a size selector: options:["1g","3.5g"] and prices:[12,35].
     Only accepted at the SAME LENGTH -- an off-by-one here prices an ounce at an
     eighth's price, which is the worst wrong number this site can print. */
  var PARALLEL_KEYS = ["prices", "Prices", "recPrices", "medPrices", "priceList",
                       "variantPrices", "optionPrices"];
  function parallelPrices(o, n) {
    for (var i = 0; i < PARALLEL_KEYS.length; i++) {
      var v = o[PARALLEL_KEYS[i]];
      if (Array.isArray(v) && v.length === n) return v;
    }
    return null;
  }
  /* A SALE-PRICE ARRAY RUNNING ALONGSIDE THE PRICE ARRAY, which is how all of
     these platforms ship a discount: Options ["1g","1/8oz"], recPrices [12,30],
     recSpecialPrices [11.4,28.5]. Measured on Sapura, where one bulk flower
     listing carries six weights and six discounted prices.

     THIS WAS THE WHOLE GAP, and it is worth being precise about how narrow it
     is. Everything downstream already exists and has for some time: the ingest
     sanitiser keeps `sizes[].sale`, row() writes it into slot 7, toProduct()
     reads slot 7 as a real unit price, sets dealBasis "sale price", and folds it
     into perG while shelfPerG keeps the list price. The object-variant branch
     below even reads v.specialPrice. The ONLY thing missing was this shape --
     and the shape is what Dutchie uses, so `sale` came back null on every row of
     every shop, and the site ranked a discounted product at its list price.

     SAME LENGTH ONLY, for exactly the reason parallelPrices() insists on it. An
     off-by-one here does not merely misprice: it prints a DISCOUNT that is not
     real, which is the one number on this site nobody would think to check.

     AND IT MUST BE STRICTLY LOWER. Several menus leave the array populated after
     a promo ends; "was $12, now $12" reads as a bug to a shopper and as
     something worse to a regulator. */
  var SALE_PARALLEL_KEYS = ["recSpecialPrices", "specialPrices", "medicalSpecialPrices",
                            "medSpecialPrices", "salePrices", "discountedPrices",
                            "specialPriceList"];
  function parallelSalePrices(o, n) {
    for (var i = 0; i < SALE_PARALLEL_KEYS.length; i++) {
      var v = o[SALE_PARALLEL_KEYS[i]];
      if (Array.isArray(v) && v.length === n) return v;
    }
    return null;
  }
  var SINGLE_SALE_KEYS = ["specialPrice", "salePrice", "discountedPrice", "recSpecialPrice",
                          "special_price", "sale_price"];
  /* "3.5g - $35", "Ounce $170" -- a label and a price in one string. */
  function splitLabelPrice(s) {
    var m = String(s).match(/^(.*?)[\s\-|:\u2013\u2014]*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
    if (!m || !m[1].trim()) return null;
    var p = money(String(m[2]).replace(/,/g, ""));
    if (p == null) return null;
    return { label: m[1].replace(/[\s\-|:]+$/, "").trim(), price: p };
  }
  /* Jane states each weight as its own FIELD and ships no variant array at all,
     which is why Green Tree Relief came through with one option per listing. Same
     labels and grams api/coldwater.js uses for its Jane adapter, so a captured
     Jane menu and a scraped one agree. */
  var JANE_FIELDS = [
    ["half_gram", "0.5 g"], ["gram", "1 g"], ["two_gram", "2 g"],
    ["eighth_ounce", "Eighth \u00b7 3.5 g"], ["quarter_ounce", "Quarter \u00b7 7 g"],
    ["half_ounce", "Half \u00b7 14 g"], ["ounce", "Ounce \u00b7 28 g"]
  ];
  function looksLikeProduct(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    var n = pick(o, NAME_KEYS);
    if (typeof n !== "string" || n.length < 2 || n.length > 200) return false;
    if (pick(o, PRICE_KEYS) != null) return true;
    /* A PRICE IN THE VARIANTS COUNTS -- see the matching note on gIsProduct() in
       api/coldwater.js. A flower listing priced per weight has no top-level
       price, and rejecting it here made a readable menu report as unreadable. */
    var vs = variantsOf(o);
    if (!vs) return false;
    for (var j = 0; j < vs.length; j++) {
      if (vs[j] && typeof vs[j] === "object" && pick(vs[j], PRICE_KEYS) != null) return true;
    }
    /* A LABEL ARRAY WITH ITS PRICES ALONGSIDE is a priced product too, and this
       test used to require the price to be ON the variant -- so Dutchie's
       Options ["1g","1/8oz","1oz"] + recPrices [12,30,210], with no price on the
       object and none on any variant, failed every branch above and the listing
       was rejected outright. normalise() has understood that shape for a long
       time; nothing ever reached it. Same same-length rule as everywhere else,
       so a ragged pair still does not qualify. */
    if (parallelPrices(o, vs.length)) return true;
    /* The price inside the label ("3.5g - $35") is a price too. */
    for (var k = 0; k < vs.length; k++) {
      if (typeof vs[k] === "string" && splitLabelPrice(vs[k])) return true;
    }
    return false;
  }

  /* Money turns up as dollars, as cents, and as a {centAmount, currency} object.
     Guessing wrong by 100x is the failure that would poison the whole feed, so
     an explicit minor-unit field wins, then an object, then a bare number -- and
     a bare integer over 1000 is read as cents because no dispensary sells a
     $1,200 eighth. */
  function money(v) {
    if (v == null) return null;
    if (typeof v === "object") {
      if (v.centAmount != null) {
        var d = v.fractionDigits != null ? v.fractionDigits : (v.currency_minor_unit != null ? v.currency_minor_unit : 2);
        return Number(v.centAmount) / Math.pow(10, d);
      }
      for (var k in v) if (typeof v[k] === "number" || typeof v[k] === "string") { var m = money(v[k]); if (m != null) return m; }
      return null;
    }
    var n = Number(String(v).replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n <= 0) return null;
    return (Number.isInteger(n) && n > 1000) ? n / 100 : n;
  }

  /* DELIBERATE TWIN of gramsOf() in api/coldwater.js -- a static file served
     onto a dispensary's origin cannot import from api/. Change one, change the
     other, or the browser and the server will disagree about what a size is. */
  /* Every weight a label states, fraction-aware, so the guard below can tell one
     weight stated twice ("3.5g (1/8 oz)") from a whole selector read as one
     option ("1g 3.5g 7g 14g 28g"). Twin of weightsIn() in api/coldwater.js. */
  function weightsIn(s) {
    var out = [], rest = String(s);
    rest = rest.replace(/(\d+)\s*\/\s*(\d+)\s*(?:oz\b|ounces?\b)/g, function (all, n, d) {
      if (+d) out.push((+n / +d) * 28); return " ";
    });
    rest = rest.replace(/(\d+)\s*\/\s*(\d+)\s*(?:g\b|grams?\b)/g, function (all, n, d) {
      if (+d) out.push(+n / +d); return " ";
    });
    rest.replace(/([\d.]*\.?\d+)\s*(?:g\b|grams?\b)/g, function (all, n) { out.push(parseFloat(n)); return " "; });
    rest.replace(/([\d.]*\.?\d+)\s*(?:oz\b|ounces?\b)/g, function (all, n) { out.push(parseFloat(n) * 28); return " "; });
    return out.filter(function (n) { return isFinite(n) && n > 0; });
  }

  /* "N x Wg" -- a count times the weight of EACH, so the packet is the product of
     the two. NaN means "this is a pack and its arithmetic is not believable",
     which is different from 0 meaning "not this form". Twin of packEach(). */
  function packEach(s) {
    var W = "(?:(\\d+)\\s*\\/\\s*(\\d+)|([\\d.]*\\.?\\d+))\\s*(?:g\\b|grams?\\b)";
    var val = function (n, d, plain) { return d ? (+d ? +n / +d : 0) : parseFloat(plain); };
    var total = function (n, w) { return (n > 0 && n <= 50 && w > 0 && n * w <= 224) ? n * w : NaN; };
    var m = String(s).match(new RegExp("(\\d{1,3})\\s*(?:x|\u00d7)\\s*" + W, "i"));
    if (m) return total(parseInt(m[1], 10), val(m[2], m[3], m[4]));
    m = String(s).match(new RegExp(W + "\\s*(?:x|\u00d7)\\s*(\\d{1,3})\\b", "i"));
    if (m) return total(parseInt(m[4], 10), val(m[1], m[2], m[3]));
    return 0;
  }

  function grams(label) {
    var s = String(label || "").toLowerCase().trim();
    if (!s) return 0;

    /* A LABEL STATING SEVERAL DIFFERENT WEIGHTS STATES NONE OF THEM. One price
       cannot be attributed to five weights, and the first of them is not the
       answer -- which is what every rule below would return. The same weight
       written twice is not ambiguous, so this compares values. */
    var seen = weightsIn(s);
    if (seen.length > 1 && (Math.max.apply(null, seen) - Math.min.apply(null, seen)) > 0.01) return 0;

    /* THE "EACH" PACK FORM, before the fraction rules because "2 x 1/2 g" IS a
       fraction and read fraction-first comes back as the weight of one of the two
       things in the packet. "10pk 3.5g" needs no rule: it states the weight of the
       PACKAGE, which rule 6 returns as it stands. */
    var each = packEach(s);
    if (isNaN(each)) return 0;
    if (each) return each;

    /* ORDER IS THE WHOLE BUG. "1/8 oz" used to reach the ounce rule first, whose
       [\d.]+ happily matched the 8 AFTER the slash -- eight ounces, 224 g, and a
       $10 eighth published at four cents a gram. Fractions must be read as
       fractions before any bare number is read as a quantity. */

    /* 1. A fraction of an ounce, written as one: "1/8 oz", "1/2oz". */
    var m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:oz\b|ounce)/);
    if (m) { var n = +m[1], d = +m[2]; if (d) return (n / d) * 28; }

    /* 2. A fraction of a gram, same trap in the other unit. */
    m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:g\b|gram)/);
    if (m) { var n = +m[1], d = +m[2]; if (d) return n / d; }

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
       Inside the 0.25-1000 sanity bounds, so nothing catches it downstream -- a
       confident wrong number, which is worse than none.

       A pound is 16 of the 28 g ounces this file already uses, not 453.59.
       Internal consistency beats metric precision: every figure on the shelf is
       comparable to every other, which is the only thing the number is for. */
    m = s.match(/(\d+)\s*\/\s*(\d+)\s*(?:lbs?\b|pounds?\b)/);
    if (m) { var pn = +m[1], pd = +m[2]; if (pd) return (pn / pd) * 448; }
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
    if (m) { var n = +m[1], d = +m[2]; if (d) return (n / d) * 28; }

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

  /* IMAGES GO MISSING IN MORE WAYS THAN THEY ARRIVE. Across these platforms the
     picture turns up as a bare string, as {url}/{src}, as an array of either, and
     under half a dozen key names; and the URL itself is as often protocol-relative
     (//images.dutchie.com/...) or root-relative (/media/x.jpg) as absolute. Every
     one of those that is not handled here becomes a card with no picture and no
     error -- which is what a Sapura product with a perfectly good photo on
     Dutchie looked like. */
  var IMG_KEYS = ["image", "imageUrl", "Image", "img", "thumbnail", "thumbnailUrl",
                  "primaryImage", "featuredImage", "picture"];
  var IMG_LISTS = ["images", "imageUrls", "productImages", "photos", "assets", "media"];

  function imgUrl(v) {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (typeof v !== "object") return "";
    if (Array.isArray(v)) { for (var a = 0; a < v.length; a++) { var u = imgUrl(v[a]); if (u) return u; } return ""; }
    return imgUrl(v.url || v.src || v.original || v.large || v.medium ||
                  (v.urls && (v.urls.original || v.urls.large)) || "");
  }

  function absolutise(u) {
    u = String(u || "").trim();
    if (!u) return "";
    /* Protocol-relative is a real URL that simply fails an ^https?: test, and
       silently dropping it is the single likeliest way a picture disappears. */
    if (u.indexOf("//") === 0) return location.protocol + u;
    if (u.charAt(0) === "/") return location.origin + u;
    if (/^https?:\/\//i.test(u)) return u;
    return "";                       // data: URIs and junk stay out
  }

  /* A CHEVRON IS NOT A PRODUCT PHOTO.
     Black Tie's subscription shipped with `chevron-down.svg` off the shop's own
     navigation as its picture -- a UI arrow, from a Webflow CDN, sitting where
     four real product shots should have been. The card looked broken and the
     cause was upstream of every layer: whatever this function returns IS the
     photo, and nothing asked whether it looked like one.
     TWO REFUSALS, both narrow on purpose (precision over recall, the same rule
     isNonConsumable() states -- a missed photo costs a placeholder, a wrong one
     puts furniture on the shelf):
       SVG. Menus serve product photography as raster. An .svg on one of these
       pages is an icon, a logo or a spinner essentially without exception.
       UI WORDS IN THE FILENAME. chevron, caret, arrow, sprite and friends, which
       is what a lazy DOM read picks up when a card's first <img> is a control.
     Both test the PATH only, so a product legitimately called "Arrow" keeps its
     photo -- the word has to be in the file name, not in the product's. */
  var UI_IMG = /(^|[\/_-])(chevron|caret|arrow|sprite|spinner|loader|logo|icon|favicon|badge|placeholder|blank|spacer|pixel|1x1)([._-]|$)/i;
  function looksLikeUi(u) {
    var path = String(u || "");
    try { path = new URL(u, location.href).pathname; } catch (e) {}
    if (/\.svgx?($|\?)/i.test(path)) return true;
    var file = path.split("/").pop() || "";
    return UI_IMG.test(file);
  }

  function imageOf(o) {
    var i, u;
    for (i = 0; i < IMG_KEYS.length; i++) { u = absolutise(imgUrl(o[IMG_KEYS[i]])); if (u && !looksLikeUi(u)) return u; }
    for (i = 0; i < IMG_LISTS.length; i++) { u = absolutise(imgUrl(o[IMG_LISTS[i]])); if (u && !looksLikeUi(u)) return u; }
    return "";
  }

  /* The rendered-page layer has its own problem: menu images are lazy-loaded, so
     before a card scrolls into view its <img> may carry a 1x1 placeholder, an
     empty src, or nothing but data-src. Reading .src alone captures the
     placeholder and the card ships with a grey square. */
  function imgFromEl(c) {
    /* EVERY <img> ON THE CARD, NOT THE FIRST ONE. This read querySelector("img")
       and stopped there, which is fine until the first image is a control -- a
       chevron, a wishlist heart, a sale ribbon -- and then the card either
       shipped with furniture as its photo or, once the refusal below was added,
       with nothing at all. The real product shot is usually the second or third.
       Capped, because a card with fifty images is a page that was mistaken for a
       card and the cardFor() guard is the thing to fix, not this loop. */
    var ims = c.querySelectorAll ? c.querySelectorAll("img") : [];
    for (var q = 0; q < ims.length && q < 8; q++) {
      var im = ims[q];
      var cand = [im.currentSrc, im.getAttribute("src"), im.getAttribute("data-src"),
                  im.getAttribute("data-lazy-src"), im.getAttribute("data-original")];
      var ss = im.getAttribute("srcset") || im.getAttribute("data-srcset");
      if (ss) cand.push(String(ss).split(",")[0].trim().split(/\s+/)[0]);
      for (var k = 0; k < cand.length; k++) {
        var u = String(cand[k] || "");
        if (!u || u.indexOf("data:") === 0) continue;      // inline placeholder
        if (/(^|\/)(blank|placeholder|spacer|1x1)\.(gif|png|svg)/i.test(u)) continue;
        var abs = absolutise(u);
        if (abs && !looksLikeUi(abs)) return abs;
      }
    }
    /* Some menus paint the photo as a CSS background rather than an <img>. */
    var bgEl = c.querySelector("[style*='background-image']") ||
               (String(c.getAttribute && c.getAttribute("style") || "").indexOf("background-image") > -1 ? c : null);
    if (bgEl) {
      var m = String(bgEl.getAttribute("style") || "").match(/url\(["']?([^"')]+)/);
      if (m) return absolutise(m[1]);
    }
    /* A background painted by a STYLESHEET CLASS rather than an inline style.
       The test above reads the style ATTRIBUTE, so it cannot see it -- that is a
       fifth way a photo goes missing, alongside the protocol-relative URL, the
       key name, the {url} wrapper and the lazy placeholder. getComputedStyle
       costs a layout read, so it is tried on the card and a few descendants
       rather than the subtree. */
    try {
      var pool = [c].concat(Array.prototype.slice.call(c.querySelectorAll("*"), 0, 12));
      for (var q = 0; q < pool.length; q++) {
        var bg = window.getComputedStyle(pool[q]).backgroundImage;
        if (!bg || bg === "none") continue;
        var mm = String(bg).match(/url\(["']?([^"')]+)/);
        if (!mm || String(mm[1]).indexOf("data:") === 0) continue;
        var ab = absolutise(mm[1]);
        if (ab) return ab;
      }
    } catch (e) { /* detached node, or a page that refuses computed style */ }
    return "";
  }

  /* COA CAPTURE. api/products.js has detected lab-report assets on the hemp side
     since the beginning (isCoaUrl); the dispensary side captured none, so the
     engine's "view COA" link could never appear on a Coldwater card even where
     the shop publishes one. Same word list, deliberately, so the two surfaces
     agree about what a lab result looks like.

     A Michigan package also carries a state track-and-trace (Metrc) tag, which
     is the only durable key a lab result can be joined on -- names drift and
     prices change, but a tag is the package. batchName is already carried; this
     adds the document it points at when the shop links one. */
  var COA_WORDS = /coa|certificate[\W_]*of[\W_]*analysis|lab[\W_]*(?:result|report)|test[\W_]*result|potency[\W_]*report/i;
  var COA_KEYS = ["coa", "coaUrl", "labResult", "labResults", "labReport",
                  "certificateOfAnalysis", "testResults", "labResultUrl"];

  function coaOf(o) {
    var i, u;
    for (i = 0; i < COA_KEYS.length; i++) {
      u = absolutise(imgUrl(o[COA_KEYS[i]]));      // same unwrapping as images
      if (u) return u;
    }
    /* Some menus expose it only as one of the product's links. */
    var links = o.links || o.documents || o.attachments;
    if (Array.isArray(links)) {
      for (i = 0; i < links.length; i++) {
        var l = links[i] || {};
        var href = absolutise(imgUrl(l.url || l.href || l));
        if (href && (COA_WORDS.test(href) || COA_WORDS.test(String(l.title || l.name || "")))) return href;
      }
    }
    return "";
  }

  /* On the rendered page a COA is an anchor whose text or href says so. */
  function coaFromEl(c) {
    var as = c.querySelectorAll ? c.querySelectorAll("a[href]") : [];
    for (var i = 0; i < as.length; i++) {
      var h = as[i].getAttribute("href") || "";
      if (COA_WORDS.test(h) || COA_WORDS.test(as[i].textContent || "")) {
        var abs = absolutise(h);
        if (abs) return abs;
      }
    }
    return "";
  }

  /* DEALS, AND WHY THEY ARE NOT COSMETIC. Sapura's carts run on multi-buy
     offers -- "5 for $100", "buy 10 for $150", mix-and-match. A comparison site
     that reads the shelf price and ignores the offer publishes $25 each for
     something the shopper pays $20 for, and the per-gram figure that is the
     whole point of this site is then wrong on exactly the products people came
     for. Capturing the words is the minimum; where the platform states a
     discounted price as a field, that is captured too.

     Deliberately NOT parsed into arithmetic here. "5 for $100" is unambiguous,
     "buy 2 get 1" is not (is the free one the cheapest? same size?), and
     inventing a per-gram number from a rule we guessed at is worse than showing
     the offer and letting the shopper read it. */
  var DEAL_WORDS = /(\b\d+\s*for\s*\$?\d+)|(\bbuy\s*\d+\s*(get|for)\b)|(\b\d+\s*%\s*off)|(\bBOGO\b)|(\bmix\s*(and|&|n)\s*match\b)|(\bdeal\b)|(\bspecial\b)|(\bsale\b)|(\bbundle\b)/i;
  var DEAL_KEYS = ["deal", "deals", "special", "specials", "promotion", "promotions",
                   "discount", "discounts", "offer", "offers", "specialName", "promoText"];

  function dealText(v, depth){
    if (v == null || (depth || 0) > 3) return "";
    if (typeof v === "string") return DEAL_WORDS.test(v) ? v.trim().slice(0, 120) : "";
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length && i < 20; i++) { var r = dealText(v[i], (depth || 0) + 1); if (r) return r; }
      return "";
    }
    if (typeof v === "object") {
      /* A named offer object: take its label rather than stringifying it. */
      var lab = v.title || v.name || v.label || v.description || v.text;
      if (typeof lab === "string" && lab.trim()) return lab.trim().slice(0, 120);
      for (var k in v) { var r2 = dealText(v[k], (depth || 0) + 1); if (r2) return r2; }
    }
    return "";
  }

  /* THE PLATFORM ALREADY WROTE THE SENTENCE. Dutchie states its promotions two
     levels down, in specialData.saleSpecials[].specialName and
     .bogoSpecials[].specialName -- "5/$25 1g Play 510 Carts", "BOGO 1.25g
     TrapHouse Bubble Hash infused PR", "15% Off Bulk Flower (Over 2 Ounces)".
     Those are the shop's own words, written to be read by a shopper, so they
     beat anything a regex could reconstruct from a price grid, and they carry
     the CONDITION -- which is the part a bare percentage loses and the part that
     decides whether the number we print is honest.

     dealOf() only ever looked at top-level deal-ish keys, so Sapura published 4
     deals out of ~90 running and Exclusive 1 out of ~90. Both are Dutchie, so
     this one function is most of both shops.

     BOGO BUCKET FIRST. A product in both buckets is on a percentage sale AND in
     a bundle; the bundle is the one that changes what you have to buy, so it is
     the one worth the badge. The rest are COUNTED, not concatenated -- Dutchie's
     own UI says "+1" rather than printing both, and a card is not an essay. */
  function dutchieSpecialNames(o) {
    var sd = o && o.specialData, out = [], i, arr, b, nm;
    if (!sd || typeof sd !== "object") return out;
    for (b = 0; b < 2; b++) {
      arr = b === 0 ? sd.bogoSpecials : sd.saleSpecials;
      if (!Array.isArray(arr)) continue;
      for (i = 0; i < arr.length && out.length < 6; i++) {
        nm = arr[i] && (arr[i].specialName || arr[i].menuDisplayName || arr[i].name);
        nm = typeof nm === "string" ? nm.trim() : "";
        if (nm && out.indexOf(nm) < 0) out.push(nm);
      }
    }
    return out;
  }

  function dealOf(o){
    /* Structured first: reading the platform's own field beats scanning text. */
    var names = dutchieSpecialNames(o);
    if (names.length) {
      return (names[0] + (names.length > 1 ? " +" + (names.length - 1) : "")).slice(0, 120);
    }
    for (var i = 0; i < DEAL_KEYS.length; i++) {
      var d = dealText(o[DEAL_KEYS[i]], 0);
      if (d) return d;
    }
    /* A POS discount name is thinner than a special name but is still the shop
       saying which promotion applied, rather than us inferring one. */
    if (Array.isArray(o.posDiscountNames) && o.posDiscountNames.length) {
      var pd = String(o.posDiscountNames[0] || "").trim();
      if (pd) return pd.slice(0, 120);
    }
    return "";
  }

  /* On a rendered card the offer is just a line of text among the others -- and
     that is exactly why it needs two guards it did not have.

     NEVER THE PRODUCT'S OWN NAME. The card's biggest line is its title, so any
     product whose name happens to contain "special", "deal" or "sale" nominates
     itself. Banzen published "North Coast | Heady Tropper | TIER 3 Special Sauce
     Rosin | 1g" as a DEAL, because Special Sauce is a strain. The badge rendered
     the product name twice, which reads as a rendering bug and so gets debugged
     in the wrong file entirely.

     AND A DEAL HAS TO SAY SOMETHING ABOUT PRICE. Every real promotion in this
     town names a quantity, a percentage or an amount: "30% Off", "2/$60", "$5
     Prerolls", "BOGO". A phrase carrying none of those is prose that happened to
     contain a keyword. This costs nothing real -- a deal a shopper cannot price
     is not one we should be printing a number next to. */
  function dealFromText(t, name){
    var lines = String(t || "").split("\n");
    var n = String(name || "").trim().toLowerCase();
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i].trim();
      if (!(L.length > 2 && L.length < 120 && DEAL_WORDS.test(L) && !/^\$/.test(L))) continue;
      var l = L.toLowerCase();
      if (n && (l === n || n.indexOf(l) >= 0 || l.indexOf(n) >= 0)) continue;
      if (!/(\d+\s*%)|(\$\s*\d)|(\d+\s*\/\s*\$?\d)|(\bbogo\b)|(\bbuy\s+\d)|(\bfree\b)/i.test(L)) continue;
      return L;
    }
    return "";
  }

  /* NOTHING IN THE FEED WAS EVER OUT OF STOCK. Measured across the live feed:
     2,567 products and 3,160 size rows, zero marked sold out, at six
     dispensaries. That is not a statistic about Coldwater, it is a field nobody
     read -- the rendered-page and printed-text layers hard-coded `inStock: true`,
     and the object read checked two key names out of the dozen these menus use.

     It is the worst failure this tool can have. A wrong price is an argument at
     the counter; a sold-out ounce published as available is a drive across town
     for something that is gone, and the site ASSERTED it was there. Same rule as
     the hemp side's anyInStock(): unknown means live, because treating unknown as
     sold out empties the shelf -- but a shop that SAYS sold out must be believed. */
  var OOS_TEXT = /\b(sold\s*out|out\s*of\s*stock|unavailable|no\s*longer\s*available)\b/i;
  function stockOf(o) {
    if (!o || typeof o !== "object") return true;
    var i, k, v;
    var FALSEY = ["soldOut", "sold_out", "isSoldOut", "outOfStock", "out_of_stock"];
    for (i = 0; i < FALSEY.length; i++) if (o[FALSEY[i]] === true) return false;
    var TRUTHY = ["inStock", "in_stock", "is_in_stock", "isInStock", "available",
                  "isAvailable", "purchasable", "is_purchasable"];
    for (i = 0; i < TRUTHY.length; i++) if (o[TRUTHY[i]] === false) return false;
    /* A quantity of zero is the shop stating it plainly. A MISSING quantity is
       not an answer and must not be read as one. */
    var QTY = ["quantity", "quantityAvailable", "stock", "stockQuantity", "inventory",
               "inventoryQuantity", "available_quantity"];
    for (i = 0; i < QTY.length; i++) {
      v = o[QTY[i]];
      if (typeof v === "number" && isFinite(v) && v <= 0) return false;
    }
    var STATE = ["status", "availability", "stockStatus", "stock_status", "inventoryStatus"];
    for (i = 0; i < STATE.length; i++) {
      k = o[STATE[i]];
      if (typeof k !== "string" || !k) continue;
      if (OOS_TEXT.test(k)) return false;
      if (/^(inactive|archived|draft|hidden|disabled)$/i.test(k.trim())) return false;
    }
    return true;
  }

  /* THE BRAND WAS BEING STRINGIFIED AS AN OBJECT, and it reached the shelf.
     The old line read:

       String(o.brand || o.brandName || (o.brand && o.brand.name) || "")

     On Dutchie and Herbology `o.brand` is an OBJECT, which is truthy, so the ||
     chain short-circuited on it and String({...}) returned "[object Object]".
     The o.brand.name branch after it could never run. api/coldwater.js then
     joins the brand onto the front of the product name, so 1,132 products --
     44% of the whole shelf, every Sapura and Herbology row -- were published
     with "[object Object]" printed in the title.

     Unwrap first, stringify last, and never emit the artefact even if some
     other path produces one. */
  var BRAND_KEYS = ["brand", "brandName", "brand_name", "producer", "vendor",
                    "manufacturer", "cultivator", "productBrand"];
  function brandOf(o) {
    var i, b;
    for (i = 0; i < BRAND_KEYS.length; i++) {
      b = o[BRAND_KEYS[i]];
      if (b && typeof b === "object") b = b.name || b.title || b.displayName || b.label || "";
      if (typeof b === "string" && b.trim() && !/^\[object/.test(b.trim())) return b.trim();
    }
    return "";
  }

  /* Menus name this a dozen ways, and some carry both a short and a long one.
     Longest wins: a shop that writes two is not writing the same thing twice,
     and the fuller one is the one worth the card back. */
  var DESC_KEYS = ["description", "body_html", "bodyHtml", "body", "details",
                   "longDescription", "shortDescription", "summary", "about",
                   "productDescription", "desc"];
  function descOf(o) {
    var best = "", i, v;
    for (i = 0; i < DESC_KEYS.length; i++) {
      v = o[DESC_KEYS[i]];
      if (v && typeof v === "object") v = v.html || v.text || v.value || "";
      if (typeof v !== "string") continue;
      /* Tags out, entities back to characters, whitespace collapsed. A <br> or
         a </p> becomes a space so two sentences do not fuse into one word. */
      v = v.replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, " ")
           .replace(/<[^>]*>/g, "")
           .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
           .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
           .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
           .replace(/\s+/g, " ").trim();
      if (v.length > best.length) best = v;
    }
    return best.slice(0, 1200);
  }

  /* Twin of dedupeRows() in api/coldwater.js. */
  function dedupeSizes(rows) {
    var best = {}, order = [];
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      if (!r || r.price == null) continue;
      var k = String(r.label || "").trim().toLowerCase();
      if (!best[k]) { best[k] = r; order.push(k); }
      else if (r.price < best[k].price) best[k] = r;
    }
    return order.map(function (k) { return best[k]; })
      .sort(function (a, b) { return (a.grams || 0) - (b.grams || 0) || (a.price || 0) - (b.price || 0); })
      .slice(0, 12);
  }

  function normalise(o) {
    var name = String(pick(o, NAME_KEYS) || "").trim();
    var sizes = [];

    /* FIVE SHAPES, and only the first of them used to be read. The other four all
       came out as a single "One Size" row at the product's top-level price, which
       is a card that looks finished with the ounce missing -- reported as "some
       items only show one option in the drop down".
         1. [{option:"3.5g", price:35}]         objects, the one that worked
         2. ["1g","3.5g"] + prices:[12,35]      parallel arrays, paired by index
         3. ["3.5g - $35"]                      the price inside the string
         4. {"3.5g":35}                         a label-keyed map
         5. price_gram / price_eighth_ounce     Jane, no array at all
       A label with no price anywhere is DROPPED rather than published at the
       parent's price: that price belongs to the cheapest variation, and stamping
       it on every size makes each one look like the cheapest. */
    var vs = variantsOf(o);
    if (vs) {
      var par = parallelPrices(o, vs.length);
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (v && typeof v === "object") {
          var lab = String(v.option || v.label || v.name || v.weight || v.title ||
                           v.displayVariation || v.variation || v.size || v.unit || "One Size");
          var pr = money(pick(v, PRICE_KEYS));
          /* A discounted price stated as its own field. The shelf price stays in
             `price` so the saving is visible rather than silently applied. */
          var sp = money(v.specialPrice != null ? v.specialPrice :
                         (v.salePrice != null ? v.salePrice :
                         (v.discountedPrice != null ? v.discountedPrice : null)));
          if (pr != null) {
            var r1 = { label: lab, price: pr, grams: grams(lab) };
            if (sp != null && sp < pr) r1.sale = sp;
            sizes.push(r1);
          }
          continue;
        }
        var own = splitLabelPrice(v);
        if (own) { sizes.push({ label: own.label, price: own.price, grams: grams(own.label) }); continue; }
        if (par) {
          var pp = money(par[i]);
          if (pp != null) sizes.push({ label: String(v), price: pp, grams: grams(String(v)) });
        }
      }
    }
    /* A label-keyed map, accepted only when EVERY value is money -- otherwise a
       props object full of booleans becomes a size list. */
    if (!sizes.length) {
      var mapKeys = ["variants", "sizes", "options", "weights", "prices"];
      for (var mi = 0; mi < mapKeys.length && !sizes.length; mi++) {
        var mv = o[mapKeys[mi]];
        if (!mv || typeof mv !== "object" || Array.isArray(mv)) continue;
        var ks = Object.keys(mv), good = [];
        for (var ki = 0; ki < ks.length; ki++) {
          var mp = money(mv[ks[ki]]);
          if (mp != null && mp > 0) good.push([ks[ki], mp]);
        }
        if (good.length && good.length === ks.length) {
          for (var gi = 0; gi < good.length; gi++) {
            sizes.push({ label: good[gi][0], price: good[gi][1], grams: grams(good[gi][0]) });
          }
        }
      }
    }
    /* Jane's per-weight fields. */
    if (!sizes.length) {
      for (var ji = 0; ji < JANE_FIELDS.length; ji++) {
        var jp = money(o["price_" + JANE_FIELDS[ji][0]]);
        if (jp != null && jp > 0) {
          sizes.push({ label: JANE_FIELDS[ji][1], price: jp, grams: grams(JANE_FIELDS[ji][1]) });
        }
      }
    }
    if (!sizes.length) {
      var p = money(pick(o, PRICE_KEYS));
      if (p == null) return null;
      var lab2 = String(o.displayVariation || o.variation || o.weight || o.size || "One Size");
      sizes.push({ label: lab2, price: p, grams: grams(lab2) });
    }
    /* Applied AFTER every shape has had its turn, so it covers the parallel-array
       path (Dutchie) and the label-keyed map alike, and never overwrites a sale
       the object-variant branch already read off the variant itself. Indexes line
       up because the array is only accepted at the same length as the rows, and
       this runs BEFORE dedupeSizes for the same reason -- dedupe reorders by
       weight and drops duplicates, after which position no longer means anything. */
    var saleArr = parallelSalePrices(o, sizes.length);
    if (saleArr) {
      for (var sq = 0; sq < sizes.length; sq++) {
        if (sizes[sq].sale != null) continue;
        var spv = money(saleArr[sq]);
        if (spv != null && spv > 0 && spv < sizes[sq].price) sizes[sq].sale = spv;
      }
    }
    /* A single-price product states its discount on the object rather than in an
       array -- there is no array for it to run parallel to. */
    if (sizes.length === 1 && sizes[0].sale == null) {
      var oneSale = money(pick(o, SINGLE_SALE_KEYS));
      if (oneSale != null && oneSale > 0 && oneSale < sizes[0].price) sizes[0].sale = oneSale;
    }

    /* One row per label, cheapest kept, lightest first -- so a dropdown reads
       upwards and a menu listing a weight twice does not offer it twice. */
    sizes = dedupeSizes(sizes);

    var img = imageOf(o);

    /* A PRODUCT URL IS RESOLVED THE WAY THE BROWSER WOULD RESOLVE AN HREF, and
       until now only ONE relative form was handled. `charAt(0) === "/"` catches
       a root-relative path and nothing else, so "products/tear-gas-9",
       "./tear-gas-9" and "../menu/x" all travelled as-is. They look like links
       here -- they are distinct strings, so the distinct-url guard counts them
       and the batch looks healthy -- and then api/coldwater-ingest.js requires
       ^https?: and drops every one of them. Reported as "it scraped everything
       perfectly and then only sent 14".

       A BARE SLUG IS DELIBERATELY NOT ONE. `o.slug` stays last in the chain but
       is only taken when it carries a path separator, because "tear-gas-9"
       resolved against whatever page the operator is standing on invents a url
       the shop does not serve -- and this file's own rule is that a dead link
       on the shelf is worse than an absent row (the breadcrumb note in
       sanitize). Such a row is now dropped LOUDLY, with the endpoint naming the
       count, rather than silently as before. */
    var href = o.url || o.permalink || o.link || "";
    if (!href) { var sl = String(o.slug || ""); href = sl.indexOf("/") >= 0 ? sl : ""; }
    if (href) {
      try { href = new URL(String(href), location.href).href; }
      catch (e) { href = ""; }
      if (!/^https?:/i.test(href)) href = "";   // javascript:, mailto:, data: are not products
    }

    return {
      name: name,
      brand: brandOf(o),
      /* THESE TWO USED TO FALL BACK INTO EACH OTHER, and both directions did
         real damage. `category` fell back to `o.type`, which on a dispensary
         menu is the STRAIN -- Green Tree's whole catalogue arrived filed under
         "hybrid", "sativa" and "indica", 24 for 24, category identical to type
         on every row. And `type` fell back to `o.category`, so Lume published
         85 products whose strain was "accessories" and 50 whose strain was
         "edibles". Neither is recoverable downstream, because once the two
         fields hold the same word nothing can tell which one was the real
         answer. A missing category is now missing, and api/coldwater.js infers
         one from the product name instead of borrowing the strain. */
      /* o.type IS BACK, and dropping it was an overcorrection with a measurable
         cost. On JANE, `type` is the strain -- which is why Green Tree's whole
         catalogue arrived filed under "hybrid". On DUTCHIE it is the product
         CATEGORY ("Flower", "Vaporizers"), and removing it sent Sapura down the
         `subcategory` branch instead: the town's distinct category count went
         from 11 to 39, with Budder, Rosin, Shatter, Sugar, Singles, Applicators
         and Dab-Tools all arriving as top-level filter entries. Broad categories
         became a long tail nobody can filter by, which is the same failure as
         three spellings of Flower, in the other direction.

         The right place to reject a strain is normCategory's NOT_A_CATEGORY,
         which already does it by VALUE rather than by field name -- so `type`
         can be trusted here and hybrid/sativa/indica still cannot get through.
         subcategory stays last: it is a real answer when nothing else is, just
         a worse one than the category the shop itself leads with. */
      /* THE ENGINE HAS ALWAYS RENDERED THIS and nothing ever filled it. It
         reads p.description into a .ggdesc block with a See-more toggle -- the
         card back on every other Legal-Leaf surface -- so on Coldwater every
         card has simply been blank there since the page existed.

         Stripped of markup because the engine escapes what it renders: a
         Dutchie body_html arriving raw would print "<p>" and "&nbsp;" at the
         shopper rather than a paragraph. */
      description: descOf(o),
      category: String(o.category || o.type || o.kind || o.productType || o.subcategory || ""),
      type: String(o.strain || o.strainType || o.strainCategory || o.classification || o.lineage || ""),
      thc: Number(o.percentTHC != null ? o.percentTHC : (o.thc != null ? o.thc : (o.potencyThc || NaN))),
      cbd: Number(o.percentCBD != null ? o.percentCBD : (o.cbd != null ? o.cbd : NaN)),
      image: String(img || ""),
      url: String(href || location.href),
      deal: dealOf(o),
      coa: coaOf(o),
      batch: String(o.batchName || o.batch || o.packageId || ""),
      packagedDate: String(o.packagedDate || o.packaged_date || ""),
      inStock: stockOf(o),
      sizes: sizes,
    };
  }

  /* Walk every own property of window plus embedded JSON script tags, breadth
     first with a visited set, and collect the biggest product-shaped array
     found. Depth capped because these state trees are deep and cyclic. */
  /* Recover JSON from a Next.js App Router (RSC) streamed payload.
   *
   * THE APP ROUTER SHIPS NO __NEXT_DATA__. It streams the page's data as
   * self.__next_f.push([1,"<chunk>"]) calls, so window.__next_f is an array of
   * [1, string] pairs and the products are escaped inside those strings. The
   * walk below only recognises OBJECTS, so without this the whole menu is
   * invisible and the panel says "Nothing product-shaped found on this page"
   * about a page that server-rendered every row. Flowhub, Lume and Tymber are
   * all App Router, which is most of Coldwater.
   *
   * Concatenated, the chunks form "<id>:<json>" rows -- but a chunk boundary
   * lands wherever the server flushed, including mid-string, so splitting on
   * \n loses data. Scan for balanced JSON instead, string-aware so a bracket
   * inside a product description cannot end the value early.
   *
   * THIS IS A DELIBERATE SECOND COPY of rscRoots()/balancedEnd() in
   * api/coldwater.js. A static file served to a dispensary's origin cannot
   * import from api/, the same way public/js/overrides.js cannot share
   * api/overrides.js and carries its own port of _applyOv (CLAUDE.md section
   * 6). Change one, change the other, or the browser and the server will
   * disagree about what a menu contains. */
  function rscRoots() {
    var roots = [], buf = "", i, lit;

    /* The live array first: it is already unescaped, so nothing can be lost in
       re-parsing. Fall back to the markup for the case where the page replaced
       the global after hydration. */
    try {
      var f = window.__next_f;
      if (f && f.length) for (i = 0; i < f.length; i++) {
        if (f[i] && typeof f[i][1] === "string") buf += f[i][1];
      }
    } catch (e) {}
    if (!buf) {
      var pushes = document.documentElement.innerHTML.match(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\[\s\S])*")\]\)/g) || [];
      for (i = 0; i < pushes.length; i++) {
        lit = pushes[i].match(/\[1,("(?:[^"\\]|\\[\s\S])*")\]/);
        if (lit) { try { buf += JSON.parse(lit[1]); } catch (e) {} }
      }
    }
    if (!buf) return roots;

    var at, end, pos = 0, tried = 0;
    while (pos < buf.length && roots.length < 40 && tried < 400) {
      at = buf.indexOf("[{", pos);
      if (at < 0) break;
      tried++;
      end = balancedEnd(buf, at);
      if (end < 0) { pos = at + 2; continue; }
      try {
        var v = JSON.parse(buf.slice(at, end));
        if (v && v.length) { roots.push(v); pos = end; continue; }
      } catch (e) {}
      pos = at + 2;
    }
    return roots;
  }

  function balancedEnd(s, start) {
    var depth = 0, inStr = false, esc2 = false, c;
    var cap = Math.min(s.length, start + 4e6);
    for (var i = start; i < cap; i++) {
      c = s.charAt(i);
      if (inStr) {
        if (esc2) esc2 = false;
        else if (c === "\\") esc2 = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") { depth--; if (depth === 0) return i + 1; }
    }
    return -1;
  }

  /* i points AT the opening quote. */
  function skipJsString(s, i) {
    for (var j = i + 1, esc = false; j < s.length; j++) {
      var c = s.charAt(j);
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') return j + 1;
    }
    return s.length;
  }

  /* REMIX, AND THE THIRD COPY OF THE RULE THAT HAS TO STAY IN STEP.
   *
   * `rscRoots()` and `balancedEnd()` above exist twice on purpose -- here and in
   * api/coldwater.js -- because a static file served onto a dispensary's origin
   * cannot import from api/. `remixRoots()` was written in api/coldwater.js and
   * NEVER PORTED HERE, and that omission is exactly the drift the duplication
   * was supposed to make visible: the server could read The Dude Abides and the
   * bookmarklet could not, so the same shop was rich on the scheduled lane and
   * five rows on the operator's.
   *
   * Remix ships loader data two ways and NOTHING THAT SCANS FOR A CONTAINER SEES
   * EITHER: as an assignment to a global (`window.__remixContext = {...}`), and
   * as FUNCTION CALLS WITH JSON ARGUMENTS (`__remixContext.r("route", "key",
   * [...])`). There is no <script type="application/json">, no __NEXT_DATA__ and
   * no RSC chunk, so the generic reader reported "no parseable JSON" against a
   * page that server-renders its entire menu in ~960 KB.
   *
   * THE JSON IS NOT THE FIRST ARGUMENT. It sits after one or more strings, and
   * those strings are hostile by accident: a route pattern contains a bracket
   * ("/:store?/:medrec/menu[x]"), so a scan that jumps to the first `[` takes
   * the wrong one, and a deferred key can contain an escaped quote, so a naive
   * string skipper stops early. Hence skipJsString() and the argument loop.
   */
  function remixRoots(text) {
    var out = [];
    var at = text.indexOf("__remixContext =");
    if (at >= 0) {
      var b = text.indexOf("{", at);
      if (b >= 0) {
        var end0 = balancedEnd(text, b);
        if (end0 > 0) { try { out.push(JSON.parse(text.slice(b, end0))); } catch (e) {} }
      }
    }
    /* Every __remixContext.<fn>( call, and every JSON-shaped argument inside it.
       Capped, because a runaway match on a megabyte of markup is a timeout
       rather than an error, and those are the hardest to diagnose. */
    var re = /__remixContext\.[a-zA-Z_$][\w$]*\(/g, m;
    while ((m = re.exec(text)) && out.length < 80) {
      var i = m.index + m[0].length;
      for (var guard = 0; guard < 8 && i < text.length; guard++) {
        while (i < text.length && (text.charAt(i) === " " || text.charAt(i) === "," ||
               text.charAt(i) === "\n" || text.charAt(i) === "\t")) i++;
        var c = text.charAt(i);
        if (c === '"') { i = skipJsString(text, i); continue; }
        if (c === "[" || c === "{") {
          var end = balancedEnd(text, i);
          if (end < 0) break;
          try { out.push(JSON.parse(text.slice(i, end))); } catch (e) {}
          i = end;
          continue;
        }
        break;   /* a number, null, or the closing paren: nothing more to read */
      }
    }
    return out;
  }

  /* WHAT THE PAGE WILL TELL US ABOUT ITSELF when nothing is found. "Nothing
     product-shaped found on this page" is true and useless: it does not say
     whether the menu had not rendered yet, or rendered somewhere this script
     does not look, or sits in an iframe. Every layer records what it saw, and
     the failure panel prints it. */
  var DIAG = {};

  /* WHICH BUILD PRODUCED THIS DIAGNOSTIC, AND WHERE IT CAME FROM. A bookmarklet
     is kept for months and points at whichever origin it was dragged from, so
     "the fix is not working" and "the fixed file never ran" arrive looking
     identical -- a diagnostic full of plausible fields, none of which say what
     answered. That cost a full round trip: a report of the same cap at the same
     number, from a bookmark still pointing at production while the fix sat on a
     preview, and the only tell was that two NEW fields happened to be absent
     from a long object. Reading a build by what is missing from it is not a
     diagnostic, it is an inference nobody should have to make twice.

     BUILD is bumped by hand when the reading or batching rules change; it is
     not a version of the file, it is an answer to "is this the one I think it
     is". `from` is the origin that served this script, which is the question
     underneath every stale-bookmarklet report. */
  var BUILD = "2026-08-19.product-photo";
  DIAG.build = BUILD;

  /* AND WHETHER IT IS THE CURRENT ONE, ASKED RATHER THAN ASSUMED.
     The self-contained bookmarklet carries the whole collector inside its URL,
     which is the only build Dutchie will run -- and that makes it a SNAPSHOT
     frozen on the day it was dragged. So an operator on a shop fixed weeks ago
     gets the old reader and the old numbers, and reports them as a reader bug.
     That is exactly what happened: The Dude Abides came back at five products
     again, months after the tier-table fix, and the collector had no way to say
     "you are running February's reader".
     Reading a build by what is MISSING from a diagnostic is an inference nobody
     should have to make twice, which is what the note above already says about
     BUILD itself. This closes the other half: the file this bookmark came from
     still knows the current answer, so ask it.
     NON-FATAL AND NON-BLOCKING BY CONSTRUCTION. A shop with a strict
     connect-src refuses this (The Dude Abides does), and that refusal is not an
     error -- it just means the check is unavailable, so nothing waits on it and
     nothing reports it. The harvest has already happened by the time it lands. */
  var STALE = "";
  function checkBuild(then) {
    var src = "";
    try { src = window.__LL_COLLECTOR_SRC__ || (document.currentScript && document.currentScript.src) || ""; } catch (e) {}
    if (!src) return;
    var base;
    try { base = new URL(src, location.href).origin; } catch (e) { return; }
    try {
      fetch(base + "/collector-build.txt?" + Date.now(), { credentials: "omit" })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (t) {
          t = String(t || "").trim();
          if (!t || t === BUILD) return;
          STALE = t;
          DIAG.buildCurrent = t;
          if (typeof then === "function") then(t);
        })
        .catch(function () {});
    } catch (e) {}
  }
  try {
    var _me = document.currentScript && document.currentScript.src;
    DIAG.from = _me ? new URL(_me).host : "pasted into the console";
  } catch (e) { DIAG.from = "unknown"; }

  /* ---- SHADOW DOM, WHICH IS INVISIBLE TO querySelectorAll -----------------
     Jane embeds its menu as a web component, so Green Tree Relief's products
     live inside a shadow root: element selectors are `._cardContent_d5vxq_1`
     and DevTools says outright "It is in a shadow DOM tree". document.
     querySelectorAll does NOT cross that boundary, so every layer here was
     blind to the entire menu -- and, worse, the page looked EMPTY rather than
     blocked. It also explains why hunting for an iframe found nothing: there
     is no iframe, the encapsulation is a shadow root.

     Only OPEN roots are reachable, and that is the correct limit: a closed
     root is a deliberate "no" from the page, and this tool does not argue with
     those. Bounded traversal, because a menu of several hundred cards inside
     nested components is a lot of nodes and this runs on someone's laptop. */
  function shadowRootsOf(limit) {
    var found = [], queue = [document], seen = 0, r, all, i;
    while (queue.length && seen < (limit || 60000)) {
      r = queue.shift();
      try { all = r.querySelectorAll("*"); } catch (e) { continue; }
      for (i = 0; i < all.length && seen < (limit || 60000); i++, seen++) {
        if (all[i].shadowRoot) { found.push(all[i].shadowRoot); queue.push(all[i].shadowRoot); }
      }
    }
    return found;
  }
  /* RE-ENUMERATED, NOT CAPTURED ONCE. A virtualised menu creates and destroys
     components as you scroll, and each new component brings its own shadow
     root. Taking this list a single time at load meant every card that appeared
     afterwards was invisible -- which is why Green Tree stayed at 22 no matter
     how far it was scrolled. Cheap enough to redo per harvest; cached for a
     moment so one harvest does not walk the tree repeatedly. */
  var SHADOW = [], shadowAt = 0;
  function refreshShadow(force) {
    var now = Date.now();
    if (!force && SHADOW.length && now - shadowAt < 250) return SHADOW;
    SHADOW = shadowRootsOf();
    shadowAt = now;
    DIAG.shadowRoots = SHADOW.length;
    return SHADOW;
  }
  refreshShadow(true);

  /* Every match in the document AND in every open shadow root under it. */
  function deepAll(sel) {
    var out = [], i, j, els;
    try { els = document.querySelectorAll(sel); for (j = 0; j < els.length; j++) out.push(els[j]); } catch (e) {}
    for (i = 0; i < SHADOW.length; i++) {
      try { els = SHADOW[i].querySelectorAll(sel); } catch (e) { continue; }
      for (j = 0; j < els.length; j++) out.push(els[j]);
    }
    return out;
  }

  /* ---- layer 2: React ------------------------------------------------------
     Dutchie and Jane are React apps that fetch their menu over XHR and hold it
     in component state, so there is no window global and no JSON script tag:
     the data exists only as props on the rendered tree. React hangs those props
     off the DOM node under a per-build key (__reactProps$xyz / __reactFiber$xyz)
     -- this is how React devtools reads a page, and it is still reading what was
     rendered to this browser. Nothing private, nothing refetched.

     Cheaper than it looks: the key suffix is per-build, so it is found once and
     used directly rather than re-scanning every node's key list. */
  function reactHarvest() {
    /* Deep, because Jane's cards are inside a shadow root and a plain
       querySelectorAll never reaches them (see shadowRootsOf above). */
    var nodes = deepAll("*");
    var cap = Math.min(nodes.length, 6000);
    var propsKey = null, fiberKey = null, i, k;

    for (i = 0; i < cap && !(propsKey && fiberKey); i++) {
      for (k in nodes[i]) {
        if (!propsKey && k.indexOf("__reactProps$") === 0) propsKey = k;
        else if (!fiberKey && k.indexOf("__reactFiber$") === 0) fiberKey = k;
        if (propsKey && fiberKey) break;
      }
      if (i > 400 && !propsKey && !fiberKey) break;   // not a React page
    }
    DIAG.react = !!(propsKey || fiberKey);
    if (!propsKey && !fiberKey) return [];

    var hits = [], seenKey = {};
    function consider(v, depth) {
      if (!v || typeof v !== "object" || depth > 3) return;
      if (Array.isArray(v)) {
        for (var a = 0; a < v.length && a < 2000; a++) consider(v[a], depth + 1);
        return;
      }
      if (!looksLikeProduct(v)) return;
      var id = String(pick(v, NAME_KEYS)) + "|" + JSON.stringify(pick(v, PRICE_KEYS));
      if (seenKey[id]) return;
      seenKey[id] = 1;
      hits.push(v);
    }

    for (i = 0; i < cap; i++) {
      var el = nodes[i], props = null;
      try {
        if (propsKey && el[propsKey]) props = el[propsKey];
        else if (fiberKey && el[fiberKey]) props = el[fiberKey].memoizedProps || el[fiberKey].pendingProps;
      } catch (e) { continue; }
      if (!props || typeof props !== "object") continue;
      for (k in props) {
        if (k === "children") continue;            // the subtree, not data
        try { consider(props[k], 0); } catch (e) {}
      }
    }
    DIAG.hostHits = hits.length;

    /* THE LIST USUALLY LIVES ABOVE THE HOST NODES, not on them. A host element
       gets only the props of the tag it renders -- a <div> holding one card
       sees that card at best, and often only a className. The menu ARRAY is
       held by a component further up: as a prop on the grid component, or in a
       useState hook belonging to whatever did the fetch. Neither is reachable
       from element props, which is why a live Dutchie menu reported react:true
       with reactHits:0 while every product sat one level out of reach.

       So walk the fiber `return` chain from a spread of host nodes and read
       each ancestor's memoizedProps AND its hook state. memoizedState on a
       function component is a linked list of hooks, each holding its value. */
    /* ALWAYS, not only when the host pass came back empty. Host props carry the
       items currently RENDERED -- on a virtualised list that is one screenful --
       while the hook on the component above holds the entire menu. Gating this
       on an empty host pass meant a page that rendered 22 cards reported 22
       products and never looked at the array holding all of them. */
    if (fiberKey) {
      var starts = [], step = Math.max(1, Math.floor(cap / 40));
      for (i = 0; i < cap; i += step) starts.push(nodes[i]);
      var walkedFibers = 0;

      for (i = 0; i < starts.length; i++) {
        var f = null;
        try { f = starts[i][fiberKey]; } catch (e) {}
        var up = 0;
        while (f && up < 30) {
          walkedFibers++;
          try {
            var mp = f.memoizedProps;
            if (mp && typeof mp === "object") {
              for (k in mp) { if (k === "children") continue; consider(mp[k], 0); }
            }
            var hook = f.memoizedState, hops = 0;
            while (hook && hops < 60) {
              consider(hook.memoizedState, 0);
              hook = hook.next; hops++;
            }
          } catch (e) {}
          /* High cap: Lume's menu is ~950 products and a real Jane store runs to
             several hundred, so a low ceiling here silently truncates the very
             list this walk exists to find. */
          if (hits.length > 4000) break;
          try { f = f.return; } catch (e) { break; }
          up++;
        }
        if (hits.length > 4000) break;
      }
      DIAG.fibersWalked = walkedFibers;
    }
    DIAG.reactHits = hits.length;
    /* WHAT THE REACT LAYER ACTUALLY PICKED, and WHICH FIELD IT READ AS A PRICE.
       `pickedKeys` is set by the page-state layer only, so on any shop where
       React answers -- Jane, Dutchie -- the one diagnostic that says why a
       reader came back wrong was blank. Green Tree published rows reading
       "Cannalope [.5g] - $0.50" and "Lemon Lime [1pk] (200mg) - $1.00": those
       are not prices, they are the WEIGHT and the PACK COUNT, and PRICE_KEYS
       carries `amount`, which means money on some platforms and quantity on
       others. Three sample rows were the only evidence, and inferring a schema
       from three rendered strings is how the wrong file gets edited.

       KEY NAMES ONLY, never a value -- this travels in a diagnostic the operator
       pastes around, same rule as pickedKeys. */
    try {
      DIAG.reactKeys = Object.keys(hits[0] || {}).slice(0, 24).join(",");
      var pk = "", z;
      for (z = 0; z < PRICE_KEYS.length; z++) {
        if (hits[0] && hits[0][PRICE_KEYS[z]] != null) { pk = PRICE_KEYS[z]; break; }
      }
      DIAG.reactPriceKey = pk;
    } catch (e) {}

    var out = [];
    for (i = 0; i < hits.length; i++) { var n = normalise(hits[i]); if (n && n.name && n.sizes.length) out.push(n); }
    return out;
  }

  /* ---- layer 3: the rendered page -----------------------------------------
     THE PROMISE THIS FILE HAD BEEN MAKING SINCE IT WAS WRITTEN. The note on
     harvest() said the state walk "degrades to the DOM scan below", and there
     was no DOM scan -- so a menu keeping its data anywhere unusual produced
     "Nothing product-shaped found on this page" with no fallback at all. Since
     the whole premise is "copy what is on my screen", the screen has to be the
     last resort rather than a comment.

     No per-site selectors, which would break on the first redesign. Find text
     carrying a price, climb to the element that also carries a name, then group
     those containers by shape and keep the biggest group: a product grid is by
     construction the largest set of same-shaped priced things on the page, and
     a lone cart total cannot win a group of one. */
  var PRICE_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/;

  /* EVERY (label, price) PAIR ON ONE LINE OF TEXT, in the order printed.
     A menu that renders its weights inline gives one line reading
     "1g $12   3.5g $35   1 oz $170", and taking only the first match published
     that card as a single option -- with a label naming five weights and the
     price of the cheapest. The text in FRONT of each price is that price's label,
     because a price follows the thing it is for.
     A line with one price behaves exactly as before, which keeps the common case
     (one price per element) untouched. */
  function pricePairs(line) {
    var s = String(line || ""), re = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g, out = [], m, at = 0;
    while ((m = re.exec(s))) {
      var price = Number(m[1].replace(/,/g, ""));
      if (isFinite(price) && price > 0) {
        out.push({
          label: s.slice(at, m.index).replace(/[|\u00b7\u2014\-\u2013,:]+\s*$/, "").replace(/^[\s|\u00b7\u2014\-\u2013,:]+/, "").trim(),
          price: price,
        });
      }
      at = m.index + m[0].length;
    }
    return out;
  }

  /* ONE NAME TEST, SHARED. There used to be two of these -- one in the DOM
     layer, one in the text layer -- with different holes, which is the same
     thing this project already regrets about storeCheckoutUrl() existing four
     times: a rule restated instead of shared drifts, and drifts silently.
     Between them they accepted "Hybrid", "Indica", "Flower", "1/8 oz",
     "THC: 28.03%" and "Add to bag" as product names.

     WHY THAT IS NOT A COSMETIC BUG. Rows are deduped by name, so when every
     card on a page names itself "Hybrid" or "Flower", a menu of two hundred
     collapses to the handful of distinct chips on it. Reported as Herbology
     showing "1/8oz", Banzen showing "THC: 28.03%", and Exclusive "barely
     picking anything up per page" -- three reports, three shops, one cause,
     and the last one does not even look like a naming bug from outside. It
     looks like a scrape that cannot read the page.

     The list is of things a menu prints BESIDE a name: the strain type, the
     category chip, the potency, the weight, the stock state, the buttons.
     Anything else is allowed through -- this is a reject list rather than a
     format guess, because a product name has no format.

     EVERY ENTRY IS ANCHORED OR REQUIRES A DIGIT, and that is not fussiness.
     "THC Bomb", "Half Baked" and "Flower Power OG" are real strain names, so a
     loose /^thc\b/ or /^half\b/ would delete real products to fix fake ones --
     trading a visible bug for an invisible one. A potency line always carries a
     NUMBER; a category chip is the whole line and nothing else. */
  var NAME_REJECT = [
    /^(indica|sativa|hybrid|cbd)([\s-]*(dominant|hybrid|leaning))?$/i,
    /^(flower|pre[\s-]?rolls?|vapes?|vaporizers?|edibles?|concentrates?|tinctures?|topicals?|accessories|apparel|beverages|merch|gear|seeds|clones)$/i,
    /^(thca?|cbd|cbg|cbn|cbc|total\s+thca?)\s*:?\s*[\d.]/i,    // "THC: 28.03%", not "THC Bomb"
    /\b(thca?|cbd)\s*:?\s*[\d.]+\s*%/i,
    /^[\d.]+\s*%/,
    /^[\d.]+\s*\/\s*[\d.]+\s*(g|gram|grams|oz|ounces?)\b/i,    // "1/8 oz"
    /^[\d.]+\s*(g|gram|grams|oz|ounces?|mg|ml|pk|pack)\b/i,
    /^(eighth|quarter|half[\s-]?ounce|ounce|one size)$/i,      // anchored: "Half Baked" is a strain
    /^add to (bag|cart)\b/i,
    /^(buy|shop|sort|filter|view|details|pickup|delivery)\b\s*(now|by|all|more)?$/i,
    /^(sold out|out of stock|in ?stock|low stock|quick add|see more|load more|show more)\b/i,
    /^(sale|new|featured|staff pick|best ?seller|deal|special|popular)$/i,
    /^[\d\s.,:%$+-]*$/,                                        // nothing but digits and punctuation
  ];
  function isProductName(l) {
    var s = String(l || "").trim();
    if (s.length < 3 || s.length > 160) return false;
    if (PRICE_RE.test(s)) return false;
    for (var i = 0; i < NAME_REJECT.length; i++) if (NAME_REJECT[i].test(s)) return false;
    return true;
  }

  function domHarvest() {
    /* INLINE ELEMENTS ARE WHERE PRICES ACTUALLY LIVE. A first cut queried only
       a,li,article,div,section and found one price node on a page showing nine:
       every real price sat in a <span> inside a row div, so the span was never
       a candidate and the row was rejected for containing a priced child. The
       filter below wants the SMALLEST element holding a price, which means the
       inline tags have to be in the running. */
    /* EVERY ELEMENT, NOT A TAG WHITELIST. This listed the tags a menu "should"
       use, which quietly excluded the ones a web-component menu actually uses:
       Exclusive renders its cards in custom elements, so a page carrying 194
       prices yielded exactly 10 candidate nodes and one group. A whitelist here
       is a guess about someone else's markup, and it fails silently and totally
       when the guess is wrong -- the same class of mistake as reading only
       __NEXT_DATA__ or only the light DOM.
       The filter below already keeps only the smallest element holding a price,
       so widening the query costs a longer NodeList and nothing else. */
    var els = deepAll("*");
    var cand = [], i, j;

    for (i = 0; i < els.length && i < 12000; i++) {
      var el = els[i];
      if (el.children.length > 24) continue;             // a container, not a card
      var txt = (el.innerText || "").trim();
      if (!txt || txt.length > 600 || !PRICE_RE.test(txt)) continue;
      /* Keep only the SMALLEST element still holding a price: climbing from
         there finds the card, while starting at the grid finds the page. */
      var inner = false;
      for (j = 0; j < el.children.length; j++) {
        if (PRICE_RE.test(el.children[j].innerText || "")) { inner = true; break; }
      }
      if (inner) continue;
      cand.push(el);
    }
    DIAG.domPriceNodes = cand.length;
    if (!cand.length) return [];

    function shape(el) {
      var s = [], n = el, d = 0;
      while (n && d < 3) { s.push(n.tagName + "." + String(n.className || "").split(/\s+/)[0]); n = n.parentElement; d++; }
      return s.join(">");
    }
    /* A CARD IS NOT "THE FIRST ANCESTOR WITH A LINK IN IT", and getting that
       wrong is silent. Dutchie wraps each weight option in its own link, so the
       first ancestor carrying an a[href] is the price row -- text "1/8 oz
       $45.00", every line of which is a price. The extractor below then finds
       no name and drops the row, which is how a real Sapura menu reported
       252 grouped cards and 0 products.

       So climb until the element carries a line that is NOT a price: that line
       is the product name, and an element that has one is a card rather than a
       price row. */
    function hasNameLine(el) {
      var ls = String(el.innerText || "").split("\n"), k, L;
      for (k = 0; k < ls.length; k++) {
        L = ls[k].trim();
        /* The shared test, so the boundary and the extractor agree about what a
           name is. They did not: a block reading "Hybrid / $45.00" counted as a
           card here and then produced the name "Hybrid" below, and every such
           card on the page deduped onto the same row. */
        if (isProductName(L)) return true;
      }
      return false;
    }
    /* NEVER CLIMB INTO body. On a page whose text mostly sits on one line, every
       ancestor test fails until <body> itself, whose first line ("Shop", a nav
       item, anything) reads as a name -- so the whole document becomes one
       "card" and the group collapses to a single member. Stop below body and
       return the highest ancestor reached; wrong, but wrong at the scale of a
       grid rather than the scale of the page, and visible in domGroup. */
    function cardFor(el) {
      var n = el, d = 0, last = el;
      while (n && n !== document.body && n !== document.documentElement && d < 8) {
        if (hasNameLine(n) && String(n.innerText || "").trim().length > 6) return n;
        last = n;
        n = n.parentElement; d++;
      }
      return last;
    }

    /* THE CARD IS THE TEXT BLOCK, AND THE PHOTO IS USUALLY OUTSIDE IT.
       cardFor() stops at the SMALLEST ancestor carrying a name, which on the
       ordinary card layout is the caption:

         <article>                 <- the photo and the link live here
           <a href><img></a>
           <div class="info">      <- cardFor() stops here, and this is "the card"
             <h3>Name</h3><span>$40</span>

       So imgFromEl(card) finds no <img> and the shop reports 0% images, which
       is what Banzen did across 458 products. The SAME wrapper usually carries
       the <a>, so every product also fell back to location.href -- the shop's
       front page instead of the product. One cause, two symptoms that read as
       unrelated bugs.

       Climbing is only safe while the ancestor adds no text of its own: a
       wrapper holding the photo contributes none, whereas an ancestor that has
       swept up a NEIGHBOURING card grows by that card's words, and its <img>
       would be the neighbour's photo. That is the difference between a missing
       picture and a wrong one, so the text-growth test is the guard. */
    function wrapperChain(c) {
      var out = [c], d = 0;
      var base = String(c.innerText || "").replace(/\s+/g, " ").trim().length;
      var n = c.parentElement;
      while (n && n !== document.body && n !== document.documentElement && d < 3) {
        var t = String(n.innerText || "").replace(/\s+/g, " ").trim().length;
        if (t > base + 40) break;              // this one holds somebody else's card
        out.push(n);
        n = n.parentElement; d++;
      }
      return out;
    }
    function liftImage(c) {
      var ch = wrapperChain(c), i, u;
      for (i = 0; i < ch.length; i++) {
        u = imgFromEl(ch[i]);
        if (u) { if (i > 0) liftedImg++; return u; }
      }
      return "";
    }
    function liftHref(c) {
      var ch = wrapperChain(c), i, a;
      for (i = 0; i < ch.length; i++) {
        a = (ch[i].matches && ch[i].matches("a[href]")) ? ch[i] : ch[i].querySelector("a[href]");
        if (a && a.href) { if (i > 0) liftedHref++; return a.href; }
      }
      return "";
    }
    var liftedImg = 0, liftedHref = 0;

    var groups = {}, order = [];
    for (i = 0; i < cand.length; i++) {
      var card = cardFor(cand[i]);
      var key = shape(card);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      if (groups[key].indexOf(card) < 0) groups[key].push(card);
    }
    var best = [];
    for (i = 0; i < order.length; i++) if (groups[order[i]].length > best.length) best = groups[order[i]];
    DIAG.domGroup = best.length;
    /* Three is the floor: two same-shaped priced boxes are as likely to be a
       subtotal and a total as a menu. */
    if (best.length < 3) return [];

    /* WHY EACH CARD WAS DROPPED. "252 grouped, 0 products" is the shape of a
       failure that tells you nothing, and it is the one this layer actually
       produced against a live menu. A card can only fail two ways, so count
       both and keep one verbatim sample: that turns the next report into an
       answer instead of another round of guessing. */
    /* WHICH LINE IS THE NAME. Position cannot answer this, and both guesses
       that were being made here are wrong on real menus:

         Exclusive        <- first plausible line: the BRAND, same on every card
         Gary Payton      <- the answer
         Flower           <- category chip, same on every card
         Hybrid           <- strain chip, same on most cards
         THC: 24.5%
         1/8 oz
         $45.00

       Taking the FIRST gave "Exclusive" on all six; taking the LAST before the
       price gave "Hybrid". Because rows dedupe by name, a page then collapses to
       the number of distinct chips on it -- which is what "barely picking
       anything up per page" is. It does not look like a naming bug from outside.
       It looks like a scrape that cannot read the menu.

       The group already holds the answer. These cards were grouped BECAUSE they
       share a shape, so a line repeated across them is furniture and the line
       that varies is the product. Count each candidate across the group and take
       the rarest, earliest winning a tie. Brand-above-product resolves correctly
       (the brand repeats, the product does not), and a menu printing brand and
       product on ONE line is unique per card and wins outright. */
    var cardLines = [], freq = {}, ci, cj, cl, ck, seenHere;
    for (ci = 0; ci < best.length; ci++) {
      cl = String(best[ci].innerText || "").replace(/\u00a0/g, " ").split("\n")
        .map(function (s) { return s.trim(); }).filter(Boolean);
      cardLines.push(cl);
      seenHere = {};
      for (cj = 0; cj < cl.length; cj++) {
        if (!isProductName(cl[cj])) continue;
        ck = cl[cj].toLowerCase();
        if (seenHere[ck]) continue;
        seenHere[ck] = 1;
        freq[ck] = (freq[ck] || 0) + 1;
      }
    }

    var dropNoName = 0, dropNoSizes = 0;
    var out = [];
    for (i = 0; i < best.length; i++) {
      var c = best[i];
      if (i === 0) DIAG.domSample = String(c.innerText || "").replace(/\n/g, " | ").slice(0, 220);
      var lines = cardLines[i];

      var name = "", L, bestFreq = Infinity;
      for (j = 0; j < lines.length; j++) {
        L = lines[j];
        if (!isProductName(L)) continue;          // the shared test, see NAME_REJECT
        var f = freq[L.toLowerCase()] || 1;
        if (f < bestFreq) { bestFreq = f; name = L; }
        if (bestFreq === 1) break;                // cannot do better than unique
      }
      /* A heading OVERRULES the scan, but only when it is itself a name AND is
         no more repeated than what the scan found. Some menus put the category
         in the h3 and the product in a div, which is another way every card on
         a page ends up called the same thing. */
      var h = c.querySelector("h1,h2,h3,h4");
      if (h) {
        var ht = String(h.innerText || "").trim();
        if (isProductName(ht) && (freq[ht.toLowerCase()] || 1) <= bestFreq) name = ht;
      }
      if (!name) { dropNoName++; continue; }

      var sizes = [], seenLab = {};
      for (j = 0; j < lines.length; j++) {
        /* A WHOLE SIZE SELECTOR CAN SIT ON ONE LINE, and reading it as one option
           is what "the options are all on one line" looked like on the shelf: a
           card printing "1g $12  3.5g $35  1/8 oz $35  1 oz $170" produced a
           single row whose label was every weight at once and whose price was the
           first one. So every price on the line is taken, and the text in front of
           each is that price's label -- which is the order these are printed in,
           because a price follows the thing it is for. */
        var pairs = pricePairs(lines[j]);
        if (!pairs.length) continue;
        for (var pi = 0; pi < pairs.length; pi++) {
          var lab = pairs[pi].label;
          /* A price on its own line, with the weight on the line above it. Only
             for a single-price line: on a multi-price line the labels are all
             present and borrowing one would misattribute the rest. */
          if (!grams(lab) && pairs.length === 1 && j > 0 && grams(lines[j - 1])) lab = lines[j - 1];
          if (!lab) lab = "One Size";
          if (seenLab[lab + pairs[pi].price]) continue;
          seenLab[lab + pairs[pi].price] = 1;
          sizes.push({ label: lab, price: pairs[pi].price, grams: grams(lab) });
        }
      }
      sizes = dedupeSizes(sizes);
      if (!sizes.length) { dropNoSizes++; continue; }

      out.push({
        name: name, brand: "", category: "", type: "",
        thc: NaN, cbd: NaN,
        image: liftImage(c),
        coa: coaFromEl(c),
        /* The name is passed so a product cannot nominate itself as its own
           deal -- see dealFromText. This is the only call site that reads a
           card, and it is the one that produced Banzen's two bad rows. */
        deal: dealFromText(c.innerText, name),
        url: liftHref(c) || location.href,
        batch: "", packagedDate: "",
        /* The card says so in words or not at all -- there is no object here. */
        inStock: !OOS_TEXT.test(String(c.innerText || "")),
        sizes: sizes,
      });
    }
    DIAG.domDropped = { noName: dropNoName, noSizes: dropNoSizes };
    /* How many needed the climb. A store reading 0 here with 0% images is a
       different problem from one reading 400 -- the first means the photos are
       genuinely absent, the second means this fix is what is carrying them. */
    DIAG.domLifted = { image: liftedImg, href: liftedHref };
    return out;
  }

  /* ---- layer 4: the printed text ------------------------------------------
     THE LAST HONEST FALLBACK. Exclusive renders its menu into a CLOSED shadow
     root: 194 prices are in the page text, five elements occupy real space with
     nothing readable inside them, and exactly three price-bearing elements are
     reachable. innerText traverses the rendered tree, so the words are right
     there; querySelectorAll does not, so the cards are not.

     Nothing is defeated here. A closed root refuses SCRIPT ACCESS TO ITS
     ELEMENTS, and this reads none of them -- it reads the text the browser
     already painted for the person at the keyboard, which is exactly what they
     can see. The capture is thin by nature (no strain, category or THC, because
     none of it is printed as a field) and is labelled as such.

     Runs only when every richer layer found nothing, because a line parser will
     happily produce plausible rubbish from a page it does not understand. */
  function textHarvest() {
    var text = "";
    try { text = (document.body && document.body.innerText) || ""; } catch (e) {}
    if (!text) return [];

    var lines = text.split("\n").map(function(l){ return l.trim(); }).filter(Boolean);
    var out = [], pending = [], sizes = [], cands = [];

    var plausibleName = isProductName;      // the shared test, see NAME_REJECT

    /* SAME PROBLEM AS THE DOM LAYER, MIRRORED. That one took the FIRST plausible
       line and got the brand; this one took the LAST before the price and got
       the strain chip, so every card on an Exclusive page came back "Hybrid" or
       "Indica" and deduped onto three rows.

       So no name is chosen while reading. Every candidate the card offered is
       kept, and the choice is made at the end from frequency across the whole
       page -- a line printed on most cards is furniture, the one that varies is
       the product. It has to be deferred because the page has not been read yet
       when the first card is parsed. */
    function flush(){
      if (cands.length && sizes.length) {
        out.push({ name: "", _cands: cands, brand: "", category: "", type: "",
                   thc: NaN, cbd: NaN, image: "", coa: "", url: location.href,
                   batch: "", packagedDate: "", inStock: true, sizes: dedupeSizes(sizes) });
      }
      cands = []; sizes = []; pending = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var L = lines[i], pairs = pricePairs(L);
      if (pairs.length) {
        if (!cands.length) {
          for (var j = 0; j < pending.length; j++) if (plausibleName(pending[j])) cands.push(pending[j]);
        }
        /* Every price on the line, each with the text in front of it -- same
           reasoning as the DOM layer above: printed text is where a size selector
           most often arrives as one long line. */
        for (var pj = 0; pj < pairs.length; pj++) {
          var lab = pairs[pj].label;
          if (!lab && pairs.length === 1 && i > 0 && grams(lines[i - 1])) lab = lines[i - 1];
          sizes.push({ label: lab || "One Size", price: pairs[pj].price, grams: grams(lab) });
        }
        continue;
      }
      if (cands.length && sizes.length && plausibleName(L)) { flush(); }
      pending.push(L);
      if (pending.length > 8) pending.shift();
    }
    flush();

    /* Now the page has been read, so the furniture is countable. */
    var tfreq = {}, ti, tj, tk;
    for (ti = 0; ti < out.length; ti++) {
      var seenT = {};
      for (tj = 0; tj < out[ti]._cands.length; tj++) {
        tk = out[ti]._cands[tj].toLowerCase();
        if (seenT[tk]) continue;
        seenT[tk] = 1;
        tfreq[tk] = (tfreq[tk] || 0) + 1;
      }
    }
    var picked = [];
    for (ti = 0; ti < out.length; ti++) {
      var bf = Infinity, bn = "";
      for (tj = 0; tj < out[ti]._cands.length; tj++) {
        var cf = tfreq[out[ti]._cands[tj].toLowerCase()] || 1;
        if (cf < bf) { bf = cf; bn = out[ti]._cands[tj]; }
        if (bf === 1) break;
      }
      delete out[ti]._cands;
      if (!bn) continue;
      out[ti].name = bn;
      picked.push(out[ti]);
    }
    out = picked;

    /* Three is the floor, same as the DOM layer: two priced things on a page are
       as likely to be a cart total and a subtotal as a menu. */
    DIAG.fromText = out.length;
    return out.length >= 3 ? out : [];
  }

  /* Fill blanks on `dst` from `src`, never overwrite an answer with another
     answer: two arrays describing the same product disagree only because one of
     them is a summary, and the summary is the one that is short.

     SIZES ARE THE EXCEPTION AND THE POINT. A thin array publishes one flat "One
     Size" row carrying no weight, which is not a blank -- it is a wrong answer
     that looks like a real one, and every price-per-gram on the site is built
     on it. So the row set with more WEIGHTS wins outright, and a longer set
     wins only when it does not lose weights. */
  function enrichRow(dst, src) {
    var TEXT = ["brand", "description", "category", "type", "image", "coa", "deal",
                "batch", "packagedDate", "url"];
    var did = false, i, f;
    for (i = 0; i < TEXT.length; i++) {
      f = TEXT[i];
      if (!dst[f] && src[f]) { dst[f] = src[f]; did = true; }
    }
    if ((dst.thc == null || isNaN(dst.thc)) && src.thc != null && !isNaN(src.thc)) { dst.thc = src.thc; did = true; }
    if ((dst.cbd == null || isNaN(dst.cbd)) && src.cbd != null && !isNaN(src.cbd)) { dst.cbd = src.cbd; did = true; }
    var withG = function (rows) {
      var n = 0;
      for (var k = 0; k < rows.length; k++) if (rows[k].grams > 0) n++;
      return n;
    };
    var dg = withG(dst.sizes), sg = withG(src.sizes);
    if (sg > dg || (sg === dg && src.sizes.length > dst.sizes.length)) { dst.sizes = src.sizes; did = true; }
    return did;
  }

  function harvest() {
    refreshShadow(true);
    var seen = new Set(), best = [], roots = [];

    try {
      var nd = document.getElementById("__NEXT_DATA__");
      if (nd && nd.textContent) roots.push(JSON.parse(nd.textContent));
    } catch (e) {}
    var rsc = rscRoots();
    for (var q = 0; q < rsc.length; q++) roots.push(rsc[q]);
    /* REMIX, FROM THE MARKUP. The window loop below also picks up a hydrated
       `window.__remixContext`, and on a page that has finished hydrating that is
       often enough -- but not always, and the two are not the same thing. The
       deferred data arrives as __remixContext.r(...) CALLS, whose JSON arguments
       may still be unresolved promises on the object while sitting in plain
       sight in the markup. Reading both and letting the walk dedupe costs one
       pass over the HTML and is the difference between five rows and a menu. */
    var rmx = [];
    try { rmx = remixRoots(document.documentElement.innerHTML); } catch (e) {}
    for (var q2 = 0; q2 < rmx.length; q2++) roots.push(rmx[q2]);
    DIAG.remix = rmx.length;
    var tags = document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]');
    for (var t = 0; t < tags.length && t < 40; t++) {
      try { roots.push(JSON.parse(tags[t].textContent)); } catch (e) {}
    }
    for (var key in window) {
      if (!/^(__|_?[A-Z])/.test(key)) continue;           // __NEXT_DATA__, __APOLLO_STATE__, Shopify, …
      try { var v = window[key]; if (v && typeof v === "object") roots.push(v); } catch (e) {}
    }

    /* APOLLO'S CACHE IS A MAP BEHIND A METHOD CALL, and both halves of that are
       why every scan above walks straight past it.
     *
       The loop above DOES pick up window.__APOLLO_CLIENT__ -- it matches the
       key test and it is an object -- but the products are not properties of
       it. They are inside an InMemoryCache and only come out of
       cache.extract(), which no property walk will ever call. And what comes
       out is NORMALISED: an object keyed "Product:abc123", not an array, so the
       largest-product-shaped-ARRAY contest cannot see it either even once it is
       in hand.
     *
       Measured on a live Dutchie menu: extract() held 145 fully structured
       products -- names, brands, categories, weights, pricing, specials --
       against ~100 partially rendered DOM cards, with bestArray reporting 0.
       That is the single richest source on those pages and it was invisible.
     *
       REFERENCES ARE RESOLVED ONE LEVEL, because Apollo replaces nested objects
       with {__ref:"Product:x"} pointers. Left alone, a product's variants read
       as a list of pointers and variantRows() finds no prices -- which would
       look exactly like a menu that does not publish sizes. */
    (function apolloRoots() {
      var maps = [];
      try {
        var c = window.__APOLLO_CLIENT__;
        if (c && c.cache && typeof c.cache.extract === "function") maps.push(c.cache.extract());
      } catch (e) { DIAG.apolloError = String((e && e.message) || e); }
      try { if (window.__APOLLO_STATE__ && typeof window.__APOLLO_STATE__ === "object") maps.push(window.__APOLLO_STATE__); } catch (e) {}
      for (var mi = 0; mi < maps.length; mi++) {
        var m = maps[mi]; if (!m || typeof m !== "object") continue;
        /* BOUNDED, BECAUSE THE FIRST HEADLESS RUN TIMED OUT ON SIX SHOPS.
           Runtime.evaluate is what injects this file, and it does not return
           until the IIFE does -- so anything expensive here is not slow, it is
           a hang, reported as "Runtime.evaluate timed out" with no hint that
           the cause is a reader rather than the network. A real Apollo cache is
           not the 145 products that motivated this; it also holds every query
           result, every fragment and every UI object the app has ever
           normalised, and the deref below DEEP-COPIES each one. Copy only what
           could be a product, and cap the number of entries considered. */
        var deref = function (v, d) {
          if (!v || typeof v !== "object" || d > 3) return v;
          if (v.__ref) return m[v.__ref] ? deref(m[v.__ref], d + 1) : v;
          if (Array.isArray(v)) { var a = [], i; for (i = 0; i < v.length; i++) a.push(deref(v[i], d + 1)); return a; }
          var o = {}, k;
          for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = deref(v[k], d + 1);
          return o;
        };
        var rows = [], kk, seenKeys = 0;
        for (kk in m) {
          if (!Object.prototype.hasOwnProperty.call(m, kk)) continue;
          if (kk === "ROOT_QUERY" || kk === "ROOT_MUTATION") continue;
          if (++seenKeys > 6000) { DIAG.apolloCapped = 1; break; }
          var ent = m[kk];
          /* The cheap test BEFORE the expensive copy: a product has a name, and
             a normalised entry announces its own type. Everything else in the
             cache is skipped without being walked at all. */
          if (!ent || typeof ent !== "object") continue;
          var nm = ent.name || ent.title || ent.productName;
          if (typeof nm !== "string" || !nm) continue;
          try { rows.push(deref(ent, 0)); } catch (e) {}
        }
        if (rows.length) { roots.push(rows); DIAG.apollo = (DIAG.apollo || 0) + rows.length; }
      }
    })();

    /* EVERY product-shaped array is kept, not just the biggest one. "Largest
       wins" answers the wrong question: a page can carry a LONG THIN array --
       names, links and one flat price, no photo, no description, no weights --
       alongside a SHORTER RICH one, and the long one wins on count while
       carrying almost nothing.

       THCA Small Buds reported exactly that: 126 rows at 371 bytes each, which
       is a row with no image, no description, no category and a single "One
       Size" price. `withGrams` was 0 for the whole store, so no price-per-gram,
       no ranking and no best-$/g badge -- the site's entire proposition -- off
       a page whose weights were sitting in a different array the whole time.

       The other arrays therefore ENRICH the chosen one and are never allowed to
       ADD to it. That asymmetry is the safety property: a recommendations rail,
       a recently-viewed list or a cart is also product-shaped, and unioning
       those in would put things on the shelf the shop never had on this page.
       Filling a blank field on a product already found cannot do that. */
    /* A PRICE TIER IS NOT A PRODUCT, AND IT SATISFIES EVERY TEST THAT SAYS ONE
       IS. The Dude Abides publishes a weight table -- {name:"Ounce (28g)",
       weight:28, price:5000} -- and it won outright on the only rule this walk
       had: it has a name, it has a price, and there are more of them than any
       single carousel holds. The store read as FIVE ROWS keyed
       `name,weight,price`, which is worse than an error because it looks like a
       working scrape of a five-product dispensary.

       So an array is judged on how much CATALOGUE it carries, not only on
       length. A real listing has a brand, a category, a picture or its own
       product name; a tier has a weight and a price. Length still breaks ties,
       so every store that read correctly before is unaffected. Ported from
       api/coldwater.js, which learned this first -- see the header on
       remixRoots() for why that gap existed at all. */
    var CATALOGUE_KEYS = ["brand", "category", "product_name", "productName", "variant_name",
                          "variantName", "sku", "image", "image_url", "imageUrl", "thumbnail",
                          "strain", "description", "slug"];
    function catalogueScore(arr) {
      var n = 0, lim = Math.min(arr.length, 24), a, kk;
      for (a = 0; a < lim; a++) {
        for (kk = 0; kk < CATALOGUE_KEYS.length; kk++) {
          var val = arr[a] && arr[a][CATALOGUE_KEYS[kk]];
          if (val != null && val !== "") n++;
        }
      }
      return lim ? n / lim : 0;
    }

    var cands = [], bestScore = -1, union = {}, unionN = 0;
    function walk(node, depth) {
      /* DEPTH 14, NOT 8, and this alone was costing the whole menu. Remix nests
         its loader data as root > state > loaderData > <routeId> > <deferredKey>
         > [carousel] > products > product -- nine levels before a product is
         even visible -- so the rows were being cut off by the guard rather than
         missed by the parser. The `seen` set is what actually stops this running
         away; the depth number is a belt, and it was buckled too tight. */
      if (!node || depth > 14 || seen.has(node)) return;
      if (typeof node === "object") seen.add(node);
      if (Array.isArray(node)) {
        var hits = node.filter(looksLikeProduct);
        if (hits.length >= 3 && cands.length < 40) cands.push(hits);
        if (hits.length) {
          var sc = catalogueScore(hits);
          /* Clearly richer wins outright; similarly rich, longer wins. */
          var better = sc > bestScore + 0.5 ? true
                     : sc < bestScore - 0.5 ? false
                     : hits.length > best.length;
          if (better) { best = hits; bestScore = sc; }
          /* THE UNION, BESIDE THE LARGEST ARRAY, because a carousel menu has
             neither shape "largest array wins" was written for. The Dude Abides
             ships ~14 carousels of TWELVE -- "Best Selling", "New", "On Sale" --
             so the largest single array is 12 while the page carries ~167.
             Taking the largest reports a twelve-product dispensary and looks
             like a success.

             This does NOT weaken the enrich-never-add rule below. That rule
             exists so a recommendations rail cannot ADD rows, and it still
             cannot: the union is keyed on name + variant + price and only
             replaces `best` when it is strictly bigger, so a rail's dozen
             entries are absorbed as duplicates of jars already found rather
             than appended as new ones. A facet or filter cannot get in at all --
             looksLikeProduct requires a price. */
          /* THE UNION IS FOR CATALOGUE ARRAYS ONLY, and leaving this out put the
             price tiers back on the shelf by the back door: they lose the
             `best` contest on catalogueScore and then walk straight into the
             union, which is bigger than best and replaces it. Same five rows,
             one layer along. A tier scores 0 here -- no brand, no category, no
             image, no product name -- so the threshold costs nothing and a shop
             whose products genuinely carry none of those keys still gets the
             length rule above, exactly as before. */
          for (var h = 0; h < hits.length && sc > 0.5; h++) {
            var o = hits[h];
            var uk = [ (o && (o.name || o.title || o.product_name || o.productName)) || "",
                       (o && (o.variant_name || o.variantName)) || "",
                       (o && (o.price != null ? o.price : o.cost)) || "" ].join("|");
            if (!union[uk]) { union[uk] = o; unionN++; }
          }
        }
        for (var i = 0; i < node.length && i < 4000; i++) walk(node[i], depth + 1);
        return;
      }
      if (typeof node !== "object") return;
      for (var k in node) { try { walk(node[k], depth + 1); } catch (e) {} }
    }
    for (var r = 0; r < roots.length; r++) walk(roots[r], 0);

    if (unionN > best.length) {
      var u = [];
      for (var ukey in union) if (Object.prototype.hasOwnProperty.call(union, ukey)) u.push(union[ukey]);
      best = u;
    }
    DIAG.union = unionN;

    DIAG.roots = roots.length;
    DIAG.nextF = !!(window.__next_f && window.__next_f.length);
    DIAG.rsc = rsc.length;
    DIAG.bestArray = best.length;

    var out = [];
    for (var j = 0; j < best.length; j++) { var n = normalise(best[j]); if (n && n.name && n.sizes.length) out.push(n); }
    DIAG.fromState = out.length;

    /* Fill the blanks from the other arrays. Never adds a row -- see above. */
    if (cands.length > 1 && out.length) {
      var byK = {}, e2;
      for (e2 = 0; e2 < out.length; e2++) byK[keyOf(out[e2])] = out[e2];
      var filled = 0, looked = 0;
      for (e2 = 0; e2 < cands.length; e2++) {
        if (cands[e2] === best) continue;
        for (var q2 = 0; q2 < cands[e2].length && looked < 6000; q2++) {
          looked++;
          var nr = normalise(cands[e2][q2]);
          if (!nr || !nr.name || !nr.sizes.length) continue;
          var tgt = byK[keyOf(nr)];
          if (tgt && enrichRow(tgt, nr)) filled++;
        }
      }
      DIAG.otherArrays = cands.length - 1;
      DIAG.enriched = filled;
    }

    /* WHAT THE CHOSEN ROWS ACTUALLY CARRY. A capture can succeed on every count
       this file reports and still be worthless: 126 products, none with a
       photo, a description or a weight, is not a menu. Counting it here is what
       turned "still capping at 170" into a readable answer, so it is reported
       whether or not anything looks wrong. */
    /* MEASURED OVER THE PAGE-STATE ROWS ONLY, AND IT SAYS SO NOW. This used to
       be called rowCoverage and reported as though it described the capture. It
       does not: `out` is what the page-state layer produced, so on any page the
       DOM layer answers -- which is most of Banzen -- it reads
       {img:0,desc:0,cat:0,sizes:0,grams:0} however good the capture actually is.
       Reported as "rowCoverage all zeros, so its row parser isn't matching this
       template", which is a reasonable reading of a number that was lying: the
       same diagnostic blob carried `withGrams: 76` against a 119-row batch, and
       the two cannot both be true. The real figure is computed over the batch
       below, after every layer has contributed. */
    var cov = { img: 0, desc: 0, cat: 0, sizes: 0, grams: 0 }, c2;
    for (c2 = 0; c2 < out.length; c2++) {
      if (out[c2].image) cov.img++;
      if (out[c2].description) cov.desc++;
      if (out[c2].category) cov.cat++;
      if (out[c2].sizes.length > 1) cov.sizes++;
      if (out[c2].sizes.some(function (s) { return s.grams > 0; })) cov.grams++;
    }
    DIAG.stateCoverage = cov;

    /* WHAT THE PAGE ITSELF SAYS IT HOLDS, which turns a row count into a
       fraction. "13 rows" is unreadable on its own: a category with 13 products
       and a category with 235 showing its first screen look identical from
       outside, and telling them apart is the difference between a finished
       capture and one that has barely started. Banzen states total_count per
       category in its own payload, so this is the platform's own number rather
       than anything inferred -- the same reason api/products.js reads Woo's
       X-WP-Total instead of guessing from page lengths.

       DECLARED KEYS ONLY, and the largest of them. Anything cleverer is a guess
       about someone else's schema; a key literally named total_count is not. */
    var TOTAL_KEYS = ["total_count", "totalCount", "totalProducts", "total_results", "totalResults"];
    var declared = 0;
    (function scanTotals(node, depth) {
      if (!node || depth > 8 || typeof node !== "object") return;
      var kk, vv;
      for (kk in node) {
        if (!Object.prototype.hasOwnProperty.call(node, kk)) continue;
        vv = node[kk];
        if (TOTAL_KEYS.indexOf(kk) >= 0 && typeof vv === "number" && vv > declared && vv < 1e6) declared = vv;
        else if (vv && typeof vv === "object") { try { scanTotals(vv, depth + 1); } catch (e) {} }
      }
    })({ roots: roots }, 0);
    if (declared) DIAG.pageSays = declared;
    /* The chosen array's own shape, by KEY NAME only -- never a value, since
       this travels in a diagnostic. It is the one thing that says why a reader
       came back thin, and it cannot be inferred from any count. */
    try { DIAG.pickedKeys = Object.keys(best[0] || {}).slice(0, 24).join(","); } catch (e) {}
    DIAG.arrays = cands.map(function (a) { return a.length; })
      .sort(function (a, b) { return b - a; }).slice(0, 8).join(",");

    /* STATE AND REACT ARE UNIONED, NOT RACED, and this is the fix for a shop
       that "caps out" at a number smaller than its menu.

       Returning at the first layer that produced anything assumed the layers
       were alternatives. They are not: page state is whatever the SERVER put in
       the initial HTML, which for a paginated or lazily-fetched menu is the
       first page and nothing else, while React props hold what the app has
       actually loaded since. Herbology answered "16 via page state" and the
       richer live state was never looked at, because 16 is not zero.

       Both are real fields, so the union is safe and strictly better. The DOM
       layer stays a genuine last resort: it carries no strain, category or THC,
       and letting thin rows overwrite rich ones by name would quietly degrade a
       good capture. */
    var fromReact = reactHarvest();
    if (fromReact.length) {
      var have = {}, u;
      for (u = 0; u < out.length; u++) have[String(out[u].name).trim().toLowerCase()] = 1;
      for (u = 0; u < fromReact.length; u++) {
        var k2 = String(fromReact[u].name).trim().toLowerCase();
        if (k2 && !have[k2]) { have[k2] = 1; out.push(fromReact[u]); }
      }
    }
    if (out.length) {
      DIAG.via = (DIAG.fromState && fromReact.length) ? "page state + React props"
               : (DIAG.fromState ? "page state" : "React props");
      return out;
    }

    out = domHarvest();
    DIAG.fromDom = out.length;
    if (out.length) { DIAG.via = "rendered page"; return out; }

    out = textHarvest();
    if (out.length) { DIAG.via = "printed text"; return out; }

    /* Nothing worked -- record the things that explain why, so the panel can
       say something actionable instead of "nothing found". */
    DIAG.iframes = document.querySelectorAll("iframe").length;
    try {
      var blocked = [].filter.call(document.querySelectorAll("iframe"), function (f) {
        try { return !f.contentDocument; } catch (e) { return true; }
      });
      DIAG.crossOriginIframes = blocked.length;
      /* THE SRC IS READABLE EVEN WHEN THE CONTENTS ARE NOT, and that is the
         whole difference between an instruction and a link. Same-origin policy
         blocks contentDocument; the attribute is just an attribute on this
         page. So the panel can hand over the exact URL to open instead of
         telling somebody to hunt for "This Frame -> Open Frame in New Tab",
         which is a different menu in every browser and absent on a phone.
         A Dutchie embed's own url IS the menu (dutchie.com/embedded-menu/
         <slug>/products), so opening it puts the collector on a page it can
         read, first party, with nothing bypassed. */
      DIAG.frameUrls = blocked.map(function (f) {
        try { return String(f.src || ""); } catch (e) { return ""; }
      }).filter(function (u) {
        return /^https?:/i.test(u) && u.indexOf("about:") !== 0;
      }).slice(0, 6);
    } catch (e) {}
    /* Count the shadow text as well. Reporting "no prices on this page" for a
       page whose entire menu is one shadow root away is the same lie the whole
       layer had been telling, just in the diagnostic instead of the result. */
    var pageText = (document.body && document.body.innerText) || "";
    for (var sh = 0; sh < SHADOW.length; sh++) {
      try { pageText += "\n" + (SHADOW[sh].textContent || ""); } catch (e) {}
    }
    DIAG.bodyChars = pageText.length;
    DIAG.pricesOnPage = (pageText.match(/\$\s?\d/g) || []).length;

    /* A CLOSED SHADOW ROOT CANNOT BE COUNTED, because el.shadowRoot is null by
       design -- that is the whole point of closed mode. So it is inferred from
       its signature instead: an element with no children and no text that is
       nevertheless occupying real space on screen. Something is rendering
       there that this script is not allowed to see, which is a completely
       different situation from "the page has no prices" and needs to be said
       differently. Honest inference, not a way in. */
    var opaque = 0;
    try {
      var maybe = document.querySelectorAll("div,section,main,article,*[id],*[class]");
      for (var z = 0; z < maybe.length && z < 4000; z++) {
        var m = maybe[z];
        if (m.children.length) continue;
        if (String(m.textContent || "").trim()) continue;
        if (m.offsetHeight > 150 && m.offsetWidth > 150) opaque++;
      }
    } catch (e) {}
    DIAG.opaqueHosts = opaque;
    return out;
  }

  /* --------------------------------------------------------------- panel --- */

  function panel(html, actions) {
    var old = document.getElementById("ll-collector");
    if (old) old.remove();
    var d = document.createElement("div");
    d.id = "ll-collector";
    d.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:340px;max-width:calc(100vw - 32px);" +
      "background:#0d1418;color:#eaf2f6;font:14px/1.5 system-ui,-apple-system,sans-serif;border:1px solid #4ec9ff;" +
      "border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.55);padding:16px";
    /* A PAGE MAY REFUSE innerHTML OUTRIGHT. cookies-detroit sets
       require-trusted-types-for 'script', so this assignment THROWS -- and it
       threw from noMenuPanel, i.e. while trying to report that no menu was
       found. The capture was fine; drawing the report about it killed the run.
       The panel is a courtesy to a human and there is no human in the scheduled
       lane, so it degrades to text rather than taking the harvest with it. */
    try {
      d.innerHTML = '<div style="font-weight:700;color:#4ec9ff;margin-bottom:8px">Legal-Leaf collector</div>' + html;
    } catch (e) {
      DIAG.panelBlocked = String((e && e.message) || e).slice(0, 120);
      d.textContent = "Legal-Leaf collector — this page blocks rich HTML (Trusted Types). " +
        "The capture still ran; use Copy capture or read the console.";
    }
    document.body.appendChild(d);
    (actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.textContent = a.label;
      b.style.cssText = "margin:10px 8px 0 0;padding:8px 14px;border-radius:999px;border:0;cursor:pointer;font-weight:700;" +
        (a.primary ? "background:#4ec9ff;color:#06202b" : "background:transparent;color:#9fb4c2;border:1px solid #2b3b45");
      b.onclick = a.fn;
      d.appendChild(b);
    });
    return d;
  }
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  /* ----------------------------------------------------------------- run --- */

  /* ---- the batch: what survives between runs in this tab ------------------
     A MENU IS OFTEN BIGGER THAN THE PAGE. Jane VIRTUALISES its list, so only
     the ~22 cards currently on screen exist in the DOM at all -- scroll and the
     others are destroyed as these are created. Dutchie paginates. Either way a
     single harvest() sees a slice, and the operator watching the count stick at
     22 is looking at the page's rendering strategy rather than at a bug here.

     So every run MERGES into a batch held in sessionStorage for this tab. Scroll
     or click to the next page, run it again, and the batch grows; Send posts the
     whole batch. Keyed by name, so re-reading the same card is free and a
     refreshed price wins. Cleared explicitly, and scoped to the tab so it cannot
     leak into a capture of a different shop tomorrow. */
  /* SCOPED TO THE SHOP, not just to the tab. A batch that survived navigation
     within one tab would follow the operator from Sapura to Herbology and post
     one shop's rows under the other's key -- a silent, plausible-looking
     corruption of the shelf, which is worse than any failure this tool has had.
     Origin alone is not enough: Sapura and Exclusive are BOTH on dutchie.com and
     differ only by the shop id in the path. So the scope is the origin plus the
     first two path segments, which is exactly the shop on every platform here:
       dutchie.com/embedded-menu/<shop>/products/flower
       greentreerelief.com/coldwater/menu/all
       shophcc.com/shop/coldwater
     Different collections of the same shop share it, which is the point. */
  /* TWO PATH SEGMENTS WAS TOO NARROW, AND IT IS WHY A BATCH VANISHES.
     Reported as "sometimes when you change screens it doesn't bring along what
     you already grabbed", which is exactly what this key does on a Shopify
     store: /collections/thca-products and /collections/thca-flower are the same
     shop and got different batches, and a product page (/products/<handle>) got
     a third. Page through one collection and the batch grows; click into a
     product or across to another collection and it reads as empty, because it
     IS a different batch. Nothing was lost -- it was filed somewhere the next
     run does not look, which is worse, because it looks like data loss and is
     not recoverable by trying again.

     The two segments existed for a real reason: dutchie.com hosts many shops
     and they differ only by the id in the path, so Sapura and Exclusive must
     not share. That is a property of the HOST, not of every host -- so the
     narrow scope is now asked for by name and everything else keys on the host,
     which is the shop. */
  /* HOSTS THAT SERVE MORE THAN ONE SHOP, so the batch is scoped by path as well
     as by host. Getting this wrong merges two towns' menus into one capture.
     lume.com was added after the harvester suite found the leak: Lume runs 38
     Michigan stores under www.lume.com/stores/<town>-mi-dispensary, so without
     the path in the key, capturing Coldwater and then Monroe pools both into
     ll_collector_batch:www.lume.com and publishes one town's prices under the
     other's heading -- the exact failure fromLume()'s expectLocation guard
     exists to prevent, arriving by a route that guard never sees.
     A chain on its own domain belongs in this list. */
  var MULTI_SHOP_HOST = /(^|\.)(dutchie\.com|iheartjane\.com|dispensary\.shop|leafly\.com|weedmaps\.com|lume\.com)$/i;
  var BATCH_KEY = (function () {
    var scope = location.host;
    if (MULTI_SHOP_HOST.test(location.host)) {
      var parts = location.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
      if (parts) scope += "/" + parts;
    }
    return "ll_collector_batch:" + scope;
  })();

  /* AND IT LIVES IN localStorage NOW, NOT sessionStorage.
     sessionStorage is per TAB. Open a product in a new tab, let the shop open
     one for you, or reopen the menu after closing it, and the batch is gone --
     the same complaint, a second cause, and the one that cannot be fixed by any
     amount of re-keying. localStorage is per origin and survives all three.

     What sessionStorage was buying was expiry: a batch could not outlive the
     tab and so could not leak into a capture taken next week. That is a real
     risk and it is kept explicitly instead -- the batch carries the time it was
     last written and anything older than TTL is dropped on read, so a stale
     shelf cannot be sent by somebody who does not know it is there. */
  var BATCH_TTL_MS = 18 * 60 * 60 * 1000;      // long enough for one sitting, not for one week
  /* ITS OWN KEY, NOT A MEMBER OF THE BATCH. Kept inside the object it stamps,
     the timestamp is one more thing every reader has to know is not a product,
     and three of them already had to be taught: the row counter, the re-key
     migration and the description-shedding retry. Anything that iterates the
     batch and forgets becomes an off-by-one nobody notices. Outside it, there
     is nothing to forget. */
  var STAMP_KEY = BATCH_KEY + ":at";
  var STORE = (function () {
    try { localStorage.setItem("ll_probe", "1"); localStorage.removeItem("ll_probe"); return localStorage; }
    catch (e) { try { return sessionStorage; } catch (e2) { return null; } }
  })();
  /* MEM_BATCH is set only once sessionStorage has refused a write. The run then
     carries on in memory rather than silently dropping everything read after
     that point -- it will not survive the next page, and the panel says so. */
  var MEM_BATCH = null;
  function loadBatch() {
    if (MEM_BATCH) return MEM_BATCH;
    if (!STORE) return {};
    var raw;
    try { raw = JSON.parse(STORE.getItem(BATCH_KEY) || "{}") || {}; } catch (e) { return {}; }
    /* Expiry, since this store has none of its own. A batch older than the TTL
       is dropped rather than sent: rows captured yesterday are a price list
       that has already changed. */
    var at = 0;
    try { at = Number(STORE.getItem(STAMP_KEY)) || 0; } catch (e) {}
    if (at) {
      if ((Date.now() - at) > BATCH_TTL_MS) {
        /* HOW MANY, AND HOW OLD, because the drop itself was silent and a silent
           drop is indistinguishable from storage failing. Reported as a batch
           that "read 97 when I opened the page and 0 a few minutes later,
           without me touching Clear" -- which is this working exactly as
           designed, and looking like a bug because nothing said so. */
        var n = 0, kk;
        for (kk in raw) if (Object.prototype.hasOwnProperty.call(raw, kk)) n++;
        DIAG.batchExpired = true;
        DIAG.batchExpiredRows = n;
        DIAG.batchExpiredHours = Math.round((Date.now() - at) / 36e5);
        try { STORE.removeItem(BATCH_KEY); STORE.removeItem(STAMP_KEY); } catch (e) {}
        return {};
      }
    }
    return pruneUnstorable(migrate(raw));
  }

  /* A BATCH LEFT BY THE OLD COLLECTOR IS KEYED BY BARE NAME, and the operator
     who reported the cap has one sitting in their tab right now. Loaded as-is
     it does not merge with anything: the same product read again keys as
     "u:<link>", finds no entry under it, and is added a SECOND time. The count
     jumps, which looks like the fix working, and half the batch is duplicates.

     So a legacy batch is re-keyed once on read rather than left to collide.
     Nothing is thrown away -- these are rows the operator already paid for by
     paging through the menu -- and where two legacy rows now resolve to one
     product the richer of the two wins, which is the rule everywhere else. */
  function migrate(b) {
    var k, legacy = false;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      if (k.indexOf("u:") !== 0 && k.indexOf("n:") !== 0) { legacy = true; break; }
    }
    if (!legacy) return b;
    var out = {}, nk;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      nk = (k.indexOf("u:") === 0 || k.indexOf("n:") === 0) ? k : keyOf(b[k]);
      if (!out[nk] || rowScore(b[k]) >= rowScore(out[nk])) out[nk] = b[k];
    }
    DIAG.batchMigrated = true;
    saveBatch(out);
    return out;
  }

  /* A ROW THE ENDPOINT CAN NEVER STORE DOES NOT BELONG IN THE BATCH.
   *
     The batch outlives a fix, and this one it outlived. Before product urls
     were resolved properly, a relative href was stored raw -- "products/x" --
     which the endpoint refuses for want of ^https?:. The rows are still sitting
     in localStorage, and RE-CAPTURING CANNOT REPLACE THEM: keyOf() keys on the
     url, so the same product read again resolves to a different key and lands
     BESIDE its broken twin rather than over it. The batch only grows, and every
     send reports the same drop forever.

     Reported as "Sent 835 of 1485. 650 rows were dropped" -- on a shop where
     the reader was working perfectly and 650 rows were simply a fossil of the
     hour before. Pruned once, on read, and counted: the panel says what went
     and why, because a batch that shrinks on its own is the exact shape of the
     storage failure this file has already been blamed for twice.

     ONLY THE UNUSABLE. A row with no url at all still reaches this file with
     location.href in that field -- that is the rendered-page layer's documented
     fallback, it is a real address, and captureKeyer knows a url carrying many
     names is a page rather than an identity. Nothing that could be stored is
     touched. */
  function pruneUnstorable(b) {
    var out = {}, k, r, gone = 0, sample = [];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      r = b[k] || {};
      if (/^https?:\/\//i.test(String(r.url || ""))) { out[k] = r; continue; }
      gone++;
      if (sample.length < 3) sample.push(String(r.name || "?") + " -> " + String(r.url || "(none)").slice(0, 60));
    }
    if (!gone) return b;
    DIAG.batchPruned = gone;
    DIAG.batchPrunedSample = sample;
    saveBatch(out);
    return out;
  }
  /* A FAILED WRITE USED TO BE SWALLOWED WHOLE, and that is indistinguishable
     from the bug this file was just fixed for: the count stops moving, every
     further page adds nothing, and nothing anywhere says why. Storage is best
     effort, but the operator has to be told which effort they got. Descriptions
     are the bulk of a batch and the shelf can live without them, so they are
     shed before the products are. */
  function saveBatch(b) {
    var s, k, f;
    if (!STORE) { MEM_BATCH = b; DIAG.batchSaveError = "this browser refuses storage"; return; }
    try { s = JSON.stringify(b); }
    catch (e) { MEM_BATCH = b; DIAG.batchSaveError = "could not serialise"; return; }
    try {
      STORE.setItem(BATCH_KEY, s);
      /* Stamped on every write, so the age read back is that of the newest row
         rather than of the first. */
      try { STORE.setItem(STAMP_KEY, String(Date.now())); } catch (e) {}
      MEM_BATCH = null; DIAG.batchBytes = s.length; delete DIAG.batchSaveError;
      return;
    } catch (e2) { /* out of room -- try again with less */ }

    var lean = {};
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      lean[k] = {};
      for (f in b[k]) if (Object.prototype.hasOwnProperty.call(b[k], f)) lean[k][f] = b[k][f];
      lean[k].description = "";
    }
    try {
      s = JSON.stringify(lean);
      STORE.setItem(BATCH_KEY, s);
      MEM_BATCH = null; DIAG.batchBytes = s.length; DIAG.batchTrimmed = true;
      delete DIAG.batchSaveError;
      return;
    } catch (e3) {}
    MEM_BATCH = b;
    DIAG.batchSaveError = "this tab's storage is full";
  }
  /* THE RICHER ROW WINS, and this is not a refinement -- it is the same rule
     harvest() applies between its layers, which was missing BETWEEN successive
     merges. A scroll scan harvests once per tick, and a tick that happens to
     land mid-re-render falls back to the DOM layer, which carries no strain, no
     category, no THC and no batch tag. Overwriting by name alone let that thin
     row replace a rich one already captured, so a long scan could END with less
     information than it had a third of the way through -- invisibly, since the
     COUNT never drops. Score what a row actually carries and keep the better. */
  function rowScore(p) {
    if (!p) return -1;
    var n = 0;
    if (p.thc != null && p.thc !== "") n += 3;
    if (p.batch) n += 3;
    if (p.strain) n += 2;
    if (p.category) n += 2;
    if (p.coa) n += 2;
    if (p.image) n += 1;
    if (p.deal) n += 1;
    if (p.url) n += 1;
    if (p.sizes && p.sizes.length) n += Math.min(p.sizes.length, 4);
    return n;
  }
  /* THE BATCH WAS KEYED BY NAME, AND THAT WAS THE CAP. A title is not an
     identity. THCA Small Buds sells one strain as several listings, so its
     /collections/thca-products runs to hundreds of rows over about 170 distinct
     titles -- and keyed by name the batch stopped dead at 170 while the
     operator kept paging, each page replacing rows instead of adding them.
     Reported as "capping out at 170 and not saving from page to page", which is
     precisely what it was doing, and it looked like storage failing or the
     scraper missing pages. Neither: it was reading two products as one.

     The link is the identity, because it is the only thing the shop itself
     treats as one. DELIBERATE TWIN of captureKeyer() in api/coldwater-ingest.js
     -- a static file served onto a shop's origin cannot import from api/, the
     same constraint that makes public/js/overrides.js carry its own _applyOv
     and rscRoots() exist here and there. Change one, change the other, or the
     browser and the server will disagree about what a product is.

     EXCEPT A URL THAT IS NOT A PRODUCT'S. The rendered-page and printed-text
     layers have no per-card link and fall back to location.href, so keying on
     that would collapse a whole page into one row -- the same failure, an order
     of magnitude worse. A row whose link is just the page we are standing on
     keys by name, exactly as it did before. */
  function normUrl(u) {
    return String(u == null ? "" : u).replace(/^\s+|\s+$/g, "")
      .split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
  var HERE = normUrl(location.href);

  /* A URL SHARED BY SEVERAL DIFFERENT PRODUCTS IS NOT AN IDENTITY EITHER, and
     this was the half of the rule that only ever existed on the server.
     captureKeyer() in api/coldwater-ingest.js collects the names seen against
     each url, marks any url carrying MORE THAN ONE name as ambiguous, and keys
     those rows by name. This file -- its deliberate twin, three lines away from
     a comment saying "change one, change the other" -- only ever tested
     `u !== HERE`.

     BANZEN IS WHAT THAT COSTS. Its menu links every card to a BRAND page
     (/menu/brands/jeeter-365986), not a product page. Those urls are not
     location.href, so every one of them passed the old test, and all 308 vape
     pens from one brand landed on one key and overwrote each other. Audited on
     the live site: 1,465 products (confirmed twice -- the sum of each category's
     own total_count, and the 1,465 urls in products-sitemap.xml) captured as 12
     rows. The shop has 104 brands, which is the real ceiling the batch was
     stuck under, and the "97 products" the panel had been reporting was 97
     BRANDS.

     AND IT COLLAPSES IN THE BROWSER, WHICH IS WHY THE SERVER'S CORRECT RULE
     NEVER HELPED. The rows are already gone by the time anything is posted, so
     captureKeyer receives 12 and dedupes 12. Fixing the server would have
     changed nothing at all -- the same trap the remixRoots gap set, where one
     twin was right and the surface that mattered was the other one.

     MORE SCROLLING CANNOT FIX A KEYING BUG. It reads as a truncated scan and
     sends you to the scroller, which is where the last two evenings went. */
  function ambiguousUrls(rows) {
    var namesFor = {}, out = {}, i, u, n, c;
    for (i = 0; i < rows.length; i++) {
      u = normUrl(rows[i] && rows[i].url);
      if (!u || u === HERE) continue;
      n = String((rows[i] && rows[i].name) || "").trim().toLowerCase();
      if (!n) continue;
      if (!namesFor[u]) namesFor[u] = {};
      namesFor[u][n] = 1;
    }
    for (u in namesFor) {
      if (!Object.prototype.hasOwnProperty.call(namesFor, u)) continue;
      c = 0;
      for (n in namesFor[u]) { if (Object.prototype.hasOwnProperty.call(namesFor[u], n)) { c++; if (c > 1) break; } }
      if (c > 1) out[u] = 1;
    }
    return out;
  }

  function keyOf(p, amb) {
    var u = normUrl(p && p.url);
    if (u && u !== HERE && !(amb && amb[u])) return "u:" + u;
    return "n:" + String((p && p.name) || "").trim().toLowerCase();
  }

  function countKeys(o) {
    var n = 0, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++;
    return n;
  }

  /* RE-KEYED OVER THE WHOLE BATCH, NOT APPENDED TO IT, because ambiguity is a
     property of the SET and cannot be decided one row at a time. The first
     product of a brand looks perfectly unambiguous; it is the second that proves
     the url is a brand page, and by then an append-only merge has already
     overwritten the first. Rebuilding from the union of what is held and what
     has just arrived is the same algorithm captureKeyer runs server-side, which
     is the point -- one rule, stated once, in two places that cannot import each
     other. Cost is a pass over a few thousand rows per harvest. */
  function mergeIntoBatch(list) {
    var b = loadBatch(), i, k, kept = 0, nm;
    var before = countKeys(b);

    var all = [];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) all.push(b[k]);
    for (i = 0; i < list.length; i++) all.push(list[i]);

    var amb = ambiguousUrls(all);
    DIAG.ambiguousUrls = countKeys(amb);

    /* An index of what is already held, by name. A product read off the DOM
       carries no link and so keys by name; read out of page state it keys by
       link. Without this the two layers would each keep their own copy of the
       same product and the batch would count it twice. */
    var nb = {}, byName = {};
    for (i = 0; i < all.length; i++) {
      nm = String(all[i].name || "").trim().toLowerCase();
      if (!nm) continue;
      k = keyOf(all[i], amb);
      if (k.charAt(0) === "n") {
        /* No usable link of its own: join whatever entry already carries this
           name rather than starting a second one. */
        if (byName[nm]) k = byName[nm];
      } else if (!nb[k] && byName[nm] && byName[nm].charAt(0) === "n") {
        /* Same product, held until now under a name-only key because the layer
           that read it had no link. Move it across rather than keep both. */
        nb[k] = nb[byName[nm]];
        delete nb[byName[nm]];
        byName[nm] = k;
      }
      if (!nb[k]) { nb[k] = all[i]; byName[nm] = byName[nm] || k; continue; }
      /* Ties go to the newer read, so a refreshed price still wins. `all` is
         ordered held-then-incoming, so "newer" is still the incoming row. */
      if (rowScore(all[i]) >= rowScore(nb[k])) nb[k] = all[i];
      else kept++;
      byName[nm] = byName[nm] || k;
    }

    if (kept) DIAG.thinRowsRejected = (DIAG.thinRowsRejected || 0) + kept;
    saveBatch(nb);
    var added = countKeys(nb) - before;
    DIAG.batchAdded = added;
    return added > 0 ? added : 0;
  }
  function batchList() {
    var b = loadBatch(), out = [], k;
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out.push(b[k]);
    return out;
  }

  /* THE COVERAGE THAT DESCRIBES THE CAPTURE, over the batch rather than over
     one layer's contribution. Every layer has had its turn by the time this
     runs, so a zero here is a real absence rather than an artefact of which
     reader happened to answer. */
  function batchCoverage() {
    var rows = batchList(), cov = { rows: rows.length, img: 0, desc: 0, cat: 0, sizes: 0, grams: 0 }, i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i] || {};
      if (r.image) cov.img++;
      if (r.description) cov.desc++;
      if (r.category) cov.cat++;
      if ((r.sizes || []).length > 1) cov.sizes++;
      for (var s = 0; s < (r.sizes || []).length; s++) {
        if (r.sizes[s] && r.sizes[s].grams > 0) { cov.grams++; break; }
      }
    }
    return cov;
  }

  /* SCROLL THE PAGE AND KEEP READING. The operator would do this by hand --
     scroll, look, scroll -- so doing it in a loop is the same act, faster. It
     also scrolls any inner container, because these menus often scroll a div
     rather than the window. Stops at the bottom, or when several passes in a
     row turn up nothing new, or at a hard step cap so a misbehaving page cannot
     spin forever. */
  /* QUERIES *, NOT A TAG LIST, for exactly the reason the DOM scan does. A tag
     whitelist is a guess about someone else's markup and it fails silently and
     totally when the guess is wrong: Exclusive renders its cards in CUSTOM
     ELEMENTS, and a page carrying 194 prices produced 10 candidate nodes. The
     same guess was still here in the scroller hunt, where being wrong does not
     look like a parse failure -- it looks like a shop that only has 52 products,
     because nothing ever scrolls and the virtualised list never mounts the rest.
     The overflow test below does the real work and does not care what the
     element is called, so widening the query costs a longer NodeList and
     nothing else.

     The height floor is 120, not 300: a menu pane in a modal or a short embed
     scrolls too, and 300 quietly excluded it. */
  function scrollers() {
    var out = [], all = deepAll("*"), i, e;
    var docEls = [document.documentElement, document.body];
    for (i = 0; i < all.length && i < 20000; i++) {
      e = all[i];
      /* HTML AND BODY ARE THE WINDOW'S SCROLL, already stepped by scrollBy
         below. Including them made every tick scroll the document TWICE -- once
         via the window and again via documentElement -- which on a virtualised
         list skips past cards that were never mounted. The suite caught it: the
         scan came back with 23 of the fixture's menu instead of all of it. */
      if (docEls.indexOf(e) >= 0) continue;
      try {
        if (e.scrollHeight > e.clientHeight + 120 && e.clientHeight > 120) out.push(e);
      } catch (err) { /* a detached or exotic node cannot scroll either */ }
    }
    DIAG.scrollers = out.length;
    return out;
  }
  /* "LOAD MORE" IS NOT "NEXT", AND THE DIFFERENCE DECIDES WHICH FUNCTION OWNS
     IT. A Next control REPLACES the rows on screen, so the batch has to carry
     the previous page -- that is autoPage's job. A Load-more control APPENDS to
     the rows already there, so it is simply a scroll that needs a click first,
     and stopping at it means stopping in the middle of one page.

     autoScan used to give up the moment scrolling went dry, which on these menus
     is the button, not the bottom. So: scroll to dry, press it, keep scrolling.

     NO PER-SITE SELECTORS, the same rule the extractor and nextControl follow: a
     load-more control is a clickable thing whose accessible name says so. The
     word list is deliberately narrow -- "more" alone matches "More filters" and
     "Learn more", so it is only accepted next to load/show/see/view. */
  function moreControl() {
    var els = deepAll('button,a,[role="button"]'), i, e, label, r;   // shadow roots too — see nextControl
    var mine = document.getElementById("ll-collector");
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (mine && mine.contains(e)) continue;         // never our own panel
      label = ((e.getAttribute("aria-label") || "") + " " + (e.innerText || ""))
                .trim().toLowerCase().replace(/\s+/g, " ");
      if (!/\b(load|show|see|view)\s+(\d+\s+)?more\b|\bload\s+more\b/.test(label)) continue;
      if (label.length > 30) continue;                // a sentence is not a button
      if (e.disabled || e.getAttribute("aria-disabled") === "true") continue;
      if (/disabled/i.test(String(e.className || ""))) continue;
      r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      return e;
    }
    return null;
  }

  function autoScan(onProgress, done) {
    var steps = 0, dry = 0, lastCount = -1, moved = false, mores = 0;
    var inner = scrollers();
    try { window.scrollTo(0, 0); } catch (e) {}
    for (var s = 0; s < inner.length; s++) { try { inner[s].scrollTop = 0; } catch (e) {} }

    setTimeout(function tick() {
      var added = mergeIntoBatch(harvest());
      var total = batchList().length;
      onProgress(total, steps);

      var atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 8);
      for (var j = 0; j < inner.length; j++) {
        if (inner[j].scrollTop + inner[j].clientHeight < inner[j].scrollHeight - 8) atBottom = false;
      }
      if (!added && total === lastCount) dry++; else dry = 0;
      lastCount = total;

      /* Patience matters on a lazy list: a fetch for the next page can easily
         take longer than one tick, and giving up after a few quiet passes is
         how a scan stops at the first screenful. */
      /* THE BOTTOM OF THE PAGE IS NOT THE END OF THE MENU IF THERE IS A BUTTON
         THERE. Before giving up, look for a load-more control and press it --
         then carry on scrolling, because what it appends is usually taller than
         the window again. Capped at 40 presses: a menu that needs more than that
         is a pager wearing a button, and autoPage should be driving it.
         The dry counter is reset rather than the loop restarted, so the
         already-merged rows stay exactly where they are. */
      if (steps++ > 600 || dry >= 25 || (atBottom && dry >= 3)) {
        if (atBottom || dry >= 3) {
          var more = moreControl();
          if (more && mores < 40) {
            mores++;
            DIAG.loadMoreClicks = mores;
            try { more.scrollIntoView({ block: "center" }); } catch (e) {}
            try { more.click(); } catch (e) {}
            dry = 0;
            lastCount = -1;
            /* A LONGER BEAT THAN A SCROLL TICK. What this triggers is a fetch,
               not a paint, and 420ms is comfortably shorter than a slow menu's
               round trip -- coming back too early reads as another dry tick and
               burns the allowance the click just bought. */
            return setTimeout(tick, 1400);
          }
        }
        if (steps > 600 || dry >= 25 || (atBottom && dry >= 3)) {
          DIAG.scanStop = steps > 600 ? "step cap" : (atBottom ? "bottom, nothing new" : "no new rows");
          return done(batchList());
        }
      }

      var beforeY = window.scrollY;
      try { window.scrollBy(0, Math.round(window.innerHeight * 0.75)); } catch (e) {}
      /* Recomputed every tick: a virtualised list mounts new containers as it
         goes, and the one that scrolls may not have existed when this started. */
      inner = scrollers();
      for (var m = 0; m < inner.length; m++) {
        try {
          var b4y = inner[m].scrollTop;
          inner[m].scrollTop += Math.round(inner[m].clientHeight * 0.75);
          if (inner[m].scrollTop !== b4y) moved = true;
        } catch (e) {}
      }
      if (window.scrollY !== beforeY) moved = true;
      DIAG.scrolled = moved;
      setTimeout(tick, 420);
    }, 350);
  }

  /* ------------------------------------------------------------- the pager ---
   * PAGE THROUGH, THEN SCROLL EACH PAGE. autoScan answers "the menu is taller
   * than the window". A numbered pager is "the menu is longer than the page",
   * which is a different decision by a different platform and needs a different
   * move -- so this drives the pager and lets autoScan do the scrolling on each
   * page it lands on.
   *
   * WHY IT LIVES HERE AND NOT IN THE HARVESTER. Measured on Sapura's Dutchie
   * menu, 2026-08-17: a complete autoScan reaches the bottom of page one, sees
   * three dry ticks and returns 98 rows out of ~700. The 698 on the shelf are
   * the operator having clicked Next seven times and re-run the bookmarklet --
   * which works, because the batch accumulates across runs on purpose. If the
   * scheduled lane owned the pager instead, the manual lane would keep clicking
   * Next forever and the two lanes would disagree about what a complete capture
   * is. That is the same drift the __LL_COLLECT__ header argues against for
   * autoScan itself, so the pager goes where autoScan is.
   *
   * NO PER-SITE SELECTORS, for the same reason the extractor has none: a
   * selector is a guess about someone else's markup that fails silently at the
   * first redesign. A Next control is a clickable thing whose accessible name
   * says next. That is a rule, and it is the rule a person uses.
   *
   * THE BATCH IS NOT RESET BETWEEN PAGES -- that is the entire point, and it is
   * already how the operator's seven clicks add up. Reset once before the first
   * page if you want a clean run; never inside this loop.
   */
  /* deepAll, NOT document.querySelectorAll, and this is why Green Tree could
     scroll but never page. Jane renders its whole menu -- cards AND controls --
     inside open shadow roots, and querySelectorAll does not cross a shadow
     boundary. The extractor already knew that (reactHarvest and the DOM scan
     both use deepAll, and so does scrollers), but all three control finders were
     written against the light DOM, so on a Jane shop the pager, the load-more
     button and the category tabs were invisible while the scroller worked
     perfectly. The symptom is a menu that stops at one screenful with
     `pagedStop: "no next control"` -- which reads as "this shop has no pager"
     and is indistinguishable from the truth. */
  function nextControl() {
    var els = deepAll('button,a,[role="button"]'), i, e, label, r;
    var mine = document.getElementById("ll-collector");
    for (i = 0; i < els.length; i++) {
      e = els[i];
      /* Never the collector's own panel. It sits on top of every menu we read
         and its buttons are the only ones on the page we must not press. */
      if (mine && mine.contains(e)) continue;
      label = ((e.getAttribute("aria-label") || "") + " " + (e.innerText || "")).trim().toLowerCase();
      if (!/\bnext\b|^\s*[›»→]\s*$|[›»→]\s*$/.test(label)) continue;
      /* "Next day delivery" is a shipping promise, not a pager. A pager's
         accessible name is short; a sentence that happens to contain the word
         is not one. */
      if (label.length > 24) continue;
      /* A DISABLED NEXT IS THE LAST PAGE SAYING SO. Clicking it does nothing and
         the dry-page counter below would stop the loop eventually anyway, but
         two wasted scans per shop per run is a real cost and the page already
         told us. */
      if (e.disabled || e.getAttribute("aria-disabled") === "true") continue;
      if (/disabled/i.test(String(e.className || ""))) continue;
      r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      return e;
    }
    return null;
  }

  /* COLLECTION TABS ARE THE OUTERMOST LOOP, and the three nest exactly one way:
   *
   *     tabs  ->  pages  ->  scroll  ->  load-more
   *
   * A tab switches WHICH catalogue is on screen; a pager moves through one
   * catalogue; scrolling reveals one page of it; load-more extends one screen.
   * Getting the order wrong means re-scanning the first tab once per page, so
   * autoTabs drives autoPage, which drives autoScan, which presses load-more.
   *
   * WHAT COUNTS AS A TAB, and why this is narrower than the other two rules.
   * `role="tab"` and `aria-selected` are ARIA, which is a standard rather than a
   * guess about one shop's markup -- so tabs are recognised the way a screen
   * reader recognises them. A category link that is really a NAVIGATION is
   * deliberately not included: following one destroys this script's execution
   * context mid-scan, and while the batch survives in localStorage the loop does
   * not, so it would look like a hang. If the href leaves the page, autoPage's
   * URL-less pager is the wrong tool and the operator should capture that
   * section as its own collection.
   *
   * ONE BATCH, MANY TABS -- SO MIND THE COLLECTION NAME. Everything captured
   * here lands in the single collection named in the panel. That is usually what
   * you want (one complete capture of the shop), but a capture REPLACES the
   * collection it names and cannot remove one it does not: if the shelf already
   * holds this store split as `flower`, `edibles`, `vapes`, a combined capture
   * under `menu` ADDS a fourth copy beside them rather than replacing them.
   * Clear the store first when consolidating.
   */
  function tabControls() {
    var out = [], seenLabel = {};
    var mine = document.getElementById("ll-collector");
    /* Re-enumerated first, because a virtualised menu mounts new roots as it
       goes and a tablist can arrive after load. Same reason harvest() refreshes
       them every pass. */
    try { refreshShadow(true); } catch (e) {}
    var els = deepAll('[role="tab"],[role="tablist"] button,[role="tablist"] a,[aria-selected]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (mine && mine.contains(e)) continue;
      /* A link that leaves the page is navigation, not a tab -- see above. */
      try {
        var href = e.getAttribute && e.getAttribute("href");
        if (href && !/^#/.test(href)) {
          var u = new URL(href, location.href);
          if (u.pathname !== location.pathname) continue;
        }
      } catch (err) {}
      var r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      var label = ((e.getAttribute("aria-label") || "") + " " + (e.innerText || "")).trim().toLowerCase();
      if (!label || label.length > 40) continue;
      if (seenLabel[label]) continue;
      seenLabel[label] = 1;
      out.push({ el: e, label: label });
    }
    return out;
  }

  function autoTabs(onProgress, done, opts) {
    opts = opts || {};
    var tabs = tabControls();
    DIAG.tabsFound = tabs.length;
    /* NO TABS IS NOT A FAILURE, it is the common case -- fall straight through
       to the pager so one control is correct on every shop. */
    if (tabs.length < 2) {
      DIAG.tabsVisited = 0;
      return autoPage(onProgress, done, opts);
    }
    var idx = 0;
    (function step() {
      if (idx >= tabs.length || idx >= (opts.maxTabs || 25)) {
        DIAG.tabsVisited = idx;
        return done(batchList());
      }
      var t = tabs[idx++];
      DIAG.tabsVisited = idx;
      /* Re-resolved by label rather than reused, because switching a tab
         commonly re-renders the tablist and the old node is detached. */
      var live = null, now = tabControls(), z;
      for (z = 0; z < now.length; z++) if (now[z].label === t.label) { live = now[z].el; break; }
      if (!live) return step();
      try { live.scrollIntoView({ block: "center" }); } catch (e) {}
      try { live.click(); } catch (e) {}
      setTimeout(function () {
        autoPage(
          function (total) { onProgress(total, idx - 1, t.label); },
          function () { step(); },
          opts
        );
      }, opts.tabSettleMs || 1600);
    })();
  }

  function autoPage(onProgress, done, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 40, page = 0, prev = -1, dry = 0;
    (function step() {
      autoScan(
        function (total) { onProgress(total, page); },
        function (list) {
          DIAG.pagesVisited = page + 1;
          /* TWO DRY PAGES, NOT ONE. A page of items already captured
             legitimately adds nothing -- an overlapping page window, or a shop
             that repeats its bestsellers across pages -- and stopping on the
             first of those truncates the menu exactly there. */
          if (list.length === prev) dry++; else dry = 0;
          prev = list.length;
          if (dry >= 2) { DIAG.pagedStop = "two pages added nothing"; return done(list); }
          var b = nextControl();
          if (!b) { DIAG.pagedStop = "no next control"; return done(list); }
          if (++page >= maxPages) { DIAG.pagedStop = "page cap"; return done(list); }
          try { b.scrollIntoView({ block: "center" }); } catch (e) {}
          setTimeout(function () {
            try { b.click(); } catch (e) {}
            /* A CLICK IS NOT A LOAD. These pagers are client-side routes: the
               click returns instantly and the new rows arrive on a fetch. Give
               it the same beat autoScan gives a lazy list. */
            setTimeout(step, opts.settleMs || 2600);
          }, 250);
        }
      );
    })();
  }

  /* ------------------------------------------------------- headless handle ---
   * A PROGRAMMATIC DOOR, so the scheduled harvester does not have to puppet the
   * panel's buttons. Everything above is unchanged: the panel still builds, the
   * operator's workflow is identical, and this object is simply the same
   * functions under a name something else can call.
   *
   * WHY autoScan AND NOT harvest. A single harvest() sees whatever is mounted
   * right now, and on a virtualised menu that is one screenful. autoScan already
   * carries the settle rule a headless run needs and a human supplies by eye --
   * scroll, re-harvest, count dry ticks, and keep going a while after the last
   * one because a lazy list's next fetch can outlast a tick. Reimplementing that
   * in the harvester would be a second copy of the hardest logic in this file,
   * which is exactly the drift CLAUDE.md warns about.
   *
   * It exposes no network call. The harvester posts the rows itself, with its
   * own token, so this file still never sends anything the operator did not.
   *
   * PLACED HERE, ABOVE THE FIRST harvest(), AND THAT POSITION IS LOAD BEARING.
   * It sat at the end of the IIFE and the suite caught it immediately: the
   * "Nothing product-shaped found" path RETURNS before the end, so on exactly
   * the pages where the distinction matters most -- a page that was served and
   * simply had nothing on it -- the handle never existed, and the harvester
   * reported "collector did not expose __LL_COLLECT__". That reads as a broken
   * injection, which sends you to debug the harvester, when the truth was an
   * empty menu. The machinery is defined by this line; the handle should be too,
   * regardless of what the page turns out to contain.
   */
  try {
    window.__LL_COLLECT__ = {
      version: 1,
      market: MARKET,
      /* one pass over what is mounted */
      harvest: function () { return harvest(); },
      /* START CLEAN, and this is the one behaviour the two lanes need opposite.
         The batch ACCUMULATES across navigations on purpose -- a Dutchie menu is
         paginated by category, so one capture is never a whole shop, and an
         operator working through them needs the rows to add up. For a scheduled
         run that same persistence is a defect: it is one page, one read, one
         post, and inheriting anything from a previous store or a previous night
         means posting rows nobody read tonight.
         The suite caught this the moment three fixture shops shared an origin --
         the "Coming soon" page reported the previous shop's 18 products. On real
         hosts the scoping above usually saves you, which is worse, not better:
         it would have surfaced first on a chain, in production, as one town's
         menu under another town's name. */
      reset: function () {
        try { STORE && STORE.removeItem(BATCH_KEY); } catch (e) {}
        try { STORE && STORE.removeItem(STAMP_KEY); } catch (e) {}
        MEM_BATCH = null;
        return true;
      },
      /* scroll-and-settle; done(list) */
      autoScan: function (onProgress, done) { return autoScan(onProgress || function () {}, done); },
      /* scroll-and-settle across EVERY page of a paginated menu; done(list).
         Feature-detected by the harvester, which falls back to autoScan where a
         deployed collector predates this. */
      autoPage: function (onProgress, done, opts) {
        return autoPage(onProgress || function () {}, done, opts);
      },
      /* the whole tree: tabs -> pages -> scroll -> load-more; done(list).
         This is what an unattended run should call -- it degrades to autoPage
         on a shop with no tabs, and autoPage degrades to autoScan with no
         pager, so one entry point is correct everywhere. */
      autoAll: function (onProgress, done, opts) {
        return autoTabs(onProgress || function () {}, done, opts);
      },
      batchList: batchList,
      /* rowCoverage is computed HERE rather than stored, so it always describes
         the batch as it stands now instead of whatever the last harvest's layer
         happened to produce. stateCoverage keeps the old per-layer figure beside
         it, since "page state contributed nothing" is itself worth knowing. */
      diag: function () {
        var o = {}, k;
        for (k in DIAG) o[k] = DIAG[k];
        try { o.rowCoverage = batchCoverage(); } catch (e) {}
        return o;
      },
    };
  } catch (e) {}
  function shopifyHarvest(cb){
    /* THE URL IS NOT THE PLATFORM. This used to accept any /collections/ or
       /products/ path as Shopify, and thca4cheap is WooCommerce serving
       Shopify-style /collections/ URLs left over from a migration -- so the
       Shopify branch was tried, got nothing, and fell silently through to the
       page scan, which read 23 pseudo-products out of a marketing page's nav
       and breadcrumbs. Ask the page what it is, not what its links look like. */
    var looksShopify = false;
    try {
      looksShopify = !!window.Shopify ||
        !!document.querySelector('script[src*="cdn.shopify"], link[href*="cdn.shopify"]');
    } catch (e) {}
    if (!looksShopify) return cb(null);

    var byHandle = {}, order = [], pages = [], page = 1, PER = 250, GUARD = 40;
    (function next(){
      fetch("/products.json?limit=" + PER + "&page=" + page, { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          /* AN ARRAY, or this is not the feed. A WordPress install answers
             /products.json with HTML or with a page object, and reading a
             truthy non-array as success is how a Woo store ended up on the
             Shopify branch in the first place. */
          var arr = j && j.products;
          if (!Array.isArray(arr)) return cb(null);
          pages.push(arr.length);
          for (var i = 0; i < arr.length; i++) {
            var p = arr[i];
            if (!p || !p.handle || byHandle[p.handle]) continue;
            byHandle[p.handle] = 1;
            order.push(shopifyRow(p));
          }
          if (arr.length === 0 || page >= GUARD) {
            DIAG.feedPages = pages.join("/");
            return cb(order);
          }
          page++; next();
        })
        .catch(function () { cb(null); });
    })();
  }

  /* ---- WOOCOMMERCE: the Store API, which is the same shape of answer -------
     thca4cheap publishes 82 products and the collector captured 23 -- none of
     them real, because it was run on two marketing pages and read their nav,
     breadcrumbs and banner copy as products. It had no Woo path at all: the
     whole script contained no wp-json, no store/v1, nothing. A Woo store got
     the DOM scan and nothing better, which on a page with no product grid
     produces a confident count of rubbish.

     wc/store/v1 is public and unauthenticated -- the same endpoint
     api/products.js already sweeps server-side. One hop returns every product
     with name, slug, prices, stock and images, so there is nothing to scroll,
     nothing lazy-loaded, and no marketing page to be fooled by.

     TWO SWEEPS, because a variable catalogue needs both. Without the variation
     pass a variable product publishes its price_range MINIMUM as one flat "One
     Size" row -- the size bug CLAUDE.md section 7 has now been diagnosed from
     scratch three times. thca4cheap carries wooVariations:true server-side for
     exactly this reason. */
  function wooHarvest(cb){
    var looksWoo = false;
    try {
      looksWoo = /(^|\s)woocommerce(-|\s|$)/.test(document.body.className || "") ||
        !!document.querySelector('link[rel="https://api.w.org/"], link[href*="/wp-json"]') ||
        !!window.wc_add_to_cart_params || !!window.wcSettings ||
        !!document.querySelector('script[src*="/wp-content/"], script[src*="/wp-includes/"]');
    } catch (e) {}
    if (!looksWoo) return cb(null);

    sweep("/wp-json/wc/store/v1/products?per_page=100", function (prods) {
      if (!prods || !prods.length) return cb(null);
      sweep("/wp-json/wc/store/v1/products?type=variation&per_page=100", function (vars) {
        var byParent = {}, i;
        for (i = 0; vars && i < vars.length; i++) {
          var pid = vars[i].parent || vars[i].parent_id;
          if (!pid) continue;
          (byParent[pid] = byParent[pid] || []).push(vars[i]);
        }
        var out = [];
        for (i = 0; i < prods.length; i++) out.push(wooRow(prods[i], byParent[prods[i].id]));
        DIAG.wooVariations = (vars || []).length;
        cb(out);
      });
    });

    function sweep(url, done){
      var all = [], page = 1, GUARD = 40;
      (function next(){
        fetch(url + "&page=" + page, { credentials: "omit", headers: { accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) {
            if (!Array.isArray(j)) return done(all.length ? all : null);
            for (var k = 0; k < j.length; k++) all.push(j[k]);
            /* Only an empty page ends it -- the same rule the Shopify sweep and
               wooSweep() in api/products.js both learned the hard way. */
            if (!j.length || page >= GUARD) return done(all);
            page++; next();
          })
          .catch(function () { done(all.length ? all : null); });
      })();
    }
  }

  /* THE STORE API QUOTES MONEY IN MINOR UNITS -- 4999 is $49.99 -- and reading
     it as dollars is the 100x error money() exists to prevent. */
  function wooPrice(p){
    var pr = p && p.prices;
    if (!pr) return null;
    var raw = pr.sale_price != null && pr.sale_price !== "" ? pr.sale_price : pr.price;
    if (raw == null || raw === "") return null;
    var d = pr.currency_minor_unit != null ? Number(pr.currency_minor_unit) : 2;
    var n = Number(raw);
    return isFinite(n) ? n / Math.pow(10, d) : null;
  }

  function wooRow(p, vars){
    var sizes = [], i;
    for (i = 0; vars && i < vars.length; i++) {
      var v = vars[i], price = wooPrice(v);
      if (price == null) continue;
      /* The variation's own attribute text is the size label. Their `weight`
         field is SHIPPING weight on these stores (CLAUDE.md section 7), so the
         label is the only honest source for grams. */
      var lab = "";
      var at = v.variation || v.attributes;
      if (typeof at === "string") lab = at;
      else if (at && at.length) {
        var bits = [];
        for (var a = 0; a < at.length; a++) bits.push(at[a].value || at[a].name || "");
        lab = bits.join(" ");
      }
      lab = String(lab).replace(/^[^:]*:\s*/, "").trim() || "One Size";
      sizes.push({ label: lab, price: price, grams: grams(lab),
                   inStock: v.is_in_stock !== false });
    }
    if (!sizes.length) {
      var flat = wooPrice(p);
      sizes.push({ label: "One Size", price: flat == null ? 0 : flat, grams: 0,
                   inStock: p.is_in_stock !== false });
    }
    var cat = (p.categories && p.categories[0] && p.categories[0].name) || "";
    return {
      name: String(p.name || "").trim(),
      brand: "",
      description: descOf({ description: p.description || p.short_description || "" }),
      category: String(cat),
      type: "",
      thc: NaN, cbd: NaN,
      image: absolutise((p.images && p.images[0] && (p.images[0].src || p.images[0].thumbnail)) || ""),
      url: String(p.permalink || (p.slug ? location.origin + "/product/" + p.slug : "")),
      deal: "", coa: "", batch: "", packagedDate: "",
      inStock: p.is_in_stock !== false,
      sizes: sizes,
    };
  }

  function shopifyRow(p){
    var vs = p.variants || [], sizes = [], i;
    for (i = 0; i < vs.length; i++) {
      var pr = money(vs[i].price);
      if (pr == null) continue;
      /* The variant TITLE is the size label -- "1 oz", "QP", "1 LB" -- which is
         what grams() reads. The feed's own `grams` field is SHIPPING weight on
         several of these stores and must not be used (CLAUDE.md section 7). */
      var lab = String(vs[i].title || vs[i].option1 || "One Size");
      sizes.push({ label: lab, price: pr, grams: grams(lab),
                   inStock: vs[i].available !== false });
    }
    if (!sizes.length) sizes.push({ label: "One Size", price: 0, grams: 0 });
    var img = (p.images && p.images[0] && (p.images[0].src || p.images[0])) || p.image && p.image.src || "";
    return {
      name: String(p.title || "").trim(),
      brand: String(p.vendor || ""),
      description: descOf({ body_html: p.body_html || "" }),
      category: String(p.product_type || ""),
      type: "",
      thc: NaN, cbd: NaN,
      image: absolutise(img),
      url: location.origin + "/products/" + p.handle,
      deal: "", coa: "", batch: "", packagedDate: "",
      inStock: vs.some ? vs.some(function (v) { return v.available !== false; }) : true,
      sizes: sizes,
    };
  }

  var found = harvest();
  mergeIntoBatch(found);

  /* NOTHING WAITS FOR THE NETWORK. Reading the menu is the expensive, fragile
     part and it needs nothing from us, so it has already happened above; the
     panel is drawn synchronously further down, from the offline host table.
     This is a REDRAW once the directory arrives (or gives up after 4s, or is
     refused outright by a CSP -- The Dude Abides does that, which is why the
     relay exists). So a shop that blocks us still gets a working capture and a
     usable panel; it just does not get the roster's answer for the store box.
     Fired here rather than after the draw because the fetch should be in flight
     while the panel is being built, not after it. */
  loadDirectory(function () {
    /* AND IT MUST NOT CLOBBER THE FAILURE PANEL. On a page with no menu this
       file returns early and puts up "could not read a menu here" -- naming a
       cross-origin iframe, a closed shadow root or too few priced blocks, which
       is the whole reason that panel exists. A redraw arriving four seconds
       later replaced all of it with a bland "0 products in this batch", turning
       a diagnosis back into the shrug it was written to end. The guard is the
       same condition as that early return. */
    try { if (batchList().length) drawFound(); } catch (e) {}
  });

  /* THE FEEDS RUN BEFORE THE FAILURE PANEL, and that ordering is the fix for
     the case that started this. A Woo shop's marketing page carries no product
     grid, so harvest() returns nothing and this used to render "could not read
     a menu here" and RETURN -- never reaching the Store API, which would have
     answered with the entire catalogue. The page having nothing to read is
     exactly when asking the shop matters most. */
  if (!found.length && !batchList().length) {
    return tryFeeds(function (got) {
      if (got) return;
      noMenuPanel();
    });
  }
  function noMenuPanel() {
    /* NAME THE LIKELIEST CAUSE RATHER THAN LISTING ONE. The old panel blamed a
       Dutchie iframe every time, which is wrong on most pages and sends you to
       do the wrong thing. The layers recorded what they saw, so read it back:
       these three cases look identical from the outside and need opposite
       responses. */
    var why, fix;
    if (DIAG.crossOriginIframes) {
      why = "The menu is inside a cross-origin iframe, so this page cannot read it. " +
            "That is the same-origin policy doing its job, not something to get around " +
            "\u2014 but the frame's own address is a normal page, and the collector can read it there.";
      var urls = DIAG.frameUrls || [];
      if (urls.length) {
        /* One click. The alternative was a right-click menu whose wording
           differs per browser and which does not exist on a phone at all. */
        fix = "<b>Open the menu on its own address, then run this again there:</b>" +
          urls.map(function (u) {
            return '<div style="margin-top:6px"><a href="' + esc(u) + '" target="_blank" rel="noopener" ' +
              'style="color:#4ec9ff;word-break:break-all">' + esc(u.slice(0, 120)) + '</a></div>';
          }).join("") +
          '<div style="margin-top:6px;color:#7d919e">Bookmarklet not on the toolbar there? ' +
          'It travels with the browser, so it is the same one.</div>';
      } else {
        fix = "Right-click the menu &rarr; <b>This Frame &rarr; Open Frame in New Tab</b>, then run this again there. " +
              "(The frame declares no address this page can read, so there is no link to offer.)";
      }
    } else if (!DIAG.pricesOnPage && (DIAG.shadowRoots || DIAG.opaqueHosts)) {
      /* Open roots are already read (see shadowRootsOf). Reaching here with
         roots present and no price text means the menu is behind a CLOSED one,
         which is a deliberate "no" from the page rather than a bug. */
      why = "This menu renders inside a closed shadow root, so its contents are not readable from a script. (" +
            DIAG.shadowRoots + " open roots, " + DIAG.opaqueHosts + " elements taking up space with nothing readable in them.)";
      fix = "Open the menu component on its own URL if the shop offers one, or use the shop's own print/export if it has one. This is the page saying no, not a fault here.";
    } else if (!DIAG.pricesOnPage) {
      why = "There are no prices on this page at all — it had probably not finished loading, or this is a category page rather than a menu.";
      fix = "Scroll to the bottom so lazy-loaded rows really render, then run it again. If the shop splits its menu by category, capture the biggest one.";
    } else if (DIAG.domGroup && DIAG.domGroup < 3) {
      why = "Found " + DIAG.pricesOnPage + " prices, but only " + DIAG.domGroup + " same-shaped priced blocks — too few to tell a menu from a cart total.";
      fix = "Open the full menu listing rather than a single product or the cart, then run it again.";
    } else {
      why = "Found " + DIAG.pricesOnPage + " prices on the page, but only reached " +
            (DIAG.domPriceNodes || 0) + " of them as elements, so they could not be grouped into cards.";
      /* That gap is the useful number. Prices present in the page TEXT but not
         reachable as elements means the markup is somewhere the query is not
         looking -- which is how the custom-element case was found. */
      fix = "Send me the diagnostics below and I will add a reader for this shop.";
    }
    panel('<div style="color:#ff8459"><b>Could not read a menu here.</b></div>' +
      '<div style="font-size:12.5px;margin-top:8px;color:#c9d6de">' + why + '</div>' +
      '<div style="font-size:12.5px;margin-top:8px;color:#9fb4c2">' + fix + '</div>' +
      '<pre id="ll-diag" style="margin-top:10px;padding:8px;background:#06121a;border:1px solid #2b3b45;' +
      'border-radius:6px;font-size:11px;color:#9fb4c2;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto">' +
      esc(JSON.stringify(DIAG)) + '\n' + esc(location.href.slice(0, 200)) + '</pre>',
      [
        /* Worth trying before giving up: a lazy-loading menu is genuinely empty
           until something scrolls it. */
        { label: "Scan while scrolling", primary: true, fn: function () {
          var btn = this;
          btn.textContent = "Scanning\u2026";
          btn.disabled = true;
          autoScan(function (total) { btn.textContent = "Scanning\u2026 " + total; },
                   function (list) {
                     if (list.length) { harvested = list.length; drawFound(); }
                     else { btn.textContent = "Still nothing"; }
                   });
        } },
        { label: "Copy diagnostics", fn: function () {
          var t = JSON.stringify(DIAG) + "\n" + location.href;
          try { navigator.clipboard.writeText(t); this.textContent = "Copied"; }
          catch (e) { this.textContent = "Select the box and copy"; }
        } },
        { label: "Close", fn: function () { document.getElementById("ll-collector").remove(); } },
      ]);
  }

  function drawFound() {
  /* Asked once, and the panel is redrawn if the answer is "you are behind".
     Fired from here rather than at load because this is the only moment a human
     is certain to be looking at the panel, and because a shop that refuses the
     request costs nothing by refusing it late. */
  if (!STALE && !drawFound.__asked) { drawFound.__asked = 1; checkBuild(function(){ drawFound(); }); }
  var batch = batchList();
  var withG = batch.filter(function (p) { return p.sizes.some(function (s) { return s.grams > 0; }); });
  var sample = batch.slice(0, 3).map(function (p) {
    return esc(p.name) + " &mdash; $" + p.sizes[0].price.toFixed(2) + " / " + esc(p.sizes[0].label);
  }).join("<br>");
  found = batch;

  panel(
    '<div><b>' + found.length + '</b> products in this batch' +
    (found.length > harvested ? ' <span style="color:#9fb4c2;font-weight:400">(' + harvested + ' on screen now)</span>' : '') +
    '.</div>' +
    /* SAID OUT LOUD, because an expiry that only appears in the diagnostics
       looks exactly like storage losing the batch. */
    (DIAG.batchExpired
      ? '<div style="color:#ffb454;font-size:12.5px;margin:6px 0 0">' +
        (DIAG.batchExpiredRows || 0) + ' row(s) from a batch ' + (DIAG.batchExpiredHours || 18) +
        'h old were dropped &mdash; captures expire after 18h so a stale price list cannot be sent.</div>'
      : '') +
    /* Same reasoning as the expiry above, and the same failure if left silent:
       a batch that shrinks on its own is indistinguishable from storage losing
       it, which this file has already been blamed for twice. */
    (DIAG.batchPruned
      ? '<div style="color:#ffb454;font-size:12.5px;margin:6px 0 0">' +
        DIAG.batchPruned + ' older row(s) were cleared &mdash; they were captured before product ' +
        'links were resolved properly, so the site would refuse them every time. Re-scan this ' +
        'page to pick them up again with a working link.</div>'
      : '') +
    /* THE DENOMINATOR, WHEN THE PAGE PUBLISHES ONE. Without it a row count has
       no scale: a category holding 13 products and a category of 235 showing
       its first screen are the same number on screen, and the second one needs
       Scan everything rather than Send. */
    (DIAG.pageSays && found.length < DIAG.pageSays
      ? '<div style="color:#ffb454;font-size:12.5px;margin:6px 0 0"><b>' + found.length +
        ' of ' + DIAG.pageSays + '</b> this page says it has &mdash; press <b>Scan everything</b> ' +
        'before sending, or capture the remaining pages.</div>'
      : '') +
    '<div style="color:#9fb4c2;font-size:12.5px;margin:6px 0 10px">' + withG.length + ' carry a weight, so price-per-gram will compute.' +
    '<br>Runs add up in this tab &mdash; scroll or page through the menu and click the bookmark again.' +
    /* WHAT THIS PAGE CONTRIBUTED, in its own right. A batch that stops growing
       is the symptom of several unrelated faults -- rows read as duplicates,
       storage refusing the write, a page that served the same products again --
       and without this number they are indistinguishable from outside. It read
       as "capping out and not saving from page to page" for all of them. */
    /* THE ONE LINE THAT ENDS THE ARGUMENT. Either the batch matches what the
       shop publishes -- in which case there is nothing missing and the number
       everyone kept reporting was the shop's size -- or it does not, and the
       gap is the bug, stated as a figure instead of as a feeling. */
    (DIAG.notAListing
      ? '<br><span style="color:#ff8459">This does not look like a menu page &mdash; only ' +
        (DIAG.rowsWithLink || 0) + ' of these rows carry a product link. A page of nav, ' +
        'breadcrumbs and banner copy reads as products. Open the shop\'s listing and run it there.</span>'
      : "") +
    (DIAG.feedReplaced != null
      ? '<br><span style="color:#7ee787">Read <b>' + found.length +
        '</b> products from the shop\'s own product feed &mdash; the complete catalogue.</span>' +
        '<br><span style="color:#6d828f">The page itself offered ' + DIAG.feedReplaced +
        '; those were replaced, because a menu link and a product look the same in markup.</span>'
      : DIAG.shopSays
      ? '<br>' + (found.length > DIAG.shopSays
          /* MORE ROWS THAN THE SHOP HAS IS A BUG, not a win, and it is the one
             nobody was looking for. Reported for weeks as "capping at 170" on a
             collection that holds 118 -- so the number was 52 too HIGH, and
             every hour spent hunting a cap was spent in the wrong direction. A
             menu link, a footer link and a "recommended" carousel are all
             product-shaped; collect them and the total passes the catalogue. */
          ? '<span style="color:#ff8459">This ' + esc(DIAG.shopScope || "shop") + ' publishes <b>' +
            DIAG.shopSays + '</b> products but this batch has <b>' + found.length +
            '</b> &mdash; ' + (found.length - DIAG.shopSays) +
            ' too many, so some rows are not products.</span>'
          : found.length === DIAG.shopSays
          ? '<span style="color:#7ee787">This ' + esc(DIAG.shopScope || "shop") + ' publishes ' +
            DIAG.shopSays + ' products. You have all of them.</span>'
          : '<span style="color:#ffb454">This ' + esc(DIAG.shopScope || "shop") + ' publishes <b>' +
            DIAG.shopSays + '</b> products and this batch has <b>' + found.length + '</b> &mdash; ' +
            (DIAG.shopSays - found.length) + ' still to capture.</span>')
      : "") +
    '<br>' + (DIAG.batchAdded ? '+' + DIAG.batchAdded + ' new from this page.'
      : '<span style="color:#ffb454">Nothing new on this page &mdash; every row was already in the batch.</span>') +
    (DIAG.batchSaveError
      ? '<br><span style="color:#ff8459">This batch is held in the page only (' + esc(DIAG.batchSaveError) +
        '), so it will NOT survive moving to the next page. Send it before you navigate.</span>'
      : "") +
    /* Say which layer answered. Read off the rendered page there is no strain,
       category or THC figure to have -- only what was printed -- so a thin
       capture should look thin rather than look like a bad scrape. */
    (DIAG.via === "rendered page" || DIAG.via === "printed text"
      ? '<br><span style="color:#ffb454">Read off the ' + esc(DIAG.via) + ', so names and prices only — no strain or THC figures.</span>'
      : '<br>Source: ' + esc(DIAG.via || "page state") + '.') +
    /* ON SCREEN, not only in the copied diagnostics. The whole point is that it
       is readable before anything is reported, by the person holding the stale
       bookmark. */
    '<br><span style="color:#6d828f">Collector ' + esc(BUILD) + ' from ' + esc(DIAG.from) + '</span>' +
    /* LOUD, because the whole point is that it changes what the numbers mean.
       A stale reader does not fail -- it returns a smaller, plausible menu. */
    (STALE ? '<br><span style="color:#f0b93c">This bookmark is a snapshot. Current build is ' +
      esc(STALE) + ' \u2014 re-drag the self-contained bookmarklet from /coldwater-collect.</span>' : "") +
    '</div>' +
    '<div style="font-size:12.5px;color:#c9d6de;border-top:1px solid #2b3b45;padding-top:8px">' + sample + '</div>' +
    '<label style="display:block;margin-top:12px;font-size:12.5px;color:#9fb4c2">Store key' +
    /* WHICH CITY THIS IS ABOUT TO BE WRITTEN INTO, in words, beside the field
       that decides it. The market used to be baked into the bookmarklet's url,
       so the operator needed one per city and nothing on a shop's page said
       which one they had clicked -- a capture landing in last night's namespace
       looked identical to a capture landing correctly, right up until the shelf
       stayed empty. It is derived from the store key now, so this line is the
       derivation read back rather than a second claim about it. */
    (function () {
      var k = sessionStorage.getItem(STORE_KEY) || guessStore();
      var mk = marketFor(k);
      if (mk) {
        return ' <span style="color:#6d828f">&mdash; ' + esc(mk) + '</span>' +
          (MARKET_PARAM && MARKET_PARAM !== mk
            /* Said rather than resolved silently: an old bookmarklet carrying
               another city is exactly the mistake this change exists to end,
               and the operator should see that it was overruled. */
            ? '<br><span style="color:#ffb454">This bookmarklet says ' + esc(MARKET_PARAM) +
              ', but the shop is in ' + esc(mk) + ' &mdash; the shop wins.</span>'
            : '');
      }
      if (!DIRECTORY) return ' <span style="color:#6d828f">&mdash; ' + esc(MARKET) + '</span>';
      return '<br><span style="color:#ffb454">Not a shop on any roster' +
        (DIAG.storeAmbiguous ? ' (this host has several: ' + esc(DIAG.storeAmbiguous) + ')' : '') +
        ' &mdash; type a key or it will be stored where nothing reads it.</span>';
    })() +
    '<input id="ll-store" value="' + esc(sessionStorage.getItem(STORE_KEY) || guessStore()) + '" ' +
    'style="width:100%;margin-top:4px;padding:7px 9px;border-radius:6px;border:1px solid #2b3b45;background:#06121a;color:#eaf2f6"></label>' +
    '<label style="display:block;margin-top:8px;font-size:12.5px;color:#9fb4c2">Collection ' +
    '<span style="color:#6d828f">&mdash; captures add up; the same name replaces</span>' +
    '<input id="ll-collection" value="' + esc(guessCollection()) + '" ' +
    'style="width:100%;margin-top:4px;padding:7px 9px;border-radius:6px;border:1px solid #2b3b45;background:#06121a;color:#eaf2f6"></label>' +
    '<label style="display:block;margin-top:8px;font-size:12.5px;color:#9fb4c2">Admin token' +
    '<input id="ll-token" type="password" value="' + esc(sessionStorage.getItem(TOKEN_KEY) || "") + '" ' +
    'style="width:100%;margin-top:4px;padding:7px 9px;border-radius:6px;border:1px solid #2b3b45;background:#06121a;color:#eaf2f6"></label>',
    [
      { label: "Send", primary: true, fn: send },
      /* THE ANSWER TO "IT ONLY SEES 22". Scrolls the page and keeps reading,
         merging as it goes, which is what a virtualised list requires: the
         cards not on screen do not exist to be read. */
      { label: "Scan while scrolling", fn: function () {
        var btn = this;
        btn.textContent = "Scanning\u2026";
        btn.disabled = true;
        autoScan(function (total) { btn.textContent = "Scanning\u2026 " + total; },
                 function () { drawFound(); });
      } },
      /* THE ANSWER TO "IT ONLY SEES ONE PAGE", which is a different complaint
         from the one above and had no button at all. Dutchie paginates: a
         complete scroll-scan of Sapura returns 98 rows of ~700 and looks
         entirely healthy, because scrolling and paging are different questions
         and the button beside this one only answers the first.

         The 698 rows on the shelf were seven manual Next clicks with a re-run
         between each. That works -- the batch accumulates across runs on purpose
         -- but it is the operator doing by hand the one part of this that is
         purely mechanical, and it is why a full re-pull took an evening. */
      { label: "Scan everything", fn: function () {
        var btn = this;
        btn.textContent = "Scanning\u2026";
        btn.disabled = true;
        autoTabs(
          function (total, tab, label) {
            btn.textContent = label
              ? "Scanning\u2026 " + label.slice(0, 14) + " / " + total
              : "Scanning\u2026 " + total + " rows";
          },
          function () {
            drawFound();
            /* drawFound rebuilds the panel, so this button is already gone by
               now -- and the reason it stopped is the single most useful thing
               to know. All four dimensions, because a menu can be complete in
               one and truncated in another: "no next control" on page one means
               the pager was not recognised, and 0 tabs on a shop with category
               tabs means the same about those. */
            try {
              console.log("[ll-collector] " + batchList().length + " rows · " +
                "tabs " + (DIAG.tabsVisited || 0) + "/" + (DIAG.tabsFound || 0) +
                " · pages " + (DIAG.pagesVisited || 1) +
                " · load-more " + (DIAG.loadMoreClicks || 0) +
                " · stopped: " + (DIAG.pagedStop || DIAG.scanStop || "?"));
            } catch (e) {}
          }
        );
      } },
      /* ON THE SUCCESS PANEL TOO, and its absence here cost real time. This
         button only existed on the "could not read a menu" panel, so a capture
         that SUCCEEDS PARTIALLY -- the exact case where the numbers are needed
         -- had no way to produce them. Green Tree returns 28 products and looks
         like a win, and every request for its diagnostics pointed at a button
         that was never on screen. A partial success is when you most need to
         know which layer answered and how much it saw. */
      { label: "Copy diagnostics", fn: function () {
        var d = {};
        for (var k in DIAG) if (Object.prototype.hasOwnProperty.call(DIAG, k)) d[k] = DIAG[k];
        d.batch = found.length;
        d.onScreen = harvested;
        d.withGrams = withG.length;
        var t = JSON.stringify(d) + "\n" + location.href;
        try { navigator.clipboard.writeText(t); this.textContent = "Copied"; }
        catch (e) { this.textContent = "Select the box and copy"; }
      } },
      { label: "Clear batch", fn: function () {
        saveBatch({});
        harvested = 0;
        drawFound();
      } },
      { label: "Cancel", fn: function () { document.getElementById("ll-collector").remove(); } },
    ]
  );
  }
  var harvested = found.length;
  drawFound();
  /* AFTER the panel exists and `harvested` is set. Called earlier, its redraw
     ran with harvested still undefined, which silently dropped the "(N on
     screen now)" line that tells a virtualised menu apart from a finished one. */
  showPanelAndTryFeeds();
  /* Asked once per run, after the panel is already up: the count is useful and
     it is not worth making anyone wait on a network round trip to see what they
     captured. The panel redraws when the answer lands. */
  /* THE FEED REPLACES THE GUESS, it does not merge with it. Merging would keep
     every menu link the page read already captured -- the 52 rows that started
     this -- and no later run could tell them from products, because on the page
     they are indistinguishable. The shop's own list is the shelf; anything read
     off the markup beside it is a worse answer to the same question.

     Only on the shops that HAVE a list. A feed that does not answer leaves the
     batch exactly as the page layers built it, which is the whole capture story
     for Dutchie, Jane and the DOM-only shops. */
  /* Shopify, then Woo, then whatever the page showed. Each is tried only where
     the page says it applies; a branch that declines falls through rather than
     claiming the shop has nothing. cb(true) means a feed answered. */
  function tryFeeds(cb) {
    shopifyHarvest(function (rows) {
      if (rows && rows.length) { adoptFeed(rows, "shop feed (products.json)"); return cb(true); }
      wooHarvest(function (wrows) {
        if (wrows && wrows.length) { adoptFeed(wrows, "shop feed (wc/store/v1)"); return cb(true); }
        cb(false);
      });
    });
  }

  function showPanelAndTryFeeds() {
    var harvestedNow = found.length;
    tryFeeds(function (got) {
      if (got) return;
      /* NO FEED, so the page scan stands -- and it has to say when what it read
         does not look like a listing. Run on a marketing page, the scan read 23
         pseudo-products out of nav, breadcrumbs and banner copy and reported a
         confident count of them. A page with almost nothing carrying a product
         link is not a menu, and saying so is the difference between a wasted
         capture and a wasted afternoon. */
      /* DISTINCT urls, NOT "urls that are not the one we are standing on".
         The old test was `found[i].url !== location.href`, and the rendered-page
         and printed-text layers write location.href into EVERY row -- so it only
         ever meant "did this row's url come from an earlier page than the one we
         are on now". On a paginated shop location.href changes as the operator
         pages (?pagination=12, 13, 14), so rows carrying a stale page url read
         as product links and the guard stayed quiet through 697 rows of nav copy
         at Exclusive: `Name Z - A` (a sort-dropdown option), `SPECIAL OFFER`,
         `MARKET`. Measured live: navigating Sapura page 1 -> page 3 moved
         rowsWithLink from 0 to 98 without a single row changing.

         A listing gives each product its own address. So count how many
         addresses there are, and compare against the rows rather than against a
         flat floor -- a real menu of eight products has eight urls and must not
         be flagged, while 700 rows sharing four must be. Query and fragment are
         dropped because ?variant= and #details are the same product. */
      var seenUrl = {}, distinct = 0;
      for (var i = 0; i < found.length; i++) {
        var u = String(found[i].url || "").split("#")[0].split("?")[0];
        if (!u || seenUrl[u]) continue;
        seenUrl[u] = 1;
        distinct++;
      }
      DIAG.rowsWithLink = distinct;
      /* THE RATIO ALONE CANNOT TELL FURNITURE FROM A CATALOGUE BEHIND SHARED
         PAGES, and on Banzen it cried wolf at exactly the wrong moment: a
         capture of 1426 rows against a shop that publishes 1465 -- 97% of the
         store, its best capture ever -- was labelled "This does not look like a
         menu page", because Banzen links every card to a BRAND page and 1426
         products sit behind 132 of them. An operator who believes that warning
         does not press Send, and an operator who learns to ignore it will
         ignore it on the day it is right.

         So the absolute count decides too. A page of nav, breadcrumbs and
         banner copy yields a HANDFUL of distinct urls -- Exclusive's 697 rows of
         furniture shared FOUR -- while a real catalogue, however it links,
         yields many. Both halves must look wrong before this fires. */
      var LOW_DISTINCT = 25;
      if (harvestedNow >= 20
            ? (distinct < LOW_DISTINCT && distinct / found.length < 0.5)
            : (harvestedNow && distinct < 5)) {
        DIAG.notAListing = true;
        try { drawFound(); } catch (e) {}
      }
    });
  }

  function adoptFeed(rows, via) {
    if (!rows || !rows.length) return;
    DIAG.shopSays = rows.length;
    DIAG.shopScope = "store";
    DIAG.via = via;
    DIAG.feedReplaced = found.length;
    saveBatch({});                                  // drop the guessed rows
    MEM_BATCH = null;
    mergeIntoBatch(rows);
    found = batchList();
    harvested = rows.length;
    try { drawFound(); } catch (e) {}
  }

  /* WHICH SECTION OF THE MENU THIS IS. Dutchie paginates by category, so the
     operator captures flower, then edibles, then vapes, and each needs its own
     slot server-side or the second silently replaces the first. Guessed from
     the URL because that is where these platforms put it (/products/flower,
     ?category=edibles, /shop/vaporizers), and EDITABLE because a wrong guess
     would quietly overwrite the wrong section -- the exact failure this is
     fixing, just moved one level along. */
  function guessCollection() {
    var clean = function (v) {
      return String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    };
    try {
      var q = new URLSearchParams(location.search);
      var fromQ = q.get("category") || q.get("collection") || q.get("type") || q.get("title");
      if (fromQ) return clean(fromQ) || "default";
    } catch (e) {}
    var parts = location.pathname.split("/").filter(Boolean);
    for (var i = parts.length - 1; i >= 0; i--) {
      var seg = parts[i].toLowerCase();
      if (/^[0-9a-f]{8,}$/.test(seg)) continue;                       // an id, not a section
      if (/^(products?|menu|shop|rec|med|embedded-menu|stores?)$/.test(seg)) continue;
      return clean(seg) || "default";
    }
    return "default";
  }

  /* DUTCHIE HOSTS MANY SHOPS, AND THE SLUG IS THE ONLY THING IN THE URL THAT
     NAMES ONE. This used to read

       /dutchie\.com/.test(h) ? (/6226401db296a22c98dfb676/.test(p) ? "sapura" : "exclusive")

     and the retailer id in that test does not appear in the embedded-menu path
     at all -- Sapura's menu is /embedded-menu/northeast-alternatives-coldwater/
     products. So the test could only ever FAIL, and every dutchie.com capture
     pre-filled "exclusive", including Sapura's own. The operator accepted the
     default, which is what defaults are for, and 693 of Sapura's 698 rows
     published under Exclusive's name. Both captures were internally perfect;
     nothing downstream could notice.

     A default that is wrong for every shop on a shared host except one is not a
     default, it is a coin flip wearing a confident face.

     UNKNOWN SLUGS RETURN "" ON PURPOSE. An empty Store key box stops the
     operator and makes them look; a plausible wrong one does not, and this
     failure is invisible from the panel. Same reasoning as guessCollection's
     editability above, one level along. */
  var DUTCHIE_SLUGS = {
    "northeast-alternatives-coldwater": "sapura",
    /* Read off the embed's own url in a capture diagnostic: cloudcannabis.com
       is a shell whose menu is a cross-origin dutchie.com iframe, so the
       collector has to be run on the frame url and the host rule below never
       fires there. */
    "cloud-cannabis-detroit": "cloud-detroit",
  };
  /* DETROIT'S REMAINING EMBED SLUGS ARE NOT GUESSED, AND THAT IS THE POINT.
     Every Detroit shop on the roster is platform:"dutchie", so each has a slug
     that belongs here -- but a slug is a fact about someone else's url, and the
     containers this repo is edited from cannot reach those hosts (the proxy
     answers CONNECT with 403), so they cannot be confirmed here. Filling them in
     from the shop's name would be the exact bug the note above describes, one
     step subtler: "house-of-dank-detroit" is a plausible spelling that would map
     a real capture onto the wrong key and store it perfectly.

     To add one: open the shop's menu, and if the address bar reads
     dutchie.com/embedded-menu/<slug>/..., that <slug> is the key. Pair it with
     the store key from api/market-stores.js. Still open, with their roster keys:
     hod-detroit, liberty-detroit, geniecannabis, 420factory. The four already
     capturing (dacut, highclub, kingofbudz-detroit, ascend-detroit) reach their
     menus on the shop's own host, where the hostname rules below answer, so they
     need no entry unless their menu moves onto the embed. */
  /* Where a shop's menu is reached by retailer id rather than by slug. Kept
     separate from the slug map because they are read out of different parts of
     the URL and a value that is right in one is meaningless in the other. */
  var DUTCHIE_IDS = {
    "86409c57-76c7-4d9c-baf5-c11ae4546af4": "exclusive",
  };
  /* THE DIRECTORY, FETCHED, SO THERE IS ONE ROSTER AND NOT TWO.
   *
     The table below was a hand-written twin of api/market-stores.js. At sixteen
     shops that was merely fragile; Detroit alone has ~61 licences and Grand
     Rapids 27, so it was about to make adding a shop a CODE change in a project
     whose whole premise is that adding a shop is data (ONE_CORE.md 5). It is
     read from /api/market/ingest?directory=1 instead -- the endpoint this file
     already posts to, so no new cross-origin surface -- and the table stays
     only as the offline answer for a page whose CSP refuses the fetch (The Dude
     Abides does; that is why the relay exists).

     ONE BOOKMARKLET FOR EVERY CITY, which is the point of doing it here. The
     directory carries each store's TOWN, so identifying the shop identifies the
     market, and ?market= is needed only for a host nobody has registered. */
  var DIRECTORY = null;          // {stores:[{key,name,town,hosts,slugs,shared}]}
  function loadDirectory(done) {
    var url;
    try { url = new URL(API).origin + "/api/market/ingest?directory=1"; }
    catch (e) { return done(); }
    var t = setTimeout(function () { t = 0; done(); }, 4000);
    try {
      fetch(url, { credentials: "omit" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.stores && j.stores.length) { DIRECTORY = j; DIAG.directory = j.stores.length; }
        })
        .catch(function (e) { DIAG.directoryError = String((e && e.message) || e); })
        .then(function () { if (t) { clearTimeout(t); done(); } });
    } catch (e) { if (t) { clearTimeout(t); done(); } }
  }

  /* Matched the way the directory is built: a host that only one store uses IS
     the identity, and a shared one needs a slug from the path before anything
     is named. A shared host with no slug match returns nothing -- an empty box
     stops the operator, a plausible wrong one does not, which is the whole
     lesson of the 693 Sapura rows published under Exclusive's name. */
  function fromDirectory() {
    if (!DIRECTORY) return null;
    var h = String(location.hostname || "").replace(/^www\./i, "");
    var segs = location.pathname.split("/").filter(Boolean), i, j, st;
    var onHost = [];
    for (i = 0; i < DIRECTORY.stores.length; i++) {
      st = DIRECTORY.stores[i];
      for (j = 0; j < st.hosts.length; j++) {
        if (h === st.hosts[j] || h.slice(-(st.hosts[j].length + 1)) === "." + st.hosts[j]) { onHost.push(st); break; }
      }
    }
    if (!onHost.length) return null;
    if (onHost.length === 1 && !onHost[0].shared.length) return onHost[0];
    for (i = 0; i < onHost.length; i++) {
      for (j = 0; j < onHost[i].slugs.length; j++) {
        if (segs.indexOf(onHost[i].slugs[j]) >= 0) return onHost[i];
      }
    }
    DIAG.storeAmbiguous = onHost.map(function (x) { return x.key; }).join(",");
    return null;
  }

  /* The town of a store key, straight out of the directory. Empty when the key
     is not on any roster -- which is exactly the case ?market= is left for, and
     also the case the ingest endpoint answers with "STORED, BUT IT WILL NOT
     APPEAR", so a wrong key is reported twice rather than guessed at once. */
  function marketFor(key) {
    if (!DIRECTORY || !key) return "";
    for (var i = 0; i < DIRECTORY.stores.length; i++) {
      if (DIRECTORY.stores[i].key === key) return DIRECTORY.stores[i].town || "";
    }
    return "";
  }

  function guessStore() {
    var d = fromDirectory();
    if (d) return d.key;
    var h = location.hostname;
    /* DETROIT'S NINE, matched on the shop's own host. A wrong guess is worse
       than none (the Sapura/Exclusive bug: 693 rows published under another
       shop's name), so these are only the hosts where one company has exactly
       one shop in the roster. The keys are api/market-stores.js's own.
       WHY THIS MATTERS MORE THAN IT LOOKS: the feed reads captures for roster
       keys ONLY -- readIngestMany(ROSTER.map(s => s.key)) -- so a key that is
       not on the roster stores perfectly and is never shown. A typed key is a
       silent way to lose an evening's capture. */
    if (/shophod\.com/.test(h)) return "hod-detroit";
    if (/libertycannabis\.com/.test(h)) return "liberty-detroit";
    if (/cloudcannabis\.com/.test(h)) return "cloud-detroit";
    if (/kingofbudz\.com/.test(h)) return "kingofbudz-detroit";
    if (/geniecannabis\.com/.test(h)) return "geniecannabis";
    if (/420factorydetroit\.com/.test(h)) return "420factory";
    if (/shophighclub\.com/.test(h)) return "highclub";
    if (/dacut\.com/.test(h)) return "dacut";
    if (/letsascend\.com/.test(h)) return "ascend-detroit";
    if (/lume\.com/.test(h)) return "lume";
    if (/dispensary\.shop/.test(h)) return "dude";
    if (/banzencoldwater/.test(h)) return "banzen";
    if (/shophcc/.test(h)) return "herbology";
    if (/greentreerelief/.test(h)) return "greentree";
    if (/exclusivemi\.com/.test(h)) return "exclusive";
    if (/dutchie\.com/.test(h)) {
      var seg = location.pathname.split("/").filter(Boolean), i;
      for (i = 0; i < seg.length; i++) {
        if (DUTCHIE_SLUGS[seg[i]]) return DUTCHIE_SLUGS[seg[i]];
        if (DUTCHIE_IDS[seg[i]]) return DUTCHIE_IDS[seg[i]];
      }
      try {
        var rid = new URLSearchParams(location.search).get("retailer_id") || "";
        if (DUTCHIE_IDS[rid]) return DUTCHIE_IDS[rid];
      } catch (e) {}
      return "";
    }
    return "";
  }

  /* WHEN A SITE FORBIDS THE POST ITSELF. The Dude Abides serves a
     Content-Security-Policy whose connect-src does not include this site, so
     the collector runs, reads the menu perfectly, and then cannot send it --
     reported as "could not fetch api ... only on that site". script-src and
     connect-src are separate permissions and a page may grant one and refuse
     the other.

     That refusal is the page's to make, so this does not try to get round it.
     It uses a route CSP does not govern instead: window.open is a NAVIGATION,
     not a connection, so a tab on our own origin can be opened and handed the
     capture with postMessage. That tab then posts to our own API same-origin,
     where there is no cross-origin request to forbid.

     The token rides along in that message, pinned to our exact origin as
     targetOrigin, and both ends check event.origin. It is no new exposure: the
     collector already put that token in this origin's sessionStorage, so any
     script on the shop page could read it already. The relay uses it for one
     request and never stores it. */
  function sendViaRelay(payload, token, done) {
    var origin;
    try { origin = new URL(API).origin; } catch (e) { return done({ error: "bad API origin" }); }
    var win = window.open(origin + "/coldwater-collect?receive=1", "ll_collector_relay");
    if (!win) return done({ error: "popup blocked", blocked: true });

    var settled = false;
    function onMsg(ev) {
      if (ev.origin !== origin || !ev.data) return;
      if (ev.data.type === "ll-relay-ready") {
        win.postMessage({ type: "ll-capture", payload: payload, token: token }, origin);
      } else if (ev.data.type === "ll-relay-result") {
        settled = true;
        window.removeEventListener("message", onMsg);
        done(ev.data);
      }
    }
    window.addEventListener("message", onMsg);
    setTimeout(function () {
      if (settled) return;
      window.removeEventListener("message", onMsg);
      done({ error: "the relay tab did not answer" });
    }, 30000);
  }

  function renderResult(res, store, collection) {
    /* A PARTIAL DROP IS NOT A SUCCESS AND MUST NOT BE PAINTED AS ONE. This read
       "Sent. 14 products" in the same green as a complete capture while 1,364
       rows of a 1,378-row batch went in the bin -- the panel had no idea,
       because the endpoint only explained itself on the 400. It reports both
       numbers now, in amber, with the server's own reason under them. */
    var dropped = res.ok ? Number(res.j.dropped || 0) : 0;
    panel(res.ok
      ? (dropped > 0
          ? '<div style="color:#ffb454"><b>Sent ' + res.j.stored + ' of ' + res.j.received +
            '.</b> ' + dropped + ' rows were dropped, into <b>' + esc(collection) +
            '</b> for <b>' + esc(store) + '</b>.</div>' +
            '<div style="color:#ffb454;font-size:12.5px;margin-top:6px">' + esc(res.j.why || "") + '</div>'
          : '<div style="color:#7ee787"><b>Sent.</b> ' + res.j.stored + ' products into <b>' + esc(collection) + '</b> for <b>' + esc(store) + '</b>.</div>') +
        (res.j.total != null
          ? '<div style="margin-top:8px;font-size:13px;color:#eaf2f6"><b>' + res.j.total + '</b> products across <b>' +
            ((res.j.collections || []).length) + '</b> collections</div>' +
            '<div style="font-size:12px;color:#9fb4c2;margin-top:4px">' +
            (res.j.collections || []).map(function (c) { return esc(c.name) + " (" + c.products + ")"; }).join(", ") + '</div>'
          : "") +
        '<div style="color:#9fb4c2;font-size:12.5px;margin-top:8px">' + esc(res.j.note || "") + '</div>'
      : '<div style="color:#ff8459"><b>Rejected.</b></div><div style="font-size:12.5px;margin-top:6px;color:#c9d6de">' +
        esc(res.j.error || "unknown") + (res.j.why ? '<br><br>' + esc(res.j.why) : "") + '</div>',
      [{ label: "Close", fn: function () { document.getElementById("ll-collector").remove(); } }]);
  }

  function send() {
    var store = (document.getElementById("ll-store").value || "").trim();
    var collection = (document.getElementById("ll-collection").value || "").trim() || "default";
    var token = (document.getElementById("ll-token").value || "").trim();
    if (!store || !token) { alert("Store key and admin token are both required."); return; }
    sessionStorage.setItem(STORE_KEY, store);
    sessionStorage.setItem(TOKEN_KEY, token);

    /* THE MARKET IS THE TOWN OF THE STORE BEING SENT, and deriving it here
       rather than at load is what makes it impossible to disagree with itself:
       whatever key is in the box is the thing being written, so its town is the
       namespace it belongs in -- including when the operator typed the key by
       hand, which no amount of host matching would have caught.
       ?market= is the fallback for a key nobody has registered. */
    var market = marketFor(store) || MARKET_PARAM || "coldwater";
    var payload = {
      storeKey: store, collection: collection, market: market, products: found,
      source: "collector/" + location.hostname + " via " + (DIAG.via || "page state"),
      href: location.href,
    };

    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ll-admin-token": token },
      /* The layer travels with the capture. A shelf full of DOM-scraped rows
         with no strain or THC is a different thing from a state capture, and
         /api/coldwater/ingest records it, so which one produced a given store
         is answerable later without guessing. */
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { renderResult(res, store, collection); })
      .catch(function (e) { relayFallback(e); });

    function relayFallback(e) {
      panel('<div>This site blocks sending directly.</div>' +
        '<div style="font-size:12.5px;margin-top:8px;color:#9fb4c2">Its Content-Security-Policy does not allow a request to legal-leafmarket.com. ' +
        'Opening a tab there instead &mdash; allow the popup if asked.</div>');
      sendViaRelay(payload, token, function (r) {
        if (r && r.result) return renderResult({ ok: r.ok, j: r.result }, store, collection);
        panel('<div style="color:#ff8459"><b>Could not send.</b></div>' +
          '<div style="font-size:12.5px;margin-top:6px;color:#c9d6de">' +
          esc((r && r.error) || (e && e.message) || e) +
          (r && r.blocked ? '<br><br>The popup was blocked. Allow popups for this site and press Send again, or use Copy capture and paste it at /coldwater-collect.' : "") +
          '</div>',
          [
            /* Last resort that no policy can refuse: the clipboard. The install
               page takes a pasted capture. */
            { label: "Copy capture", primary: true, fn: function () {
              var t = JSON.stringify(payload);
              try { navigator.clipboard.writeText(t); this.textContent = "Copied \u2014 paste at /coldwater-collect"; }
              catch (err) { this.textContent = "Clipboard refused"; }
            } },
            { label: "Close", fn: function () { document.getElementById("ll-collector").remove(); } },
          ]);
      });
    }

  }

})();

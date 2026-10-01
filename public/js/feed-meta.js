/* public/js/feed-meta.js -- one read of the catalogue, one meta object.
 *
 * public/js/rails.js needs three things the product grid does not publish:
 * each shop's DOMAIN (the store strip draws every shop's own mark, and a
 * favicon needs a host), every MAKER with how many shops carry it (the brand
 * strip's entire point is that a brand at one shop is a label and a brand at
 * three is a price comparison), and a POOL OF PHOTOGRAPHS per category. All
 * three are in /api/products already.
 *
 * IT DOES NOT FETCH. That is the whole design of this file, and the reason is
 * measurable: public/index.html already asks for /api/products FOUR times on a
 * cold load -- once from the engine, and once each from ll-coupon-pct,
 * ll-trim-label and ll-checkout-fix, every one of them a separate additive
 * block that grew its own fetch because there was nothing to share. The
 * response is ~7MB raw and carries `s-maxage`/`stale-while-revalidate`, which
 * Vercel consumes at the edge and strips, so what reaches the browser is a bare
 * `Cache-Control: public` with no max-age -- no heuristic freshness, and
 * therefore a revalidation per caller at best. A fifth consumer that fetched
 * for itself would be the wrong answer to the wrong question.
 *
 * So this wraps fetch and TAPS what the page was going to request anyway,
 * cloning the response so every existing caller still receives an unread body.
 * That is the same shape the generator's cw-endpoint shim already uses on the
 * city pages, for the same reason.
 *
 * IT MUST RUN BEFORE ANY CALLER, hence a plain <script> in <head> rather than
 * defer -- a tap installed after the engine has already asked sees nothing, and
 * would fail by drawing three empty rails, which reads as a data problem.
 *
 * ON A GENERATED CITY PAGE IT STANDS DOWN, and does so without a flag. The
 * generator's cw-endpoint wrapper is installed later, so it wraps THIS one, and
 * it repoints /api/products to /api/coldwater before calling through. By the
 * time the request reaches this tap the path no longer matches, so it passes
 * straight through and cw-endpoint publishes LL_COLDWATER_META as it always
 * has. One code path, no branch, nothing to keep in step.
 */
(function () {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__LL_FEED_META__) return;
  window.__LL_FEED_META__ = 1;

  var real = window.fetch;

  /* AND IT COLLAPSES THE BURST, which is the other half of the same finding.
     Measured in real Chromium against a stubbed feed: FOUR requests for
     /api/products on one cold load. Tapping alone would have left all four --
     an observer that watches waste happen is not a fix -- so identical URLs
     share one request and every caller receives its own clone.
     KEYED ON THE FULL URL, so ?refresh and ?debug are different requests and
     stay that way; a blanket memo would turn the refresh button into a no-op,
     which is the kind of break that looks like the server ignoring you.
     SIXTY SECONDS, not forever. The edge already answers this route with a
     ten-minute s-maxage and a day of stale-while-revalidate, so a one-minute
     client window cannot make anything staler than it already was -- it only
     covers the load burst, where every one of those four fires inside a second
     of the others. Anything asking a minute later gets a fresh request. */
  var TTL = 60000;
  var inflight = {};

  /* Same-origin only, and absolute forms too: a Request object carries a fully
     resolved .url, so a bare path test would pass on the string call and miss
     the Request one -- the kind of half-cover that reads as working. Query
     strings are allowed through because ?refresh and ?debug are the same feed. */
  function isFeed(u) {
    if (typeof u !== "string") return false;
    var s = u;
    if (s.indexOf(location.origin) === 0) s = s.slice(location.origin.length);
    return s.indexOf("/api/products") === 0;
  }

  /* THE FOUR VIRTUAL CATEGORIES, AND WHY THEY HAD NO PICTURE AT ALL.
     Vape, Drinks, Trim/Shake and CBD/CBG are not values of p.category. They are
     SUB-TAGS -- cross-cutting labels the engine overlays on top of the base
     category and then pushes into #fCategory as if they were categories
     (public/engine.js: SUBTAG_DEFS, and the `cats.push("Trim/Shake")` block).
     So a card's data-cat is "Concentrate" or "THCA Flower" and NEVER one of
     these four, and the feed states no such category either.

     That is why exactly those four chips showed a drawn mark: rails.js scores a
     pool keyed on the feed's category and falls back to reading data-cat off the
     grid, and NEITHER source can ever produce one of these keys. Not a thin
     shelf, not a scoring miss -- a key that cannot occur. Nothing errors, and
     the four look identical to a category that genuinely has no photographs.

     THE TESTS ARE THE ENGINE'S OWN, COPIED DELIBERATELY. subTagOn() is inside
     the blob and is not reachable from here, the same way _applyOv is not
     reachable from public/js/overrides.js. So they are twinned, and
     test-virtual-cats.mjs reads these three literals back out of
     public/engine.js (which is byte-identical to the decoded blob) and fails if
     either copy moves. An override on p.subTags wins over the regex, exactly as
     subTagOn does it, so an admin decision reaches the chip as well as the grid. */
  var VAPE_RE = /\b(vape|vapes|cart|carts|cartridge|cartridges|disposable|dispo|510|pod|pods)\b/i;
  var DRINK_SUB_RE = /\b(seltzer|soda|drink|beverage|syrup|shot|cocktail|mocktail|tonic|spritz|spirit|blitzd|pamos|mantra|tincture|infused\s*(beverage|drink)|\d+\s*(ml|fl\s*oz)|case\s*of\s*\d+|reserve\s*spirit)\b/i;
  var TRIM_RE = /trim|shake/i;
  function subTag(x, key) {
    var ov = x && x.subTags;
    if (ov && typeof ov === "object" && Object.prototype.hasOwnProperty.call(ov, key)) return !!ov[key];
    var n = String((x && x.name) || "");
    if (key === "vape") return VAPE_RE.test(n) || /vape/i.test(String((x && x.category) || "")) || /active\s*flowers?/i.test(n);
    if (key === "cbd") return String((x && x.cannabinoid) || "") === "CBD";
    if (key === "drink") return DRINK_SUB_RE.test(n);
    if (key === "trim") return TRIM_RE.test(n);
    return false;
  }
  /* Keyed by the value the engine puts in the #fCategory OPTION, not by the
     label it prints: the CBD facet's value is "CBD" and its label is "CBD/CBG"
     (canLabel), and the chip is a face for the option. */
  var VIRTUAL = [["vape", "Vape"], ["cbd", "CBD"], ["drink", "Drinks"], ["trim", "Trim/Shake"]];

  function build(j) {
    var products = (j && j.products) || [];
    if (!products.length) return;

    var domains = {}, brands = {}, catPool = {}, desc = {}, trim = {}, catOf = {}, specs = {};
    for (var i = 0; i < products.length; i++) {
      var x = products[i];
      if (!x) continue;

      /* Keyed by store NAME, because that is what the engine puts in the
         #fStore option value, and the strip is a face for that select. */
      if (x.store && x.domain && !domains[x.store]) domains[x.store] = x.domain;

      /* THE SENTENCES, WHICH THE ENGINE ONLY PRINTS ON ONE CARD BRANCH.
         api/products.js has published `description` for every store since the
         descriptions work, and public/engine.js renders it in exactly one
         place: the accessory / Greek Glass branch (.ggdtext). Every flower card
         goes down the size-selecting branch, which never prints a word -- which
         is why "we've tried a few times" to get the sentences onto a card and
         never landed it globally. The engine is inside the blob and is not
         edited (CLAUDE.md section 5), so the flip back reads them from here.
         Keyed on the feed's own product id, which is the id the card carries in
         data-pid, so the join is exact rather than by printed title. */
      if (x.id && x.description) desc[x.id] = String(x.description);

      /* THE HARDWARE FACTS, for the card back. api/specs.js derives them at
         scrape time from the merchant's own name and description -- joint,
         thread, height, material, battery -- and only for gear, so this is
         absent on every flower row by construction rather than by a test here.
         Keyed on the feed's product id, which is what data-pid carries, so the
         join is exact rather than by printed title.

         A CITY PAGE PUBLISHES NOTHING HERE AND THAT IS CORRECT. The rule that
         both meta publishers must carry a field under the same name exists
         because a missing one leaves a blank card back; here blank IS the
         answer, since a dispensary sells flower and this field only ever
         describes hardware. cw-endpoint is deliberately not grown a copy. */
      if (x.id && x.specs && typeof x.specs === 'object') specs[x.id] = x.specs;

      /* THE FEED'S OWN WORD FOR THIS PRODUCT'S CATEGORY, keyed on the id the
         card carries in data-pid. perCat above is keyed on the feed's vocabulary
         while #fCategory carries the ENGINE's, and the two agree on this shelf
         and genuinely do not on a city page ("Flower" against "THCA Flower").
         Publishing the pair lets rails.js learn the translation off rendered
         cards, where data-pid and data-cat sit in the same element and cannot
         disagree -- rather than either side keeping a copy of normCategory. */
      if (x.id && x.category) catOf[x.id] = String(x.category);

      /* HOW MANY SHOPS is the field that matters; the count of products is
         only the chip's label. A maker seen at one shop still gets a chip --
         the rail decides for itself whether the set is worth drawing. */
      if (x.brandKey && x.brand) {
        var e = brands[x.brandKey];
        if (!e) e = brands[x.brandKey] = { disp: x.brand, n: 0, stores: [], img: "",
                                           perStore: {}, perCat: {}, perPair: {} };
        e.n++;
        if (e.stores.indexOf(x.store) < 0) e.stores.push(x.store);
        /* WHERE EACH MAKER'S PRODUCTS ACTUALLY ARE, so the brand rail can answer
           the other two rails. It was built from the whole feed once and never
           read them -- reported as "the brand strip is not faceted to the others,
           it isn't filtering or changing when I click on the other circles" --
           because the engine has no brand control for it to be a face for, the
           way #fStore and #fCategory carry the other two.
           THREE TALLIES RATHER THAN ONE, so no count is ever estimated: a shop on
           its own, a category on its own, and the pair. A rail that showed a
           brand's whole-feed count under a filtered grid would be stating a
           number the shopper can see is wrong. */
        var st = String(x.store || "");
        if (st) e.perStore[st] = (e.perStore[st] || 0) + 1;
        var cats = [];
        if (x.category) cats.push(String(x.category));
        for (var w = 0; w < VIRTUAL.length; w++) if (subTag(x, VIRTUAL[w][0])) cats.push(VIRTUAL[w][1]);
        for (var y = 0; y < cats.length; y++) {
          e.perCat[cats[y]] = (e.perCat[cats[y]] || 0) + 1;
          if (st) { var pk = st + "\u0000" + cats[y]; e.perPair[pk] = (e.perPair[pk] || 0) + 1; }
        }
        /* THE BRAND'S PICTURE IS ITS OWN PRODUCT PHOTO. There is no logo table
           to commit and keep in step, and the favicon trick the store strip
           uses needs a domain, which a maker does not have here. */
        if (!e.img && x.image) e.img = x.image;
      }

      /* CATEGORY PICTURES COME FROM THE FEED, NOT FROM THE SCREEN. Reading them
         off the rendered grid can only ever see the cards currently drawn --
         forty of them, from whichever shops sorted first -- which on Coldwater
         left six of eight categories with no candidate at all and was reported
         as "two real pictures out of eight". Forty candidates per category is
         enough for the chooser to have a real choice and small enough to hand
         over. rails.js still reads the grid as a FALLBACK, which is what covers
         the gap below. */
      if (x.image && x.category) {
        var b = catPool[x.category] || (catPool[x.category] = []);
        /* THE SHOP TRAVELS WITH THE PHOTOGRAPH, because a category's face is not
           only a question about the product. Asked for directly -- "for
           concentrate, use one of hipuffy's pics" -- and a name cannot answer
           it: every shop's badder is called badder. rails.js scores on the name
           and breaks toward a preferred shop where one is stated. */
        if (b.length < 40) b.push({ n: String(x.name || ""), img: x.image, s: String(x.store || "") });
      }

      /* THE VIRTUAL FACETS, from the same product, under the key the OPTION
         carries. A product can be in several at once (a CBD shake is both), so
         these are additive rather than a switch, and they sit beside the base
         category rather than replacing it -- which is what "overlay" means. */
      if (x.image) {
        for (var v = 0; v < VIRTUAL.length; v++) {
          if (!subTag(x, VIRTUAL[v][0])) continue;
          var vb = catPool[VIRTUAL[v][1]] || (catPool[VIRTUAL[v][1]] = []);
          if (vb.length < 40) vb.push({ n: String(x.name || ""), img: x.image, s: String(x.store || "") });
        }
      }

      /* WHICH LISTINGS ARE OFFCUTS, for shelf-shuffle.js. Same question the
         Trim/Shake facet asks, so it is answered once here rather than a third
         time there. Keyed on the feed's id, which is what data-pid carries. */
      if (x.id && subTag(x, "trim")) trim[x.id] = 1;
    }

    /* THE ONE SHOP THE FEED STRUCTURALLY CANNOT DESCRIBE. Greek Glass is
       deliberately kept out of /api/products (CLAUDE.md section 7) -- it is
       baked into the engine and refreshed client-side from Big Cartel -- so the
       loop above can never learn its domain, and its chip drew a tinted "G"
       while every other shop drew its own mark. Reported exactly that way.

       The domain is on the page regardless: the seed products carry
       domain:"www.greekglassshop.com" alongside their store name. So this reads
       the engine's own seed rather than committing a domain table, which is the
       same reason the strip fetches a favicon instead of storing a logo -- one
       fact, in one place, and it follows the seed if the shop ever moves.

       GAP-FILL ONLY, never an overwrite: the feed is the authority for any shop
       it does carry. And on a city page the generator blanks this global, so
       this finds nothing and adds nothing -- no flag, no branch.

       THE GREEK GLASS SEED SPECIFICALLY, NOT LL_PRODUCTS, and the difference is
       not tidiness. LL_PRODUCTS also holds the MAIN seed -- the engine's baked
       hemp catalogue, which exists to paint something instantly and is hot-
       swapped out the moment the feed answers. Those shops ARE in the feed, so
       filling from them adds nothing the loop above did not already have, and
       adds it in the feed's own key space: on a generated shelf page, where the
       feed is a SLICE, it puts shops in the rail that the shelf does not carry.
       test-shelves.mjs caught exactly that. The cross-sell seed is the only one
       the feed never describes and never replaces. */
    try {
      var seed = window.LL_GREEKGLASS_SEED || [];
      for (var q = 0; q < seed.length; q++) {
        var sp = seed[q];
        if (sp && sp.store && sp.domain && !domains[sp.store]) domains[sp.store] = sp.domain;
      }
    } catch (e) {}

    window.LL_META = window.LL_META || {};
    window.LL_META.domains = domains;
    window.LL_META.brands = brands;
    window.LL_META.catPool = catPool;
    window.LL_META.desc = desc;
    window.LL_META.specs = specs;
    /* WHAT SOMEBODY ELSE THOUGHT, for the card back -- the first approved
       comment and a count, nothing more. It does NOT come from /api/products:
       comments are approved on a different clock from the one the catalogue is
       scraped on, so they ride their own small endpoint and their own cache
       window. Fetched once here so every card back shares one request, which is
       this file's whole reason to exist. */
    fetchComments();
    window.LL_META.trim = trim;
    window.LL_META.catOf = catOf;
    try { document.dispatchEvent(new CustomEvent("ll-meta")); } catch (e) {}
  }

  /* THE KEYING CAVEAT, written down because it is the failure mode this file
     inherits rather than one it introduces. catPool is keyed on the category
     the FEED states, while the chip is keyed on what reaches #fCategory -- and
     the engine runs its own normCategory over every row, reclassifying by NAME.
     On this feed the two vocabularies are the same words (api/products.js was
     written against the engine), so most categories match; a bucket the engine
     invents by name and the feed never states will simply have no pool entry.
     That case is exactly what rails.js's grid fallback is for, and the symptom
     of getting it wrong is a drawn glyph rather than a wrong picture. */
  /* Only a plain GET is shared. A caller passing a body, a method, or its own
     headers is asking for something this cache cannot claim to have. */
  function shareable(init) {
    if (!init) return true;
    var m = String(init.method || "GET").toUpperCase();
    return m === "GET" && !init.body;
  }

  window.fetch = function (input, init) {
    var url = null;
    try { url = typeof input === "string" ? input : (input && input.url); } catch (e) {}
    if (!isFeed(url) || !shareable(init)) return real.call(this, input, init);

    var hit = inflight[url];
    if (hit && (hit.settled === false || (Date.now() - hit.at) < TTL)) {
      /* .clone() on the SHARED response, never the response itself: a body can
         only be read once, and handing the same one to two callers means the
         second gets an empty stream -- which surfaces as a JSON parse error in
         whichever block happened to lose the race. */
      return hit.p.then(function (res) { return res.clone(); });
    }

    var entry = { at: Date.now(), settled: false, p: null };
    entry.p = real.call(this, input, init).then(function (res) {
      entry.settled = true; entry.at = Date.now();
      try {
        if (res && res.ok && typeof res.clone === "function") {
          res.clone().json().then(build).catch(function () {});
        }
      } catch (e) {}
      return res;
    }, function (err) {
      /* A FAILED FETCH IS NOT CACHED. Otherwise one flaky first request poisons
         every later caller for a minute, and the page looks broken with no
         request in the network tab to explain why. */
      delete inflight[url];
      throw err;
    });
    inflight[url] = entry;
    return entry.p.then(function (res) { return res.clone(); });
  };

  /* One request for the whole shelf, and a failure is silence: a card back
     without a comment is the normal case, so an unreachable endpoint must look
     exactly like an empty one rather than like a broken page. */
  function fetchComments() {
    if (window.LL_META && window.LL_META.comments && Object.keys(window.LL_META.comments).length) return;
    try {
      fetch("/api/comments", { headers: { accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.p) return;
          window.LL_META = window.LL_META || {};
          window.LL_META.comments = j.p;
        })
        .catch(function () {});
    } catch (e) {}
  }
})();

/* ============================================================
   shelf-order.js : ordering for the accessory shelves
   ------------------------------------------------------------
   /devices and /international are not price comparison shelves. There is no
   honest per unit number to rank a grinder against a dab mat, so the old sort
   fell back to newest first, which tells a shopper nothing and buries good
   stock behind whatever was scraped most recently.

   The owner's call: order them randomly, with cheap items at the bottom.

   Random is deliberate. It gives every product a turn at the top across
   visits instead of freezing one arbitrary order forever, and it makes the
   shelf look different each time you come back.

   Cheap items sink because the alternative looks broken. Measured on the live
   feed, 21% of in stock accessories are under $15: rolling papers at $0.99,
   filter tips at $1.59, a $1.04 dab mat, silicone inserts at $1.00. A truly
   uniform shuffle puts a fistful of those at the top of a page selling $600
   rigs, and the shelf reads as junk.

   NOT sorted by price. Cheap items are demoted as a block and shuffled within
   it, so the bottom of the page is still varied rather than a price ladder.
   ============================================================ */
(function () {
  "use strict";

  /* One seed per page load. Deliberately NOT per call: filtered() re-runs on
     every keystroke and filter change, and re-rolling there would reshuffle
     the grid under the reader's cursor while they were using it. Stable for
     the visit, different on the next one. */
  var SEED = (Math.floor(Math.random() * 2147483646) + 1);
  function rnd() {
    SEED = (SEED * 16807) % 2147483647;
    return (SEED - 1) / 2147483646;
  }

  /* The threshold is in whatever currency the product is listed in. 15 of the
     ~1200 accessories are priced in EUR and the rest in USD, and at these
     amounts the two are close enough that converting would add a dependency
     and change nothing. If the EUR catalogue grows, revisit this. */
  var LOW_DOLLAR = 15;

  /* Assigned once per product object, so the order holds while a reader
     filters and searches. Products are rebuilt on each ingest, so a genuine
     reload gets a genuinely new order. */
  function keyOf(p) {
    if (p._shelfKey === undefined) p._shelfKey = rnd();
    return p._shelfKey;
  }

  function isLow(p, limit) {
    var v = parseFloat(p && p.sale);
    return (v > 0 && v < (limit || LOW_DOLLAR));
  }

  /* ============================================================
     GREATEST HITS, for /consumables
     ------------------------------------------------------------
     Ranking that page purely by price per gram turned it into a ladder: the top
     was bulk trim forever, because trim is always the cheapest thing per gram.
     Accurate, and a bad shop window. The owner asked for greatest hits that
     encourage finding new things instead.

     So: score on signals we actually hold, shuffle within score bands so the page
     is different every visit, then spread the stores out.

     The scores are not a quality judgement we invented. Each one is a fact about
     the listing, and the biggest is the thing this site is uniquely good at:

       +3  a certificate was read and its arithmetic checks out. A card carrying
           measured numbers is the best thing we can put in front of anyone.
       +1  a certificate exists but is a store sheet or an index page.
       +2  genuinely marked down (startsAt above sale).
       +2  new in the last three weeks. This is the "find new things" half,
           stated literally.
       +1  more than one size, so there is something to explore on the back.
       +1  has a photo. A card with no image is not a greatest hit.

     Measured on the live pool of 487 in stock items: 23% carry lab data, 30% are
     on a deal, 45% are multi size, 99% have a photo. So the bands are populated
     rather than everything landing in one bucket.
     ============================================================ */
  function hitScore(p){
    var n = 0;
    if (p.lab) n += 3;
    else if (p.coaScope === 'product' || p.labTested) n += 1;
    var b = p.badges || [];
    if (b.indexOf('deal') >= 0) n += 2;
    if (b.indexOf('new') >= 0) n += 2;
    if ((p.sizes || []).length > 1) n += 1;
    if (p.image) n += 1;
    return n;
  }

  /* Spread the stores out. Without this the top of the page is whichever shop
     happens to have the most high scoring stock, which reads as a single store's
     catalogue rather than a market. Greedy: walk the ranked list and take the best
     remaining item whose store has not appeared in the last GAP picks, falling
     back to the best remaining when every store is on cooldown. Rank order is
     otherwise preserved, so this rearranges neighbours, it does not re-sort. */
  var GAP = 3;
  function spreadStores(rows){
    var out = [], pool = rows.slice(), recent = [];
    while (pool.length) {
      var pick = 0;
      for (var i = 0; i < pool.length; i++) {
        if (recent.indexOf(String(pool[i].storeKey || pool[i].store || '')) < 0) { pick = i; break; }
      }
      var p = pool.splice(pick, 1)[0];
      out.push(p);
      recent.push(String(p.storeKey || p.store || ''));
      if (recent.length > GAP) recent.shift();
    }
    return out;
  }

  /* ============================================================
     SORTING, for all three shelf pages
     ------------------------------------------------------------
     Until now these pages had filters but no sort, so the only order available
     was whatever the page decided for you. This is the shared implementation so
     the three cannot drift.

     "Featured" is not handled here. It stays with each page, because it means
     something different on each: greatest hits on /consumables, shuffle with
     cheap demoted on the accessory shelves. Everything else is a plain,
     predictable ordering, which is the point of offering a sort at all.

     ON CATEGORY AND SUBCATEGORY

     The owner asked for category/subcategory. Measured on the live feed, that is
     only half available:

       /consumables    5 categories, and real subcategory data: cannabinoid is
                       filled on 100% of items, grow on 27%, type on 25%.
       /devices        12 categories, but type is filled on 0 of 1204 items and
       /international  grow on 1. cannabinoid is the constant "Accessory".

     So accessories get category then name, because there is no second level to
     sort by and inventing one would be worse than not having it. Consumables
     get category, then cannabinoid, then grow, then type, then name.

     Category order is curated on /consumables (flower, then pre-rolls, then
     concentrate, and so on) because a shop has an obvious running order and
     alphabetical would put Concentrate above Flower. Accessories are
     alphabetical, because Grinders before Pipes before Rigs carries no meaning
     and predictable beats arbitrary.
     ============================================================ */
  function cmpStr(a, b) { return String(a || '').localeCompare(String(b || ''), 'en', { sensitivity: 'base' }); }

  function catRank(p, order) {
    if (!order || !order.length) return null;
    var i = order.indexOf(String(p.category || ''));
    return i < 0 ? order.length : i;          /* anything unlisted sorts last */
  }

  /* Missing numbers sort LAST in both directions. An item with no price is not
     the cheapest thing on the page and it is not the dearest either; it simply
     cannot be ranked, so it goes to the end rather than colonising either top. */
  function numCmp(av, bv, dir) {
    var a = (typeof av === 'number' && isFinite(av) && av > 0) ? av : null;
    var b = (typeof bv === 'number' && isFinite(bv) && bv > 0) ? bv : null;
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return dir === 'desc' ? (b - a) : (a - b);
  }

  function sortBy(rows, mode, cfg) {
    cfg = cfg || {};
    var order = cfg.categoryOrder || null;
    var subs = cfg.subKeys || [];
    var perGram = cfg.perGram || null;
    var live = cfg.inStockOf || null;
    var out = rows.slice();

    out.sort(function (a, b) {
      /* Stock state outranks every mode. A sold out item is not the cheapest
         thing you can buy, whatever the number on it says. */
      if (live) {
        var la = live(a) ? 0 : 1, lb = live(b) ? 0 : 1;
        if (la !== lb) return la - lb;
      }
      var r;
      if (mode === 'category') {
        var ra = catRank(a, order), rb = catRank(b, order);
        if (ra !== null && ra !== rb) return ra - rb;
        if (ra === null) { r = cmpStr(a.category, b.category); if (r) return r; }
        for (var i = 0; i < subs.length; i++) {
          r = cmpStr(a[subs[i]], b[subs[i]]);
          if (r) return r;
        }
        return cmpStr(a.name, b.name);
      }
      if (mode === 'price-asc')  return numCmp(+a.sale, +b.sale, 'asc')  || cmpStr(a.name, b.name);
      if (mode === 'price-desc') return numCmp(+a.sale, +b.sale, 'desc') || cmpStr(a.name, b.name);
      if (mode === 'pergram' && perGram) return numCmp(perGram(a), perGram(b), 'asc') || cmpStr(a.name, b.name);
      if (mode === 'thc') {
        var ta = (a.lab && typeof a.lab.totalThc === 'number') ? a.lab.totalThc : null;
        var tb = (b.lab && typeof b.lab.totalThc === 'number') ? b.lab.totalThc : null;
        return numCmp(ta, tb, 'desc') || cmpStr(a.name, b.name);
      }
      if (mode === 'new')  return (b.added || 0) - (a.added || 0);
      if (mode === 'name') return cmpStr(a.name, b.name);
      return 0;
    });
    return out;
  }

  window.LL_SHELF = {
    lowDollar: LOW_DOLLAR,

    /* Drop-in comparator tail. Returns a number, so it slots straight into an
       existing sort after the stock-state rules have had their say. */
    compare: function (a, b, limit) {
      var la = isLow(a, limit) ? 1 : 0, lb = isLow(b, limit) ? 1 : 0;
      if (la !== lb) return la - lb;          /* cheap sinks */
      return keyOf(a) - keyOf(b);             /* otherwise random */
    },

    isLow: isLow,

    /* Score, shuffle within band, then spread the stores. Out of stock items keep
       their existing demotion by scoring below everything in stock. */
    greatestHits: function (rows, inStockOf) {
      var scored = rows.map(function (p) {
        var live = inStockOf ? !!inStockOf(p) : true;
        return { p: p, live: live, s: hitScore(p), k: keyOf(p) };
      });
      scored.sort(function (a, b) {
        if (a.live !== b.live) return a.live ? -1 : 1;
        if (a.s !== b.s) return b.s - a.s;
        return a.k - b.k;                       /* random inside a score band */
      });
      return spreadStores(scored.map(function (x) { return x.p; }));
    },

    hitScore: hitScore,

    sortBy: sortBy,

    /* Curated running orders. Consumables follows how a shop is walked; accessories
       are alphabetical because no order there carries meaning. */
    CONSUMABLE_ORDER: ['THCA Flower','Pre-rolls','Concentrate','Edibles','Drinks','Topicals'],

    /* Lift the first n products of a category to the very front, preserving
       whatever order they already had among themselves. Used to guarantee the
       top of /international opens on grinders rather than on whatever the
       shuffle happened to deal. Anything already at the front because of an
       earlier rule stays ahead of them: this only reorders what it moves. */
    liftCategory: function (rows, category, n) {
      if (!category || !(n > 0)) return rows;
      var picked = [], rest = [];
      for (var i = 0; i < rows.length; i++) {
        var p = rows[i];
        if (picked.length < n && String(p.category || "") === category) picked.push(p);
        else rest.push(p);
      }
      return picked.concat(rest);
    }
  };
})();

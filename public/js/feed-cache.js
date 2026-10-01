/* public/js/feed-cache.js — the last shelf you saw, instead of the baked seed.
 *
 * "Fuck the seed. It sucks anyway and doesn't even have pictures. Can you always
 *  put the last cache up instead of the seed, and then refresh on top of that."
 *
 * ------------------------------------------------------------------
 * WHAT THE SEED IS AND WHY IT LOSES. public/engine.js ships a hardcoded
 * window.LL_PRODUCTS so the grid is never blank while /api/products is in
 * flight. It is a handful of rows with no photographs, and on any connection
 * slower than an office one it is what a visitor looks at first. The catalogue
 * they saw last time is better on every axis: real products, real prices, real
 * pictures, and theirs.
 *
 * ------------------------------------------------------------------
 * A FETCH SHIM, BECAUSE THE ENGINE'S SEED IS NOT REACHABLE ANY OTHER WAY.
 *
 * The obvious lever does not exist. The engine prefers window.LL_MAIN_RAW over
 * its seed, but only inside LL_rebuildWithGG(), which is closure-scoped and
 * never put on window -- measured: zero assignments, two internal calls, both
 * from the Big Cartel refresh. LL_admin.reprocess() re-runs ingest but only
 * from the engine's own captured list. There is no way in from outside, and
 * re-encoding engine.js to add one is the thing CLAUDE.md section 5 exists to
 * forbid.
 *
 * What IS reachable is the request. The engine fetches /api/products exactly
 * once and renders whatever comes back, so answering that call from cache is
 * the whole feature -- and this repo already repoints that same URL twice, in
 * cw-endpoint and in feed-meta, so the mechanism is proven here rather than
 * invented.
 *
 * ------------------------------------------------------------------
 * IT IS A RACE, NOT A CACHE-FIRST, and that distinction is the honest part.
 *
 * The engine applies the feed ONCE. There is no second apply to refresh into,
 * so "cache now, live a moment later" is not available without re-implementing
 * the engine's ingest -- which would be a second copy of the hardest code in
 * the repo. So: whichever is ready first wins, with the cache given a short
 * head start it usually needs and never a long one.
 *
 *   - network back within GRACE  -> the live catalogue, exactly as today
 *   - network slower than that   -> last visit's shelf, instantly
 *   - either way the network response refreshes the cache for next time
 *
 * On a fast connection nothing changes. On a slow one the seed is replaced by
 * real inventory. Staleness is bounded at one visit, and the tab that shows it
 * is already writing the fresher copy while the shopper reads.
 *
 * ------------------------------------------------------------------
 * WHAT IS STORED, AND WHY NOT ALL OF IT. The full feed is ~7MB and localStorage
 * is a ~5MB budget shared with everything else on the origin, so storing it
 * whole would throw QuotaExceededError on the first write and cache nothing at
 * all -- worse than not trying. Capped at CAP products with `gallery` dropped
 * (the largest field by far, and a first paint needs one photo per card, not
 * eight). Anything that still will not fit is skipped rather than retried
 * smaller: a shelf is either worth showing or it is not.
 *
 * KEYED ON THE FULL URL, WHICH IS NOT A DETAIL -- IT IS THE SHELVES. The
 * generated pages (/consumables, /devices, /international, /vaporizers,
 * /combustion) do not fetch a different route: tools/make-shelf.mjs repoints
 * this exact path to /api/products?shelf=<slug>, so the PATHNAME is identical
 * and only the query separates a gear catalogue from a flower one. One key
 * across all six would mean a visit to /devices deciding what the hemp shelf
 * shows on the next slow load -- a wrong shelf under the right heading, which
 * is worse than the seed by a distance and would look like a scraper bug. Same
 * rule feed-meta already applies to its dedupe, for the same reason.
 * MAX_ENTRIES bounds the ring so six shelves cannot spend the whole origin
 * budget; the oldest write is evicted, which on any real visit is the shelf
 * that visit is not on.
 *
 * NEVER ON A CITY PAGE. cw-endpoint repoints /api/products to /api/market
 * before it reaches here, so a dispensary catalogue can neither be read from
 * nor written to this key -- the path simply does not match. That is the same
 * mechanism feed-meta stands down through, and it needs no flag.
 */
(function () {
  var KEY = "ll_feed_cache_v1";
  var MAX_AGE_MS = 6 * 60 * 60 * 1000;   /* six hours: prices move */
  var GRACE_MS = 450;                     /* how long the network gets before the cache is served */
  var CAP = 500;
  var MAX_ENTRIES = 3;
  var FEED_PATH = "/api/products";

  if (typeof window.fetch !== "function") return;

  function urlOf(url) {
    try { return new URL(String(url), location.href); } catch (e) { return null; }
  }
  function isFeed(u) { return !!u && u.origin === location.origin && u.pathname === FEED_PATH; }
  /* `refresh` is stripped from the KEY, deliberately: it is a instruction about
     how to answer, not a different shelf, so a forced scrape should refill the
     very entry it bypassed rather than opening a second one beside it. */
  function keyFor(u) {
    if (!u) return FEED_PATH;
    var q = new URLSearchParams(u.search);
    q.delete("refresh");
    var t = q.toString();
    return u.pathname + (t ? "?" + t : "");
  }

  function readAll() {
    try {
      var j = JSON.parse(localStorage.getItem(KEY) || "null");
      return (j && typeof j === "object" && !Array.isArray(j)) ? j : {};
    } catch (e) { return {}; }
  }

  function readCache(url) {
    var e = readAll()[keyFor(urlOf(url || FEED_PATH))];
    if (!e || !e.at || !Array.isArray(e.products) || !e.products.length) return null;
    if (Date.now() - e.at > MAX_AGE_MS) return null;
    return e;
  }

  function writeCache(key, payload) {
    try {
      var list = (payload && payload.products) || [];
      if (!list.length) return;
      var slim = [];
      for (var i = 0; i < list.length && i < CAP; i++) {
        var p = list[i];
        if (!p) continue;
        var c = {}, k;
        for (k in p) if (Object.prototype.hasOwnProperty.call(p, k) && k !== "gallery") c[k] = p[k];
        slim.push(c);
      }
      var all = readAll();
      all[key] = { at: Date.now(), meta: payload.meta || null, products: slim };
      var keys = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
      for (var n = MAX_ENTRIES; n < keys.length; n++) delete all[keys[n]];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      /* Quota, private mode, or a browser refusing storage. Not caching is the
         pre-existing behaviour, so there is nothing to repair -- and half a
         catalogue written on a retry would be worse than none. The whole ring
         goes rather than the one entry: a store that cannot be written to is a
         store whose contents nobody can vouch for. */
      try { localStorage.removeItem(KEY); } catch (e2) {}
    }
  }

  var real = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var u = urlOf((input && input.url) || input);
    if (!isFeed(u) || (init && init.method && init.method.toUpperCase() !== "GET")) {
      return real(input, init);
    }
    var key = keyFor(u);
    var net = real(input, init).then(function (r) {
      if (r && r.ok) {
        /* clone() before anything reads the body: a body can be consumed once,
           and the caller is about to. */
        try {
          r.clone().json().then(function (j) { writeCache(key, j); }).catch(function () {});
        } catch (e) {}
      }
      return r;
    });

    /* ?refresh is somebody deliberately asking for a fresh scrape. Answering it
       from a cache would make the one control that exists to bypass caching the
       one that cannot -- but it still WRITES, above, because the freshest
       catalogue anyone has asked for is the one worth keeping. */
    if (u.searchParams.has("refresh")) return net;

    var cached = readCache(u);
    if (!cached) return net;

    function fromCache() {
      return new Response(JSON.stringify({ products: cached.products, meta: cached.meta || {} }),
        { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Promise(function (resolve) {
      var done = false;
      function first(r) { if (!done) { done = true; resolve(r); } }
      /* A REFUSAL IS NOT AN ANSWER, and fetch does not agree: it rejects only on
         a transport failure and resolves a 500 like any other response. So both
         have to be caught here, or the one case where last visit's shelf is most
         obviously better than the seed -- the origin being down -- is the one
         case this does nothing about, while the failing branch beside it looks
         like it covers both. Not cached, either: the write is gated on r.ok, so
         a bad day cannot evict a good catalogue. */
      net.then(function (r) { first(r && r.ok ? r : fromCache()); },
               function () { first(fromCache()); });
      setTimeout(function () { first(fromCache()); }, GRACE_MS);
    });
  };

  window.LL_feedCache = { KEY: KEY, read: readCache, all: readAll, GRACE_MS: GRACE_MS, CAP: CAP, MAX_ENTRIES: MAX_ENTRIES };
})();

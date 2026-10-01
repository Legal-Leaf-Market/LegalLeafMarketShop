/* public/js/shelf-return.js — the shelf is a feed you come back to.
 *
 * "We can't have a snap back to grid that refreshes. We need a snap back to
 *  grid in same state back to same card ... just like on Facebook, you tab over
 *  and come back to the home page, and the home page is at the same spot."
 *
 * Exactly right, and it is a bug this site acquired the day the card body
 * started opening /p/<id>. Before that there was nowhere to go and nothing to
 * come back from.
 *
 * ------------------------------------------------------------------
 * THREE THINGS HAVE TO COME BACK, AND SCROLL IS THE LEAST OF THEM.
 *
 *   1. THE ORDER. public/js/shelf-shuffle.js re-draws the round order on every
 *      load, deliberately -- two visits are meant to differ. So coming back
 *      without restoring it gives a DIFFERENT SHELF, and the card somebody was
 *      just looking at may not be on screen at all. Restoring scroll alone
 *      would put them at the right pixel of the wrong page.
 *   2. HOW MUCH WAS LOADED. The grid pages at 12 and the shopper may have
 *      pressed Load more four times. A restore to 12 cards cannot scroll to
 *      something that was card 47.
 *   3. THE SCROLL POSITION, which is meaningless without the first two and
 *      trivial with them.
 *
 * ------------------------------------------------------------------
 * WHY THE BROWSER DOES NOT ALREADY DO THIS. Native scroll restoration works on
 * pages whose height is settled when the browser restores it. Here the grid is
 * rendered by JS after a fetch, so at restore time the document is a header and
 * an empty grid -- there is nowhere to scroll to, the browser gives up, and the
 * shopper lands at the top. scrollRestoration is set to "manual" so it stops
 * trying and stops fighting the restore below.
 *
 * ------------------------------------------------------------------
 * WHAT IT DOES NOT DO, WHICH IS THE HALF THAT KEEPS THE SHUFFLE HONEST.
 *
 * A FRESH VISIT STILL GETS A FRESH SHELF. The restore fires only when somebody
 * is actually coming back -- a back/forward navigation, or a referrer that is
 * one of our own product pages. Somebody opening the site an hour later gets
 * the shuffle, because "three loads give three different shelves" is a
 * deliberate property (test-shelf-shuffle.mjs asserts it) and quietly turning
 * the shelf into a fixed list would be a different site.
 *
 * AND IT EXPIRES. A snapshot is per-tab (sessionStorage, which is what a feed
 * position actually is -- it belongs to the tab, not the browser or the
 * machine) and is ignored after 30 minutes. Coming back to a shelf whose prices
 * moved while it sat there is worse than a fresh one.
 */
(function () {
  var KEY = "ll_shelf_return";

  /* THE HOLD IS INJECTED FROM HERE, not written into a stylesheet, because it is
     part of this behaviour rather than part of the page's look -- and because
     this file is loaded by index.html and inherited by all eight generated
     pages, while a rule dropped in one stylesheet would have to be kept in step
     with whichever pages happen to link it.
     `visibility`, never `display`: the document has to keep its height or there
     is no scroll position to restore to. */
  try {
    var st = document.createElement("style");
    st.id = "ll-return-style";
    st.textContent = "html.ll-returning #grid{visibility:hidden}";
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}
  var MAX_AGE_MS = 30 * 60 * 1000;
  /* Enough presses to rebuild a deep scroll, bounded so a feed that can never
     satisfy the target cannot spin. Each press is the engine's own paging. */
  var MAX_PRESSES = 40;

  /* ONE HOLD, ONE RELEASE, AND THE HOLD STARTS THE MOMENT WE KNOW A RESTORE IS
     COMING. Held from inside restore() instead, the shopper watches a fresh
     shelf paint, then watches it disappear, then gets the right one -- three
     states where there should be one. The release is a single function with a
     timer behind it, because a grid held by a throw is a blank shop and no
     branch below is allowed to be able to cause that. */
  var released = false;
  function hold() {
    document.documentElement.classList.add("ll-returning");
    setTimeout(release, 6000);
  }
  function release() {
    if (released) return;
    released = true;
    document.documentElement.classList.remove("ll-returning");
  }

  function grid() { return document.getElementById("grid"); }
  function cards(g) { return g ? g.querySelectorAll(".card[data-pid]") : []; }
  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }
  function write(v) {
    try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }

  /* ---- leaving ----------------------------------------------------------
     Snapshotted on pagehide rather than on the card click, so it covers every
     way out of the shelf -- the card body, a rail, the browser's own back into
     here from somewhere else -- rather than only the one route we happen to
     have wired. pagehide fires for bfcache too, where it costs nothing. */
  function snapshot() {
    var g = grid();
    if (!g) return;
    var list = cards(g);
    if (!list.length) return;
    var order = [];
    for (var i = 0; i < list.length; i++) order.push(list[i].getAttribute("data-pid"));
    write({
      path: location.pathname,
      order: order,
      shown: list.length,
      y: window.scrollY || window.pageYOffset || 0,
      at: Date.now(),
    });
  }
  window.addEventListener("pagehide", snapshot);
  /* Safari has historically not fired pagehide reliably on same-document
     navigations away; visibilitychange is the cheap second chance and writing
     the same snapshot twice costs one sessionStorage write. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") snapshot();
  });

  /* ---- coming back ------------------------------------------------------ */
  function isReturn() {
    try {
      var nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")) || [];
      if (nav.length && nav[0].type === "back_forward") return true;
    } catch (e) {}
    /* Or they followed a link back from one of our own product pages, which is
       a return even though the browser calls it a fresh navigation. */
    try {
      if (document.referrer) {
        var u = new URL(document.referrer);
        if (u.origin === location.origin && /^\/p\//.test(u.pathname)) return true;
      }
    } catch (e) {}
    return false;
  }

  function restore(snap) {
    var g = grid();
    if (!g) return;

    /* PAGING FIRST, ORDER SECOND, AND THAT ORDERING COST A RED SUITE.

       The obvious sequence is the wrong one. Restoring the order before the
       paging cannot work: at that moment twelve cards are on the page and the
       snapshot remembers eighty-four, so shelf-shuffle's freeze rule sees an
       incomplete set, starts the deal over, and overwrites what was restored on
       its way past. Every card has to be present before the order means
       anything, so the presses go first and the placement happens once. */
    /* ONE PASS, NOT ONE PRESS PER FRAME, AND THE SHOPPER MUST NOT WATCH IT.
       Measured in real Chromium coming back to a shelf that had been paged to
       96 cards: the page loaded a FRESH shelf, painted it six times, sat there
       for two and a half seconds, and then jumped. That is not a return, it is a
       reload with a teleport on the end, and it is what "clunky" meant.

       Two things were wrong. The presses ran one per animation frame, so the
       browser painted the grid growing 12, 24, 36 ... all the way up -- the old
       comment claimed a tight loop would out-run the engine's own re-render, and
       that is simply not true: the engine renders synchronously on the click,
       which is the same fact the concierge pin sweep is built on. And nothing
       hid any of it, so the whole rebuild happened in front of them.

       So the grid is held while this runs and revealed once, settled, at the
       right scroll position. `visibility` rather than `display`, because the
       page must keep its height or there is nothing to scroll to. */
    var presses = 0;
    try {
      while (cards(grid()).length < snap.shown && presses < MAX_PRESSES) {
        var bar = grid().querySelector(".loadmore");
        if (!bar) break;                  /* the whole catalogue is already out */
        presses++;
        bar.click();
      }
    } catch (e) {}
    settle();

    function settle() {
      /* Two frames: one for the last render, one for the reorder shelf-shuffle
         schedules off its observer. Scrolling before that lands on the pixel a
         card used to be at. */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          /* NOW the order, with every card it names on the page.
             LL_shuffleRestore PLACES them -- it is not a hint that the ordinary
             deal might honour -- and sets shelf-shuffle's own dealtOrder to what
             it placed, so a later Load more still appends rather than re-deals. */
          try { if (window.LL_shuffleRestore) window.LL_shuffleRestore(snap.order); } catch (e) {}
          window.scrollTo(0, snap.y || 0);
          /* Revealed AFTER the scroll, in the same frame, so the first thing
             painted is the shelf where they left it rather than the top of it. */
          release();
          /* Cleared once used. A snapshot is for ONE return -- leaving it would
             make a later fresh visit in the same tab inherit a stale shelf,
             which is the thing the freshness window is already guarding. */
          try { sessionStorage.removeItem(KEY); } catch (e) {}
        });
      });
    }
  }

  function arm() {
    if (!grid()) return;
    try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) {}
    var snap = read();
    if (!snap || snap.path !== location.pathname) return;
    if (!snap.order || !snap.order.length) return;
    if (Date.now() - (snap.at || 0) > MAX_AGE_MS) { try { sessionStorage.removeItem(KEY); } catch (e) {} return; }
    if (!isReturn()) return;

    /* WAIT FOR THE FEED, NOT MERELY FOR CARDS, and the difference is the whole
       restore. The engine paints its own baked seed the moment the page parses,
       so `cards().length` is true within milliseconds -- and the presses below
       then page the SEED to eighty-four cards, after which the real feed lands
       and replaces the lot with twelve. Everything restored is gone and the
       shopper is at the top of a fresh shelf.
       That was survivable while the presses ran one per animation frame, because
       the loop spanned enough frames to still be going when the feed arrived and
       simply carried on. Making it synchronous -- which is what stopped the
       shopper watching the rebuild -- removed that accident, and the suite went
       red three times out of three.

       feed-meta.js writes window.LL_META before it dispatches `ll-meta`, so this
       is a question about state and works whether we are listening or arrived
       after the announcement. Same rule, and the same reasoning, as the `fed`
       gate in public/js/shelf-shuffle.js -- and it is a deliberate twin rather
       than an import, for the reason public/js/overrides.js carries its own
       _applyOv: these files are loaded independently and neither owns the other. */
    hold();
    function fedYet() {
      var m = window.LL_META;
      return !!(m && (m.domains || m.brands || m.catPool));
    }
    var waited = 0;
    (function ready() {
      if (cards(grid()).length && fedYet()) return restore(snap);
      /* ~10s. A feed that never arrives means the seed IS the shelf, and there
         is nothing here worth restoring onto it -- give up quietly rather than
         placing an order over products that are not the ones snapshotted. */
      if (waited++ > 600) return release();
      requestAnimationFrame(ready);
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm);
  else arm();

  /* For the suite, and for anything that needs to know a restore is in play. */
  window.LL_shelfReturn = { snapshot: snapshot, read: read, KEY: KEY };
})();

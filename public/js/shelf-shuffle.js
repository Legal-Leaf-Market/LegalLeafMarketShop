/* public/js/shelf-shuffle.js -- the opening shelf reads like a feed, not a league table.
 *
 * The grid is ranked by best price per gram, which is the whole proposition --
 * and a pure ranking walls up. One shop's catalogue, or one category, lands as a
 * solid block at the top and the first screen says "this is a Puffy page" rather
 * than "this is a comparison". Reported first on the city pages ("you say it's
 * interweaved across shops, that's not true, I see just Banzen by default") and
 * again on the hemp shelf ("I need the products to be shuffled on load for llm,
 * it needs to feel like a social media feed").
 *
 * THE SECOND REPORT WAS A DIFFERENT BUG WEARING THE FIRST ONE'S CLOTHES, and it
 * took measuring `/` at production store proportions to see it. The engine's
 * PAGE is 12, so the opening shelf is exactly twelve cards, and what those
 * twelve were:
 *
 *     Puffy Grasscity Puffy Grasscity Puffy Grasscity Puffy CBD Puffy THCA Puffy Puffy
 *
 * Four shops, six of them one shop, one category, and BYTE-IDENTICAL ON EVERY
 * LOAD. Two causes, both of them in this file:
 *
 *   1. NOTHING HERE WAS EVER RANDOM. The deal was a pure function of the
 *      ranking, so every visitor saw the same twelve cards in the same order on
 *      every visit, forever. That is an interleave, not a feed.
 *   2. THE FULLEST BUCKET ALWAYS WON. Each slot went to whichever shop had the
 *      most cards left, which at 2234 / 1223 / 303 / 245 / ... is Puffy and
 *      Grasscity for the entire opening screen. The rule was written to stop the
 *      TAIL becoming a block, and it does -- but it hands the head to the two
 *      biggest catalogues, which is the same wall one step along.
 *
 * SO THE DEAL IS ROUNDS NOW, IN A FRESH RANDOM ORDER EACH LOAD. Every shop with
 * stock contributes one card per round, so twelve slots across fourteen shops is
 * twelve different shops; when a shop runs dry it drops out and the rounds
 * shorten, which at the tail degrades to exactly the alternation the fullest-
 * bucket rule produced. Rounds are a superset of what it was protecting, so
 * nothing is lost by replacing it.
 *
 * IT IS STILL A ROTATION OF THE RANKING, NOT A REPLACEMENT. Each shop offers its
 * strongest remaining card, and the per-load variation comes from the round
 * order plus a WINDOW of 3 within each bucket -- so a card that leads is always
 * among that shop's best, never a random pick off the shelf. The cheapest thing
 * per gram is still near the top; it just is not followed by five more from the
 * same shop.
 *
 * WHAT IS ALREADY DEALT STAYS DEALT. A feed does not reshuffle what you have
 * scrolled past, and once the deal is random that stops being a nicety: without
 * it, pressing "load more" re-deals the twelve cards you are looking at. Cards
 * are remembered by data-pid, so an append keeps its order and only the new
 * cards are dealt onto the end -- and a full re-render (no remembered pid
 * survives) correctly starts over.
 *
 * IT STANDS DOWN THE MOMENT SOMEBODY ASKS FOR SOMETHING. A shopper who picks a
 * shop, a category or a sort has stated what they want, and shuffling on top of
 * that is second-guessing them. "Untouched" is a fact about the shopper, not a
 * guess at the controls: two earlier versions read it off #fSort and #fBudget
 * and both stood down on every load in production, because the page sets those
 * itself. A TRUSTED event is the actual question being asked.
 *
 * AND A DEAL IS ONLY AS WIDE AS THE POOL IT IS DEALT FROM, which is the third
 * cause and the one that made the other two look fixed when they were not. The
 * engine's PAGE is 12 and that constant is inside the blob, so the opening shelf
 * is twelve cards -- and twelve cards ranked by price per gram contain four
 * shops, however cleverly they are rotated. Rounds over a pool of twelve cannot
 * produce a feed because the pool is not a feed.
 *
 * The city pages already knew this: cw-feed presses the engine's own Load more
 * until FLOOR cards are on the shelf and THEN deals. That is the actual reason
 * they read as a feed and the hemp shelf did not, and it is why the top-up lives
 * here now rather than only in the generator -- one shelf-filling rule, in the
 * file that owns the deal. Where cw-feed IS driving it keeps its own (it has to
 * sequence a row-trim after), so this stands down there exactly as the observer
 * does.
 *
 * PRESSING THE BAR IS THE ENGINE'S OWN PAGING, not a reimplementation of it:
 * "shown" is a closure variable inside the blob and anything setting it directly
 * would be guessing. MAX_CLICKS is a hard stop so a feed that can never satisfy
 * the floor cannot spin forever.
 *
 * AND A THIRD AXIS THE OTHER TWO CANNOT SEE. Shop and category are properties
 * of a card; being an OFFCUT is not. Trim/Shake is a sub-tag the engine lays
 * over THCA Flower, so a jar of shake sits in its shop's bucket with
 * data-cat="THCA Flower" and is indistinguishable from a jar of buds -- while
 * being, by definition, the cheapest thing per gram on a shelf ranked by price
 * per gram. Reported as "way too much trim near the top". They are dealt
 * separately and woven back at a fixed ratio; see GAP below.
 *
 * WHERE IT RUNS. public/index.html loads it, so `/`, the three generated shelves
 * and every city page get the same behaviour from one file. On a city page the
 * generator's own cw-feed block sequences it inside its paint cycle (top up the
 * shelf, shuffle, trim the last row) -- so this file exposes window.LL_shuffle()
 * for that, and only arms its OWN observer where no such driver exists. Two
 * observers reordering one grid is a fight nobody wins, and it would show up as
 * cards twitching rather than as an error.
 */
(function () {
  if (typeof window === "undefined" || !document) return;

  /* How far down a shop's own ranking a card may be lifted. Three is deliberate:
     big enough that two visits differ, small enough that the card leading a shop
     is always one of its best. Raise it and the shelf stops being a ranking. */
  var WINDOW = 3;

  /* Deal from a shelf, not from a page. Same floor cw-feed uses on a city page,
     for the same reason and with the same hard stop. */
  var FLOOR = 40;
  var MAX_CLICKS = 8;

  /* ---- offcuts are stock, not the shop front -------------------------------
     TRIM AND SHAKE ARE THE CHEAPEST THING PER GRAM BY DEFINITION, and the grid
     is ranked by price per gram, so a correct ranking opens on a wall of them.
     Reported as "there is way too much trim near the top of my main product
     grid -- it's cool to show we have but it is not the main event", which is
     the whole specification: present, labelled, not leading.

     THE DEAL COULD NOT SEE IT. It rotates on shop and on category, and an
     offcut is neither -- Trim/Shake is a SUB-TAG the engine overlays on top of
     THCA Flower, so every one of these cards reads data-cat="THCA Flower" and
     sits in its shop's bucket looking exactly like a jar of buds. Nothing was
     malfunctioning; the axis did not exist.

     SO THEY ARE DEALT SEPARATELY AND SPLICED BACK IN, rather than being scored
     down inside the existing deal. Two reasons. A ratio spliced afterwards is a
     GUARANTEE that can be read off the code and asserted -- none in the opening
     GAP cards, at most one per GAP after that -- where a penalty inside take()
     is a tendency, and this is the second time a tendency here has turned out
     to be a race. And nothing is dropped or hidden: every offcut still reaches
     the shelf, in shop-rotated order, with its red chip on it. A shopper who
     wants shake sorts by price and finds it exactly where it was.

     GAP of 8 puts at most four in the opening forty. Below that they read as a
     block again; far above it and a shop that sells nothing else disappears. */
  var GAP = 8;

  /* ---- has the shopper asked for anything? -------------------------------- */
  var touched = false;
  var CONTROLS = ["fStore", "fCategory", "fCannabinoid", "fType", "fStrain", "q",
                  "fSort", "fGrow", "fMinQty", "fBudget", "fMinThc"];
  function mark(e) {
    if (!e.isTrusted || !e.target || !e.target.id) return;
    if (CONTROLS.indexOf(e.target.id) >= 0) touched = true;
  }
  document.addEventListener("change", mark, true);
  document.addEventListener("input", mark, true);
  /* The rails set these selects programmatically, and a chip IS a filter, so
     they announce themselves rather than being detected. */
  document.addEventListener("ll-facet-picked", function () { touched = true; });
  function untouched() { return !touched; }

  /* ---- what a card is ------------------------------------------------------ */
  function pidOf(card) { return String(card.getAttribute("data-pid") || ""); }
  /* IS THIS LISTING AN OFFCUT? Asked of feed-meta.js, which answers it with the
     engine's own sub-tag rule, so the deal, the Trim/Shake facet and the red
     chip cannot disagree about what shake is. Keyed on data-pid, which is the
     feed's own product id.

     THE LISTING, NOT THE ROW, and that distinction is deliberate. Black Tie and
     CBD Hemp Direct sell whole buds and their own shake under one title, and
     the engine opens such a card on its best price per gram -- which is the
     shake. Those are real flower listings, so demoting them would push genuine
     product down the shelf to hide a dropdown option; the card's own chip
     already says "This size: Trim / Shake" for that case. What is capped here is
     the listing that IS shake.

     Absent map, no cap: on a city page LL_META is not published (cw-endpoint
     publishes LL_COLDWATER_META instead) and Coldwater menus carry no offcut
     listings, so this stands down by finding nothing rather than by a branch. */
  function trimMap() {
    try { return (window.LL_META && window.LL_META.trim) || null; } catch (e) { return null; }
  }
  function isOffcut(card, map) { return !!(map && map[pidOf(card)]); }
  function storeOf(card) {
    var p = card.querySelector(".storepill");
    return String((p && p.textContent) || "").trim().toLowerCase();
  }
  /* data-cat is what the engine stamps and what the category rail reads, so the
     two cannot disagree about which shelf a card is on. */
  function catOf(card) {
    return String(card.getAttribute("data-cat") || "").trim().toLowerCase();
  }
  function strength(card) {
    /* A photograph first: a placeholder at the top of the shelf is the single
       worst thing this page can open with. Then a real price per gram, which is
       the number the whole site exists to compare. */
    var s = 0;
    if (card.querySelector("img[src]")) s += 4;
    var pg = card.querySelector(".pergram, .perg, [class*='perg']");
    var m = String((pg && pg.textContent) || "").match(/([\d.]+)/);
    if (m) { s += 2; var v = parseFloat(m[1]); if (v > 0 && v < 12) s += 2; }
    if (card.querySelector(".salebadge, .deal, [class*='deal']")) s += 1;
    return s;
  }

  function rnd(n) { return (Math.random() * n) | 0; }
  function shuffledCopy(a) {
    var out = a.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = rnd(i + 1), t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* One card out of a bucket, in three steps, and the middle one is the reason
     this is not just "pick one of the top three".

     1. A DIFFERENT CATEGORY FROM THE TOP FEW, at random. Strong card, and the
        shelf alternates.
     2. FAILING THAT, THE WHOLE BUCKET IS SEARCHED for a different category, and
        the first one wins. This looks past WINDOW deliberately: a shop whose
        three strongest are all flower would otherwise deal a fourth flower card
        and the category rotation would quietly stop being a rule. It is the
        same full scan the deal has always done here, and it costs the lift of
        one card -- which is still that shop's strongest of its category.
        Without it the category run is a race, and it flaked this suite twice.
     3. FAILING THAT, the top few at random -- a single-category shop still has
        to be dealt from, and refusing would drop real products. */
  /* `allowCut` is the third axis, and it is a VETO rather than a preference --
     which is why it filters every step rather than adding a fourth. With it
     true this is exactly the function it always was. With it false the bucket is
     read as if its offcuts were not there, and a bucket holding nothing else
     returns null so the caller can offer the slot to another shop. */
  function take(bucket, lastCat, allowCut) {
    var n = Math.min(WINDOW, bucket.length), cands = [], i;
    function ok(x) { return allowCut || !x.o; }
    for (i = 0; i < n; i++) if (ok(bucket[i]) && (!lastCat || bucket[i].c !== lastCat)) cands.push(i);
    if (cands.length) return bucket.splice(cands[rnd(cands.length)], 1)[0];
    if (lastCat) {
      for (i = 0; i < bucket.length; i++) if (ok(bucket[i]) && bucket[i].c !== lastCat) return bucket.splice(i, 1)[0];
    }
    for (i = 0; i < n; i++) if (ok(bucket[i])) cands.push(i);
    if (cands.length) return bucket.splice(cands[rnd(cands.length)], 1)[0];
    for (i = 0; i < bucket.length; i++) if (ok(bucket[i])) return bucket.splice(i, 1)[0];
    return null;                          /* this shop has only offcuts left */
  }

  /* ---- the deal ------------------------------------------------------------
     ROUNDS, not fullest-bucket. Every key still holding stock contributes once
     per round, in an order re-drawn each round, and a round never opens with the
     key the previous one closed on. */
  function dealRounds(cards, keyFn, useCat, last, lastCat, offset, tm) {
    var byKey = {}, order = [], i, nCut = 0;
    for (i = 0; i < cards.length; i++) {
      var k = keyFn(cards[i]) || "?";
      if (!byKey[k]) { byKey[k] = []; order.push(k); }
      var cut = isOffcut(cards[i], tm);
      if (cut) nCut++;
      byKey[k].push({ el: cards[i], at: i, s: strength(cards[i]), c: catOf(cards[i]), o: cut });
    }
    /* THE PACE, computed from what is actually here rather than fixed. GAP is a
       CEILING, not a period: a shelf with a handful of offcuts sits them a
       comfortable eight apart, and one that is a quarter shake spreads them
       evenly across the whole page instead of placing four and piling the rest.
       Two is the floor, because side by side is the one thing that reads as the
       block this exists to break up.
       THE PROPORTION IS THE CATALOGUE'S TO DECIDE, NOT THIS FUNCTION'S. If a
       quarter of what ranks cheapest is shake then a quarter of the shelf is
       shake, and pretending otherwise hides stock a shopper came for. What was
       reported was not the amount, it was the POSITION: they led, in a block.
       `offset` is the cards already frozen above this deal, so the lead is
       measured against the SHELF -- otherwise every load-more restarts the
       count and drops a fresh cut at the top of each page. */
    var lead = Math.max(0, GAP - (offset || 0));
    var pace = nCut ? Math.max(2, Math.min(GAP, (cards.length - lead) / nCut)) : GAP;
    /* AN ABSOLUTE TARGET, NOT "pace cards from wherever the last one landed".
       Re-basing on the actual position compounds the rounding every time -- a
       pace of 3.33 came out as a real spacing of five, so twelve offcuts needed
       sixty cards to fit in forty-eight and the last five piled at the end. The
       accumulator drifts on purpose: 8, 11.33, 14.67 ... places them at 9, 12,
       15, which averages the pace instead of always rounding away from it. */
    var nextCut = (offset || 0) + lead, placed = offset || 0;
    if (order.length < 2) return null;          /* nothing to mix on this axis */
    for (i = 0; i < order.length; i++) {
      byKey[order[i]].sort(function (a, b) { return (b.s - a.s) || (a.at - b.at); });
    }
    /* ONE ROUND, THEN THE FULLEST BUCKET -- because those answer two different
       questions and the first version of this used only one of them each time.

       THE HEAD wants every shop in it. That is the feed, and a round does it:
       one card each, in an order re-drawn per load, so twelve slots across
       twelve shops is twelve shops.

       THE TAIL wants nobody blocking. Rounds are bad at that -- the small shops
       run dry, the rounds shorten to the two big catalogues and then to one, and
       the shelf ends in a wall. Measured at production shape: a run of SEVEN
       from one shop at the bottom. Always taking from the fullest remaining
       bucket is the best that can be done about runs (it is why that rule was
       here first), and it is only wrong at the head, where it hands every other
       slot to whoever has the deepest catalogue.

       So: deal one round, then switch. Neither rule is discarded; each is used
       where it is right. */
    var out = [], guard = 0, r, b, got;
    /* Placing a card is the same three lines everywhere, and the offcut pace has
       to advance with it, so it is written once. */
    var lastWasCut = false;
    function put(el, key, cat, wasCut) {
      out.push(el); placed++; last = key; lastCat = cat; lastWasCut = wasCut;
      if (wasCut) nextCut += pace;
    }
    /* TWO IN A ROW IS THE ONE THING THAT READS AS THE BLOCK AGAIN, so it is the
       LAST rule to give way rather than the first. The quota can run out of
       shelf and relax; adjacency only relaxes when there is nothing on the whole
       page that is not an offcut, which is the shopper who filtered to
       Trim/Shake and wants exactly that. */
    function mayCut() { return placed >= nextCut && !lastWasCut; }

    var first = shuffledCopy(order.filter(function (k) { return byKey[k].length; }));
    if (first.length > 1 && first[0] === last) { var t = first[0]; first[0] = first[1]; first[1] = t; }
    for (r = 0; r < first.length; r++) {
      b = byKey[first[r]];
      if (!b.length) continue;
      got = take(b, useCat ? lastCat : null, mayCut());   /* quota AND adjacency */
      /* A shop holding nothing but offcuts sits this round out rather than
         being dropped -- its cards are still in its bucket and the tail loop
         will reach them. */
      if (!got) continue;
      put(got.el, first[r], got.c, got.o);
    }
    while (guard++ < 20000) {
      var tries = 0, allow, pick, pickN, k2, n;
      /* THREE PASSES, AND EACH GIVES UP EXACTLY ONE RULE. The first offers the
         slot under both rules. The second drops the QUOTA -- if every shop that
         could take the slot has only offcuts left, the pace has run out of shelf
         and the choice is between a tighter run of shake and dropping real
         products, which is the worse trade the fullest-bucket rule already makes
         for shops. The third drops ADJACENCY, and only ever runs when there is
         nothing left anywhere that is not an offcut. */
      for (tries = 0; tries < 3; tries++) {
        allow = tries === 0 ? mayCut() : tries === 1 ? !lastWasCut : true;
        pick = null; pickN = -1;
        for (r = 0; r < order.length; r++) {
          k2 = order[r]; n = byKey[k2].length;
          if (!n || k2 === last) continue;
          if (n > pickN) { pickN = n; pick = k2; }
        }
        /* Only one key has anything left: it is a repeat or it is nothing, and
           dropping real products to avoid a repeat is the worse trade. */
        if (pick === null) {
          for (r = 0; r < order.length; r++) if (byKey[order[r]].length) { pick = order[r]; break; }
        }
        if (pick === null) break;
        got = take(byKey[pick], useCat ? lastCat : null, allow);
        if (got) break;
        /* That shop could not serve the slot under the quota. Try the others in
           turn before giving up on it, then relax. */
        var alt = null;
        for (r = 0; r < order.length; r++) {
          var k3 = order[r];
          if (!byKey[k3].length || k3 === last || k3 === pick) continue;
          got = take(byKey[k3], useCat ? lastCat : null, allow);
          if (got) { alt = k3; break; }
        }
        if (got) { pick = alt; break; }
      }
      if (pick === null || !got) break;
      put(got.el, pick, got.c, got.o);
    }
    return out;
  }

  /* Both axes, in the order they were always tried. ONE SHOP IS NOT NOTHING TO
     MIX -- it is the case where the category axis is the only one left, and it
     is exactly the shelf that walls up worst: a single-shop page listed by price
     is forty flower cards then the edibles. */
  function deal(cards, lastEl, offset, tm) {
    if (!cards.length) return null;
    return dealRounds(cards, storeOf, true,
                      lastEl ? storeOf(lastEl) : null,
                      lastEl ? catOf(lastEl) : null, offset, tm)
        || dealRounds(cards, catOf, false, lastEl ? catOf(lastEl) : null, null, offset, tm);
  }

  /* ---- what has already been dealt stays dealt ----------------------------- */
  var dealtOrder = [];       /* pids, in the order they were placed */
  var lastSig = "";

  function shuffle(g) {
    if (!g || !untouched()) return false;
    var list = [].slice.call(g.querySelectorAll(".card"));
    if (list.length < 4) return false;

    var byPid = {}, i, pid;
    for (i = 0; i < list.length; i++) {
      pid = pidOf(list[i]);
      if (pid && !byPid[pid]) byPid[pid] = list[i];
    }
    /* THE FREEZE IS FOR APPENDS, AND ONLY FOR APPENDS.

       Keep the dealt order only when EVERY remembered card is still on the page.
       Anything less is not an append, and patching around the gaps is worse than
       starting over: the deal guarantees no shop twice running, and that
       guarantee does not survive deletion. Deal A B A C, lose B, and the kept
       order is A A C -- a repeat that no rule here produced and none can see.
       It cost two flaky runs of test-shelf-shuffle.mjs to find, because on this
       page the removals come from the page's OWN load-time filter clearing (the
       CBD and Trim toggles), so it fires before a shopper has touched anything
       and looks exactly like a bad deal.

       A load-more leaves every previous pid in place, which is the case this
       exists for. A re-render with a different set starts fresh, which is right:
       the shelf genuinely changed. */
    var keep = [], held = {};
    for (i = 0; i < dealtOrder.length; i++) {
      var el = byPid[dealtOrder[i]];
      if (el && !held[dealtOrder[i]]) { keep.push(el); held[dealtOrder[i]] = 1; }
    }
    if (keep.length !== dealtOrder.length) { keep = []; held = {}; }
    var fresh = [];
    for (i = 0; i < list.length; i++) {
      pid = pidOf(list[i]);
      if (!pid || !held[pid]) fresh.push(list[i]);
    }
    if (!fresh.length) return false;

    var lastEl = keep.length ? keep[keep.length - 1] : null;

    /* THE OFFCUT RULE IS INSIDE THE DEAL, NOT A PASS OVER ITS OUTPUT, and the
       first draft got that wrong in a way worth recording. Splitting them out,
       dealing them separately and splicing them back looked simpler and reads
       better -- but the deal's promise is "no shop twice running" across the
       WHOLE shelf, and a splice cannot keep a promise it was not party to. It
       broke it on the first run, and every repair (search the remaining cuts
       for a different shop, defer when none fits) traded the run for a pile at
       the end. One deal, one set of guarantees.
       A SHELF THAT IS ENTIRELY SHAKE IS STILL A SHELF: the quota relaxes rather
       than refusing, so a shopper who filtered to Trim/Shake gets all of it. */
    var dealt = deal(fresh, lastEl, keep.length, trimMap());
    if (!dealt) return false;                 /* one shop, one category */

    var out = keep.concat(dealt);
    dealtOrder = out.map(pidOf);
    return place(g, out);
  }

  /* A signature, so a reorder that changes nothing does not re-enter through the
     observer that is watching for it. */
  function place(g, out) {
    var sig = out.map(function (c) { return pidOf(c); }).join("|");
    if (sig === lastSig) return false;
    lastSig = sig;
    var bar = g.querySelector(".loadmore");
    var frag = document.createDocumentFragment();
    for (var z = 0; z < out.length; z++) frag.appendChild(out[z]);
    g.insertBefore(frag, bar || null);
    return true;
  }

  /* Exposed for the city pages' cw-feed block, which has to sequence this
     between topping the shelf up and trimming the last row. */
  window.LL_shuffle = function (g) { return shuffle(g || document.getElementById("grid")); };
  /* COMING BACK TO THE SHELF IS NOT A NEW SHELF, and restoring one is placement
     rather than a hint. The first attempt at this only SEEDED dealtOrder and
     let the ordinary deal reproduce it, which cannot work and failed exactly as
     the freeze rule above predicts: at the moment a restore starts, twelve
     cards are on the page and the snapshot remembers eighty-four, so
     `keep.length !== dealtOrder.length`, the deal starts over, and it
     overwrites the seed on its way past. Seeding after the paging finishes does
     not help either -- with every card remembered there is nothing fresh to
     deal, and shuffle() correctly returns without placing anything.

     So this places, using this file's own place(), and sets dealtOrder to what
     it placed so a later Load more still appends rather than re-deals. Cards
     the snapshot never saw go after the ones it did, in the engine's own order:
     they are new arrivals, and the shopper has not seen them yet.

     public/js/shelf-return.js is the only caller. */
  window.LL_shuffleRestore = function (order, g) {
    g = g || document.getElementById("grid");
    if (!g || !order || !order.length) return false;
    var list = [].slice.call(g.querySelectorAll(".card")), byPid = {}, i, pid;
    for (i = 0; i < list.length; i++) { pid = pidOf(list[i]); if (pid && !byPid[pid]) byPid[pid] = list[i]; }
    var out = [], held = {};
    for (i = 0; i < order.length; i++) {
      var el = byPid[order[i]];
      if (el && !held[order[i]]) { out.push(el); held[order[i]] = 1; }
    }
    if (!out.length) return false;
    for (i = 0; i < list.length; i++) { pid = pidOf(list[i]); if (!pid || !held[pid]) out.push(list[i]); }
    dealtOrder = out.map(pidOf);
    lastSig = "";
    return place(g, out);
  };
  window.LL_shuffleTouched = function () { return touched; };

  /* ---- and a driver, only where nothing else is driving -------------------- */
  /* Read INSIDE the arming function rather than at parse time: cw-feed is
     injected later in the document than this file's <script>, so at parse time
     it does not exist yet -- the same reason ll-cart-label reads its Coldwater
     guard inside the paint function rather than beside it. */
  function driven() { return !!document.getElementById("cw-feed"); }

  /* TOP UP IN ONE PASS, NOT ONE CLICK PER FRAME, AND THIS IS A MEASUREMENT
     RATHER THAN A PREFERENCE. Reported as "this site reloads, like, a lot ... it
     can't decide if it's loading a static seed or something else". Counted in
     real Chromium, a cold load of `/` rebuilt the grid EIGHT times before it
     settled: seed at 12, seed topped to 24, feed back to 12, then 24, 36, 48,
     then the deal. Every one of those is a full teardown of every card the
     shopper is looking at, and four of them were this function pressing the
     engine's own Load more one press per animation frame -- so the browser
     painted between each.

     The engine renders synchronously on that click (the concierge pin sweep
     depends on the same fact), so the presses can be one loop and the browser
     paints once at the end. MAX_CLICKS is still the hard stop for a feed that
     can never reach the floor.

     Returns true when it acted -- the caller no longer WAITS on that, see
     schedule(), but "did the pool move" is still worth telling it.

     THE BUDGET IS PER PASS, AND A SHARED ONE WAS A RACE THAT LEFT THE SHELF AT
     TWELVE CARDS. `clicks` used to accumulate across renders and be reset on
     `ll-meta`. But ll-meta is feed-meta announcing it PARSED a feed, which
     happens before the engine has RENDERED it -- so the reset landed early, the
     next pass spent the budget topping up the baked seed, and when the real
     shelf finally painted there was nothing left to spend on it. Measured twice
     in a row on two different pages: 12 cards where there should have been 40,
     and it moved between runs, which is the signature of a race rather than a
     rule.
     Nothing needs a budget that spans renders. What has to be impossible is a
     pass that spins, and two things now make that so: the bound per call, and
     stopping the moment a press does not actually grow the grid. A feed that can
     never reach the floor presses once, sees no growth, and gives up. */
  function topUp(g) {
    if (!untouched()) return false;
    var acted = false, pressed = 0, before;
    while (pressed < MAX_CLICKS && g.querySelectorAll(".card").length < FLOOR) {
      var bar = g.querySelector(".loadmore");
      if (!bar) break;                         /* the whole catalogue is already out */
      before = g.querySelectorAll(".card").length;
      pressed++;
      bar.click();
      acted = true;
      if (g.querySelectorAll(".card").length <= before) break;   /* it did not grow */
    }
    return acted;
  }

  /* THE BAKED SEED IS NOT A SHELF, AND DRESSING IT UP AS ONE IS THE OTHER HALF
     OF THE FLICKER. The engine paints its own hardcoded seed the moment the page
     parses, because the feed is still in flight -- that is deliberate and it is
     what stops the grid being blank. What is NOT wanted is this file widening
     that seed to forty cards and dealing it, because a second later the real
     feed replaces the lot and the shopper has watched a whole shelf build and
     then vanish. That is precisely the "can't decide what it's loading" being
     described.

     So the deal stands down until a real feed has landed. `ll-meta` is
     feed-meta.js announcing it parsed one, which is the same signal this file
     already used to reset the order.

     IT MUST NOT STAND DOWN FOREVER. If the feed never arrives the seed IS the
     shelf, and leaving it unshuffled would mean a broken origin quietly turns
     the site into a fixed list. The timer is the only correct fallback here --
     there is no event for "no feed is coming". */
  var fed = false;
  var FEED_WAIT_MS = 6000;

  /* AN EVENT FIRED BEFORE YOU LISTEN IS LOST, AND THAT LEFT THE SHELF AT TWELVE
     CARDS ABOUT A THIRD OF THE TIME. Gating the deal on `ll-meta` alone assumed
     this file is always listening before feed-meta announces, and it is not: on
     a fast response the feed is parsed, the engine renders it, and every grid
     mutation is over before arm() has attached anything. The trace for a failing
     load is one entry long -- `skip:arm:unfed` -- and then silence forever,
     because there is no second feed and no further mutation to recover on.
     So the QUESTION IS ASKED OF STATE, not of an event. feed-meta writes
     window.LL_META before it dispatches, so this is true whether we heard the
     announcement or arrived after it. The event stays as the prompt to act. */
  function feedSeen() {
    var m = window.LL_META;
    return !!(m && (m.domains || m.brands || m.catPool));
  }

  var queued = false;
  /* LEFT ON THE WINDOW, the way LL_pinLast is, and for the same reason: every
     failure this file has had looked like a working shelf that happened to be
     short, and a card count cannot say whether the deal declined, was skipped,
     or never ran. */
  var TRACE = [];
  /* Bounded: this pushes on every grid mutation, and a shopper filtering for
     twenty minutes would otherwise be growing an array nobody reads. */
  function trace(x) { TRACE.push(x); if (TRACE.length > 40) TRACE.splice(0, TRACE.length - 40); }
  window.LL_shuffleLast = function () { return TRACE.slice(-12); };
  function schedule(why) {
    if (!fed && feedSeen()) fed = true;
    if (queued || driven() || !fed) {
      trace("skip:" + (why||"?") + (queued?":queued":"") + (driven()?":driven":"") + (!fed?":unfed":""));
      return;
    }
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var g = document.getElementById("grid");
      if (!g) return;
      trace("run:" + (why||"?") + ":cards=" + g.querySelectorAll(".card").length);
      /* Widen the pool first: dealing twelve and then dealing forty would show
         the shopper two different shelves in consecutive frames. FALLING THROUGH
         rather than returning is the point -- topUp is synchronous now, so the
         widened pool and the deal land in the SAME frame and the browser paints
         once instead of twice. */
      topUp(g);
      trace("  toppedTo=" + g.querySelectorAll(".card").length);
      shuffle(g);
    });
  }
  function arm() {
    var g = document.getElementById("grid");
    if (!g) return;
    if (window.MutationObserver) new MutationObserver(function(){ schedule("mutation"); }).observe(g, { childList: true });
    /* The real feed replacing the baked seed is a new shelf, not an append. */
    document.addEventListener("ll-meta", function () {
      fed = true; dealtOrder = []; lastSig = ""; schedule("ll-meta");
    });
    setTimeout(function () { if (!fed) { fed = true; schedule("timeout"); } }, FEED_WAIT_MS);
    schedule("arm");
    /* AND ONE LOOK AFTER THE CURRENT TASK. arm() can run in the same tick as the
       render that finished the shelf, in which case the observer is attached one
       moment too late and there is nothing left to react to. This costs one
       frame and closes that window; the timeout above is now only for a feed
       that genuinely never arrives. */
    requestAnimationFrame(function () { schedule("armed-late"); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arm);
  else arm();
})();

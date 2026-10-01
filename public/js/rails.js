/* public/js/rails.js -- the three rails, one core.
 *
 * "Shop by store", "Shop by category" and "Shop by brand" were worked out on
 * NicotiaMarket, ported class for class into the Coldwater generator, and then
 * lived only there: 65KB of city-page injection inside tools/make-coldwater.mjs
 * that legal-leafmarket.com -- the site every one of those pages is generated
 * FROM -- could not use.
 *
 * NOTHING IN ANY OF THE FIVE BLOCKS WAS EVER CITY-SPECIFIC, and that was
 * measured rather than assumed before moving them: zero template
 * interpolations across all of them, and exactly three references to a
 * feed-shaped global. So this is not new code, it is the same code in the place
 * it belonged -- which is the argument ONE_CORE.md makes: a behaviour every
 * city shares is not a behaviour a city file gets to own.
 *
 * The generator REFERENCES this file now instead of carrying a copy, so a fix
 * to a rail lands on the hemp site and on Coldwater and on Detroit and on Grand
 * Rapids in one edit. The alternative is the one this repo keeps paying for:
 * rscRoots and its collector twin, capKey and captureKeyer, storeCheckoutUrl
 * four times over, and the collector keyOf() that never received captureKeyer's
 * ambiguity rule and undercounted a shop by 99.2% in silence.
 *
 * WHAT EACH RAIL IS. Every one of them is a FACE FOR A CONTROL THE ENGINE
 * ALREADY OWNS -- #fStore, #fCategory, and the search box #q. They act by
 * setting that control's value and firing its event, and the number on a chip
 * is the engine's own facet count. That is what keeps them honest: a chip
 * cannot drift from the dropdown it is a face for, because it holds no state of
 * its own. public/engine.js is not edited (CLAUDE.md section 5); this is the
 * additive layer that section recommends.
 *
 * WHERE THE DATA COMES FROM. Three fields -- domains, brands, catPool -- off
 * whichever meta publisher the page has. On a generated city page that is the
 * cw-endpoint shim reading /api/coldwater; on legal-leafmarket it is
 * public/js/feed-meta.js reading /api/products. Both fire "ll-meta" when they
 * land, and both are late relative to first paint, so every rail renders empty,
 * listens, and re-renders. A rail with no data draws NOTHING rather than
 * drawing a broken version of itself -- which is also how the brand rail
 * behaves on a feed with nothing to compare (see its own header).
 */
(function(){
  /* THE ONE PLACE EITHER PUBLISHER IS READ. City pages have written
     LL_COLDWATER_META since the strip was built, and churning a working shim to
     rename a global buys nothing; feed-meta.js writes LL_META. Preferring
     LL_META means a page carrying both takes its own.
     Note this is deliberately a function rather than a captured value: both
     publishers write their object AFTER these rails have been evaluated. */
  window.LL_railsMeta = function(){
    return window.LL_META || window.LL_COLDWATER_META || {};
  };

  /* A SHOP'S MARK, FROM ONE PLACE. The store strip built these two URLs inline
     and the brand strip now needs the same pair -- a shop's own house label wears
     the shop's mark -- so they are stated once rather than twinned, which is what
     four copies of storeCheckoutUrl() taught this repo not to do.

     THE FALLBACK STRIPS www. AND THAT IS A REAL FIX, not tidiness.
     DuckDuckGo's ip3 endpoint is keyed on the registrable domain and misses a
     www-prefixed host, and five of the roster's domains carry the prefix --
     Grasscity, Exhale, Nothing But Canna, and the Greek Glass seed among them.
     So for exactly those shops the second source could never answer and the
     chain was one deep rather than two. Google's service handles either form,
     so the primary is left alone. */
  window.LL_railsFavicon = function(domain){
    return "https://www.google.com/s2/favicons?sz=128&domain=" + encodeURIComponent(domain);
  };
  window.LL_railsFaviconAlt = function(domain){
    return "https://icons.duckduckgo.com/ip3/" +
           encodeURIComponent(String(domain).replace(/^www\./i, "")) + ".ico";
  };
  /* AND THE SHOP'S OWN ICON, WHICH IS THE ONE SOURCE THAT CANNOT NOT KNOW.
     Reported missing for YLLVAPE, Lookah and THCA4Cheap -- three small shops
     that both third-party services simply have no entry for, so the chain ran
     out and left a tinted monogram. Their own /favicon.ico is served by the shop
     itself; an <img> may load it cross-origin without CORS, so this needs no
     permission from anyone and no fourth party to be down.
     LAST rather than first: the services return a normalised square, while a
     site's own icon can be a 16px .ico that looks poor at 54px. Better than a
     letter, worse than a real mark, so it sits exactly there. */
  window.LL_railsFaviconOwn = function(domain){
    return "https://" + String(domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "") + "/favicon.ico";
  };
  /* AND THE ONE THAT IS ACTUALLY BIG ENOUGH FOR THIS PLATE. Reported the moment
     the shop's own icon started answering: "Lookah logo is there but it looks
     blurry" -- which is /favicon.ico doing exactly what its own comment
     predicted, a 16px .ico stretched to 54px.
     /apple-touch-icon.png is 180px by convention -- Apple's guidance, followed
     by essentially every storefront platform -- so it upscales to nothing and
     downscales cleanly. It goes AHEAD of favicon.ico and behind the two
     services, which return a normalised square and are still the better answer
     where they have one. A site without it 404s and the chain simply moves on,
     which costs one request and no correctness. */
  window.LL_railsFaviconTouch = function(domain){
    return "https://" + String(domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "") + "/apple-touch-icon.png";
  };
})();


/* ========================================================================
   CAROUSEL BEHAVIOUR -- one handler serves every rail
   ======================================================================== */

/* ONE CAROUSEL BEHAVIOUR FOR EVERY RAIL.
   The store strip carried its own sync() bound to its own scroller, so when the
   brand rail arrived it inherited the arrows and the fade CSS but nothing that
   UPDATED them: its arrows never disabled at the ends and its edge fades never
   appeared. The markup looked right and the thing felt dead, which is the
   failure mode this file keeps producing -- a face with nothing behind it.

   So the edge state is computed here for every .lrscroll on the page, and the
   two things that make a rail feel like an app rather than a div are added in
   the same place: drag with a mouse, and a vertical wheel scrolling it
   sideways. Both are what somebody expects from a carousel and neither exists
   for free.

   Applies to any rail added later, which is the point of doing it once. */
(function(){
  function rails(){ return document.querySelectorAll(".lrscroll"); }

  function sync(box){
    var wrap = box.parentElement;
    if (!wrap || !wrap.classList.contains("lrwrap")) return;
    var max = box.scrollWidth - box.clientWidth;
    var scrollable = max > 2;
    wrap.classList.toggle("can-prev", scrollable && box.scrollLeft > 2);
    wrap.classList.toggle("can-next", scrollable && box.scrollLeft < max - 2);
  }
  function syncAll(){ var r = rails(); for (var i = 0; i < r.length; i++) { ensureJoints(r[i]); startOffset(r[i]); sync(r[i]); } }

  /* THE RAIL OPENS ONE STEP IN, WHICH IS A LOOK RATHER THAN A BEHAVIOUR.
     "I like the view best when I've clicked over once to the right -- that's
     exactly how I want the start state. It's covering just a little bit of
     store, and then has the arrow on the left as well."

     At scrollLeft 0 the left edge is flush: nothing is running under the fade,
     so the fade has nothing to do, and the left joint has nowhere to go. One
     step in, both edges have chips dissolving under them and both arrows are
     live -- the rail looks like a rail instead of like a row that happens to be
     cut off on one side.

     ONCE PER RAIL, EVER, and that is the whole difficulty. The rails are rebuilt
     on every filter and sort, so syncAll runs constantly; re-applying the offset
     each time would drag the rail back under a shopper who had scrolled it
     somewhere, on every keystroke in the search box. The flag lives on the
     scroller element, which survives those rebuilds because only its children
     are replaced.

     IT DOES NOT CLAIM THE FLAG UNTIL IT CAN ACT. An early sync runs before the
     chips exist, when scrollWidth equals clientWidth and there is nothing to
     scroll; marking that as done would mean the offset never happened at all.
     So the no-overflow case returns WITHOUT setting the flag and the next sync
     tries again.

     Desktop only. On a phone the rail is scrolled by hand and starting it part
     way along just hides the first shop behind an edge nobody asked for. */
  function startOffset(box){
    if (!deskOnly()) return;
    if (box.dataset.llStart === "1") return;
    var max = box.scrollWidth - box.clientWidth;
    if (max <= 2) return;                    // not built yet, or nothing to scroll
    box.dataset.llStart = "1";
    /* NEVER MORE THAN HALF THE TRAVEL. A full step is right on a long rail and
       wrong on a short one, where it lands hard against the far end -- which
       leaves nothing dissolving on the right and the whole point of opening part
       way along is that BOTH edges are covered. Found on a fixture whose entire
       overflow was one step wide. Under a sliver of overflow it is left flush,
       because sliding a rail four pixels is a twitch rather than a look. */
    var to = Math.min(step(box), Math.round(max * 0.5));
    if (to < 12) return;
    /* Instant, not smooth: this is the opening state, not a movement, and
       scroll-behavior is smooth at desktop width -- so the shopper would watch
       the rail slide sideways on its own as the page settled. */
    var was = box.style.scrollBehavior;
    box.style.scrollBehavior = "auto";
    box.scrollLeft = to;
    box.style.scrollBehavior = was;
  }

  /* ---------------- the joints ----------------------------------------------

     "I don't want them scrollable on desktop at all. I really just want some
      arrows on either side that get brighter and less opaque as you hover over
      them ... I would like to be a little bit silly here and have those arrows
      be joints."

     ON DESKTOP THE RAIL DOES NOT SCROLL AND THE JOINTS ARE THE ONLY WAY ACROSS.
     Not "scrolls and also has buttons": the drag and the wheel below both stand
     down above the breakpoint, which is the half that is easy to skip and would
     leave two controls disagreeing about where the rail is.

     THE GATE IS A WIDTH, NEVER `pointer:fine`. Headless Chrome reports
     pointer:none, so a pointer query would switch this off in every browser
     suite while reading as working code -- the card-flip work lost an evening
     to exactly that and CLAUDE.md writes it up. Read live rather than cached at
     parse time, or rotating a tablet leaves the rail in the wrong mode.

     DRAWN, NOT FETCHED. An <img> would be a second request and a sprite would be
     a file to keep in step; inline SVG also means the ember and each smoke
     ribbon are separately styleable, which is the entire hover behaviour. */
  function deskOnly(){
    try { return window.matchMedia("(min-width: 900px)").matches; } catch (e) { return false; }
  }

  /* THE JOINT *IS* THE ARROW: the burning end is rolled into a barbed spear
     point, so the object itself points and the ember is the tip. It lies flat
     along the direction of travel -- a joint drawn on a diagonal is a picture of
     a joint NEXT to a button, not a button.

     PROPORTIONS MEASURED OFF THE REFERENCE, NOT EYEBALLED, because three earlier
     cuts failed on exactly this and each failure looked like something else:

       - body length to body width is about 8:1. Fatter than that and it reads
         as a flashlight or a mallet.
       - the barbs are only ~2.2x the body's half-width. Wider and the head
         stops being a point.
       - AND THE ONE THAT KEPT PRODUCING A DIAMOND: the barb's TRAILING edge is
         SHORT and steep -- about a fifth of the leading edge's length. Drawn
         anywhere near equal, the head becomes a kite stuck on a stick. The
         leading edges are long and nearly straight; the flanges are small
         flicks of paper behind them.
       - the lit cone is the front ~40% of the head and no more.

     viewBox is 64 x 44, wide rather than square: the object is long and the
     smoke needs room above the tip. Drawn pointing LEFT and mirrored in CSS for
     the other side, so there is one drawing to keep correct rather than two that
     can drift apart.

     THE EMBER IS LIT RATHER THAN CHARRED, which is a deliberate departure from
     the photograph. On white paper a black coal with glowing cracks reads
     perfectly; on this site's near-black ground it disappears and the arrow
     loses its point. So the coal burns and the char is flecked OVER it. */
  var JOINT_SVG =
    '<svg viewBox="0 0 64 44" width="54" height="37" aria-hidden="true" focusable="false">'
    + '<defs><filter id="llJglow" x="-70%" y="-70%" width="240%" height="240%">'
    + '<feGaussianBlur stdDeviation="2.1"/></filter></defs>'
    + '<ellipse class="lrj-glow" cx="6" cy="28" rx="5.6" ry="4.8" fill="#ff7326" filter="url(#llJglow)"/>'
    /* Tail to head: crutch, paper, the flower showing through, then the point. */
    + '<path d="M52 25.4 L59.4 25.4 A2.6 2.6 0 0 1 59.4 30.6 L52 30.6 Z" fill="#e3d4b0"/>'
    + '<path d="M17 24.4 L52 25.4 L52 30.6 L17 31.6 Z" fill="#dfd6be"/>'
    + '<path d="M21 26.4 L49.5 27.1 L49.5 28.9 L21 29.6 Z" fill="#a6a583" opacity=".5"/>'
    + '<path d="M51.6 25.4 L52.4 25.4 L52.4 30.6 L51.6 30.6 Z" fill="#c5b793"/>'
    /* THE HEAD. Short steep flicks out to the barbs, then long near-straight
       runs to the point -- that asymmetry is the entire silhouette. */
    + '<path d="M17 24.4 L14.5 20.2 C10.2 22.6 5.9 25.4 2 28'
    +   ' C5.9 30.6 10.2 33.4 14.5 35.8 L17 31.6 Z" fill="#d9cfb6"/>'
    /* The lit cone: the front 40% of the head, with a small wavy burn line. A
       saw tooth reads as a cartoon flame. */
    + '<path class="lrj-ember" d="M2 28 C4.1 26.6 6.1 25.4 8.2 24.3'
    +   ' L9.1 26.1 L8.3 28 L9.1 29.9 L8.2 31.7 C6.1 30.6 4.1 29.4 2 28 Z"/>'
    /* Char only at the very point, where the paper has already gone. Any more
       detail than this is noise at 54px -- the earlier cut carried a zigzag
       "core" that read as a scribble long before it read as fire. */
    + '<path class="lrj-char" d="M2 28 C3.2 27.2 4.4 26.5 5.6 25.8'
    +   ' L6.2 28 L5.6 30.2 C4.4 29.5 3.2 28.8 2 28 Z" fill="#3a2a20" opacity=".55"/>'
    + '<path class="lrj-core" d="M7.0 26.3 L8.4 25.6 L8.4 30.4 L7.0 29.7 L7.7 28 Z"'
    +   ' fill="#ffd98c" opacity=".7"/>'
    /* Smoke off the burning point, rising and drifting the way the arrow leads. */
    + '<path class="lrj-smoke lrj-s1" d="M5.6 22.6 c-1.4 -4.0 2.8 -5.4 0.4 -9.2"/>'
    + '<path class="lrj-smoke lrj-s2" d="M9.2 20.6 c-1.8 -4.2 3.0 -6.0 0.2 -10.0"/>'
    + '<path class="lrj-smoke lrj-s3" d="M2.8 24.4 c-1.0 -3.0 2.0 -4.0 0.2 -6.8"/>'
    + '</svg>';

  function step(box){
    /* Just under a screenful, so a chip is always carried over rather than
       landing exactly on the edge and looking clipped. */
    return Math.max(120, Math.round(box.clientWidth * 0.8));
  }

  /* A PHOTOGRAPH IF THERE IS ONE, THE DRAWING IF THERE IS NOT.
     The owner's reference is a real photographed joint rolled into an arrow, and
     no vector version of it was going to beat the photograph -- four attempts
     said so. So the button prefers public/img/joint-arrow.png and keeps the
     drawn SVG as the fallback.

     THE FALLBACK IS THE POINT, not a nicety. Shipping code that points at a file
     somebody still has to upload is a broken control for however long that
     takes, and "the arrows vanished" is a worse bug than "the arrows are drawn
     rather than photographed". `onerror` covers a missing file, a typo in the
     name and a failed request alike; the swap happens before paint in practice
     because the image is requested as soon as it is in the DOM.

     ONE FILE, POINTING RIGHT, mirrored in CSS for the other side -- same rule as
     the SVG. Two files would be two things to keep in step.

     THE PUFF IS DRAWN EVEN OVER THE PHOTOGRAPH. Smoke baked into a picture
     cannot move, and "it starts blowing out smoke as you hover" was the brief.
     So a small smoke-only overlay sits above the tip, invisible at rest and
     animated on hover, and it works whether the photograph carries its own
     smoke or not. */
  var JOINT_IMG = "/img/joint-arrow.png";
  var PUFF_SVG =
    '<svg class="lrj-puff" viewBox="0 0 24 30" aria-hidden="true" focusable="false">'
    + '<path class="lrj-smoke lrj-s1" d="M11.4 27 c-1.6 -4.4 3.0 -6.0 0.4 -10.0"/>'
    + '<path class="lrj-smoke lrj-s2" d="M15.2 24.6 c-2.0 -4.6 3.2 -6.6 0.2 -10.8"/>'
    + '<path class="lrj-smoke lrj-s3" d="M8.2 28.6 c-1.2 -3.2 2.2 -4.4 0.2 -7.4"/>'
    + '</svg>';

  function ensureJoints(box){
    var wrap = box.parentElement;
    if (!wrap || !wrap.classList.contains("lrwrap")) return;
    if (wrap.querySelector(".lrjoint")) return;          // once per rail, not once per sync
    var mk = function(dir){
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lrjoint lrjoint-" + dir;
      /* Named for what it does, not for what it is drawn as: a screen reader
         saying "joint" here would be a joke nobody asked to hear. */
      b.setAttribute("aria-label", dir === "prev" ? "Scroll left" : "Scroll right");
      var img = document.createElement("img");
      img.className = "lrj-img";
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.addEventListener("error", function(){
        b.classList.remove("lrj-photo");
        b.innerHTML = JOINT_SVG;                          // the drawing carries its own smoke
      });
      img.addEventListener("load", function(){ b.classList.add("lrj-photo"); });
      img.src = JOINT_IMG;
      b.appendChild(img);
      b.insertAdjacentHTML("beforeend", PUFF_SVG);
      b.addEventListener("click", function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var d = (dir === "prev" ? -1 : 1) * step(box);
        try { box.scrollBy({ left: d, behavior: "smooth" }); }
        catch (e) { box.scrollLeft += d; }               // older engines take the number form
        setTimeout(function(){ sync(box); }, 380);
      });
      return b;
    };
    wrap.appendChild(mk("prev"));
    wrap.appendChild(mk("next"));
  }

  /* DRAG TO SCROLL. Snapping and smooth-behaviour are both suspended while a
     drag is live, or the rail fights the pointer and lands somewhere the hand
     did not put it. Restored on release so a flick still settles on a chip. */
  var drag = null;
  document.addEventListener("pointerdown", function(e){
    if (e.pointerType === "touch") return;          // the platform already does this well
    if (deskOnly()) return;                         // desktop moves by joint only; see ensureJoints
    var box = e.target && e.target.closest ? e.target.closest(".lrscroll") : null;
    if (!box) return;
    drag = { box: box, x: e.clientX, left: box.scrollLeft, moved: 0 };
  });
  document.addEventListener("pointermove", function(e){
    if (!drag) return;
    var dx = e.clientX - drag.x;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    /* A few pixels of slop, so a click on a chip is still a click. */
    if (drag.moved < 4) return;
    if (!drag.box.classList.contains("dragging")) drag.box.classList.add("dragging");
    drag.box.scrollLeft = drag.left - dx;
    sync(drag.box);
    e.preventDefault();
  });
  function endDrag(){
    if (!drag) return;
    var d = drag; drag = null;
    d.box.classList.remove("dragging");
    if (d.moved >= 4) {
      /* Swallow the click that a drag-release fires, or letting go over a chip
         picks a brand the shopper was only scrolling past. */
      var kill = function(ev){ ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener("click", kill, true);
      setTimeout(function(){ document.removeEventListener("click", kill, true); }, 0);
    }
    sync(d.box);
  }
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  /* BOTH AXES MOVE THE RAIL, and refusing one of them was the bug.
   *
     This used to bail out when deltaX dominated deltaY, on the
     reasoning that a trackpad's own horizontal scroll should be "left alone" --
     i.e. that the browser would scroll the rail natively from deltaX. It does
     not do that reliably: reported as "currently I'm having to click and then
     drag, and it's not intuitive... I need it to swipe the same way on a
     trackpad, the same way it would on a phone". A two-finger sideways swipe
     produced deltaX, hit that line, and was discarded -- so the one gesture a
     person would naturally reach for was the only one explicitly ignored.

     So the dominant axis wins and either one drives scrollLeft (no backticks in
     this note on purpose -- the whole block is a template literal, and a stray
     one ends the string with a SyntaxError that takes the page's other scripts
     with it, exactly as the escaping note in this file warns). Preventing the
     default on a horizontal gesture matters twice over: it stops the page
     scrolling sideways underneath, and it stops the browser reading an
     edge-swipe as BACK, which on a rail of shops would throw away the filters
     somebody had just set.

     THE EDGE RELEASE IS KEPT, and it is what stops this hijacking the page: once
     the rail is against a stop, the gesture is handed back so the window scrolls
     normally instead of the cursor sitting over a dead zone. */
  document.addEventListener("wheel", function(e){
    /* Desktop hands the wheel back to the page: with the rail not scrollable
       there, a gesture over it must scroll the document rather than sit in a
       dead zone -- which is what "not scrollable at all" has to mean for a
       trackpad as well as for a drag. */
    if (deskOnly()) return;
    var box = e.target && e.target.closest ? e.target.closest(".lrscroll") : null;
    if (!box) return;
    var max = box.scrollWidth - box.clientWidth;
    if (max <= 2) return;
    var sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    var d = sideways ? e.deltaX : e.deltaY;
    if (!d) return;
    var next = box.scrollLeft + d;
    /* A vertical gesture at a stop goes back to the page. A HORIZONTAL one does
       not: the reader meant this rail, and letting it through would navigate. */
    if (!sideways && ((next <= 0 && d < 0) || (next >= max && d > 0))) return;
    box.scrollLeft = next < 0 ? 0 : (next > max ? max : next);
    sync(box);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("scroll", function(e){
    var box = e.target;
    if (box && box.classList && box.classList.contains("lrscroll")) sync(box);
  }, true);
  window.addEventListener("resize", syncAll);
  document.addEventListener("ll-meta", function(){ setTimeout(syncAll, 0); });

  /* The rails are rebuilt on every filter and sort, so the state has to be
     recomputed rather than set once -- same reason the trim chip observes. */
  try {
    new MutationObserver(function(){ syncAll(); })
      .observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
  syncAll();
  setTimeout(syncAll, 400);
})();


/* ========================================================================
   THE FACET PAIR -- the row that holds store and category
   ======================================================================== */

/* THE ROW THAT HOLDS STORE AND CATEGORY, and it is one block rather than two
   because both rails have to agree about where the middle of the page is.
   Built lazily and shared: whichever strip initialises first creates it, the
   other finds it. Each rail asks for its own column by name rather than by
   position, so the two scripts cannot land in the same slot or swap sides
   depending on which one won the race.
   A rail that cannot find its column falls back to inserting itself before the
   grid on its own, which is where both of them used to live -- a missing pair
   costs the side-by-side layout and nothing else. */
(function(){
  function build(){
    var grid = document.getElementById("grid");
    if (!grid || !grid.parentNode) return null;
    var pair = document.getElementById("cwFacets");
    if (pair) return pair;
    pair = document.createElement("div");
    pair.id = "cwFacets";
    pair.className = "lrpair";
    /* aria-hidden on the divider: it is a drawn line, and a screen reader
       announcing it would be reading the furniture. */
    pair.innerHTML =
      '<div class="lrpair-col" data-facet="store"></div>' +
      '<div class="lrsplit" aria-hidden="true"></div>' +
      '<div class="lrpair-col" data-facet="cat"></div>';
    grid.parentNode.insertBefore(pair, grid);
    return pair;
  }
  window.CW_facetSlot = function(which){
    var pair = build();
    return pair ? pair.querySelector('.lrpair-col[data-facet="' + which + '"]') : null;
  };
})();


/* ========================================================================
   SHOP BY STORE
   ======================================================================== */

/* SHOP BY STORE. The visual is NicotiaMarket's logo strip, ported class for
   class; the behaviour is bound to this engine rather than to Nicotia's.

   THE SELECT IS THE SOURCE OF TRUTH, and that is the whole design. Nicotia
   keeps its own filter state (F.stores, multi-select) because it owns its
   renderer. Here the renderer is inside the base64 engine and cannot be edited
   (CLAUDE.md section 5), so the chips are a FACE for the engine's own #fStore
   dropdown: they are built from its options and they act by setting its value.
   Two consequences, both wanted -- the counts on the chips are the engine's own
   counts and cannot drift from the dropdown, and picking a shop either way
   lights up the other. It is single-select for the same reason: that is what
   the engine offers, and faking multi-select here would mean filtering behind
   the engine's back and disagreeing with its own count.

   Rebuilt on mutation, like the trim chip, because the grid and its filters
   re-render on every change with no hook to attach to. */
(function(){
  var sel = document.getElementById("fStore");
  if (!sel) return;

  var section = document.createElement("section");
  section.className = "logorow";
  section.id = "storeRow";
  section.hidden = true;
  section.innerHTML =
    '<div class="lrhead"><h2>Shop by store</h2><small id="storeNote"></small>' +
      '<div class="lrctl">' +
        '<button class="lrclear" id="clearStores" hidden>Show all</button>' +
      '</div></div>' +
    '<div class="lrwrap"><div class="lrscroll" id="storeLogos"></div></div>';

  /* Above the grid, below whatever toolbar precedes it -- and in the LEFT column
     of the facet pair, with the category rail opposite it. The fallback is the
     old position, so a missing pair costs the side-by-side layout and not the
     strip. */
  var grid = document.getElementById("grid");
  var slot = window.CW_facetSlot ? window.CW_facetSlot("store") : null;
  var host = slot || (grid && grid.parentNode);
  if (!host) return;
  if (slot) slot.appendChild(section); else host.insertBefore(section, grid);

  var esc = function(v){ return String(v == null ? "" : v).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); };

  /* Deterministic tint per store, so the row reads as distinct shops. */
  function monoTint(key){
    var h = 0;
    String(key).split("").forEach(function(c){ h = (h * 31 + c.charCodeAt(0)) % 360; });
    return { a: "hsl(" + h + " 32% 30%)", b: "hsl(" + h + " 34% 17%)" };
  }

  /* The shop's own mark, via the favicon service, keyed on the domain the feed
     already carries. No logo is stored anywhere: a mark harvested and committed
     would be one more thing to keep in step with the roster. */
  var DOMAINS = {};
  function learnDomains(){
    try {
      var rows = (window.LL_railsMeta().domains) || null;
      if (rows) DOMAINS = rows;
    } catch (e) {}
  }

  function chipFor(value, label, count){
    var on = sel.value === value;
    var t = monoTint(value);
    var dom = DOMAINS[value] || "";
    /* NO INLINE onerror. This markup is a JS string, inside a template literal,
       inside an HTML attribute -- three quoting layers, and one lost backslash
       turned the whole strip into a SyntaxError that took the page's other
       scripts with it. The handler is bound after render instead, where it is
       just a function. */
    /* THE MONOGRAM IS ALWAYS THERE, AND THE LOGO ARRIVES ON TOP OF IT.
       Reported as "the logos load really slowly and not always show up", which
       was three faults wearing one face:
         - the plate was a bare WHITE disc until a third-party favicon landed, so
           a slow lookup read as a broken strip rather than as a loading one. The
           monogram renders instantly now and the logo fades over it, so there is
           never a blank chip -- the worst case is a tinted letter, which is a
           finished-looking thing;
         - loading="lazy" on a horizontal rail is close to "never" for the chips
           past the right edge: the browser defers until it thinks they are near
           the viewport, and a rail that scrolls sideways inside a fixed-height
           box does not always tell it that. Seven small icons above the fold are
           not what lazy loading is for. Eager, at low priority;
         - one source. Google's service is usually fast and occasionally is not,
           and it 404s on plenty of small-business domains. A second is tried
           before giving up, via data-alt -- the same fallback-chain idiom the
           satellite pages already use for store logos.
       Preconnects for both hosts go in <head> so the handshake is not on the
       critical path of a request that only starts once the feed has arrived. */
    /* A CHAIN, NOT A PAIR. data-alt carries the remaining sources separated by a
       space, and the error handler shifts one off each time -- so adding a
       source is a string, not another attribute and another branch. */
    var alt = dom ? window.LL_railsFaviconAlt(dom) + " " +
                    window.LL_railsFaviconTouch(dom) + " " +
                    window.LL_railsFaviconOwn(dom) : "";
    var img = dom
      ? '<img class="fimg" src="' + esc(window.LL_railsFavicon(dom)) + '" ' +
        'data-alt="' + esc(alt) + '" alt="" loading="eager" fetchpriority="low" decoding="async" ' +
        'referrerpolicy="no-referrer">'
      : "";
    return '<button class="lchip' + (on ? " on" : "") + '" type="button" data-logostore="' + esc(value) + '" ' +
      'aria-pressed="' + on + '" title="' + esc(label) + '">' +
      '<span class="limg mono" data-letter="' + esc(String(label || "?").charAt(0).toUpperCase()) + '" ' +
      'style="--mono-a:' + t.a + ';--mono-b:' + t.b + '">' + img + '</span>' +
      '<span class="lname">' + esc(label) + '</span>' +
      (count ? '<span class="lcount">' + esc(count) + '</span>' : "") +
      '</button>';
  }

  var box = document.getElementById("storeLogos");
  var note = document.getElementById("storeNote");
  var clear = document.getElementById("clearStores");
  var lastSig = "";

  function render(){
    learnDomains();
    var out = [], n = 0;
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      if (!o.value) continue;                       // the "All Stores" row
      /* The engine bakes the count into the option text as "Name (12)". */
      /* Backslashes are DOUBLED because this whole block is a template literal:
         a single \s reaches the page as a bare "s" and the count silently stays
         glued to the name. The strip still looked fine, which is how it got
         past a first run. */
      var m = String(o.textContent || "").match(/^(.*?)\s*\((\d+)\)\s*$/);
      var label = m ? m[1] : String(o.textContent || "").trim();
      var count = m ? m[2] : "";
      out.push(chipFor(o.value, label, count));
      n++;
    }
    /* One shop is not a choice, so the strip stays out of the way. */
    section.hidden = n < 2;
    if (note) note.textContent = n ? n + " shop" + (n === 1 ? "" : "s") + " here" : "";
    if (clear) clear.hidden = !sel.value;
    var sig = out.join("") + "|" + sel.value;
    /* The signature guard exists so the rail does not thrash while somebody
       types, and it has one hole: if the box is empty the markup is "correct"
       by signature and absent on screen, so the rail never comes back. Cheap to
       ask, and it is the difference between a strip that recovers and one that
       stays blank for the rest of the session. */
    if (sig !== lastSig || !box.firstChild) {
      box.innerHTML = out.join("");
      /* Cached images can finish before anything is bound, in which case no
         load event is coming and the mark would never be revealed. The rest is
         handled by the delegated listeners below. */
      var imgs = box.querySelectorAll(".fimg");
      for (var k = 0; k < imgs.length; k++) {
        if (imgs[k].complete && imgs[k].naturalWidth > 1) imgs[k].classList.add("ok");
      }
      lastSig = sig;
      sync();
    }
  }

  function pick(value){
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    render();
  }

  document.addEventListener("click", function(e){
    var t = e.target, el = t && t.closest ? t.closest("[data-logostore]") : null;
    if (el) {
      e.preventDefault();
      var k = el.getAttribute("data-logostore");
      pick(sel.value === k ? "" : k);       // clicking the lit chip clears it
      return;
    }
    if (t && t.closest && t.closest("#clearStores")) { e.preventDefault(); pick(""); }
    /* The arrows are NOT handled here. They were, and a second rail then had two
       choices: inherit nothing and sit dead, or bind its own handler and scroll
       twice per click. They live in cw-carousel now, once, for every rail. */
  });

  function sync(){
    var wrap = box.parentElement;
    if (!wrap || !wrap.classList.contains("lrwrap")) return;
    var max = box.scrollWidth - box.clientWidth;
    var scrollable = max > 2,
        canPrev = scrollable && box.scrollLeft > 2,
        canNext = scrollable && box.scrollLeft < max - 2;
    wrap.classList.toggle("can-prev", canPrev);
    wrap.classList.toggle("can-next", canNext);
  }

  box.addEventListener("scroll", function(){ sync(); }, { passive: true });
  /* Logos arrive as images, so the strip's width changes after the chips do --
     which the childList observer cannot see. */
  if (window.ResizeObserver) new ResizeObserver(function(){ sync(); }).observe(box);
  window.addEventListener("resize", function(){ sync(); }, { passive: true });

  /* A MARK IS ONLY REVEALED ONCE IT HAS ACTUALLY DECODED, so a slow or dead
     lookup leaves the monogram showing rather than a white hole; and on failure
     a second provider is tried once before the chip settles for being a
     monogram -- which is a finished thing, not an error state.
     DELEGATED ON THE SECTION, in the capture phase, because load and error do
     not bubble. Binding per-image at render was the obvious version and it is
     subtly worse: every re-render has to remember to rebind, and an image added
     by anything else silently has no fallback at all. Same idiom the category
     rail uses for its product photo. */
  section.addEventListener("load", function(e){
    var img = e.target;
    if (!img || !img.classList || !img.classList.contains("fimg")) return;
    /* A 1px response is a tracking pixel or an empty answer, not a mark. */
    if (img.naturalWidth > 1) img.classList.add("ok");
  }, true);
  section.addEventListener("error", function(e){
    var img = e.target;
    if (!img || !img.classList || !img.classList.contains("fimg")) return;
    var rest = String(img.getAttribute("data-alt") || "").split(/\s+/).filter(Boolean);
    var next = rest.shift();
    if (next) {
      if (rest.length) img.setAttribute("data-alt", rest.join(" "));
      else img.removeAttribute("data-alt");
      img.src = next;
      return;
    }
    img.remove();
  }, true);

  var queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; render(); });
  }
  new MutationObserver(schedule).observe(sel, { childList: true, subtree: true, characterData: true });
  sel.addEventListener("change", render);

  /* THE DOMAINS ARRIVE AFTER THE FIRST RENDER, AND NOTHING USED TO SAY SO.
     This is the other half of "the logos don't always show up", and the worse
     half, because it is not slowness at all. The strip builds itself from the
     engine's #fStore the moment that select has options, which is well before
     /api/coldwater has answered -- so the first render has no domains and draws
     no marks. The only re-render triggers were the select mutating and the user
     changing it, neither of which happens when a fetch resolves, and the
     start-up poll below stops as soon as the select is populated, which is
     exactly the wrong moment. So the strip sat there, correct and markless,
     until something unrelated made it redraw. The feed announces itself with
     ll-meta; that is now a re-render. */
  document.addEventListener("ll-meta", schedule);

  render();
  /* Keep polling until the marks are actually possible, not merely until the
     select is populated -- those are different moments and the gap between them
     is the whole bug above. */
  var tries = 0;
  var iv = setInterval(function(){
    render();
    var haveDomains = false;
    for (var kk in DOMAINS) { if (Object.prototype.hasOwnProperty.call(DOMAINS, kk)) { haveDomains = true; break; } }
    if (++tries > 60 || (sel.options.length > 1 && haveDomains)) clearInterval(iv);
  }, 250);
})();


/* ========================================================================
   SHOP BY CATEGORY
   ======================================================================== */

/* SHOP BY CATEGORY, opposite the store rail with the page's middle between them.
   Store and category are the two questions a walk-in shopper asks -- which shop,
   and what kind of thing -- and the second one was buried in a dropdown inside a
   filter panel that is behind a button on a phone.

   THE SELECT IS THE SOURCE OF TRUTH, for exactly the reason the store strip says
   so: the renderer is inside the base64 engine and cannot be edited (CLAUDE.md
   section 5), so these chips are a FACE for the engine's own #fCategory, built
   from its options and acting by setting its value. The counts on the chips are
   therefore the engine's own counts and cannot drift from the dropdown, and
   picking a category either way lights the other. Single-select, because that is
   what the engine offers -- faking multi-select would mean filtering behind its
   back and disagreeing with its own count.

   TWO KINDS OF OPTION ARE SKIPPED, and they are not the same kind of skip. The
   empty value is the "All Categories" row, which the Show all button already is.
   The "__consumables__" / "__glass__" / "__devices__" rows are the engine's own
   synthetic group headers -- real filter values, but they are the PARENT of the
   chips beside them, so a chip for one would double every count in the strip and
   look like a category nobody's menu has.

   THE PICTURE IS A REAL PRODUCT, and there was no other honest option: a shop's
   mark comes from its domain and a brand's from its own product shot, while a
   category has neither. So the picture is a product off that shelf, and where
   there is none -- a feed with no photography, or one of the engine's virtual
   sub-tags, which no single product carries -- a glyph answers instead. Same
   fallback shape as the brand rail: the photo lies OVER the plate rather than
   replacing it, so a dropped image uncovers the glyph instead of leaving a hole.

   WHERE THE PICTURE COMES FROM took two attempts and the first one is the
   instructive one. Reading it from the feed looked obviously right and matched
   NOTHING: /api/coldwater publishes "Flower", "Vaporizers", "Pre-Rolls", and the
   engine reclassifies every product through its own normCategory into
   "THCA Flower", "Concentrate", "Pre-rolls" before any of it reaches #fCategory.
   Two vocabularies for one shelf, no error, and a strip of glyphs on a feed with
   96% image coverage. So the pictures are read off the engine's OWN cards, which
   carry data-cat and the photograph in the same element: keyed by construction on
   the same classification the dropdown uses, and impossible to drift from it. */
(function(){
  var sel = document.getElementById("fCategory");
  if (!sel) return;

  var grid = document.getElementById("grid");
  var slot = window.CW_facetSlot ? window.CW_facetSlot("cat") : null;
  var host = slot || (grid && grid.parentNode);
  if (!host) return;

  var section = document.createElement("section");
  section.className = "logorow";
  section.id = "catRow";
  section.hidden = true;
  section.innerHTML =
    '<div class="lrhead"><h2>Shop by category</h2><small id="catNote"></small>' +
      '<div class="lrctl">' +
        '<button class="lrclear" id="clearCats" hidden>Show all</button>' +
      '</div></div>' +
    '<div class="lrwrap"><div class="lrscroll" id="catLogos"></div></div>';
  if (slot) slot.appendChild(section); else host.insertBefore(section, grid);

  var esc = function(v){ return String(v == null ? "" : v).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); };

  function monoTint(key){
    var h = 0;
    String(key).split("").forEach(function(c){ h = (h * 31 + c.charCodeAt(0)) % 360; });
    return { a: "hsl(" + h + " 32% 30%)", b: "hsl(" + h + " 34% 17%)" };
  }

  /* WRITTEN AS ESCAPES, NEVER AS CHARACTERS. The generator asserts that this
     page's non-ASCII inventory matches index.html byte for byte (CLAUDE.md
     section 5a), so a literal emoji in this block would fail the build -- and
     that assertion is the thing standing between a re-encode and the silent
     mojibake that shipped once already.
     Emoji rather than inline SVG for two more reasons: the engine already speaks
     this language (its own missing-image placeholder is a CAT_ICON glyph), and
     it needs no sprite, no request, and no fourth layer of quoting. */
  var LEAF = "\ud83c\udf3f";
  var PEN = "\ud83d\udd8a\ufe0f", GEM = "\ud83d\udc8e", SMOKE = "\ud83d\udeac";
  /* BOTH VOCABULARIES ARE KEYED, and that is not belt and braces. The engine's
     own words are what #fCategory carries where one of its rules fired
     ("THCA Flower", "Pre-rolls", "Concentrate", the virtual "Vape"), and the
     feed's own word survives untouched where none did ("Accessories"), so the
     strip meets both on the same page. Where they overlap they agree, which is
     the point of listing them together rather than mapping one to the other. */
  var GLYPH = {
    "THCA Flower": LEAF, "Flower": LEAF,
    "Pre-rolls": SMOKE, "Pre-Rolls": SMOKE,
    "Vape": PEN, "Vaporizers": PEN,
    "Concentrate": GEM, "Concentrates": GEM,
    "Edibles": "\ud83c\udf6c",
    "Drinks": "\ud83e\udd64",
    "Topicals": "\ud83e\uddf4",
    "Accessories": "\ud83e\uddf0",
    "Apparel": "\ud83d\udc55",
    "Seeds & Clones": "\ud83c\udf31",
    "Trim/Shake": "\ud83c\udf43",
    "CBD": "\ud83d\udca7",
    "Wholesale": "\ud83d\udce6",
    /* Same reason as ICON above: without these, "Parts & Tools" reaches the
       LEAF default and a cannabis leaf stands for a box of downstems. Written
       as escapes, never characters -- the generator asserts a city page's
       non-ASCII inventory matches index.html byte for byte, so one literal
       emoji here fails the build. */
    "Bongs & Rigs": "\ud83e\uddea",
    "Pipes": "\ud83e\uddf0",
    "Grinders": "\u2699\ufe0f",
    "Rolling": "\ud83e\uddfb",
    "Parts & Tools": "\ud83d\udd27",
    "Storage & Trays": "\ud83e\uded9"
  };
  /* A word normCategory did not recognise is KEPT and title-cased rather than
     discarded (api/coldwater.js says why), so this strip has to answer for
     categories no vocabulary has seen -- "Budder", "Glassware", "Dogwalkers".
     Ordered like CATEGORY_HINTS and for the same reason: the most specific form
     first, the raw material last. Accessories lead because "Batteries" contains
     batter and "Rolling Papers" contains roll, and both would otherwise be
     answered by a glyph for something you smoke. */
  var HINTS = [
    [/accessor|grinder|lighter|paper|tray|pipe|bong|rigs?\b|glassware|batter(y|ies)|dab.?tool/i, "Accessories"],
    [/roll|joint|blunt|dogwalker/i, "Pre-Rolls"],
    [/vap|cart|dispo|pod|510|aio/i, "Vaporizers"],
    [/gumm|edible|chocolate|candy|chew|mint|lozenge|caramel|taffy|cookie|brownie|baked|capsule|tablet/i, "Edibles"],
    [/drink|seltzer|soda|beverage|lemonade|teas?\b|tincture|syrup/i, "Drinks"],
    [/topical|balm|salve|lotion|cream|patch|roll.?on/i, "Topicals"],
    [/concentrate|extract|rosin|resin|shatter|budder|batter|badder|wax|hash|kief|diamond|distillate|sauce|crumble|dab/i, "Concentrates"],
    [/apparel|merch|shirt|hoodie|beanie/i, "Apparel"],
    [/seed|clone/i, "Seeds & Clones"],
    [/shake|trim|smalls|popcorn/i, "Trim/Shake"],
    [/flower|bud/i, "Flower"]
  ];
  function glyph(cat){
    if (GLYPH[cat]) return GLYPH[cat];
    for (var i = 0; i < HINTS.length; i++) if (HINTS[i][0].test(cat)) return GLYPH[HINTS[i][1]];
    return LEAF;
  }

  /* A DRAWN MARK, NOT AN EMOJI, and not a product photo either.
     An emoji is the reader's font rather than this page's design: it lands
     differently on every platform, it is flat colour beside a rail of
     photographic brand marks, and at 54px on a tinted plate it reads as a
     placeholder. A real product photo was the other attempt and it is worse
     for a CATEGORY: whichever product happened to be first stands for the
     whole shelf, so "Edibles" becomes one shop's gummy tin, the picture
     changes when the grid re-filters, and half the categories have no usable
     photo at all and fall back to something else -- a rail that is half
     photographs and half symbols.
     These are eight small SVGs under public/img/cat/, drawn for this plate:
     one flat mark each, sized to the same optical weight, so the rail reads as
     one set. Resolved through the SAME table the glyphs used (exact name, then
     HINTS), so a category no vocabulary has seen still lands somewhere sane. */
  var ICON = {
    "Flower": "flower", "Pre-Rolls": "preroll", "Vaporizers": "vape",
    "Edibles": "edible", "Drinks": "edible", "Concentrates": "concentrate",
    "Topicals": "topical", "Accessories": "accessory", "Apparel": "accessory",
    "Seeds & Clones": "flower", "Trim/Shake": "trim",
    /* Every gear bucket draws the accessory mark except Vaporizers, which has
       one of its own. Resolved explicitly rather than through HINTS, because
       HINTS sends "Rolling" to Pre-Rolls (a joint, for rolling papers) and
       "Parts & Tools" to nothing at all, which falls back to a cannabis leaf. */
    "Bongs & Rigs": "accessory", "Pipes": "accessory", "Grinders": "accessory",
    "Rolling": "accessory", "Parts & Tools": "accessory", "Storage & Trays": "accessory",
    /* The virtual facets resolve through HINTS to the right mark already --
       "Vape" reaches the vaporizer test, "Drinks" and "Trim/Shake" are keyed
       above -- except CBD, which no HINT matches at all and which therefore
       floored on the default. Stated rather than defaulted: the CBD shelf here
       is mostly flower, so it draws the flower mark. */
    "CBD": "flower"
  };
  function iconFor(cat){
    var k = ICON[cat];
    if (!k) for (var i = 0; i < HINTS.length && !k; i++) if (HINTS[i][0].test(cat)) k = ICON[HINTS[i][1]];
    return "/img/cat/" + (k || "flower") + ".svg";
  }

  /* A REAL PRODUCT PHOTO, CURATED -- not the first card, and not a drawn mark.
     Both of the earlier attempts failed for the same reason from opposite ends.
     A flat SVG reads as a placeholder next to a rail of photographic brand
     marks; and the first-card-wins photo made the rail look arbitrary, because
     "Edibles" became whichever gummy tin happened to sort first and changed
     again on the next filter.

     So each category states what a good picture of it looks like, in the
     vocabulary these menus actually use, and the best-scoring product on the
     shelf wins. NEGATIVE TERMS DO MORE WORK THAN POSITIVE ONES: a disposable
     vape filed under Concentrate is a real listing and a terrible picture of
     concentrate, and the flower shelf is full of shake, smalls and pre-rolls
     that are not what somebody means by a bud. The score has to be positive to
     be used at all, so a shelf with nothing recognisable keeps its drawn mark
     rather than showing something misleading. */
  var PREFER = {
    "THCA Flower": [[/\b(prepack|pre-?pack|flower|bud|nug)\b/i, 3], [/\b(3\.5\s*g|eighth|1\/8)\b/i, 2],
                    /* "Bulk" is a bag on a scale in most of these photographs, and the
                       thing being asked for is one bud. Mild, so it only outranks a
                       bulk listing when a packaged one exists. */
                    [/\bbulk\b/i, -2],
                    [/\b(shake|trim|smalls|popcorn|pre-?roll|joint|cart|vape|disposable|infused|gummy|gummies)\b/i, -8]],
    "Pre-rolls":   [[/\b(pre-?roll|joint)\b/i, 3], [/\b(1\s*g|single|\.?7\s*g)\b/i, 2],
                    [/\b(\d{1,2}\s*-?\s*(pk|pack)|infused|blunt|cart|vape|gummies)\b/i, -6]],
    /* ONE WORD, TWO SHELVES. On a dispensary page "Vaporizers" is a 510 cart; on
       the hemp shelf it is a dry-herb device or an e-rig, and this table had only
       the cart half -- so a Puffco matched no positive and floored at 0.25, which
       is the "any photo beats no photo" tier rather than a real choice. The
       device terms are ADDED rather than swapped: a cart still scores +4, so the
       dispensary reading is untouched. */
    "Vaporizers":  [[/\b(cart|cartridge)\b/i, 4], [/\b1\s*g\b/i, 3],
                    [/\b(vaporizer|dry\s*herb|e-?rig|puffco|volcano|pax|dynavap|crafty|mighty|arizer)\b/i, 4],
                    [/\b(disposable|battery|pod|all-?in-?one|aio|3\s*g|2\s*g)\b/i, -6]],
    "Concentrate": [[/\b(badder|budder|rosin|live\s*resin|sugar|sauce|diamonds|wax|hash)\b/i, 3], [/\b1\s*g\b/i, 2],
                    [/\b(cart|cartridge|vape|disposable|pre-?roll|infused)\b/i, -8]],
    /* CHOCOLATE WAS A NEGATIVE HERE, AND THAT BECAME A REFUSAL. It was written
       to rank gummies above chocolate back when a negative merely lost a tie --
       then the "matched only a negative" tier was removed, and every chocolate
       edible stopped being a candidate at all. With gummies scarce in the first
       forty of this bucket, what was left was whatever matched NOTHING, and a
       flower product misfiled under Edibles matches nothing. Reported as
       "Edibles is currently showing a picture of flower ... it needs to be
       gummies or chocolate. Pick one of those."
       So chocolate is a positive, as it always should have been -- it is an
       edible, not a bad picture of one -- and the negatives are what an edible
       is NOT: flower, a cart, a drink. A category whose table lists only what it
       prefers cannot refuse anything, which is the general form of this bug. */
    "Edibles":     [[/\b(gumm\w*|chews?|chocolates?|caramels?|taffy|brownies?|cookies?|lozenges?)\b/i, 4],
                    [/\b(\d+\s*(mg|pk|pack)|bites?|bars?)\b/i, 1],
                    [/\b(flower|bud|nug\w*|shake|trim|smalls|pre-?roll|joint|cart|cartridge|vape|disposable|rosin|resin|wax|hash|kief|diamonds?)\b/i, -8],
                    [/\b(drink|beverage|seltzer|soda|tincture|syrup|capsule|tablet)\b/i, -4]],
    "Topicals":    [[/\b(balm|salve|lotion|cream|roll-?on|patch|topical|rub|ointment|bath)\b/i, 3],
                    /* NEGATIVES MATTER MOST ON THE SMALLEST SHELF. Topicals is a
                       handful of listings, so one flower photo filed here stands
                       for the whole category -- which is what "topicals is a
                       picture of flower" was. */
                    /* STEMS NEED A SUFFIX, and two of these could never fire.
                       \bgumm\b cannot match "Gummies" -- the trailing boundary
                       fails between "m" and "i" -- and \bnug\b cannot match
                       "nugs". Both were written to catch exactly those words.
                       A negative that never matches is worse than no negative:
                       it reads as handled. */
                    [/\b(flower|bud|nug\w*|pre-?roll|cart|vape|disposable|gumm\w*|edible|shake|smalls)\b/i, -8]],
    /* THE THREE SPLIT FACETS NEED THEIR OWN TABLES, and their absence is exactly
       why "disposables is an emoji". cw-catsplit promotes Carts, Disposables and
       Drinks out of their parent category, so #fCategory offers all three -- but
       PREFER had none of them, so scoreFor fell through HINTS to the PARENT's
       table, and Vaporizers scores -6 for the word "disposable" on purpose (a
       disposable is a bad picture OF A CART). Every disposable therefore scored
       negative in its own category and the chip kept its drawn mark. Same rule,
       read one facet along, inverted. */
    "Carts":       [[/\b(cart|cartridge|510)\b/i, 4], [/\b1\s*g\b/i, 2],
                    [/\b(disposable|all-?in-?one|aio|battery|pod|pen)\b/i, -8]],
    "Disposables": [[/\b(disposable|all-?in-?one|aio|dispo)\b/i, 4], [/\b(2\s*g|3\s*g|pen)\b/i, 2],
                    [/\b(cartridge|battery|charger|pre-?roll|flower)\b/i, -8]],
    "Drinks":      [[/\b(drink|seltzer|soda|beverage|lemonade|shot|tonic)\b/i, 4],
                    [/\b(gumm|chocolate|flower|cart|tincture|capsule)\b/i, -6]],
    "Accessories": [[/\b(grinder|tray|banger|pipe|bong|rig|papers|lighter|torch)\b/i, 3],
                    [/\b(battery|charger|shirt|hoodie|hat)\b/i, -3]],
    /* THE GEAR SHELF, EIGHT BUCKETS, and every one of them needs its own table
       for a reason scoreFor's own comment already gives. Without one they fall
       through HINTS to "Accessories", whose positives are
       grinder|tray|banger|pipe|bong|rig|papers|lighter|torch -- so a photo of a
       bong scores +3 as the face of GRINDERS. That is "Topicals is a bud"
       wearing different clothes: not an empty chip, a confidently wrong one.
       Each table therefore states what a BAD picture of the bucket looks like as
       well as a good one, which test-catrow-pictures.mjs requires of every
       curated category. */
    "Bongs & Rigs": [[/\b(bong|water\s*pipe|beaker|bubbler|rig|recycler|incycler|tube|straight)\b/i, 4],
                    [/\b(grinder|tray|papers?|banger|carb\s*cap|downstem|bowl|torch|lighter|cart|battery)\b/i, -6]],
    "Pipes":       [[/\b(pipe|one[\s-]?hitter|chillum|spoon|sherlock|taster|steamroller)\b/i, 4],
                    [/\b(water\s*pipe|bong|rig|beaker|bubbler|grinder|tray|papers?|banger)\b/i, -6]],
    "Grinders":    [[/\bgrinder\b/i, 4],
                    [/\b(bong|rig|pipe|banger|tray|papers?|torch|cart)\b/i, -6]],
    "Rolling":     [[/\b(papers?|cone|wrap|rolling|filter\s*tips?|tips?)\b/i, 4],
                    [/\b(tray|grinder|bong|rig|pipe|banger|torch)\b/i, -6]],
    "Storage & Trays": [[/\b(tray|ashtray|stash|jar|case|container|bag|storage)\b/i, 4],
                    [/\b(bong|rig|pipe|grinder|banger|papers?|torch)\b/i, -6]],
    "Parts & Tools": [[/\b(banger|nail|carb\s*cap|dabber|terp|slurper|insert|downstem|bowl|slide|adapter|attachment|ash\s*catcher|torch|lighter|brush)\b/i, 4],
                    [/\b(bong|beaker|rig|grinder|tray|papers?|vaporizer|shirt)\b/i, -6]],
    /* Apparel had only a positive, and the check that requires a negative could
       not see it: that check matches entries ending "]]," and Apparel was LAST,
       so it ended "]]" and was skipped. It stopped being last when the two
       tables below were added, and the gap surfaced immediately. The suite now
       reads the final entry too, so this cannot hide again. */
    "Apparel":     [[/\b(t-?shirt|shirt|hoodie|crewneck|hat|beanie|socks|joggers|sweatpants)\b/i, 3],
                    [/\b(flower|bud|nug\w*|cart|cartridge|vape|disposable|gumm\w*|pre-?roll|joint|rosin|grinder|bong)\b/i, -8]],
    /* TWO FACETS THAT HAD NO TABLE, on the reasoning that their pools are
       self-selecting -- every candidate in Trim/Shake already IS shake, so there
       was nothing for a table to reject. That was right about the POOL and wrong
       about the PICTURE, which is what the reports say:
         "Trim and shake is currently, like, a disposable vape ... you can even
          find something with trim or shake in the title and go with that"
         "Wholesale -- can you just make wholesale some more flower? Maybe the
          budget buds one specifically that's in cellophane"
       With no table every candidate scores the same flat 1, so the winner is
       whichever the grid happened to render first. Self-selecting decides who is
       ELIGIBLE; a table decides who is a good picture, and those are different
       questions. */
    /* The sub-tag is set from title, tags AND description, so a listing can be
       in this bucket with a title that says nothing about shake -- which is how
       a disposable got the chip. Prefer the ones that say it where a shopper can
       read it, and refuse the shapes that are plainly something else. */
    "Trim/Shake":  [[/\b(shake|trim|smalls|popcorn)\b/i, 4],
                    [/\b(oz|ounce|28\s*g|half|pound|lb)\b/i, 1],
                    [/\b(cart|cartridge|vape|disposable|pen|gumm\w*|chocolate|drink|pre-?roll|joint|rosin|resin|wax|topical|balm)\b/i, -8]],
    /* A bulk listing IS flower here -- that is what this shelf's wholesale is --
       so the positives are the flower words plus the bulk weights, and Budget
       Buds is named because it was asked for by name. Ranked, not required: if
       that listing is gone the next best bulk flower photo still wins. */
    "Wholesale":   [[/\bbudget\s*buds\b/i, 5],
                    [/\b(flower|bud|nug\w*|prepack|pre-?pack)\b/i, 4],
                    [/\b(pound|lb|qp|quarter\s*pound|half\s*pound|bulk|wholesale|448\s*g|224\s*g|112\s*g)\b/i, 2],
                    [/\b(cart|cartridge|vape|disposable|pen|gumm\w*|chocolate|drink|pre-?roll|joint|topical|balm|shirt|hoodie)\b/i, -8]]
  };
  /* WHOSE PHOTOGRAPH, where the name cannot decide it. Asked for directly --
     "for concentrate, use one of hipuffy's pics" -- and no rule above can
     express it, because every shop's badder is called badder and the tables
     score on the product name alone.

     A PREFERENCE, NOT A FILTER, and the difference is what keeps it safe: the
     bonus breaks a tie toward the named shop and cannot rescue a product the
     category's own negatives have refused, so a Puffy vape still loses the
     Concentrate chip to a Puffy rosin. If that shop has nothing in the bucket
     the day this runs, the best-scoring photograph from anywhere else wins and
     the chip is still right. Matched on the store NAME the feed publishes,
     which is the same string #fStore carries. */
  var PREFER_STORE = { "Concentrate": /puffy/i, "Concentrates": /puffy/i };

  /* A category no table has heard of still gets a picture: anything with a photo
     scores 1, which beats nothing and loses to every curated match. */
  function scoreFor(cat, name, store){
    var rules = PREFER[cat];
    if (!rules) {
      for (var h = 0; h < HINTS.length && !rules; h++) if (HINTS[h][0].test(cat)) rules = PREFER[HINTS[h][1]];
    }
    /* A CURATED CATEGORY MUST ACTUALLY MATCH SOMETHING, and the base score of 1
       was quietly defeating that. The comment above says "the score has to be
       positive to be used at all, so a shelf with nothing recognisable keeps its
       drawn mark rather than showing something misleading" -- but every product
       started at 1, and at 1.5 with a short title, so on a table with no
       negative terms ANYTHING qualified. Topicals had no negatives, so the first
       short-titled product in that bucket became the face of the category, and
       it was a bud.
       So where a category states what a good picture of it looks like, a product
       that matches NONE of those positives is not a candidate at all. Where no
       table exists the old behaviour stands, because "any photo beats no photo"
       is right for a category nobody has described. */
    var hit = 0, sc = 1;
    if (rules) {
      for (var i = 0; i < rules.length; i++) {
        if (!rules[i][0].test(name)) continue;
        sc += rules[i][1];
        if (rules[i][1] > 0) hit = 1;
      }
      /* A PRODUCT THAT MATCHED ONLY A NEGATIVE IS NOT A CANDIDATE. It used to
         floor at 0.05 -- beaten by anything neutral, but still usable when the
         category held nothing else -- on the argument that an empty chip says
         something false while a bad photo of a real topical says something true
         and merely unflattering.

         REPORTED AGAIN ANYWAY: "topicals is flower currently in the picture".
         And the argument was wrong on its own terms, because the alternative
         was never an empty chip. Every category has a drawn mark under the
         photograph -- Topicals has its own, at /img/cat/topical.svg -- so
         refusing costs a photograph and yields a picture of a tube of balm.
         What the 0.05 tier bought was the chance to publish a bud as the face
         of Topicals whenever that shelf was thin, which is the whole failure.

         So the tiers are: a positive match scores properly; NO match at all
         floors at 0.25, because "any photo beats no photo" is still right for a
         product nothing has an opinion about; and a match on a negative and
         nothing else returns ZERO, which the caller reads as no candidate. The
         negative list now does what it always said it did. */
      if (!hit) return sc < 1 ? 0 : 0.25;
    }
    /* A NET-NEGATIVE VERDICT IS A REFUSAL TOO, and this line used to floor it at
       0.25 instead. It only runs when a positive DID match, so it is the mixed
       case: "Live Resin Cart 1g" on Concentrate scores +3 for the resin, +2 for
       the gram and -8 for the cart, and the table's answer is plainly no. The
       floor made it a usable last resort, and the shop preference below could
       then lift it above a perfectly good neutral candidate -- which is the
       Topicals bug reappearing through the one door left open. If the terms net
       out negative, the table has said this is a bad picture of the category. */
    if (sc < 0.25) return 0;
    /* A mild preference for a shorter title, as the closest thing to "without
       obvious branding" that a name can tell us: these titles are
       "<brand> <line> <strain> <format> <weight>", so the short ones are the
       plain ones. Small enough that it only ever breaks a tie. */
    if (name.length < 34) sc += 0.5;
    /* Applied AFTER the floors, so it lifts a real candidate and never revives a
       refused one -- zero stays zero. Bigger than the short-title nudge, because
       this is a stated instruction rather than a heuristic, and smaller than a
       curated positive, because a good picture of the category still outranks a
       mediocre one from the right shop. */
    var ps = PREFER_STORE[cat];
    if (ps && sc > 0 && store && ps.test(store)) sc += 1.5;
    return sc;
  }

  /* STICKY, and replaced only by something strictly better. The grid re-renders
     on every filter, sort and keystroke, so a picture read fresh each time would
     flicker while somebody typed -- and keeping the best one found so far means a
     category holds its face after the grid has been filtered to something else
     entirely. */
  var PICS = {}, SCORE = {};
  /* THE WHOLE CATALOGUE, NOT THE VISIBLE PAGE. Scoring the rendered cards could
     only see the forty currently drawn, from whichever shops sorted first, so
     six of eight categories never had a candidate at all and kept their drawn
     mark -- "two real pictures out of eight". The feed carries every product
     with its image and its ENGINE category, which is the key the chip uses, so
     the pool is both complete and impossible to mis-key. The grid is still read
     as a fallback for a category the feed has no picture for. */
  /* NO TABLE FOR THE VIRTUAL FACETS, AND THAT IS THE RIGHT ANSWER RATHER THAN A
     GAP. Vape, Drinks, Trim/Shake and CBD/CBG are sub-tags, so feed-meta.js
     selects their pools with the engine's own test -- every candidate in
     Trim/Shake already IS shake, every candidate in CBD already IS a CBD
     listing. The pool is self-selecting, so there is nothing for a PREFER table
     to reject, and "any photo beats no photo" is exactly right for a set that
     cannot contain a wrong answer. Vape is the one exception and needs no entry
     either: HINTS sends it to the Vaporizers table, which is the same question. */
  function learnPics(){
    var pool = null;
    try { pool = (window.LL_railsMeta().catPool) || null; } catch (e) {}
    if (pool) {
      for (var cat in pool) {
        if (!Object.prototype.hasOwnProperty.call(pool, cat)) continue;
        var list = pool[cat];
        for (var i = 0; i < list.length; i++) {
          var sc = scoreFor(cat, list[i].n, list[i].s);
          if (sc > 0 && sc > (SCORE[cat] || 0)) { SCORE[cat] = sc; PICS[cat] = list[i].img; }
        }
      }
    }
    var cards = document.querySelectorAll("#grid .card[data-cat]");
    for (var k = 0; k < cards.length; k++) {
      var c2 = cards[k].getAttribute("data-cat");
      /* SCORED, NOT FIRST-COME. This used to skip any category that already
         had a picture, which was harmless only while an unrecognised product
         scored zero and never set one: the first card to set PICS won outright
         and everything behind it was never looked at. The moment a last-resort
         floor exists, that guard locks the floor in -- a shake appended before
         a flower kept the chip, which is precisely the curation this block is
         for. The comparison below already keeps the best, so let every card be
         scored and let the score decide. */
      if (!c2) continue;
      /* The engine renders a .ph placeholder instead of an <img> where a product
         has no photo, so an img[src] here is a picture that loaded or is about to. */
      var img = cards[k].querySelector("img[src]");
      var src = img && img.getAttribute("src");
      if (!src) continue;
      var nm = cards[k].querySelector(".cname");
      var sp = cards[k].querySelector(".storepill");
      var sc2 = scoreFor(c2, String((nm && nm.textContent) || ""),
                         String((sp && sp.textContent) || "").trim());
      if (sc2 > 0 && sc2 > (SCORE[c2] || 0)) { SCORE[c2] = sc2; PICS[c2] = src; }
    }
  }

  /* A SHELF ORDER, NOT A COUNT ORDER. The number printed on a chip is the
     engine's own facet count, which is what keeps it honest -- and that number
     moves every time another filter moves, so sorting on it would make the chips
     jump sideways whenever somebody picked a shop. This order never moves, and it
     is the order a dispensary's own menu board uses. Anything this list has never
     heard of sorts after it, alphabetically, rather than being hidden. */
  /* GEAR SITS AFTER THE CONSUMABLES, in the order a headshop shelf reads:
     what you smoke out of, what you prepare with, what attaches to it, what you
     keep it in. Without these entries the eight gear buckets sorted
     ALPHABETICALLY after everything -- Bongs & Rigs, Grinders, Parts & Tools,
     Pipes, Rolling, Storage & Trays -- which is not a shelf, it is a filing
     cabinet. Accessories stays last of the gear because it is the catch-all. */
  var ORDER = ["THCA Flower", "Flower", "Pre-rolls", "Pre-Rolls", "Vape", "Vaporizers",
               "Concentrate", "Concentrates", "Edibles", "Drinks", "Topicals",
               "Trim/Shake", "CBD", "Seeds & Clones",
               "Bongs & Rigs", "Pipes", "Grinders", "Rolling", "Parts & Tools",
               "Storage & Trays", "Accessories", "Apparel", "Wholesale"];
  function rank(v){ var i = ORDER.indexOf(v); return i < 0 ? ORDER.length : i; }

  function chipFor(value, label, count){
    var on = sel.value === value;
    var t = monoTint(value);
    var pic = PICS[value] || "";
    /* THE WHITE PLATE IS THE POINT when there is a photograph: these are studio
       shots on white, so cover-fitting one edge to edge in a white circle is the
       same treatment the brand rail gives a maker's own product shot, and the
       two rails read as one set. The drawn mark keeps the tinted plate it was
       drawn FOR -- light-on-dark, invisible on white -- so the plate class
       follows the picture rather than being fixed.
       NO INLINE onerror, for the reason the store strip gives: this markup is a
       JS string inside a template literal inside an HTML attribute, and one lost
       backslash here has already turned a strip into a SyntaxError that took the
       page's other scripts with it. The handler is bound after render. */
    return '<button class="lchip' + (on ? " on" : "") + '" type="button" data-logocat="' + esc(value) + '" ' +
      'aria-pressed="' + on + '" title="' + esc(label) + '">' +
      '<span class="limg' + (pic ? " photo" : " mono cat") + '" ' +
        'style="--mono-a:' + t.a + ';--mono-b:' + t.b + '">' +
        (pic
          ? '<img class="bimg" alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(pic) + '">'
          : '<img class="cimg" alt="" loading="lazy" src="' + esc(iconFor(value)) + '">') +
      '</span>' +
      '<span class="lname">' + esc(label) + '</span>' +
      (count ? '<span class="lcount">' + esc(count) + '</span>' : "") +
      '</button>';
  }

  var box = document.getElementById("catLogos");
  var note = document.getElementById("catNote");
  var clear = document.getElementById("clearCats");
  var lastSig = "";

  function render(){
    learnPics();
    var list = [];
    var opts = sel.querySelectorAll("option");   // querySelectorAll, not .options: the engine nests these in optgroups
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i], v = o.value;
      if (!v) continue;                                   // the "All Categories" row
      if (v.indexOf("__") === 0) continue;                // the engine's group parents
      /* AN EMPTY CATEGORY IS NOT A CHOICE, and it is where "two pre-roll
         categories" came from. The engine seeds its own vocabulary and then
         unions the feed's distinct values, so a spelling the feed does not use
         survives as an option carrying ZERO products -- "Pre-rolls (0)" beside
         "Pre-Rolls (1314)". Clicking it empties the grid, which reads as a
         broken filter rather than as an empty bucket. Dropped here rather than
         renamed, because renaming would make the chip disagree with the select
         it is a face for. */
      if (/\(\s*0\s*\)\s*$/.test(String(o.textContent || "").replace(/\u00A0/g, " "))) continue;
      /* The engine bakes the count into the option text as "Name (12)", and
         indents every nested row with two non-breaking spaces -- both stripped
         here. Backslashes are DOUBLED because this whole block is a template
         literal: a single \s reaches the page as a bare "s" and the count stays
         silently glued to the name. */
      var raw = String(o.textContent || "").trim();
      var m = raw.match(/^(.*?)\s*\((\d+)\)\s*$/);
      list.push({ v: v, label: m ? m[1] : raw, count: m ? m[2] : "" });
    }
    list.sort(function(a, b){ return rank(a.v) - rank(b.v) || a.label.localeCompare(b.label); });

    var out = [], lit = 0;
    for (var k = 0; k < list.length; k++) {
      if (sel.value === list[k].v) lit++;
      out.push(chipFor(list[k].v, list[k].label, list[k].count));
    }
    /* One category is not a choice, so the strip stays out of the way -- the same
       rule the store strip uses when a town has one shop. */
    section.hidden = list.length < 2;
    /* SAID WHERE THE PICTURES COME FROM, on the rail rather than in the footer.
       Every plate here is one shop's actual product, and beside a category name
       that could read as this page's pick for it. Short enough to survive a phone,
       which the long version did not: it wrapped to two lines and pushed the
       chips down. */
    if (note) note.textContent = list.length
      ? list.length + " categories - each picture is one product, not a pick"
      : "";
    if (clear) clear.hidden = !sel.value;
    var sig = out.join("") + "|" + sel.value;
    /* Same hole as the store strip's: an empty box matches its own signature. */
    if (sig !== lastSig || !box.firstChild) {
      box.innerHTML = out.join("");
      lastSig = sig;
    }
  }

  /* A DROPPED PHOTO FALLS BACK TO THE DRAWN MARK, plate and all. Removing the
     photo alone would leave a bare white circle, and putting the mark on that
     white circle would leave nothing visible -- these SVGs are light-on-dark.
     So the plate changes with it. Bound on the section in the capture phase,
     because an error event does not bubble. */
  section.addEventListener("error", function(e){
    var img = e.target;
    if (!img || !img.classList || !img.classList.contains("bimg")) return;
    var plate = img.parentNode, cat = "";
    var chip = img.closest ? img.closest("[data-logocat]") : null;
    if (chip) cat = chip.getAttribute("data-logocat") || "";
    img.remove();
    if (plate && plate.classList && plate.classList.contains("limg")) {
      plate.classList.remove("photo");
      plate.classList.add("mono", "cat");
      if (cat && !plate.querySelector(".cimg")) {
        var f = document.createElement("img");
        f.className = "cimg"; f.alt = ""; f.loading = "lazy"; f.src = iconFor(cat);
        plate.appendChild(f);
      }
    }
    /* And never offer that url again: the rail re-renders constantly and would
       otherwise re-request a picture that has already failed, once per render. */
    if (cat) { delete PICS[cat]; SCORE[cat] = 0; lastSig = ""; }
  }, true);

  function pick(value){
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    render();
  }

  /* Scoped to the section rather than the document: the arrows are already
     handled once for every rail in cw-carousel, and a second handler here would
     scroll twice per click. */
  section.addEventListener("click", function(e){
    var t = e.target;
    var el = t && t.closest ? t.closest("[data-logocat]") : null;
    if (el) {
      e.preventDefault();
      var k = el.getAttribute("data-logocat");
      pick(sel.value === k ? "" : k);       // clicking the lit chip clears it
      return;
    }
    if (t && t.closest && t.closest("#clearCats")) { e.preventDefault(); pick(""); }
  });

  var queued = false;
  function queue(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; render(); });
  }
  var mo = new MutationObserver(queue);
  /* The select, because the engine rewrites its options and their counts on every
     render -- and the GRID, because that is where the pictures are. A category
     whose products were below the first page, or filtered out, has no photo to
     learn until it renders; when it does, this repaints the chip rather than
     leaving the glyph up for the rest of the session. */
  mo.observe(sel, { childList: true, subtree: true, characterData: true });
  if (grid) mo.observe(grid, { childList: true });
  sel.addEventListener("change", render);

  render();
  var tries = 0;
  var iv = setInterval(function(){ render(); if (++tries > 40 || sel.options.length > 1) clearInterval(iv); }, 250);
})();


/* ========================================================================
   SHOP BY BRAND
   ======================================================================== */

/* SHOP BY BRAND, and the reason it exists is one line of the census:
   50 brands are carried at more than one shop in this town.

   Drip is the case that asked for it. Lume sells the 1g Drip cart at $7.00/g and
   Herbology sells the same maker's 1g cart at $7.50/g, and until the feed carried
   its brand field those two products had nothing in common a filter could see. Cross-shop
   brands lead the strip for exactly that reason, and each chip says how many
   shops carry it, because that count is what makes it worth clicking.

   THE SEARCH BOX IS THE SOURCE OF TRUTH, the same way #fStore is for the store
   strip. The engine has no brand control and its renderer is inside the base64
   blob (CLAUDE.md section 5), so rather than filter behind the engine's back and
   disagree with its own count, the chip types the brand into the engine's own #q
   and lets it filter. Clearing the box clears the chip. Everything stays the
   engine's arithmetic.

   Rebuilt on the feed arriving and on mutation, like the trim chip, because the
   grid re-renders on every filter and sort with no hook to attach to. */
(function(){
  var q = document.getElementById("q");
  var grid = document.getElementById("grid");
  if (!q || !grid || !grid.parentNode) return;

  var section = document.createElement("section");
  section.className = "logorow";
  section.id = "brandRow";
  section.hidden = true;
  section.innerHTML =
    '<div class="lrhead"><h2>Shop by brand</h2><small id="brandNote"></small>' +
      '<div class="lrctl">' +
        '<button class="lrclear" id="clearBrands" hidden>Show all</button>' +
      '</div></div>' +
    '<div class="lrwrap"><div class="lrscroll" id="brandLogos"></div></div>';
  grid.parentNode.insertBefore(section, grid);

  var esc = function(v){ return String(v == null ? "" : v).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); };

  function monoTint(key){
    var h = 0;
    String(key).split("").forEach(function(c){ h = (h * 31 + c.charCodeAt(0)) % 360; });
    return { a: "hsl(" + h + " 32% 30%)", b: "hsl(" + h + " 34% 17%)" };
  }
  function initials(name){
    var w = String(name).split(/\s+/).filter(Boolean);
    return ((w[0] || "").charAt(0) + (w[1] || "").charAt(0)).toUpperCase() || "?";
  }

  /* A SHOP'S OWN LABEL WEARS THE SHOP'S MARK.
   *
     Reported with a picture: the Grasscity chip on the store strip is right, the
     GC chip below it on the brand strip is a washed-out product shot, "and they
     should both be the store one". GC is Grasscity's house line -- 285 of its own
     products -- so the shop's mark is not merely a nicer picture, it is the
     correct one.

     STATED, NOT INFERRED, and the counter-case is why. Every heuristic that
     catches "GC" catches RAW as well: both are short, both are all-capitals, both
     sell at exactly one shop here. RAW is a real maker whose products this site
     compares, and giving it Grasscity's logo would be a confidently wrong picture
     -- the failure the category rail spent three reports learning to refuse. So
     this is a measured fact about one shop rather than a rule about names, and it
     costs one line per house label anybody actually identifies.

     NOT isStoreBrand(). That function REFUSES a brand, because a shop's own name
     on the brand rail redraws the store rail beside it. This is the other half:
     the label is genuinely a separate name, it earns its chip, and what was wrong
     was only the picture. Dropping GC would lose a working filter over 285
     products.

     The store must actually be one of the brand's own, so a future brand keyed
     "gc" at a different shop cannot inherit Grasscity's mark by name alone. */
  var HOUSE = { gc: "Grasscity" };

  function current(){ return String(q.value || "").trim().toLowerCase(); }

  /* THE OTHER TWO RAILS ARE THE FILTER, AND THIS ONE HAD TO BE TOLD.
   *
     Reported as "the brand strip is not faceted to the others, it isn't
     filtering or changing when I click on the other circles" -- exactly right,
     and it is a consequence of how the three differ. The store and category
     strips are FACES for controls the engine owns (#fStore, #fCategory), so
     their chips and their counts are the engine's own and cannot drift. The
     engine has no brand control, so this rail is built from the feed instead --
     and a rail built from the whole feed says the same thing under every filter.

     So it reads those two selects and answers for the slice they describe: a
     maker with nothing at the chosen shop leaves the rail, and the number on a
     chip is that maker's count WITHIN the selection rather than across the
     catalogue. Counts come from tallies feed-meta.js keeps for each case
     separately -- shop, category, and the pair -- so none of them is estimated.

     THE CATEGORY KEY IS THE ONE TO WATCH, and the caveat is the same one
     catPool carries: #fCategory offers the ENGINE's vocabulary, which is its own
     normCategory over the feed's, plus four sub-tags pushed in as if they were
     categories. feed-meta.js tallies the feed's word and those four, so the
     overlap is exact where the two agree and a category only the engine names
     finds nothing -- which shows as a rail that does not narrow, never as a
     wrong number. */
  function facets(){
    var st = document.getElementById("fStore"), ct = document.getElementById("fCategory");
    return { store: st ? String(st.value || "") : "", cat: ct ? String(ct.value || "") : "" };
  }

  /* THE TWO VOCABULARIES, LEARNED RATHER THAN TWINNED.
   *
     The tallies are keyed on the word the FEED states; #fCategory carries the
     word the ENGINE states, after its own normCategory. On this shelf the two
     agree by construction, and on a city page they genuinely do not: the feed
     says "Flower", "Vaporizers", "Pre-Rolls" and the engine files those same
     rows under "THCA Flower", "Concentrate" and "Pre-rolls". That mismatch has
     already cost this rail's neighbour a silent failure -- a picture map built
     from the feed's words missed every lookup and threw nothing.

     Copying normCategory here would be a third statement of a rule that lives
     inside the blob. So the translation is READ OFF THE RENDERED CARDS instead,
     where data-pid and data-cat sit in the same element and cannot disagree:
     the id gives the feed's word through catOf, the attribute gives the
     engine's. A handful of cards fills the table, it is cumulative across every
     re-render, and it is right by observation rather than by assumption.

     ONE ENGINE WORD CAN COVER SEVERAL FEED WORDS -- "Concentrate" takes both
     the feed's concentrates and its vape carts -- so this maps to a LIST and
     within() sums them. Unlearned means unfiltered: a category never yet seen
     leaves the rail alone rather than emptying it, which is the safe direction. */
  var ALIAS = {};
  function learnCats(){
    var m = window.LL_railsMeta(), byId = m.catOf;
    if (!byId) return;
    var cards = document.querySelectorAll("#grid .card[data-pid][data-cat]");
    for (var i = 0; i < cards.length; i++) {
      var eng = cards[i].getAttribute("data-cat"), feed = byId[cards[i].getAttribute("data-pid")];
      if (!eng || !feed) continue;
      var l = ALIAS[eng] || (ALIAS[eng] = []);
      if (l.indexOf(feed) < 0) l.push(feed);
    }
  }
  function within(e, f){
    if (!f.cat) return f.store ? (e.perStore || {})[f.store] || 0 : e.n;
    /* The engine's own word first: on this shelf it IS the feed's word, so the
       lookup succeeds before the alias table is ever consulted. */
    var words = (ALIAS[f.cat] || []).slice();
    if (words.indexOf(f.cat) < 0) words.push(f.cat);
    var n = 0;
    for (var i = 0; i < words.length; i++) {
      n += f.store ? ((e.perPair || {})[f.store + "\u0000" + words[i]] || 0)
                   : ((e.perCat || {})[words[i]] || 0);
    }
    return n;
  }

  function render(){
    var meta = (window.LL_railsMeta().brands) || null;
    if (!meta) return;
    learnCats();
    var f = facets(), list = [];
    for (var k in meta) if (Object.prototype.hasOwnProperty.call(meta, k)) {
      var e = meta[k];
      if (!e || !e.disp) continue;
      /* A tally is only trustworthy where feed-meta.js kept one. An older
         publisher (a city page's cw-endpoint) carries no perStore, and there the
         rail behaves exactly as it did rather than filtering everything away. */
      var have = e.perStore || e.perCat;
      var n = have ? within(e, f) : e.n;
      if (have && (f.store || f.cat) && !n) continue;
      list.push({ key: k, disp: e.disp, n: n, stores: e.stores || [],
                  shops: (e.stores || []).length, img: e.img || "" });
    }
    /* AN UNANSWERABLE FACET LEAVES THE RAIL WIDE; AN ANSWER OF NONE HIDES IT.
       The first version of this guard conflated the two, on the reasoning that
       "a selection that genuinely matches nothing cannot reach this: the shopper
       could not have picked a shop the engine does not offer". That was wrong,
       and reported: "the store and brand currently are not faceting together at
       all". Only SIX of the sixteen shops carry any branded product -- the feed
       says so, brands.byStore -- so picking Puffy or Lookah or Hitoki erases
       every maker legitimately, the guard read that as "unanswered", and the
       rail came back showing all 155. Category looked fine throughout because
       every category has branded products in it.

       THE TWO CASES ARE TOLD APART BY WHETHER A TRANSLATION IS INVOLVED, which
       is the only thing that can make a zero untrustworthy:

       A STORE FACET IS NEVER TRANSLATED. perStore is keyed on exactly the string
       #fStore carries, so a zero there is a real zero and the rail hides -- which
       is the honest thing to show for a shop whose products carry no maker, and
       the same thing this rail already does for a feed with no makers at all.

       A CATEGORY FACET TRAVELS THROUGH ALIAS, learned from rendered cards, so
       there is a real window where it has no answer: the frame in which the
       selection changes before the grid repaints, and any category this session
       has never seen a card of. Only THAT gets the benefit of the doubt, and only
       while the word is genuinely unknown -- once anything knows it, a zero is an
       answer again. */
    var catKnown = !f.cat || (ALIAS[f.cat] && ALIAS[f.cat].length > 0);
    if (!catKnown) {
      for (var k3 in meta) if (Object.prototype.hasOwnProperty.call(meta, k3)) {
        var e3 = meta[k3];
        if (e3 && e3.perCat && e3.perCat[f.cat]) { catKnown = true; break; }
      }
    }
    if (!list.length && f.cat && !catKnown) {
      for (var k2 in meta) if (Object.prototype.hasOwnProperty.call(meta, k2)) {
        var e2 = meta[k2];
        if (e2 && e2.disp) list.push({ key: k2, disp: e2.disp, n: e2.n, stores: e2.stores || [],
                                       shops: (e2.stores || []).length, img: e2.img || "" });
      }
    }
    /* HIDING IS NOT THE SAME AS EMPTYING, and leaving the chips behind is how a
       hidden rail comes back wrong. The section used to hide with the previous
       shop's makers still in it, so anything that showed it again without a
       re-render -- a stylesheet, a future caller -- would display a rail for a
       shop that has none. Cleared here, where the decision is made. */
    if (!list.length) {
      var empty = document.getElementById("brandLogos");
      if (empty) empty.innerHTML = "";
      section.hidden = true;
      return;
    }
    /* Most shops first, then most products. A one-shop brand is a label; a
       four-shop brand is the comparison this page is for. */
    list.sort(function(a, b){ return b.shops - a.shops || b.n - a.n || a.disp.localeCompare(b.disp); });

    var cur = current(), lit = 0, html = "";
    for (var i = 0; i < list.length; i++) {
      var b = list[i], on = cur && b.disp.toLowerCase() === cur;
      if (on) lit++;
      var t = monoTint(b.key);
      /* The shop's own mark where this is the shop's own label, keyed on the same
         domain the store strip uses, so the two chips are the same picture rather
         than two pictures that happen to agree. */
      var houseShop = HOUSE[b.key];
      var pic = b.img, plate = "";
      if (houseShop && b.stores.indexOf(houseShop) >= 0) {
        var dom = "";
        try { dom = (window.LL_railsMeta().domains || {})[houseShop] || ""; } catch (e) {}
        if (dom) { pic = window.LL_railsFavicon(dom); plate = " photo"; }
      }
      /* The photo sits ON the tinted monogram plate rather than replacing it, so
         a picture that fails to load leaves the initials showing instead of a
         hole -- the same reason the store strip keeps its monogram fallback. */
      html += '<button class="lchip' + (on ? " on" : "") + '" type="button" data-brand="' + esc(b.disp) + '">' +
        '<span class="limg mono' + plate + '" style="background:linear-gradient(160deg,' + t.a + ',' + t.b + ')">' +
          esc(initials(b.disp)) +
          (pic ? '<img class="bimg" alt="" src="' + esc(pic) + '">' : "") +
        '</span>' +
        '<span class="lname">' + esc(b.disp) + '</span>' +
        '<span class="lcount">' + b.n + (b.shops > 1 ? " &middot; " + b.shops + " shops" : "") + '</span>' +
      '</button>';
    }
    document.getElementById("brandLogos").innerHTML = html;
    var multi = list.filter(function(x){ return x.shops > 1; }).length;
    /* SAID WHERE THE MARKS ARE, not only in the footer. This rail shows makers'
       names beside their own product photography, which is the one place on the
       page a reader could reasonably infer a relationship that does not exist.
       A disclaimer a thousand pixels below the thing it disclaims is a disclaimer
       nobody reads. */
    /* ONE TOWN IS A DEMO; THE ASK IS HOW IT BECOMES A MAP. Placed on the rail
       rather than buried in the footer, because the person most likely to run
       their own town is the one already scrolling shop logos. */
    /* ONLY ON A CITY PAGE. window.LL_TOWN is set by the generator, so this rail
       recruits an ambassador where "your town" means something and stays quiet
       on the national hemp shelf, where it would be addressed to nobody.
       Deliberately NOT read from localStorage's ll_cw:ctx: that record survives
       the visit, so legal-leafmarket would inherit whichever town was browsed
       last and print the note anyway -- a bug that would only appear for people
       who had already used a city page, which is the worst kind. */
    var amb = window.LL_TOWN ? document.getElementById("cwl-amb") : null;
    if (!amb && window.LL_TOWN) {
      amb = document.createElement("div");
      amb.id = "cwl-amb";
      amb.style.cssText = "margin:6px 0 2px;font-size:12.5px;color:var(--dim,#8fa6b3)";
      amb.innerHTML = 'Your town not here? <a href="/ambassador" style="color:var(--gold,#d8b25a)">Bring it on</a> ' +
        '- every town on this site has somebody local keeping it honest.';
      section.appendChild(amb);
    }
    document.getElementById("brandNote").textContent =
      list.length + " brands" + (multi ? ", " + multi + " sold at more than one shop" : "") +
      " - names and images belong to their owners; no affiliation or endorsement";
    document.getElementById("clearBrands").hidden = !lit;
    section.hidden = false;
  }

  /* Bound after render rather than inlined: an inline handler in a generated
     string has already cost this file a SyntaxError that took the page's other
     scripts down with it. */
  /* Bound after render, never inlined as onerror="...": an inline handler in a
     generated string cost this file a SyntaxError once that took the page's
     other scripts down with it. A dropped photo just uncovers the monogram. */
  section.addEventListener("error", function(e){
    var img = e.target;
    if (img && img.classList && img.classList.contains("bimg")) img.remove();
  }, true);

  section.addEventListener("click", function(e){
    var chip = e.target && e.target.closest && e.target.closest(".lchip");
    if (chip) {
      var name = chip.getAttribute("data-brand") || "";
      q.value = (current() === name.toLowerCase()) ? "" : name;
      try { q.dispatchEvent(new Event("input", { bubbles: true })); } catch (err) {}
      render();
      return;
    }
    if (e.target && e.target.id === "clearBrands") {
      q.value = "";
      try { q.dispatchEvent(new Event("input", { bubbles: true })); } catch (err) {}
      render();
    }
  });

  q.addEventListener("input", render);
  document.addEventListener("ll-meta", render);
  /* THE TWO SELECTS DIRECTLY, not only the grid they redraw. A facet change does
     re-render the grid and would reach this through the observer below, but one
     frame later and only if the grid's child list actually changed -- picking a
     shop that happens to leave the same cards on screen would move the other two
     rails and leave this one stale, which is the report in miniature. */
  ["fStore", "fCategory"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("change", render);
  });
  var mo = new MutationObserver(function(){ render(); });
  try { mo.observe(grid, { childList: true }); } catch (e) {}
  render();
})();

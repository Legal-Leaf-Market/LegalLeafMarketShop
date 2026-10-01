/* public/js/photo-view.js -- open the picture, full screen, and get back out.
 *
 * "A very, very, very key feature", and until now it existed only on generated
 * city pages: two blocks inside tools/make-coldwater.mjs that public/index.html
 * -- the file that generator READS -- could not use. Same story as the three
 * rails, same fix, and for the same reason: nothing in either block was ever
 * city-specific. The expand control and the viewer move together because they
 * are one feature; splitting them would leave a button on the hemp page with
 * nothing behind it.
 *
 * ON A GRID CARD THE PHOTO IS NOT THE OPENER, THE BUTTON IS. Opening the viewer
 * on any click of the picture steals the card's own flip -- tapping a photo is
 * how a shopper reads the details, and it was enlarging instead. So the picture
 * keeps its flip and .cw-expand opens the viewer, the same bargain a video
 * player makes with its fullscreen corner. Everywhere else -- the drawer, the
 * COA modal -- there is no flip to protect and the picture is still the opener.
 *
 * THREE WAYS OUT, because a photo you can open and not close is worse than one
 * you cannot open: Escape, the backdrop, and the phone's back button.
 */


/* ========================================================================
   THE EXPAND CONTROL -- the affordance the picture cannot be
   ======================================================================== */

/* One button per card photo, added after the engine renders and re-added when
   it re-renders -- the grid is rebuilt on every filter and sort, which is why
   nothing here is done once. */
(function(){
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"/></svg>';

  function paint(){
    var imgs = document.querySelectorAll("#grid .card .cimg");
    for (var i = 0; i < imgs.length; i++) {
      var holder = imgs[i];
      if (holder.querySelector(".cw-expand")) continue;
      /* Nothing to enlarge on a card the engine drew a placeholder for. */
      if (!holder.querySelector("img[src]")) continue;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cw-expand";
      b.setAttribute("aria-label", "Expand photo to full view");
      b.title = "Expand to full view";
      b.innerHTML = SVG;
      holder.appendChild(b);
    }
  }

  var queued = false;
  function schedule(){
    if (queued) return;
    queued = true;
    requestAnimationFrame(function(){ queued = false; paint(); });
  }
  var g = document.getElementById("grid");
  if (g && window.MutationObserver) new MutationObserver(schedule).observe(g, { childList: true, subtree: true });
  schedule();
})();


/* ========================================================================
   THE VIEWER -- hi-res where the CDN offers one, zoom, and Escape
   ======================================================================== */

(function(){
  var ov, wrap, pic, cap, open = false, lastFocus = null;

  function build(){
    if (ov) return;
    ov = document.createElement("div");
    ov.id = "cwZoom";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Product photo");
    ov.innerHTML = '<button id="cwZoomX" type="button" aria-label="Close photo">&#215;</button>' +
      '<div id="cwZoomWrap"><img alt=""></div><div id="cwZoomCap"></div>';
    document.body.appendChild(ov);
    wrap = ov.querySelector("#cwZoomWrap");
    pic = ov.querySelector("img");
    cap = ov.querySelector("#cwZoomCap");
    /* Click the picture to zoom, anywhere else to close. Two behaviours on one
       surface, so the picture stops its own click from reaching the backdrop --
       but "the picture" is where it is painted, not where its element reaches
       (hitsPicture below). */
    pic.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!hitsPicture(e)) { close(); return; }
      pic.classList.toggle("zoomed");
    });
    /* The cap needs the file's real dimensions, which only exist once it has
       decoded -- and a cached image can finish before this listener is bound. */
    pic.addEventListener("load", capToNatural);
    if (pic.complete && pic.naturalWidth) capToNatural();
    ov.addEventListener("click", close);
    ov.querySelector("#cwZoomX").addEventListener("click", function (e) { e.stopPropagation(); close(); });
  }

  /* ASK THE CDN FOR A BIGGER ORIGINAL BEFORE UPSCALING A SMALL ONE.
     The grid needs a thumbnail and the menus serve exactly that, so the src on
     the card is often 200-400px wide -- stretched to fill a viewport it is
     mush. Every CDN these shops use takes the size in the URL, so the honest
     fix is to ask for the master rather than to interpolate. If the guess is
     wrong the request 404s or serves something odd, so the element falls back
     to the exact URL the card was already displaying: worst case is what we
     had before, never a broken picture. */
  function hiRes(src){
    try {
      var u = new URL(src, location.href);
      var big = false;
      /* imgix-family hosts (Dutchie, Big Cartel, most Shopify apps): w/h are
         query parameters and the master is served at whatever is asked for. */
      ["w", "width", "maxwidth", "max-w"].forEach(function(p){
        if (u.searchParams.has(p) && Number(u.searchParams.get(p)) < 1600) { u.searchParams.set(p, "1600"); big = true; }
      });
      if (big) { ["h", "height"].forEach(function(p){ u.searchParams.delete(p); }); return u.toString(); }
      /* Shopify names its derivatives in the filename: foo_200x200.jpg is a
         resize of foo.jpg, which is the original. */
      var path = u.pathname.replace(/_\d+x\d*(_crop_[a-z]+)?(?=\.(jpe?g|png|webp|gif)$)/i, "");
      if (path !== u.pathname) { u.pathname = path; return u.toString(); }
    } catch (e) {}
    return src;
  }

  /* THE BACKDROP HAD A DEAD ZONE, AND IT WAS MOST OF THE SCREEN. The rule above
     is "click the picture to zoom, anywhere else to close", but the element and
     the picture are not the same rectangle: width/height 100% makes the <img>
     span the whole viewer so a thumbnail can fill it, and object-fit:contain
     then paints the photo in the middle of that box and leaves the rest empty.
     Those empty margins still belong to the <img>, so a click on what plainly
     reads as backdrop hit the image and enlarged it instead of closing -- 188px
     down each side for a square photo in a 1280x1000 window, and a phone gets
     the same band across the top and bottom. Measuring where the picture is
     actually painted is what makes "anywhere else" mean what it says.
     getBoundingClientRect() already carries the .zoomed transform, so the same
     arithmetic holds zoomed in and out; a file whose dimensions have not
     decoded yet keeps the old behaviour rather than closing on a guess. */
  function hitsPicture(e){
    /* A CLICK WITHOUT A POINTER HAS NO COORDINATES. Keyboard activation and any
       programmatic .click() arrive with clientX/clientY at 0,0 and detail 0 --
       read geometrically that is the top-left corner, which is backdrop, so the
       viewer would close on a keystroke that means "zoom". Only a click that
       actually came from a pointer has a place on the screen worth measuring. */
    if (!e.detail) return true;
    var nw = pic.naturalWidth || 0, nh = pic.naturalHeight || 0;
    if (!nw || !nh) return true;
    var r = pic.getBoundingClientRect();
    if (!r.width || !r.height) return true;
    var scale = Math.min(r.width / nw, r.height / nh);
    var pw = nw * scale, ph = nh * scale;
    var px = r.left + (r.width - pw) / 2, py = r.top + (r.height - ph) / 2;
    return e.clientX >= px && e.clientX <= px + pw && e.clientY >= py && e.clientY <= py + ph;
  }

  /* BIG IS NOT THE SAME AS BIGGER. width/height 100% fixed the opposite fault --
     a 240px thumbnail opening at 240px, smaller than the card that launched it
     -- but with nothing capping it the same thumbnail then stretched across a
     1600px box and came out as mush: "the photos are maybe a little too blown
     up ... they're granulated now". hiRes() asks the CDN for a master first and
     usually gets one; when it does not, the picture is allowed to grow to twice
     its own pixels and no further. Two is the point where a good phone screen
     stops showing you the interpolation, and it still comfortably beats the
     card. Recomputed per image, because it depends on the file rather than on
     the layout. */
  function capToNatural(){
    var nw = pic.naturalWidth || 0, nh = pic.naturalHeight || 0;
    if (!nw || !nh) { pic.style.maxWidth = ""; pic.style.maxHeight = ""; return; }
    pic.style.maxWidth = (nw * 2) + "px";
    pic.style.maxHeight = (nh * 2) + "px";
  }

  function show(src, label){
    build();
    var want = hiRes(src);
    pic.onerror = want === src ? null : function(){ pic.onerror = null; pic.src = src; };
    pic.style.maxWidth = ""; pic.style.maxHeight = "";
    pic.src = want;
    pic.alt = label || "Product photo";
    pic.classList.remove("zoomed");
    cap.textContent = label || "";
    ov.classList.add("on");
    open = true;
    lastFocus = document.activeElement;
    /* The page behind must not scroll: on a phone a flick meant for the photo
       otherwise scrolls the grid underneath and the overlay comes back over a
       different part of the shelf. */
    document.documentElement.style.overflow = "hidden";
    try { ov.querySelector("#cwZoomX").focus(); } catch (e) {}
  }

  function close(){
    if (!ov) return;
    ov.classList.remove("on");
    open = false;
    document.documentElement.style.overflow = "";
    /* Dropped rather than left loaded: a full-size photo held in an offscreen
       node is real memory on a phone, and the next open sets it again. */
    pic.removeAttribute("src");
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {}
  }

  /* CAPTURE PHASE, because the card has its own click handler inside the engine
     and it opens the drawer. Tapping the PHOTO should enlarge the photo; tapping
     anything else on the card should still do what it always did. */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (ov && ov.contains(t)) return;                       // our own overlay

    /* ON A GRID CARD THE PHOTO IS NOT THE OPENER, THE BUTTON IS. Opening on any
       click of the picture stole the card's own flip -- tapping a photo is how
       a shopper reads the details, and it was enlarging instead. So the picture
       keeps its flip and .cw-expand opens the viewer, the same bargain a video
       player makes with its fullscreen corner.
       Everywhere else -- the drawer, the COA modal -- there is no flip to
       protect and the picture itself is still the opener. */
    var expand = t.closest(".cw-expand");
    var inCard = t.closest("#grid .card");
    if (inCard && !expand) return;
    if (!inCard && t.tagName !== "IMG") return;

    var host = expand ? inCard : t.closest("#grid .card, #drawer, .drawer, #cart, .ggmodal, #coaModal");
    if (!host) return;
    var t2 = expand ? host.querySelector(".cimg img[src], img[src]") : t;
    if (!t2) return;
    t = t2;
    var src = t.currentSrc || t.getAttribute("src") || "";
    if (!src || src.indexOf("data:") === 0) return;         // a placeholder is not a photo
    var card = t.closest("#grid .card");
    var label = "";
    if (card) {
      var h = card.querySelector("h3, .name, .cname, [class*='name']");
      label = (h && h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    }
    e.preventDefault();
    e.stopPropagation();
    show(src, label);
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  /* A photo you can open and not close is worse than one you cannot open, and
     the back button is what a phone reaches for first. */
  window.addEventListener("popstate", function () { if (open) close(); });

  /* THE AFFORDANCE. Nothing on a card said the picture does anything, so
     nobody would try it. */
  var st = document.createElement("style");
  st.textContent = "#grid .card img{cursor:zoom-in}";
  document.head.appendChild(st);
})();

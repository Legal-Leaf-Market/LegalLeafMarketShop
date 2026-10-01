/* ============================================================
   install.js — the home-screen install hint
   ------------------------------------------------------------
   THERE IS NO APP STORE ROUTE FOR THIS CATALOGUE. Apple's App Review
   guideline 1.4.3 bars apps that facilitate the sale of controlled
   substances, and Google Play's Restricted Content policy does the same
   for marijuana and derived products. So the home-screen web app is not
   a fallback here, it is the shipping vehicle.

   ONE THING TO KNOW ABOUT iOS: every browser there runs WebKit because
   Apple requires it, and "Add to Home Screen" is a system share-sheet
   extension rather than anything the browser owns. So on iOS the route is
   always "open Share, then Add to Home Screen" — the browsers differ ONLY
   in where they put the Share control. Chrome, for instance, puts it top
   right in the address bar, not in the bottom bar where Safari has it.

   Android is the opposite: the item lives in the browser's own menu and
   the wording differs per browser ("Add to Home screen", "Add page to",
   "Add to phone"), so both the location AND the label are per-browser.

   Wrong instructions are worse than none — a shopper told to look in the
   bottom bar when the control is top right concludes the site is broken,
   not that the copy is stale.

   Capitalisation is deliberate and matches what is on screen: iOS says
   "Add to Home Screen", Android Chrome says "Add to Home screen".

   This file is additive (CLAUDE.md 5) — it touches nothing in the engine.
   ============================================================ */
window.LL_INSTALL = (function () {
  function ua() { return navigator.userAgent || ''; }

  /* iPadOS 13+ reports itself as a Mac, so the touch count is the only
     thing that catches an iPad — but that fallback is loose enough to
     swallow anything else claiming MacIntel with a touchscreen, so
     Android is ruled out FIRST. Without that guard an Android device
     could be handed iPhone instructions. */
  function isAndroid() { return /android/i.test(ua()); }
  function isIOS() {
    var u = ua();
    if (isAndroid()) return false;
    if (/iphone|ipod|ipad/i.test(u)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           navigator.standalone === true;
  }

  function detect() {
    var u = ua();

    if (isIOS()) {
      /* Order matters: Chrome/Edge/Firefox on iOS all also contain
         "Safari" and "AppleWebKit" in their UA, so the specific tokens
         have to be tested first or everyone looks like Safari. */
      if (/CriOS/i.test(u))  return { os:'ios', name:'Chrome',
        find:'the <b>Share</b> icon at the <b>top right</b>, in the address bar' };
      if (/EdgiOS/i.test(u)) return { os:'ios', name:'Edge',
        find:'the <b>&#8943;</b> menu in the <b>bottom bar</b>, then <b>Share</b>' };
      if (/FxiOS/i.test(u))  return { os:'ios', name:'Firefox',
        find:'the <b>&#8943;</b> menu at the <b>bottom right</b>, then <b>Share</b>' };
      return { os:'ios', name:'Safari',
        find:'the <b>Share</b> button in the <b>bottom bar</b>' };
    }

    if (isAndroid()) {
      if (/SamsungBrowser/i.test(u)) return { os:'android', name:'Samsung Internet',
        find:'the <b>&#9776;</b> menu at the <b>bottom right</b>', item:'Add page to &rarr; Home screen' };
      if (/EdgA/i.test(u))           return { os:'android', name:'Edge',
        find:'the <b>&#8943;</b> menu in the <b>bottom bar</b>', item:'Add to phone' };
      if (/Firefox/i.test(u))        return { os:'android', name:'Firefox',
        find:'the <b>&#8942;</b> menu at the <b>top right</b>', item:'Add to Home screen' };
      if (/OPR|Opera/i.test(u))      return { os:'android', name:'Opera',
        find:'the <b>Opera</b> menu', item:'Add to &rarr; Home screen' };
      return { os:'android', name:'Chrome',
        find:'the <b>&#8942;</b> menu at the <b>top right</b>', item:'Add to Home screen' };
    }

    return { os:'desktop', name:'', find:'', item:'' };
  }

  /* Returns ready-to-insert HTML. Kept as one sentence because an ordered
     list for two taps reads as more work than it is. */
  function steps() {
    var d = detect();
    if (d.os === 'ios') {
      return 'In <b>' + d.name + '</b>, tap ' + d.find +
             ', then choose <b>Add to Home Screen</b>.';
    }
    if (d.os === 'android') {
      return 'In <b>' + d.name + '</b>, tap ' + d.find +
             ', then choose <b>' + d.item + '</b>.';
    }
    return 'Open <b>legal-leafmarket.com</b> on your phone to install it.';
  }

  /* ---- the hint itself ----------------------------------------------
     Dismissal is remembered so it asks once, not on every visit. Shown
     only on a phone: a desktop visitor cannot add to a home screen, and
     an already-installed one is looking at the installed app. */
  var KEY = 'll_install_dismissed';
  var DEFERRED = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    /* Chrome fires this when the PWA is installable. Holding it lets us
       offer a real one-tap install instead of menu instructions. */
    e.preventDefault();
    DEFERRED = e;
    var b = document.getElementById('llInstGo');
    if (b) b.hidden = false;
  });

  function dismissed() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function dismiss() {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    var el = document.getElementById('llInstall');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function offer() {
    if (isStandalone() || dismissed()) return;
    var d = detect();
    if (d.os === 'desktop') return;
    if (document.getElementById('llInstall')) return;

    var box = document.createElement('div');
    box.id = 'llInstall';
    box.className = 'llinst';
    box.setAttribute('role', 'complementary');
    box.innerHTML =
      '<button class="llinst-x" id="llInstX" aria-label="Dismiss">&#xD7;</button>' +
      '<div class="llinst-ttl">Add Legal-Leaf to your home screen</div>' +
      '<div class="llinst-sub">' + steps() + '</div>' +
      '<button class="llinst-go" id="llInstGo" hidden>Install</button>';
    document.body.appendChild(box);

    document.getElementById('llInstX').onclick = dismiss;

    var go = document.getElementById('llInstGo');
    if (DEFERRED) go.hidden = false;
    go.onclick = function () {
      if (!DEFERRED) return;
      DEFERRED.prompt();
      DEFERRED.userChoice.then(function () { DEFERRED = null; dismiss(); });
    };
  }

  /* Held back until the page has settled — an install nag racing the
     first paint of the grid is the fastest way to get itself dismissed. */
  function arm() { setTimeout(offer, 12000); }
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm);

  return { detect: detect, steps: steps, isIOS: isIOS,
           isAndroid: isAndroid, isStandalone: isStandalone, offer: offer };
})();

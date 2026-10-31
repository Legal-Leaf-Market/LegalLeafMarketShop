/* public/js/age-gate.js -- the 21+ gate, shared by every page.
 *
 * WHY IT EXISTS, stated honestly. A "are you 21? [yes]" modal verifies nothing: everybody clicks yes.
 * It is an attestation and a compliance posture, not a control, and this file is not going to pretend
 * otherwise. The reason to have one is that hemp and THCa merchant affiliate agreements commonly
 * REQUIRE the publisher site to carry an age gate, and non-compliance is grounds for termination --
 * which here means losing the link, the commission and the store. terms.html has always said "you must
 * be 21 or over"; until now nothing on the site asked.
 *
 * PORTED FROM herballeafmarket.com rather than invented, so the family behaves the same way, with two
 * things deliberately changed. Both are described where they happen below.
 *
 * WHAT IT DOES NOT DO, on purpose:
 *   - It does not remove or blank the page content. The overlay sits on top and the markup stays in the
 *     DOM, so a crawler that does not run scripts still sees a full page. Gating by emptying the
 *     document is how sites quietly deindex themselves.
 *   - It does not ask for a date of birth. A DOB field implies verification we do not do, and collecting
 *     one would be collecting personal data for no benefit.
 *
 * WHERE VERIFICATION ACTUALLY HAPPENS, and why the fine print now says so. This site takes no orders and
 * holds no payment details, so it has nothing to verify anyone against; the merchant that ships the order
 * is the one that runs an age check and carries the obligation. The note used to read "we take your word
 * for it, we do not verify", which was true and left the obvious question hanging -- if nobody checks,
 * who does. It now answers it. Note this is a claim about the CHECKOUTS, not about this file: if a partner
 * ever ships without an age check at checkout, the sentence is wrong and it is the sentence that has to
 * change, not the gate.
 *
 * DIRECT SALES (planned, Oct 2026). The business is forming an LLC to sell accessories itself. The
 * sentence was reworded from "our partner stores do that at checkout" to "every order is age-verified
 * at checkout" so it stays true on both paths -- which makes it a REQUIREMENT on our own checkout the
 * day it exists: an ID/age check at payment and adult-signature delivery for age-restricted items
 * (see /shipping). Launching a checkout without one makes this line false.
 *
 * COLOURS are the market's cold blue, read off public/index.html's :root (--bg, --leaf, --text, --muted,
 * --dim). The gate was still painted leaf green from before the recolour, on every page. Literals rather
 * than var() because the gate mounts on pages that do not load tokens.css.
 *
 * NO JS, NO GATE -- and that is not the weakness it looks like. The entire deals grid is rendered by
 * script; a visitor with JavaScript off sees no products at all. So a script-based gate is exactly as
 * strong as the site itself, and adding markup to fifteen pages to fail closed would buy protection
 * only in a state where there is nothing to protect.
 */
(function () {
  'use strict';

  var KEY = 'll_age_ok';

  /* CRAWLERS PASS, and the list is deliberately narrow. herbal-leaf tests /bot|crawl|spider|.../i,
     which matches any user agent containing the letters "bot" anywhere -- broad enough to catch real
     browsers by accident. Named agents only here.
     Note this bypass is trivially spoofable: anyone can set their UA. That is acceptable BECAUSE the
     gate is an attestation, not a control -- someone willing to edit their user agent was always going
     to click "yes". It exists so Googlebot's rendered snapshot is the page and not an interstitial,
     which is an SEO concern rather than a compliance one. */
  var CRAWLERS = /(googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|applebot|google-inspection|chrome-lighthouse|pagespeed|gtmetrix|ahrefsbot|semrushbot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|embedly|pinterest|redditbot)/i;

  function passed() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode: gate returns next visit, fine */ }
  }

  if (passed()) return;
  if (CRAWLERS.test(navigator.userAgent || '')) return;

  /* Z-INDEX, and why this number. The page's own layers top out at 2,000,000,001 (the account modal)
     with one inline overlay at 2,147,483,000; the engine creates a variation picker at 2,147,483,647,
     which is max int32 and cannot be beaten. That picker only exists after a click on a card, which
     cannot happen while the gate is up, so one below it is the correct place: above everything
     persistent, and not in a fight it would lose with something unreachable. */
  var Z = 2147483646;

  var css = document.createElement('style');
  css.id = 'll-age-style';
  css.textContent = [
    'html.ll-gated,html.ll-gated body{overflow:hidden !important}',
    '#ll-age{position:fixed;inset:0;z-index:' + Z + ';display:flex;align-items:center;',
    '  justify-content:center;padding:22px;background:rgba(4,9,13,.94);',
    '  -webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px)}',
    '#ll-age .llg-card{max-width:440px;width:100%;padding:34px 30px;border-radius:16px;text-align:center;',
    '  background:#0d1820;border:1px solid rgba(78,201,255,.4);box-shadow:0 26px 70px rgba(0,0,0,.6);',
    '  font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#eaf2f6}',
    '#ll-age h2{margin:0 0 10px;font-size:1.55rem;line-height:1.2}',
    '#ll-age p{margin:0 0 22px;font-size:.95rem;line-height:1.5;color:#9fb4c2}',
    '#ll-age .llg-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}',
    '#ll-age button{cursor:pointer;font:inherit;font-weight:700;font-size:.95rem;padding:13px 22px;',
    '  border-radius:11px;border:1px solid rgba(255,255,255,.14);transition:filter .15s}',
    '#ll-age button:hover{filter:brightness(1.12)}',
    '#ll-age button:focus-visible{outline:2px solid #4ec9ff;outline-offset:2px}',
    '#ll-age .llg-yes{background:#4ec9ff;color:#04141f;border-color:transparent}',
    '#ll-age .llg-no{background:transparent;color:#9fb4c2}',
    '#ll-age .llg-fine{margin:18px 0 0;font-size:11.5px;color:#7d94a2}',
    '#ll-age .llg-fine a{color:#9fb4c2}'
  ].join('\n');

  var wrap = document.createElement('div');
  wrap.id = 'll-age';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'll-age-h');
  wrap.innerHTML =
    '<div class="llg-card">'
    + '<h2 id="ll-age-h">Are you 21 or over?</h2>'
    + '<p>Legal-Leaf Market lists smoking accessories and hemp-derived products for adults 21 and over.</p>'
    + '<div class="llg-btns">'
    + '<button type="button" class="llg-yes">Yes, I am 21+</button>'
    + '<button type="button" class="llg-no">No, I am under 21</button>'
    + '</div>'
    + '<p class="llg-fine">Answering yes is a confirmation, not a check — every order is age-verified at checkout. '
    + 'See <a href="/terms">Terms</a> and <a href="/privacy">Privacy</a>.</p>'
    + '</div>';

  function mount() {
    if (document.getElementById('ll-age')) return;
    document.documentElement.classList.add('ll-gated');
    (document.head || document.documentElement).appendChild(css);
    document.body.appendChild(wrap);

    var yes = wrap.querySelector('.llg-yes');
    var no = wrap.querySelector('.llg-no');

    yes.addEventListener('click', function () {
      remember();
      document.documentElement.classList.remove('ll-gated');
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });

    /* THE SECOND DELIBERATE CHANGE FROM herbal-leaf, which sends "Not yet" to google.com. Bouncing a
       visitor off the site is worse on both counts: it tells someone who mis-clicked that they are
       stuck, and it hands the traffic away. This replaces the card with a plain terminal message and
       stays up -- nothing is remembered, so a genuine mis-click is one reload away from the gate again,
       and there is no path into the site from here. */
    no.addEventListener('click', function () {
      wrap.innerHTML = '<div class="llg-card"><h2>Come back when you are 21.</h2>'
        + '<p>This site is for adults 21 and over, so there is nothing here for you today. '
        + 'Thanks for being straight with us.</p></div>';
    });

    /* FOCUS STAYS INSIDE. A gate that can be tabbed past is not a gate for anyone using a keyboard,
       and it is the same overlay for a screen reader either way. Escape is deliberately NOT wired to
       dismiss: the only ways out are answering it. */
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key !== 'Tab') return;
      var btns = wrap.querySelectorAll('button');
      if (!btns.length) { e.preventDefault(); return; }
      var first = btns[0], last = btns[btns.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener('focusin', function (e) {
      if (document.getElementById('ll-age') && !wrap.contains(e.target)) {
        var b = wrap.querySelector('button');
        if (b) b.focus();
      }
    });

    if (yes.focus) yes.focus();
  }

  /* Loaded without `defer` so this runs during parse, before the shopper sees the shelf. body may not
     exist yet at that point, hence the readyState branch rather than an unconditional appendChild. */
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();

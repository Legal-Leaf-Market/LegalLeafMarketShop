/* public/gob-promo.js -- G.O.B. Good Old Boys Cannabis, front and center on every page.
 *
 * Owner, 5 Nov 2026: "blast G.O.B. everywhere ... at the top of every page, floating, in your
 * face ... a banner, and a floating example of what it looks like, and the link to the Purple
 * Haze, the Lemon Cherry Gelato and the Strawberry Pie."
 *
 * TWO PIECES, ONE FILE:
 *   1. A banner as the first thing in <body>: logo, "our own brand", the three flavors as links,
 *      and the Founders Club button. It scrolls with the page so it never fights a sticky header.
 *   2. A floating card, bottom left, that cycles the three stained-glass medallions with each
 *      flavor's name and link. It follows the visitor down the page. The x shrinks it to a small
 *      medallion bubble (remembered for the visit), and the bubble opens it again. Never gone.
 *
 * WHERE IT RUNS.
 *   - legalleafmarket.shop: <script src="/gob-promo.js" defer></script> on /cafe and /shelf
 *     (every other page there redirects to the Shopify store).
 *   - shop.legalleafmarket.shop: ONE line in the header group's Custom Liquid section (the same
 *     section that already loads ll-cart.css, so it is on every page):
 *       <script src="https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@<commit>/public/gob-promo.js" defer></script>
 *     Pinned to a commit for the reason ll-shop.js gives (Netlify deploys were paused).
 *
 * IMAGES come from img/gob/ beside this script, worked out from the script's own src, so a
 * pinned jsDelivr src also pins the pictures and the apex copy uses the apex pictures.
 *
 * WHERE THE FLAVOR LINKS GO. The vapes sell IN PERSON ONLY, never on Shopify (owner's decision,
 * 5 Nov 2026, gob/HANDOFF_CHROME_GOB.md), so the three product pages are drafts and would 404.
 * Each flavor links to its own section of the G.O.B. lab results page, which is also where the
 * QR code on that flavor's wrap points. If the owner ever puts them on sale online, change the
 * three `href`s in FLAVORS and nothing else.
 *
 * COPY RULES (gob/HANDOFF_CHROME_GOB.md): flavor notes only. No effect claims, no lineages, no
 * THC numbers, no em dashes. 21+ is stated on the banner and on the card.
 */
(function () {
  'use strict';
  if (window.__gobPromo) return;
  window.__gobPromo = true;

  var SHOP = 'https://shop.legalleafmarket.shop';
  var FLAVORS = [
    { key: 'purple-haze', name: 'Purple Haze', notes: 'Lavender · Berry', tint: '#7b5aa6',
      href: SHOP + '/pages/gob-lab-results#purple-haze' },
    { key: 'lemon-cherry-gelato', name: 'Lemon Cherry Gelato', notes: 'Lemon · Cherry · Cream', tint: '#d9b23a',
      href: SHOP + '/pages/gob-lab-results#lemon-cherry-gelato' },
    { key: 'strawberry-pie', name: 'Strawberry Pie', notes: 'Strawberry · Vanilla', tint: '#c8463f',
      href: SHOP + '/pages/gob-lab-results#strawberry-pie' }
  ];
  var FOUNDERS = SHOP + '/collections/g-o-b-founders-club';
  var FIND_US = SHOP + '/pages/find-us';

  // Image folder: img/gob/ next to this script, wherever it was loaded from.
  var src = (document.currentScript && document.currentScript.src) || '';
  var base = src ? src.replace(/[^/]*$/, '') + 'img/gob/' : '/img/gob/';
  function img(f) { return base + f; }

  var css = [
    '.gobx{--g:#0f2a1d;--g2:#1d4630;--cu:#c9853f;--cu2:#e8b06b;--cr:#f3ead2;font-family:Georgia,"Times New Roman",serif;box-sizing:border-box}',
    '.gobx *{box-sizing:border-box}',
    /* banner */
    '#gob-bar{position:relative;z-index:50;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 18px;',
    'padding:12px 16px;background:linear-gradient(100deg,#0b2116 0%,var(--g2) 45%,#0b2116 100%);color:var(--cr);',
    'border-bottom:3px solid var(--cu);box-shadow:inset 0 -1px 0 rgba(255,255,255,.08);text-align:center;overflow:hidden}',
    '#gob-bar::before{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(232,176,107,.22) 50%,transparent 70%);',
    'background-size:250% 100%;animation:gobShine 6s linear infinite;pointer-events:none}',
    '#gob-bar>*{position:relative}',
    '#gob-bar .gl{height:44px;width:auto;display:block}',
    '#gob-bar .gt{display:flex;flex-direction:column;line-height:1.15;text-align:left}',
    '#gob-bar .gk{font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--cu2)}',
    '#gob-bar .gh{font-size:19px;font-weight:700;color:#fff}',
    '#gob-bar .gf{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}',
    '#gob-bar .gf a{display:flex;align-items:center;gap:7px;padding:4px 12px 4px 4px;border-radius:999px;text-decoration:none;',
    'color:var(--cr);background:rgba(0,0,0,.28);border:1px solid rgba(201,133,63,.55);font:600 14px/1.1 system-ui,sans-serif;transition:border-color .2s,background .2s}',
    '#gob-bar .gf a:hover,#gob-bar .gf a:focus-visible{border-color:var(--cu2);background:rgba(0,0,0,.45);color:#fff}',
    '#gob-bar .gf img{width:30px;height:30px;border-radius:50%;display:block}',
    '#gob-bar .gc{display:inline-block;padding:10px 18px;border-radius:999px;text-decoration:none;font:700 14px/1 system-ui,sans-serif;',
    'color:#1a120a;background:linear-gradient(180deg,var(--cu2),var(--cu));border:1px solid #f6d29c;box-shadow:0 2px 10px rgba(201,133,63,.45)}',
    '#gob-bar .gc:hover,#gob-bar .gc:focus-visible{filter:brightness(1.08);color:#000}',
    '#gob-bar .gs{width:100%;font:12px/1.3 system-ui,sans-serif;color:rgba(243,234,210,.78)}',
    '#gob-bar .gs a{color:var(--cu2)}',
    '#gob-bar a:focus-visible,#gob-float a:focus-visible,#gob-float button:focus-visible{outline:3px solid #fff;outline-offset:2px}',
    /* floating card */
    '#gob-float{position:fixed;left:16px;bottom:16px;z-index:2147483000;width:220px;color:var(--cr);',
    'background:radial-gradient(130% 90% at 50% 0,var(--g2),var(--g) 70%);border:2px solid var(--cu);border-radius:16px;',
    'padding:14px 14px 12px;box-shadow:0 14px 40px rgba(0,0,0,.45);text-align:center}',
    '#gob-float .fk{font:700 10px/1 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--cu2);margin:0 0 8px}',
    '#gob-float .fm{position:relative;display:block;width:150px;height:150px;margin:0 auto 8px}',
    '#gob-float .fm img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;opacity:0;transition:opacity .7s;',
    'filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))}',
    '#gob-float .fm img.on{opacity:1}',
    '#gob-float .fm{animation:gobBob 4s ease-in-out infinite}',
    '#gob-float .fn{display:block;font-size:18px;font-weight:700;color:#fff;text-decoration:none;line-height:1.2}',
    '#gob-float .fo{font:13px/1.3 system-ui,sans-serif;color:rgba(243,234,210,.85);margin:2px 0 8px}',
    '#gob-float .fd{display:flex;justify-content:center;gap:6px;margin:0 0 10px}',
    '#gob-float .fd button{width:10px;height:10px;padding:0;border-radius:50%;border:1px solid var(--cu2);background:transparent;cursor:pointer}',
    '#gob-float .fd button.on{background:var(--cu2)}',
    '#gob-float .fb{display:block;padding:9px 10px;border-radius:999px;text-decoration:none;font:700 13px/1 system-ui,sans-serif;',
    'color:#1a120a;background:linear-gradient(180deg,var(--cu2),var(--cu))}',
    '#gob-float .fs{font:11px/1.3 system-ui,sans-serif;color:rgba(243,234,210,.7);margin:8px 0 0}',
    '#gob-float .fx{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:1px solid rgba(201,133,63,.6);',
    'background:rgba(0,0,0,.35);color:var(--cr);font:700 15px/1 system-ui,sans-serif;cursor:pointer}',
    '#gob-float.min{width:auto;padding:0;border-radius:50%;background:none;border:0;box-shadow:none}',
    '#gob-float.min>*{display:none}',
    '#gob-float.min .fopen{display:block}',
    '#gob-float .fopen{display:none;width:68px;height:68px;padding:0;border-radius:50%;border:2px solid var(--cu);cursor:pointer;',
    'background:var(--g);box-shadow:0 8px 24px rgba(0,0,0,.45);animation:gobBob 4s ease-in-out infinite}',
    '#gob-float .fopen img{width:100%;height:100%;border-radius:50%;display:block}',
    '@keyframes gobBob{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-6px) rotate(2deg)}}',
    '@keyframes gobShine{0%{background-position:150% 0}100%{background-position:-150% 0}}',
    '@media (max-width:640px){#gob-bar .gt{text-align:center}#gob-bar .gl{height:36px}#gob-bar .gh{font-size:17px}',
    /* phone: a short strip along the bottom, not a tall card over the page */
    '#gob-float:not(.min){width:auto;left:10px;right:10px;bottom:10px;padding:8px 40px 8px 8px;display:grid;grid-template-columns:64px 1fr;',
    'column-gap:12px;align-items:center;text-align:left;border-radius:14px}',
    '#gob-float:not(.min) .fm{grid-row:1/5;width:64px;height:64px;margin:0}',
    '#gob-float .fk{margin:0 0 3px}#gob-float .fn{font-size:16px}#gob-float .fo{margin:0 0 6px}',
    '#gob-float .fd,#gob-float .fs{display:none}#gob-float .fb{display:inline-block;justify-self:start;padding:7px 12px}}',
    '@media (prefers-reduced-motion:reduce){#gob-bar::before,#gob-float .fm,#gob-float .fopen{animation:none}#gob-float .fm img{transition:none}}',
    '@media print{#gob-bar,#gob-float{display:none}}'
  ].join('');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mount() {
    if (document.getElementById('gob-bar')) return;
    var st = document.createElement('style');
    st.id = 'gob-promo-css';
    st.textContent = css;
    document.head.appendChild(st);

    // 1. The banner.
    var bar = document.createElement('aside');
    bar.id = 'gob-bar';
    bar.className = 'gobx';
    bar.setAttribute('aria-label', 'G.O.B. Good Old Boys Cannabis');
    bar.innerHTML =
      '<a href="' + FOUNDERS + '"><img class="gl" src="' + img('logo-gold-360.webp') + '" alt="G.O.B. Good Old Boys Cannabis" width="57" height="44"></a>' +
      '<div class="gt"><span class="gk">Our own brand is here</span><span class="gh">G.O.B. Good Old Boys Cannabis</span></div>' +
      '<nav class="gf" aria-label="G.O.B. flavors">' + FLAVORS.map(function (f) {
        return '<a href="' + f.href + '"><img src="' + img(f.key + '-medallion-240.webp') + '" alt="" width="30" height="30">' + esc(f.name) + '</a>';
      }).join('') + '</nav>' +
      '<a class="gc" href="' + FOUNDERS + '">Join the Founders Club</a>' +
      '<p class="gs">21+ only. 2 mL disposables, three flavors, sold in person. <a href="' + FIND_US + '">Find us</a>.</p>';
    document.body.insertBefore(bar, document.body.firstChild);

    // 2. The floating card.
    var fl = document.createElement('div');
    fl.id = 'gob-float';
    fl.className = 'gobx';
    fl.setAttribute('role', 'complementary');
    fl.setAttribute('aria-label', 'G.O.B. flavors');
    fl.innerHTML =
      '<button type="button" class="fx" aria-label="Shrink the G.O.B. card">&times;</button>' +
      '<p class="fk">New from G.O.B.</p>' +
      '<a class="fm" href="' + FLAVORS[0].href + '" tabindex="-1" aria-hidden="true">' + FLAVORS.map(function (f, i) {
        return '<img src="' + img(f.key + '-medallion-240.webp') + '" alt="" width="150" height="150"' + (i ? ' loading="lazy"' : ' class="on"') + '>';
      }).join('') + '</a>' +
      '<a class="fn" href="' + FLAVORS[0].href + '">' + esc(FLAVORS[0].name) + '</a>' +
      '<p class="fo">' + FLAVORS[0].notes + '</p>' +
      '<div class="fd">' + FLAVORS.map(function (f, i) {
        return '<button type="button" aria-label="Show ' + esc(f.name) + '"' + (i ? '' : ' class="on" aria-current="true"') + '></button>';
      }).join('') + '</div>' +
      '<a class="fb" href="' + FOUNDERS + '">Join the Founders Club</a>' +
      '<p class="fs">21+ only. Sold in person.</p>' +
      '<button type="button" class="fopen" aria-label="Open the G.O.B. card"><img src="' + img(FLAVORS[0].key + '-medallion-240.webp') + '" alt=""></button>';
    document.body.appendChild(fl);

    var pics = fl.querySelectorAll('.fm img'), dots = fl.querySelectorAll('.fd button');
    var name = fl.querySelector('.fn'), notes = fl.querySelector('.fo'), pic = fl.querySelector('.fm');
    var bubble = fl.querySelector('.fopen img');
    var at = 0, timer = null;
    function show(i) {
      at = (i + FLAVORS.length) % FLAVORS.length;
      var f = FLAVORS[at];
      for (var k = 0; k < pics.length; k++) {
        pics[k].className = k === at ? 'on' : '';
        dots[k].className = k === at ? 'on' : '';
        if (k === at) dots[k].setAttribute('aria-current', 'true'); else dots[k].removeAttribute('aria-current');
      }
      name.textContent = f.name; name.href = f.href; pic.href = f.href;
      notes.textContent = f.notes;
      bubble.src = img(f.key + '-medallion-240.webp');
    }
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function start() { if (!still && !timer) timer = setInterval(function () { show(at + 1); }, 4200); }
    function stop() { clearInterval(timer); timer = null; }
    for (var d = 0; d < dots.length; d++) (function (i) { dots[i].addEventListener('click', function () { stop(); show(i); }); })(d);
    fl.addEventListener('mouseenter', stop);
    fl.addEventListener('mouseleave', start);
    fl.addEventListener('focusin', stop);

    function setMin(on) {
      fl.classList.toggle('min', on);
      try { sessionStorage.setItem('gob_float_min', on ? '1' : ''); } catch (e) {}
    }
    fl.querySelector('.fx').addEventListener('click', function () { setMin(true); fl.querySelector('.fopen').focus(); });
    fl.querySelector('.fopen').addEventListener('click', function () { setMin(false); fl.querySelector('.fn').focus(); });
    try { if (sessionStorage.getItem('gob_float_min')) fl.classList.add('min'); } catch (e) {}
    start();
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();

/* public/ll-shop.js -- the homepage feed and the collection slicers on the Shopify storefront.
 *
 * WHERE IT RUNS. shop.legalleafmarket.shop, mounted by two-line Custom Liquid sections, the same
 * way shop-dispensary.js is (code lives HERE, versioned; the theme holds only the mount):
 *
 *   Homepage, under the Dispensary / Herbal Leaf / Nicotia cards:
 *     <div id="ll-feed"></div>
 *     <script src="https://legalleafmarket.shop/ll-shop.js" defer></script>
 *
 *   Collection template, above the main product grid:
 *     <div id="ll-slicer" data-collection="{{ collection.handle }}" data-title="{{ collection.title | escape }}"></div>
 *     <script src="https://legalleafmarket.shop/ll-shop.js" defer></script>
 *
 * WHAT IT READS. The storefront's own public /products.json (or /collections/<h>/products.json),
 * same origin, paged at 250. Price and stock are read live on every load, so the rules below are
 * enforced against today's catalogue, not a list typed once.
 *
 * THE FEED RULES (owner, 2 Nov 2026): a curated blend, like flipping an old magazine or a social
 * feed. Nothing over $250, and anything over $150 must be glass worth it (bong, rig, bubbler).
 * No bulk lots ("100 cigars for $1,000"). Sold-out items never show. Smoking blends, Herbal Leaf
 * teas, a few CBD things, grinders, jars and glass, mixed so no shelf takes over a screen.
 * PICKS is the hand-curated list (by product handle): those lead, the rules fill the rest.
 *
 * FAILS OPEN. If the catalogue cannot be read, the feed renders nothing and the collection page
 * keeps the theme's own grid (it is only hidden after the slicers have rendered).
 */
(function () {
  'use strict';
  if (window.__llShop) return;
  window.__llShop = 1;

  /* Hand picks, by Shopify product handle, in the order they should lead. Add Ada-style picks here. */
  var PICKS = [];

  var MAX_PRICE = 250;
  var GLASS_ONLY_OVER = 150;
  var FEED_SIZE = 60;

  /* ---------------- shared helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n).toFixed(2).replace(/\.00$/, ''); }
  function low(s) { return String(s || '').toLowerCase(); }
  function img(src, w) {
    if (!src) return '';
    return src + (src.indexOf('?') > -1 ? '&' : '?') + 'width=' + (w || 600);
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function fetchAll(base) {
    var out = [];
    function page(n) {
      return fetch(base + '?limit=250&page=' + n, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var list = (j && j.products) || [];
          out = out.concat(list);
          if (list.length === 250 && n < 12) return page(n + 1);
          return out;
        });
    }
    return page(1);
  }

  var LANES = [
    { k: 'glass', name: 'Glass', re: /\b(bong|water ?pipe|bubbler|beaker|rig|dab|recycler|percolator|hand ?pipe|spoon pipe|chillum|one ?hitter|steamroller|banger|carb cap|ash ?catcher|downstem|bowl piece|glass pipe)\b/ },
    { k: 'herbal', name: 'Herbal Leaf', re: /\b(herbal|smoking blend|blend|tea|botanical|mullein|damiana|lavender|chamomile|raspberry leaf|mugwort|blue lotus)\b/ },
    { k: 'cbd', name: 'CBD', re: /\b(cbd|cbg|cbn|hemp)\b/ },
    { k: 'storage', name: 'Jars & Stash', re: /\b(jar|apothecary|stash|container|canister|humidor|tin|storage|case|box)\b/ },
    { k: 'grinder', name: 'Grinders', re: /\b(grinder|crusher|mill)\b/ },
    { k: 'rolling', name: 'Rolling', re: /\b(paper|papers|cone|cones|rolling|roller|tray|tips|filter|wrap|wraps)\b/ },
    { k: 'vape', name: 'Vapes', re: /\b(vape|vaporizer|e-?rig|battery|510|cartridge|pod)\b/ },
    { k: 'nicotia', name: 'Nicotia', re: /\b(nicotine|pouch|pouches|snus|cigar|cigars|cigarillo|tobacco)\b/ },
    { k: 'gear', name: 'Gear', re: /./ }
  ];
  var LANE_NAME = {}; LANES.forEach(function (l) { LANE_NAME[l.k] = l.name; });

  function textOf(p) {
    return low([p.title, p.product_type, p.vendor, (p.tags || []).join(' ')].join(' '));
  }
  function laneOf(p) {
    var tags = (p.tags || []).map(low);
    if (tags.indexOf('nicotia') > -1) return 'nicotia';
    if (tags.indexOf('herbal-leaf') > -1) return /\bcbd|cbg\b/.test(textOf(p)) ? 'cbd' : 'herbal';
    var t = textOf(p);
    for (var i = 0; i < LANES.length; i++) if (LANES[i].re.test(t)) return LANES[i].k;
    return 'gear';
  }

  function norm(p) {
    var vs = (p.variants || []).map(function (v) {
      return {
        id: v.id, title: v.title, price: parseFloat(v.price), cmp: parseFloat(v.compare_at_price) || 0,
        ok: v.available !== false, o1: v.option1, o2: v.option2, o3: v.option3
      };
    }).filter(function (v) { return isFinite(v.price) && v.price > 0; });
    var live = vs.filter(function (v) { return v.ok; });
    var pick = (live.length ? live : vs).slice().sort(function (a, b) { return a.price - b.price; })[0];
    if (!pick) return null;
    var images = (p.images || []).map(function (i) { return i.src; });
    return {
      p: p, id: p.id, handle: p.handle, title: p.title, vendor: p.vendor || '', type: p.product_type || '',
      tags: (p.tags || []).map(low), lane: laneOf(p), vs: vs, v: pick, price: pick.price,
      sale: pick.cmp > pick.price, stock: live.length > 0, img: images[0] || '', img2: images[1] || '',
      text: textOf(p), created: Date.parse(p.published_at || p.created_at || '') || 0,
      options: (p.options || []).map(function (o) { return { name: o.name, pos: o.position, values: o.values }; })
    };
  }

  /* A bulk lot is a box of things priced as one: "100 Cigars", "Case of 24", "50 pack". */
  function isBulk(x) {
    var t = low(x.title + ' ' + x.v.title);
    var m = t.match(/\b(\d{2,4})\s*(?:-|\s)?(?:ct|count|pc|pcs|pack|pk|cigars?|sticks?|units?|jars?|tins?)\b/);
    if (m && parseInt(m[1], 10) >= 20) return true;
    return /\b(case of|box of \d{2,}|wholesale|bulk|master case|display box)\b/.test(t);
  }
  function feedEligible(x) {
    if (!x.stock || !x.img) return false;
    if (x.price > MAX_PRICE) return false;
    if (x.price > GLASS_ONLY_OVER && x.lane !== 'glass') return false;
    if (isBulk(x)) return false;
    if (/\b(gift ?card|shipping|insurance|deposit|test product)\b/.test(x.text)) return false;
    return true;
  }

  /* Things the owner called out as loved on the front page get a nudge, not a guarantee. */
  var LOVED = /\b(apothecary|glass jar|grinder|smoking blend|herbal blend|tea|cbd|ashtray|rolling tray|mullein|lavender)\b/;
  function score(x, seed) {
    var s = 0;
    if (LOVED.test(x.text)) s += 3;
    if (x.img2) s += 1;
    if (x.sale) s += 1;
    if (x.price >= 8 && x.price <= 80) s += 1;      /* the impulse band that makes a feed feel generous */
    if (x.lane === 'glass' && x.price > GLASS_ONLY_OVER) s += 1; /* the one big piece earns its slot */
    s += (hash(seed + ':' + x.handle) % 1000) / 1000 * 2.5; /* daily freshness, stable within a day */
    return s;
  }

  /* Magazine rhythm: no two neighbours from one shelf, lanes rotate, the weightiest lanes recur. */
  var RHYTHM = ['glass', 'herbal', 'storage', 'cbd', 'grinder', 'rolling', 'herbal', 'glass', 'nicotia', 'storage', 'gear', 'cbd', 'vape', 'rolling'];
  var LANE_CAP = { nicotia: 6, vape: 5, gear: 8 };
  function curate(items, seed) {
    var byHandle = {}; items.forEach(function (x) { byHandle[x.handle] = x; });
    var used = {}, out = [];
    PICKS.forEach(function (h) { var x = byHandle[h]; if (x && feedEligible(x) && !used[h]) { used[h] = 1; out.push(x); } });
    var buckets = {};
    items.filter(function (x) { return feedEligible(x) && !used[x.handle]; })
      .map(function (x) { return { x: x, s: score(x, seed) }; })
      .sort(function (a, b) { return b.s - a.s; })
      .forEach(function (r) { (buckets[r.x.lane] = buckets[r.x.lane] || []).push(r.x); });
    var taken = {}, i = 0, guard = 0;
    var start = hash(seed) % RHYTHM.length;
    while (out.length < FEED_SIZE && guard++ < FEED_SIZE * RHYTHM.length) {
      var lane = RHYTHM[(start + i++) % RHYTHM.length];
      var b = buckets[lane];
      if (!b || !b.length) continue;
      if ((taken[lane] || 0) >= (LANE_CAP[lane] || 99)) continue;
      if (out.length && out[out.length - 1].lane === lane) continue;
      out.push(b.shift()); taken[lane] = (taken[lane] || 0) + 1;
    }
    return out;
  }

  function addToCart(id, qty) {
    return fetch('/cart/add.js', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [].concat(id).map(function (v) { return { id: v, quantity: qty || 1 }; }) })
    }).then(function (r) { if (!r.ok) throw new Error('cart'); return r.json(); })
      .then(function () {
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        return fetch('/cart.js', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (c) {
          document.querySelectorAll('.cart-count-bubble span, [data-cart-count], .cart-count').forEach(function (el) {
            if (/^\d+$/.test(el.textContent.trim())) el.textContent = c.item_count;
          });
        }).catch(function () {});
      });
  }
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'll-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = msg; toastEl.classList.add('on');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }
  function bindCart(root) {
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]');
      if (!b) return;
      e.preventDefault();
      var ids = b.getAttribute('data-add').split(',');
      b.disabled = true; var was = b.textContent; b.textContent = 'Adding...';
      addToCart(ids).then(function () {
        b.textContent = 'Added'; toast('Added to your cart. <a href="/cart">View cart</a>');
      }).catch(function () {
        b.textContent = was; toast('Could not add that. Try the product page.');
      }).then(function () { setTimeout(function () { b.disabled = false; if (b.textContent === 'Added') b.textContent = was; }, 1600); });
    });
  }

  /* ---------------- styles ---------------- */
  var CSS = [
    '.ll-x{--bg:#0b0f17;--card:#141a26;--line:#263044;--ink:#f4f6fb;--muted:#9aa6bd;--accent:#4ec9ff;--a2:#8b5cf6;--gold:#f0b93c;',
    'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--bg);border-radius:18px;padding:22px 16px 36px;max-width:1400px;margin:24px auto;box-sizing:border-box}',
    '.ll-x *{box-sizing:border-box}',
    '.ll-x a{color:inherit}',
    '.ll-x .ll-kicker{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin:0 0 6px}',
    '.ll-x h2.ll-h{margin:0;font:800 clamp(26px,4vw,40px)/1.05 Georgia,"Times New Roman",serif;letter-spacing:-.01em}',
    '.ll-x .ll-sub{color:var(--muted);font-size:14px;margin:6px 0 0}',
    '.ll-x .ll-stories{display:flex;gap:14px;overflow-x:auto;padding:16px 2px 6px;scrollbar-width:none}',
    '.ll-x .ll-stories::-webkit-scrollbar{display:none}',
    '.ll-x .ll-story{all:unset;cursor:pointer;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px;width:76px;text-align:center}',
    '.ll-x .ll-story span.r{width:68px;height:68px;border-radius:50%;padding:3px;background:conic-gradient(var(--gold),var(--a2),var(--accent),var(--gold))}',
    '.ll-x .ll-story img,.ll-x .ll-story i{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid var(--bg);background:#fff}',
    '.ll-x .ll-story b{font-size:11px;font-weight:700;line-height:1.2}',
    '.ll-x .ll-story[aria-pressed="true"] b{color:var(--accent)}',
    '.ll-x .ll-story:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:8px}',
    '.ll-x .ll-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}',
    '.ll-x input[type=search],.ll-x select{background:#0f1520;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;min-height:40px}',
    '.ll-x input[type=search]{flex:1 1 200px;min-width:0}',
    '.ll-x input::placeholder{color:#7d89a0;opacity:1}',
    '.ll-x .ll-chips{display:flex;flex-wrap:wrap;gap:7px}',
    '.ll-x .ll-chip{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid var(--line);background:rgba(78,201,255,.06)}',
    '.ll-x .ll-chip small{opacity:.7;margin-left:4px}',
    '.ll-x .ll-chip[aria-pressed="true"]{background:linear-gradient(90deg,#1787c4,#22a8e8);border-color:transparent;color:#fff}',
    '.ll-x .ll-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.ll-x .ll-lab{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:14px 0 7px}',
    '.ll-x .ll-count{color:var(--muted);font-size:13px;margin:4px 0 12px}',
    /* masonry feed */
    '.ll-x .ll-cols{column-count:4;column-gap:14px}',
    '@media(max-width:1100px){.ll-x .ll-cols{column-count:3}}',
    '@media(max-width:760px){.ll-x .ll-cols{column-count:2;column-gap:10px}}',
    '.ll-x .ll-post{break-inside:avoid;display:block;margin:0 0 14px;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}',
    '.ll-x .ll-post .ph{position:relative;display:block;background:#fff}',
    '.ll-x .ll-post .ph img{display:block;width:100%;height:auto;aspect-ratio:var(--ar,1);object-fit:cover}',
    '.ll-x .ll-post .tag{position:absolute;left:8px;top:8px;background:rgba(11,15,23,.82);color:#fff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;border-radius:999px}',
    '.ll-x .ll-post .tag.sale{left:auto;right:8px;background:var(--gold);color:#1a1300}',
    '.ll-x .ll-post .bd{padding:10px 12px 12px}',
    '.ll-x .ll-post .t{display:block;font-size:14px;font-weight:700;line-height:1.3;text-decoration:none}',
    '.ll-x .ll-post .m{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}',
    '.ll-x .ll-post .pr{font-weight:800;font-size:15px}',
    '.ll-x .ll-post .pr s{color:var(--muted);font-weight:500;font-size:12px;margin-left:5px}',
    '.ll-x .ll-post .v{color:var(--muted);font-size:12px;margin-top:2px}',
    '.ll-x .ll-add{all:unset;cursor:pointer;font-size:12px;font-weight:700;padding:7px 11px;border-radius:999px;background:var(--ink);color:#0b0f17;white-space:nowrap}',
    '.ll-x .ll-add:disabled{opacity:.6;cursor:default}',
    '.ll-x .ll-add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.ll-x .ll-save{all:unset;cursor:pointer;position:absolute;right:8px;bottom:8px;width:32px;height:32px;border-radius:50%;background:rgba(11,15,23,.7);color:#fff;display:grid;place-items:center;font-size:16px}',
    '.ll-x .ll-save[aria-pressed="true"]{color:#ff6b8a}',
    /* cover + editorial cards */
    '.ll-x .ll-cover{display:grid;grid-template-columns:1.2fr 1fr;gap:0;background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;margin:6px 0 18px}',
    '@media(max-width:760px){.ll-x .ll-cover{grid-template-columns:1fr}}',
    '.ll-x .ll-cover img{display:block;width:100%;height:100%;max-height:440px;object-fit:cover;background:#fff}',
    '.ll-x .ll-cover .cb{padding:22px;display:flex;flex-direction:column;justify-content:center;gap:10px}',
    '.ll-x .ll-cover h3{margin:0;font:800 clamp(22px,3vw,32px)/1.1 Georgia,serif}',
    '.ll-x .ll-note{padding:16px;background:linear-gradient(160deg,#1b2440,#16122a);}',
    '.ll-x .ll-note h4{margin:0 0 6px;font:800 19px/1.15 Georgia,serif}',
    '.ll-x .ll-note p{margin:0 0 10px;color:#c9d2e3;font-size:13.5px;line-height:1.5}',
    '.ll-x .ll-note a.go{font-weight:700;font-size:13px;color:var(--accent);text-decoration:none}',
    '.ll-x .ll-set{padding:14px}',
    '.ll-x .ll-set .th{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}',
    '.ll-x .ll-set .th a{display:block;background:#fff;border-radius:10px;overflow:hidden}',
    '.ll-x .ll-set .th img{display:block;width:100%;aspect-ratio:1;object-fit:cover}',
    '.ll-x .ll-set ul{margin:0 0 10px;padding:0;list-style:none;font-size:12.5px;color:#c9d2e3}',
    '.ll-x .ll-set li{display:flex;justify-content:space-between;gap:8px;padding:2px 0}',
    '.ll-x .ll-end{text-align:center;padding:28px 10px 6px;color:var(--muted)}',
    '.ll-x .ll-end b{display:block;color:var(--ink);font:800 20px Georgia,serif;margin-bottom:4px}',
    '.ll-x .ll-more{all:unset;cursor:pointer;display:block;margin:10px auto 0;padding:11px 20px;border-radius:999px;border:1px solid var(--line);font-weight:700;font-size:14px}',
    '.ll-x .ll-empty{padding:30px;text-align:center;color:var(--muted)}',
    /* collection grid */
    '.ll-x .ll-brands{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}',
    '.ll-x .ll-brand{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-size:13px;font-weight:600;line-height:1.2}',
    '.ll-x .ll-brand img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff;flex:0 0 auto}',
    '.ll-x .ll-brand small{display:block;color:var(--muted);font-weight:500}',
    '.ll-x .ll-brand[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}',
    '.ll-x .ll-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}',
    '@media(max-width:560px){.ll-x .ll-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}',
    '.ll-x .ll-grid .ll-post{margin:0;display:flex;flex-direction:column}',
    '.ll-x .ll-grid .ll-post .ph img{aspect-ratio:1}',
    '.ll-x .ll-grid .ll-post .bd{flex:1;display:flex;flex-direction:column}',
    '.ll-x .ll-grid .ll-post .m{margin-top:auto;padding-top:8px}',
    '.ll-x .ll-grid .oos{color:var(--muted);font-size:12px;font-weight:700}',
    '.ll-x details.ll-more-f summary{cursor:pointer;color:var(--muted);font-size:13px;margin:10px 0}',
    '.ll-toast{position:fixed;left:50%;bottom:20px;transform:translate(-50%,40px);opacity:0;background:#141a26;color:#fff;border:1px solid #263044;padding:11px 16px;border-radius:12px;font:600 14px system-ui,sans-serif;z-index:99999;transition:.2s}',
    '.ll-toast.on{transform:translate(-50%,0);opacity:1}',
    '.ll-toast a{color:#4ec9ff;margin-left:6px}'
  ].join('');
  function injectCss() {
    if (document.getElementById('ll-shop-css')) return;
    var s = document.createElement('style'); s.id = 'll-shop-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  /* saved items, per device only */
  var SAVE_KEY = 'll_saved';
  function saved() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { return []; } }
  function toggleSave(h) {
    var s = saved(), i = s.indexOf(h);
    if (i > -1) s.splice(i, 1); else s.push(h);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
    return i < 0;
  }

  function postHTML(x, opts) {
    opts = opts || {};
    var ar = opts.ar || 1;
    var isSaved = saved().indexOf(x.handle) > -1;
    var multi = x.vs.length > 1;
    var cta = !x.stock ? '<span class="oos">Sold out</span>'
      : multi ? '<a class="ll-add" href="/products/' + esc(x.handle) + '">Options</a>'
      : '<button class="ll-add" type="button" data-add="' + x.v.id + '">Add</button>';
    return '<article class="ll-post">' +
      '<a class="ph" href="/products/' + esc(x.handle) + '" style="--ar:' + ar + '">' +
      '<img loading="lazy" decoding="async" src="' + esc(img(x.img, 600)) + '" alt="' + esc(x.title) + '">' +
      (opts.tag !== false ? '<span class="tag">' + esc(LANE_NAME[x.lane] || 'Gear') + '</span>' : '') +
      (x.sale ? '<span class="tag sale">Sale</span>' : '') +
      '</a>' +
      '<div class="bd" style="position:relative">' +
      '<a class="t" href="/products/' + esc(x.handle) + '">' + esc(x.title) + '</a>' +
      (x.vendor ? '<div class="v">' + esc(x.vendor) + '</div>' : '') +
      '<div class="m"><span class="pr">' + (multi ? 'From ' : '') + money(x.price) + (x.sale ? '<s>' + money(x.v.cmp) + '</s>' : '') + '</span>' + cta + '</div>' +
      '</div>' +
      '</article>';
  }

  /* ---------------- HOMEPAGE FEED ---------------- */
  var NOTES = [
    { k: 'Herbal Leaf', h: 'Meet the smoking blends', p: 'Herbal Leaf is our corner for botanical smoking blends and teas: mullein, damiana, lavender and friends, made by small makers.', href: '/collections/herbal-leaf-market', go: 'Browse Herbal Leaf' },
    { k: 'Dispensary', h: 'Flower, compared', p: 'The Dispensary lines up flower and more from partner shops side by side, so you can see the price per gram before you click through.', href: '/pages/dispensary', go: 'Open the Dispensary' },
    { k: 'Delivery', h: 'Free local delivery', p: 'We deliver free across South Central Indiana. We do not ship.', href: '/cart', go: 'View your cart' },
    { k: 'Nicotia', h: 'Pouches, cigars and more', p: 'Nicotia is the nicotine side of the shop, kept on its own shelf.', href: '/collections/nicotia-market', go: 'Browse Nicotia' }
  ];
  /* Sets: one thing from each of three shelves that belong together. */
  var SETS = [
    { h: 'The rolling session', lanes: ['rolling', 'grinder', 'herbal'] },
    { h: 'The stash shelf', lanes: ['storage', 'grinder', 'cbd'] },
    { h: 'Glass night', lanes: ['glass', 'storage', 'herbal'] }
  ];

  function feed(mount) {
    injectCss();
    mount.classList.add('ll-x');
    mount.innerHTML = '<p class="ll-empty">Loading the feed...</p>';
    fetchAll('/products.json').then(function (raw) {
      var all = raw.map(norm).filter(Boolean);
      var seed = new Date().toISOString().slice(0, 10);
      var list = curate(all, seed);
      if (!list.length) { mount.innerHTML = ''; mount.style.display = 'none'; return; }
      renderFeed(mount, list, all, seed);
    }).catch(function () { mount.innerHTML = ''; mount.style.display = 'none'; });
  }

  function renderFeed(mount, list, all, seed) {
    var st = { lane: '', q: '', price: '', sort: 'curated', savedOnly: false, shown: 24 };
    var lanesPresent = LANES.filter(function (l) { return list.some(function (x) { return x.lane === l.k; }); });
    var cover = list[0];

    var storyHTML = '<button class="ll-story" type="button" data-lane="" aria-pressed="true"><span class="r"><i style="background:linear-gradient(135deg,#f0b93c,#8b5cf6)"></i></span><b>All</b></button>' +
      lanesPresent.map(function (l) {
        var face = list.filter(function (x) { return x.lane === l.k; })[0];
        return '<button class="ll-story" type="button" data-lane="' + l.k + '" aria-pressed="false"><span class="r"><img alt="" src="' + esc(img(face.img, 160)) + '"></span><b>' + esc(l.name) + '</b></button>';
      }).join('') +
      '<button class="ll-story" type="button" data-lane="__saved" aria-pressed="false"><span class="r"><i style="background:#1b2440;display:grid;place-items:center;color:#ff6b8a;font-size:24px">&#9829;</i></span><b>Saved</b></button>';

    mount.innerHTML =
      '<p class="ll-kicker">The Feed &middot; ' + esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })) + '</p>' +
      '<h2 class="ll-h">Things worth a second look</h2>' +
      '<p class="ll-sub">A hand-mixed scroll of glass, jars, blends, CBD and gear. Fresh picks every day, all under $250.</p>' +
      '<div class="ll-stories" role="toolbar" aria-label="Shelves">' + storyHTML + '</div>' +
      '<div class="ll-bar">' +
      '<input type="search" placeholder="Search the feed" aria-label="Search the feed">' +
      '<select aria-label="Price" data-f="price"><option value="">Any price</option><option value="0-25">Under $25</option><option value="25-50">$25 to $50</option><option value="50-100">$50 to $100</option><option value="100-250">$100 to $250</option></select>' +
      '<select aria-label="Sort" data-f="sort"><option value="curated">Curated</option><option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select>' +
      '</div>' +
      '<div class="ll-body"></div>';

    var body = mount.querySelector('.ll-body');

    function filtered() {
      var sv = saved();
      var r = list.filter(function (x) {
        if (st.savedOnly && sv.indexOf(x.handle) < 0) return false;
        if (st.lane && x.lane !== st.lane) return false;
        if (st.price) { var b = st.price.split('-'); if (x.price < +b[0] || x.price > +b[1]) return false; }
        if (st.q) { var words = low(st.q).split(/\s+/).filter(Boolean); for (var i = 0; i < words.length; i++) if (x.text.indexOf(words[i]) < 0) return false; }
        return true;
      });
      if (st.sort === 'low') r.sort(function (a, b) { return a.price - b.price; });
      if (st.sort === 'high') r.sort(function (a, b) { return b.price - a.price; });
      if (st.sort === 'new') r.sort(function (a, b) { return b.created - a.created; });
      return r;
    }
    function untouched() { return !st.lane && !st.q && !st.price && st.sort === 'curated' && !st.savedOnly; }

    function setCard(def, pool) {
      var used = {}, picks = [];
      def.lanes.forEach(function (l) {
        var x = pool.filter(function (y) { return y.lane === l && y.vs.length === 1 && !used[y.handle]; })[0];
        if (x) { used[x.handle] = 1; picks.push(x); }
      });
      if (picks.length < 3) return '';
      var total = picks.reduce(function (s, x) { return s + x.price; }, 0);
      return '<article class="ll-post ll-set"><p class="ll-kicker" style="margin:0">Shop the set</p><h4 style="margin:2px 0 0;font:800 18px Georgia,serif">' + esc(def.h) + '</h4>' +
        '<div class="th">' + picks.map(function (x) { return '<a href="/products/' + esc(x.handle) + '"><img loading="lazy" alt="' + esc(x.title) + '" src="' + esc(img(x.img, 300)) + '"></a>'; }).join('') + '</div>' +
        '<ul>' + picks.map(function (x) { return '<li><span>' + esc(x.title) + '</span><b>' + money(x.price) + '</b></li>'; }).join('') + '</ul>' +
        '<button class="ll-add" type="button" data-add="' + picks.map(function (x) { return x.v.id; }).join(',') + '">Add all three, ' + money(total) + '</button></article>';
    }
    function noteCard(n) {
      return '<article class="ll-post ll-note"><p class="ll-kicker">' + esc(n.k) + '</p><h4>' + esc(n.h) + '</h4><p>' + esc(n.p) + '</p><a class="go" href="' + esc(n.href) + '">' + esc(n.go) + ' &rarr;</a></article>';
    }

    function paint() {
      var r = filtered();
      var plain = untouched();
      var html = '';
      if (plain && cover) {
        html += '<div class="ll-cover"><a href="/products/' + esc(cover.handle) + '"><img alt="' + esc(cover.title) + '" src="' + esc(img(cover.img, 1000)) + '"></a>' +
          '<div class="cb"><p class="ll-kicker" style="margin:0">Cover story &middot; ' + esc(LANE_NAME[cover.lane]) + '</p><h3>' + esc(cover.title) + '</h3>' +
          '<p class="ll-sub" style="margin:0">' + esc(cover.vendor) + '</p><div class="m" style="display:flex;gap:12px;align-items:center"><b style="font-size:20px">' + money(cover.price) + '</b>' +
          (cover.vs.length > 1 ? '<a class="ll-add" href="/products/' + esc(cover.handle) + '">See options</a>' : '<button class="ll-add" type="button" data-add="' + cover.v.id + '">Add to cart</button>') + '</div></div></div>';
        r = r.slice(1);
      }
      var shown = r.slice(0, st.shown);
      var parts = [], ni = 0, si = 0, ars = [1, 1.25, 1, 0.8, 1.25, 1];
      shown.forEach(function (x, i) {
        parts.push(postHTML(x, { ar: plain ? ars[i % ars.length] : 1 }));
        if (plain && i % 9 === 4 && ni < NOTES.length) parts.push(noteCard(NOTES[ni++]));
        if (plain && i % 9 === 8 && si < SETS.length) { var s = setCard(SETS[si++], list); if (s) parts.push(s); }
      });
      html += r.length ? '<div class="ll-cols">' + parts.join('') + '</div>'
        : '<p class="ll-empty">' + (st.savedOnly ? 'Nothing saved yet. Tap the heart on anything you like.' : 'Nothing matches that. Try another shelf.') + '</p>';
      if (r.length > st.shown) html += '<button class="ll-more" type="button">Keep scrolling (' + (r.length - st.shown) + ' more)</button>';
      else if (r.length) html += '<div class="ll-end"><b>You are all caught up</b>New picks land every day. <a href="/collections/all">Browse everything &rarr;</a></div>';
      body.innerHTML = html;
      body.querySelectorAll('.ll-post .ph').forEach(function (ph) {
        var h = (ph.getAttribute('href') || '').split('/').pop();
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'll-save'; b.setAttribute('data-save', h);
        b.setAttribute('aria-label', 'Save'); b.setAttribute('aria-pressed', saved().indexOf(h) > -1 ? 'true' : 'false');
        b.innerHTML = '&#9829;';
        ph.appendChild(b);
      });
    }

    mount.addEventListener('click', function (e) {
      var s = e.target.closest('.ll-story');
      if (s) {
        var lane = s.getAttribute('data-lane');
        st.savedOnly = lane === '__saved'; st.lane = st.savedOnly ? '' : lane; st.shown = 24;
        mount.querySelectorAll('.ll-story').forEach(function (b) { b.setAttribute('aria-pressed', b === s ? 'true' : 'false'); });
        paint(); return;
      }
      var sv = e.target.closest('[data-save]');
      if (sv) { e.preventDefault(); e.stopPropagation(); sv.setAttribute('aria-pressed', toggleSave(sv.getAttribute('data-save')) ? 'true' : 'false'); if (st.savedOnly) paint(); return; }
      if (e.target.closest('.ll-more')) { st.shown += 24; paint(); }
    });
    var t;
    mount.querySelector('input[type=search]').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.q = v.trim(); paint(); }, 200); });
    mount.querySelectorAll('select[data-f]').forEach(function (sel) { sel.addEventListener('change', function () { st[sel.getAttribute('data-f')] = sel.value; paint(); }); });
    bindCart(mount);
    paint();
  }

  /* ---------------- COLLECTION SLICERS ---------------- */
  var THEME_GRID = ['#ProductGridContainer', '#product-grid', '#main-collection-product-grid', '.collection .product-grid', '.collection-grid', '.product-grid-container', '[data-collection-grid]'];
  function hideThemeGrid(mount) {
    var hidden = 0;
    THEME_GRID.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (mount.contains(el) || el.contains(mount)) return;
        var sec = el.closest('.shopify-section') || el;
        if (sec.contains(mount)) sec = el;
        sec.style.display = 'none'; hidden++;
      });
    });
    document.querySelectorAll('facet-filters-form, .facets-container, .facets-vertical').forEach(function (el) {
      if (!mount.contains(el)) { var sec = el.closest('.shopify-section') || el; if (!sec.contains(mount)) sec.style.display = 'none'; }
    });
    return hidden;
  }

  function optKind(name) {
    var n = low(name);
    if (/strength|nicotine|\bmg\b|potency/.test(n)) return 'strength';
    if (/flavou?r|scent|taste/.test(n)) return 'flavor';
    return '';
  }

  function slicer(mount) {
    injectCss();
    mount.classList.add('ll-x');
    var handle = mount.getAttribute('data-collection') || '';
    var title = mount.getAttribute('data-title') || 'Shop';
    var base = handle && handle !== 'all' ? '/collections/' + encodeURIComponent(handle) + '/products.json' : '/products.json';
    mount.innerHTML = '<p class="ll-empty">Loading...</p>';
    fetchAll(base).then(function (raw) {
      var all = raw.map(norm).filter(Boolean);
      if (!all.length) { mount.innerHTML = ''; mount.style.display = 'none'; return; }
      all.forEach(function (x) {
        x.cat = x.type || LANE_NAME[x.lane] || 'Other';
        x.strength = []; x.flavor = [];
        x.options.forEach(function (o) {
          var k = optKind(o.name);
          if (k) x[k] = (o.values || []).filter(function (val) {
            return x.vs.some(function (v) { return v.ok && v['o' + o.pos] === val; });
          });
        });
      });
      renderSlicer(mount, all, title);
      hideThemeGrid(mount);
    }).catch(function () { mount.innerHTML = ''; mount.style.display = 'none'; });
  }

  function renderSlicer(mount, all, title) {
    var P = new URLSearchParams(location.search);
    var st = {
      brand: P.get('ll_brand') || '', cat: P.get('ll_cat') || '', strength: P.get('ll_str') || '', flavor: P.get('ll_flv') || '',
      price: P.get('ll_price') || '', q: P.get('ll_q') || '', sort: P.get('ll_sort') || 'featured',
      sale: P.get('ll_sale') === '1', stock: P.get('ll_all') !== '1', shown: 36
    };
    var anyStrength = all.some(function (x) { return x.strength.length; });
    var anyFlavor = all.some(function (x) { return x.flavor.length; });

    mount.innerHTML =
      '<p class="ll-kicker">Shop</p><h2 class="ll-h">' + esc(title) + '</h2>' +
      '<div class="ll-bar">' +
      '<input type="search" placeholder="Search ' + esc(title) + '" aria-label="Search" value="' + esc(st.q) + '">' +
      '<select data-f="price" aria-label="Price"><option value="">Any price</option><option value="0-25">Under $25</option><option value="25-50">$25 to $50</option><option value="50-100">$50 to $100</option><option value="100-250">$100 to $250</option><option value="250-99999">$250 and up</option></select>' +
      '<select data-f="sort" aria-label="Sort"><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">Newest</option><option value="az">A to Z</option></select>' +
      '<label class="ll-chip" style="display:inline-flex;gap:6px"><input type="checkbox" data-t="sale"' + (st.sale ? ' checked' : '') + '> On sale</label>' +
      '<label class="ll-chip" style="display:inline-flex;gap:6px"><input type="checkbox" data-t="stock"' + (st.stock ? ' checked' : '') + '> In stock</label>' +
      '<button class="ll-chip" type="button" data-clear>Clear all</button>' +
      '</div>' +
      '<div class="ll-facets"></div><p class="ll-count"></p><div class="ll-grid"></div><div class="ll-foot"></div>';
    mount.querySelector('[data-f=price]').value = st.price;
    mount.querySelector('[data-f=sort]').value = st.sort;

    function pass(x, skip) {
      if (st.stock && !x.stock) return false;
      if (st.sale && !x.sale) return false;
      if (skip !== 'brand' && st.brand && x.vendor !== st.brand) return false;
      if (skip !== 'cat' && st.cat && x.cat !== st.cat) return false;
      if (skip !== 'strength' && st.strength && x.strength.indexOf(st.strength) < 0) return false;
      if (skip !== 'flavor' && st.flavor && x.flavor.indexOf(st.flavor) < 0) return false;
      if (st.price) { var b = st.price.split('-'); if (x.price < +b[0] || x.price > +b[1]) return false; }
      if (st.q) { var w = low(st.q).split(/\s+/).filter(Boolean); for (var i = 0; i < w.length; i++) if (x.text.indexOf(w[i]) < 0) return false; }
      return true;
    }
    function counts(field) {
      var c = {};
      all.forEach(function (x) {
        if (!pass(x, field)) return;
        var vals = field === 'brand' ? [x.vendor] : field === 'cat' ? [x.cat] : x[field];
        vals.forEach(function (v) { if (v) c[v] = (c[v] || 0) + 1; });
      });
      return c;
    }
    function chipRow(field, label, cur) {
      var c = counts(field), keys = Object.keys(c);
      if (cur && keys.indexOf(cur) < 0) keys.push(cur);
      if (keys.length < 2 && !cur) return '';
      keys.sort(function (a, b) { return field === 'strength' ? (parseFloat(a) || 0) - (parseFloat(b) || 0) : (c[b] || 0) - (c[a] || 0) || a.localeCompare(b); });
      return '<p class="ll-lab">' + label + '</p><div class="ll-chips">' +
        '<button class="ll-chip" type="button" data-k="' + field + '" data-v="" aria-pressed="' + (!cur) + '">All</button>' +
        keys.map(function (k) { return '<button class="ll-chip" type="button" data-k="' + field + '" data-v="' + esc(k) + '" aria-pressed="' + (k === cur) + '">' + esc(k) + '<small>' + (c[k] || 0) + '</small></button>'; }).join('') + '</div>';
    }
    function brandRow() {
      var c = counts('brand'), keys = Object.keys(c);
      if (st.brand && keys.indexOf(st.brand) < 0) keys.push(st.brand);
      if (keys.length < 2 && !st.brand) return '';
      keys.sort(function (a, b) { return (c[b] || 0) - (c[a] || 0) || a.localeCompare(b); });
      var face = {}; all.forEach(function (x) { if (!face[x.vendor] && x.img) face[x.vendor] = x.img; });
      return '<p class="ll-lab">Brands</p><div class="ll-brands">' + keys.map(function (k) {
        return '<button class="ll-brand" type="button" data-k="brand" data-v="' + esc(k) + '" aria-pressed="' + (k === st.brand) + '">' +
          (face[k] ? '<img alt="" loading="lazy" src="' + esc(img(face[k], 80)) + '">' : '') + '<span>' + esc(k) + '<small>' + (c[k] || 0) + ' items</small></span></button>';
      }).join('') + '</div>';
    }
    function syncUrl() {
      var u = new URL(location.href);
      [['ll_brand', st.brand], ['ll_cat', st.cat], ['ll_str', st.strength], ['ll_flv', st.flavor], ['ll_price', st.price], ['ll_q', st.q],
        ['ll_sort', st.sort === 'featured' ? '' : st.sort], ['ll_sale', st.sale ? '1' : ''], ['ll_all', st.stock ? '' : '1']]
        .forEach(function (p) { if (p[1]) u.searchParams.set(p[0], p[1]); else u.searchParams.delete(p[0]); });
      history.replaceState(null, '', u.toString());
    }
    function paint() {
      var facets = brandRow() + chipRow('cat', 'Category', st.cat) +
        (anyStrength ? chipRow('strength', 'Strength', st.strength) : '') +
        (anyFlavor ? chipRow('flavor', 'Flavor', st.flavor) : '');
      mount.querySelector('.ll-facets').innerHTML = facets;
      var r = all.filter(function (x) { return pass(x); });
      if (st.sort === 'low') r.sort(function (a, b) { return a.price - b.price; });
      if (st.sort === 'high') r.sort(function (a, b) { return b.price - a.price; });
      if (st.sort === 'new') r.sort(function (a, b) { return b.created - a.created; });
      if (st.sort === 'az') r.sort(function (a, b) { return a.title.localeCompare(b.title); });
      mount.querySelector('.ll-count').textContent = r.length + ' of ' + all.length + ' items';
      mount.querySelector('.ll-grid').innerHTML = r.length ? r.slice(0, st.shown).map(function (x) { return postHTML(x, { tag: false }); }).join('')
        : '<p class="ll-empty" style="grid-column:1/-1">Nothing matches those filters. <button class="ll-chip" type="button" data-clear>Clear all</button></p>';
      mount.querySelector('.ll-foot').innerHTML = r.length > st.shown ? '<button class="ll-more" type="button">Show more (' + (r.length - st.shown) + ')</button>' : '';
      syncUrl();
    }
    function clearAll() {
      st.brand = st.cat = st.strength = st.flavor = st.price = st.q = ''; st.sort = 'featured'; st.sale = false; st.stock = true; st.shown = 36;
      mount.querySelector('input[type=search]').value = ''; mount.querySelector('[data-f=price]').value = ''; mount.querySelector('[data-f=sort]').value = 'featured';
      mount.querySelector('[data-t=sale]').checked = false; mount.querySelector('[data-t=stock]').checked = true;
      paint();
    }
    mount.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) { clearAll(); return; }
      var c = e.target.closest('[data-k]');
      if (c) { var k = c.getAttribute('data-k'), v = c.getAttribute('data-v'); st[k] = st[k] === v ? '' : v; st.shown = 36; paint(); return; }
      if (e.target.closest('.ll-more')) { st.shown += 36; paint(); }
    });
    var t;
    mount.querySelector('input[type=search]').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.q = v.trim(); st.shown = 36; paint(); }, 200); });
    mount.querySelectorAll('select[data-f]').forEach(function (sel) { sel.addEventListener('change', function () { st[sel.getAttribute('data-f')] = sel.value; st.shown = 36; paint(); }); });
    mount.querySelectorAll('input[data-t]').forEach(function (cb) { cb.addEventListener('change', function () { st[cb.getAttribute('data-t')] = cb.checked; st.shown = 36; paint(); }); });
    bindCart(mount);
    paint();
  }

  /* exposed for tests */
  window.LLShop = { norm: norm, curate: curate, feedEligible: feedEligible, isBulk: isBulk, laneOf: laneOf };

  function boot() {
    var f = document.getElementById('ll-feed');
    if (f && !f.getAttribute('data-ll-ready')) { f.setAttribute('data-ll-ready', '1'); feed(f); }
    var s = document.getElementById('ll-slicer');
    if (s && !s.getAttribute('data-ll-ready')) { s.setAttribute('data-ll-ready', '1'); slicer(s); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

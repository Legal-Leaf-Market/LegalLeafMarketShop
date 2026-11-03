/* public/shop-dispensary.js -- the dispensary shelf on the Shopify storefront.
 *
 * WHERE IT RUNS. shop.legalleafmarket.shop/pages/dispensary (template "dispensary") carries a
 * Custom Liquid section with two lines in it:
 *
 *   <div id="ll-dispensary" data-stores="thcasmallbuds,puffweiser,blacktiecbd"></div>
 *   <script src="https://legalleafmarket.shop/shop-dispensary.js" defer></script>
 *
 * Everything else lives HERE, in the repo, so the shelf is versioned and a theme edit can never
 * lose it again. (The first build of this page was pasted into the theme editor in pieces and the
 * session ran out before it was saved; the page shipped empty. Do not move the code back into
 * Shopify.)
 *
 * WHAT IT READS. /api/products?store=<key>, one request per shop, in parallel. The API sends
 * Access-Control-Allow-Origin: * for exactly this reader (see the top of api/products.js). A shop
 * whose slice fails is shown as unavailable rather than taking the page down with it.
 *
 * WHAT IT IS NOT. A checkout. Every card hands off to the partner shop, which is the seller; the
 * Shopify store sells accessories only (CLAUDE.md, "Dropship does not get around the hemp rules").
 * The CTA says "Shop at <store>" for that reason, never "Add to cart".
 *
 * UI, per the owner: one shelf with gallery toggles for the shops (not three split sections),
 * category chips, sort, and cards that stay the same height. Size choice is a <select> so a
 * twelve-size product is no taller than a one-size product; the description sits behind a
 * per-card Details toggle, and "Collapse all" brings every card back to the common height.
 */
(function () {
  'use strict';
  var API = 'https://legalleafmarket.shop/api/products';
  var DEFAULT_STORES = ['thcasmallbuds', 'puffweiser', 'blacktiecbd'];
  var PAGE = 24;
  var GATE_KEY = 'll_dispensary_21';

  var mount = document.getElementById('ll-dispensary');
  if (!mount || mount.getAttribute('data-ll-ready')) return;
  mount.setAttribute('data-ll-ready', '1');
  var storeKeys = (mount.getAttribute('data-stores') || '').split(',')
    .map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!storeKeys.length) storeKeys = DEFAULT_STORES;

  /* ---------- styles, scoped under #ll-dispensary ---------- */
  var css = [
    '#ll-dispensary{--bg:#080f14;--panel:rgba(16,27,35,.78);--line:#22303a;--muted:#9fb4c2;--ink:#eef6fb;',
    '--accent:#4ec9ff;--leaf2:#22a8e8;--leaf3:#1787c4;--gold:#f0b93c;--lab:#8b5cf6;',
    'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--bg);',
    'padding:20px 16px 40px;border-radius:16px;box-sizing:border-box;max-width:1400px;margin:0 auto;width:100%;min-width:0;contain:inline-size}',
    /* Horizon sizes a Custom Liquid grid column to its content; this keeps the shelf at the phone's width (see ll-shop.js) */
    '#ll-dispensary *{box-sizing:border-box}',
    '#ll-dispensary .lld-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 14px}',
    '#ll-dispensary .lld-head h2{margin:0;font-size:clamp(22px,3vw,30px);font-weight:800;letter-spacing:.02em;color:#fff}',
    '#ll-dispensary .lld-sub{margin:0;color:var(--muted);font-size:13px}',
    '#ll-dispensary .lld-label{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin:16px 0 8px}',
    /* store gallery toggles */
    '#ll-dispensary .lld-stores{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
    '#ll-dispensary .lld-st{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border-radius:14px;',
    'background:var(--panel);border:1px solid var(--line);text-align:center;transition:border-color .15s,opacity .15s,transform .15s}',
    '#ll-dispensary .lld-st:hover{transform:translateY(-1px)}',
    '#ll-dispensary .lld-st:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '#ll-dispensary .lld-st[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}',
    '#ll-dispensary .lld-st[aria-pressed="false"]{opacity:.45}',
    '#ll-dispensary .lld-st img{width:64px;height:64px;border-radius:50%;object-fit:cover;background:#fff}',
    '#ll-dispensary .lld-st b{font-size:13px;line-height:1.2}',
    '#ll-dispensary .lld-st small{color:var(--muted);font-size:12px}',
    /* chips + toolbar */
    '#ll-dispensary .lld-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '#ll-dispensary .lld-chip{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;',
    'background:rgba(78,201,255,.08);border:1px solid var(--line);color:var(--ink)}',
    '#ll-dispensary .lld-chip[aria-pressed="true"]{background:linear-gradient(90deg,var(--leaf3),var(--leaf2));border-color:transparent;color:#fff}',
    '#ll-dispensary .lld-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '#ll-dispensary .lld-chip small{opacity:.75;margin-left:4px}',
    '#ll-dispensary .lld-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0 12px}',
    '#ll-dispensary .lld-bar input[type=search],#ll-dispensary select{background:#0d1820;color:var(--ink);border:1px solid var(--line);',
    'border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;min-height:40px}',
    '#ll-dispensary .lld-bar input[type=search]{flex:1 1 220px;min-width:0}',
    '#ll-dispensary input::placeholder{color:#7f95a3!important;opacity:1}',
    '#ll-dispensary .lld-bar label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);cursor:pointer}',
    '#ll-dispensary .lld-btn{all:unset;cursor:pointer;padding:9px 14px;border-radius:10px;border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--ink)}',
    '#ll-dispensary .lld-btn:focus-visible{outline:2px solid var(--accent)}',
    '#ll-dispensary .lld-count{color:var(--muted);font-size:13px;margin:0 0 10px}',
    /* grid + cards: rows stretch, so collapsed cards in a row share one height */
    '#ll-dispensary .lld-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;align-items:stretch}',
    '#ll-dispensary .lld-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}',
    '#ll-dispensary .lld-media{position:relative;height:0;padding-top:72%;background:#0b141a;overflow:hidden}',
    '#ll-dispensary .lld-media img{position:absolute!important;inset:0;width:100%!important;height:100%!important;max-width:none;object-fit:contain;margin:0}',
    '#ll-dispensary .lld-store{position:absolute;z-index:2;top:10px;left:10px;background:rgba(8,15,20,.85);border:1px solid var(--line);border-radius:999px;',
    'padding:4px 10px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}',
    '#ll-dispensary .lld-trim{position:absolute;z-index:2;top:10px;right:10px;background:#b42318;color:#fff;border-radius:6px;padding:3px 7px;font-size:10px;font-weight:800;letter-spacing:.06em}',
    '#ll-dispensary .lld-body{display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px;flex:1}',
    '#ll-dispensary .lld-badges{display:flex;gap:6px;flex-wrap:wrap;min-height:20px;max-height:20px;overflow:hidden}',
    '#ll-dispensary .lld-badge{font-size:10px;font-weight:800;letter-spacing:.06em;padding:3px 7px;border-radius:6px}',
    '#ll-dispensary .b-deal{background:rgba(52,211,153,.14);color:#6ee7b7}',
    '#ll-dispensary .b-bulk{background:rgba(240,185,60,.14);color:var(--gold)}',
    '#ll-dispensary .b-ship{background:rgba(139,92,246,.18);color:#c4b5fd}',
    '#ll-dispensary .b-new{background:rgba(78,201,255,.14);color:var(--accent)}',
    '#ll-dispensary .lld-name{margin:0;font-size:16px;font-weight:700;line-height:1.25;color:#fff;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.5em}',
    '#ll-dispensary .lld-tags{display:flex;gap:6px;flex-wrap:nowrap;overflow:hidden;align-items:center;min-height:22px}',
    '#ll-dispensary .lld-tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:2px 7px}',
    '#ll-dispensary .lld-tag{white-space:nowrap}',
    '#ll-dispensary .lld-foot .lld-lab{font-weight:700;color:#c4b5fd}',
    '#ll-dispensary .lld-price{display:flex;align-items:baseline;gap:8px}',
    '#ll-dispensary .lld-price b{font-size:24px;color:var(--accent);font-weight:800}',
    '#ll-dispensary .lld-price s{color:var(--muted);font-size:13px}',
    '#ll-dispensary .lld-pg{margin-left:auto;background:#0d1820;border:1px solid var(--line);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700}',
    '#ll-dispensary .lld-meta{font-size:12px;color:var(--muted);line-height:1.45;min-height:3.2em}',
    '#ll-dispensary .lld-meta strong{color:var(--ink)}',
    '#ll-dispensary .lld-meta .lld-code{color:var(--accent);font-weight:700}',
    '#ll-dispensary .lld-sz{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--gold);text-transform:uppercase}',
    '#ll-dispensary .lld-card select{width:100%}',
    '#ll-dispensary .lld-more{font-size:13px;line-height:1.5;color:var(--muted);border-top:1px solid var(--line);padding-top:8px}',
    '#ll-dispensary .lld-spacer{flex:1}',
    '#ll-dispensary .lld-cta{display:block;text-align:center;padding:12px;border-radius:12px;font-weight:700;color:#fff;text-decoration:none;',
    'background:linear-gradient(90deg,var(--leaf3),var(--accent))}',
    '#ll-dispensary .lld-cta:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '#ll-dispensary .lld-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--muted);min-height:18px}',
    '#ll-dispensary .lld-foot button{all:unset;cursor:pointer;color:var(--accent);font-weight:600}',
    '#ll-dispensary .lld-foot a{color:var(--accent)}',
    '#ll-dispensary .lld-moreBtn{display:flex;justify-content:center;margin:20px 0 0}',
    '#ll-dispensary .lld-empty,#ll-dispensary .lld-note{color:var(--muted);font-size:13px;padding:18px;border:1px dashed var(--line);border-radius:12px;text-align:center}',
    '#ll-dispensary .lld-disc{margin-top:22px;color:var(--muted);font-size:11px;line-height:1.5}',
    '#ll-dispensary .lld-skel{height:420px;border-radius:16px;background:linear-gradient(90deg,#0d1820,#13222c,#0d1820);background-size:200% 100%;animation:lldsh 1.2s infinite}',
    '@keyframes lldsh{0%{background-position:200% 0}100%{background-position:-200% 0}}',
    /* 21+ gate */
    '.lld-gate{position:fixed;inset:0;z-index:2147483646;background:rgba(4,8,11,.94);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.lld-gate div{max-width:420px;background:#0d1820;border:1px solid #22303a;border-radius:16px;padding:24px;color:#eef6fb;text-align:center;font-family:"Segoe UI",system-ui,sans-serif}',
    '.lld-gate h2{margin:0 0 8px;font-size:22px;color:#fff}.lld-gate p{color:#9fb4c2;font-size:14px;line-height:1.5}',
    '.lld-gate button{margin:6px;padding:11px 18px;border-radius:10px;border:0;font-weight:700;cursor:pointer;font-size:14px}',
    '.lld-gate .y{background:linear-gradient(90deg,#1787c4,#4ec9ff);color:#fff}.lld-gate .n{background:#22303a;color:#eef6fb}',
    '@media (max-width:600px){#ll-dispensary{padding:16px 12px 32px;border-radius:0}#ll-dispensary .lld-grid{grid-template-columns:1fr;gap:12px}',
    '#ll-dispensary .lld-media{padding-top:58%}#ll-dispensary .lld-stores{grid-template-columns:repeat(3,1fr)}#ll-dispensary .lld-st img{width:48px;height:48px}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n).toFixed(2); }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function stripHtml(s) {
    var d = document.createElement('div');
    d.innerHTML = String(s || '');
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }
  var BADGE = { deal: ['GREAT DEAL', 'b-deal'], bulk: ['BULK VALUE', 'b-bulk'], ship: ['FREE SHIPPING', 'b-ship'], 'new': ['NEW', 'b-new'] };

  /* sizes rows from the API: [label, price, grams, variantId, inStock, compareAt|null, note, flags] */
  function sizesOf(p) {
    var rows = Array.isArray(p.sizes) ? p.sizes : [];
    var out = rows.map(function (r) {
      return { label: String(r[0] || ''), price: Number(r[1]), grams: Number(r[2]) || 0, vid: r[3] ? String(r[3]) : '',
        stock: r[4] !== false, compare: typeof r[5] === 'number' ? r[5] : null };
    }).filter(function (s) { return isFinite(s.price) && s.price > 0; });
    if (!out.length && isFinite(Number(p.sale))) out = [{ label: 'One size', price: Number(p.sale), grams: 0, vid: '', stock: !!p.inStock, compare: null }];
    return out;
  }
  /* Default to the ounce (or the biggest size at or under it) so a pound never opens as the headline price. */
  function defaultSize(sz) {
    var live = sz.filter(function (s) { return s.stock; });
    var pool = live.length ? live : sz;
    var under = pool.filter(function (s) { return s.grams && s.grams <= 28; });
    if (under.length) return sz.indexOf(under.reduce(function (a, b) { return b.grams > a.grams ? b : a; }));
    return sz.indexOf(pool[0]);
  }
  function perG(s) { return s.grams ? s.price / s.grams : null; }
  function bestPerG(sz) {
    var v = sz.filter(function (s) { return s.stock && s.grams; }).map(perG);
    return v.length ? Math.min.apply(null, v) : null;
  }
  function hrefFor(p, s) {
    var u = safeUrl(p.url);
    if (!u) return '';
    if (p.platform === 'shopify' && s && /^\d+$/.test(s.vid)) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'variant=' + s.vid;
    return u;
  }

  /* ---------- state ---------- */
  var state = {
    all: [], stores: {}, on: {}, cat: '', q: '', sort: 'pg', stock: true, trim: false, shown: PAGE, open: {}
  };

  /* ---------- skeleton ---------- */
  mount.innerHTML = '<div class="lld-head"><h2>Dispensary</h2><p class="lld-sub">Live prices from partner shops, refreshed through the day.</p></div>'
    + '<div class="lld-grid">' + new Array(8).join('<div class="lld-skel" aria-hidden="true"></div>') + '</div>';

  /* ---------- optional 21+ gate (attestation; the partner shop verifies age at its own checkout) ---------- */
  function gate(done) {
    var ok = false;
    try { ok = localStorage.getItem(GATE_KEY) === '1'; } catch (e) { ok = false; }
    /* OFF unless the mount asks for it with data-gate="1": the storefront already runs Blockify's
       21+ gate on every page, and two gates in a row read as a broken page. */
    if (mount.getAttribute('data-gate') !== '1') return done();
    if (ok || /bot|crawl|spider|lighthouse/i.test(navigator.userAgent)) return done();
    var g = document.createElement('div');
    g.className = 'lld-gate';
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-modal', 'true');
    g.setAttribute('aria-labelledby', 'lld-gate-h');
    g.innerHTML = '<div><h2 id="lld-gate-h">Are you 21 or over?</h2>'
      + '<p>This page lists hemp-derived products from partner shops for adults 21 and over.</p>'
      + '<button type="button" class="y">Yes, I am 21+</button><button type="button" class="n">No</button></div>';
    document.body.appendChild(g);
    g.querySelector('.y').focus();
    g.querySelector('.y').onclick = function () {
      try { localStorage.setItem(GATE_KEY, '1'); } catch (e) { /* private mode: asks again next visit */ }
      g.remove();
      done();
    };
    g.querySelector('.n').onclick = function () { location.href = '/'; };
  }

  /* ---------- data ---------- */
  function load() {
    return Promise.all(storeKeys.map(function (k) {
      return fetch(API + '?store=' + encodeURIComponent(k), { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var list = (j && j.products || []).filter(function (p) { return p && p.storeKey === k && p.group !== 'gear'; });
          return { key: k, ok: list.length > 0, list: list };
        })
        .catch(function () { return { key: k, ok: false, list: [] }; });
    })).then(function (res) {
      res.forEach(function (r) {
        var first = r.list[0] || {};
        var img = '';
        for (var i = 0; i < r.list.length && !img; i++) if (r.list[i].inStock) img = safeUrl(r.list[i].image);
        state.stores[r.key] = { key: r.key, ok: r.ok, name: first.store || r.key, img: img || safeUrl(first.image) };
        state.on[r.key] = r.ok;
        r.list.forEach(function (p) {
          var sz = sizesOf(p);
          if (!sz.length) return;
          state.all.push({ p: p, sz: sz, pick: defaultSize(sz), best: bestPerG(sz),
            text: (p.name + ' ' + p.store + ' ' + p.category + ' ' + (p.brand || '') + ' ' + (p.lineage || '')).toLowerCase() });
        });
      });
    });
  }

  /* ---------- filtering ---------- */
  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = state.all.filter(function (x) {
      if (!state.on[x.p.storeKey]) return false;
      if (state.stock && !x.p.inStock) return false;
      if (!state.trim && x.p.offcut) return false;
      if (state.cat && x.p.category !== state.cat) return false;
      if (q && x.text.indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      pg: function (a, b) { return (a.best == null ? 1e9 : a.best) - (b.best == null ? 1e9 : b.best); },
      cheap: function (a, b) { return a.sz[a.pick].price - b.sz[b.pick].price; },
      strong: function (a, b) { return (Number(b.p.potency) || 0) - (Number(a.p.potency) || 0); },
      fresh: function (a, b) { return (Number(b.p.added) || 0) - (Number(a.p.added) || 0); },
      az: function (a, b) { return String(a.p.name).localeCompare(String(b.p.name)); }
    }[state.sort];
    return list.sort(by);
  }
  function counts(field) {
    var m = {};
    state.all.forEach(function (x) {
      if (state.stock && !x.p.inStock) return;
      if (!state.trim && x.p.offcut) return;
      if (field === 'cat' && !state.on[x.p.storeKey]) return;
      var k = field === 'cat' ? x.p.category : x.p.storeKey;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }

  /* ---------- rendering ---------- */
  function cardHTML(x, i) {
    var p = x.p, s = x.sz[x.pick], pg = perG(s);
    var open = !!state.open[p.id];
    var badges = (p.badges || []).map(function (b) {
      var d = BADGE[b]; return d ? '<span class="lld-badge ' + d[1] + '">' + d[0] + '</span>' : '';
    }).join('');
    var tags = [p.grow, p.cannabinoid, p.potency ? (Math.round(p.potency * 10) / 10) + '% total' : '']
      .filter(Boolean).map(function (t) { return '<span class="lld-tag">' + esc(t) + '</span>'; }).join('');
    var coa = safeUrl(p.coa);
    var meta = [];
    if (x.best != null && x.sz.length > 1) meta.push('Best <strong>' + money(x.best) + '/g</strong> across sizes');
    if (typeof p.ship === 'number') meta.push(p.ship === 0 ? 'Free shipping' : '\u2248 <strong>' + money(s.price + p.ship) + '</strong> out the door (est. ship ' + money(p.ship) + ')');
    if (p.coupon) meta.push('<span class="lld-code">' + (p.couponPct ? p.couponPct + '% off with code ' : 'Code ') + esc(p.coupon) + '</span>');
    var opts = x.sz.map(function (z, j) {
      var g = perG(z);
      return '<option value="' + j + '"' + (j === x.pick ? ' selected' : '') + (z.stock ? '' : ' disabled') + '>'
        + esc(z.label) + ' \u2014 ' + money(z.price) + (g ? ' \u00b7 ' + money(g) + '/g' : '') + (z.stock ? '' : ' (sold out)') + '</option>';
    }).join('');
    var desc = stripHtml(p.desc || p.description || '');
    var store = state.stores[p.storeKey] || { name: p.store };
    return '<article class="lld-card" data-i="' + i + '">'
      + '<div class="lld-media"><span class="lld-store">' + esc(store.name) + '</span>'
      + (p.offcut ? '<span class="lld-trim">TRIM / SHAKE</span>' : '')
      + (safeUrl(p.image) ? '<img loading="lazy" decoding="async" src="' + esc(safeUrl(p.image)) + '" alt="' + esc(p.name) + '">' : '')
      + '</div><div class="lld-body">'
      + '<div class="lld-badges">' + badges + '</div>'
      + '<h3 class="lld-name" title="' + esc(p.name) + '">' + esc(p.name) + '</h3>'
      + '<div class="lld-tags">' + tags + '</div>'
      + '<div class="lld-price"><b>' + money(s.price) + '</b>' + (s.compare && s.compare > s.price ? '<s>' + money(s.compare) + '</s>' : '')
      + (pg ? '<span class="lld-pg">' + money(pg) + '/g</span>' : '') + '</div>'
      + '<div class="lld-meta">' + meta.join('<br>') + '</div>'
      + (x.sz.length > 1 ? '<span class="lld-sz">Size / option</span><select aria-label="Size for ' + esc(p.name) + '">' + opts + '</select>' : '<span class="lld-sz">' + esc(s.label) + '</span>')
      + (open && desc ? '<div class="lld-more">' + esc(desc.slice(0, 900)) + (desc.length > 900 ? '\u2026' : '') + '</div>' : '')
      + '<div class="lld-spacer"></div>'
      + '<a class="lld-cta" href="' + esc(hrefFor(p, s)) + '" target="_blank" rel="sponsored noopener">Shop at ' + esc(store.name) + ' \u2192</a>'
      + '<div class="lld-foot"><span>' + (coa ? '<a class="lld-lab" href="' + esc(coa) + '" target="_blank" rel="noopener">Lab data \u2197</a>' : 'Ships from ' + esc(store.name)) + '</span>'
      + (desc ? '<button type="button" class="lld-det" aria-expanded="' + open + '">' + (open ? 'Less \u25b4' : 'Details \u25be') + '</button>' : '')
      + '</div></div></article>';
  }

  var list = [];
  function render() {
    list = visible();
    var sc = counts('store'), cc = counts('cat');
    var storesHTML = storeKeys.map(function (k) {
      var s = state.stores[k];
      if (!s) return '';
      return '<button type="button" class="lld-st" data-store="' + esc(k) + '" aria-pressed="' + (!!state.on[k]) + '"' + (s.ok ? '' : ' disabled') + '>'
        + (s.img ? '<img src="' + esc(s.img) + '" alt="" loading="lazy">' : '')
        + '<b>' + esc(s.name) + '</b><small>' + (s.ok ? (sc[k] || 0) + (state.stock ? ' in stock' : ' items') : 'unavailable right now') + '</small></button>';
    }).join('');
    var cats = Object.keys(cc).sort(function (a, b) { return cc[b] - cc[a]; });
    var chips = '<button type="button" class="lld-chip" data-cat="" aria-pressed="' + (!state.cat) + '">All</button>'
      + cats.map(function (c) {
        return '<button type="button" class="lld-chip" data-cat="' + esc(c) + '" aria-pressed="' + (state.cat === c) + '">' + esc(c) + '<small>' + cc[c] + '</small></button>';
      }).join('');
    var anyOpen = Object.keys(state.open).some(function (k) { return state.open[k]; });
    mount.innerHTML = '<div class="lld-head"><h2>Dispensary</h2><p class="lld-sub">Live prices from partner shops. You check out on their site.</p></div>'
      + '<div class="lld-label">Shop by store</div><div class="lld-stores">' + storesHTML + '</div>'
      + '<div class="lld-label">Category</div><div class="lld-chips">' + chips + '</div>'
      + '<div class="lld-bar"><input type="search" placeholder="Search strains, brands, products" aria-label="Search" value="' + esc(state.q) + '">'
      + '<select aria-label="Sort"><option value="pg">Best $/g</option><option value="cheap">Cheapest</option><option value="strong">Strongest</option><option value="fresh">Newest</option><option value="az">A\u2013Z</option></select>'
      + '<label><input type="checkbox" data-f="stock"' + (state.stock ? ' checked' : '') + '> In stock only</label>'
      + '<label><input type="checkbox" data-f="trim"' + (state.trim ? ' checked' : '') + '> Trim &amp; shake</label>'
      + (anyOpen ? '<button type="button" class="lld-btn lld-collapse">Collapse all</button>' : '') + '</div>'
      + '<p class="lld-count" aria-live="polite">' + list.length + ' deal' + (list.length === 1 ? '' : 's') + '</p>'
      + (list.length ? '<div class="lld-grid">' + list.slice(0, state.shown).map(cardHTML).join('') + '</div>'
        : '<div class="lld-empty">Nothing matches. Turn a store back on or clear the search.</div>')
      + (list.length > state.shown ? '<div class="lld-moreBtn"><button type="button" class="lld-btn lld-more-cards">Show more (' + (list.length - state.shown) + ' left)</button></div>' : '')
      + '<p class="lld-disc">Products on this page are sold and shipped by the partner shop named on each card, not by Legal-Leaf Market. '
      + 'Prices and stock come from each shop and can change; the shop\'s checkout is final and verifies age. '
      + 'Affiliate disclosure: Legal-Leaf Market may earn a commission on purchases made through these links, at no extra cost to you. '
      + 'Hemp-derived products are for adults 21+ where legal; check your state\'s rules before ordering.</p>';
    mount.querySelector('.lld-bar select').value = state.sort;
  }

  /* re-render one card in place (size change / details toggle) so the grid does not jump */
  function rerenderCard(card) {
    var i = Number(card.getAttribute('data-i'));
    var x = list[i];
    if (!x) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = cardHTML(x, i);
    card.replaceWith(tmp.firstChild);
  }

  /* ---------- events (delegated, bound once) ---------- */
  var searchTimer = null;
  mount.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || !mount.contains(t)) return;
    if (t.classList.contains('lld-st')) {
      var k = t.getAttribute('data-store');
      state.on[k] = !state.on[k];
      if (!storeKeys.some(function (s) { return state.on[s]; })) state.on[k] = true; /* never toggle to an empty shelf */
      state.shown = PAGE; render();
    } else if (t.classList.contains('lld-chip')) {
      state.cat = t.getAttribute('data-cat'); state.shown = PAGE; render();
    } else if (t.classList.contains('lld-more-cards')) {
      state.shown += PAGE; render();
    } else if (t.classList.contains('lld-collapse')) {
      state.open = {}; render();
    } else if (t.classList.contains('lld-det')) {
      var card = t.closest('.lld-card'), x = list[Number(card.getAttribute('data-i'))];
      state.open[x.p.id] = !state.open[x.p.id];
      var hadBar = !!mount.querySelector('.lld-collapse');
      var anyOpen = Object.keys(state.open).some(function (id) { return state.open[id]; });
      if (hadBar !== anyOpen) { var y = window.scrollY; render(); window.scrollTo(0, y); } else rerenderCard(card);
    }
  });
  mount.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('.lld-card select')) {
      var card = t.closest('.lld-card');
      list[Number(card.getAttribute('data-i'))].pick = Number(t.value);
      rerenderCard(card);
    } else if (t.matches('.lld-bar select')) {
      state.sort = t.value; state.shown = PAGE; render();
    } else if (t.matches('.lld-bar input[type=checkbox]')) {
      state[t.getAttribute('data-f')] = t.checked; state.shown = PAGE; render();
    }
  });
  mount.addEventListener('input', function (e) {
    if (!e.target.matches('.lld-bar input[type=search]')) return;
    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = v; state.shown = PAGE; render();
      var box = mount.querySelector('.lld-bar input[type=search]');
      if (box) { box.focus(); box.setSelectionRange(v.length, v.length); }
    }, 200);
  });

  gate(function () {
    load().then(function () {
      if (!state.all.length) {
        mount.innerHTML = '<div class="lld-head"><h2>Dispensary</h2></div><div class="lld-note">The partner shelves did not load. Refresh in a minute.</div>';
        return;
      }
      render();
    });
  });
})();

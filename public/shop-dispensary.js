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
 * Shopify.) Netlify production deploys are paused (CLAUDE.md), so to ship a change point the
 * script tag at jsDelivr pinned to the merged commit, the way ll-shop.js is:
 *   https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@<commit>/public/shop-dispensary.js
 * The feed itself is still read from legalleafmarket.shop (data-api on the mount overrides it,
 * which is what test-shop-dispensary.mjs uses).
 *
 * WHAT IT READS. /api/products?store=<key>, one request per shop, in parallel. The API sends
 * Access-Control-Allow-Origin: * for exactly this reader (see the top of api/products.js). A shop
 * whose slice fails is shown as unavailable rather than taking the page down with it.
 *
 * IN STOCK ONLY, ALWAYS (owner, 14 Nov 2026: "it's got all the sold out things in the drop down,
 * and it shouldn't"). A size row whose slot 4 is false never reaches a dropdown, and a product with
 * no sellable row (or inStock:false) never reaches the shelf. There is no toggle to bring them back.
 *
 * THREE VIEWS, one state. "Shelf" is the card grid; a card FLIPS to its back for the description,
 * lineage, terpenes and lab link (click to flip; a mouse leaving the card flips it back). "Menu
 * board" is a kanban: columns by shop, price band, category or strain type. "Dashboard" is a
 * sortable table with summary tiles and a $/g bar. The size picker at the top ("Pick your size")
 * applies to all three: choose 3.5 g and every product shows its eighth, products without one drop
 * out, and price and $/g are finally compared like for like.
 *
 * THE CART. Owner, 13 Nov 2026: every card says "Add to Legal-Leaf Cart", never "Shop at <store>".
 * It is the same multi-store cart the old /consumables page had (engine.js addCart/renderCart and
 * the ll-checkout-fix block): items from all three shops collect in ONE Legal-Leaf Cart
 * (localStorage "ll_cart" on this origin), grouped by shop in a drawer, and each group has its own
 * "Checkout at <store>" link that pre-fills THAT shop's cart with the chosen sizes, the coupon and
 * the affiliate ref. The partner shop is still the seller and runs the real checkout; nothing here
 * touches the Shopify store's own cart (that one sells accessories only -- CLAUDE.md, "Dropship
 * does not get around the hemp rules").
 *   Shopify  -> https://<cartDomain>/cart/<vid>:<qty>,...?discount=<code>&<refParam>=<ref>
 *   Woo      -> add-to-cart=<parent>&variation_id=<vid>&<attrs> (ONE item per link, Woo's rule),
 *               on cartPath when the store publishes one, otherwise on the product page
 *   other    -> the product page (carries the ref)
 */
(function () {
  'use strict';
  var DEFAULT_STORES = ['thcasmallbuds', 'puffweiser', 'blacktiecbd'];
  var PAGE = 24;
  var GATE_KEY = 'll_dispensary_21';
  var PREF_KEY = 'll_dispensary_view';

  var mount = document.getElementById('ll-dispensary');
  if (!mount || mount.getAttribute('data-ll-ready')) return;
  mount.setAttribute('data-ll-ready', '1');
  var API = mount.getAttribute('data-api') || 'https://legalleafmarket.shop/api/products';
  var storeKeys = (mount.getAttribute('data-stores') || '').split(',')
    .map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!storeKeys.length) storeKeys = DEFAULT_STORES;

  /* ---------- styles, scoped under #ll-dispensary ---------- */
  var css = [
    '#ll-dispensary{--bg:#070d12;--panel:rgba(16,27,35,.82);--panel2:#0d1820;--line:#22303a;--muted:#9fb4c2;--ink:#eef6fb;',
    '--accent:#4ec9ff;--leaf2:#22a8e8;--leaf3:#1787c4;--gold:#f0b93c;--lab:#8b5cf6;--ind:#a78bfa;--sat:#fbbf24;--hyb:#34d399;',
    'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);',
    'background:radial-gradient(1200px 400px at 50% -120px,rgba(78,201,255,.16),transparent 70%),radial-gradient(800px 300px at 100% 0,rgba(139,92,246,.12),transparent 70%),var(--bg);',
    'padding:22px 16px 40px;border-radius:16px;box-sizing:border-box;max-width:1400px;margin:0 auto;overflow:hidden}',
    '#ll-dispensary *{box-sizing:border-box}',
    /* neon sign header */
    '#ll-dispensary .lld-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:0 0 6px}',
    '#ll-dispensary .lld-sign{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
    '#ll-dispensary .lld-head h2{margin:0;font-size:clamp(26px,4vw,40px);font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#e9f8ff;',
    'text-shadow:0 0 6px rgba(78,201,255,.9),0 0 18px rgba(78,201,255,.55),0 0 40px rgba(78,201,255,.3)}',
    '#ll-dispensary .lld-open{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:2px solid #ff4f8b;border-radius:8px;color:#ffd1e1;',
    'font-size:12px;font-weight:900;letter-spacing:.2em;box-shadow:0 0 10px rgba(255,79,139,.6),inset 0 0 8px rgba(255,79,139,.4);text-shadow:0 0 6px #ff4f8b;animation:lldflick 6s infinite}',
    '#ll-dispensary .lld-open i{width:7px;height:7px;border-radius:50%;background:#ff4f8b;box-shadow:0 0 8px #ff4f8b}',
    '@keyframes lldflick{0%,92%,100%{opacity:1}93%{opacity:.35}94%{opacity:1}96%{opacity:.5}97%{opacity:1}}',
    '#ll-dispensary .lld-sub{margin:4px 0 0;color:var(--muted);font-size:13px;width:100%}',
    '#ll-dispensary .lld-sub b{color:var(--ink)}',
    '#ll-dispensary .lld-label{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin:16px 0 8px}',
    /* store gallery toggles */
    '#ll-dispensary .lld-stores{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
    '#ll-dispensary .lld-st{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border-radius:14px;',
    'background:var(--panel);border:1px solid var(--line);text-align:center;transition:border-color .15s,opacity .15s}',
    '#ll-dispensary .lld-st:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '#ll-dispensary .lld-st[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset,0 0 18px rgba(78,201,255,.15)}',
    '#ll-dispensary .lld-st[aria-pressed="false"]{opacity:.45}',
    '#ll-dispensary .lld-st img{width:64px;height:64px;border-radius:50%;object-fit:cover;background:#fff}',
    '#ll-dispensary .lld-st b{font-size:13px;line-height:1.2}',
    '#ll-dispensary .lld-st small{color:var(--muted);font-size:12px}',
    /* size picker: the jar row */
    '#ll-dispensary .lld-sizes{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:thin}',
    '#ll-dispensary .lld-jar{all:unset;cursor:pointer;flex:none;min-width:84px;padding:9px 12px 8px;border-radius:12px 12px 16px 16px;text-align:center;',
    'background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid var(--line);border-top:4px solid #33444f}',
    '#ll-dispensary .lld-jar b{display:block;font-size:15px;font-weight:800;color:#fff}',
    '#ll-dispensary .lld-jar small{display:block;font-size:11px;color:var(--muted);margin-top:2px}',
    '#ll-dispensary .lld-jar em{display:block;font-style:normal;font-size:10px;color:var(--gold);margin-top:3px;font-weight:700}',
    '#ll-dispensary .lld-jar[aria-pressed="true"]{border-color:var(--accent);border-top-color:var(--gold);background:linear-gradient(180deg,rgba(78,201,255,.2),rgba(78,201,255,.04))}',
    '#ll-dispensary .lld-jar[disabled]{opacity:.35;cursor:default}',
    '#ll-dispensary .lld-jar:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    /* chips + toolbar */
    '#ll-dispensary .lld-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '#ll-dispensary .lld-chip{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;',
    'background:rgba(78,201,255,.08);border:1px solid var(--line);color:var(--ink)}',
    '#ll-dispensary .lld-chip[aria-pressed="true"]{background:linear-gradient(90deg,var(--leaf3),var(--leaf2));border-color:transparent;color:#fff}',
    '#ll-dispensary .lld-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '#ll-dispensary .lld-chip small{opacity:.75;margin-left:4px}',
    '#ll-dispensary .lld-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0 12px}',
    '#ll-dispensary .lld-bar input[type=search],#ll-dispensary select{background:var(--panel2);color:var(--ink);border:1px solid var(--line);',
    'border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;min-height:40px;max-width:100%}',
    '#ll-dispensary .lld-bar input[type=search]{flex:1 1 220px;min-width:0}',
    '#ll-dispensary input::placeholder{color:#7f95a3!important;opacity:1}',
    '#ll-dispensary .lld-bar label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);cursor:pointer}',
    '#ll-dispensary .lld-btn{all:unset;cursor:pointer;padding:9px 14px;border-radius:10px;border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--ink)}',
    '#ll-dispensary .lld-btn:focus-visible{outline:2px solid var(--accent)}',
    /* view switcher */
    '#ll-dispensary .lld-views{display:inline-flex;padding:3px;border-radius:12px;background:var(--panel2);border:1px solid var(--line)}',
    '#ll-dispensary .lld-view{all:unset;cursor:pointer;padding:7px 12px;border-radius:9px;font-size:13px;font-weight:700;color:var(--muted);white-space:nowrap}',
    '#ll-dispensary .lld-view[aria-pressed="true"]{background:linear-gradient(90deg,var(--leaf3),var(--accent));color:#fff}',
    '#ll-dispensary .lld-view:focus-visible{outline:2px solid var(--accent)}',
    '#ll-dispensary .lld-count{color:var(--muted);font-size:13px;margin:0 0 10px}',
    /* picks strip */
    '#ll-dispensary .lld-picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:4px 0 6px}',
    '#ll-dispensary .lld-pick{all:unset;cursor:pointer;display:flex;gap:10px;align-items:center;padding:10px;border-radius:14px;background:linear-gradient(135deg,rgba(240,185,60,.14),rgba(240,185,60,.03));border:1px solid rgba(240,185,60,.35)}',
    '#ll-dispensary .lld-pick:focus-visible{outline:2px solid var(--gold)}',
    '#ll-dispensary .lld-pick img{width:52px;height:52px;border-radius:10px;object-fit:cover;background:#0b141a;flex:none}',
    '#ll-dispensary .lld-pick span{display:block;min-width:0}',
    '#ll-dispensary .lld-pick small{display:block;font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--gold);text-transform:uppercase}',
    '#ll-dispensary .lld-pick b{display:block;font-size:13px;line-height:1.25;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#ll-dispensary .lld-pick em{display:block;font-style:normal;font-size:12px;color:var(--accent);font-weight:700}',
    /* type dot */
    '#ll-dispensary .lld-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle;background:#64748b}',
    '#ll-dispensary .t-Indica{background:var(--ind)}#ll-dispensary .t-Sativa{background:var(--sat)}#ll-dispensary .t-Hybrid{background:var(--hyb)}',
    /* ---- SHELF: flip cards. Both faces share one grid cell, so the card is as tall as the taller face
       and cards in a row stay level; the back scrolls inside itself if the copy is long. ---- */
    '#ll-dispensary .lld-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;align-items:stretch}',
    '#ll-dispensary .lld-card{perspective:1400px;min-width:0}',
    '#ll-dispensary .lld-flip{display:grid;height:100%;transition:transform .55s cubic-bezier(.2,.7,.2,1);transform-style:preserve-3d}',
    '#ll-dispensary .lld-card.is-flipped .lld-flip{transform:rotateY(180deg)}',
    '#ll-dispensary .lld-face{grid-area:1/1;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;',
    '-webkit-backface-visibility:hidden;backface-visibility:hidden;min-width:0}',
    '#ll-dispensary .lld-back{transform:rotateY(180deg);background:linear-gradient(160deg,#101f2a,#0a141b);border-color:#2b4150;padding:16px;gap:10px;overflow:auto}',
    '#ll-dispensary .lld-card.is-flipped .lld-front{visibility:hidden;transition:visibility 0s .28s}',
    '#ll-dispensary .lld-card:not(.is-flipped) .lld-back{visibility:hidden;transition:visibility 0s .28s}',
    '@media (prefers-reduced-motion:reduce){#ll-dispensary .lld-flip{transition:none}#ll-dispensary .lld-open{animation:none}}',
    '#ll-dispensary .lld-media{all:unset;cursor:pointer;display:block;position:relative;height:0;padding-top:72%;background:#0b141a;overflow:hidden}',
    '#ll-dispensary .lld-media img{position:absolute!important;inset:0;width:100%!important;height:100%!important;max-width:none;object-fit:contain;margin:0}',
    '#ll-dispensary .lld-media:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}',
    '#ll-dispensary .lld-hint{position:absolute;z-index:2;right:10px;bottom:10px;background:rgba(8,15,20,.85);border:1px solid var(--line);border-radius:999px;',
    'padding:3px 9px;font-size:11px;font-weight:700;color:var(--accent)}',
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
    '#ll-dispensary .b-pick{background:var(--gold);color:#1a1205}',
    '#ll-dispensary .lld-name{margin:0;font-size:16px;font-weight:700;line-height:1.25;color:#fff;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.5em}',
    '#ll-dispensary .lld-tags{display:flex;gap:6px;flex-wrap:nowrap;overflow:hidden;align-items:center;min-height:22px}',
    '#ll-dispensary .lld-tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:2px 7px;white-space:nowrap}',
    '#ll-dispensary .lld-price{display:flex;align-items:baseline;gap:8px}',
    '#ll-dispensary .lld-price b{font-size:24px;color:var(--accent);font-weight:800}',
    '#ll-dispensary .lld-price s{color:var(--muted);font-size:13px}',
    '#ll-dispensary .lld-pg{margin-left:auto;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:700}',
    '#ll-dispensary .lld-meta{font-size:12px;color:var(--muted);line-height:1.45;min-height:3.2em}',
    '#ll-dispensary .lld-meta strong{color:var(--ink)}',
    '#ll-dispensary .lld-code{color:var(--accent);font-weight:700}',
    '#ll-dispensary .lld-sz{font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--gold);text-transform:uppercase}',
    '#ll-dispensary .lld-card select,#ll-dispensary .lld-tk select,#ll-dispensary .lld-table select{width:100%}',
    '#ll-dispensary .lld-spacer{flex:1}',
    '#ll-dispensary .lld-cta{display:block;width:100%;border:0;cursor:pointer;font:inherit;font-size:15px;text-align:center;padding:12px;border-radius:12px;font-weight:700;color:#fff;text-decoration:none;',
    'background:linear-gradient(90deg,var(--leaf3),var(--accent))}',
    '#ll-dispensary .lld-cta:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '#ll-dispensary .lld-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--muted);min-height:18px}',
    '#ll-dispensary .lld-foot button,#ll-dispensary .lld-back .lld-unflip{all:unset;cursor:pointer;color:var(--accent);font-weight:700}',
    '#ll-dispensary .lld-foot button:focus-visible,#ll-dispensary .lld-unflip:focus-visible{outline:2px solid var(--accent)}',
    '#ll-dispensary .lld-foot a,#ll-dispensary .lld-back a{color:var(--accent)}',
    '#ll-dispensary .lld-lab{font-weight:700;color:#c4b5fd!important}',
    /* back face */
    '#ll-dispensary .lld-back h3{margin:0;font-size:16px;line-height:1.25;color:#fff}',
    '#ll-dispensary .lld-bk-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}',
    '#ll-dispensary .lld-bk-top .lld-unflip{flex:none;white-space:nowrap}',
    '#ll-dispensary .lld-bk-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px}',
    '#ll-dispensary .lld-bk-kv dt{color:var(--gold);font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:10px;padding-top:2px}',
    '#ll-dispensary .lld-bk-kv dd{margin:0;color:var(--ink)}',
    '#ll-dispensary .lld-desc{font-size:13px;line-height:1.55;color:#c9d8e2;margin:0}',
    '#ll-dispensary .lld-terps{display:flex;flex-direction:column;gap:4px}',
    '#ll-dispensary .lld-terp{display:grid;grid-template-columns:90px 1fr 42px;align-items:center;gap:6px;font-size:11px;color:var(--muted)}',
    '#ll-dispensary .lld-terp i{display:block;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--hyb),var(--accent))}',
    '#ll-dispensary .lld-terp u{text-decoration:none;display:block;background:#18262f;border-radius:3px}',
    /* ---- MENU BOARD (kanban) ---- */
    '#ll-dispensary .lld-board{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x proximity;align-items:flex-start}',
    '#ll-dispensary .lld-col{flex:0 0 290px;max-width:84vw;scroll-snap-align:start;background:#0a141b;border:1px solid var(--line);border-radius:16px;display:flex;flex-direction:column;max-height:900px}',
    '#ll-dispensary .lld-colhd{padding:12px 14px 10px;border-bottom:1px dashed #2b3b46;background:linear-gradient(180deg,#14232d,#0f1b23);border-radius:16px 16px 0 0}',
    '#ll-dispensary .lld-colhd h4{margin:0;font-size:15px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#fff;text-shadow:0 0 10px rgba(78,201,255,.35)}',
    '#ll-dispensary .lld-colhd p{margin:3px 0 0;font-size:12px;color:var(--muted)}',
    '#ll-dispensary .lld-colhd p b{color:var(--accent)}',
    '#ll-dispensary .lld-colbd{padding:10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto}',
    '#ll-dispensary .lld-tk{display:grid;grid-template-columns:52px 1fr;gap:6px 10px;padding:9px;border-radius:12px;background:var(--panel);border:1px solid var(--line);border-left:3px solid #33444f}',
    '#ll-dispensary .lld-tk.k-Indica{border-left-color:var(--ind)}#ll-dispensary .lld-tk.k-Sativa{border-left-color:var(--sat)}#ll-dispensary .lld-tk.k-Hybrid{border-left-color:var(--hyb)}',
    '#ll-dispensary .lld-tk img{width:52px;height:52px;border-radius:8px;object-fit:cover;background:#0b141a}',
    '#ll-dispensary .lld-tk .n{font-size:13px;font-weight:700;line-height:1.25;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '#ll-dispensary .lld-tk .s{font-size:11px;color:var(--muted);margin-top:2px}',
    '#ll-dispensary .lld-tk .r{grid-column:1/-1;display:flex;align-items:center;gap:8px}',
    '#ll-dispensary .lld-tk .r b{font-size:16px;color:var(--accent)}',
    '#ll-dispensary .lld-tk .r small{font-size:11px;color:var(--muted);margin-right:auto}',
    '#ll-dispensary .lld-tk select{grid-column:1/-1;min-height:34px;padding:5px 8px;font-size:12px}',
    '#ll-dispensary .lld-plus{all:unset;cursor:pointer;padding:6px 10px;border-radius:9px;font-size:12px;font-weight:800;color:#fff;background:linear-gradient(90deg,var(--leaf3),var(--accent));white-space:nowrap}',
    '#ll-dispensary .lld-plus:focus-visible{outline:2px solid #fff}',
    '#ll-dispensary .lld-colmore{all:unset;cursor:pointer;text-align:center;padding:8px;font-size:12px;font-weight:700;color:var(--accent)}',
    /* ---- DASHBOARD ---- */
    '#ll-dispensary .lld-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 12px}',
    '#ll-dispensary .lld-tile{padding:12px 14px;border-radius:14px;background:var(--panel);border:1px solid var(--line);min-width:0}',
    '#ll-dispensary .lld-tile small{display:block;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--gold)}',
    '#ll-dispensary .lld-tile b{display:block;font-size:24px;font-weight:800;color:#fff;margin-top:4px;font-variant-numeric:tabular-nums}',
    '#ll-dispensary .lld-tile span{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#ll-dispensary .lld-tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:#0a141b}',
    '#ll-dispensary .lld-table{width:100%;border-collapse:collapse;font-size:13px;min-width:860px}',
    '#ll-dispensary .lld-table th{position:sticky;top:0;background:#12212b;text-align:left;padding:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}',
    '#ll-dispensary .lld-table th button{all:unset;cursor:pointer;display:block;padding:10px 12px}',
    '#ll-dispensary .lld-table th button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}',
    '#ll-dispensary .lld-table th[aria-sort] button{color:var(--accent)}',
    '#ll-dispensary .lld-table td{padding:8px 12px;border-top:1px solid #1a2832;vertical-align:middle}',
    '#ll-dispensary .lld-table tr:hover td{background:rgba(78,201,255,.04)}',
    '#ll-dispensary .lld-table .pn{display:flex;align-items:center;gap:10px;min-width:220px}',
    '#ll-dispensary .lld-table .pn img{width:40px;height:40px;border-radius:8px;object-fit:cover;background:#0b141a;flex:none}',
    '#ll-dispensary .lld-table .pn b{font-weight:700;color:#fff;line-height:1.25}',
    '#ll-dispensary .lld-table .num{font-variant-numeric:tabular-nums;white-space:nowrap}',
    '#ll-dispensary .lld-table .pr{color:var(--accent);font-weight:800}',
    '#ll-dispensary .lld-table select{min-width:150px;min-height:34px;padding:5px 8px;font-size:12px}',
    '#ll-dispensary .lld-bar2{display:flex;align-items:center;gap:8px;min-width:120px}',
    '#ll-dispensary .lld-bar2 u{flex:1;text-decoration:none;height:6px;border-radius:3px;background:#18262f;overflow:hidden}',
    '#ll-dispensary .lld-bar2 i{display:block;height:100%;background:linear-gradient(90deg,var(--hyb),var(--accent))}',
    '#ll-dispensary .lld-moreBtn{display:flex;justify-content:center;margin:20px 0 0}',
    '#ll-dispensary .lld-empty,#ll-dispensary .lld-note{color:var(--muted);font-size:13px;padding:18px;border:1px dashed var(--line);border-radius:12px;text-align:center}',
    '#ll-dispensary .lld-disc{margin-top:22px;color:var(--muted);font-size:11px;line-height:1.5}',
    '#ll-dispensary .lld-skel{height:420px;border-radius:16px;background:linear-gradient(90deg,#0d1820,#13222c,#0d1820);background-size:200% 100%;animation:lldsh 1.2s infinite}',
    '@keyframes lldsh{0%{background-position:200% 0}100%{background-position:-200% 0}}',
    /* Legal-Leaf Cart: floating button + drawer (outside #ll-dispensary, so scoped by class) */
    '.llc-fab{position:fixed;right:16px;bottom:16px;z-index:2147483600;display:flex;align-items:center;gap:8px;padding:12px 16px;border-radius:999px;border:0;cursor:pointer;',
    'font:700 15px "Segoe UI",system-ui,sans-serif;color:#fff;background:linear-gradient(90deg,#1787c4,#4ec9ff);box-shadow:0 8px 24px rgba(0,0,0,.35)}',
    '.llc-fab span{background:#fff;color:#1787c4;border-radius:999px;min-width:22px;padding:1px 7px;font-size:13px;text-align:center}',
    '.llc-ov{position:fixed;inset:0;z-index:2147483601;background:rgba(4,8,11,.6);display:none}.llc-ov.on{display:block}',
    '.llc-dr{position:fixed;top:0;right:0;bottom:0;z-index:2147483602;width:min(420px,100vw);background:#0d1820;color:#eef6fb;display:flex;flex-direction:column;',
    'font-family:"Segoe UI",system-ui,sans-serif;transform:translateX(100%);transition:transform .2s;box-shadow:-8px 0 24px rgba(0,0,0,.4)}.llc-dr.on{transform:none}',
    '.llc-dr *{box-sizing:border-box}',
    '.llc-hd{display:flex;justify-content:space-between;align-items:flex-start;padding:16px;border-bottom:1px solid #22303a}',
    '.llc-hd h2{margin:0;font-size:20px;color:#fff}.llc-hd p{margin:2px 0 0;color:#9fb4c2;font-size:12px}',
    '.llc-x{all:unset;cursor:pointer;font-size:26px;line-height:1;color:#9fb4c2;padding:0 4px}',
    '.llc-bd{flex:1;overflow:auto;padding:12px 16px}',
    '.llc-st{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#f0b93c;margin:12px 0 6px}',
    '.llc-it{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #22303a}',
    '.llc-it img{width:52px;height:52px;object-fit:cover;border-radius:8px;background:#0b141a;flex:none}',
    '.llc-it .t{font-size:13px;font-weight:600;line-height:1.3}.llc-it .s{font-size:12px;color:#9fb4c2}',
    '.llc-row{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:13px}',
    '.llc-row b{color:#4ec9ff;margin-right:auto}',
    '.llc-row button{all:unset;cursor:pointer;border:1px solid #22303a;border-radius:6px;padding:1px 8px;color:#eef6fb}',
    '.llc-row .rm{border:0;color:#9fb4c2;text-decoration:underline;font-size:12px}',
    '.llc-go{display:block;margin:8px 0 6px;padding:11px;border-radius:10px;text-align:center;font-weight:700;color:#fff!important;text-decoration:none!important;',
    'background:linear-gradient(90deg,#1787c4,#4ec9ff)}',
    '.llc-nt{font-size:11px;color:#9fb4c2;margin:0 0 6px}',
    '.llc-ft{padding:12px 16px;border-top:1px solid #22303a}',
    '.llc-ft div{display:flex;justify-content:space-between;font-weight:700}.llc-ft div span{color:#4ec9ff}',
    '.llc-ft p{font-size:11px;color:#9fb4c2;margin:6px 0 0}',
    '.llc-empty{color:#9fb4c2;text-align:center;padding:30px 10px;font-size:14px;line-height:1.5}',
    '.llc-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483603;background:#0d1820;color:#eef6fb;border:1px solid #4ec9ff;',
    'border-radius:10px;padding:10px 14px;font:600 14px "Segoe UI",system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}',
    '.lld-gate{position:fixed;inset:0;z-index:2147483646;background:rgba(4,8,11,.94);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.lld-gate div{max-width:420px;background:#0d1820;border:1px solid #22303a;border-radius:16px;padding:24px;color:#eef6fb;text-align:center;font-family:"Segoe UI",system-ui,sans-serif}',
    '.lld-gate h2{margin:0 0 8px;font-size:22px;color:#fff}.lld-gate p{color:#9fb4c2;font-size:14px;line-height:1.5}',
    '.lld-gate button{margin:6px;padding:11px 18px;border-radius:10px;border:0;font-weight:700;cursor:pointer;font-size:14px}',
    '.lld-gate .y{background:linear-gradient(90deg,#1787c4,#4ec9ff);color:#fff}.lld-gate .n{background:#22303a;color:#eef6fb}',
    '@media (max-width:600px){#ll-dispensary{padding:16px 12px 32px;border-radius:0}#ll-dispensary .lld-grid{grid-template-columns:1fr;gap:12px}',
    '#ll-dispensary .lld-media{padding-top:58%}#ll-dispensary .lld-stores{grid-template-columns:repeat(3,1fr)}#ll-dispensary .lld-st img{width:48px;height:48px}',
    '#ll-dispensary .lld-views{display:flex;width:100%}#ll-dispensary .lld-view{flex:1;text-align:center;padding:7px 6px}',
    '#ll-dispensary .lld-tiles{grid-template-columns:1fr 1fr}#ll-dispensary .lld-tile b{font-size:19px}}'
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
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  var BADGE = { deal: ['GREAT DEAL', 'b-deal'], bulk: ['BULK VALUE', 'b-bulk'], ship: ['FREE SHIPPING', 'b-ship'], 'new': ['NEW', 'b-new'] };

  /* The jars across the top. A row matches a jar when its grams sit within tol of the target, so
     28.35 g ("1 Ounce") and 28 g are the same ounce, and 3.5 g is an eighth. */
  var SIZES = [
    { k: '', label: 'Any size', sub: 'every product' },
    { k: '1', label: '1 g', sub: 'gram', g: 1, tol: 0.25 },
    { k: '3.5', label: '3.5 g', sub: 'eighth', g: 3.5, tol: 0.4 },
    { k: '7', label: '7 g', sub: 'quarter', g: 7, tol: 0.6 },
    { k: '14', label: '14 g', sub: 'half oz', g: 14, tol: 1 },
    { k: '28', label: '28 g', sub: 'ounce', g: 28, tol: 1.5 },
    { k: '56', label: '2 oz', sub: '56 g', g: 56, tol: 3 },
    { k: '112', label: 'QP', sub: '112 g', g: 112, tol: 6 },
    { k: '448', label: 'Pound', sub: '448 g', g: 448, tol: 20 }
  ];
  function sizeDef(k) { return SIZES.filter(function (s) { return s.k === k; })[0] || SIZES[0]; }
  function matchRow(sz, k) {
    var d = sizeDef(k);
    if (!d.g) return -1;
    for (var i = 0; i < sz.length; i++) if (sz[i].grams && Math.abs(sz[i].grams - d.g) <= d.tol) return i;
    return -1;
  }

  /* sizes rows from the API: [label, price, grams, variantId, inStock, compareAt|null, note, flags]
     ONLY sellable rows survive: a sold-out size never reaches a dropdown. */
  function sizesOf(p) {
    var rows = Array.isArray(p.sizes) ? p.sizes : [];
    var out = rows.map(function (r) {
      return { label: String(r[0] || ''), price: Number(r[1]), grams: Number(r[2]) || 0, vid: r[3] ? String(r[3]) : '',
        stock: r[4] !== false, compare: typeof r[5] === 'number' ? r[5] : null, attrs: r[8] ? String(r[8]) : '' };
    }).filter(function (s) { return s.stock && isFinite(s.price) && s.price > 0; });
    if (!rows.length && isFinite(Number(p.sale)) && Number(p.sale) > 0) out = [{ label: 'One size', price: Number(p.sale), grams: 0, vid: '', stock: true, compare: null, attrs: '' }];
    return out;
  }
  /* Default to the ounce (or the biggest size at or under it) so a pound never opens as the headline price. */
  function defaultSize(sz) {
    var under = sz.filter(function (s) { return s.grams && s.grams <= 28.5; });
    if (under.length) return sz.indexOf(under.reduce(function (a, b) { return b.grams > a.grams ? b : a; }));
    return 0;
  }
  function perG(s) { return s && s.grams ? s.price / s.grams : null; }
  function bestPerG(sz) {
    var v = sz.filter(function (s) { return s.grams; }).map(perG);
    return v.length ? Math.min.apply(null, v) : null;
  }
  function strainType(p) { return /^(Indica|Sativa|Hybrid)$/.test(p.type || '') ? p.type : ''; }
  function lineageText(p) { return p.lineage && Array.isArray(p.lineage.parents) ? p.lineage.parents.join(' × ') : ''; }

  /* ---------- state ---------- */
  var pref = lsGet(PREF_KEY) || {};
  var state = {
    all: [], stores: {}, on: {}, cat: '', q: '', sort: 'pg', trim: false, shown: PAGE,
    view: /^(cards|board|table)$/.test(pref.view) ? pref.view : 'cards',
    size: typeof pref.size === 'string' && sizeDef(pref.size).k === pref.size ? pref.size : '',
    group: /^(store|price|cat|type)$/.test(pref.group) ? pref.group : 'store',
    dir: 1, flipped: {}, colShown: {}, picks: {}
  };
  function savePref() { lsSet(PREF_KEY, { view: state.view, size: state.size, group: state.group }); }

  /* ---------- skeleton ---------- */
  function headHTML(sub) {
    return '<div class="lld-head"><div class="lld-sign"><h2>Dispensary</h2><span class="lld-open"><i></i>OPEN</span></div>'
      + '<p class="lld-sub">' + sub + '</p></div>';
  }
  mount.innerHTML = headHTML('Stocking the shelves…')
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
        for (var i = 0; i < r.list.length && !img; i++) if (r.list[i].inStock !== false) img = safeUrl(r.list[i].image);
        state.stores[r.key] = { key: r.key, ok: r.ok, name: first.store || r.key, img: img || safeUrl(first.image) };
        state.on[r.key] = r.ok;
        r.list.forEach(function (p) {
          if (p.inStock === false) return;           /* sold out: never on the shelf */
          var sz = sizesOf(p);
          if (!sz.length) return;                    /* every size sold out: same */
          state.all.push({ p: p, sz: sz, pick: defaultSize(sz), best: bestPerG(sz), type: strainType(p),
            text: (p.name + ' ' + p.store + ' ' + p.category + ' ' + (p.brand || '') + ' ' + (p.type || '') + ' ' + lineageText(p)).toLowerCase() });
        });
      });
    });
  }

  /* ---------- filtering ---------- */
  /* the row a product is showing right now: the size jar wins, otherwise the shopper's own pick */
  function cur(x) { return x.sz[x.ci == null ? x.pick : x.ci]; }
  function base(skipSize) {
    var q = state.q.trim().toLowerCase();
    return state.all.filter(function (x) {
      if (!state.on[x.p.storeKey]) return false;
      if (!state.trim && x.p.offcut) return false;
      if (state.cat && x.p.category !== state.cat) return false;
      if (q && x.text.indexOf(q) < 0) return false;
      if (!skipSize) {
        x.ci = state.size ? matchRow(x.sz, state.size) : null;
        if (x.ci === -1) return false;
      }
      return true;
    });
  }
  var SORTS = {
    pg: function (x) { var g = state.size ? perG(cur(x)) : x.best; return g == null ? null : g; },
    cheap: function (x) { return cur(x).price; },
    strong: function (x) { var v = Number(x.p.potency); return v > 0 ? -v : null; },
    fresh: function (x) { return -(Number(x.p.added) || 0); },
    az: function (x) { return String(x.p.name).toLowerCase(); },
    store: function (x) { return String((state.stores[x.p.storeKey] || {}).name || x.p.store).toLowerCase(); },
    cat: function (x) { return String(x.p.category || '').toLowerCase(); },
    type: function (x) { return x.type ? x.type.toLowerCase() : null; }
  };
  function sortList(list) {
    var f = SORTS[state.sort] || SORTS.pg, d = state.dir;
    return list.sort(function (a, b) {
      var va = f(a), vb = f(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;                 /* missing values sink, whichever way the sort runs */
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * d;
    });
  }
  function visible() { return sortList(base(false)); }
  function counts(field) {
    var m = {};
    state.all.forEach(function (x) {
      if (!state.trim && x.p.offcut) return;
      if (field === 'cat' && !state.on[x.p.storeKey]) return;
      var k = field === 'cat' ? x.p.category : x.p.storeKey;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }
  /* Budtender's picks: the best $/g at the current size, one per shop, top three. */
  function picksOf(list) {
    var seen = {}, out = [];
    list.slice().sort(function (a, b) {
      var ga = perG(cur(a)), gb = perG(cur(b));
      return (ga == null ? 1e9 : ga) - (gb == null ? 1e9 : gb);
    }).forEach(function (x) {
      if (out.length >= 3 || seen[x.p.storeKey] || perG(cur(x)) == null) return;
      seen[x.p.storeKey] = 1; out.push(x);
    });
    state.picks = {};
    out.forEach(function (x) { state.picks[x.p.id] = 1; });
    return out;
  }

  /* ---------- shared bits ---------- */
  function sizeSelect(x, cls) {
    var s = cur(x);
    if (state.size || x.sz.length < 2) return '<span class="lld-sz">' + esc(s.label) + '</span>';
    return '<select class="' + (cls || '') + '" aria-label="Size for ' + esc(x.p.name) + '">' + x.sz.map(function (z, j) {
      var g = perG(z);
      return '<option value="' + j + '"' + (j === x.pick ? ' selected' : '') + '>' + esc(z.label) + ' — ' + money(z.price) + (g ? ' · ' + money(g) + '/g' : '') + '</option>';
    }).join('') + '</select>';
  }
  function typeDot(x) { return '<span class="lld-dot' + (x.type ? ' t-' + x.type : '') + '" aria-hidden="true"></span>'; }
  function storeName(p) { return (state.stores[p.storeKey] || {}).name || p.store; }

  /* ---------- SHELF: flip cards ---------- */
  function cardHTML(x, i) {
    var p = x.p, s = cur(x), pg = perG(s);
    var flipped = !!state.flipped[p.id];
    var badges = (state.picks[p.id] ? '<span class="lld-badge b-pick">★ BUDTENDER PICK</span>' : '') + (p.badges || []).map(function (b) {
      var d = BADGE[b]; return d ? '<span class="lld-badge ' + d[1] + '">' + d[0] + '</span>' : '';
    }).join('');
    var tags = [x.type ? typeDot(x) + x.type : '', esc(p.grow), esc(p.cannabinoid), p.potency ? (Math.round(p.potency * 10) / 10) + '% total' : '']
      .filter(Boolean).map(function (t) { return '<span class="lld-tag">' + t + '</span>'; }).join('');
    var coa = safeUrl(p.coa);
    var meta = [];
    if (!state.size && x.best != null && x.sz.length > 1) meta.push('Best <strong>' + money(x.best) + '/g</strong> across sizes');
    if (typeof p.ship === 'number') meta.push(p.ship === 0 ? 'Free shipping' : '≈ <strong>' + money(s.price + p.ship) + '</strong> out the door (est. ship ' + money(p.ship) + ')');
    if (p.coupon) meta.push('<span class="lld-code">' + (p.couponPct ? p.couponPct + '% off with code ' : 'Code ') + esc(p.coupon) + '</span>');
    var store = storeName(p);
    var front = '<div class="lld-face lld-front"' + (flipped ? ' aria-hidden="true"' : '') + '>'
      + '<button type="button" class="lld-media lld-flipbtn" aria-label="Flip ' + esc(p.name) + ' for details"><span class="lld-store">' + esc(store) + '</span>'
      + (p.offcut ? '<span class="lld-trim">TRIM / SHAKE</span>' : '')
      + (safeUrl(p.image) ? '<img loading="lazy" decoding="async" src="' + esc(safeUrl(p.image)) + '" alt="">' : '')
      + '<span class="lld-hint">↻ Details</span></button><div class="lld-body">'
      + '<div class="lld-badges">' + badges + '</div>'
      + '<h3 class="lld-name" title="' + esc(p.name) + '">' + esc(p.name) + '</h3>'
      + '<div class="lld-tags">' + tags + '</div>'
      + '<div class="lld-price"><b>' + money(s.price) + '</b>' + (s.compare && s.compare > s.price ? '<s>' + money(s.compare) + '</s>' : '')
      + (pg ? '<span class="lld-pg">' + money(pg) + '/g</span>' : '') + '</div>'
      + '<div class="lld-meta">' + meta.join('<br>') + '</div>'
      + (x.sz.length > 1 && !state.size ? '<span class="lld-sz">Size · ' + x.sz.length + ' in stock</span>' : '')
      + sizeSelect(x)
      + '<div class="lld-spacer"></div>'
      + '<button type="button" class="lld-cta lld-add">＋ Add to Legal-Leaf Cart</button>'
      + '<div class="lld-foot"><span>' + (coa ? '<a class="lld-lab" href="' + esc(coa) + '" target="_blank" rel="noopener">Lab data ↗</a>' : 'Ships from ' + esc(store)) + '</span>'
      + '<button type="button" class="lld-flipbtn" aria-expanded="' + flipped + '">Flip ↻</button></div></div></div>';
    return '<article class="lld-card' + (flipped ? ' is-flipped' : '') + '" data-i="' + i + '" data-kind="card"><div class="lld-flip">' + front + backHTML(x, flipped) + '</div></article>';
  }
  function backHTML(x, flipped) {
    var p = x.p, s = cur(x);
    var desc = stripHtml(p.desc || p.description || '');
    var kv = [];
    if (x.type) kv.push(['Type', typeDot(x) + x.type]);
    if (lineageText(p)) kv.push(['Lineage', esc(lineageText(p))]);
    if (p.potency) kv.push(['Potency', (Math.round(p.potency * 10) / 10) + '% total cannabinoids']);
    if (p.grow) kv.push(['Grown', esc(p.grow)]);
    if (p.category) kv.push(['Shelf', esc(p.category)]);
    kv.push(['Sizes', x.sz.map(function (z) { return esc(z.label) + ' ' + money(z.price); }).join(' · ')]);
    var terps = (p.lab && Array.isArray(p.lab.terps) ? p.lab.terps : []).filter(function (t) { return t && t[0] && Number(t[1]) > 0; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 4);
    var tmax = terps.length ? Number(terps[0][1]) : 1;
    var coa = safeUrl(p.coa);
    return '<div class="lld-face lld-back"' + (flipped ? '' : ' aria-hidden="true"') + '>'
      + '<div class="lld-bk-top"><h3>' + esc(p.name) + '</h3><button type="button" class="lld-unflip lld-flipbtn"' + (flipped ? '' : ' tabindex="-1"') + ' aria-label="Flip back">↺ Back</button></div>'
      + '<dl class="lld-bk-kv">' + kv.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'
      + (terps.length ? '<div class="lld-sz">Terpenes (lab)</div><div class="lld-terps">' + terps.map(function (t) {
        return '<div class="lld-terp"><span>' + esc(t[0]) + '</span><u><i style="width:' + Math.max(6, Math.round(t[1] / tmax * 100)) + '%"></i></u><span>' + Number(t[1]).toFixed(2) + '%</span></div>';
      }).join('') + '</div>' : '')
      + '<p class="lld-desc">' + (desc ? esc(desc.slice(0, 700)) + (desc.length > 700 ? '…' : '') : 'The shop has not written a description for this one yet.') + '</p>'
      + '<div class="lld-spacer"></div>'
      + '<div class="lld-foot"><span>' + (coa ? '<a class="lld-lab" href="' + esc(coa) + '" target="_blank" rel="noopener"' + (flipped ? '' : ' tabindex="-1"') + '>Lab data ↗</a>' : 'Ships from ' + esc(storeName(p))) + '</span>'
      + '<span><b style="color:var(--accent)">' + money(s.price) + '</b> · ' + esc(s.label) + '</span></div>'
      + '<button type="button" class="lld-cta lld-add"' + (flipped ? '' : ' tabindex="-1"') + '>＋ Add ' + esc(s.label) + ' to cart</button>'
      + '</div>';
  }
  function setFlip(card, on) {
    var x = list[Number(card.getAttribute('data-i'))];
    if (!x) return;
    state.flipped[x.p.id] = on;
    card.classList.toggle('is-flipped', on);
    var f = card.querySelector('.lld-front'), b = card.querySelector('.lld-back');
    if (on) { f.setAttribute('aria-hidden', 'true'); b.removeAttribute('aria-hidden'); } else { b.setAttribute('aria-hidden', 'true'); f.removeAttribute('aria-hidden'); }
    b.querySelectorAll('button,a').forEach(function (el) { if (on) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', '-1'); });
    f.querySelectorAll('button,a,select').forEach(function (el) { if (on) el.setAttribute('tabindex', '-1'); else el.removeAttribute('tabindex'); });
    var fb = f.querySelector('.lld-foot .lld-flipbtn'); if (fb) fb.setAttribute('aria-expanded', String(on));
  }

  /* ---------- MENU BOARD (kanban) ---------- */
  var BANDS = [[0, 25, 'Under $25'], [25, 50, '$25 – $50'], [50, 100, '$50 – $100'], [100, 200, '$100 – $200'], [200, 1e12, '$200 +']];
  function groupKey(x) {
    if (state.group === 'store') return x.p.storeKey;
    if (state.group === 'cat') return x.p.category || 'Other';
    if (state.group === 'type') return x.type || 'Other';
    var pr = cur(x).price;
    for (var i = 0; i < BANDS.length; i++) if (pr >= BANDS[i][0] && pr < BANDS[i][1]) return 'b' + i;
    return 'b4';
  }
  function groupLabel(k) {
    if (state.group === 'store') return (state.stores[k] || {}).name || k;
    if (state.group === 'price') return BANDS[Number(k.slice(1))][2];
    return k;
  }
  function ticketHTML(x, i) {
    var p = x.p, s = cur(x), pg = perG(s);
    return '<div class="lld-tk' + (x.type ? ' k-' + x.type : '') + '" data-i="' + i + '" data-kind="tk">'
      + (safeUrl(p.image) ? '<img loading="lazy" src="' + esc(safeUrl(p.image)) + '" alt="">' : '<span></span>')
      + '<div><div class="n" title="' + esc(p.name) + '">' + (state.picks[p.id] ? '★ ' : '') + esc(p.name) + '</div>'
      + '<div class="s">' + (state.group === 'store' ? '' : esc(storeName(p)) + ' · ') + typeDot(x) + esc(x.type || p.category || '') + (p.potency ? ' · ' + Math.round(p.potency) + '%' : '') + '</div></div>'
      + (x.sz.length > 1 && !state.size ? sizeSelect(x) : '')
      + '<div class="r"><b>' + money(s.price) + '</b><small>' + esc(s.label) + (pg ? ' · ' + money(pg) + '/g' : '') + '</small>'
      + '<button type="button" class="lld-plus lld-add" aria-label="Add ' + esc(p.name) + ' ' + esc(s.label) + ' to Legal-Leaf Cart">＋ Cart</button></div></div>';
  }
  function boardHTML() {
    var cols = {}, order = [];
    list.forEach(function (x, i) { var k = groupKey(x); if (!cols[k]) { cols[k] = []; order.push(k); } cols[k].push(i); });
    if (state.group === 'store') order.sort(function (a, b) { return storeKeys.indexOf(a) - storeKeys.indexOf(b); });
    else if (state.group === 'price') order.sort();
    else if (state.group === 'type') order.sort(function (a, b) { var o = ['Indica', 'Hybrid', 'Sativa', 'Other']; return o.indexOf(a) - o.indexOf(b); });
    else order.sort(function (a, b) { return cols[b].length - cols[a].length; });
    var groups = [['store', 'Shop'], ['price', 'Price'], ['cat', 'Category'], ['type', 'Strain type']];
    return '<div class="lld-bar" style="margin-top:0"><span class="lld-sz">Columns by</span><div class="lld-chips">' + groups.map(function (g) {
      return '<button type="button" class="lld-chip lld-grp" data-g="' + g[0] + '" aria-pressed="' + (state.group === g[0]) + '">' + g[1] + '</button>';
    }).join('') + '</div></div>'
      + '<div class="lld-board">' + order.map(function (k) {
        var ix = cols[k], n = state.colShown[k] || 12;
        var gs = ix.map(function (i) { return perG(cur(list[i])); }).filter(function (g) { return g != null; });
        var lo = Math.min.apply(null, ix.map(function (i) { return cur(list[i]).price; }));
        return '<section class="lld-col" aria-label="' + esc(groupLabel(k)) + '"><div class="lld-colhd"><h4>' + esc(groupLabel(k)) + '</h4>'
          + '<p>' + ix.length + ' on the shelf · from <b>' + money(lo) + '</b>' + (gs.length ? ' · best <b>' + money(Math.min.apply(null, gs)) + '/g</b>' : '') + '</p></div>'
          + '<div class="lld-colbd">' + ix.slice(0, n).map(function (i) { return ticketHTML(list[i], i); }).join('')
          + (ix.length > n ? '<button type="button" class="lld-colmore" data-col="' + esc(k) + '">Show ' + Math.min(12, ix.length - n) + ' more of ' + (ix.length - n) + '</button>' : '')
          + '</div></section>';
      }).join('') + '</div>';
  }

  /* ---------- DASHBOARD ---------- */
  var COLS = [['az', 'Product'], ['store', 'Shop'], ['cat', 'Category'], ['type', 'Type'], ['strong', 'THC'], [null, 'Size'], ['cheap', 'Price'], ['pg', '$ / gram'], [null, '']];
  var pgRange = [0, 0];
  function rowHTML(x, i) {
    var p = x.p, s = cur(x), pg = perG(s);
    var w = pg == null ? 0 : (pgRange[1] === pgRange[0] ? 100 : Math.round(8 + 92 * (pgRange[1] - pg) / (pgRange[1] - pgRange[0])));
    return '<tr data-i="' + i + '" data-kind="row">'
      + '<td><div class="pn">' + (safeUrl(p.image) ? '<img loading="lazy" src="' + esc(safeUrl(p.image)) + '" alt="">' : '') + '<b>' + (state.picks[p.id] ? '★ ' : '') + esc(p.name) + '</b></div></td>'
      + '<td>' + esc(storeName(p)) + '</td><td>' + esc(p.category || '') + '</td>'
      + '<td>' + (x.type ? typeDot(x) + x.type : '<span style="color:var(--muted)">—</span>') + '</td>'
      + '<td class="num">' + (p.potency ? (Math.round(p.potency * 10) / 10) + '%' : '—') + '</td>'
      + '<td>' + sizeSelect(x) + '</td>'
      + '<td class="num pr">' + money(s.price) + '</td>'
      + '<td>' + (pg == null ? '—' : '<div class="lld-bar2" title="Fuller bar = cheaper per gram"><span class="num">' + money(pg) + '</span><u><i style="width:' + w + '%"></i></u></div>') + '</td>'
      + '<td><button type="button" class="lld-plus lld-add" aria-label="Add ' + esc(p.name) + ' to Legal-Leaf Cart">＋ Cart</button></td></tr>';
  }
  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function tableHTML() {
    var gs = list.map(function (x) { return perG(cur(x)); }).filter(function (g) { return g != null; });
    pgRange = gs.length ? [Math.min.apply(null, gs), Math.max.apply(null, gs)] : [0, 0];
    function best(f) { var b = null; list.forEach(function (x) { var v = f(x); if (v != null && (!b || v < b.v)) b = { v: v, x: x }; }); return b; }
    var cheapG = best(function (x) { return perG(cur(x)); }), cheap = best(function (x) { return cur(x).price; }),
      strong = best(function (x) { return Number(x.p.potency) > 0 ? -Number(x.p.potency) : null; });
    var shops = {}; list.forEach(function (x) { shops[x.p.storeKey] = 1; });
    var sd = sizeDef(state.size);
    var tiles = [
      ['On the shelf', String(list.length), Object.keys(shops).length + ' shop' + (Object.keys(shops).length === 1 ? '' : 's') + ' · ' + (sd.g ? sd.label : 'all sizes')],
      ['Best per gram', cheapG ? money(cheapG.v) : '—', cheapG ? cheapG.x.p.name : 'pick a weighed size'],
      ['Median per gram', gs.length ? money(median(gs)) : '—', sd.g ? 'at ' + sd.label : 'at each product’s size'],
      ['Lowest ticket', cheap ? money(cheap.v) : '—', cheap ? cheap.x.p.name : ''],
      ['Strongest', strong ? (Math.round(-strong.v * 10) / 10) + '%' : '—', strong ? strong.x.p.name : 'no lab totals yet']
    ];
    var n = Math.max(state.shown, PAGE * 2);
    return '<div class="lld-tiles">' + tiles.map(function (t) {
      return '<div class="lld-tile"><small>' + t[0] + '</small><b>' + esc(t[1]) + '</b><span title="' + esc(t[2]) + '">' + esc(t[2]) + '</span></div>';
    }).join('') + '</div>'
      + '<div class="lld-tablewrap"><table class="lld-table"><thead><tr>' + COLS.map(function (c) {
        if (!c[0]) return '<th scope="col"><button type="button" tabindex="-1" disabled style="cursor:default">' + c[1] + '</button></th>';
        var on = state.sort === c[0];
        return '<th scope="col"' + (on ? ' aria-sort="' + (state.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button type="button" class="lld-th" data-s="' + c[0] + '">'
          + c[1] + (on ? (state.dir > 0 ? ' ▴' : ' ▾') : '') + '</button></th>';
      }).join('') + '</tr></thead><tbody>' + list.slice(0, n).map(rowHTML).join('') + '</tbody></table></div>'
      + (list.length > n ? '<div class="lld-moreBtn"><button type="button" class="lld-btn lld-more-cards">Show more rows (' + (list.length - n) + ' left)</button></div>' : '');
  }

  /* ---------- page ---------- */
  var list = [];
  function render() {
    list = visible();
    var picks = picksOf(list);
    var sc = counts('store'), cc = counts('cat');
    var storesHTML = storeKeys.map(function (k) {
      var s = state.stores[k];
      if (!s) return '';
      return '<button type="button" class="lld-st" data-store="' + esc(k) + '" aria-pressed="' + (!!state.on[k]) + '"' + (s.ok ? '' : ' disabled') + '>'
        + (s.img ? '<img src="' + esc(s.img) + '" alt="" loading="lazy">' : '')
        + '<b>' + esc(s.name) + '</b><small>' + (s.ok ? (sc[k] || 0) + ' in stock' : 'unavailable right now') + '</small></button>';
    }).join('');
    var cats = Object.keys(cc).sort(function (a, b) { return cc[b] - cc[a]; });
    var chips = '<button type="button" class="lld-chip" data-cat="" aria-pressed="' + (!state.cat) + '">All</button>'
      + cats.map(function (c) {
        return '<button type="button" class="lld-chip" data-cat="' + esc(c) + '" aria-pressed="' + (state.cat === c) + '">' + esc(c) + '<small>' + cc[c] + '</small></button>';
      }).join('');
    /* the jar row: how many products carry each size, and the cheapest one, under the other filters */
    var pool = base(true);
    var jars = SIZES.map(function (d) {
      var n = 0, lo = null;
      pool.forEach(function (x) { var j = d.g ? matchRow(x.sz, d.k) : x.pick; if (j < 0) return; n++; var pr = x.sz[j].price; if (lo == null || pr < lo) lo = pr; });
      return '<button type="button" class="lld-jar" data-size="' + d.k + '" aria-pressed="' + (state.size === d.k) + '"' + (n || state.size === d.k ? '' : ' disabled') + '>'
        + '<b>' + d.label + '</b><small>' + d.sub + '</small><em>' + (n ? n + ' · from ' + money(lo) : 'none in stock') + '</em></button>';
    }).join('');
    var views = [['cards', '▦ Shelf'], ['board', '☷ Menu board'], ['table', '☰ Dashboard']];
    var now = new Date();
    var body;
    if (!list.length) body = '<div class="lld-empty">Nothing on the shelf matches. Try another size, turn a store back on, or clear the search.</div>';
    else if (state.view === 'board') body = boardHTML();
    else if (state.view === 'table') body = tableHTML();
    else body = '<div class="lld-grid">' + list.slice(0, state.shown).map(cardHTML).join('') + '</div>'
      + (list.length > state.shown ? '<div class="lld-moreBtn"><button type="button" class="lld-btn lld-more-cards">Show more (' + (list.length - state.shown) + ' left)</button></div>' : '');
    var sortOpts = [['pg', 'Best $/g'], ['cheap', 'Cheapest'], ['strong', 'Strongest'], ['fresh', 'Newest'], ['az', 'A–Z'], ['store', 'Shop'], ['cat', 'Category'], ['type', 'Strain type']];
    mount.innerHTML = headHTML('<b>' + state.all.length + '</b> products in stock across <b>' + storeKeys.filter(function (k) { return state.stores[k] && state.stores[k].ok; }).length
        + '</b> partner shops · live menu as of ' + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '. Build one Legal-Leaf Cart across all of them, then check out at each store.')
      + '<div class="lld-label">Pick your size</div><div class="lld-sizes" role="group" aria-label="Pick your size">' + jars + '</div>'
      + (picks.length ? '<div class="lld-label">★ Budtender’s picks · best $/g' + (state.size ? ' at ' + sizeDef(state.size).label : '') + '</div><div class="lld-picks">' + picks.map(function (x) {
        var s = cur(x);
        return '<button type="button" class="lld-pick" data-id="' + esc(x.p.id) + '">' + (safeUrl(x.p.image) ? '<img src="' + esc(safeUrl(x.p.image)) + '" alt="">' : '')
          + '<span><small>' + esc(storeName(x.p)) + '</small><b>' + esc(x.p.name) + '</b><em>' + money(perG(s)) + '/g · ' + esc(s.label) + ' ' + money(s.price) + '</em></span></button>';
      }).join('') + '</div>' : '')
      + '<div class="lld-label">Shop by store</div><div class="lld-stores">' + storesHTML + '</div>'
      + '<div class="lld-label">Category</div><div class="lld-chips">' + chips + '</div>'
      + '<div class="lld-bar"><div class="lld-views" role="group" aria-label="View">' + views.map(function (v) {
        return '<button type="button" class="lld-view" data-view="' + v[0] + '" aria-pressed="' + (state.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div>'
      + '<input type="search" placeholder="Search strains, brands, lineage" aria-label="Search" value="' + esc(state.q) + '">'
      + '<select class="lld-sort" aria-label="Sort">' + sortOpts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>'
      + '<label><input type="checkbox" data-f="trim"' + (state.trim ? ' checked' : '') + '> Trim &amp; shake</label></div>'
      + '<p class="lld-count" aria-live="polite">' + list.length + ' in stock' + (state.size ? ' at ' + sizeDef(state.size).label : '') + '</p>'
      + body
      + '<p class="lld-disc">Products on this page are sold and shipped by the partner shop named on each card, not by Legal-Leaf Market. '
      + 'Only sizes the shop reports in stock are listed; prices and stock come from each shop and can change, and the shop\'s checkout is final and verifies age. '
      + 'Your Legal-Leaf Cart hands each shop its own items at checkout. Affiliate disclosure: Legal-Leaf Market may earn a commission on purchases made through these links, at no extra cost to you. '
      + 'Hemp-derived products are for adults 21+ where legal; check your state\'s rules before ordering.</p>';
    mount.querySelector('.lld-sort').value = state.sort;
  }

  /* re-render one card / ticket / row in place (size change) so the view does not jump */
  function rerenderItem(el) {
    var i = Number(el.getAttribute('data-i')), kind = el.getAttribute('data-kind'), x = list[i];
    if (!x) return;
    var html = kind === 'row' ? rowHTML(x, i) : kind === 'tk' ? ticketHTML(x, i) : cardHTML(x, i);
    var tmp = document.createElement(kind === 'row' ? 'tbody' : 'div');
    tmp.innerHTML = html;
    el.replaceWith(tmp.firstChild);
  }
  function keepScroll(fn) { var y = window.scrollY; fn(); window.scrollTo(0, y); }

  /* ---------- events (delegated, bound once) ---------- */
  var searchTimer = null;
  mount.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || !mount.contains(t)) return;
    var item = t.closest('[data-kind]');
    if (t.classList.contains('lld-add')) {
      var ax = item && list[Number(item.getAttribute('data-i'))];
      if (ax) addCart(ax.p, cur(ax), t);
    } else if (t.classList.contains('lld-flipbtn')) {
      setFlip(item, !item.classList.contains('is-flipped'));
      var target = item.querySelector(item.classList.contains('is-flipped') ? '.lld-unflip' : '.lld-front .lld-foot .lld-flipbtn');
      if (target && e.detail === 0) target.focus();   /* keyboard: keep focus on the visible face */
    } else if (t.classList.contains('lld-st')) {
      var k = t.getAttribute('data-store');
      state.on[k] = !state.on[k];
      if (!storeKeys.some(function (s) { return state.on[s]; })) state.on[k] = true; /* never toggle to an empty shelf */
      state.shown = PAGE; keepScroll(render);
    } else if (t.classList.contains('lld-chip') && t.hasAttribute('data-cat')) {
      state.cat = t.getAttribute('data-cat'); state.shown = PAGE; keepScroll(render);
    } else if (t.classList.contains('lld-jar')) {
      state.size = t.getAttribute('data-size'); state.shown = PAGE; state.colShown = {}; savePref(); keepScroll(render);
    } else if (t.classList.contains('lld-view')) {
      state.view = t.getAttribute('data-view'); state.shown = PAGE; savePref(); keepScroll(render);
    } else if (t.classList.contains('lld-grp')) {
      state.group = t.getAttribute('data-g'); state.colShown = {}; savePref(); keepScroll(render);
    } else if (t.classList.contains('lld-colmore')) {
      var c = t.getAttribute('data-col'); state.colShown[c] = (state.colShown[c] || 12) + 12; keepScroll(render);
    } else if (t.classList.contains('lld-th')) {
      var s = t.getAttribute('data-s');
      if (state.sort === s) state.dir = -state.dir; else { state.sort = s; state.dir = 1; }
      keepScroll(render);
    } else if (t.classList.contains('lld-more-cards')) {
      state.shown = Math.max(state.shown, state.view === 'table' ? PAGE * 2 : 0) + (state.view === 'table' ? PAGE * 2 : PAGE); keepScroll(render);
    } else if (t.classList.contains('lld-pick')) {
      var id = t.getAttribute('data-id');
      var ix = -1; list.forEach(function (x, j) { if (String(x.p.id) === id) ix = j; });
      if (ix < 0) return;
      state.view = 'cards'; state.flipped[id] = true; state.shown = Math.max(state.shown, ix + 1); savePref(); keepScroll(render);
      var card = mount.querySelector('.lld-card[data-i="' + ix + '"]');
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); var ub = card.querySelector('.lld-unflip'); if (ub) ub.focus({ preventScroll: true }); }
    }
  });
  /* A mouse leaving a flipped card flips it back (after a short grace, so grazing the edge does not).
     pointerType tells a real mouse from a finger, so a phone never flips back on its own. */
  var leaveT = {};
  mount.addEventListener('pointerleave', function (e) {
    var c = e.target;
    if (e.pointerType !== 'mouse' || !c.classList || !c.classList.contains('lld-card') || !c.classList.contains('is-flipped')) return;
    var i = c.getAttribute('data-i');
    clearTimeout(leaveT[i]);
    leaveT[i] = setTimeout(function () { if (c.isConnected && !c.matches(':hover')) setFlip(c, false); }, 300);
  }, true);
  mount.addEventListener('change', function (e) {
    var t = e.target;
    var item = t.closest('[data-kind]');
    if (item && t.tagName === 'SELECT') {
      list[Number(item.getAttribute('data-i'))].pick = Number(t.value);
      rerenderItem(item);
      var again = mount.querySelector('[data-kind="' + item.getAttribute('data-kind') + '"][data-i="' + item.getAttribute('data-i') + '"] select');
      if (again) again.focus();
    } else if (t.matches('.lld-sort')) {
      state.sort = t.value; state.dir = 1; state.shown = PAGE; keepScroll(render);
    } else if (t.matches('.lld-bar input[type=checkbox]')) {
      state[t.getAttribute('data-f')] = t.checked; state.shown = PAGE; keepScroll(render);
    }
  });
  mount.addEventListener('input', function (e) {
    if (!e.target.matches('.lld-bar input[type=search]')) return;
    var v = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = v; state.shown = PAGE; keepScroll(render);
      var box = mount.querySelector('.lld-bar input[type=search]');
      if (box) { box.focus(); box.setSelectionRange(v.length, v.length); }
    }, 200);
  });

  /* ---------- Legal-Leaf Cart (multi-store; see the header) ---------- */
  var CART_KEY = 'll_cart';
  var cart = [];
  try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { cart = []; }
  if (!Array.isArray(cart)) cart = [];
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* private mode: lives for this visit */ } }
  function enc(s) { return encodeURIComponent(String(s)); }

  var fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'llc-fab'; fab.setAttribute('aria-label', 'Open Legal-Leaf Cart');
  var ov = document.createElement('div'); ov.className = 'llc-ov';
  var dr = document.createElement('aside'); dr.className = 'llc-dr'; dr.setAttribute('aria-label', 'Legal-Leaf Cart');
  dr.innerHTML = '<div class="llc-hd"><div><h2>Legal-Leaf Cart</h2><p>Build here \u00b7 checkout at each store</p></div>'
    + '<button type="button" class="llc-x" aria-label="Close">\u00d7</button></div><div class="llc-bd"></div><div class="llc-ft"></div>';
  document.body.appendChild(fab); document.body.appendChild(ov); document.body.appendChild(dr);
  function openCart() { renderCart(); ov.classList.add('on'); dr.classList.add('on'); }
  function closeCart() { ov.classList.remove('on'); dr.classList.remove('on'); }
  fab.onclick = openCart; ov.onclick = closeCart; dr.querySelector('.llc-x').onclick = closeCart;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCart(); });

  function badge() {
    var n = cart.reduce(function (a, i) { return a + (i.qty || 1); }, 0);
    fab.innerHTML = '\uD83D\uDED2 Legal-Leaf Cart <span>' + n + '</span>';
  }
  var toastT = null;
  function toast(msg) {
    var old = document.querySelector('.llc-toast'); if (old) old.remove();
    var d = document.createElement('div'); d.className = 'llc-toast'; d.setAttribute('role', 'status'); d.textContent = msg;
    document.body.appendChild(d); clearTimeout(toastT); toastT = setTimeout(function () { d.remove(); }, 2200);
  }

  function addCart(p, s, btn) {
    var key = p.id + '|' + (s.vid || s.label);
    var hit = cart.filter(function (i) { return i.key === key; })[0];
    if (hit) hit.qty = (hit.qty || 1) + 1;
    else cart.push({ key: key, id: p.id, name: p.name, image: safeUrl(p.image), store: (state.stores[p.storeKey] || {}).name || p.store,
      storeKey: p.storeKey, domain: p.domain, cartDomain: p.cartDomain || '', platform: p.platform || 'shopify',
      ref: p.ref || '', refParam: p.refParam || '', coupon: p.coupon || '', url: safeUrl(p.url), productId: p.productId || '',
      cartPath: p.cartPath || '', size: s.label, price: s.price, variantId: s.vid || '', attrs: s.attrs || '', qty: 1 });
    saveCart(); badge(); renderCart();
    toast('Added to Legal-Leaf Cart: ' + s.label);
    if (btn) { var was = btn.getAttribute('data-was') || btn.textContent; btn.setAttribute('data-was', was); btn.textContent = '\u2713 Added'; setTimeout(function () { btn.textContent = was; }, 1400); }
  }

  /* One link per Woo item (Woo's handler takes one add-to-cart per request). */
  function wooUrl(i) {
    var add = '';
    if (i.variantId && i.productId && i.attrs) add = 'add-to-cart=' + enc(i.productId) + '&variation_id=' + enc(i.variantId) + '&' + i.attrs;
    else if (!i.variantId && i.productId) add = 'add-to-cart=' + enc(i.productId);
    /* a variation without its attributes adds nothing on Woo: send the product page instead */
    var qty = 'quantity=' + (i.qty || 1), u;
    if (i.cartPath && add) {
      u = 'https://' + (i.cartDomain || i.domain) + i.cartPath + '?' + add + '&' + qty;
      if (i.ref) u += '&' + enc(i.refParam || 'ref') + '=' + enc(i.ref);
    } else {
      u = i.url || ('https://' + i.domain + '/');
      if (add) u += (u.indexOf('?') >= 0 ? '&' : '?') + add + '&' + qty;
    }
    if (i.coupon) u += (u.indexOf('?') >= 0 ? '&' : '?') + 'coupon_code=' + enc(i.coupon);
    return u;
  }
  function shopifyUrl(items) {
    var first = items[0], qs = [];
    if (first.coupon) qs.push('discount=' + enc(first.coupon));
    if (first.ref) qs.push(enc(first.refParam || 'ref') + '=' + enc(first.ref));
    var q = qs.length ? '?' + qs.join('&') : '';
    var host = first.cartDomain || first.domain;
    var line = items.filter(function (i) { return /^\d+$/.test(String(i.variantId)); })
      .map(function (i) { return i.variantId + ':' + (i.qty || 1); }).join(',');
    return line ? 'https://' + host + '/cart/' + line + q : (first.url || 'https://' + host + '/' + q);
  }
  /* -> [{label, href}] for one store's group */
  function checkoutLinks(store, items) {
    var plat = items[0].platform || 'shopify';
    if (plat === 'shopify') return [{ label: 'Checkout at ' + store + ' \u2192', href: shopifyUrl(items) }];
    if (plat === 'woocommerce') return items.map(function (i, n) {
      return { label: 'Checkout at ' + store + (items.length > 1 ? ' (' + (n + 1) + ' of ' + items.length + ')' : '') + ' \u2192', href: wooUrl(i) };
    });
    return items.map(function (i, n) {
      return { label: 'Checkout at ' + store + (items.length > 1 ? ' (' + (n + 1) + ' of ' + items.length + ')' : '') + ' \u2192', href: i.url || 'https://' + i.domain + '/' };
    });
  }

  function renderCart() {
    var bd = dr.querySelector('.llc-bd'), ft = dr.querySelector('.llc-ft');
    if (!cart.length) {
      bd.innerHTML = '<div class="llc-empty">Your Legal-Leaf Cart is empty.<br>Add products from any shop to build one multi-store cart.</div>';
      ft.innerHTML = ''; return;
    }
    var by = {}, order = [], total = 0;
    cart.forEach(function (i, ix) { if (!by[i.store]) { by[i.store] = []; order.push(i.store); } by[i.store].push({ i: i, ix: ix }); });
    bd.innerHTML = order.map(function (store) {
      var rows = by[store], items = rows.map(function (r) { return r.i; });
      var html = '<div class="llc-st">' + esc(store) + '</div>' + rows.map(function (r) {
        var i = r.i, q = i.qty || 1; total += i.price * q;
        return '<div class="llc-it">' + (i.image ? '<img src="' + esc(i.image) + '" alt="">' : '')
          + '<div style="flex:1;min-width:0"><div class="t">' + esc(i.name) + '</div><div class="s">' + esc(i.size) + '</div>'
          + '<div class="llc-row"><b>' + money(i.price * q) + '</b><button type="button" data-q="-1" data-ix="' + r.ix + '" aria-label="Fewer">\u2212</button>'
          + '<span>' + q + '</span><button type="button" data-q="1" data-ix="' + r.ix + '" aria-label="More">+</button>'
          + '<button type="button" class="rm" data-rm="' + r.ix + '">Remove</button></div></div></div>';
      }).join('');
      var links = checkoutLinks(store, items);
      if (links.length > 1) html += '<p class="llc-nt">' + esc(store) + ' takes one item per checkout link: open each one.</p>';
      html += links.map(function (l) {
        return '<a class="llc-go" href="' + esc(l.href) + '" target="_blank" rel="sponsored nofollow noopener">' + esc(l.label) + '</a>';
      }).join('');
      return html;
    }).join('');
    ft.innerHTML = '<div><b>Subtotal (est.)</b><span>' + money(total) + '</span></div>'
      + '<p>Each store link pre-fills that shop\'s cart with your sizes, applies the coupon, and you check out on that store.</p>';
  }
  dr.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-ix],button[data-rm]');
    if (!b) return;
    if (b.hasAttribute('data-rm')) cart.splice(Number(b.getAttribute('data-rm')), 1);
    else {
      var it = cart[Number(b.getAttribute('data-ix'))];
      it.qty = (it.qty || 1) + Number(b.getAttribute('data-q'));
      if (it.qty < 1) cart.splice(cart.indexOf(it), 1);
    }
    saveCart(); badge(); renderCart();
  });
  window.addEventListener('storage', function (e) {
    if (e.key !== CART_KEY) return;
    try { cart = JSON.parse(e.newValue) || []; } catch (x) { cart = []; }
    badge(); renderCart();
  });
  badge();

  gate(function () {
    load().then(function () {
      if (!state.all.length) {
        mount.innerHTML = headHTML('Back in a minute.') + '<div class="lld-note">The partner shelves did not load. Refresh in a minute.</div>';
        return;
      }
      render();
    });
  });
})();

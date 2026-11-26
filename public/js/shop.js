/* public/js/shop.js -- /shop, Legal-Leaf Market's own storefront.
 *
 * Reads /api/catalog, keeps the cart in localStorage, and posts orders to
 * /api/order, which re-prices them and enforces 21+ and Indiana-only delivery
 * on the server. Payment is cash at delivery; there is no card processing (owner, 26 Nov 2026).
 *
 * Kiosk mode for partner-shop tablets: open /shop?kiosk=<partner-slug>. The
 * partner is remembered for the tab, tagged on every order (for their cut),
 * links that leave the shop are hidden, and the cart clears itself after three
 * idle minutes so the next customer starts fresh.
 */
(function () {
  'use strict';

  var CART_KEY = 'll_store_cart';
  var PAGE = 48;
  var TAX = 0.07;
  var IDLE_MS = 3 * 60 * 1000;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var usd = function (n) { return '$' + Number(n || 0).toFixed(2); };
  var sized = function (url, w) {
    if (!url) return '';
    if (/cdn\.shopify\.com/.test(url)) return url + (url.indexOf('?') > -1 ? '&' : '?') + 'width=' + w;
    return url;
  };

  var state = { products: [], byId: {}, type: '', brand: '', q: '', sort: 'featured', shown: PAGE, fee: 0 };

  /* ---------- kiosk ---------- */
  var params = new URLSearchParams(location.search);
  var kiosk = '';
  try {
    if (params.has('kiosk')) sessionStorage.setItem('ll_kiosk', (params.get('kiosk') || 'kiosk').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'kiosk');
    if (params.get('kiosk') === 'off') sessionStorage.removeItem('ll_kiosk');
    kiosk = sessionStorage.getItem('ll_kiosk') || '';
  } catch (e) { kiosk = params.get('kiosk') || ''; }
  if (kiosk) {
    document.documentElement.classList.add('kiosk');
    var kn = $('#kiosk-name');
    if (kn) kn.textContent = kiosk.replace(/-/g, ' ');
  }

  /* ---------- cart ---------- */
  function readCart() {
    try { var c = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; }
  }
  var cart = readCart();
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* private mode */ }
    renderCount();
  }
  function lineOf(l) {
    var p = state.byId[l.id];
    if (!p) return null;
    var v = p.variants.filter(function (x) { return x.id === l.variant; })[0] || p.variants[0];
    return { p: p, v: v, qty: l.qty };
  }
  function cartLines() { return cart.map(lineOf).filter(Boolean); }
  function totals() {
    var sub = cartLines().reduce(function (s, l) { return s + l.v.price * l.qty; }, 0);
    var fee = cart.length ? state.fee : 0;
    var tax = Math.round((sub + fee) * TAX * 100) / 100;
    return { sub: sub, fee: fee, tax: tax, total: sub + fee + tax };
  }
  function addToCart(id, variant, qty) {
    var hit = cart.filter(function (l) { return l.id === id && l.variant === variant; })[0];
    if (hit) hit.qty = Math.min(20, hit.qty + qty);
    else cart.push({ id: id, variant: variant, qty: Math.min(20, qty) });
    saveCart();
  }
  function renderCount() {
    var n = cart.reduce(function (s, l) { return s + l.qty; }, 0);
    var el = $('#cart-count');
    if (el) el.textContent = String(n);
  }

  /* ---------- catalogue ---------- */
  function load() {
    $('#status').textContent = 'Loading the catalogue...';
    fetch('/api/catalog', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.products = (d && d.products) || [];
        state.fee = Number(d && d.meta && d.meta.deliveryFee) || 0;
        state.byId = {};
        state.products.forEach(function (p) { state.byId[p.id] = p; });
        /* Drop cart lines whose product has gone. */
        cart = cart.filter(function (l) { return state.byId[l.id]; });
        saveCart();
        if (!state.products.length) {
          $('#status').innerHTML = 'The catalogue is not available right now. Please try again shortly, or email <a href="mailto:jake@legalleafmarket.shop">jake@legalleafmarket.shop</a> and we will take your order directly.';
          return;
        }
        buildFilters();
        readUrl();
        render();
        openFromHash();
      })
      .catch(function () {
        $('#status').innerHTML = 'The catalogue could not be loaded. Please refresh, or email <a href="mailto:jake@legalleafmarket.shop">jake@legalleafmarket.shop</a>.';
      });
  }

  function buildFilters() {
    var types = {}, brands = {};
    state.products.forEach(function (p) {
      types[p.type] = (types[p.type] || 0) + 1;
      if (p.brand) brands[p.brand] = (brands[p.brand] || 0) + 1;
    });
    var typeList = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; });
    $('#chips').innerHTML = ['<button type="button" class="chip" data-type="" aria-pressed="true">All</button>']
      .concat(typeList.map(function (t) { return '<button type="button" class="chip" data-type="' + esc(t) + '" aria-pressed="false">' + esc(t) + '</button>'; }))
      .join('');
    var brandSel = $('#brand');
    brandSel.innerHTML = '<option value="">All brands</option>' + Object.keys(brands).sort(function (a, b) { return a.localeCompare(b); })
      .map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + ' (' + brands[b] + ')</option>'; }).join('');
  }

  function readUrl() {
    var u = new URLSearchParams(location.search);
    state.q = u.get('q') || '';
    state.type = u.get('type') || '';
    state.brand = u.get('brand') || '';
    state.sort = u.get('sort') || 'featured';
    $('#q').value = state.q;
    $('#brand').value = state.brand;
    $('#sort').value = state.sort;
  }
  function writeUrl() {
    var u = new URLSearchParams(location.search);
    ['q', 'type', 'brand', 'sort'].forEach(function (k) {
      var v = state[k];
      if (v && !(k === 'sort' && v === 'featured')) u.set(k, v); else u.delete(k);
    });
    var s = u.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }

  function matches(p) {
    if (state.type && p.type !== state.type) return false;
    if (state.brand && p.brand !== state.brand) return false;
    if (state.q) {
      var hay = (p.title + ' ' + p.brand + ' ' + p.type + ' ' + p.tags.join(' ')).toLowerCase();
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
    }
    return true;
  }

  function render() {
    var list = state.products.filter(matches);
    if (state.sort === 'low') list.sort(function (a, b) { return a.price - b.price; });
    else if (state.sort === 'high') list.sort(function (a, b) { return b.price - a.price; });
    else if (state.sort === 'az') list.sort(function (a, b) { return a.title.localeCompare(b.title); });

    Array.prototype.forEach.call(document.querySelectorAll('#chips .chip'), function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-type') === state.type));
    });
    $('#status').textContent = list.length
      ? list.length + (list.length === 1 ? ' product' : ' products') + (state.q ? ' matching "' + state.q + '"' : '')
      : 'Nothing matches that. Try another word, or email us and we will special order it.';

    var shown = list.slice(0, state.shown);
    $('#grid').innerHTML = shown.map(function (p) {
      var was = p.variants[0] && p.variants[0].compareAt > p.price ? '<span class="was">' + usd(p.variants[0].compareAt) + '</span>' : '';
      var from = p.priceMax > p.price ? 'From ' : '';
      return '<button type="button" class="card" data-id="' + esc(p.id) + '">'
        + '<span class="ph">' + (p.image ? '<img loading="lazy" decoding="async" src="' + esc(sized(p.image, 400)) + '" alt="">' : '') + '</span>'
        + '<span class="body">'
        + (p.brand ? '<span class="brand-name">' + esc(p.brand) + '</span>' : '')
        + '<span class="name">' + esc(p.title) + '</span>'
        + (p.ageRestricted ? '<span class="badge21">21+ ID at delivery</span>' : '')
        + '<span class="price">' + from + usd(p.price) + was + '</span>'
        + '</span></button>';
    }).join('');
    var more = $('#more');
    more.hidden = list.length <= state.shown;
    more.textContent = 'Show more (' + (list.length - shown.length) + ' left)';
  }

  /* ---------- product dialog ---------- */
  var pdlg = $('#product');
  var current = null;
  function openProduct(id) {
    var p = state.byId[id];
    if (!p) return;
    current = p;
    var opts = p.variants.length > 1
      ? '<div class="field"><label for="variant">Option</label><select id="variant">' + p.variants.map(function (v) {
        return '<option value="' + esc(v.id) + '">' + esc(v.title || 'Standard') + ' - ' + usd(v.price) + (v.available ? '' : ' (special order)') + '</option>';
      }).join('') + '</select></div>'
      : '';
    var imgs = p.images.length ? p.images : (p.image ? [p.image] : []);
    $('#product-body').innerHTML = '<div class="pd">'
      + '<div><div class="main-img">' + (imgs[0] ? '<img id="pd-img" src="' + esc(sized(imgs[0], 900)) + '" alt="' + esc(p.title) + '">' : '') + '</div>'
      + (imgs.length > 1 ? '<div class="thumbs">' + imgs.map(function (src, i) {
        return '<button type="button" data-src="' + esc(src) + '" aria-current="' + (i === 0) + '" aria-label="Photo ' + (i + 1) + '"><img src="' + esc(sized(src, 120)) + '" alt=""></button>';
      }).join('') + '</div>' : '') + '</div>'
      + '<div>'
      + (p.brand ? '<div class="brand-name fine"><strong>' + esc(p.brand) + '</strong> · ' + esc(p.type) + '</div>' : '<div class="fine">' + esc(p.type) + '</div>')
      + '<h2 id="product-h">' + esc(p.title) + '</h2>'
      + '<div class="price" id="pd-price">' + usd(p.variants[0].price) + '</div>'
      + opts
      + '<div class="qty"><div class="field"><label for="pd-qty">Qty</label><input id="pd-qty" type="number" min="1" max="20" value="1" inputmode="numeric"></div>'
      + '<button type="button" class="btn" id="pd-add">Add to cart</button></div>'
      + (p.ageRestricted ? '<p class="fine"><strong>21+ only.</strong> Hand-delivered in Indiana. We check a valid photo ID at the door and cannot leave this item unattended.</p>' : '<p class="fine">Hand-delivered in Indiana. Pay cash at delivery.</p>')
      + (p.description ? '<div class="desc">' + esc(p.description) + '</div>' : '')
      + '</div></div>';
    var sel = $('#variant');
    if (sel) sel.addEventListener('change', function () {
      var v = p.variants.filter(function (x) { return x.id === sel.value; })[0];
      if (v) $('#pd-price').textContent = usd(v.price);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#product-body .thumbs button'), function (b) {
      b.addEventListener('click', function () {
        $('#pd-img').src = sized(b.getAttribute('data-src'), 900);
        Array.prototype.forEach.call(document.querySelectorAll('#product-body .thumbs button'), function (x) { x.setAttribute('aria-current', String(x === b)); });
      });
    });
    $('#pd-add').addEventListener('click', function () {
      var variant = sel ? sel.value : p.variants[0].id;
      var qty = Math.max(1, Math.min(20, parseInt($('#pd-qty').value, 10) || 1));
      addToCart(p.id, variant, qty);
      pdlg.close();
      openCart();
    });
    if (location.hash !== '#p=' + encodeURIComponent(p.id)) history.replaceState(null, '', location.pathname + location.search + '#p=' + encodeURIComponent(p.id));
    if (!pdlg.open) pdlg.showModal();
  }
  pdlg.addEventListener('close', function () {
    current = null;
    if (/^#p=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  });
  function openFromHash() {
    var m = /^#p=(.+)$/.exec(location.hash);
    if (m) openProduct(decodeURIComponent(m[1]));
  }

  /* ---------- cart drawer ---------- */
  var drawer = $('#cart');
  function renderCart() {
    var lines = cartLines();
    var t = totals();
    $('#cart-lines').innerHTML = lines.length ? lines.map(function (l, i) {
      return '<li><img src="' + esc(sized(l.p.image, 120)) + '" alt="">'
        + '<div><div class="t">' + esc(l.p.title) + '</div>'
        + (l.v.title ? '<div class="o">' + esc(l.v.title) + '</div>' : '')
        + (l.p.ageRestricted ? '<div class="o">21+ ID at delivery</div>' : '')
        + '<div class="q"><button type="button" data-i="' + i + '" data-d="-1" aria-label="One fewer">-</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-d="1" aria-label="One more">+</button>'
        + '<button type="button" class="rm" data-i="' + i + '">Remove</button></div></div>'
        + '<div><strong>' + usd(l.v.price * l.qty) + '</strong></div></li>';
    }).join('') : '<li style="display:block;border:0">Your cart is empty.</li>';
    $('#cart-totals').innerHTML = lines.length
      ? '<div><span>Subtotal</span><span>' + usd(t.sub) + '</span></div>'
        + '<div><span>Local delivery</span><span>' + (t.fee ? usd(t.fee) : 'Free') + '</span></div>'
        + '<div><span>Indiana sales tax (7%)</span><span>' + usd(t.tax) + '</span></div>'
        + '<div class="grand"><span>Total</span><span>' + usd(t.total) + '</span></div>'
      : '';
    $('#to-checkout').disabled = !lines.length;
  }
  $('#cart-lines').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var i = +b.getAttribute('data-i');
    if (!cart[i]) return;
    if (b.classList.contains('rm')) cart.splice(i, 1);
    else {
      cart[i].qty = Math.max(0, Math.min(20, cart[i].qty + (+b.getAttribute('data-d'))));
      if (!cart[i].qty) cart.splice(i, 1);
    }
    saveCart();
    renderCart();
  });
  function openCart() { renderCart(); if (!drawer.open) drawer.showModal(); }

  /* ---------- checkout ---------- */
  var cdlg = $('#checkout');
  var form = $('#order-form');
  function openCheckout() {
    drawer.close();
    $('#order-done').hidden = true;
    form.hidden = false;
    $('#formerr').textContent = '';
    var t = totals();
    $('#co-total').textContent = usd(t.total);
    if (!cdlg.open) cdlg.showModal();
  }
  function fieldErr(name, msg) {
    var input = form.querySelector('[name="' + name + '"]');
    var box = input && input.closest('.field, .check');
    if (!box) return false;
    var e = box.querySelector('.err');
    if (!e) { e = document.createElement('div'); e.className = 'err'; box.appendChild(e); }
    e.textContent = msg;
    return true;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (x) { x.remove(); });
    $('#formerr').textContent = '';
    var f = new FormData(form);
    var body = {
      items: cart.map(function (l) { return { id: l.id, variant: l.variant, qty: l.qty }; }),
      customer: { name: f.get('name'), email: f.get('email'), phone: f.get('phone'), dob: f.get('dob') },
      address: { line1: f.get('line1'), line2: f.get('line2'), city: f.get('city'), state: f.get('state'), zip: f.get('zip') },
      notes: f.get('notes'),
      agree: f.get('agree') === 'on',
      website: f.get('website'),
      channel: kiosk ? 'kiosk' : 'web',
      partner: kiosk || ''
    };
    var btn = $('#place');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        var j = res.j || {};
        if (j.ok) return done(j.order);
        if (j.errors) {
          var loose = [];
          j.errors.forEach(function (er) { if (!fieldErr(er.field, er.message)) loose.push(er.message); });
          $('#formerr').textContent = loose.join(' ') || 'Please check the highlighted fields.';
          return;
        }
        if (j.fallback === 'email') return emailFallback(j);
        $('#formerr').textContent = j.error || 'Something went wrong. Please try again.';
      })
      .catch(function () { $('#formerr').textContent = 'We could not reach the shop. Check your connection and try again.'; })
      .then(function () { btn.disabled = false; btn.textContent = 'Place order'; });
  });

  function done(order) {
    cart = [];
    saveCart();
    form.hidden = true;
    form.reset();
    var box = $('#order-done');
    box.hidden = false;
    box.innerHTML = '<div class="done"><h2>Thank you, your order is in.</h2>'
      + '<p>Your order number is</p><p class="num">' + esc(order.number) + '</p>'
      + '<p>Total ' + usd(order.total) + ', paid in cash at delivery.</p>'
      + '<p>We will call or email to confirm and set a delivery time. Have a valid photo ID ready: the person who ordered must be there, 21 or older, and match the ID.</p>'
      + '<button type="button" class="btn" id="done-ok">' + (kiosk ? 'Start a new order' : 'Keep shopping') + '</button></div>';
    $('#done-ok').addEventListener('click', function () { cdlg.close(); });
  }

  function emailFallback(j) {
    var box = $('#order-done');
    form.hidden = true;
    box.hidden = false;
    var href = 'mailto:' + j.email + '?subject=' + encodeURIComponent('Order ' + (j.order && j.order.number)) + '&body=' + encodeURIComponent(j.text || '');
    box.innerHTML = '<div class="done"><h2>One more step</h2>'
      + '<p>Our order inbox did not answer just now, so your order has not been received yet. Send it to us by email and we will confirm it:</p>'
      + '<p><a class="btn" href="' + esc(href) + '">Email this order</a></p>'
      + '<pre class="ordertext">' + esc(j.text || '') + '</pre></div>';
  }

  /* ---------- wiring ---------- */
  $('#chips').addEventListener('click', function (e) {
    var c = e.target.closest('.chip');
    if (!c) return;
    state.type = c.getAttribute('data-type') || '';
    state.shown = PAGE;
    writeUrl(); render();
  });
  var qTimer;
  $('#q').addEventListener('input', function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = e.target.value.trim(); state.shown = PAGE; writeUrl(); render(); }, 150);
  });
  $('#brand').addEventListener('change', function (e) { state.brand = e.target.value; state.shown = PAGE; writeUrl(); render(); });
  $('#sort').addEventListener('change', function (e) { state.sort = e.target.value; writeUrl(); render(); });
  $('#more').addEventListener('click', function () { state.shown += PAGE; render(); });
  $('#grid').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (c) openProduct(c.getAttribute('data-id'));
  });
  $('#cart-open').addEventListener('click', openCart);
  $('#to-checkout').addEventListener('click', openCheckout);
  Array.prototype.forEach.call(document.querySelectorAll('dialog .x'), function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  });
  window.addEventListener('hashchange', openFromHash);

  /* Kiosk: start over, by hand or after three idle minutes. */
  function startOver() {
    cart = []; saveCart();
    Array.prototype.forEach.call(document.querySelectorAll('dialog[open]'), function (d) { d.close(); });
    form.reset(); form.hidden = false; $('#order-done').hidden = true;
    state.q = ''; state.type = ''; state.brand = ''; state.sort = 'featured'; state.shown = PAGE;
    $('#q').value = ''; $('#brand').value = ''; $('#sort').value = 'featured';
    writeUrl(); render(); window.scrollTo(0, 0);
  }
  if (kiosk) {
    var so = $('#kiosk-reset');
    if (so) so.addEventListener('click', startOver);
    var idle;
    var poke = function () { clearTimeout(idle); idle = setTimeout(startOver, IDLE_MS); };
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, poke, { passive: true }); });
    poke();
  }

  renderCount();
  load();
})();

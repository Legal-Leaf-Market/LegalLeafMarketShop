/* public/js/card-pay.js -- card checkout against the Medusa store (commerce/).
 *
 * DORMANT UNTIL TWO THINGS ARE TRUE, and /shop keeps sending order requests
 * through /api/order until then:
 *   1. /api/catalog is reading the Medusa store (MEDUSA_URL and
 *      MEDUSA_PUBLISHABLE_KEY set in Netlify), so it hands the page meta.store;
 *   2. that store offers the NMI card provider (pp_nmi-card...), which it does
 *      once the PaymentCloud keys are set on the backend.
 * LLCardPay.ready(store) answers both, so the page can decide once at load.
 *
 * THE FLOW, two presses of one button:
 *   "Continue to payment"  builds a Medusa cart from the page's cart, sets the
 *                          delivery address, date of birth and delivery option,
 *                          opens a card payment session and mounts NMI's hosted
 *                          card fields (Collect.js). Card numbers are typed into
 *                          NMI's iframes and never touch this page or our server.
 *   "Pay $X"               asks NMI for a single-use token, puts it on the
 *                          session and completes the cart. The 21+ and
 *                          Indiana-only rules are enforced by the store itself
 *                          (commerce/src/workflows/hooks/age-check.ts); a refusal
 *                          or a declined card comes back as a message to show.
 *
 * Plain ES5-style script on purpose, to match public/js/shop.js.
 */
(function () {
  'use strict';

  function api(store, path, method, body) {
    return fetch(store.url + path, {
      method: method || 'GET',
      headers: { 'content-type': 'application/json', 'x-publishable-api-key': store.key },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.message || ('The store answered ' + r.status));
        return j;
      });
    });
  }

  function cardProvider(store) {
    var q = store.region ? '?region_id=' + encodeURIComponent(store.region) : '';
    return api(store, '/store/payment-providers' + q).then(function (j) {
      var hit = (j.payment_providers || []).map(function (p) { return p.id; })
        .filter(function (id) { return /^pp_nmi-card/.test(id); })[0];
      return hit || null;
    });
  }

  /* Collect.js is one page-level global that cannot be configured twice, so a
     fresh script is loaded for every payment form and removed afterwards. */
  var scriptEl = null;
  function loadCollect(key, sandbox) {
    if (scriptEl) { scriptEl.remove(); scriptEl = null; try { delete window.CollectJS; } catch (e) { window.CollectJS = undefined; } }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = (sandbox ? 'https://sandbox.nmi.com' : 'https://secure.nmi.com') + '/token/Collect.js';
      s.setAttribute('data-tokenization-key', key);
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('The card form did not load. Check your connection and try again.')); };
      document.head.appendChild(s);
      scriptEl = s;
    });
  }

  function Checkout(store, provider) {
    this.store = store;
    this.provider = provider;
    this.cart = null;
    this.collection = null;
    this.valid = {};
    this.onToken = null;
  }

  /* Step 1. lines: [{variant, qty}], who: {name,email,phone,dob},
     where: {line1,line2,city,zip,notes}, mountId: element id for the fields. */
  Checkout.prototype.start = function (lines, who, where, opts) {
    var self = this, s = this.store;
    opts = opts || {};
    return api(s, '/store/carts', 'POST', { region_id: s.region || undefined, email: who.email })
      .then(function (j) {
        self.cart = j.cart;
        return lines.reduce(function (p, l) {
          return p.then(function () {
            return api(s, '/store/carts/' + self.cart.id + '/line-items', 'POST', { variant_id: l.variant, quantity: l.qty });
          });
        }, Promise.resolve());
      })
      .then(function () {
        var parts = String(who.name || '').trim().split(/\s+/);
        var address = {
          first_name: parts[0] || '-', last_name: parts.slice(1).join(' ') || '-',
          address_1: where.line1, address_2: where.line2 || '', city: where.city,
          province: 'IN', postal_code: where.zip, country_code: 'us', phone: who.phone
        };
        return api(s, '/store/carts/' + self.cart.id, 'POST', {
          email: who.email,
          shipping_address: address,
          billing_address: address,
          metadata: { dob: who.dob, notes: where.notes || '', channel: opts.channel || 'web', partner: opts.partner || '' }
        });
      })
      .then(function () { return api(s, '/store/shipping-options?cart_id=' + self.cart.id); })
      .then(function (j) {
        var opt = (j.shipping_options || [])[0];
        if (!opt) throw new Error('Delivery is not available to that address. We deliver in Indiana only.');
        return api(s, '/store/carts/' + self.cart.id + '/shipping-methods', 'POST', { option_id: opt.id });
      })
      .then(function (j) {
        self.cart = j.cart;
        return api(s, '/store/payment-collections', 'POST', { cart_id: self.cart.id });
      })
      .then(function (j) {
        self.collection = j.payment_collection;
        return api(s, '/store/payment-collections/' + self.collection.id + '/payment-sessions', 'POST', { provider_id: self.provider, data: {} });
      })
      .then(function (j) {
        var sessions = (j.payment_collection && j.payment_collection.payment_sessions) || [];
        var session = sessions.filter(function (x) { return x.provider_id === self.provider; })[0];
        var data = (session && session.data) || {};
        if (!data.tokenizationKey) throw new Error('Card payment is not ready yet. Please try again shortly.');
        return loadCollect(data.tokenizationKey, data.sandbox !== false).then(function () { return self.mount(); });
      })
      .then(function () { return { total: self.cart.total, tax: self.cart.tax_total }; });
  };

  Checkout.prototype.mount = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (!window.CollectJS) return reject(new Error('The card form did not load.'));
      var timer = setTimeout(function () { reject(new Error('The card form took too long to load. Please try again.')); }, 20000);
      window.CollectJS.configure({
        variant: 'inline',
        paymentType: 'cc',
        country: 'US',
        currency: 'USD',
        styleSniffer: false,
        fields: {
          ccnumber: { selector: '#nmi-ccnumber', title: 'Card number', placeholder: '0000 0000 0000 0000' },
          ccexp: { selector: '#nmi-ccexp', title: 'Expiry', placeholder: 'MM / YY' },
          cvv: { selector: '#nmi-cvv', title: 'Security code', placeholder: 'CVV' }
        },
        customCss: { 'font-size': '16px', 'background-color': '#ffffff', color: '#22301F' },
        fieldsAvailableCallback: function () { clearTimeout(timer); resolve(); },
        validationCallback: function (field, ok) { self.valid[field] = ok; },
        timeoutDuration: 15000,
        timeoutCallback: function () { if (self.onToken) self.onToken(null, 'The card check timed out. Please try again.'); },
        callback: function (res) {
          if (!self.onToken) return;
          if (res && res.token) self.onToken(res);
          else self.onToken(null, 'Your card details could not be read. Please check them and try again.');
        }
      });
    });
  };

  /* Step 2. Resolves with the order; rejects with a message for the buyer. */
  Checkout.prototype.pay = function () {
    var self = this, s = this.store;
    return new Promise(function (resolve, reject) {
      self.onToken = function (res, err) {
        self.onToken = null;
        if (!res) return reject(new Error(err));
        var c = self.cart, a = c.billing_address || c.shipping_address || {};
        api(s, '/store/payment-collections/' + self.collection.id + '/payment-sessions', 'POST', {
          provider_id: self.provider,
          data: {
            payment_token: res.token,
            payment_method: 'card',
            card_type: res.card && res.card.type,
            card_last4: res.card && res.card.number ? String(res.card.number).slice(-4) : undefined,
            billing: {
              first_name: a.first_name, last_name: a.last_name, address_1: a.address_1, address_2: a.address_2,
              city: a.city, province: a.province, postal_code: a.postal_code, country_code: a.country_code,
              phone: a.phone, email: c.email
            },
            order_description: 'legalleafmarket.shop order'
          }
        })
          .then(function () { return api(s, '/store/carts/' + c.id + '/complete', 'POST'); })
          .then(function (j) {
            if (j.type === 'order' && j.order) return resolve(j.order);
            /* A decline is a 200 with the cart and an error written for the buyer.
               The token is spent either way, so the next try asks NMI again. */
            reject(new Error((j.error && j.error.message) || 'Your payment could not be completed.'));
          })
          .catch(reject);
      };
      try { window.CollectJS.startPaymentRequest(); }
      catch (e) { self.onToken = null; reject(new Error('The card form is not ready. Please try again.')); }
    });
  };

  window.LLCardPay = {
    /* Resolves with a Checkout factory when card payment is available, else null. */
    ready: function (store) {
      if (!store || !store.url || !store.key) return Promise.resolve(null);
      return cardProvider(store)
        .then(function (provider) { return provider ? function () { return new Checkout(store, provider); } : null; })
        .catch(function () { return null; });
    }
  };
})();

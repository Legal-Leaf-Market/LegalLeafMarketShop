/* public/js/store.js -- the /shop page: catalog, cart and checkout.
 *
 * TWO MODES, chosen by public/js/commerce-config.js:
 *   static (default)  products come from /shop/catalog.json; checkout collects
 *                     the order and sends it as a request (email), because no
 *                     card processor is live yet.
 *   live              products and checkout go through the Medusa store API in
 *                     commerce/. The server enforces the 21+ and Indiana-only
 *                     rules (commerce/src/workflows/hooks/age-check.ts); the
 *                     checks here are only for a clear message up front.
 *
 * Nothing on this page claims to verify age. The date of birth is an
 * attestation; the real check is photo ID at the door, and every page says so.
 */
(() => {
  "use strict"
  const CFG = window.LL_COMMERCE || {}
  const LIVE = Boolean(CFG.url && CFG.key)
  const CART_KEY = "ll_store_cart_v1"
  const PAGE = 24
  const $ = (s, el = document) => el.querySelector(s)
  const money = (n) => "$" + Number(n || 0).toFixed(2)
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

  const state = { all: [], sections: [], section: "all", q: "", shown: PAGE }

  // ---------- storage (light per-viewer convenience; never required) ----------
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || [] } catch { return [] } },
    set(v) { try { localStorage.setItem(CART_KEY, JSON.stringify(v)) } catch {} },
  }
  let cart = store.get()
  const saveCart = () => { store.set(cart); paintCount() }

  // ---------- catalog ----------
  async function loadStatic() {
    const r = await fetch("/shop/catalog.json", { cache: "no-cache" })
    if (!r.ok) throw new Error("catalog " + r.status)
    const d = await r.json()
    return { sections: d.sections.filter((s) => s.n > 0), products: d.products }
  }

  async function api(path, opts = {}) {
    const r = await fetch(CFG.url.replace(/\/$/, "") + path, {
      ...opts,
      headers: { "content-type": "application/json", "x-publishable-api-key": CFG.key, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.message || "Request failed (" + r.status + ")")
    return j
  }

  async function loadLive() {
    const out = []
    const { regions } = await api("/store/regions")
    state.region = regions.find((r) => r.currency_code === "usd") || regions[0]
    for (let offset = 0; ; offset += 100) {
      const j = await api(`/store/products?limit=100&offset=${offset}&region_id=${state.region.id}&fields=id,title,handle,description,thumbnail,metadata,*images,*variants,*variants.calculated_price,*collection,*categories`)
      for (const p of j.products) {
        const v = (p.variants || []).map((x) => ({ id: x.id, t: x.title === p.title ? "" : x.title, p: x.calculated_price?.calculated_amount ?? 0, sku: x.sku || "" })).filter((x) => x.p > 0)
        if (!v.length) continue
        out.push({
          h: p.handle, t: p.title, b: p.collection?.title || p.metadata?.vendor || "",
          s: p.categories?.[0]?.handle || "all", a: p.metadata?.age_restricted ? 1 : 0,
          p: Math.min(...v.map((x) => x.p)),
          img: (p.images || []).map((i) => i.url).slice(0, 4).concat(p.thumbnail && !p.images?.length ? [p.thumbnail] : []),
          d: String(p.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900),
          v,
        })
      }
      if (j.products.length < 100) break
    }
    const seen = new Map()
    for (const p of out) seen.set(p.s, (seen.get(p.s) || 0) + 1)
    return { sections: [...seen].map(([id, n]) => ({ id, name: id.replace(/-/g, " "), n })), products: out }
  }

  // ---------- render ----------
  function filtered() {
    const q = state.q.trim().toLowerCase()
    return state.all.filter((p) =>
      (state.section === "all" || p.s === state.section) &&
      (!q || (p.t + " " + p.b).toLowerCase().includes(q)))
  }

  function paintSections() {
    const total = state.all.length
    const chips = [{ id: "all", name: "Everything", n: total }, ...state.sections]
    $("[data-sections]").innerHTML = chips.map((s) =>
      `<button type="button" role="tab" class="chip" data-sec="${esc(s.id)}" aria-selected="${s.id === state.section}">${esc(s.name)} <span>${s.n}</span></button>`).join("")
  }

  function card(p) {
    const img = p.img[0]
      ? `<img src="${esc(p.img[0])}" alt="" loading="lazy" decoding="async">`
      : `<span class="noimg" aria-hidden="true">No photo yet</span>`
    return `<li class="card">
      <button type="button" class="card-hit" data-open="${esc(p.h)}" aria-label="${esc(p.t)}, ${p.v.length > 1 ? "from " : ""}${money(p.p)}">
        <span class="card-img">${img}</span>
        <span class="card-body">
          ${p.b ? `<span class="card-brand">${esc(p.b)}</span>` : ""}
          <span class="card-title">${esc(p.t)}</span>
          <span class="card-price">${p.v.length > 1 ? "from " : ""}${money(p.p)}</span>
          ${p.a ? `<span class="tag21">21+ &middot; ID at delivery</span>` : ""}
        </span>
      </button>
    </li>`
  }

  function paintGrid() {
    const list = filtered()
    const grid = $("[data-grid]")
    grid.innerHTML = list.slice(0, state.shown).map(card).join("")
    $("[data-status]").textContent = list.length
      ? `${list.length} item${list.length === 1 ? "" : "s"}${state.q ? ` matching "${state.q}"` : ""}`
      : "Nothing matches that. Try another word or section."
    $("[data-more]").hidden = list.length <= state.shown
  }

  function openProduct(handle) {
    const p = state.all.find((x) => x.h === handle)
    if (!p) return
    const dlg = $("[data-product]")
    const imgs = p.img.length ? p.img : []
    const opts = p.v.length > 1
      ? `<label class="field"><span>Option</span><select data-variant>${p.v.map((v, i) => `<option value="${i}">${esc(v.t || "Standard")} &middot; ${money(v.p)}</option>`).join("")}</select></label>`
      : ""
    $("[data-pd]", dlg).innerHTML = `
      <div class="pd-media">${imgs.length ? `<img src="${esc(imgs[0])}" alt="${esc(p.t)}" data-main>` : `<span class="noimg">No photo yet</span>`}
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) => `<button type="button" data-thumb="${esc(src)}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </div>
      <div class="pd-info">
        ${p.b ? `<p class="card-brand">${esc(p.b)}</p>` : ""}
        <h2 id="pd-title">${esc(p.t)}</h2>
        <p class="pd-price" data-pd-price>${money(p.v[0].p)}</p>
        <p class="sold-by">Sold by Legal-Leaf Market &middot; hand-delivered in Columbus, IN</p>
        ${p.a ? `<p class="warn21"><strong>21+ only.</strong> We check a valid photo ID at delivery and will not hand this over without one.</p>` : ""}
        ${opts}
        <div class="qty-row">
          <label class="field qty"><span>Qty</span><input type="number" min="1" max="20" value="1" data-qty></label>
          <button type="button" class="btn btn-main" data-add="${esc(p.h)}">Add to cart</button>
        </div>
        ${p.d ? `<p class="pd-desc">${esc(p.d)}</p>` : ""}
        <p class="pd-note">Most items are special order and arrive in a few days. We text you a delivery time.</p>
      </div>`
    dlg.showModal()
  }

  // ---------- cart ----------
  const cartTotal = () => cart.reduce((s, l) => s + l.price * l.qty, 0)
  const cartHas21 = () => cart.some((l) => l.a)
  function paintCount() {
    const n = cart.reduce((s, l) => s + l.qty, 0)
    document.querySelectorAll("[data-cart-count]").forEach((el) => (el.textContent = n))
  }

  function addToCart(handle) {
    const p = state.all.find((x) => x.h === handle)
    const dlg = $("[data-product]")
    const vi = Number($("[data-variant]", dlg)?.value || 0)
    const qty = Math.max(1, Math.min(20, Number($("[data-qty]", dlg)?.value) || 1))
    const v = p.v[vi]
    const key = p.h + "::" + (v.id ?? vi)
    const line = cart.find((l) => l.key === key)
    if (line) line.qty = Math.min(20, line.qty + qty)
    else cart.push({ key, h: p.h, vid: v.id, title: p.t, opt: v.t, price: v.p, qty, a: p.a, img: p.img[0] || "" })
    saveCart()
    dlg.close()
    openCart()
  }

  function paintCart(view = "lines") {
    const body = $("[data-cart-body]")
    if (!cart.length) {
      body.innerHTML = `<p class="empty">Your cart is empty.</p>`
      return
    }
    if (view === "checkout") return paintCheckout(body)
    if (view === "done") return
    body.innerHTML = `
      <ul class="lines">${cart.map((l, i) => `
        <li class="line">
          ${l.img ? `<img src="${esc(l.img)}" alt="">` : `<span class="noimg sm"></span>`}
          <div class="line-main">
            <p class="line-title">${esc(l.title)}${l.opt ? ` <span>&middot; ${esc(l.opt)}</span>` : ""}</p>
            <p class="line-sub">${money(l.price)} each${l.a ? ` &middot; <span class="tag21 sm">21+</span>` : ""}</p>
            <div class="line-qty">
              <button type="button" data-dec="${i}" aria-label="One fewer">&minus;</button>
              <span>${l.qty}</span>
              <button type="button" data-inc="${i}" aria-label="One more">+</button>
              <button type="button" class="link" data-rm="${i}">Remove</button>
            </div>
          </div>
          <p class="line-total">${money(l.price * l.qty)}</p>
        </li>`).join("")}
      </ul>
      <dl class="sums">
        <div><dt>Subtotal</dt><dd>${money(cartTotal())}</dd></div>
        <div><dt>Delivery, Columbus IN</dt><dd>Free</dd></div>
        <div><dt>Indiana sales tax (7%)</dt><dd>${money(cartTotal() * 0.07)}</dd></div>
        <div class="grand"><dt>Total</dt><dd>${money(cartTotal() * 1.07)}</dd></div>
      </dl>
      <button type="button" class="btn btn-main wide" data-checkout>Check out</button>
      <p class="fine">Adults 21+ only. Photo ID is checked at delivery for every order.</p>`
  }

  function paintCheckout(body) {
    body.innerHTML = `
      <form class="checkout" data-checkout-form novalidate>
        <p class="step-note">${LIVE
          ? "Card payment is taken on the next step."
          : "<strong>Card checkout opens soon.</strong> For now, send your order and we will text you to confirm it, arrange delivery and take card payment. No cash."}</p>
        <fieldset>
          <legend>You</legend>
          <label class="field"><span>Full name</span><input name="name" autocomplete="name" required></label>
          <label class="field"><span>Mobile phone</span><input name="phone" type="tel" autocomplete="tel" required></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Date of birth</span><input name="dob" type="date" required></label>
        </fieldset>
        <fieldset>
          <legend>Delivery address (Indiana only)</legend>
          <label class="field"><span>Street address</span><input name="address" autocomplete="street-address" required></label>
          <div class="two">
            <label class="field"><span>City</span><input name="city" autocomplete="address-level2" value="Columbus" required></label>
            <label class="field"><span>ZIP</span><input name="zip" inputmode="numeric" autocomplete="postal-code" pattern="4[67]\\d{3}" required></label>
          </div>
          <label class="field"><span>Notes for delivery (optional)</span><textarea name="notes" rows="2"></textarea></label>
        </fieldset>
        <label class="check"><input type="checkbox" name="adult" required>
          <span>I am 21 or older, and I will show a valid photo ID at delivery. I understand the order will not be handed over without one.</span></label>
        <label class="check"><input type="checkbox" name="terms" required>
          <span>I agree to the <a href="/terms" target="_blank">Terms</a> and the <a href="/returns" target="_blank">Returns policy</a>.</span></label>
        <p class="err" data-err role="alert"></p>
        <div class="actions">
          <button type="button" class="btn btn-alt" data-back>Back to cart</button>
          <button type="submit" class="btn btn-main">${LIVE ? "Continue to payment" : "Send order request"} &middot; ${money(cartTotal() * 1.07)}</button>
        </div>
      </form>`
  }

  function ageOn(dob) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || "")
    if (!m) return -1
    const now = new Date()
    let age = now.getFullYear() - +m[1]
    if (now.getMonth() + 1 < +m[2] || (now.getMonth() + 1 === +m[2] && now.getDate() < +m[3])) age--
    return age
  }

  async function submitCheckout(form) {
    const f = Object.fromEntries(new FormData(form))
    const err = (msg) => { $("[data-err]", form).textContent = msg; return false }
    if (!form.checkValidity()) return err("Please fill in every field and tick both boxes.")
    if (ageOn(f.dob) < 21) return err("You must be 21 or older to order from Legal-Leaf Market.")
    if (!/^4[67]\d{3}$/.test(f.zip)) return err("We deliver in Indiana only. Please use an Indiana ZIP code.")

    if (LIVE) return submitLive(f, err)

    // Static mode: an order REQUEST by email. Nothing is charged.
    const lines = cart.map((l) => `${l.qty} x ${l.title}${l.opt ? " (" + l.opt + ")" : ""} @ ${money(l.price)}`).join("\n")
    const bodyText = `Order request\n\n${lines}\n\nSubtotal ${money(cartTotal())}\nTax (7%) ${money(cartTotal() * 0.07)}\nTotal ${money(cartTotal() * 1.07)}\n\nName: ${f.name}\nPhone: ${f.phone}\nEmail: ${f.email}\nDOB: ${f.dob}\nAddress: ${f.address}, ${f.city}, IN ${f.zip}\nNotes: ${f.notes || "-"}\n\nConfirmed 21+ and will show photo ID at delivery.`
    location.href = `mailto:jake@legalleafmarket.shop?subject=${encodeURIComponent("Order request: " + f.name)}&body=${encodeURIComponent(bodyText)}`
    $("[data-cart-body]").innerHTML = `<div class="done"><h3>Almost there</h3>
      <p>Your email app should have opened with the order filled in. Press send there and we will text
      <strong>${esc(f.phone)}</strong> to confirm and set a delivery time.</p>
      <p>If nothing opened, email <a href="mailto:jake@legalleafmarket.shop">jake@legalleafmarket.shop</a>
      or text <a href="sms:+18126711780">(812) 671-1780</a> with your order.</p>
      <button type="button" class="btn btn-alt" data-clear>Clear cart</button></div>`
    return true
  }

  async function submitLive(f, err) {
    try {
      const { cart: c } = await api("/store/carts", { method: "POST", body: { region_id: state.region.id } })
      for (const l of cart) await api(`/store/carts/${c.id}/line-items`, { method: "POST", body: { variant_id: l.vid, quantity: l.qty } })
      const [first, ...rest] = f.name.trim().split(/\s+/)
      await api(`/store/carts/${c.id}`, { method: "POST", body: {
        email: f.email,
        shipping_address: { first_name: first, last_name: rest.join(" ") || "-", address_1: f.address, city: f.city, province: "IN", postal_code: f.zip, country_code: "us", phone: f.phone },
        metadata: { dob: f.dob, notes: f.notes || "" },
      } })
      const { shipping_options } = await api(`/store/shipping-options?cart_id=${c.id}`)
      await api(`/store/carts/${c.id}/shipping-methods`, { method: "POST", body: { option_id: shipping_options[0].id } })
      // Card entry (NMI Collect.js) is wired in once the merchant account's
      // tokenization key exists; see commerce/src/modules/nmi-payment.
      sessionStorage.setItem("ll_checkout_cart", c.id)
      return err("Card payment is being switched on. Your cart is saved; please text (812) 671-1780 to finish this order.")
    } catch (e) {
      return err(e.message)
    }
  }

  function openCart(view) { paintCart(view); const d = $("[data-cart]"); if (!d.open) d.showModal() }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a")
    if (!t) return
    if (t.dataset.open) return openProduct(t.dataset.open)
    if (t.dataset.thumb) { $("[data-main]").src = t.dataset.thumb; return }
    if (t.dataset.add) return addToCart(t.dataset.add)
    if (t.hasAttribute("data-open-cart")) return openCart()
    if (t.dataset.sec) { state.section = t.dataset.sec; state.shown = PAGE; paintSections(); paintGrid(); return }
    if (t.hasAttribute("data-more")) { state.shown += PAGE; paintGrid(); return }
    if (t.dataset.inc) { cart[+t.dataset.inc].qty = Math.min(20, cart[+t.dataset.inc].qty + 1); saveCart(); return paintCart() }
    if (t.dataset.dec) { const l = cart[+t.dataset.dec]; l.qty--; if (l.qty < 1) cart.splice(+t.dataset.dec, 1); saveCart(); return paintCart() }
    if (t.dataset.rm) { cart.splice(+t.dataset.rm, 1); saveCart(); return paintCart() }
    if (t.hasAttribute("data-checkout")) return paintCart("checkout")
    if (t.hasAttribute("data-back")) return paintCart()
    if (t.hasAttribute("data-clear")) { cart = []; saveCart(); return paintCart() }
  })
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-variant]")) {
      const p = state.all.find((x) => x.h === $("[data-add]").dataset.add)
      $("[data-pd-price]").textContent = money(p.v[+e.target.value].p)
    }
  })
  document.addEventListener("submit", (e) => {
    if (e.target.matches("[data-checkout-form]")) { e.preventDefault(); submitCheckout(e.target) }
  })
  let qTimer
  document.addEventListener("input", (e) => {
    if (!e.target.matches("[data-search]")) return
    clearTimeout(qTimer)
    qTimer = setTimeout(() => { state.q = e.target.value; state.shown = PAGE; paintGrid() }, 150)
  })
  // A dialog closes on a click on its own backdrop.
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close() }))

  // ---------- boot ----------
  document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()))
  paintCount()
  ;(LIVE ? loadLive() : loadStatic())
    .then(({ sections, products }) => {
      state.sections = sections
      state.all = products
      const want = new URLSearchParams(location.search).get("section")
      if (want && sections.some((s) => s.id === want)) state.section = want
      paintSections()
      paintGrid()
      const h = new URLSearchParams(location.search).get("p")
      if (h) openProduct(h)
    })
    .catch(() => {
      $("[data-status]").innerHTML = 'The catalog did not load. Please refresh, or call or text <a href="tel:+18126711780">(812) 671-1780</a> to order.'
    })
})()

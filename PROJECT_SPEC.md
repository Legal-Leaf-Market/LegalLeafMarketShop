# Legal-Leaf Market — Rebuild Spec (for Vercel)

> **Historical.** This spec was written when the host was Vercel. Production moved to Netlify in
> October 2026: `vercel.json` is now `netlify.toml` + `netlify/`, and Vercel Web Analytics is gone
> (`LL.track` still reports through gtag and `/api/track`). `CLAUDE.md` §2–§4 is the current word.

> Everything an agent needs to rebuild/extend this project accurately. Host target: **Vercel**.

## 1. Short description
Legal-Leaf Market is a **price-comparison marketplace for legal hemp/THCA products** (flower,
pre-rolls, concentrates, vapes, edibles, CBD) **plus smoking hardware** (glass, grinders, vapes,
rolling gear). It aggregates live inventory from ~17 independent online stores, normalizes it, and
lets shoppers **compare by price-per-gram, filter by store/category/stock, and build a multi-store
cart** that hands off to each retailer's checkout (affiliate-tracked). Audience: US + intl legal-hemp
shoppers arriving mostly from Instagram. Core flow: **land → browse/filter the grid → open a product
or add to a cross-store cart → check out on the source store** (Legal-Leaf earns affiliate commission).

## 2. Design reference
Custom dark, "psychedelic glassmorphism" theme (deep green/navy gradients, paisley hero, rainbow-gradient
SVG icons that hue-cycle). Already fully implemented in the HTML/CSS — **treat the existing pages as the
design source of truth** (no redesign). Signature elements: gradient page wordmarks, per-page accent
colors (Consumables=green, Devices=violet/cyan, International=blue/gold, Greek Glass=its own page), a
store-logo strip that doubles as filter buttons with live Airbnb-style match counts, and a "Sold Out"
toggle.

## 3. Code / content to carry over (all included)
```
public/index.html          Main comparison grid (largest app; logic packed as base64 bundle "var B")
public/consumables.html    Satellite page (group = consumables)          -> /consumables
public/devices.html        Satellite page (group = devices; Greek Glass also appears here) -> /devices
public/international.html   Satellite page (mode = intl; local currency)  -> /international
public/greekglass.html     Dedicated Greek Glass storefront (Big Cartel, flip cards, bookmarklet checkout) -> /greekglass
public/og-image.png, favicon.svg, robots.txt, sitemap.xml
api/products.js            LIVE scraper -> /api/products   (Shopify + WooCommerce + Squarespace + BigCommerce)
api/subscribe.js           Email/CRM capture -> /api/subscribe (POST)
api/track.js               Optional custom-event sink -> /api/track (POST)
vercel.json                Clean-URL rewrites + cache headers
```
The frontend is host-agnostic: pages call `/api/products` (falling back to a baked seed), post signups
to `/api/subscribe`, and fire analytics via `LL.track()` (Vercel Web Analytics `va()` + optional webhook).

## 4. Data model
No relational DB required for the site to run — the **product catalog is fetched live** and cached.
Canonical **product object** (what every page consumes and `/api/products` returns):
```
{ id, storeKey, store, name, image, gallery[], url,
  cannabinoid, category, type, grow, potency,
  sale, startsAt, perG, per100, ship, inStock, added, badges[],
  intl(bool), cur("USD"|"EUR"…), ref, refLink, coupon, domain, cartDomain, platform,
  sizes: [ [label, price, grams, variantId, available, compareAt, variantImage], … ] }
```
**Cart** is client-side `localStorage` key `ll_cart` (array of the above, trimmed).
**CRM / members** (optional): email, name, consent, watch[] (watchlist), site, tz, updated — persisted
either in a **Google Sheet** (via the existing Apps Script `llSubscribe` web app) or a Resend audience.
If you want a DB instead, a single `members` table (email PK, name, consent, watch JSON, created, updated)
+ an `events` table (ts, name, page, session, store, product, value) covers it.

## 5. Integrations
- **External store APIs (read-only scraping):** Shopify `/products.json`, WooCommerce Store API
  (`/wp-json/wc/store/v1/products`), Squarespace `?format=json`, BigCommerce category HTML.
  Greek Glass = **Big Cartel** public API, loaded client-side.
- **Affiliate:** GoAffPro / Shopify discount+ref links (`?ref=coffeeandajoint`, coupon `JACOBKENNEDY`).
- **Analytics:** Vercel Web Analytics (`va()` — enable in the Vercel dashboard). `LL.track` also
  supports GA4 (`gtag`) and an optional server webhook.
- **Email / CRM:** Resend (restock + weekly digest) and/or a Google-Sheet CRM via Apps Script webhook.
  **Auth:** lightweight email-identity accounts (localStorage) — no password provider.
  **Payments:** none on-site; checkout happens on each source store.
- **AI (optional, in code.html):** Groq for strain descriptions. **Storage:** Google Drive/Dropbox for
  COA (lab-result) files — mapping not yet ported to the API (see TODO).

## 6. Host target
**Vercel.** Static pages in `public/`, serverless functions in `api/`, clean URLs via `vercel.json`.
Deploy by dragging the project/zip to vercel.com/new (no Git needed), then add the domain in
Settings → Domains. Env vars (all optional) documented in `README.md`.

### TODO carried from Apps Script `code.html` (not blocking launch)
- COA file mapping (Drive/Dropbox) and the `?coa=` view links.
- Groq strain-info enrichment.
- Fine per-store tuning already handled for the main stores; Bloomz `preferWoo` and Black-Tie cart-host
  are ported.

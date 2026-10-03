# Legal-Leaf Market — v2 (Netlify)

Static pages + serverless functions. No build step, no framework.

> **`CLAUDE.md` is the operating guide and is kept current; this file is the short version.**
> Hosting moved from Vercel to Netlify in October 2026 — see `CLAUDE.md` §2.

## What's in here
```
netlify.toml         production config: publish dir, redirects, headers
netlify/             the function that runs api/ on Netlify, and the two nightly schedules
package.json         (Node ≥18, zero deps — native fetch)
api/
  products.js        LIVE product scraper (Shopify + WooCommerce + Squarespace) -> /api/products
  subscribe.js       email/CRM capture -> /api/subscribe   (POST)
  track.js           optional custom-event sink -> /api/track (POST)
public/
  og-image.png       1200x630 social card
  favicon.svg        site icon
  robots.txt         (already points at the sitemap)
  sitemap.xml        clean-URL sitemap
  index.html         <-- YOU ADD  (your main page)
  consumable.html    <-- YOU ADD  (served at /consumables)
  devices.html       <-- YOU ADD  (served at /devices)
  international.html  <-- YOU ADD  (served at /international)
  greekglass.html    <-- YOU ADD  (served at /greekglass)
```

## Deploy
Push to `main` on GitHub (`Legal-Leaf-Market/LegalLeafMarketShop`); Netlify deploys it. Every pull
request gets a Deploy Preview. There is nothing to build: `netlify.toml` publishes `public/` and
points Netlify at `netlify/functions/`.

Custom domain: Netlify → Domain management → add `legal-leafmarket.com` (+ `www`) and follow the DNS
records. Netlify provisions SSL.

`/api/products` serves the live catalog; the pages already fall back to it automatically (they were
built host-agnostic).

## URLs
- `/` → `public/index.html`
- `/consumables` → `consumable.html`  •  `/devices`, `/international`, `/greekglass` likewise
- `/api/products` → JSON catalog (`?debug` shows per-store counts, `?refresh` busts cache)
- `/api/subscribe` (POST), `/api/track` (POST)

## Environment variables (Netlify → Project configuration → Environment variables)
All optional — the site works without them.

| Var | Purpose |
|---|---|
| `LL_CRM_WEBHOOK`     | Keep your **Google Sheet CRM**: deploy `code.html`'s `llSubscribe` as an Apps Script **Web App** and paste its `/exec` URL here. `/api/subscribe` forwards each signup to it. |
| `RESEND_API_KEY`     | Enable Resend emails (restock/weekly). |
| `RESEND_AUDIENCE_ID` | If set with the key, new signups are added to this Resend audience. |
| `LL_EVENTS_WEBHOOK`  | Optional: forward `LL.track` events to an Apps Script `llTrackEvent` Web App |

## Notes / TODO (from your Apps Script `code.html`)
`api/products.js` is a faithful port of the **Shopify / WooCommerce / Squarespace** scrapers
and the classifier (cannabinoid/category/exclusions, accessory categories, intl + currency,
price-per-gram). Still to port when you send `code.html`:
- **BigCommerce** (THCa Hempire) scrape
- **COA mapping** (Drive folders / Dropbox) and **Groq** strain info
- Any per-store tuning (collection lists, Black Tie cart host, Bloomz preferWoo edge cases)

**Greek Glass** is intentionally NOT in `/api/products` — the pages load it client-side from
Big Cartel (baked seed + live refresh), exactly like today.

## Caching
`/api/products` caches in-memory for 30 min per warm instance, and Netlify's CDN caches the JSON
at the edge (the handler's `s-maxage` / `stale-while-revalidate`, see `netlify/lib/edge-headers.mjs`). Use `/api/products?refresh` to force a
fresh scrape.

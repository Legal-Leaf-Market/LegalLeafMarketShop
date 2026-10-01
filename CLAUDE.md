# CLAUDE.md — Operating guide for Legal-Leaf Market

This file tells an AI code editor (Claude Code, Vercel Agent, v0) how this repo actually
works. **Read it fully before editing.** Several systems here look editable but will break
in non-obvious ways if you touch them wrong. When in doubt, prefer the smallest possible
change and verify in a preview before merging.

---

## 1. What this project is

A **static site + serverless API** for `legal-leafmarket.com`. It compares live cannabis /
CBD / hemp product deals scraped from ~16 stores.

- **No framework. No build step.** It is plain HTML in `public/` plus zero-dependency
  Node functions in `api/`. There is no React, no bundler, no `npm run build`.
- **Node ≥ 18**, native `fetch`, `"type": "module"`. `dependencies` is intentionally empty.

```
vercel.json          Routing: clean URLs, redirects, framework:null, outputDirectory:public
package.json         Node ≥18, zero deps, scripts run server.mjs (LOCAL ONLY — see §4)
server.mjs           Local preview server. Vercel IGNORES this. Do not rely on it in prod.
api/
  products.js        LIVE scraper (Shopify + WooCommerce + Squarespace) -> /api/products
  subscribe.js       Email capture -> /api/subscribe (POST)
  track.js           Event sink -> /api/track (POST)
public/
  index.html         Main page (deals grid, filters, admin mode, COA modal)
  consumables.html   served at /consumables      devices.html      -> /devices
  international.html  -> /international            greekglass.html   -> /greekglass
  og-image.png favicon.svg robots.txt sitemap.xml
```

---

## 2. Deploy model (how code goes live)

```
Editor edits -> commit / PR to GitHub (Legal-Leaf-Market/Code_Backup) -> Vercel auto-deploys
```

- GitHub is the **single source of truth**. Vercel builds from it automatically on push/merge
  to the production branch. Claude Code, the Vercel Agent, and v0 all feed the same repo.
- Because `vercel.json` sets `framework: null` + `outputDirectory: public`, Vercel just serves
  `public/` statically and runs each file in `api/` as a serverless function. **Do not add a
  Next.js / Vite / build pipeline** — it will break this and re-trigger the old
  "No Next.js version detected" failure. If a deploy fails, check `vercel.json` first.
- **The dashboard disagrees with the repo, and `vercel.json` is the one winning.** Read off the
  project API on 12 Aug 2026, the Vercel project's own Framework Preset is **`nextjs`** while
  `vercel.json` says `framework: null`. Deploys work because the file overrides the dashboard —
  so this is latent, not broken. What it means is that the protection against the old
  "No Next.js version detected" failure rests on **one line in one file**: trim or reformat that
  key and the dashboard's setting takes over, Vercel starts looking for a Next.js build, and the
  failure comes back looking like it came from nowhere. The dashboard setting should be **Other**
  (Settings → Build & Deployment → Framework Preset); until it is, treat `framework: null` as
  load-bearing rather than decorative. Note the project also reports `nodeVersion: 24.x` against
  this repo's stated Node ≥ 18 floor, which is compatible and worth knowing when a runtime
  behaviour differs from a local check.

---

## 3. Routing rules (`vercel.json`) — filenames must match clean URLs

`cleanUrls: true` means `public/foo.html` is served at `/foo`. **The filename must match the
URL the nav links to.** A past outage was caused by linking `/consumables` while the file was
`consumable.html`. If you rename a page, update `vercel.json` and every nav link together.
Keep the singular→plural redirect (`/consumable` -> `/consumables`) for safety.

**Routing lives in TWO files that MUST stay in sync:**

- **`vercel.json`** — the `rewrites` / `redirects` arrays. This is what **production** (Vercel)
  actually uses.
- **`server.mjs`** — a **separate, hardcoded `REWRITES` / redirects map** for the local/preview
  server (§4). It does NOT read `vercel.json`.

Every page route must be listed in **both**. When you add, rename, or remove a page, update the
matching entry in `vercel.json` AND `server.mjs`, and point each at the correct `*.html`
filename.

**Except that a plain page needs neither, and the `"/x": "/x.html"` entries never fire.**
Measured 17 Aug 2026 while adding a second city: `cleanUrls:true` makes Vercel serve
`public/foo.html` at `/foo` with no rewrite at all, and `serveStatic()` in `server.mjs`
resolves an extensionless path to `.html` itself (`tryFiles`). The filesystem answers
`/privacy` before either rewrite map is consulted, so the dozen `/x -> /x.html` rules are
inert — `server.mjs` says so in its own comment beside `/p/theloudpack`, which is the one
rewrite that *did* fire and was broken by exactly this (an `.html` destination is a path
Vercel has already redirected away from by the time rewrites run). Keep listing them for
symmetry if you like; do not believe a new page is broken because you forgot one, and do
not "fix" an inert one by adding `.html` to the local map. `test-market-add.mjs` proves it
by serving a page with no entry anywhere and asserting a 200. **A REDIRECT is a different
matter and does fire** — `/coldwater-list -> /trip` is real in both files. A real bug came from renaming `consumable.html` → `consumables.html`, updating
`vercel.json`, but leaving `server.mjs` pointing at the deleted `consumable.html` — production
worked while the popped-out preview 404'd. Because the preview can lie either way, after a
routing change verify every route in BOTH the local preview and a Vercel deploy.

---

## 4. `server.mjs` is LOCAL-PREVIEW ONLY

`server.mjs` mirrors the `vercel.json` rewrites/redirects and runs the `api/` functions so the
site works in local/preview. **Vercel never runs it in production.** Two consequences:

- Production behavior is defined by `vercel.json` + `api/*`, NOT by `server.mjs`. If you change
  routing, change it in **`vercel.json`** (and mirror in `server.mjs` only for local parity).
- `server.mjs` **caches the imported `api/` modules**. After editing `api/products.js` you must
  **restart the local server** to see changes — otherwise you'll test stale code. (This exact
  gotcha once produced a misleading "0 COAs" result.)

---

## 5. THE BASE64-INJECTED ENGINE IN index.html — DO NOT HAND-EDIT

`public/index.html` contains a **very large base64 string** (~250KB on one line) that decodes
at runtime into the **seed inventory + the render engine** (product cards, filters, drawers,
the COA modal, and admin mode). This is the single most fragile thing in the repo.

- **Never manually edit, reformat, or "prettify" that base64 line.** One stray character
  corrupts the whole engine and the page renders blank.
- To change engine behavior, decode it, edit the JS, and re-encode — or, far safer, **layer
  changes ADDITIVELY** in separate `<style>` / `<script>` blocks in `index.html` that the
  engine doesn't touch. The mobile filter sidebar and the security/layout tweaks were all done
  this additive way on purpose.
- The engine reads product objects with fields like `name, price, store, type, strain, img,
  gallery, coa, url, cartDomain, ref, coupon`. Keep `api/products.js` output shape-compatible.

### 5a. The decode → edit → re-encode procedure (read this before you run it)

**Added 2026-08-06, after this exact procedure shipped a live SEO regression.** Commit
`238420e` re-encoded `index.html` as CP1252 and mangled every non-ASCII character *outside*
the blob — the `<title>`, the meta description and all the `og:*` / `twitter:*` tags. It
merged and sat on production undetected, because **mojibake is invisible in a normal diff
review: the mangled text still looks like text.** Three traps, all of them silent:

1. **The decoded engine is NOT pure ASCII.** It carries ~120 bytes above `0x7F` (real UTF-8
   em dashes and similar). Decoding it with an ASCII decoder rewrites every one of them to
   `?` — *same byte length, different content*. Use **ISO-8859-1** (codepage `28591`) in
   BOTH directions; it maps bytes 0–255 to chars 1:1 and back, so nothing can shift.
2. **Check the line endings before you write, do not assume them.** This note used to assert
   `public/index.html` is CRLF. Measured on 10 Aug 2026 it holds **0 CRLF and ~2,369 LF**: it is
   an LF file. Following the stale note and "restoring" CRLF would have rewritten every line
   ending in the file, which is the same silent, review-proof damage this section exists to warn
   about, just in the other direction. Either way the rule is the same: the write must be
   **surgical**, touching only the bytes you mean to touch and never re-serialising the whole
   file, and the ending count must come out unchanged. Assert it, do not trust this paragraph.
3. **Never edit the decoded engine with a tool that assumes UTF-8.** Saving it as UTF-8
   turns each high byte into a multi-byte sequence and double-encodes the engine. Patch it
   with an editor/script you have told explicitly to use ISO-8859-1.

Note the blob line itself is base64 and so can never hold the offending bytes. The damage
is always to the plain HTML around it — which is exactly why it survives review.

**Before trusting any re-encode helper**, run it decode → encode on an *unmodified* file and
assert the result is byte-identical (compare md5). A helper that fails this will corrupt the
file in ways no diff will show you.

**After any engine edit, assert all of these:**

- the base64 blob is byte-identical, or intentionally changed — compare **md5 + length** of
  the `var B="..."` line
- the file's **non-ASCII inventory is unchanged** versus the parent commit
- the CRLF count is unchanged, and no BOM was introduced
- the decoded engine still has its **~120** high bytes — if that number doubled, you
  double-encoded it
- `git diff --stat` touches **only** the lines you meant to touch

Finally, **verify by booting the page, not by reading it.** `node` is not always installed
here, but Python usually is: `py -3 -m http.server 8777 --bind 127.0.0.1` from a scratch
directory, then load it in a browser and check the grid renders, `window.LL_admin` is still
an object, and the console is clean. `file:///` URLs are not enough — they render without
running the scripts.

---

## 6. Admin mode (category reclassification)

**Corrected 2026-08-06.** This section used to say the console was "INTACT, just hidden."
Only half of that was true: the admin **API** survived inside the engine, but the console
UI, the `adminmode` keystroke and the PIN gate had all been stripped in an engine re-cut.
The console has been rebuilt.

To open it:

1. Type **`adminmode`** on the page (not focused in a text field).
2. Enter **PIN `5824`** at the prompt (sets `sessionStorage["ll_admin_ok"]`).
3. An **Admin** button appears bottom-left and opens **"Admin · Category Control"** —
   search, reclassify, per-field overrides, image preview, audit log, server push/pull,
   download/import batch JSON, per-product reset, clear overrides, reprocess.

**Where the code lives, and why it is split.** The API is `window.LL_admin`, inside the
base64 engine (§5): `items, log, manual, setCat, clearAll, full, fieldOv, setFields,
resetFields, exportBatch, importBatch, reprocess`. The UI is **`public/admin-panel.js`**,
deliberately OUTSIDE the blob, loaded by one `<script>` tag in `index.html`. Because
`LL_admin` is exposed on `window`, the UI never needs a decode/re-encode — this is the
additive approach §5 recommends. **Keep it that way.**

Overridable fields are the engine's own `_OV_FIELDS`: `name, image, store, cannabinoid,
category, type, grow, coupon, startsAt, sale, perG, ship, potency, badges, varImg,
subTags`. Blank means "inherit the scraped value", so an override can be removed. `image`
is how you fix a wrong product photo.

Persistence is two-tier:
- **Per-browser:** `localStorage["ll_manual_cat"]` (categories) and
  `localStorage["ll_field_ov"]` (fields), applied in the engine's ingest pipeline.
- **Shared:** `/api/overrides` (§9). This replaces the engine's dead
  `google.script.run -> getOverrides()` call, which cannot work on Vercel.
  **Two different readers, and they are not the same:**
  - `index.html` has an inline pull block that polls until `window.LL_admin` exists,
    then imports the batch. `LL_admin` is defined by the admin console IIFE, which is
    only on `index.html`, so this block only ever ran on `/`.
  - The satellite pages (`/consumables`, `/devices`, `/international`) load
    **`public/js/overrides.js`**, which fetches the same endpoint and applies it with a
    port of the engine's `_applyOv`. Added 2026-08-08 after an owner set a product image
    in the console and it appeared on `/` but nowhere else. It had saved correctly; the
    satellites simply never read it.
  - `greekglass.html` is hand-authored and reads neither. It is not fed by
    `/api/products` at all (§7).
  If you change `_OV_FIELDS`, `_OV_NUM` or the `varImg` rule in the engine, change
  `public/js/overrides.js` to match or the two surfaces will disagree.

If you rev the engine, preserve both localStorage keys and `window.LL_admin`.

> **Correction, 2026-08-08.** `public/admin-panel.js` no longer exists. The console UI was
> moved inline into `index.html`, and `window.LL_admin` is still exposed by the engine, so
> the additive principle above still holds. Earlier text in this section describing
> `admin-panel.js` as the UI file, and §9's claim that it is what every visitor pulls
> overrides through, were both stale. Entry points to the console are now the `adminmode`
> keystroke and `?admin` on the URL (the latter added because the keystroke has failed
> twice for reasons unrelated to the code, and does not exist on a phone at all).

> **The PIN is not authentication.** `5824` is readable in page source; it only prevents
> accidental discovery. Writes to `/api/overrides` are gated on `LL_ADMIN_TOKEN`, which
> must never be committed or embedded in client code — the console prompts for it and
> keeps it in `sessionStorage` for that tab only.

---

## 7. `/api/products.js` — the scraper

Ports the Shopify / WooCommerce / Squarespace scrapers + classifier
(cannabinoid/category/exclusions, accessory categories, international + currency,
price-per-gram). Key points:

- **STORES config** (top of file) drives everything. Each store has `key, name, domain,
  platform`, optional `ref/refLink/coupon/freeShipOver/preferWoo`, and optional **`coaFolder`**.
- **COA system** (see §8). `isCoaUrl()` / `isCoa()` detect lab-report assets.
- **Caching**: in-memory 30 min per warm instance + CDN `s-maxage=600,
  stale-while-revalidate=3600`. Use `/api/products?refresh` to force a fresh scrape and
  `/api/products?debug` for per-store counts.
- **`/api/products?debug&slim`** is `?debug` with `products` omitted — every diagnostic, none of the
  catalogue, so the numbers fit in a log line, a phone, or an agent behind a proxy that will not
  hand over the ~7 MB the full payload weighs. It adds a `coverage` census over the whole feed:
  how many products carry vendor-stated `lineage` and how many carry a measured terpene panel, each
  split in-stock, attributed per store, with denominators (total / in stock / flower) and three
  verbatim lineage examples. **Both fields are sparse, so a sample cannot describe them** — sampling
  is precisely how `BUDTENDER_PLAN.md` came to assert there was no terpene data while 36 products
  were carrying full panels through production. The examples are there because the first thing they
  caught was a real parse bug (§ the `BLOCK_BREAK` note in `api/products.js`).
- Response shape is `{ products: [...], meta: {...} }`. Keep `products` exactly as it is;
  the engine and the satellite pages depend on it. `meta` (`{updated, total, stores:
  [{name, count, err?}]}`) feeds the engine's "Live <updated>" stamp and its per-store
  hover diagnostic — the engine has accepted `{products, meta}` since the Apps Script
  days, and the satellites ignore `meta` entirely, so it is additive.
- **Greek Glass is intentionally NOT in `/api/products`** — `greekglass.html` loads it
  client-side from Big Cartel (baked seed + live refresh). Don't fold it into the API.

### Trim and shake: the feed decides, the engine obeys

The engine's Trim/Shake toggle (`state.inclTrim`) resolves through `subTagOn(p,"trim")`, which
honours a per-product **`subTags`** override first and only then falls back to
`SUBTAG_DEFS.trim`, whose test is `/trim|shake/i` against the product **name**. Nothing had ever
produced `subTags`, so that loose name test was the entire rule, and it was wrong both ways:

- **missed** a listing named "Budget Buds THCA Flower" whose own description says the category
  "may feature shake, trim, and smalls", so hiding trim did not hide it;
- **wrongly hid** "Grape Milkshake", a whole-bud strain, and any "hand-trimmed indoor" listing,
  which is the opposite of trim.

`api/products.js` now answers it instead, at scrape time, from title + tags + `body_html` with
word boundaries, and sets `subTags.trim` **both true and false on purpose**: false is not a no-op,
it is what overrules the engine's own false positives. Same `isOffcut()` that sets the `offcut`
field `/p/` reads, so the card banner, the grid chip and the filter cannot disagree.

The grid **label** is an additive `<style>`/`<script>` pair at the end of `public/index.html`
(ids `ll-trim-label-style` / `ll-trim-label`), never an edit to the blob. It reads `subTags.trim`
from `/api/products`, paints a red "Trim / Shake" chip on `.card[data-pid]`, and reapplies on
mutation because the grid re-renders on every filter and sort with no hook to attach to. Hiding
offcuts behind a toggle is not the same as saying what they are: with the toggle ON, which is the
default, they sit beside whole buds at a price that only makes sense once you know which is which.

**The product is the wrong unit for this, and slot 7 is the right one.** Black Tie and CBD Hemp
Direct both sell whole buds AND their own offcuts under a single title, with a "Shake" or "Trim"
option sitting in the same dropdown as the eighths and ounces. Banner the whole card there and the
whole-bud sizes are libelled; banner none of it and the offcut is sold as flower. So every size
row now carries its own answer in **slot 7**, set by `rowOffcut()` at scrape time, and the
product-level flag still wins outright where it is set because that one is decided from the
description as well as the title.

Three consumers, and they read it differently on purpose:

- **`/p/` and `/p/pick`** read `row[7]` directly, falling back to the label test for feeds that
  predate the flag. `bucketOf()` takes the row rather than the label for the same reason, so a row
  the feed knows is shake competes for a trim slot in the 6/3/1 mix instead of a THCa one.
- **`public/consumables.html`** reads `r[7]` into its size rows and appends "trim/shake" to that
  option's own text.
- **The grid chip** cannot read slot 7, and this is the one place the reasoning is not obvious:
  the engine's `groupByStrain()` merges rows from several products into one card and rebuilds each
  row as seven elements, dropping slot 7 before anything additive can see it. So the chip tests
  the **selected option's text**, which the engine bakes the row label into verbatim, with the same
  word-boundary regex. It also listens for `change` on `.sizesel` (delegated and captured), because
  picking a size does not re-render the card and the mutation observer never fires for it. The chip
  reads "This size: Trim / Shake" when only the row is flagged and "Trim / Shake" when the whole
  listing is.

`test-site-woo.mjs` (in the site-patch directory, with the other Playwright suites) drives this in
a real browser on a listing that sells both: the chip is up on load because the engine opens on the
best price per gram, which on a mixed listing is the shake, and it clears when the whole-bud row is
chosen.

### Adding a store, and what actually gates it

Two applications went in on 10 Aug 2026, **TribeTokes** (Awin) and **Dogwood Dispensary**
(direct). Both sit commented out in `STORES` with the checks each still needs, and with what was
confirmable about each written next to it. In short:

- **TribeTokes**: programme real, 15% / 30-day cookie / $92 AOV. Described as Awin but also as
  "formerly ShareASale", and those sister networks issue **different link formats**, so read the
  dashboard rather than assuming. Sells gummies, tinctures, vapes and topicals, **no flower**, so
  it does nothing for the sub-$50 ounce supply the THCA King delisting cost.
- **Dogwood Dispensary**: pays on a **unique promo code**, not a tracking link, and is
  multi-level. So `ref` stays empty, the outbound link is untracked, and the money rides on the
  shopper typing the code. It also is a **delivery service** with per-city zones (NC, TX, FL, PA,
  TN) rather than a national shipper, which collides with publishing one national price per
  product: decide whether to list only their shippable range or to state the zone on the card.
- **CBD Hemp Direct** (`cbdhemp.direct`, not cbdhempdirect.com): the only one of the three that
  replaces what the THCA King delisting cost, because it sells cheap THCa flower by the ounce.
  Pretty Cheap Buds from about $39.99/oz, Bulk Budget at $20, Budget Buds from $16, indoor and
  greenhouse lines above those. 5% commission, 10% on indoor-tagged THCa, link and coupon both,
  $100 minimum payout, 45 days pending. The rate differential must never reach ordering, per the
  footer's promise, and their terms terminate for self-referrals so nobody tests it by buying
  through our own link.

  **Registered 10 Aug 2026, affiliate id 161, status still "Pending" in their portal.**
  Attribution is a URL param, not a store-level redirect: their portal says add `?sld=161` to any
  page, so `ref:'161'` with `refParam:'sld'` stamps every product link, the same mechanism as
  Exhale's `rfsn` and Nothing But Canna's `sca_ref`. Free USPS Priority over $75.

  **They do not ship everywhere**, and this site publishes one national price per product: nothing
  at all to CA, NV, OR or the US territories, THCa additionally not to AR, ID, MN or RI, Delta-8
  excluded from a longer list again. There is no state-restriction mechanism in this codebase, so
  a shopper in one of those states would see a price they cannot buy at, which the footer promises
  not to do. Milder than Dogwood's zone problem, same question, now concrete.

  **It also breaks the trim banner, and that is the work it creates.** Their Budget Buds
  description says the category "may feature shake, trim, and smalls" while the titles are only
  "Budget Buds THCA Flower" and "Bulk Budget THCa Flower". `isTrimShake()` matches those words on
  a boundary, so neither title trips it, and `/p/pick` would advertise a $16 shake ounce as whole
  buds with no banner: exactly the failure the banner exists to prevent. Fix it from their real
  `/products.json` (which field carries the grade: title, `body_html`, tags, a variant option),
  never by broadening the regex on a guess.

  **Settled, from their own page source rather than from probing.** The platform went
  `shopify` (guessed from `/products/` URLs, came back `badJson` because `/products.json` served
  HTML) to `auto` to, finally, `woocommerce`: the owner pasted a full product page, which is
  WordPress + WooCommerce 11.0.0 on the Astra theme with body class `product-type-variable`. Three
  consequences, all live now:

  - **`wooVariations:true` is mandatory here.** Every flower product is variable. Without the
    sweep a variable product publishes its `price_range` MINIMUM as one flat "One Size" row, which
    the owner reported as "you are only picking up the smallest size on cbd hemp": Candy Paint has
    variations at 7 g $33.53, 14 g $62.10 and 28 g $114.99 under `attribute_pa_net-weight`, and
    only the 7 g was reaching the site. The ounce is the row that sells, so this was the whole
    pitch missing.
  - **Their `weight` field is SHIPPING weight, not product weight** (23/46/40 g against net
    7/14/28), so grams come from the variation label via `wooVariantGrams()`. Do not "fix" that to
    prefer the weight field.
  - **`cartPath:'/cart'`**, read off their own config (`cart_url`), alongside
    `cart_redirect_after_add:"no"`, which is why the cart page has to be the target rather than
    somewhere convenient.

  `test-cbdhempdirect.mjs` runs the real handler against a stubbed Store API built from that page
  source and pins all of it, including that the Store API quotes money in **minor units**.

The important thing, because it is easy to get backwards:

**The affiliate approval is not the gate.** Exhale already ships live with `ref` intentionally
empty, emitting a clean untracked link, because payout is not an input to whether a merchant is
listed (§ the delisting note above, same principle). An unapproved programme means unmonetised
traffic, not an unlistable store, and inventing an ID is the thing never to do: set `ref` when a
real one arrives, plus `refParam` if the programme uses something other than `ref`.

**What gates it is whether there is a lawful, public catalogue to read.** That is a per-merchant
check, not a blanket licence, and it means: the platform and a genuinely public catalogue
endpoint (`platform:'auto'` probes, but a store serving neither `products.json` nor
`wc/store/v1` is not a source), `robots.txt`, and the merchant's own terms. None of it could be
done from the container that wired these up, since egress to both hosts is refused by that
environment's proxy, so neither entry claims a verified platform, endpoint, or even domain
spelling.

**"Via Awin" is ambiguous and only one reading fits this file.** Catalogue from the storefront
with Awin supplying the *link* needs no new code, and the deep link goes in `refLink` (which is
store-level and is returned as the checkout URL wholesale, so the shopper lands on the shop
rather than the product, as with DSquared). Catalogue from Awin's product *datafeed* is a path
this repo does not have: no feed URL, CSV or TSV handling anywhere, deliberately (§2). Awin
advertisers set their own column names, so that would have to be written against the real header
row, bound by header name and never by position. **Never GET an `awin1.com/cread.php` link while
testing**; each request books a real click and pollutes conversion reporting with our own
traffic. Assert on the string.

### Paginating a WooCommerce catalogue: `page` is not to be trusted

**Added 10 Aug 2026, after "we're only pulling 32 items" was reported twice and fixed once
wrongly.** Both Woo sweeps now go through one function, `wooSweep()`, because they need identical
pagination semantics and had drifted apart twice, each time at the cost of a catalogue.

The trap is that **every intuitive stop condition is wrong**, and each one fails silently:

- *"A page shorter than `per_page` is the last page"* assumes the server honoured `per_page=100`.
  Plenty of installs cap the page size lower, and then the FIRST page is short and the catalogue
  collapses to one page. This was fixed in `aa69708` and **did not move the number**, which is the
  useful part of the story.
- *"A page that repeats rows we already have is the last page"* assumes the window moved. A store
  that clamps `page`, or a cache keyed on a URL somebody is rewriting, serves page one forever.
  This is what CBD Hemp Direct actually does. A repeat now switches the sweep to `offset`, which
  `WP_Query` honours in preference to `paged`, and which is a different URL and so a different
  cache key. **Only an empty array ends a collection.**
- *"An unreached page just means fewer products"* is the one that did the real damage. The
  variations sweep had **no dedupe at all**, so a clamped `page` pushed the same variations into
  the same parent once per request — a product came out with its 7 g row listed dozens of times at
  dozens of identical prices — while every parent past the first page fell back to its flat
  `price_range` minimum. That is the "you're only picking up the smallest size" bug, back again by
  a different route. Rows are deduped by id now, in both sweeps.

Two supporting pieces, both worth keeping:

- **`get()` returns response headers** (`hdr(name)`), because the Store API states the size of the
  collection it is paginating in `X-WP-Total`. Throwing those away is why every diagnosis of this
  feed had been guesswork: a sweep that stopped early was indistinguishable from a small shop.
  `?debug` now prints `products:short 32/312` using the store's own number. **If the count is low
  and `:short` is absent, pagination is fine and the rows are being discarded downstream** — the
  drop tally in the same output names the rule. Two different bugs, now distinguishable.
- **`orderby=id&order=asc` is required, not cosmetic.** The collection's default order is by date,
  and a bulk-imported catalogue has hundreds of rows sharing one timestamp; ties order arbitrarily
  per query, so windows overlap and rows vanish from every page. Offset pagination is only correct
  over a stable sort.

`maxPages` / `wooVariationPages` are **request budgets**, not page counts. Reaching one is
reported (`:truncated@Nreqs`), never silent. Note the sweep is sequential within a store, so a
short page size turns a catalogue into a lot of round trips inside one serverless invocation; the
current change strictly *reduces* the worst case (a clamped `page` used to spend the entire
80-request variation budget on 80 identical responses), but if `:truncated@` ever appears here,
weigh raising the budget against the function's time limit rather than just raising it.

### `wooVariations` is not optional on a variable catalogue, and its absence has one signature

**Added 11 Aug 2026, after the same bug arrived from a second store.** A WooCommerce store is
`platform:'woocommerce'`; whether its products are *variable* is a separate fact, and `wooVariations`
is what asks. Get that wrong and nothing errors. What you get instead is three symptoms that read as
three unrelated bugs, which is why this has now been diagnosed twice from scratch:

1. **One size in the dropdown.** Without the sweep a variable parent publishes its `price_range`
   **minimum** as a single flat "One Size" row. Reported at CBD Hemp Direct as "you are only picking
   up the smallest size", and at THCA4Cheap as "it said one size available in the drop down and
   clearly more were available".
2. **A price that belongs to a row nobody can buy**, because that minimum is the cheapest variation
   including sold-out ones.
3. **Sold-out listings shown as in stock.** `normWoo()` takes availability from the **parent's**
   `is_in_stock`, which is true whenever *any* variation is sellable and stays true once the size the
   shopper wants is gone. The ounce is the row that sells, so this is the row it lands on.

Symptom 3 is the one to internalise: it is not a stock bug, it is the size bug wearing a different
face, and chasing it as a stock bug leads you to the cache instead of to the flag. Stores carrying
the flag today: `cbdhempdirect`, `exhalewell`, `thca4cheap`. **THCA4Cheap's was set from the owner's
report rather than from the store** — egress to it is refused from the containers this repo is edited
in — and **confirmed live on the deployed site the same day**: the sizes appeared. That confirmation
is observational, not from `/wp-json/wc/store/v1/products?type=variation`, and it is enough, because a
wrong reading could not have produced it: with no variations to find, the sweep returns nothing and
`normWoo()` takes the flat path unchanged. Which is also the general rule here — **the flag is safe to
set on suspicion.** The cost of setting it wrongly is zero; the cost of leaving it unset on a variable
catalogue is the three symptoms above, twice diagnosed from scratch.

### `anyInStock()` is the one stock test, and it is exported for that reason

`api/products.js` exports it: `inStock !== false` **and** (no size rows, or some row's slot 4 is not
`false`). Both halves matter. A product that never declared availability is live — treating unknown
as sold out empties the shelf — and a product whose flag says live while every row is gone is not.

`api/concierge.js` used to ask `p.inStock !== false` on its own, in three places, while its own
comment claimed it "can never disagree with the grid about what is in stock". It did, and the
consequence was worse than a wrong card: the concierge **asserts** the field to the model, which then
tells a shopper the thing is available in prose. It imports the function now. If you add a third
surface, import it too — four copies of `storeCheckoutUrl()` is what this repo does when a rule gets
restated instead of shared.

**Per-row stock is a different question from per-product**, the same way trim is (§ above): a listing
can be live with its ounce sold out. Slot 4 is the only place that is answered, and any surface that
lets someone pick a *size* has to read it — the concierge's `get_product` projection now carries it
per row.

### The checkout link, per platform

`storeCheckoutUrl()` exists four times over: once inside the base64 engine, and once each in
`consumables.html`, `devices.html` and `international.html`. They all read the same `ll_cart`, so a
cart filled on `/` and checked out from a satellite has to spend the same affiliate param, and
divergence between the four is silent by construction. Two rules are load bearing:

- **The param name belongs to the store.** `refParam` first, `"ref"` only as the historical
  default. Nothing But Canna reads `sca_ref`, CBD Hemp Direct reads `sld`, Exhale reads `rfsn`.
  Hardcoding `ref=` produces a link that works, a customer who buys, and a commission of zero,
  with nothing anywhere showing it went wrong: the exact failure `refUrl()` in `api/products.js`
  warns about. Single-item links were never affected, since those ride `p.url`, which the scraper
  stamps server-side.
- **WooCommerce checkout adds the item.** It used to return the bare product page, so the shopper
  arrived at an empty cart and picked their size a second time (reported as "it went to the product
  not to checkout with the product added to the cart"). Now `?add-to-cart=<id>&quantity=<n>`, where
  the id is the **variation** id when the row has one and the parent id when the product is simple.
  Woo's own handler swaps in the parent and fills the attributes from the variation, so no
  `attribute_*` param is ever hand-built: a wrong one fails validation and adds nothing at all.
  Where the store publishes a `cartPath` the link targets that cart page; where it does not, the
  add rides on the product page instead, because a guessed `/cart` that 404s loses the sale
  outright and a product page cannot. **Woo takes ONE item per link** (its handler `absint()`s the
  parameter, so `add-to-cart=1,2` adds product 1 and drops the rest), so a multi-item group says so
  in the drawer rather than letting the shopper discover it at their checkout.

The engine's copy is inside the blob and is not edited. `public/index.html` carries an additive
`ll-checkout-fix` block that rewrites the drawer's anchors after the engine renders them, and
**only** for the two cases above: every other platform keeps the engine's own href, so the blast
radius is the set of links that were provably wrong.

### One cart, one wording

There is exactly one cart — `localStorage["ll_cart"]`, written by the main grid, all three
satellites and `greekglass.html` alike — and it was called two things. The engine has two card
branches: the size-selecting one renders **"Add to Legal-Leaf Cart"**, and the accessory branch
(`p.storeKey==="greekglass" || p.cannabinoid==="Accessory"`, the `.addbtn.ggbtn` button) rendered
plain **"Add to Cart"**. Both write the same key, and on `/` they sit **side by side in one grid**,
which is what makes it read as a second, vendor cart rather than as a typo.

Fixed per surface, because the surfaces are not the same kind of file:

- **`public/index.html`** gets the additive `ll-cart-label` block (§5, never the blob). The
  accessory branch sets its label once at render, so a `MutationObserver` on `#grid` is the whole
  job; the size-selecting branch rewrites its own button on every size change and already says the
  right thing, so it is left alone. Disabled buttons are skipped — that text is "Out of stock".
- **`consumables.html` / `devices.html` / `international.html` / `greekglass.html`** render their
  own buttons in plain HTML and JS, so the string is fixed at source. Greek Glass's `.gactions` row
  gained `flex-wrap:wrap`: the longer label plus the flip hint does not fit one line on a
  two-column card, and `.addcart` is `white-space:nowrap`, so without it the button overflows
  rather than wrapping. Consumables' **back** face keeps "＋ Add selected size" on purpose — that
  is a different action (it adds the size chosen on the back), not a second name for the cart.
- **`/coldwater` is exempt and the block must stand down there.** `coldwater.html` is generated
  from `index.html`, so `ll-cart-label` travels to it, where `cw-list-button` owns the wording
  ("Add to Shopping List" — that page has no cart, it has a list). Left unguarded the two blocks
  take turns rewriting the same button, which fails silently. The guard reads
  `#cw-list-button-style` **inside** the paint function rather than at parse time, because the
  Coldwater blocks are appended *after* this one and do not exist yet while it is being evaluated.

`node test-cart-label.mjs` drives it in real Chromium. Note what it has to do to not be vacuous:
**the grid paginates**, and the accessory seed fills the first page, so "every button on screen
says X" passes against a grid holding only one of the two branches — exactly the bug. So the
accessory branch is filtered into view deliberately, and the other branch is pinned where it is
actually decided, as the engine's own literal read back out of the blob. That last assertion is
also the one that notices a future engine re-cut renaming either branch.

---

## 8. COA (Certificate of Analysis) system

Two sources feed each product's `coa` field, in priority order:

1. **Per-product COA image** auto-captured from scraped images when the filename/path matches
   `isCoaUrl()` (`coa|compliance|lab[-_]?results?|certificate`). These are also filtered OUT of
   the photo gallery so a lab sheet never becomes the product thumbnail.
2. **Store-level `coaFolder`** fallback (a public lab-results page / Drive / Dropbox).

The engine renders a "view COA" link on any card where `coa` is truthy and shows it in a modal
(images/PDFs inline; Shopify `/pages/...` COA pages open in a new tab via `isCoaPage`).
Stores currently WITHOUT a `coaFolder` (COAs are per-product or private):
THCa Hempire (BigCommerce, not yet scraped), Bloomz Hemp.

### Lookah is listed, unmonetised, and guesses nothing (22 Aug 2026)

**"Add lookah to the site properly."** One line in `STORES`, and the interesting part is
everything that was deliberately left out of it.

**The affiliate approval is not the gate**, and this is the clearest case of that rule in the file:
the application went in on 22 Aug and is still pending, so `ref` is empty and every outbound link
is clean and untracked. Grasscity two lines above ships the same way. Unapproved means unmonetised
traffic, not an unlistable store.

**What the gate actually is — a lawful, public catalogue — could not be checked from here**, and
that is worth being exact about. Egress to `lookah.com` is refused by the proxy in the containers
this repo is edited from; it was tried, for `robots.txt` and for `lookahusa.com` as well, and both
are blocked. So the platform, the catalogue endpoint, `robots.txt` and their terms are unverified
by the author of the entry. **The owner chose to list it now and back it out if any of that
forbids it** — a recorded decision, not an oversight, and `enabled:false` reverses it completely
the way it did for Binoid.

**The domain is `lookahusa.com` because `lookah.com` was measured and found empty.** Listed there
first; the deployed scrape — the one environment with egress — came back
`http:404, products:http:404`. That host is **up** and serves **neither** catalogue endpoint:
Shopify's `/products.json` 404s and WooCommerce's Store API 404s too. Zero products on the shelf
and no wrong data anywhere, which is the safe failure `platform:'auto'` is chosen for.

**What that reading rules out and what it does not** — kept, because it is the map for the next
attempt if `lookahusa.com` is also empty. It rules out Shopify at `lookah.com` (which serves
`/products.json` unless explicitly disabled) and modern WooCommerce. It does **not** rule out
BigCommerce — `auto` never probes it, only the explicit `'bigcommerce'` branch does, and THCa
Hempire runs on it — nor Magento, nor a custom storefront. Pick one on evidence rather than cycling
through them: each attempt is a real scrape of somebody else's site.

Moving the domain does **not** move the robots.txt gap — egress to both hosts is refused from the
containers this repo is edited in, so neither has been read here.

**`platform:'auto'` is the honest setting for a platform nobody has confirmed.** It tries Shopify's
`/products.json` and falls through to WooCommerce's Store API, so a wrong guess costs a wasted
request and an empty store in `?debug` — never a wrong catalogue. `fetchStore()` records the error
and the shelf is unchanged. That is what makes it different from guessing.

**Three fields are absent on purpose.** `refParam`, because `refUrl()` defaults an unset one to
`ref` and a wrong param is a link that works, a customer who buys, and a commission of zero. And
`international` / `currency` / `freeShipOver`, because a number nobody measured is a wrong number
on a card. All of them are additive the moment somebody can look.

**`accessory:true` is mandatory**, for the reason Grasscity's own note gives: hardware carries no
cannabinoid, and without the flag `classify()`'s default routes e-rigs and torches into the
per-gram ranking as "THCA Flower".

`node test-stores.mjs` pins the class rather than the instance. **`fetchStore()` switches on
`platform` and returns `[]` for a string it does not recognise** — so a typo there is a store that
scrapes nothing, reports no error, and reads exactly like a shop that went quiet. The suite asserts
every platform is one the dispatcher handles, that no `ref` is a placeholder, that keys are unique,
and that no accessory store reaches the `/coldwater-collect` roster. Verified against both bugs:
`platform:'wooCommerce'` and `ref:'TODO'` each turn it red.

> **`/lookah-preview` is now superseded and says so.** The mockup was built while this was pending
> and its banner claimed Lookah "is not yet scraped or added to `/api/products`" — true when
> written, false the moment the entry went live, and sitting on a real URL. It now states that it
> has been superseded and can be deleted. Leaving a page that asserts something untrue is worse
> than leaving a page nobody needs.

### Binoid is delisted (20 Aug 2026) — the DSquared kind, and its share does NOT move

**"Take Binoid off."** The reason is **fit**, so this is `enabled:false` and nothing is ripped out:
the affiliate id, the coupon, the `coaFolder` and the whole `binoid__*` corpus in
`api/coa-data.js` all stay. One flag is the entire delisting — the handler filters on `enabled`
for the scrape, the roster, the `?debug` counts **and the capture merge**, which skips a store it
cannot find among the enabled, so the rows already in KV stop reaching the shelf without anything
being deleted.

**What made it a fit question was the synthetics work the same day.** With the exclusion finally
running on both lanes, the scrape refused 106 Δ8, 58 THCP, 9 Δ9, 5 THCM, 3 HHC, 2 Δ10, 2 Δ11 and
1 THC-O, and the capture lane a further 115 rows. What survived was **135 products, two of them
flower.** A price-per-gram comparison site whose shelf carries two flower listings from a shop is
not comparing anything with it.

**Not a conduct finding**, and that is why the entry survives intact. They shipped what was bought
and paid what was owed. THCA King's entry was *deleted* so the merchant could not come back by
accident; this one must be able to, so removing the flag is the whole re-listing.

**Its 9 projection points STAY, which is the opposite of what THCA King's 15 did**, and the
difference is what each delisting removed. THCA King left a demand pool this site still serves —
somebody after a $50 ounce buys the same weight from whoever else has it — so the share moved to
the shop competing for that query. Binoid's share was mostly demand for delta-8 and the other
synthetics, and this site has now **decided not to serve that at all**, so there is nobody for it
to move to: a visitor searching for it finds nothing and leaves. `status:'none'` models exactly
that — the row keeps the distribution summing to 100, and `attributableShare` (which skips
`'none'`) correctly stops crediting the 9. Deleting the row would have modelled the legal site at
91, which is the trap the THCA King note four rows up already warns about.

**And it came off the LLM capture roster**, for the reason DSquared did: `/coldwater-collect` must
not offer an operator a shop whose captures nothing will read. That list in
`api/coldwater-ingest.js` is a **hand-kept twin** of the enabled keys in `api/products.js` — the
file's own comment explains why it cannot be derived — and it drifts in exactly one direction,
silently, producing a capture that stores perfectly and is never seen. It has now happened twice,
so `test-capture-guards.mjs` holds the two lists together instead of memory. Verified against the
drift: putting Binoid back on the roster alone turns it red.

### DSquared is delisted (19 Aug 2026) — and the reason is different from THCA King's

**"They aren't pulling right and their products aren't right for us anyway."** Two reasons, each
sufficient: the catalogue read badly (16 products on `platform:'auto'`, and they rebranded to
Cielo Manufacturing partway through, which is what killed the `refLink`), and the range is not
what this site compares.

**Disabled rather than deleted, which is the opposite of what THCA King got, on purpose.** That
delisting was for **conduct** — short-shipping — and the entry was ripped out along with its COA
import, its `LAB_TESTED_STORES` place and its logo rows, because the merchant must not come back
by accident. This one is about **fit and read quality**, so `enabled:false` is the honest
expression of it: the handler already filters on `enabled` for the scrape, the roster and the
`?debug` counts, so that single flag is the whole delisting, and the affiliate id, coupon and COA
folder stay put rather than having to be rediscovered if the fit ever changes.

Also dropped from the LLM capture roster in `api/coldwater-ingest.js`, so `/coldwater-collect` no
longer offers a shop nothing reads. The three `SEED_MANUAL_CAT` entries inside the engine blob
(`seed:dsq-*`) are name-matched and simply stop matching; they are not reachable from any server
and cost nothing.

### THCA King is delisted (10 Aug 2026)

**The reason is short-shipping, not money, and which one it was matters.** They sent
substantially less than a real order contained and it took repeated chasing to put right. A
store that ships less than what was bought fails the only promise this site makes, so that is
sufficient on its own. They also never paid the affiliate commission on that order, and that is
**not** a reason: payout is not an input to whether a merchant is listed, and delisting a store
that treats shoppers well but does not pay would be ranking by commission at the merchant level,
which the footer's promise covers. Both cases look identical from outside, which is why this
paragraph exists. If they are ever considered again, the thing that would have to change is
fulfilment; the commission being settled is explicitly not evidence of that.

Removed: the store config entry in `api/products.js`, its `COA_THCAKING` import and the two
lookups, its place in `LAB_TESTED_STORES`, the row in the three `LL_STORE_LOGOS` maps
(`consumables`, `international`, `devices`), its name on `what-the-certificates-say.html`, and
its line in the admin projection.

Kept, deliberately: `api/coa-thcaking.js`, as an archive nothing imports (184 parsed records, 78
of them read by eye off scans and checksummed, a corpus expensive to rebuild), and the
`LAB_NOISE` grade tokens their catalogue taught us, because those words appear at other stores
too and dropping them would re-split strains site-wide.

The admin projection's 15 share points moved to THCA Small Buds rather than being deleted, since
those shares are a distribution summing to 100 and `attributableShare` sums them absolutely: a
deleted row would have modelled the legal site at 85. That reassignment is an assumption about
where the same $50-ounce demand lands, and it is written down in the engine so real months can
correct it.

**TODO carried from the old Apps Script `code.html`:** BigCommerce (THCa Hempire) scrape,
Groq strain info, any remaining per-store tuning.

---

## 9. Environment variables (all optional; site works without them)

Set in Vercel → Project → Settings → Environment Variables. Do not commit secrets.

| Var | Purpose |
|---|---|
| `LL_CRM_WEBHOOK`     | Forward `/api/subscribe` signups to a Google Apps Script Web App `/exec` URL. |
| `RESEND_API_KEY`     | Enable Resend emails. |
| `RESEND_AUDIENCE_ID` | With the key, add new signups to this Resend audience. |
| `LL_EVENTS_WEBHOOK`  | Forward `LL.track` events to an Apps Script `llTrackEvent` Web App. |
| `LL_ADMIN_TOKEN`     | **Required to publish shared admin overrides.** Without it `POST /api/overrides` returns 501 and the endpoint is read-only — it fails closed on purpose, so an unconfigured deploy cannot have its catalog rewritten by a stranger. Never commit it or put it in client code. |
| `CRON_SECRET`        | **Required for the nightly price recorder.** Vercel sends it as `Authorization: Bearer …` on its own scheduled calls, and `GET /api/price-history?record=1` accepts nothing else. Unset, that path returns 501 — a cron gate that falls open when a variable is missing is an open write that *looks* configured, which is worse than one that plainly refuses. It gates only the schedule; a hand-run still goes through `POST` with `x-ll-admin-token`. |
| `ANTHROPIC_API_KEY`  | **Enables the concierge conversation** (`POST /api/concierge`). Without any provider key that route returns 501 and the endpoint is read-only — it fails closed on purpose, so an unconfigured deploy cannot be billed by a stranger. `GET /api/concierge?mood=` works without it, because a deterministic sort needs no model. Runs **Haiku 4.5** by default ($1/$5 per million against Opus 5's $5/$25). |
| `LL_ANTHROPIC_MODEL` | Optional model override, so moving up a tier is config rather than a diff. **Two request parameters are model-gated and therefore NOT sent by default**, which is the trap this row exists for: `output_config.effort` *errors* on Haiku 4.5 and Sonnet 4.5, and the code used to send `effort:'low'` unconditionally — a 400 on every turn of the cheap tier. Server-side `fallbacks` are likewise for the frontier tier's safety classifiers. Enable each explicitly with `LL_ANTHROPIC_EFFORT` (checked against `low, medium, high, xhigh, max`, or `off`) and `LL_ANTHROPIC_FALLBACKS` once you are on a model that takes them. |
| — *(spend logging, no variable)* | Every model call now logs `[concierge] <model> in=N out=N cache_read=N $0.00xxx`, read from the provider's own `usage` rather than estimated, so "what have I spent" is answerable by grepping the Vercel logs instead of by arithmetic over character counts. A turn where the provider reported no usage is marked `ESTIMATED` (chars/3.5) and a model missing from the price table is marked `UNKNOWN-RATE` and **charged at the most expensive rate**, so an unpriced model makes the cap fire early rather than late. Rates are keyed by model prefix because the model is config — a hardcoded Haiku rate would keep reporting Haiku prices after someone set `LL_ANTHROPIC_MODEL`. |
| — *(caching, no variable)* | **Prompt caching does not engage on Haiku**, and the earlier claim that it saves ~30% here was wrong for this tier. The minimum cacheable prefix is model-dependent and not monotonic across generations — **512 tokens on Opus 5, 4,096 on Haiku 4.5** — and the concierge prefix is ~1,455. Below the minimum the entry is silently never created: no error, `cache_creation_input_tokens: 0`. The breakpoint stays in `api/llm.js` because it costs nothing and starts working the moment the model moves up. Verify with `usage.cache_read_input_tokens` before believing any figure. |
| `LL_OPENAI_COMPAT_BASE` / `LL_OPENAI_COMPAT_KEY` / `LL_OPENAI_COMPAT_MODEL` | **Any OpenAI-compatible chat-completions host** — DeepSeek, Together, Fireworks, OpenRouter, Cerebras, a local llama.cpp server, or Groq itself. What was written as "the Groq adapter" is not Groq-specific in a single line: it is the OpenAI dialect, so it is built from config rather than hardcoded. **Groq was removed as a code entry** — its free tier could not carry one concierge turn and its paid tier was closed to new signups — and pointing this base at `https://api.groq.com/openai/v1` brings it back with no diff, which is the point. Set the base to the root that has `/chat/completions` under it (trailing slash optional, it is trimmed). **All three are required** — a key with no base is treated as unconfigured rather than selected and then failing every turn on a request to nowhere. Last in preference order, since nobody sets a base url by accident. Optional `LL_OPENAI_COMPAT_EFFORT` is checked against the dialect's documented set (`none, default, low, medium, high`); it is model-gated too, so it stays opt-in. |
| `LL_DAILY_USD` | **The daily spend ceiling for the concierge, in dollars.** Defaults to **$1.00** — roughly 30 conversations a day at the measured ~$0.032 each, about $30 if every day ran to the ceiling. Over the line, `POST` does **not** error: it stops calling the model and answers with the deterministic mood pick instead, the same zero-token scorer the `GET` path runs, and says so. A widget that vanishes teaches a visitor the site is broken; one that says "out of chat for today, here's what the shelf says" still sells. It is a ceiling in **dollars, not conversations**, because one exchange and a six-round tool loop differ by ~20x. It can overshoot by at most one turn — a turn's cost is not knowable until it has run, so the check is against what is already spent. Ledger is KV (below), falling back to a per-instance counter when KV is absent or unreachable; the fallback is weaker and is reported rather than hidden. Day rolls at **00:00 UTC**. |
| `DATABASE_URL` (Neon) | **Postgres over HTTPS, the second shared backend** for overrides and the spend ledger. Neon exposes SQL on an HTTPS endpoint — the same one its own serverless driver posts to — so `fetch` reaches it with no client library, which is the only reason a database can be used here at all (§1: `dependencies` is empty, §11 forbids adding to it). Any of `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, `NEON_DATABASE_URL` is read, pooled first. **Postgres is the better fit for the ledger than Redis:** one `insert … on conflict do update … returning n` increments atomically *and* hands back the running total, where Redis needs `INCRBYFLOAT` then a `GET`. One table, `ll_store`, created lazily on first write so there is no migration step to remember. **`expires_at` is enforced on read** — Postgres has no TTL. |
| **`REDIS_URL` alone is USELESS here** | ⚠️ Read this before attaching storage. Vercel's Storage tab offers several Redis vendors and **only Upstash exposes an HTTP data API**. **Redis Cloud** (`cloud.redis.io`) speaks RESP over TLS only; its `api.redislabs.com` REST API provisions *databases*, not keys. Attach it and you get a `REDIS_URL` a zero-dependency function cannot open — storage looks connected and every backend still reports unconfigured. `GET /api/overrides` reports `REDIS_URL: true` alongside `storage: "NOT CONFIGURED"` precisely so that pairing is recognisable rather than baffling. Use **Upstash** or **Neon**. |
| `LL_NEON_SQL_URL` | Optional override for the derived Neon endpoint. The endpoint is built as `https://<host from the connection string>/sql`, which is an assumption about Neon's URL layout — **never verified against a live database**, because egress to Neon is refused from the containers this was written in. If the derivation is wrong, this fixes it without a code change. `GET /api/overrides` prints the host and endpoint it would call (never the connection string — it carries the password). |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Storage backend for shared overrides **and the concierge spend ledger** (`INCRBYFLOAT` on a UTC-day key, 48h TTL — not read-modify-write, which would lose concurrent lambdas' turns exactly when traffic is heaviest). Vercel sets both automatically when you attach a KV store to the project. Preferred. |
| `LL_OVERRIDES_WEBHOOK` | Alternative override storage: an Apps Script `/exec` url, same pattern as `LL_CRM_WEBHOOK`. Used only if KV is not configured. |

**Backend preference order, and it is the same for reads and writes** (a write landing in one store
while reads come from another publishes an edit nobody sees): **KV → Neon → webhook → nothing**. KV is
first only because it was built first; on the ledger Neon is technically better. With none configured
the site behaves exactly as before — overrides stay per-browser and the spend ceiling counts
per-instance — so this is safe to deploy before provisioning anything.

**Shared overrides (`/api/overrides`)** — `GET` is public and returns
`{version, updated, cat, fields}`; the home page and the satellite pages both pull it
(see §6) so admin edits are site-wide. `POST` requires the `x-ll-admin-token` header. With no backend
configured, `GET` returns an empty batch and the site behaves exactly as before, so this
is safe to deploy before you provision storage.

---

## 10. Verify before you merge

There are two small suites now, both zero-dependency beyond Playwright, and they cover the paths
that fail silently rather than loudly:

- `node test-cbdhempdirect.mjs` runs the real `/api/products` handler against a stubbed
  WooCommerce Store API built from a real product page: the variations sweep, grams from the
  variation label rather than the shipping-weight field, per-row trim flags, and the Solid
  Affiliate referral surviving into the product URL. It also drives four different *badly behaved*
  paginators against the same store entry, because that is where this feed keeps failing: a server
  with a short page, one that ignores `page` but honours `offset`, one that ignores both, and a
  well-behaved one that must not be made to pay for any of it (same request count as before, no
  offset attempt, no drop reasons). The last one is the regression guard for the other three
  WooCommerce stores, which share `wooSweep()`.
- `node test-site-woo.mjs` (in the Claude_Edit site-patch directory, beside the `/p/pick` suites)
  serves `public/` to real Chromium with that same shape of feed and drives it: the trim chip
  following the size dropdown, and the drawer's checkout link landing in the store's cart with the
  chosen variation added under the store's own affiliate param.
- `node test-coldwater.mjs` boots `server.mjs` and drives `/coldwater` in real Chromium: the
  price-per-gram tool's default eighth-vs-ounce pair, the ranking and the state-average
  comparison, the "Other" custom-grams path, escaping of the typed label, and no horizontal
  overflow at 390px. **It blocks `fonts.googleapis.com` and `fonts.gstatic.com` at the network
  layer, and that is load bearing rather than tidiness:** the proxies in the containers this
  repo is edited from refuse Google Fonts, so the render-blocking `<link>` stalls for ~13
  seconds and every script after it waits. The first run of this suite reported zero rows and
  read exactly like a broken tool. Any future browser suite here wants the same two lines
  before concluding a page is at fault.
- `node test-coldwater-page.mjs` drives `/coldwater` itself — the cloned engine against
  `/api/coldwater`. It pins the things that have each broken once already: the fetch shim
  repointing, `/api/products` never being requested, Greek Glass and `LL_MAIN_SEED` both blanked,
  the corrected filter defaults, the sample-catalogue banner, and the concierge being both hidden
  *and* refused (see below).
- `node test-coldwater-rsc.mjs` pins the Next.js App Router reader with no browser and no network.
  Its fixture is shaped to break the tempting implementation: a product split across a chunk
  boundary mid-string, a description carrying a literal newline and unbalanced-looking brackets,
  and a decoy array placed first.
- `node test-coldwater-collect.mjs` drives the whole bookmarklet workflow in real Chromium against
  a fake dispensary served on a second port: the install page builds a bookmarklet pointing at its
  own origin, the collector reads that menu, posts it, and the rows come back out of
  `/api/coldwater` with the demo fixture stood down. **The round trip is the point** — every
  earlier check stopped at "the endpoint accepts a POST", and a capture that stores fine but never
  reaches the shelf is the failure this page has already had twice in other clothes.
- `node test-collector-batch.mjs` asks what makes two captured rows the **same product**, in the
  browser and again on the server, because that question had two answers and both were wrong. It
  pages a Chromium session through a collection whose titles repeat, asserts the batch grows by a
  full page each time rather than stalling at the distinct-title count, sends it, and reads it back
  out of `/api/coldwater`. The fixtures that must not regress are the ones with **no link per row**
  — a DOM-read menu whose rows all carry the page's own url — because the obvious fix collapses
  those into a single product and still looks like a working capture.
- `node test-coldwater-variants.mjs` covers the size rows: every variant shape a menu arrives in,
  the two pack forms, the refusals, the per-variation merge (including through the real Lume adapter
  against a minimal `__NEXT_DATA__`), and that gear carries no per-gram. Half of it calls the readers
  directly and half drives the real handler over stored captures, because "the arithmetic is right"
  and "the shelf is right" are two different claims. See the sub-variant section below.

  **It was red for eight commits and the reason is worth knowing, because the failure was a
  fixture reading a fixture.** `readIngest()` gained a rule that a row with no product url is not
  a product (the breadcrumb note in `api/coldwater-ingest.js`); this suite's capture fixtures
  predated it and carried none, so the whole block was discarded, `products.length` hit zero and
  the feed fell back to the **demo set** — which happens to contain its own "GMO Cookies",
  "Wedding Cake", "Northern Lights" and "710 Cleaner". So `byName()` found rows, several
  assertions passed against the wrong products, and the six that failed pointed at the size
  parser, which was fine. **The 400 said "Every row needs a name and at least one size carrying a
  price"** and never mentioned the url, which is what sent every diagnosis to the wrong file; it
  now names the condition that actually failed and reports `withName`/`withPrice`/`withUrl`
  counts. The suite asserts `meta.demo === false` immediately after its capture, because a suite
  reading a fixture it did not write is worse than a red one. Any future suite that posts
  captures wants that same one-line probe.

### The Coldwater collector, and the two readers that must stay in step

Three Coldwater shops sit behind platform bot management (Dutchie for Sapura and Exclusive, Jane
for Green Tree Relief). Defeating a bot challenge — stealth headless, TLS fingerprint spoofing,
solver services — is the one thing this project will not do. `public/coldwater-collector.js` runs
in the operator's **own** browser on a page they already have open and posts what rendered to
`/api/coldwater/ingest`. Nothing is bypassed because nothing was denied: the page was served.
`/coldwater-collect` is the install page (noindex, not in the sitemap, not in any nav).

Two things about it are easy to get wrong:

- **`rscRoots()` / `balancedEnd()` exist TWICE on purpose** — in `api/coldwater.js` and again in
  `public/coldwater-collector.js`. A static file served onto a dispensary's origin cannot import
  from `api/`, exactly as `public/js/overrides.js` cannot import `api/overrides.js` and carries its
  own port of `_applyOv` (§6). Change one, change the other, or the browser and the server will
  disagree about what a menu contains.
- **The collector reads in three layers, and it says which one answered.** Page state first
  (`__NEXT_DATA__`, JSON script tags, RSC chunks, window globals), then **React props**, then the
  **rendered page**. The middle one exists because Dutchie and Jane fetch their menu over XHR and
  hold it in component state — no global, no script tag, the data lives only as props hung off the
  DOM nodes under a per-build `__reactProps$…` key. The last one exists because the file had been
  *claiming* to "degrade to the DOM scan below" since it was written and **there was no DOM scan**,
  so any menu keeping its data anywhere unusual produced "Nothing product-shaped found" with no
  fallback at all. A DOM capture has no strain, category or THC — there is nothing printed to read
  — so the panel says so rather than letting a thin capture look like a bad scrape, and the layer
  travels with the capture in `source`.
- **A menu hides in three different ways and they need opposite responses.** A **cross-origin
  iframe** (Dutchie on a shop's own site) must be opened in its own tab. A **shadow root** (Jane,
  at Green Tree Relief) has *no iframe at all* — hunting for one burns an evening, which is what
  happened; open roots are traversed, a closed one is the page declining and is reported as such.
  **Component state** (Dutchie, Flowhub) is nothing in the markup and nothing on a global — the
  menu is a React hook value on a component *above* the DOM nodes, so it needs the fiber walk.
  A closed root cannot be counted (`el.shadowRoot` is null by design), so it is inferred from its
  signature: an element with no children and no text that still occupies real space on screen.
- **The DOM scan queries `*`, not a tag list.** Exclusive renders its cards in **custom elements**,
  so a page carrying 194 prices produced 10 candidate nodes and one group — nothing hidden, no
  shadow root, no React, no iframe, just a query too narrow to see the markup. A tag whitelist is a
  guess about someone else's HTML and it fails silently and totally when the guess is wrong, which
  is the same mistake as reading only `__NEXT_DATA__` or only the light DOM. The
  smallest-element-holding-a-price filter already does the real work, so widening the query costs a
  longer NodeList and nothing else. Related guard: `cardFor()` never climbs into `<body>` — on a
  page whose text sits mostly on one line every ancestor test fails until body, whose first line
  reads as a name, and the whole document becomes one "card".
- **A failure names its cause.** The old panel blamed a Dutchie iframe every time, which is wrong
  on most pages and sends you to do the wrong thing. Cross-origin iframe, nothing rendered yet,
  and too-few-priced-blocks look identical from outside and need opposite responses, so each layer
  records what it saw and the panel reads it back with a copyable diagnostic blob.
- **A price in the variants counts.** Both readers used to require a price on the product itself.
  A flower listing priced per weight has no top-level price — there isn't one, the price belongs
  to the weight — so it was rejected, its array never won the "largest array of product-shaped
  objects" contest, and a fully readable menu reported as unreadable. The downstream code always
  handled variant-only pricing; only the gate disagreed.

- **The layers are UNIONED, not raced, and a menu is often bigger than one pass.** Three separate
  reports of a shop "capping out" had three different causes and one shape. Green Tree stayed at 22
  because shadow roots were enumerated **once at load**, so every card a virtualised list mounted
  afterwards was invisible — they are re-enumerated per harvest now. Herbology stayed at 16 because
  `harvest()` returned at the first layer that produced anything, and page state (whatever the
  server put in the initial HTML — for a paginated menu, page one) is not zero, so the richer live
  React state was never consulted; state and React props are both real fields, so they are unioned.
  And the fiber walk used to run only when the host-props pass came back empty, which meant a page
  rendering 22 cards reported 22 and never read the hook holding all of them. The DOM layer stays a
  true last resort — it carries no strain, category or THC, and letting thin rows overwrite rich
  ones by name would quietly degrade a good capture.
- **A title is not an identity, and reading it as one is a fourth way a shop "caps out".** THCA
  Small Buds sells one strain as several listings, so `/collections/thca-products` runs to hundreds
  of rows over ~170 distinct titles. The batch was keyed by **name**, so it stopped dead at 170
  while the operator kept paging, each page replacing rows rather than adding them — reported as
  "capping out at 170 and not saving from page to page", which reads like storage failing or pages
  being missed. Neither: two different products were being read as one. `readIngest()` deduped by
  name too, so fixing only the browser would have moved the cap one step downstream and left the
  number identical. The **link** is the identity now, in `captureKeyer()`
  (`api/coldwater-ingest.js`), with the collector carrying a deliberate twin for the same reason
  `public/js/overrides.js` ports `_applyOv` — a static file served onto a shop's origin cannot
  import from `api/`. `api/products.js` had this right from the start (`capKey`) and now imports it
  rather than restating it, which is what the two-copies-of-one-rule note in §7 is about.
  **The counter-case is what makes it delicate:** the rendered-page and printed-text layers have no
  per-card link and fall back to `location.href`, and `captureToProduct()` falls back to the
  store's home page. Key on those and a whole menu collapses into ONE row — the same failure an
  order of magnitude worse, and it would look like a successful capture. So a url carrying more
  than one name is not an identity and those rows fall back to the name, exactly as before.
  `node test-collector-batch.mjs` drives the paging in real Chromium and then puts the same rows
  through the server, because the cap existed in both halves.
- **The pound could not be read at all, and half of it read wrong.** `gramsOf()` and its collector
  twin were written in ounces and grams, so a bulk catalogue came back `"withGrams":0` against 170
  products: no price-per-gram, no ranking and no "best $/g" badge on the whole store, which is the
  site's entire proposition missing for a shop that sells nothing else. Worse than the gap was the
  near-miss — `quarter pound` fell through to `/\bquarter\b/` and returned **7 g for 113**,
  publishing a $180 QP at $25.71/g instead of $1.59/g, inside the `MIN_PERG`/`MAX_PERG` bounds so
  nothing downstream caught it. Same family as the 1/8-oz bug: read in the wrong order the rule
  does not fail, it lies. The pound rules therefore sit **above** the named ounce fractions. A
  pound is **448 g** here (16 × the 28 g ounce this file already uses, not 453.59) because every
  figure on the shelf being comparable to every other is the only thing the number is for. The
  unqualified forms match the **whole label**, never a word inside it — **Pound Cake is a strain**,
  and `textHarvest()` offers this function the printed line above a price as a candidate size.
- **A shop can forbid the send without forbidding the script.** The Dude Abides serves a CSP whose
  `connect-src` excludes this site, so the collector reads its menu perfectly and then cannot post
  it — reported as "could not fetch api ... only on that site". That refusal is the page's to make,
  so there are three routes and each one gives up less: the direct `fetch`; then a **relay**, where
  `window.open` (a *navigation*, which CSP does not govern) opens `/coldwater-collect?receive=1` and
  the capture is handed over by `postMessage` for a same-origin POST; then **Copy capture** and the
  paste box on the install page, which no policy can stop. The relay pins `event.origin` at both
  ends and the token rides in the message — no new exposure, since the collector already put it in
  that origin's `sessionStorage`, and the relay uses it for one request and never stores it.
- **THC, batch tags and COAs, and why the batch tag is the interesting one.** `potency` was already
  wired to the captured `thc`, and the engine already has a THC filter and a "Strongest (Total THC)"
  sort — what was missing was measurement, so `?debug&slim` now reports per-store `thcPct`,
  `batchPct` and the observed THC range. The collector captures a COA URL where a shop publishes
  one (`coaOf()` for page/React state, `coaFromEl()` for the rendered page), using the same word
  list as `isCoaUrl()` in `api/products.js` so the two surfaces agree about what a lab result is;
  `toProduct()` already read `coa` and the engine already renders the link, so that chain is now
  complete end to end. **The batch tag is the durable key** — in Michigan every package carries a
  state track-and-trace (Metrc) tag, and names drift, prices change and SKUs are per-shop while a
  tag is the package, so it is the only thing a lab result can be joined on. `sharedBatches` in the
  same debug output reports tags seen at more than one shop with the price spread per gram, which
  is the comparison nobody in this market publishes.
- **An image is lost in four places, so count them rather than guess.** `?debug&slim` reports
  per-store image coverage (total / with / missing / percent, plus five names that came through
  empty). A store at 0% is a capture-path problem; a store at 90% is usually the shop genuinely
  having no photo. The four: a protocol-relative `//images.dutchie.com/...` failing a naive
  `^https?:` test, the picture living under one of a dozen key names, the value being `{url}` or an
  array rather than a string, and lazy loading leaving `img.src` empty or a 1×1 placeholder while
  the real URL sits in `data-src` or `srcset`.

Captures store **KV → Neon → memory**, the same order as `/api/overrides` and for the same reason
(§9). Memory is per-instance, so with neither backend attached a capture can report "Sent" and
then not appear: `/api/coldwater/ingest` reports `persistent:false` and the install page says so
in words rather than leaving it to be discovered.

### Lanes, precedence, and freshness — `api/coldwater-merge.js`

**Every collection route is a declared lane, and rank is declared rather than inferred from
order.** `demo < crowd < aggregator < adapter < headless < feed < manual`. The operator's own
browser capture sits on top by requirement: it is the only lane that reaches the walled Dutchie
and Jane stores, and it is the only one that can say whether the case is actually stocked.

This replaced two rules that were each correct for ONE automated source and silently wrong at
two. `api/coldwater.js` used to splice out a store's scraped rows and push the capture in their
place — right when the only capture was a human's, destructive the moment a harvester posts,
because a thin 30-row capture would delete a 200-row harvest and the shelf would go backwards
while looking freshly updated. And `readIngest()` merged collections "later wins", where later
meant `Object.keys()` order, i.e. whichever was written to storage *first*.

Three rules, and the third is the one that was broken:

1. **Join at the row** — Metrc batch tag first (names drift, prices change, SKUs are per-shop; a
   tag *is* the package), then normalised name. **Not size**, or one product lists once per size
   any lane happened to read.
2. **Higher rank wins per FIELD.** A capture carrying a price but no image does not blank a
   harvested image.
3. **A higher lane NEVER deletes a row it merely did not see.** This is what makes "always on
   top" additive rather than destructive; the double-listing the old splice prevented is now
   prevented by the join, which is the correct place for it.

**Pricing is atomic.** `startsAt`, `sale`, `perG`, `shelfPerG` and every deal field are derived
from `sizes` inside `toProduct()`, so merging them field-by-field yields a card that is
individually correct and collectively nonsense — one lane's rows under another lane's per-gram,
a number that no longer equals price ÷ grams and that **the engine ranks on**. Whichever lane
claims the block supplies all of it, absences included. Same for `potency`+`lab` and
`brand`+`brandKey`.

**`colour` is a namespace, not a rank**, because a rank can be out-ranked and this must not be:
`note, onShelf, observedDeal, staffPick, photo, seenAt`. Written only by a colour-bearing lane,
never overwritten, rendered even when an automated source has filled every other field. It is
worth *more* at full automation, not less — by then it is the only thing the machines cannot
supply.

**Colour is WRITTEN store-level and READ per row, and that split is load bearing.** A
collection is replaced wholesale by the next capture of it, so colour kept inside one would be
wiped by the next harvest — silently, and hardest on the shops harvested most often. It has to
outlive the rows it annotates, because the rows are re-read nightly and the observation is not.
`POST /api/coldwater/ingest` takes `colour: [{name|batch, note, onShelf, ...}]` and needs **no
products**: somebody standing in a shop with "they are out of the ounce" to record should not
have to re-capture the whole menu to say it. An **empty observation is a delete** — the lane
that outranks everything has to be correctable, or a note that stops being true is permanent.

**Not all colour ages the same way.** "Last two jars" and "B2G1 at the counter" are claims about
*right now*; three weeks later they are not old information, they are wrong information, and the
kind a shopper drives across town on. Those perish (`onShelf`, `observedDeal`, 10 days). A note,
a staff pick, a photo of the case are observations rather than claims about current state, and
deleting them on a timer would bin the one thing automation cannot produce. `seenAt` is stamped
**server-side** because it decides when a perishable claim stops being published — a caller may
state an earlier time deliberately, never a later one. An **undated** observation is not trusted
for its perishable half and still delivers its durable half. Ageing happens on **read**, the same
way Neon's `expires_at` is, because there is no timer to run.

**The lane is NOT the `source` field.** `source` carries the reader layer that answered
("collector/&lt;host&gt; via page state") and is free text. The lane travels in its own field and
defaults to `manual`, so every capture already in storage keeps its rank the day a harvester
starts posting beside it.

**RANK IS AUTHORITY; FRESHNESS IS CURRENCY.** Conflating them is worse than a display problem:
the engine ranks on `perG` and prices fall, so a stale row is the *cheaper* row and sorts to the
top — the first thing a shopper sees is the price least likely to still be true. Three states:
fresh counts at its rank, **stale is demoted below every fresh lane** (keeping order among
stale lanes), **expired is gone** — not greyed out, not sorted last. Policy is per lane, because
a cron adapter silent for a day is a broken cron (stale 1d / expire 3d) while an operator silent
for a week is an operator with a job (10d / 30d). Manual is deliberately generous and still
finite. An **undeclared** lane gets the strictest policy, and an **undated** record is stale but
never expired — those rows predate the field and deleting them on a technicality would bin the
operator's back catalogue. An adapter layer carries no `capturedAt` because it is produced during
the request; that is fresh by construction, not undated.

`node test-coldwater-merge.mjs` pins all of it (81 assertions). Every rule here fails silently.

### One core, many cities: the two files a town is allowed to touch

**`api/markets.js` is what a place IS** (name, county, slug, status) and **`api/market-stores.js`
is what is IN it** (the shops, their urls, their wiring). Everything else — the reading, the
merging, the ranking, the rendering — is identical for every city. A behaviour that needs to
differ between two towns is **data in one of those two files**, never a branch anywhere else:
one `if (market === "detroit")` added at 1am is invisible in every test, because every other
city keeps passing.

Two suites, and they ask different questions. `node test-one-core.mjs` asserts no file outside
the registry *compares* against a city name, and diffs two generated city pages line by line.
`node test-market-add.mjs` **adds a city that does not exist**, in those two files and nowhere
else, drives the whole chain against it, then asserts every other `api/` file is byte-identical
to what is committed. A codebase can pass the first and still be impossible to add a city to; it
did, in six places, all silent. The full list is in `ONE_CORE.md` §5; the three worth carrying:

- **There were two town registries**, and `?town=lansing`, `?town=detroit` and
  `?town=grandrapids` all resolved to **coldwater** — registered markets, spelled correctly,
  silently served the pilot's shelf. It could not fail loudly, because falling back IS the right
  answer for a mistyped `?town=` and two registries leave no way to tell a typo from a city
  nobody told you about. **There is one registry. Do not make a second, not even a small one.**
- **A page that fetches an `/api/` path directly bypasses the generator's fetch shim**, which
  only repoints `/api/products`. The sample-catalogue banner did exactly that and asked about the
  pilot, so a second city with no shops would have shown placeholder rows under a real place name
  with no warning at all — the banner reads the pilot's `meta.demo`, sees a connected shop and
  stays quiet. Any `/api/` literal in the generator needs `?town=${MK.slug}` stamped into it.
- **Colour is the one lane nothing overwrites**, so the admin panel's hardcoded
  `market:"coldwater"` would not have put a second city's observation in the wrong namespace
  temporarily — it would have attached it permanently to a Coldwater card.

**The trip page is shared and resolves its town at runtime.** `/coldwater-list` became `/trip`
(308 redirect kept in both routing files) because it is `noindex`, in no sitemap and in no nav —
the opposite case from `/coldwater`, which is indexed and therefore never moves. It reads
`?market=` and falls back to `ll_cw:ctx`, which each city page publishes on load. The cart key
carries the town too (`ll_cw:<slug>:ll_cart`), with a one-time lift of the old flat key run by
**every** city, so the pilot's existing list is not orphaned and no per-city case exists. Its
Maps link appends the *resolved* market — it used to append `", Coldwater, MI"` to every address,
which on a second city routes a shopper ninety miles the wrong way.

### The scheduled headless lane — `tools/harvest-coldwater.mjs`

Drives real Chromium at each shop's own menu, injects the **same** collector the bookmarklet
uses, and posts with `lane:"headless"`. It calls `autoScan()` rather than `harvest()`: a single
harvest sees what is mounted, which on a virtualised menu is one screenful, and `autoScan`
already carries the settle rule a human supplies by eye. Reimplementing that would be a second
copy of the hardest logic in the file.

**Zero dependencies** — raw CDP over `spawn()`, the pattern the suites already use. The browser
lives in tooling and CI, never in `api/`, which is what keeps `dependencies` empty (§1, §11).
`.github/workflows/harvest-coldwater.yml` runs it nightly on GitHub's hardware; a Vercel cron
cannot, because a browser is ~300MB and 10–20s per store.

**It is not a way past the walls, and it is written to make that legible.** No stealth flags, no
fingerprint work, no solver. Plain headless is exactly what a challenge detects, so a challenged
store is *reported* and handed to the operator's lane — printed as a manual-lane **worklist**,
because that assignment is the output of the run rather than an exception in it. Three outcomes
look identical from a row count of zero and need opposite responses: **walled** (hand over),
**empty** (investigate), **errored** (fix the run). Told apart by text markers, not status codes,
since a challenge is served as 200 more often than not.

`node test-harvest-coldwater.mjs` drives the whole round trip in real Chromium against a fake
dispensary on a second port and reads the rows back out of the ingest store — including that the
harvester lands in the `headless` collection and **not** the manual lane.

**A FOURTH OUTCOME WAS WEARING THE THIRD ONE'S CLOTHES.** The three above are told apart because
they need opposite responses — and a page that **never loaded at all** was being filed as `empty`,
which is the one verdict meaning "go and look at the shop". `Page.navigate` answers with an
`errorText` when the navigation itself fails (DNS, a refused proxy, a dead menu url); that result
was discarded, so the collector went on to scan a browser error page, found nothing
product-shaped, and the store was reported empty. Found by running `--dry` from a container with
no egress: **seven Coldwater shops, six `empty` and one tripping the location guard, and not one
of them said the page had failed to load.** It is `errored` now, per candidate, and only when
*every* candidate failed — the next path may well be fine. It is also **twenty times faster**: the
old path spent the full settle cap scanning an error page, so seven unreachable shops took 85
seconds and now take 7. `test-harvest-coldwater.mjs` pins it against a port nothing listens on,
and the existing "genuinely empty shop" assertion is what stops the fix collapsing the two.

> Two bugs that suite caught, both worth knowing because they mislead rather than fail: the
> collector's `window.__LL_COLLECT__` handle sat at the END of the IIFE, but the "Nothing
> product-shaped found" path *returns* before that — so on exactly the pages where the
> distinction matters, the handle never existed and the harvester reported a broken injection
> when the truth was an empty menu. Its position above the first `harvest()` is load bearing.
> And `meta.stores.via` named every layer assembled, crediting a lane whose adapter had just
> 403'd, in the one field you read to find out which lane is broken.

### Scrolling is not paging, and a row count cannot tell them apart

**Added 17 Aug 2026, from a re-pull of every Coldwater shop.** Full write-up in
`COLLECTOR_AUTOMATION.md`, which sorts every behaviour here into standard / vendor / software /
shop, because mixing those up is how the same evening gets spent twice.

`autoScan()`'s contract is "the menu is taller than the window". A numbered pager is "the menu is
longer than the page" — a different decision by a different platform needing a different move —
and Dutchie makes it. Measured on Sapura: a complete `autoScan` reaches the bottom of page one,
sees three dry ticks and returns **98 rows out of ~700**, in 21 seconds, reporting a confident
count of them. The 698 on the shelf were the operator clicking Next seven times and re-running the
bookmarklet, which works because the batch accumulates across runs on purpose.

So `autoPage()` sits **beside `autoScan` in the collector**, not in the harvester, and is exposed
on `__LL_COLLECT__`. Put it in the scheduled lane instead and the manual lane keeps clicking Next
forever while the two disagree about what a complete capture is — the same drift the
`__LL_COLLECT__` header already argues against for `autoScan` itself. It finds a Next control the
way a person does (a clickable thing whose accessible name says next, never a per-site selector),
skips the collector's own panel, stops on **two** dry pages rather than one (an overlapping page
window legitimately adds nothing), and reports `pagesVisited` / `pagedStop`. The harvester
feature-detects it and raises its own settle cap when it is present, because seven pages under a
one-page cap is a truncated menu published as a whole one.

**Two collector bugs the same re-pull found, both with rows on the shelf, both silent:**

- **`guessStore()` tested for a retailer id that is not in the URL.** Sapura's menu is
  `/embedded-menu/northeast-alternatives-coldwater/products`; the id was never in that path, so
  the test could only ever fail and every `dutchie.com` capture pre-filled **`exclusive`** — 693 of
  Sapura's 698 rows published under Exclusive's name. A default that is wrong for every shop on a
  shared host but one is a coin flip with a confident face. Matched on the slug now, and an
  **unknown slug returns `""`**: an empty box stops the operator, a plausible wrong one does not.
- **The `notAListing` guard counted rows whose url differed from the *current* `location.href`.**
  The DOM and printed-text layers write `location.href` into every row, and that href *changes* as
  you page — so stale page-urls read as product links and 697 rows of nav copy (`Name Z - A`,
  `SPECIAL OFFER`, `MARKET`) published as Exclusive's menu. Counts **distinct** urls now, as a
  ratio, so a real eight-product menu is not flagged while 700 rows sharing four are.

**The guards are the point of the scheduled lane, and they live in `tools/harvest-guards.mjs`** —
separate because the harvester starts a browser at import time, and these are the only decisions
in it checkable with no browser and no network. Every capture failure this project has had
*succeeded* and was wrong; nothing threw. Blocking: a floor per shop, a refused layer, more rows
than the shop's own feed declares, a chain serving the wrong town, and **>60% product-name overlap
with another shop in the same run** — the Sapura/Exclusive bug in its general form, and the only
check that compares two shops to each other. Warning only: low distinct-url ratio (normal for
Dutchie, which carries no per-row link, and for Banzen, whose rows are brand pages) and low weight
coverage. That split is argued case by case on purpose: a guard that cries wolf teaches whoever is
on call to pass `--force`, which disables every other guard at once.

`node test-collector-autopage.mjs` pins all of it — the guards in plain node against the real
failures, then the pager in real Chromium against a four-page menu, asserting **40 rows and not
10**, that page one *and* page four are present, and that a blocked capture stores nothing rather
than merely logging a complaint.

### A bookmarklet is a snapshot, and it could not say so

**Two reports on 19 Aug, one cause: "can't get the bookmarklet to launch on Sapura/Dutchie" and
"Dude Abides just reading 5 lines and stopping."**

**Dutchie refuses the loading bookmarklet, silently.** The `javascript:` URL itself runs — clicking
a bookmark is a user action and is exempt — but the `<script src>` it injects is an ordinary
cross-origin script, and a strict `script-src` refuses it. **A CSP-blocked script fires no error
event**, so nothing happens and nothing says why: it reads as "the bookmarklet will not launch"
rather than as a refusal. The self-contained build exists for exactly this and carries the whole
collector inside the URL (~350 KB), so there is nothing to fetch and nothing to block.

**And that build is a SNAPSHOT frozen on the day it was dragged**, which is the second report.
The Dude Abides was fixed on 17 Aug (the tier-table note above); a bookmark dragged before that
still holds the old reader, still returns five plausible rows, and **a stale reader does not fail
— it returns a smaller menu that looks fine.** `test-collector-remix.mjs` was green the whole
time, because the repo's collector was never the one running.

So the collector now answers "am I the current one":

- **`BUILD` is published at `public/collector-build.txt`**, and `checkBuild()` fetches it from
  **the origin the bookmarklet came from** (`__LL_COLLECTOR_SRC__`), never from the shop — the
  whole point is that a bookmark outlives the page it is used on. A mismatch paints a gold line in
  the panel naming the current build and telling the operator to re-drag.
- **It cannot break a capture.** A shop with a strict `connect-src` refuses the request (The Dude
  Abides does), and that refusal is not an error — it means the check is unavailable. Nothing
  waits on it, it is asked once per run, and an up-to-date collector says nothing at all, because
  noise is how a real warning gets ignored.
- **The install page prints the current build** beside the drag target, read out of the file it
  already fetches — never typed, or it becomes a fourth copy and the one an operator actually
  reads.

**Three copies of one fact, held together by `node test-collector-build.mjs`.** The drift with
teeth is `collector-build.txt` against the constant: every collector would announce itself stale,
or none would, and both look exactly like the feature working.

> **A suite that pins a date has to be edited every time the thing it checks changes correctly.**
> `test-collector-remix.mjs` asserted `/^2026-08-17\./` on the build and went red the moment it
> was bumped. It reads `collector-build.txt` now and asks the question that actually matters:
> is the collector under test the one in the working tree.

### Four navigation shapes, and the reader that only existed on one lane

**Added 17 Aug 2026, from The Dude Abides reporting five products.** The diagnostic
said `bestArray:5`, `pickedKeys:"name,weight,price"`, `pagedStop:"no next control"` —
three symptoms, and the pager was the least of them.

**`remixRoots()` was written in `api/coldwater.js` and never ported to the collector.**
`rscRoots()` and `balancedEnd()` exist twice on purpose (§ the collector note above) because
a static file served onto a dispensary's origin cannot import from `api/`; the Remix reader
skipped that step, so the server read the shop richly and the bookmarklet could not read it at
all. Remix ships loader data as a global assignment **and as function calls with JSON
arguments**, and nothing that scans for a container sees either. Ported now, with the two traps
its server twin already documents: the JSON is the third argument after strings containing a
bracket and an escaped quote, and products sit **nine levels deep**, so the collector's
depth-8 walk was cutting off the menu rather than failing to parse it. Depth is 14.

**A price tier is not a product, and it satisfies every test that says one is.**
`{name:"Ounce (28g)", weight:28, price:5000}` won on the collector's only rule — length —
so the store read as five rows. Arrays are scored on **catalogue richness** now (brand,
category, image, product name), length breaking ties, exactly as `api/coldwater.js` learned
first. The carousel **union** is ported too (the page ships ~14 carousels of twelve, so
largest-array-wins reports a twelve-product dispensary), keyed on name + variant + price — and
it takes **catalogue arrays only**, because without that threshold the tier table loses the
`best` contest and then walks into the union, which is bigger than `best` and replaces it.
Same five rows, one layer along.

**Scrolling, paging and tabbing are three different questions and they nest one way:**
`tabs -> pages -> scroll -> load-more`. A **load-more** control APPENDS to what is on screen,
so it belongs to `autoScan`, which used to give up the moment scrolling went dry — which on
these menus is the button, not the bottom. A **Next** control REPLACES the rows, so it belongs
to `autoPage`. **Category tabs** switch which catalogue is shown, so `autoTabs` wraps both.
`autoAll()` runs the tree and degrades cleanly (no tabs → pager, no pager → scroller), so one
entry point is correct on every shop; the panel button is **Scan everything** and the harvester
feature-detects `autoAll` → `autoPage` → `autoScan`.

Tabs are found by **ARIA** (`role="tab"`, `aria-selected`), never by markup guessing, and a
category link whose href leaves the page is deliberately NOT a tab: following one destroys the
script's execution context mid-scan, and while the batch survives in `localStorage` the loop
does not, so it reads as a hang. **One batch, many tabs, so mind the collection name** — a
combined capture under a new name ADDS a copy beside any per-category collections already on
the shelf.

`node test-collector-remix.mjs` pins all of it in real Chromium against a fixture built to
break the tempting implementation: carousels of twelve, a tier table, nine-level nesting, a
hostile deferred call, a load-more button and two tabs. The assertions are **numbers** — not 5,
not 12, but 40 distinct strains, then 40 → 100 across the tabs. It clears `localStorage` before
injecting, because the collector harvests on injection and the 18-hour batch otherwise carries
the previous run's rows into this one: the first draft of that suite failed on tiers its own
earlier run had published, long after the code that produced them was fixed.

### The deal chain was complete and starving — `sizes[].sale` was null on every row

**Added 17 Aug 2026.** `sale` was null on all 5057 rows at all seven shops, and every link
downstream already worked: the ingest sanitiser keeps `sizes[].sale`, `rawOf()` passes it
into `row()` as slot 7, `toProduct()` reads slot 7 as a real unit price, sets `dealBasis`
"sale price", and folds it into `perG` while `shelfPerG` keeps the label price. **No server
change was needed.** The collector never read a parallel sale ARRAY — which is exactly how
Dutchie ships a discount — so the site ranked discounted products at their list price.
Sapura renders $7.00 struck through beside $4.90; we stored $7.00.

Four capture fixes, each of which alone was sufficient to keep the field null:
`parallelSalePrices()` beside `parallelPrices()`; **`variantsOf` missed capital `Options`**,
which Dutchie uses; **`looksLikeProduct` required the price to be ON the variant**, so a
listing whose variants are label strings with a parallel price array was rejected before
anything else ran; and **`V_SALE` omitted `"sale"`**, this codebase's own name for the field,
so `variantRows()` dropped it while the hand-written capture path carried it.

**The refusals are the half that matters.** Same-length arrays only and strictly lower: a
ragged pair is refused rather than zipped, because an off-by-one does not merely misprice, it
prints a **saving that does not exist** — the one number here nobody would think to check.
Menus also leave the array populated after a promo ends, and "was $12, now $12" reads as a
bug to a shopper and as something worse to a regulator.

**Deal names come from the platform, not from a regex.** Dutchie states them in
`specialData.saleSpecials[].specialName` and `.bogoSpecials[].specialName` — the shop's own
sentences, carrying the CONDITION, which is the part a bare percentage loses. BOGO bucket
first, because a bundle changes what you have to buy; extras counted as `+1` rather than
concatenated. And **a product name must never become a deal**: `dealFromText` matched
"special" in *Special Sauce Rosin*, a strain, so Banzen published its own title as a deal
badge — which renders as the name twice and gets debugged in the wrong file.

**What is deliberately not modelled:** store-wide sales, daily deals, customer-class
discounts and gift-with-purchase are not properties of a product. Lume runs more promotions
than anyone and shows zero because none attach to a row. They need a store-level sibling
object (`DEALS-ANALYSIS.md` §5), and they must never enter `perG` — a veterans' rate is real
and most shoppers cannot use it, so ranking on it makes the site's central number one nobody
can reach.

`node test-collector-deals.mjs` drives the real collector in Chromium over the live shapes,
then puts the rows through the real `variantRows()` and `toProduct()`, because "captured" and
"ranked correctly" are two different claims — and it was the second that exposed the `V_SALE`
gap. `toProduct` is exported for exactly that reason.

### A brand page is not a product page, and the twin that knew it was the wrong one

**Added 17 Aug 2026, from an audit of Banzen.** The site publishes **1,465 products** —
confirmed two independent ways that agree exactly: the sum of every category's own
`total_count`, and the 1,465 urls in `products-sitemap.xml`. A full scan of the Vape Pens
category (308 products) returned **twelve rows**, and the panel had been reporting "97
products" for a shop with 104 brands. Both numbers are brand counts.

**Banzen links every card to a BRAND page** (`/menu/brands/jeeter-365986`), not a product
page. `keyOf()` keyed on the url whenever it differed from `location.href`, so all 308 vape
pens of one brand landed on one key and overwrote each other — a 99.2% undercount that reads
exactly like a truncated scan and sends you to the scroller. **More scrolling cannot fix a
keying bug.**

**The rule already existed, on the other side.** `captureKeyer()` in `api/coldwater-ingest.js`
collects the names seen against each url, marks any url carrying **more than one name** as
ambiguous, and keys those rows by name. `keyOf()` is its documented twin — three lines from a
comment reading *"change one, change the other"* — and never got that half. This is the same
class of failure as the unported `remixRoots()`: one twin correct, and the surface that
mattered was the other one. Here it is worse, because **the rows collapse in the browser**, so
the server's correct rule never sees them; fixing the server would have changed nothing.

**Ambiguity is a property of the SET, so the batch is re-keyed rather than appended to.** The
first product of a brand looks perfectly unambiguous; the second is what proves the url is a
brand page, and by then an append-only merge has already overwritten the first. Every merge
now rebuilds from the union of what is held and what just arrived — the same algorithm
`captureKeyer` runs, one rule stated once in two files that cannot import each other.

**The counter-case is what makes it delicate, and it is pinned as hard as the fix.** The
rendered-page and printed-text layers have no per-card link and fall back to `location.href`;
key on those and a whole menu collapses into ONE row — the same failure an order of magnitude
worse, and it would look like a successful capture. Two real listings sharing a title (THCA
Small Buds sells one strain as several) must still stay apart.

`node test-collector-banzen.mjs` drives all three in real Chromium and asserts the numbers.
**It was verified against the unfixed collector: 5 rows instead of 60**, reproducing the
live 12-of-308 ratio, while both counter-cases pass in either run — a suite that passes
against the bug it exists to catch is worse than no suite, and the first draft of this one did
exactly that because the fixture gave each product its own brand url.

**Batch expiry was silent, and a silent drop looks like storage failing.** Reported as a batch
that "read 97 when I opened the page and 0 a few minutes later, without me touching Clear" —
which is the 18-hour TTL working exactly as designed. The panel now says how many rows were
dropped and how old they were.

### The extractor crossed the shadow boundary; the controls never did

**Added 17 Aug 2026, from Green Tree Relief sitting at 29 rows through every other fix.**
Jane renders its whole menu — cards AND controls — inside **open shadow roots**, and
`document.querySelectorAll` does not cross a shadow boundary.

The extractor already knew this: `reactHarvest()`, the DOM scan and `scrollers()` all walk
roots via `deepAll()`. **All three control finders did not.** `nextControl()`,
`moreControl()` and `tabControls()` were written against the light DOM, so on a Jane shop
the scroller worked perfectly while the pager, the load-more button and the category tabs
were invisible.

**The failure is indistinguishable from the truth, which is what makes it expensive.** The
run reports `pagedStop: "no next control"` and `tabsFound: 0` — which reads as "this shop
has no pager" rather than "this shop's pager is somewhere we cannot look", and sends you
back to the scroller. That is where two evenings on this shop went.

`node test-collector-jane.mjs` puts **everything** behind the boundary — cards, the
load-more button and the tabs — because a fixture that leaves the controls in the light DOM
passes against the bug it exists to catch. **Verified against the unfixed collector: 10
rows instead of 80**, with `tabsFound: 0` and no load-more clicks, which is the live
signature. `tabControls()` also re-enumerates the roots before looking, because a
virtualised menu mounts new ones as it goes and a tablist can arrive after load.

**Banzen's collection name is still wrong and that is deliberate.** 1412 rows spanning every
category sit under `topicals`. Renaming is not a code change — a capture under a new name ADDS a
second collection and leaves the first, so the store would hold both copies. Press Clear on
`/coldwater-collect` first.

**The shelf says THC; the feed still says THCa; both are correct.** Chemically the flower in
a Michigan jar is mostly THCa until it is heated, and on the hemp site that distinction is the
entire product — "THCa flower" is what is sold and what the law turns on. To someone walking into
a Coldwater shop it is jargon: the jar says THC, every number they compare says THC, and "THCa"
reads as a different drug or as a typo. So `cannabinoid` stays `"THCa"` in `api/coldwater.js`,
because the engine's filter accepts exactly `THCa` / `CBD` / `Botanical` and any other value drops
the product out of the filter *and* the per-gram path — and an additive `cw-thc-label` block
relabels only what is **printed**, walking text nodes and leaving every `option.value` alone. Two
rules, in order: `THCa Flower` → `Flower` (the engine's own category label; "THC Flower" would be
an improvement and still not what anyone calls it), then `THCa` → `THC`. It reapplies on mutation
for the same reason the trim chip does — the grid re-renders on every filter and sort with no hook
to attach to.

**A capture must reach the shelf at once, and that means caching the scrape rather than the
answer.** `/api/coldwater` used to cache the finished payload for 30 minutes, so a browser capture
could store correctly and still be invisible for half an hour; reported as "the tool refreshes the
grab but the live site is not updating even when I ctrl shft r", and a hard reload cannot help
because none of the staleness was in the browser. What is expensive here is talking to seven shops;
reading captures is one cheap read from the backend the ingest endpoint just wrote to. So the
scrape is cached and the captures are merged fresh on every request, and the CDN window dropped to
`s-maxage=30` — long enough to shield the origin, short enough that a capture feels immediate.

**An implausible price per gram is suppressed, not published.** The four-cent eighth was caught by
the owner looking at the page; the parser that caused it is fixed and pinned, but the *class* of bug
is not — any future label form that fools `gramsOf()` produces a figure that looks real, **ranks
first because it is cheapest**, and is the first thing a local shopper screenshots. So a `perG`
outside 0.25–1000 is nulled and the rejected value kept in `perGSuppressed`; the card shows no
per-gram rather than a wrong one, because an absence reads as missing data and a wrong number reads
as a lie. The bounds are deliberately wide — this guards arithmetic, not pricing. The deal-adjusted
figure gets the same guard, since misreading an offer can produce nonsense just as easily.
`perGramSanity` in `?debug&slim` counts how often it fires and names what it rejected: **zero is the
expected reading**, and anything else is a label form the parser does not understand yet.

**`gramsOf()` reads fractions BEFORE bare numbers, and that ordering is the whole function.**
"1/8 oz" used to reach the ounce rule first, whose `[\d.]+` happily matched the **8 after the
slash** — eight ounces, 224 g, and a $10 eighth published at **four cents a gram**. Every
price-per-gram, every ranking and the "best $/g" badge are built on this number, so getting it
wrong is silent and total. The `\b` in the grams rule matters for the same reason: without it
"10 mg" reads as ten grams. `node test-coldwater-grams.mjs` pins every label form these menus
actually use, including the ones that are *not* weights (`1-Pack`, `100mg`, `One Size`).
**And the feed re-derives grams from the label rather than trusting the capture** — the collector
computed grams at capture time, so menus read before the fix have 224 stored against a `1/8 oz`
label, and those captures *are* the shelf. Re-deriving repairs them in place instead of requiring
every shop to be captured again; the stored value survives only where the label yields nothing.

### One listing, many sizes: the sub-variant work, and three numbers it fixed

**Added 16 Aug 2026, from one report: "some items are just showing the options on one line or only
showing one option", "710 cleaner is listed price per gram and shouldn't be", "you have one showing
200 grams instead of 2.00 grams".** Three symptoms, three unrelated causes, and every one of them
produced something that *looks* finished — a card with one option looks like a shop that sells one
size, a per-gram on glass cleaner looks like a price, 200 g of pre-rolls looks like a weight.
`node test-coldwater-variants.mjs` pins all of it, half against the readers directly and half
through the real handler over stored captures.

- **`variantRows()` reads five shapes, and only one of them used to work.** The old code understood
  an array of OBJECTS each carrying a label and a price; everything else fell through to a single
  "One Size" row at the product's top-level price — which is the *cheapest* variation's price, so
  the ounce vanished and the eighth's price was published as the listing's. The shapes: objects;
  **parallel arrays** (`options:["1g","3.5g"]` + `prices:[12,35]`, paired by index); the price inside
  the string (`"3.5g - $35"`); a label-keyed map; and **Jane's per-weight FIELDS**
  (`price_gram`, `price_eighth_ounce`, …), which is why Green Tree Relief came through with one
  option per listing. Two refusals are deliberate: parallel arrays of **different lengths** are never
  paired (an off-by-one prices an ounce at an eighth's price), and a label with no price is dropped
  rather than published at the parent's. Twin of this lives in `public/coldwater-collector.js`, for
  the reason `rscRoots()` does — change one, change the other.
- **`mergeListings()` gathers per-variation entries back into one listing.** Lume does not publish a
  product with a size selector at all: its catalogue is one entry per weight, each with a
  `displayVariation` and one price. Rendered-page captures do the same, because Dutchie wraps every
  weight in its own link. Mapped one-to-one that is a shelf of one-option cards where the eighth and
  the ounce of one jar never meet. The key is deliberately narrow — same shop, same category, same
  brand, same name once a trailing weight is stripped — because a 1 g cart and a 3.5 g jar of one
  strain must not merge; it is **not** the engine's `groupByStrain`, which merges on strain alone.
  Merging runs BEFORE `toProduct`, since `startsAt`, `perG` and stock are all computed across rows.
  It also repairs captures **already stored**, which is the point: 2,567 rows are the shelf right now.
- **A label stating several weights states none of them.** `gramsOf("1g 3.5g 7g 14g 28g")` is 0 —
  one price cannot be attributed to five weights, and the first of them is not the answer. That is
  the backstop for a selector captured as one option; the collector now splits a line into one row
  per price (`pricePairs()`), so fresh captures do not produce them at all. The same guard tolerates
  one weight written twice: `"3.5g (1/8 oz)"` is still 3.5.
- **The two pack forms mean opposite things, and the 200 g came from reading them the same way.**
  `2 x 1g` states the weight of EACH, so the packet is 2 g; `20pk 10g` states the weight of the
  PACKAGE, so it is 10 g — Michigan packaging carries net weight because Metrc requires it, so a
  ten-pack printed with 3.5 g is three and a half grams, not thirty-five. The **engine multiplies
  both** inside the blob, so the only defence is for the feed to supply a weight and never leave a
  zero for it to fill: `gramsFromTitle()` reads unbracketed titles for that reason (the bracket rule
  was only ever half of how these titles state a weight). A pack whose arithmetic is not believable
  (>50 units, >½ lb) returns nothing rather than falling back to the unit weight.
- **`GRAM_BOUNDS` per category is the backstop**, loose on purpose: a pound of flower is real at
  448 g and a pound of pre-rolls is not a product. Out of range zeroes the row and records why in
  `gramNotes`, which `?debug&slim` reports as `gramPlausibility`. Edibles, drinks and topicals are
  deliberately NOT bounded — their weight is a gummy or a bottle, which is a different quantity from
  grams of cannabis, but that is a judgement about what to publish rather than a parse error, so it
  is reported and left for a decision.

**Gear carries no price per gram, and it takes TWO stops.** A four-ounce bottle of 710 cleaner was
on the shelf priced per gram, filed under Flower. Both faults were independently sufficient: it has
no category on the menu, so `normCategory`'s last resort read the ounce in its size label as flower;
and the engine fills any row whose grams are zero **from the label itself**, so nulling `perG` in the
feed was invisible to it. So `isNonConsumable()` (an explicit word list — **precision over recall**,
because a miss costs nothing and a false positive takes the per-gram off real flower) drives:

1. **`cannabinoid: "Accessory"`**, which is the one switch the engine already honours — its
   accessory-card branch draws no per-gram, no size dropdown and no strain, so there is nothing left
   for it to guess with. `normCannabinoid` leaves the value alone, and the cannabinoid *filter*
   correctly excludes gear when a shopper picks THC.
2. **the row label stops stating a weight.** `gramsFromLabel` reads "4 oz" as 112 g, the engine's
   "an ounce or more is only ever sold as flower" rule fires, and the bottle lands in the Flower
   facet — measured: `["710 Cleaner","THCA Flower","Accessory"]`. The stated size moves to the
   **description**, which that card prints and nothing parses. Not the title: the engine renames what
   it renders (its strain parser strips a trailing parenthetical) while the shopping list and the deal
   chip look products up by the title the engine PRINTED, so an extended title is one the list can no
   longer find. Only where there is ONE row — multi-size gear keeps its labels, and
   `gearWeightLabels` counts it.

That card is written for a mail-order glass shop, so the `cw-gear-card` block in the generator drops
its shipping estimate, turns "Ships from X" into "At the counter, X" and "Add to Cart" into "Add to
list" — printed text only, same discipline as the THCa relabel.

**`sizeRows` in `?debug&slim` is how any of this gets diagnosed next time.** A shop that genuinely
sells one size and a shop whose selector nobody parsed looked identical from outside, which is why
this reports them apart: `oneRow`, `oneSizeOnly` (one row **and** no weight read — the shape of an
unparsed selector, and the number to watch), `multiWeight`, and `merged`. **A store reading
`oneSizeOnly` near its own total needs re-capturing with the bookmarklet** — the collector reads
shapes now that it could not read then, and no server-side repair can invent rows that were never
captured. Gear and title-weighted carts are excluded from that tally so the fix cannot read as the
fault.

**Row slot 7 (index 7) is a stated sale price, and it was read before it was ever written.**
`toProduct`'s deal arithmetic has always consulted `r[7]`; nothing in the file set it, so every
per-size discount a shop states was captured, stored by the ingest sanitiser, and dropped here.
`row()` takes it now. **Index 5 stays the row's own URL** — the engine reads it when a grouped card
builds a cart link, so a price parked there would be handed to the browser as an address.

**Deals are captured, and folded into price per gram — but only where the arithmetic is
unambiguous.** Sapura's carts run on multi-buy offers, and a comparison site that shows the shelf
price and hides the offer tells a shopper $25 each for something they pay $20 for; since the engine
*ranks* on `perG`, an offer left out of it puts the wrong shop first on exactly the products people
came for. So `dealMath()` computes `N for $X`, `buy N get M free` and `N% off`, and **refuses**
everything else: "mix and match" spans different items at different sizes, a bare "BOGO" is
buy-one-get-one *free* in some shops and *half off* in others, and "bundle"/"special" carry no
arithmetic at all. A confident wrong number is worse than a missing one, because it looks
authoritative. Everything computed carries its **qualifying quantity** — $20 each is true at five,
not at one — and `shelfPerG` is kept beside `perG` so the card can explain a figure that no longer
equals price ÷ grams. The chip prints the shop's own words plus "$20.00/g at 5+"; without that
suffix the number reads as an arithmetic error. `node test-coldwater-deals.mjs` pins the refusals
as hard as the sums, including that `120% off` must not match the `20` inside it.

### The satellites are generated from `index.html` now — `api/shelves.js` + `tools/make-shelf.mjs`

**`/consumables`, `/devices` and `/international` were three hand-written pages of ~120KB each**
that fetched `/api/products` and then rendered their own cards, their own store and category
filters, their own sort, their own cart drawer and their own checkout link. None of the engine.
So every improvement to the shelf — the three rails, the card flip, the full-screen photo viewer,
the sentences on the back, price-per-gram ranking, the eight gear buckets — **stopped at `/`**.
Four copies of `storeCheckoutUrl()` is what this repo does when a rule gets restated; these were
four copies of a whole site.

**The slice is the only difference**, and it is `api/shelves.js` — the same argument as
`api/markets.js`, and the same rule: one `if (shelf === "devices")` anywhere else is invisible in
every test, because every other shelf keeps passing. `test-shelves.mjs` asserts no `api/` file
outside the registry names a shelf.

**The predicates were measured off the pages they replace, not invented.** The old pages ran
`prodGroup(p) = !prodIsGlass(p) ? "cons" : (isGlassAccessory(p) ? "glass" : "devices")`, and
`/devices` claimed **both** `devices` and `glass` while `/consumables` claimed the complement — so
the split between them is **a distinction no page ever rendered**. `isGlassAccessory()`, a
fifteen-line regex triplicated across all three files *with a comment in each copy warning they
would drift*, decides nothing anybody sees; it is not ported. And Greek Glass is deliberately kept
out of `/api/products` (§7), so `prodIsGlass` reduces to `cannabinoid === "Accessory"` — which the
feed already publishes and the engine already honours. The feed now stamps `group` per product so
no page re-derives it.

**The slice is applied SERVER-SIDE.** `?shelf=<slug>` filters in `api/products.js`; a fetch shim
repoints `/api/products` before the engine asks, exactly as `cw-endpoint` repoints it to
`/api/coldwater` on a city page. Filtering behind the engine's back would leave its own facet
counts describing a catalogue the shopper cannot see, which is the failure every rail exists to
avoid. It also means the gear page stops downloading ~7MB of flower to hide it. An **unknown slug
is ignored rather than served empty** — a typo should show the whole shelf, not a blank one.

**The shim must be installed AFTER `feed-meta.js`, so it wraps it rather than being wrapped.**
Both patch `fetch`, and source order decides which sees the URL first. Wrong way round and the
rails count the whole site while the grid shows a slice — a chip reading 1,218 above a grid
holding 300. The generator asserts the ordering; `test-shelves.mjs` asserts the outcome
(`LL_META` built from this shelf's rows).

**The cart divergence is inherited, which is the correct half of it.** These pages keep
`localStorage["ll_cart"]` and "Add to Legal-Leaf Cart" and check out at the vendor; a city page has
no cart and says "Add to Shopping List". Generating from `index.html` gets that for free.

> **A source search became the wrong question, and would have failed against working pages.**
> `test-cart-label.mjs` grepped each satellite's file text for a bare "Add to Cart" — right while
> they rendered their own buttons, wrong once they run the engine, whose accessory literal travels
> inside the blob unedited and unsearchable and is relabelled at render. It asks whether they are
> still *generated* now; `test-shelves.mjs` asks the real question in a browser.

### The shelf defaults were already right and nothing was holding them there

**Measured 19 Aug 2026 before writing a line: filters collapsed, sort `pergram`, CBD off, trim
off, Ounce+ and a $75 budget — all four correct on `/`, on a phone, and on a generated city
page.** The work was not to build it; it was that **nothing pinned any of it.**

> **And then four of those five were wrong.** Reported the same day: "too many products are being
> hidden as cbd or trim to start off — the load should be a fresh clear all state on llm and the 3
> dispensary sites." Ounce+, the $75 budget, CBD off and Trim off hid most of the catalogue from
> somebody who had asked for nothing, which is a search run on a visitor's behalf rather than a
> shop front. All four are cleared on load now; every one is a click away in a panel the button
> offers to open. **Sort is not a filter and stays** — ordering by best $/g hides nothing and is
> the whole proposition, and "newest" answers a question nobody asked either.
> The generator's own `cw-defaults` block, which used to wait for the grid and clear the ounce and
> the budget for a city page, is **gone**: the source clears them for every surface now, and a
> copy of a rule is one edit away from silently overriding the original.

The engine's own defaults are the opposite (`sort:"newest"`, `inclCBD:true`, `inclTrim:true`,
panel open, inside the blob), and the homepage block overrides them by driving the engine's **own
controls**, because engine state is closure-scoped and unreachable (§5). That is the right
approach and it rests entirely on ids the engine owns — `#fSort`, `#inclCBD`, `#inclTrim`,
`#filterPanel`, `#fMinQty`, `#fBudget`. Rename one in a re-cut and the shop front silently opens
splayed wide, sorted by newest, with CBD and shake diluting every comparison. Nothing errors.

`node test-shelf-defaults.mjs` drives **four moments**, because a default that holds at load and
not afterwards is worse than none: first paint, the live hot-swap, after a filter moves, and on a
phone. It also asserts **hidden is not removed** — one click brings CBD back, one brings
Trim/Shake back — through the grid rather than through a class.

- **On a phone `.hidden` is deliberately NOT the mechanism.** Mobile CSS neutralises it
  (`display:block!important`) because there the whole `.filterwrap` **is** the drawer, parked at
  `left:-343px`. So "collapsed" is measured as off-screen, not as a class.
- **Two things the block must never do**, both reasoned about in its own comment and both silent
  if they regress: it must not click `#toggleFilters` (the mobile drawer script binds that same
  button to `openSidebar()`, so a synthetic click slides the filters **open** on every phone), and
  it must not click `#bestDeals` (that fires a "Sorted by best $/g" toast on every page load).
  The toggles are clicked **only while still on**, never blind, because the engine's handler flips
  whatever it finds.
- **A city page inherits the panel, the sort and the two toggles but NOT the ounce or the
  budget**, and that difference is asserted so it stays a decision rather than drift: a walk-in
  shopper is not buying by the ounce with free shipping over $75.

> **The same trap as the `/library` check, hit again.** The block's comment argues about
> `#toggleFilters` and `#bestDeals` **by name** while explaining why it never clicks them, so a
> whole-block regex went red against the prose describing the very behaviour it was asserting.
> The window starts at the IIFE, after the comment — and the suite asserts it located a block at
> all, so a slice that silently misses cannot pass vacuously.

### A capture may fill a gap; it may not make a field poorer

**Reported as "the blacktie subscription is a complicated pull — it needs a type and quantity drop
down, and it currently has no picture either."** Read out of the live feed with
`?debug&find=subscription`, that product was:

```
image: ".../67377d17e4f4bdf16b5487e0_chevron-down.svg"
sizes: [["One Size", 15, 0, "blacktiecbd-cap-0", true, null, false]]
gallery: [four real Shopify product photographs]
url:   ".../budtenders-choice-flower-subscription"      (no ref stamp)
```

The `-cap-` id is the tell: a rendered-page **capture** had merged onto a perfectly good scrape.
The comment over the merge said *"fill the gaps rather than overwrite wholesale"* and the loop
under it replaced **every non-empty field**, so one line produced all three symptoms at once — a
UI arrow replacing four product shots, one flat row replacing the variant ladder, and an
unstamped link replacing the affiliate one.

Three rules now, and each is a different kind of wrong:

1. **Richer wins.** A one-row capture must not replace a six-row scrape. That is the missing type
   and quantity dropdown.
2. **Pricing is atomic** — the rule `api/coldwater-merge.js` already states for the lanes.
   `startsAt`, `sale` and `perG` are derived from `sizes`, so one lane's rows under another lane's
   per-gram is a card that is individually plausible and collectively nonsense, and **the engine
   ranks on that number**.
3. **The url keeps its affiliate stamp.** `refUrl()` stamps the scraped url; a captured link
   carries none. Overwriting it produces a link that works, a customer who buys, and a commission
   of zero — with nothing anywhere showing it went wrong. Black Tie had lost `ref=coffeeandajoint`
   exactly this way.

**Stock is still taken from the capture, always** — three of these stores report most of their
catalogue out of stock to a lambda and correctly to a browser, which is the whole reason the lane
exists.

**And a chevron is not a product photo.** Upstream of all of it, whatever the collector returns IS
the image and nothing asked whether it looked like one. `looksLikeUi()` refuses SVG (menus serve
photography as raster) and UI words in the **filename** — chevron, caret, arrow, sprite, logo,
spinner. It tests the path only, so a product called "Arrowhead Kush" keeps its picture. And
`imgFromEl()` now scans **every** `<img>` on the card rather than the first: a card's first image
is often a control, so refusing it without moving on trades furniture for nothing at all.

> **The same call found a second bug, in the other subscription.** CBD Hemp Direct's rows read
> "Quantity: 1 Ounce" → 28.35, "2 Ounces" → **0**, "4 Ounces" → **0**. `grams()` ended in a flat
> `/\bounce\b/`, which cannot match the plural at all (the boundary fails between the e and the
> s) and threw the quantity away where it did match. Two of three sizes had no weight, no price
> per gram, and no place in the ranking — and a zero reads as "this shop does not sell it by
> weight" rather than as a parse miss.

`node test-capture-merge.mjs` executes the shipped merge statements over a scraped/captured pair
rather than restating them, and pins the ounce forms including the ones that must stay zero.

### And then it had to actually be a feed — three causes, one report

**Reported 20 Aug 2026: "I need the products to be shuffled on load for llm. it needs to feel like
a social media feed like the other pages."** The interleave above was already shipping on `/`, so
this reads as a regression and is not one: it is three separate faults that the city pages happened
not to have. Measuring `/` at **production store proportions** is what separated them — the
existing suite's fixture is three equal shops, which is the one shape where all three are invisible.
The opening twelve were:

    Puffy Grasscity Puffy Grasscity Puffy Grasscity Puffy CBD Puffy THCA Puffy Puffy

**1. Nothing in the deal was ever random.** It was a pure function of the ranking, so every visitor
saw the same shelf in the same order on every visit, forever. That is an interleave, not a feed.
The round order is re-drawn per load now, and each shop offers one of its top **WINDOW** (3) rather
than always its single best — so two visits differ in *content*, not merely in order, while a card
that leads is still among that shop's strongest.

**2. The fullest bucket always won.** Each slot went to whichever shop had the most cards left,
which at 2234 / 1223 / 303 / 245 / … is Puffy and Grasscity for the whole opening screen. **Both
rules are right, for different halves.** A round — one card per shop, shuffled order — is what the
head wants, and is terrible at the tail, where the small shops run dry and the shelf ends in a wall
(measured: a run of **seven**). Fullest-bucket is provably the best you can do about runs and is
wrong at the head. So: **one round, then fullest-bucket.** Neither is discarded.

**3. A deal is only as wide as the pool it is dealt from, and this is the one that made the other
two look fixed when they were not.** The engine's `PAGE` is **12** and that constant is inside the
blob, so the opening shelf is twelve cards — and twelve cards ranked by price per gram contain four
shops however cleverly they are rotated. **The city pages already knew this**: `cw-feed` presses
the engine's own Load more to `FLOOR` (40) *before* dealing, which is the actual reason they read
as a feed and the hemp shelf did not. The top-up lives in the shared file now, behind the same
`driven()` guard as the observer — where `cw-feed` is sequencing, it keeps its own, because it has
a row-trim to run after. Pressing the bar is the engine's own paging: `shown` is a closure variable
inside the blob and anything setting it directly would be guessing.

Measured after: **11 shops in the opening twelve**, longest same-shop run **1** across 48 cards,
and three loads give three different shelves.

**WHAT IS ALREADY DEALT STAYS DEALT**, and once the deal is random that stops being a nicety —
without it, pressing Load more re-deals the cards the shopper is looking at. Cards are remembered
by `data-pid`. **The freeze is for appends and only for appends**, which cost two flaky runs to
learn: keeping the surviving order across a *deletion* produces a repeat no rule made and none can
see (deal `A B A C`, lose `B`, and the kept order is `A A C`). On this page the deletions come
from the page's own load-time filter clearing, so it fires before a shopper has touched anything.
If any remembered card is gone, the shelf is dealt fresh.

> **The two axes do not get the same bound, and the asymmetry is the design.** The shop axis is
> decided globally, so "no shop twice running" is a guarantee. The category axis is decided *inside*
> whichever shop the shop axis chose — because shop outranks category on a price-comparison shelf —
> so when that shop holds one category, the category repeats. Bounding it at 3 **raced**: it passed
> for a year only because the deal had no randomness in it, and flaked the moment it did. The claim
> is now that no category takes over the shelf. Likewise no category claim is made on the wide
> fixture at all: it prices by the gram like the real feed, so only flower carries a `perG` and the
> engine sorts everything else below it — the top forty are nearly all flower before the deal sees
> them. That is the site's proposition working, not something a shuffle should undo.

> **The generator asserts on this file's SOURCE**, so renaming a function here fails the city-page
> build. An earlier pair named `byStore` and `byCategoryOnly` and went red the day those were
> folded into one deal function taking the axis as an argument, with the behaviour unchanged. They
> name the *call* now (`dealRounds(fresh, storeOf…`), which cannot survive the behaviour being
> dropped.

### The opening shelf is dealt out, not listed — `public/js/shelf-shuffle.js`

**A pure ranking walls up.** The grid is sorted by best price per gram, which is the whole
proposition — and one shop's catalogue, or one category, lands as a solid block at the top, so the
first screen says "this is a Grasscity page" or "this is a flower page" rather than "this is a
comparison". Reported on the city pages as *"you say it's interweaved across shops, that's not
true, I see just Banzen by default"*.

So the opening shelf is **dealt**: no shop twice in a row, and no category twice in a row where
there is a choice. Ties keep the engine's own order, so this is a **rotation of its ranking**, not
a replacement — the cheapest thing per gram is still the cheapest thing per gram, it just is not
followed by five more from the same shelf.

**The category axis is chosen WITHIN the shop, and the first version had it between shops.** It
broke ties in bucket *size* by looking at each bucket's head card, which can never fire: a bucket
is sorted strongest-first and a product with a real price per gram always outscores one without,
so every shop's head is flower until its flower runs out. The result rotated shops perfectly and
still opened with six flower cards in a row. The shop is picked first, on fullness, exactly as
before — then the strongest card in *that* shop whose category is not the one just placed. Shop
order is untouched, because "who is selling it" is the axis a shopper scans and a category repeat
is a blemish where a shop repeat was the reported bug.

**It stands down the moment somebody asks for something**, and "untouched" is a fact about the
shopper — a **trusted** event — not a guess at the controls. Two earlier versions read it off
`#fSort` and `#fBudget` and both stood down on every load in production, because the page sets
those itself. The rails announce their chips with `ll-facet-picked` rather than being detected.

**One driver per grid.** The city pages sequence it inside `cw-feed`'s paint cycle (top up, deal,
trim), so the shared file exposes `window.LL_shuffle()` and arms its **own** observer only where
that block is absent — read inside the arming function, not at parse time, because `cw-feed` is
injected later in the document. Two observers reordering one grid shows up as cards twitching
rather than as an error.

`node test-shelf-shuffle.mjs` drives it on `/` and on a city page.

> **Three traps it cost, all of which read as a broken shuffle:** an edible priced by the ounce is
> filed as flower by the engine's own "an ounce or more is only ever flower" rule, so a fixture
> that gives every product a 28g size has **one** category and nothing to rotate. A city page does
> not read `/api/coldwater` — its shim repoints `/api/products` to **`/api/market?town=<slug>`** —
> so a fixture server answering only the first two leaves the shelf empty while the page still
> renders. And **"the first card" is no longer a stable target**: `test-card-flip.mjs` and
> `test-shelves.mjs` both clicked it and started landing on one of the engine's 85 baked Greek
> Glass seed products, which carries no description. A fixture should address its own rows.

### `?debug&find=<text>` — one product, whole

Every report of the form "this listing is wrong" — no picture, the wrong sizes, a dropdown that
should be two — needs somebody to read that product's actual row, and the only ways to do it were
to download the ~7MB catalogue or to guess. Guessing is what §7 tells you not to do, and the 7MB
is not reachable from a phone, a log line, or an agent behind a proxy. Matches on name, store or
id and returns the **full** product objects rather than a projection, because the point is to see
the fields nobody thought to summarise. Capped at 12.

### The card flip goes back on mouse-out, and the sentences finally land on the back

**Click to open, move away to close.** Without it the only ways back were clicking the card a
second time or finding the "Flip back" button, and neither is what a hand does after reading a
card back. Three things make it a gesture rather than a tripwire, and all three are why this is
more than a `mouseleave` one-liner:

- **A 260ms grace period.** `mouseout` fires on a cursor grazing one pixel of the card's edge on
  its way somewhere else.
- **`relatedTarget` containment.** `mouseout` also fires moving *between children of the same
  card*, so without the test the card closes while the pointer is still on it.
- **Not while the photo viewer is up.** Opening a photo full screen moves the cursor off the card
  by definition, so the card behind would flip back and Escape would return the shopper to a face
  they never left.

**IS THERE A POINTER? OBSERVED, NOT ASKED.** The first version gated on
`matchMedia("(hover:hover) and (pointer:fine)")` and that is wrong twice: a laptop with a
touchscreen reports a coarse primary pointer, so a mouse user would have had the feature silently
switched off — and **headless Chrome reports `hover:none`/`pointer:none`**, so it was disabled in
every browser suite while looking like working code. `Emulation.setEmulatedMedia` does not move
`matchMedia` for those two features and `--blink-settings` did not either, which is a signal about
the rule rather than about the harness. A real pointer announces itself: a bare `mousemove` that
did not follow a touch within 800ms. A phone only ever fires one in the compatibility burst after
a tap, and the flag is always set before any `mouseout` could — a pointer cannot leave a card
without having moved onto it first. The media query stays as a positive fast path.

**THE SENTENCES ARE ON THE BACK NOW, ON EVERY CARD.** `api/products.js` and `api/coldwater.js`
have both published `description` since the descriptions work; `public/engine.js` renders it in
**exactly one place** — the accessory / Greek Glass branch (`.ggdtext`) — so every flower card
went down the size-selecting branch and printed nothing. That is why this had been "tried a few
times" and never landed globally. The flip back is the additive layer that exists on every card,
so it is the right place. It reads the card's own copy first and the feed's second, the same
source-of-truth rule the Total THC and $/g rows already follow, keyed on the feed's product id
(which is what `data-pid` carries). Both meta publishers now carry `desc` under the same name —
`feed-meta.js` on the hemp shelf, `cw-endpoint` on a city page — because a second name there would
leave every city page with a blank back and nothing to show for it.

Also: the card photo no longer claims to magnify. `photo-view.js` appends
`#grid .card img{cursor:zoom-in}` at runtime, written when the photo *was* the opener; the expand
control took that job over and the cursor was left telling the wrong story.

> **Three traps for whoever drives a pointer in a browser suite next**, each of which cost a run
> that read as a broken feature. The headless viewport opened at **441px** here and a flipped card
> is taller than that, so scrolling it to centre put its own heading above the fold — set
> `Emulation.setDeviceMetricsOverride` and assert the target is on-screen before dispatching.
> `Input.dispatchMouseEvent` at a y beyond the viewport lands on nothing, so no `mouseover` fires
> and therefore no `mouseout` can either (`"mousemove seen: 1, mouseout on grid: 0"` is the
> signature). And a **dispatched** `MouseEvent` carries `relatedTarget: null`, which sails straight
> past the containment guard — drive the input domain, not `dispatchEvent`.

### No suite calls a real shop, and `LL_NO_STORE_FETCH` cannot cover a browser

**`public/engine.js` fetches `https://api.bigcartel.com/greekglass/products.json`** to refresh
Greek Glass on top of its baked seed. That is page code, not `api/` code, so the flag §10 relies
on does not reach it — and **every browser suite serving `public/index.html` was calling a real
merchant on every push**. Invisible from the containers this repo is edited in, where egress is
refused. Blocked at the CDP network layer alongside Google Fonts in `test-cart-label.mjs`,
`test-rails.mjs`, `test-gear-categories.mjs` and `test-card-flip.mjs`.

**It also hid a live bug for exactly as long.** With network the engine merges the live shop and
the dropdown came back carrying **Big Cartel's own collection names** — `New Arrivals`,
`Elite Series`, `Gemstones`, `Puffco Attachments`, `Carta Attachments`, `Quartz Bangers`,
`Carb Caps` — two of which are not categories at all, and `New Arrivals` held 23 products of every
kind. A hand-maintained fold list would have missed all seven and gone stale the next time the
shop adds a collection, which is why `public/js/gear-categories.js` is **a lookup for what we have
seen and a rule for what we have not**: `gearCat()` is a deliberate twin of `accessoryCat()`, and
`test-gear-categories.mjs` drives one corpus through both.

**`launchChrome()` now waits for a page target too**, and asks for one if none appears. A debug
port is not a page: every suite polled `/json/list` with its own retry count, and on a loaded
runner `about:blank` can register later than the shortest of them allows — which surfaced as
"Chromium did not expose a page target" from `test-concierge-browser.mjs` while the browser had
started perfectly. Same shape as the failure the helper was written for, one step further along,
so it belongs in the same place rather than being fixed sixteen times at sixteen timeouts.

### The synthetics, and the lane that had no gate

**Reported 20 Aug 2026: "we are pulling in a bunch of stuff from Binoid manually right now that
should be excluded. Any delta eight, any of the synthetic cannabinoids should be excluded. They
always used to be. Now they're slipping through."** Two independent faults, and the first is why
this reads as a classifier bug and is not one.

**`captureToProduct()` ran no gate at all.** `normShopify()` and `normWoo()` each apply four
before publishing a row — `isJunk`, `notCannabis`, Apparel/Merch and `excluded()`. The capture
path applied **none of them**, and never called `classify()`, so a captured product carried the
shop's own word for its category and **no `cannabinoid` field whatsoever**: not merely admitted
past the exclusion, but *unfilterable* once admitted, because the engine's cannabinoid facet reads
that field. Measured live with `?debug&slim&find=blend`: seven `hipuffy__cap__thca-thcp-super-blend-disposable-*`
rows on the shelf, `category:""`, whose own descriptions list THCP, Delta-8, Delta-9, Delta-10 and
HHC — **in the same request where the scrape was correctly refusing 128 Δ8, 39 Δ9 and 6 THCP from
Binoid.** That contrast is the whole diagnosis: the rule was working, on one of the two paths.
Same shape as `capKey` against `captureKeyer` and `rscRoots` against its collector twin.

**And the vocabulary had holes, one of them visible in the source the whole time.** `Δ11` sat in
`EXCLUDE` with **no branch of `classify()` able to produce it** — an exclusion that reads as
enforced and enforces nothing. THC-O, HHC-O, THCjd, HXY, Δ6 and the **-P forms** had no branch
either. Delta Extrax writes THCP as **"D9P"**, and `\bd9\b` cannot match "d9p" (there is no word
boundary between the 9 and the P) while `/delta[\s-]?9/` needs a word that title does not carry —
so "THCA + D9P 2G Cartridge Duo | Adios Blend" fell through to `thca` and published as flower.
**Measured against the shipped ladder**, the two live rows split one fault each: the Puffy blend
already classified as THCP and published anyway (the missing gate), the Extrax cart classified as
THCa (the missing word).

Four things worth keeping:

- **The ladder is an ORDER, and the order is the rule.** A blend returns the first branch that
  matches and every synthetic sits above `thca`, so "THCa THCp Super Blend" resolves to THCP and
  is refused rather than resolving to THCa and being sold as flower. A product containing a
  synthetic **is** a synthetic product, whatever else is in it. Reorder the ladder and blends
  start publishing; nothing errors.
- **The -P forms go first**, and that is not cosmetic. Both readings are refused either way, but
  the drop tally is a diagnostic, and a THCP product logged as `excluded:Δ9` sends the next
  reading of it to the wrong file.
- **The name decides; the description is deliberately not consulted.** Every leaking row named its
  synthetic in its own title. Reading marketing copy instead would refuse a real THCa flower whose
  description says "unlike delta-8" — a sentence half this catalogue contains. Precision over
  recall, the same side `isNonConsumable()` errs on and for the same reason: a miss costs one
  listing, a false positive deletes live inventory.
- **`SYNTHETIC_WORD` answers *whether*, `classify()` answers *which*.** The title-first CBD
  override used to carry its own hand-copied half of the vocabulary and had already fallen six
  tokens behind, so the rule written to protect CBD listings could relabel a "CBD + D9P" product
  as CBD. One regex now, consulted by both.

Captured rows are refused with a `capture:` prefix in `?debug&slim` — `capture:excluded:THCP`,
`capture:apparel` — because "which lane let this in" is the question that cost the most time here.
An admitted capture now also carries a `cannabinoid` and, where the shop supplied none, a
`category`: fill the gap, never make the field poorer.

`node test-synthetics.mjs` pins it — 46 assertions. The durable one is **symmetric**: every token
in `EXCLUDE` must be one `classify()` can emit, and every synthetic `classify()` emits must be in
`EXCLUDE`. Two claims, both of which had failed, neither of which errors. The counter-cases are
pinned as hard as the refusals, including "THC Oil" (one letter from THC-O), "Delta Extrax" (a
brand with no digit after it) and "Pound Cake".

### A shop is not a maker, and Shopify cannot tell you the difference

**Reported 19 Aug 2026: "black tie, thca small buds and so on are showing up in brand as well as
store — I just want it to be in store."** Exactly right. `normBrand`'s first signal is the feed's
own brand field, and Shopify's `vendor` is *the shop's own word for who made the thing* — which at
a house-brand store is the shop. So every Black Tie product carried brand "Black Tie CBD", and the
brand rail redrew the store rail sitting next to it.

**It was in the census before it was on the page.** `multiShop` read **one** across 168 makers,
because a store brand cannot appear at a second shop by construction. That number was reported and
then not acted on; this is what it meant.

`isStoreBrand(brand, storeName, storeKey)` in `api/brand.js` refuses it, and **both feeds apply
it** — `api/products.js` on the Shopify and Woo paths, `api/coldwater.js` on the capture path.

- **Matched on the product's OWN shop**, never a list of every shop. "Cookies" is a real maker and
  somewhere it is also a shop name; dropping it globally would lose a genuine comparison.
- **The one case it gets wrong, on purpose:** a Cookies product at Cookies-the-shop loses its chip
  while the same maker at another shop keeps it. That costs a shop *count*, not the brand, and
  precision is the right side to err on — a wrong chip looks exactly like a real one.
- **Prefix on the name, equality on the key.** A shop and its house brand rarely spell it the same
  ("Black Tie" vs "Black Tie CBD", "Chill" vs "Chill Steel Pipes"), so the name test is a
  boundary-aware prefix. The **storeKey test is equality only**, and the first draft got that
  wrong: keys are squashed (`chill`), so a prefix test on the flattened brand made **"Chillum Co" a
  house brand of Chill Steel Pipes** — a real maker dropped as a shop. There is no word boundary in
  a squashed key to stop at.

`test-brand.mjs` pins both halves, and the counter-cases (RAW and Storz & Bickel at Grasscity,
Puffco at Chill) as hard as the refusals: a fix that trades a duplicated rail for an empty one is
not a fix. `test-cbdhempdirect.mjs` asserts it through the real handler — that fixture's own
`brands` taxonomy names the store, so the correct payload carries **no brand at all**.

### The gear shelf is eight buckets, and it was sixteen

**Reported as "the categories are too granular now on the accessories and devices ... rethink to
be more condensed like the dispensary side", and the numbers agreed.** `#fCategory` was carrying
Accessories, Glass & Parts, Terp Accessories, Rolling, Rigs, Storage & Trays, Grinders,
Vaporizers, Torches & Lighters, Cleaning, Pipes, E-Rig Attachments, Bangers, Carb Caps,
Glassware, Tubes, Collectibles, Ash Catchers and Tools. **Nine held fewer than ten products and
`Tools` held one.** That is exactly the failure `api/coldwater.js` writes up for Edibles — "four
thin filter entries where two of them held one and two products" — and the rule it settled on is
the one applied here: **the filter wants the fewest useful buckets.**

**The dispensary's own answer is ONE bucket, and it is wrong here.** A Coldwater shop sells
twenty accessories, so `Accessories` covers the lot. This site sells ~1,500 across Grasscity,
Chill, Greek Glass, Zam, Mein-Grinder and Hitoki, and one chip holding 1,500 products is not a
filter. So the **principle** travels and the list does not: `Vaporizers, Bongs & Rigs, Pipes,
Grinders, Rolling, Storage & Trays, Parts & Tools, Accessories`, each holding 40+.

**TWO CATALOGUES MEET ON ONE SHELF, and that is why this took two files.**
`accessoryCat()` in `api/products.js` produced eleven of those words; the engine's **baked Greek
Glass seed** — 85 products inside the blob — carries eleven more, and the engine passes accessory
categories straight through, so both lists reached the dropdown at once.

- **The feed's half: not one regex changed.** Every test in `accessoryCat()` is byte for byte
  what it was; only the labels moved, four rungs now sharing `Parts & Tools`. So no product can
  land on a different rung than it did yesterday — the merge is provable by reading, and a
  re-classification bug cannot hide inside a re-labelling. Widening a rung is a separate change
  with its own evidence. (`Rigs` → `Bongs & Rigs` is a rename, not a widening: that test has
  always matched bongs, beakers and bubblers, and a shopper looking for a bong could not see the
  word anywhere on the page.)
- **The seed's half is unreachable from any server.** `public/engine.js` must re-encode
  byte-identically (§5), so `public/js/gear-categories.js` folds its eleven onto the same eight
  through **the engine's own manual-category override** — the same lever, and the same three
  traps, as `cw-catsplit`: mutate `LL_MANUAL_CAT` rather than replacing it, carry **no `name`
  field** (the engine falls back to name-matching when the id misses), and wrap `exportBatch` so
  a derived map cannot be published into shared storage. A real manual decision still wins.
  On a city page the seed is blanked, so it finds nothing and stops — no flag, no branch.
- **`GEAR_CATEGORIES` is exported and the two halves are held to it.** The files cannot import
  each other (the `_applyOv` problem), so a target spelled differently on one side is a **ninth
  bucket holding the seed's products alone** — which would look exactly like the bug it replaced.

**Eight buckets need eight faces, and this is the part that is easy to skip.** Without a `PREFER`
table of its own a gear bucket falls through `HINTS` to `Accessories`, whose positives are
`grinder|tray|banger|pipe|bong|rig|papers|lighter|torch` — so a photograph of a bong scores +3 as
the face of **Grinders**. That is "Topicals is a bud" wearing different clothes, and a confidently
wrong picture is worse than the granularity was. Each bucket now states what a bad picture of it
looks like as well as a good one. `ORDER`, `ICON` and `GLYPH` gained entries too: without them
`Rolling` resolved through `HINTS` to Pre-Rolls (a joint, for rolling papers) and `Parts & Tools`
to nothing at all, which falls back to a **cannabis leaf**.

> **`Vaporizers` means two different things on the two sites** and the table only carried one. On
> a dispensary page it is a 510 cart; on the hemp shelf it is a dry-herb device or an e-rig, so a
> Puffco matched no positive and floored at the "any photo beats no photo" tier. The device terms
> are **added** rather than swapped, so the dispensary reading is untouched.

> **One pre-existing quirk is pinned rather than fixed:** the rolling rung sits above the tray
> rung, so a "rolling tray" files under `Rolling`. Defensible, and moving it would mean changing
> the ladder — which this change deliberately does not do.

`node test-gear-categories.mjs` drives both halves: the classifier in plain node against real
product names, and the fold in real Chromium, because the only honest proof that the seed's
eleven words are gone is a rendered `#fCategory`.

### The three rails live in `public/js/rails.js`, and until 19 Aug 2026 they lived in one town

**Shop by store, shop by category and shop by brand were worked out on NicotiaMarket, ported
into `tools/make-coldwater.mjs`, and then reachable only from a generated city page** — 65KB of
injection inside the generator, unavailable to `public/index.html`, which is *the file the
generator reads*. The hemp shelf could not show a rail that its own city pages showed.

They are `public/js/rails.js` + `public/css/rails.css` now, loaded by `index.html` and inherited
by every city page the way `engine.js` is. **Nothing in any of the five blocks was ever
city-specific, and that was measured rather than assumed** before moving them: zero template
interpolations across all of them, and exactly three references to one feed-shaped global. The
generator's assertions moved with them (`railBlock()` keeps each one scoped to its own rail, for
the reason the `/library` note gives — a document-wide regex goes green against the prose in a
neighbouring block, which has happened here twice).

- **Every rail is a face for a control the engine already owns** — `#fStore`, `#fCategory`, and
  the search box `#q`. They act by setting that control and firing its event, and the number on a
  chip is the engine's own facet count. That is what keeps them honest: a chip holds no state to
  drift from the dropdown it faces.
- **`window.LL_railsMeta()` is the one place a feed is read**, preferring `LL_META` and falling
  back to `LL_COLDWATER_META`. City pages keep publishing the latter from `cw-endpoint`; there is
  no reason to churn a working shim to rename a global.
- **`window.LL_TOWN` is what makes a page a town.** The brand rail's "Your town not here? Bring
  it on" is recruitment copy addressed to somebody looking at a CITY page; on the national shelf
  it is addressed to nobody. Gated on that global, set by the generator — deliberately **not** on
  `localStorage`'s `ll_cw:ctx`, which survives the visit, so the hemp page would inherit whichever
  town was browsed last and print the note. A bug only some visitors would ever reproduce.
- `node test-rails.mjs` drives all three on `/` in real Chromium; `test-coldwater-page.mjs`
  already drove them on a city page and staying green there is what proved the move.

**`public/js/feed-meta.js` does not fetch, and that is its whole design.** `index.html` was asking
`/api/products` **four times on a cold load** — the engine plus `ll-coupon-pct`, `ll-trim-label`
and `ll-checkout-fix`, each of which grew its own because there was nothing to share. The response
is ~7MB, and Vercel *consumes* `s-maxage`/`stale-while-revalidate` at the edge and strips them, so
what reaches a browser is a bare `Cache-Control: public` with no max-age at all — no heuristic
freshness, a revalidation per caller at best. A fifth consumer that fetched for itself would have
been the wrong answer to the wrong question, and **tapping alone would have left all four**: an
observer that watches waste happen is not a fix. Identical URLs now share one request and every
caller gets its own `clone()`. Measured in Chromium: 4 → 1. Keyed on the **full URL** so `?refresh`
stays a real refresh, capped at **60s** (the edge is already ten minutes stale at best, so this
covers the load burst and nothing else), and a **failed fetch is never cached** — otherwise one
flaky request poisons every later caller with no request in the network tab to explain it.

**On a generated city page feed-meta stands down without a flag.** `cw-endpoint` is installed
later, so it wraps this one, and it repoints `/api/products` to `/api/coldwater` before calling
through — by the time the request reaches this tap the path no longer matches. One code path, no
branch, nothing to keep in step.

### The nightly price recorder runs on Vercel, not on Actions

**`/api/price-history` folds today's shelf into a per-product summary** — lowest ever and when,
highest ever and when, current, and how many days we have looked. It is the one feature here where
**waiting destroys value**: there is no backfill, so every night the catalogue is scraped and the
numbers thrown away is a night that cannot be recovered.

**It was scheduled in `.github/workflows/price-history.yml` and it never once ran.** Two firings,
24 and 25 Aug 2026, both dead in four seconds — the exhausted-Actions-minutes signature §10
describes, where a runner is assigned and the job cannot begin. `GET /api/price-history` said
`nothing recorded yet` for a month while the storage and the token were both configured correctly,
which is exactly the shape of failure that gets diagnosed in the wrong file. **A nightly job whose
value is destroyed by waiting must not sit behind a billing ceiling.** `vercel.json` owns the 08:20
UTC run now; the workflow is kept on `workflow_dispatch` as a hand-run lever.

**The argument against a Vercel cron was true when it was written and is not now.** The workflow's
header said the write is gated on `LL_ADMIN_TOKEN`, that the secret already sits in Actions, and
that putting it in a second place is a credential in two places. But `LL_ADMIN_TOKEN` was *already*
in Vercel — it has to be, because the endpoint reads it to **check** a write — so there was never a
second place to put it. The cron proves itself with `CRON_SECRET` instead, so no credential moved.

**THE SCHEDULER'S REQUEST IS A GET, AND THAT IS NOT THIS CODEBASE'S CHOICE.** Vercel's cron issues
GET only, so the one write has to be reachable that way. Three guards keep a side-effecting GET
from being the mistake it usually is, and **every one of them fails silently** — a cron that falls
open looks exactly like a cron that works:

- **Opt-in per request.** `?record=1`, never the bare path, so nothing a browser, a crawler or a
  link preview follows can reach it.
- **Gated on `CRON_SECRET`, refusing when unset.** Same failing-closed rule as `LL_ADMIN_TOKEN`,
  for a stronger reason: an open write here pins a false all-time low that no later reading can
  ever beat.
- **`no-store`, on every outcome including the refusals.** A cacheable side-effecting GET is worse
  than a slow one in both directions: the edge would serve the recorder's own reply to a shopper
  asking for the history, and after the first night the cron would stop reaching the function at
  all — the record silently stops growing while everything reports success.

**IT ASKED A HOST THAT ANSWERS 200 AND NO PRODUCTS, and that is why it had never recorded
once.** The first Vercel fire, 26 Aug 08:20:15, got past the auth gate and returned **503 in under
a second** — diagnosed first as a schedule problem, then as a timeout, and it was neither. This
project runs Vercel SSO protection at `all_except_custom_domains`, so every `*.vercel.app` host —
previews **and the generated production alias** — answers an anonymous request with a redirect to
`vercel.com/sso-api`. A scheduled invocation arrives on exactly such a host; the invocation itself
is exempt, but `loadCatalogue()`'s self-fetch is an ordinary anonymous request and it echoed the
caller's host straight back. `fetch` followed the redirect, got **200 HTML**, `r.ok` was true,
`data.products` was undefined, and the only symptom was `catalogue returned no products` from a
catalogue holding 5,950.

**A wrong host cannot fail loudly here, because protection replies 200.** It also only bites the
one code path no visitor takes — the concierge, the kit builder and `/p/` all call the same
function and all work, because they arrive on the custom domain. `siteHost()` in `api/feed.js`
refuses a generated host as an **address**, never as a caller: `LL_SITE_HOST`/`LL_SITE` (a full url
is reduced to its host, since that variable already exists carrying one), then the asking host,
then `VERCEL_PROJECT_PRODUCTION_URL`, then the public domain. `node test-feed-host.mjs` pins the
counter-cases as hard as the refusal — pinning production unconditionally would break local
development in the identical read-200-get-nothing way, and `not-vercel-app.com` must survive.

**A write that returns `false` is not a recorded night.** `save()` answers false when no backend
takes it and the handler reported `ok:true` over that — which is how a record stops growing while
every reading says success.

**`maxDuration: 300`, and the recorder's own log line is how you know what it cost.** Measured on
the first good run: `catalogue 5950 products in 32340ms`, `recorded 2946 products`. The self-fetch
came back `cache=MISS`, so it scraped rather than reading the edge — the 06:00 `?refresh=1` cron
warms a **different** CDN key (`?refresh=1` is not the bare path), so it does not warm this. That
is a second full read of sixteen catalogues in a day; it is bounded, and the `in Xms` figure says
which happened on any given night — ~30s means it scraped, ~1s means it was served warm.

**The two gates do not cross-wire.** `CRON_SECRET` does not unlock the `POST`, and
`LL_ADMIN_TOKEN` does not unlock `?record=1`. `node test-price-history.mjs` **drives the real
handler** for all of it rather than grepping the source as the older half of that suite does — with
no storage configured, `record()` refuses before it loads the catalogue, so reaching *that*
particular 501 is the proof a request got past the gate and any other status is the proof it did
not. Two different refusals, told apart, and no network needed. Verified against four mutations: a
gate that falls open, a bare GET that records, a cacheable response, and a missing cron entry.

### The seed loses to the last shelf you saw — `public/js/feed-cache.js`

**"Fuck the seed. It sucks anyway and doesn't even have pictures. Can you always put the last
cache up instead of the seed, and then refresh on top of that."** The engine ships a hardcoded
`window.LL_PRODUCTS` so the grid is never blank while `/api/products` is in flight. It has no
photographs, and on any connection slower than an office one it is what a visitor looks at first.
Last visit's catalogue beats it on every axis: real products, real prices, real pictures, theirs.

**A fetch shim, because the seed is not reachable any other way.** The engine already prefers
`window.LL_MAIN_RAW` over its seed — but only inside `LL_rebuildWithGG()`, which is closure-scoped
and never put on `window` (measured: zero assignments, two internal calls, both from the Big Cartel
refresh). `LL_admin.reprocess()` re-runs ingest only from the engine's own captured list. There is
no way in from outside, and re-encoding the blob to add one is what §5 exists to forbid. What *is*
reachable is the request, and this repo already repoints that same URL twice (`cw-endpoint`,
`ll-shelf`).

**IT IS A RACE, NOT A CACHE-FIRST, and that is the honest part.** The engine applies the feed
**once**; there is no second apply to refresh into, so "cache now, live a moment later" would mean
a second copy of the hardest code in the repo. So whichever is ready first wins, with the cache
given a 450ms head start it usually needs and never a long one — network inside that and nothing
changes at all; slower, and last visit's shelf is up instantly. Either way the live response
refreshes the store for next time, so staleness is bounded at one visit and the tab showing it is
already writing the fresher copy.

**A refusal is not an answer, and `fetch` does not agree**: it rejects on a transport failure and
*resolves* a 500 like anything else. Both are caught, or the case where the cache most obviously
beats the seed — the origin being down — is the one case it does nothing about, sitting beside a
branch that looks like it covers both. The write is gated on `r.ok`, so a bad day cannot evict a
good catalogue.

**KEYED ON THE FULL URL, WHICH IS NOT A DETAIL — IT IS THE SHELVES.** `/consumables`, `/devices`,
`/international`, `/vaporizers` and `/combustion` do not fetch a different route: `ll-shelf`
repoints this exact path to `/api/products?shelf=<slug>`, so the **pathname is identical** and only
the query separates a gear catalogue from a flower one. One key across all six means a visit to
`/devices` deciding what the hemp shelf shows on the next slow load — the wrong catalogue under the
right heading, which is worse than the seed and would read as a scraper bug. `refresh` is stripped
from the key (an instruction about how to answer, not a different shelf), so a forced scrape
refills the entry it bypassed rather than opening a second beside it. The ring is bounded at three
entries, evicting the oldest write, or six shelves would spend the whole origin budget on
catalogues nobody is looking at. Storage is `localStorage`, capped at 500 products with `gallery`
dropped — the largest field by far, and a first paint needs one photo per card, not eight. A quota
failure clears the ring and gives up rather than retrying smaller.

**Installed BEFORE `feed-meta.js` so feed-meta wraps it, and the reason is the rails rather than
the request.** Either ordering still fires the network call — this shim always calls through — but
it decides which response feed-meta gets to tap. Wrapped this way feed-meta dedupes, calls through
once, and taps whatever the shopper is actually looking at, so the chip counts describe the grid.
The other way round the shim sits outside the tap and feed-meta only ever sees the live response
while the grid may be showing the cached one: rails counting a catalogue that is not on screen.
Same ordering rule, same failure, as `ll-shelf`. **On a city page it stands down without a flag**,
exactly as feed-meta does — `cw-endpoint` repoints away from this pathname before the request
arrives.

`node test-feed-cache.mjs` drives it in real Chromium. **What makes it non-vacuous is the
control**: cache cleared, same slow feed, and the grid must show the engine's own seed. Without
that assertion the whole feature could be deleted with every other check still green — verified by
deleting it, and by collapsing the shelf keys, dropping the `?refresh` passthrough, and installing
the shim on the wrong side of feed-meta, each of which turns it red in its own section.

> **Two traps for whoever tests this next**, both of which cost a confusing first run:
> the engine carries a **baked Greek Glass seed** inside the blob (the generator blanks it for
> city pages; on the hemp page it is real inventory), so a fixture is never the whole shelf. And
> `index.html` opens the grid on **Ounce+ AND a $75 budget**, deliberately — so a fixture selling
> eighths, or an ounce at $200, is filtered out of every facet before a rail ever sees it, and the
> failures all point at the rails, which are working perfectly.

**"Shop by store" is NicotiaMarket's logo strip, ported class for class.** Same
`.logorow`/`.lrhead`/`.lrwrap`/`.lrscroll`/`.lchip`/`.limg` names, same circular white plate (a
shop's mark is drawn for light backgrounds and vanishes on ours), same per-store tinted monogram
fallback, same edge-fades-plus-arrows in place of a scrollbar, same gold selected state — `--gold`
is a shared family token, so it stays gold on a cold-blue page rather than drifting to the local
accent. What differs is what drives it: Nicotia owns its renderer and keeps multi-select state,
while here the renderer is inside the blob, so **the chips are a face for the engine's own
`#fStore` select** — built from its options, acting by setting its value. The counts are therefore
the engine's own counts and cannot drift, picking a shop either way lights the other, and it is
single-select because that is what the engine offers; faking multi-select would mean filtering
behind the engine's back and disagreeing with its own count. Each shop's mark comes from the
favicon service keyed on the domain the feed already carries, tapped out of the `/api/coldwater`
response by the fetch shim, so there is no logo table to commit or keep in step.

> **Escaping, twice, in one sitting.** This block is a JS string inside a template literal inside
> an HTML attribute. An inline `onerror="…add(\'mono\')"` lost a backslash and became a
> `SyntaxError` that took the page's other scripts with it; the handler is bound after render now,
> where it is just a function. And `/\s*\((\d+)\)/` written with single backslashes reached the
> page as `/s*((d+))/`, so every chip kept "(4)" glued to its name — and the strip still *looked*
> right, which is how it survived a first run. Double every backslash in these injected blocks, and
> assert on the generated file rather than on the generator.

**"Shop by category" sits opposite it, and the pair is one grid with the page's middle drawn
between them** (`cw-facet-pair`, `cw-catrow`, both in `tools/make-coldwater.mjs`). Which shop and
what kind of thing are the two questions a walk-in shopper asks, and as two stacked full-width
rails the second was under the fold on a laptop — so `.lrpair` is `1fr 1px 1fr` and the divider is
its own **grid track**, not a border on either rail, which is what puts it on the shell's exact
midpoint however wide each side's chips run. It is brighter than this page's other hairlines on
purpose (the accent at 0.42 with a gold dot on the midpoint): at `--glass-line`'s own 0.22 the rule
was there and invisible, which makes it furniture rather than a divider. Below 900px the pair
stacks and the divider **turns** rather than being deleted — two rails of circles with no rule
between them read as one long row of unrelated buttons. `min-width:0` on the columns is load
bearing: a grid child sizes to min-content, so a rail of 104px chips would widen the page instead
of scrolling itself, which is the 390px overflow assertion.

Same contract as the store strip — the chips are a face for the engine's own `#fCategory` — and
three things about it are easy to get wrong:

- **The engine renames categories, and keying the strip on the feed's words matched nothing while
  erroring nowhere.** `/api/coldwater` normalises to `Flower` / `Vaporizers` / `Pre-Rolls`
  (§ `normCategory` there); the engine then runs its *own* `normCategory` over everything it
  renders and files those same rows under **`THCA Flower`**, **`Concentrate`** (a cart is a
  sub-tag) and **`Pre-rolls`** — and that is what reaches `#fCategory`, so that is what a chip's
  value must be. A picture map built from the feed's vocabulary missed every lookup and left a
  strip of glyphs on a feed with 96% image coverage. So the pictures are read off the engine's own
  **`#grid .card[data-cat]`**, where the classification and the photograph sit in the same element
  and cannot disagree. Sticky per category, because the grid re-renders on every keystroke and a
  picture re-read each time would flicker.
- **A category has no logo to fetch.** A shop's mark comes from its domain and a brand's from its
  own product shot; a category has neither, so the picture is one real product off that shelf, with
  an **emoji glyph** on the tinted plate underneath it — the engine's own `CAT_ICON` language, so a
  dropped photo uncovers a glyph rather than an empty disc. Glyphs are written as `\uXXXX`
  **escapes, never characters**: the generator asserts this page's non-ASCII inventory matches
  `index.html` byte for byte (§5a), so one literal emoji fails the build. The rail's note says the
  pictures are products rather than picks, where the pictures are, not only in the footer.
- **Order is a fixed shelf order, not the count.** The number on a chip is the engine's own facet
  count (that is what keeps it honest) and it *moves* as other filters move — sorting on it would
  make the chips jump sideways every time somebody picked a shop. `ORDER` in `cw-catrow` is
  flower-first, the way a menu board reads, and a word it has never seen sorts after it
  alphabetically rather than being hidden.

**One arrow handler now serves every rail, in `cw-carousel` where the rest of the carousel
behaviour already lives.** It used to sit in the store strip, which worked and was invisible from
anywhere else: the brand rail's arrows scrolled only because that handler happens to read `data-lr`
generically, and the next rail could either inherit the same accident or bind its own copy and
scroll **twice per click**. Both failure modes are invisible in markup, so `test-coldwater-page.mjs`
drives the button and asserts the rail moved exactly one step.

**The concierge is off on `/coldwater`, and that is scoping rather than deletion.**
`api/concierge.js` reads `/api/products`, the national mail-order hemp feed, so on the dispensary
page it would answer a shopper standing on Willowbrook Road by recommending flower shipped to
their door — two markets that are close cousins to us and completely separate to a customer. A bot
*asserts* things in prose, so this is worse than a wrong card. The generator applies two
independent stops (a CSS hide and a fetch-shim refusal) and asserts both. It comes back when it
reads `/api/coldwater` and is locked to the town it is on, free to offer another Michigan town
only if the shopper agrees first.

### Greek Glass was the last page still painted green

**"greekglass is still green, restyle it."** It was the only page left on `#0b120d`, and it had
survived every earlier sweep for one reason: **it agrees with itself.** Its `:root` and its
`theme-color` both said the old green-black, so the site-wide check added with the library work —
which asks whether a page tells the browser the ground it actually has — passed it every time.
That is the right question for that check and the wrong one for this page.

**It is hand-authored and fed by Big Cartel, not `/api/products` (§7), so nothing about it is
shared.** ~60 colour literals of its own, and they are not all chrome:

- **The cards have a WHITE face** (`.gname` is `#151515`), so the greens were tuned for contrast on
  paper. `#0b8a37` is the price. Swapping it for `--leaf` would have been unreadable; it goes to
  **`--leaf3` (`#1787c4`)**, the darkest of the blue family. A hue swap here has to preserve
  lightness, not just hue.
- **`#39ff6a` is not chrome.** It is a stop in the rainbow the nav icons and the glass swatches are
  drawn in — Greek Glass's own product language. Kept.
- **`#128722` IS NOT A COLOUR.** It is `&#128722;`, the shopping-cart emoji entity on the cart
  button. A hex sweep catches it and silently swaps the glyph. The recolour script protected it by
  name and asserted the count afterwards.

`test-library-style.mjs` asks the question **by hue rather than by a list of known literals**: any
hex where green clearly dominates fails. A list only ever catches what somebody already thought of,
and this page has sixty.

> **The guard was vacuous once, and that is the part worth remembering.** Excluding the entity
> started as `(?![0-9a-fA-F;])` — a trailing semicolon as a second defence. **Every CSS colour is
> followed by a semicolon**, so it excluded nearly the whole file, and the guard passed against a
> page with `#0b8a37` put back into it. The honest exclusion is `(?<!&)`, which says the real thing:
> a numeric character reference is not a colour. Verified by injecting that exact green and watching
> it go red, because a guard that passes vacuously is worse than none.

### The library wears this site's colours now, and its objects — `public/css/plate.css`

**Reported 19 Aug 2026: "the reels and library need to match the rest of the site in their own
way ... it currently has the Nicotia market styling, and I don't want any part of that. I want it
to be stompbox.world versus Legal-Leaf Market and look really cool and have lots of blues."** Two
separate faults, and the first one had been live and invisible for as long as the blue has.

**`public/css/tokens.css` says in its own header that its palette is "lifted verbatim out of this
site's own `:root` in `public/index.html`, so the library pages and the market pages cannot
drift apart". It had drifted.** The market pages were recoloured from leaf green to cold blue and
this file was not, so all twelve library-family pages went on painting themselves `--leaf:#4ade80`
on `--bg:#0b120d`. Nothing errored and nothing could: a stylesheet that claims to be a copy of
another file and is not is the same failure as `capKey` against `captureKeyer`, `rscRoots`
against its collector twin, and `storeCheckoutUrl` four times over. Only somebody looking at both
can tell, and nobody was. `test-library-style.mjs` reads both `:root` blocks and compares the
sixteen shared tokens, so the next recolour is a red run rather than a page that quietly looks like
somebody else's site. **Two green literals could never have been caught that way** and are pinned
by name: `#04140a` and `#08130c`, the ink on `.st-cta` and `.rl-follow`, because ink sitting
on an accent-coloured fill is written as a literal by design.

**The second fault is that the pages were Nicotia's, structurally, and the owner was right.**
`library.css`'s header says it was "ported from nicotiamarket.com's app.css story block so the
three sister libraries are the same object in three colours". The port is now cut where it was
doing harm and kept where it was doing work, along one line:

> **`library.css` sets the WORDS. `plate.css` sets the OBJECTS the words sit on.**

A reading column is a reading column at all three sites, so the measure, the chapter rhythm, the
pull quote and the ladder stay portable and a fix to them still travels for free. What a *card*
looks like is not portable and is Legal-Leaf's alone.

**The object language is borrowed from stompbox.world**, the family's fourth site and the only one
of the four with a physical vocabulary worth taking. Its five rules, and what each becomes here:
the edge is chrome and chrome is an **edge, never a fill** (one hairline, plus one silkscreen
hairline printed inside it at `inset:3px`); **metal is brighter than the ground**, which is the
one structural insight and the reason these pages stop reading as flat; **one bright thing,
reserved for what is lit** — stompbox has an LED, this site inherits gold, and it is one pilot dot
per card; **travel is small**, 2px on press with the deck collapsing under it, which also means
**hover must not move anything** (library.css lifts a card `-2px` and that is overridden, because
a card that has already risen has nowhere to go when it is pressed); and **nothing glows on idle**.

**What is deliberately NOT borrowed is the skeuomorphism.** Stompbox draws literal die-cast boxes
with knurled knobs and footswitches because that site is about die-cast boxes. This one is about
sentences and a number, so the vocabulary comes down to the plate — a machined surface with a
printed edge — and the knobs stay where they mean something. **A PLATE IS A CONTROL**: everything
that lifts can be pressed, and a chapter box does not lift because there is nothing to press it
for. It gets the hairline and nothing else. That one rule is what stops the page becoming a pile
of buttons.

**Four things in here fail silently, and each is pinned where it bites:**

- **It wins by ORDER, not by weight.** Every selector is written at the same specificity as the
  rule it replaces, so neither file needs `!important`. Move the `<link>` above `library.css`
  and nothing errors — the pages just go back to looking like the thing that was reported. The
  suite reads the order off all twelve pages rather than from a list, so a thirteenth is checked
  the day it joins.
- **The edge is set side by side, never as the `border` shorthand.** `.tc-leaf`, `.tc-ember`,
  `.tc-terra` and `.lib-next` each own a **3px coloured left border** declared in the earlier
  file; one `border:1px solid` at equal specificity deletes all four without a word — three
  identical chips claiming to be three different sites. **The pseudo-element is exempt**, and that
  exemption is the point rather than a loophole: `.trio-card::after` *is* the silkscreen and has
  no sister colour to delete. The first draft of the guard flagged it, which would have sent
  whoever read the failure to weaken the guard rather than to look.
- **The headline gradient must be set as `background-image`.** `library.css` sets
  `-webkit-background-clip:text` *after* its own `background:` on `.st-hero h1`, and the
  shorthand resets `background-clip` to `border-box` — so overriding with `background:` paints
  a gradient rectangle behind transparent letters. An invisible headline, and no error.
- **An inline `<style>` out-orders a linked stylesheet.** `reels.html` used to declare its own
  card background, border and shadow in the head, which would have beaten `plate.css` at equal
  specificity while looking like nothing at all. That block now says what a reels card *is* — a
  window with an embed in it — and plate.css says what it looks like. The silkscreen is a
  **printed window** there rather than a hairline, because a 1px line ruled across a white
  Instagram embed reads as a rendering fault.

**The index is a shelf, and the reading measure is untouched.** 64ch is right for prose and wrong
for a list of six things: at a laptop width it was a column of cards in a field of nothing. So
`.st-body`, `.st-standfirst` and `.st-sources` keep their measure and `.lib-list` goes
two-up at 1180px with the lead piece spanning both columns. **The orphan is arithmetic, not a
count**: the lead spans, so the remaining `n-1` tile two-up and the last row holds one card
whenever `n` is even — which is exactly what `:last-child:nth-child(even)` says. Written that
way because the count changes every time somebody writes a piece. `.trio` is widened through
`.lib-list ~ .trio` and never on its own, because the same block sits at the foot of every
**story** page under a 64ch column, and a family footer wider than the article above it reads as a
broken container; the sibling combinator is the whole test, since an index page has a
`.lib-list` and a story page does not.

> **The /library trap, for the fourth time.** The first draft asserted "plate.css uses no
> `!important`" against the whole file, and went red against plate.css's own header, which argues
> the point in the sentence *"neither needs `!important`"*. Same shape as the generator's block
> assertions and the shelf-defaults comment naming `#toggleFilters` by name. **Strip the comments,
> then ask** — and assert a block was found at all, or an empty window passes vacuously.

**Verified by booting the pages, not by reading them** (§5a): real Chromium at 1280px and at 390px,
plus `/the-seam`, `/wholesale` and `/coldwater-guide` to confirm the ten story pages that share
this stylesheet did not regress — prose measure unchanged at 570px, no horizontal overflow at
either width, no console errors. Google Fonts and `bigcartel.com` blocked at the network layer for
the reasons every browser check here blocks them.

### CI runs every suite, in three shards, and the shape of it is a billing decision

`.github/workflows/tests.yml` runs every suite on every push and pull request. Before it, the
repo had 34 suites and one workflow, and that workflow harvested menus — so `main` could be red
and stay red. `test-coldwater-variants.mjs` did exactly that for at least eight commits and was
found by somebody running it by hand. **A suite nobody runs is documentation with a `.mjs`
extension.**

- **Two jobs, split by cost rather than by subject.** The node suites boot nothing and run as
  one job; the browser suites drive real Chromium and run as **three shards**. So a broken
  parser is still reported in under a minute instead of behind a browser queue, and a flaky
  page still cannot mark the arithmetic red. `fail-fast` is **off** at both levels — the
  strategy flag across shards, and the runner loop *within* a shard, which must run every suite
  after one fails and name them all at the end.
- **THE SHARDING IS BILLING, NOT TASTE, and the bill is what took CI down for three days.**
  Actions charges per **job**, rounded up to the minute, so 29 browser jobs cost 29 minutes
  before a single assertion runs. Measured on this repo the browser suites total **7m33s** of
  real work while a job's fixed cost — provision, checkout, setup-node, locate Chromium — is
  **~40s**: 29 of those is ~19 minutes of setup to run seven and a half minutes of tests. This
  repo is **private**, so every one of those minutes is metered, and around 21 Aug 2026 the
  account's included minutes ran out. **Every workflow then failed in 3–5 seconds with no
  logs.** That reads exactly like a GitHub outage — it was diagnosed as one for three days —
  and the tell that it is not is that `started_at == created_at`: a runner *is* assigned, the
  job just cannot begin. Three shards balanced by measured time take it from ~36 billed minutes
  to ~14, at the cost of the wall clock going from ~2 minutes to ~3.
- **Shards are balanced on measured seconds, not on suite count.** Longest-processing-time over
  the real durations. Sorting by count would put `test-coldwater-collect` (53s) beside
  `test-lookah` (2s) and leave one shard running twice as long for the same money. The numbers
  are in the workflow beside each shard; re-measure if a suite's cost moves.
- **One suite per runner was hiding a real bug, and batching made it fatal.** Thirteen browser
  suites hardcoded ports that eight other suites also claimed. Free while each had a machine to
  itself; on a shared runner the second suite to want CDP 9341 either fails to listen or —
  worse — attaches to the previous suite's dying browser and **passes**. They are renumbered,
  and `test-ci-ports.mjs` holds them apart. It also found **three browser suites that were in
  no CI list at all** (`test-checkout-links`, `test-strain-drop-flip`, `test-strain-facet`), so
  it identifies a browser suite by what it *does* — imports `chrome-path.mjs` **and** calls
  `launchChrome()` — rather than by a second hand-kept list. Testing for the string alone
  flagged the guard's own comment, which is this repo's oldest trap.
- **The suite list is explicit, and an unlisted suite is warned about** rather than failing the
  build — a hard failure there would punish the commit that *adds* a test. That warning is why
  those three orphans survived: nobody reads a warning.
- **No install step, because there is nothing to install.** `dependencies` is empty (§1, §11),
  so CI is checkout → point at a browser → run node.
- **`LL_NO_STORE_FETCH` — no suite calls a real shop, and this is a promise rather than a
  preference.** Several suites boot the real `server.mjs` and touch `/api/products` or
  `/api/coldwater?refresh`. In the containers this repo is written in, the egress proxy refuses
  every merchant host instantly, so those calls fall through and **nobody notices what they are
  asking for**. A CI runner has ordinary network access — so the same lines read sixteen hemp
  storefronts and a real dispensary's menu, on every push, on every branch. That is the exact
  opposite of §7's courtesies (one request per store per refresh, cached, spaced, contact UA).
  Both feeds honour the flag at their **single `get()` chokepoint**, and **throw** rather than
  returning a not-ok response — every caller builds its own message from the status, so a returned
  refusal came out as `http 0 ::`, which names neither the cause nor the switch and reads like a
  shop that timed out. **Read per call, not at module load:** a suite setting `process.env` at the
  top of its own file sets it *after* its imports have run, so a load-time constant is silently
  inert exactly where it was most explicitly asked for. Two suites (`test-cbdhempdirect.mjs`,
  `test-coldwater-variants.mjs`) `delete` it beside their own `fetch` stub — they substitute a
  *stronger* guarantee, and the flag would only stop the scraper being tested.
  **Its second symptom pointed at the wrong file**, which is why it is written up here:
  `test-concierge-browser.mjs` waits 2.5s for the feed to fail and asserts the widget says so. With
  no egress that failure is instant; with egress the scrape is still running at 2.5s, so two
  assertions about the error state failed — against a concierge that was working correctly.
- **Node 22 is a floor for the browser suites, not a preference.** Every CDP suite talks to the
  browser over `new globalThis.WebSocket`, which is a **global only from Node 22**. Pinned at 20
  (copied from the harvest workflow) all thirteen died with `globalThis.WebSocket is not a
  constructor` about eight seconds in — *after* Chrome had started perfectly. Thirteen identical
  failures that each read as a browser problem and were a runtime problem. `tests.yml` now
  asserts the global exists in one line before spending fifteen minutes finding out. The same
  pin was in `harvest-coldwater.yml`, where it was latent: that job has never reached the browser
  because `LL_ADMIN_TOKEN` is unset, so the version would have bitten on the first run that did.
- **`tools/chrome-path.mjs` is the one place that answers "where is Chromium".** Nine suites had
  hardcoded `/opt/pw-browsers/chromium-1194/...` — a **pinned build number** that exists only in
  the dev container, so those suites could never run on a runner, and the day 1194 becomes 1195
  half of them break while the four that had grown their own candidate list keep passing. That
  reads as "half the suites broke", not "the browser moved", and a suite that cannot start a
  browser fails in a way that looks like the *page* being at fault (§ the Google Fonts note
  above, same trap). It reads the directory instead of guessing a version, prefers `CHROME_PATH`
  (which CI sets) and falls through to the distro's binary. `tools/harvest-coldwater.mjs` uses
  it too, which is why it lives in `tools/` and not beside the suites.

Everything else is still manual:

1. `node --check api/products.js` (and any edited `api/*.js`) for syntax.
2. Run `npm run dev` (starts `server.mjs`), **restart it after any `api/` edit** (§4).
3. Load `/`, `/consumables`, `/devices`, `/international`, `/greekglass` — confirm 200 + real
   content (not a page that merely contains the text "404").
4. Hit `/api/products?debug` — confirm per-store counts look sane and `coa` fields populate.
5. If you touched anything user-facing, open it in a browser at desktop AND mobile widths.

## 11. Hard "do not" list

- Do NOT hand-edit the base64 engine line in `index.html` (§5).
- Do NOT remove admin mode or change its `adminmode` / PIN `5824` trigger without being asked (§6).
- Do NOT add a build step / framework — this is static + serverless by design (§2).
- Do NOT rename a page without updating `vercel.json` routing AND nav links together (§3).
- Do NOT commit `node_modules`, `.env*`, `.vercel`, `*.log`, or backup `*.zip` (see `.gitignore`).
- Do NOT hardcode product data into the pages — always source it from `/api/products`.
- Do NOT push directly to the production branch; open a PR and let it deploy after review.

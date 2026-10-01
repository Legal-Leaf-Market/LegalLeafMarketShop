# Automating the Coldwater collector

How the shop re-pull works, what is safe to change, and which failures are
somebody else's decision rather than our bug.

Everything below is filed into four buckets, because mixing them up is how an
evening disappears chasing the wrong layer:

| Bucket | Meaning | When it breaks |
|---|---|---|
| **STANDARD** | Web platform behaviour. True on any site, in any browser, forever. | Nothing to fix. Work with it. |
| **VENDOR** | A menu platform's decision — Dutchie, Jane, Lume, Tymber, Woo, Shopify. | Changes when *they* redesign. |
| **SOFTWARE** | Legal-Leaf's own contract — the collector, the batch, `/api/coldwater/ingest`. | Ours to change. One file each. |
| **SHOP** | One specific store's quirk. | Config, never code. |

---

## 1 · The two lanes, and the one rule that keeps them honest

There is **one extractor** and two ways to drive it.

**Manual lane.** The operator opens a menu, clicks the *Grab menu* bookmarklet,
which injects `https://legal-leafmarket.com/coldwater-collector.js`. The
collector harvests, draws a panel, and the operator sets the store key,
collection and admin token and presses **Send**. *(SOFTWARE)*

**Scheduled lane.** `tools/harvest-coldwater.mjs` opens the same menu in a real
Chromium, injects the same file, and calls the handle the collector already
exposes for exactly this purpose:

```js
window.__LL_COLLECT__ = {
  version: 1,
  market: "coldwater" | "llm",
  harvest(),                              // one pass over what is mounted
  reset(),                                // drop the accumulated batch
  autoScan(onProgress, done),             // scroll-and-settle, merging as it goes
  autoPage(onProgress, done, opts),       // …across every page of a pager  ← new
  batchList(),                            // everything captured so far
  diag(),                                 // why it went the way it did
}
```

That handle **exposes no network call**, deliberately. The browser side never
sends. The harvester does the POST from Node with the token from
`process.env`, so **the token never enters a shop's page context**. *(SOFTWARE)*

> **The rule: the harvester owns no extraction logic.** Every rule about what a
> product is — and now what a *complete capture* is — lives in
> `public/coldwater-collector.js`. When the two lanes disagree, the fix goes in
> the collector. This is why `autoPage()` was added there and not to the
> harvester: if the scheduled lane owned the pager, the manual lane would keep
> clicking Next forever and the two would drift apart on the one question that
> decides whether a shop is published whole.

---

## 2 · The contract

*(All SOFTWARE. This part is owned outright.)*

```
POST {origin}/api/coldwater/ingest
     content-type: application/json
     x-ll-admin-token: <LL_ADMIN_TOKEN>

{
  storeKey:   "sapura",
  collection: "northeast-alternatives-coldwater",
  market:     "coldwater" | "llm",
  lane:       "manual" | "headless" | …        // defaults to manual — see below
  products:   [ Row, … ],
  source:     "harvester/dutchie.com via React props",
  href:       "https://dutchie.com/embedded-menu/…"
}
```

```js
Row = {
  name, brand, description, category, type,   // strings; description ≤1200, HTML stripped
  thc, cbd,                                   // number | NaN
  image, url, coa,                            // absolute URLs
  deal,                                       // ≤120 chars
  batch, packagedDate,
  inStock,                                    // boolean
  sizes: [{ label, price, grams, sale?, inStock? }]   // ≤12, deduped, sorted by weight
}
```

Reset a store instead of capturing it:

```json
{ "storeKey": "banzen", "market": "coldwater", "reset": true }
```

**Four rules that bite.**

1. **A capture replaces the collection it names, and cannot remove one it does
   not.** Capturing Banzen under `menu` when the shelf holds `topicals` does not
   rename anything — it adds a second collection and the store holds *both*
   copies. Clear first, then capture under the new name.
2. **`market` defaults to `coldwater` server-side.** Right for a capture,
   catastrophic for a `reset`, which is why the Clear button always sends it
   explicitly.
3. **`lane` defaults to `manual`.** A robot that omits it posts on top of the
   operator's own observations — the exact inversion the lane ladder exists to
   prevent (CLAUDE.md § *Lanes, precedence, and freshness*). The harvester sends
   `lane:"headless"`.
4. **Origin follows the script.** The collector posts to whatever origin served
   it (`document.currentScript.src`), so a Vercel **preview** deployment's
   collector writes to that preview's API. Pasted source has no
   `currentScript`, which is why the install page prepends
   `window.__LL_COLLECTOR_SRC__`.

---

## 3 · How the extractor reads a menu

Four layers, tried in order; `diag().via` reports which answered. *(SOFTWARE,
but every layer exists because of a STANDARD.)*

1. **Page state** — `__NEXT_DATA__`, RSC chunks (`__next_f`),
   `application/json` script tags, and any `window.__FOO` holding an array of
   objects with a name and a price. No selectors, so a redesign does not break it.
2. **React props** — walks `__reactProps$` / `__reactFiber$`, then climbs the
   fiber `return` chain reading `memoizedProps` and the `memoizedState` hook
   list. This is what React devtools does. Needed because the menu array usually
   lives *above* the host nodes: element props hold one screenful, the hook holds
   the whole menu.
3. **Rendered page** — find the smallest elements carrying a price, climb to the
   element that also carries a non-price line, group by CSS shape, keep the
   biggest group. Carries no strain, category or THC.
4. **Printed text** — `document.body.innerText`, line by line. The honest last
   resort for a closed shadow root, thin by nature, and **it should not be
   published unattended** — it cannot tell a product from a sort-dropdown
   option. See §7.2.

Layers 1 and 2 are **unioned**, not raced. Layers 3 and 4 run only when
everything above found nothing.

Then, if the shop has a real product feed, it **replaces** the guess entirely:
`/products.json` (Shopify) or `/wp-json/wc/store/v1/products` (Woo). Replaced
rather than merged, because a menu link and a product look identical in markup.

---

## 4 · STANDARD — the web platform, not anybody's bug

These five cause most of the confusion, and each needs an opposite response.

**Same-origin policy / cross-origin iframes.** A script on `sapuralife.com`
cannot read inside an embedded `dutchie.com` frame. Not a bug, and not something
to work around.
*Manual fix:* right-click → **This Frame → Open Frame in New Tab**.
*Automated fix:* read the frame's `src` from the parent — the **URL** is not the
**content**, so this is allowed — and navigate to it.

**Shadow DOM.** `document.querySelectorAll` does not cross a shadow boundary.
*Open* roots are traversable and the collector's `deepAll()` walks them. A
*closed* root is the page deliberately saying no; the collector does not argue,
and falls back to reading the painted text. **There is no iframe in this case** —
hunting for one finds nothing and wastes an evening. (It has.)

**Content-Security-Policy.** `script-src` and `connect-src` are separate
permissions, and a site may grant one and refuse the other.
- `script-src` refused → the injected `<script>` never runs and fires no error.
  That silence is why the bookmarklet checks `window.__LL_COLLECTOR__` after
  2.5 s. Workaround is the console method: pasted source has nothing left to fetch.
- `connect-src` refused → the collector reads the menu perfectly and then cannot
  POST it. **The Dude Abides does exactly this.** The manual workaround is the
  relay tab (`window.open` is a *navigation*, not a *connection*, so CSP does not
  govern it; the relay then posts same-origin). **The scheduled lane needs none
  of this** — Node is not governed by a page's CSP. One of the few places
  automation is genuinely *simpler* than the bookmarklet rather than just faster.

**Virtualised and lazy lists.** A virtualised list only mounts what is on
screen; the rest does not exist in the DOM to be read. `autoScan` is the answer,
and it is the same act a person performs with a wheel.

**Storage scoping.** `sessionStorage` is per tab; `localStorage` is per origin.
The batch lives in `localStorage` because opening a product in a new tab lost it.
Expiry is therefore explicit: **18 hours**, stamped on each write.

---

## 5 · VENDOR — what each platform does

| Platform | Where the menu is | Move required | Shops |
|---|---|---|---|
| **Dutchie** | React component state; embedded cross-origin | open the frame URL; **paginate** | Sapura, Exclusive |
| **Jane** | Open shadow roots, virtualised list | `deepAll` + scroll | Green Tree |
| **Lume** | Next.js page state + React props | scroll; **pin the store** | Lume |
| **Tymber / dispensary.shop** | Remix/Next, no parseable server JSON | rendered page; CSP blocks the POST | The Dude Abides |
| **WooCommerce** | `wp-json/wc/store/v1/products` (+ `?type=variation`) | two sweeps, minor units | (hemp side) |
| **Shopify** | `/products.json?limit=250&page=N` | paginate to empty | (hemp side) |

### Dutchie paginates, and this is the big one

Its menu is numbered pages of ~100. `autoScan` scrolls; it does not page.
Measured on Sapura, 2026-08-17:

| Approach | Result | Time |
|---|---|---|
| `autoScan` alone | **98 rows** (page 1, then dry-stopped) | 21 s; a second call ran 5 min without returning |
| Click *Next* + rescan | works, slower, timing-dependent | ~25 s/page |
| **Navigate `?page=N`, re-inject** | **692 rows** | **~70 s total** |

`?page=N` is honoured and the pager reports `aria-current="true"` on the right
number, so it can be **verified rather than assumed**. Every navigation
re-injects the collector, whose first act is to harvest and merge — so the batch
accumulates across pages exactly as it does for an operator clicking through
them. **Nothing new had to be invented.**

**The operator gets this as a button.** The panel had *Scan while scrolling* and
nothing for a pager, so the seven Next clicks were done by hand — which is why a
full re-pull took an evening. **Scan every page** sits beside it now and drives
`autoPage()`, reporting the page it is on and the running row count, and logging
`pagedStop` / `pagesVisited` to the console when it finishes. `"no next control"`
on page one means the pager was not recognised, which is worth knowing: it is the
difference between a whole shop and a seventh of one.

Both moves are now available, and they are not interchangeable:

- **`autoPage()` (in the collector)** clicks the pager in place. It works for
  both lanes, needs no knowledge of the URL scheme, and is what the operator
  gets for free. This is the general answer.
- **Navigating `?page=N` from Node** is faster and more reliable where the pager
  puts its state in the URL, but it destroys and recreates the page context, so
  only something *outside* the page can drive it. Use it when a shop is measured
  to support it; `autoPage` otherwise.

### Four navigation shapes, and they nest exactly one way

*(STANDARD in principle, VENDOR in which one a shop picks.)* These look alike
from a row count and need opposite handling. Getting the nesting wrong means
re-scanning the first tab once per page.

```
tabs  ->  pages  ->  scroll  ->  load-more
```

| Shape | What it does to the rows | Owned by | Recognised by |
|---|---|---|---|
| **Load more / See more** | **appends** to what is on screen | `autoScan` | accessible name, `load/show/see/view` + `more` |
| **Scroll / virtualised** | mounts as you go | `autoScan` | scroll height vs client height |
| **Next / numbered pager** | **replaces** what is on screen | `autoPage` | accessible name says next |
| **Category tabs** | switches which catalogue is shown | `autoTabs` | `role="tab"` / `aria-selected` (ARIA, not markup guessing) |

`__LL_COLLECT__.autoAll()` runs the whole tree and is what both lanes call. It
degrades cleanly: no tabs falls through to the pager, no pager falls through to
the scroller, so **one entry point is correct on every shop**. The panel button
is **Scan everything**.

Two rules that are easy to get wrong:

- **A load-more control is not a pager.** Stopping at the button means stopping
  in the middle of one page — `autoScan` used to give up the moment scrolling
  went dry, which on these menus is the button, not the bottom. It now presses
  it and keeps scrolling, capped at 40 presses (beyond that it is a pager
  wearing a button, and `autoPage` should drive it). The wait after a press is
  longer than a scroll tick, because what it triggers is a fetch, not a paint.
- **A category link that navigates is not a tab.** Following one destroys the
  script's execution context mid-scan; the batch survives in `localStorage` but
  the loop does not, so it looks like a hang. `tabControls()` therefore skips
  any anchor whose href leaves the current path. Capture that section as its own
  collection instead.

> **One batch, many tabs — so mind the collection name.** Everything `autoTabs`
> captures lands in the single collection named in the panel. That is usually
> what you want, but a capture replaces only the collection it names: if the
> shelf already holds a store split as `flower`, `edibles`, `vapes`, a combined
> capture under `menu` **adds a fourth copy** beside them. Clear the store first
> when consolidating.

### Remix: the reader that existed on the server and not in the browser

*(SOFTWARE — the drift the two-copies rule is meant to make visible.)*

`rscRoots()` and `balancedEnd()` exist twice on purpose, in `api/coldwater.js`
and in `public/coldwater-collector.js`, because a static file served onto a
dispensary's origin cannot import from `api/`. **`remixRoots()` was written on
the server and never ported**, so The Dude Abides read richly on the scheduled
lane and as **five rows** on the operator's, and nothing anywhere reported a
disagreement.

Remix ships loader data two ways and nothing that scans for a *container* sees
either: an assignment to a global (`window.__remixContext = {…}`), and **function
calls with JSON arguments** (`__remixContext.r("route", "key", […])`). No
`__NEXT_DATA__`, no JSON script tag, no RSC chunk — so the generic reader
reported "no parseable JSON" against a page that server-renders its whole menu.

Three traps, all now pinned by `node test-collector-remix.mjs`:

1. **The JSON is not the first argument.** It sits after one or more strings, and
   those strings are hostile by accident: a route pattern contains a bracket
   (`/:store?/:medrec/menu[x]`), so a scan that jumps to the first `[` takes the
   wrong one, and a deferred key can carry an escaped quote.
2. **Products are nine levels deep** (`root > state > loaderData > routeId >
   deferredKey > [carousel] > products > product`). The collector's walk stopped
   at depth 8, so the menu was cut off by the guard rather than missed by the
   parser. Now 14.
3. **A price tier is not a product, and satisfies every test that says one is.**
   `{name:"Ounce (28g)", weight:28, price:5000}` has a name and a price and there
   are more of them than any single carousel holds, so length-alone picked it —
   *five rows keyed `name,weight,price`*, which is worse than an error because it
   looks like a working scrape of a five-product dispensary. Arrays are now
   scored on **catalogue richness** (brand, category, image, product name…) with
   length breaking ties.

And one shape the largest-array rule was never written for: the page ships **~14
carousels of twelve**, so the largest single array is 12 while the page carries
~167. The rows are unioned, keyed on name + variant + price. The union takes
**catalogue arrays only** (score > 0.5) — without that threshold the tier table
loses the `best` contest and then walks into the union, which is bigger than
`best` and replaces it. Same five rows, one layer along.

### Deals: one missing shape, and the whole chain starved

*(SOFTWARE. Analysis and shop-by-shop evidence in `DEALS-ANALYSIS.md`.)*

`sizes[].sale` was **null on all 5057 rows of every shop**, and the reason is worth
stating precisely, because it looked like a missing feature and was a missing
*shape*. Everything downstream already existed and worked:

```
collector sizes[].sale  ->  ingest sanitiser keeps it  ->  row() slot 7
   ->  toProduct() reads slot 7 as a real unit price
   ->  dealPerG, dealBasis "sale price", dealMinQty 1
   ->  perG takes it when cheaper;  shelfPerG keeps the label price
```

Every link was in place. The collector simply never read a **parallel sale
array** — which is exactly how Dutchie ships a discount — so slot 7 was always
null and the site ranked discounted products at their list price. Sapura renders
`$7.00` struck through beside `$4.90`; we stored `$7.00`. **No server change was
needed at all.**

Four capture fixes, in the order they were found:

1. **`parallelSalePrices()`** — `Options ["1g","1oz"]`, `recPrices [12,210]`,
   `recSpecialPrices [11.4,199.5]`. Same-length only, and **strictly lower**:
   menus leave the array populated after a promo ends, and "was $12, now $12"
   reads as a bug to a shopper and as something worse to a regulator. A ragged
   pair is refused outright rather than zipped — an off-by-one does not merely
   misprice, it prints a **saving that does not exist**, which is the one number
   here nobody would think to check.
2. **`variantsOf` missed capital `Options`.** Dutchie capitalises it, so a listing
   priced purely per weight had no variants at all and fell through to the single
   "One Size" row that list exists to prevent.
3. **`looksLikeProduct` required the price to be *on* the variant.** Dutchie's
   variants are label **strings** with prices in a parallel array, so a product
   with no top-level price and no priced variant object was rejected outright —
   before any of the above could run. `normalise()` had understood that shape for
   a long time; nothing ever reached it.
4. **`V_SALE` omitted `"sale"`** — this codebase's own name for the field. The
   live capture path passes `z.sale` into `row()` by hand, so it worked; the
   shared `variantRows()` reader silently dropped it. A vocabulary list that omits
   the local vocabulary only shows up from the far end of the chain.

And two deal-name fixes:

- **Dutchie states its promotions outright**, in
  `specialData.saleSpecials[].specialName` and `.bogoSpecials[].specialName` —
  "5/$25 1g Play 510 Carts", "15% Off Bulk Flower (Over 2 Ounces)". Those are the
  shop's own words, written for a shopper, so they beat anything a regex could
  rebuild from a price grid, and they carry the **condition**. BOGO bucket first
  (a bundle changes what you have to buy); extras are counted as `+1`, not
  concatenated. `posDiscountNames` is the fallback.
- **A product name must never become a deal.** `dealFromText` matched "special" in
  *Special Sauce Rosin* — a strain — so Banzen published the product title as its
  own deal badge, which renders as the name printed twice and gets debugged in the
  wrong file. Now the name is passed in and excluded, and a deal must state a
  quantity, a percentage or an amount.

> **What is deliberately NOT done here.** Mechanics that are not properties of a
> product — store-wide flash sales, daily deals, customer-class discounts
> (veterans, senior, medical), gift-with-purchase — have no place on a row and
> must not be folded into `perG`. Lume runs more promotions than anyone and shows
> zero, because none of them attach to a product. That needs a **store-level
> sibling object**, not a bent row. See `DEALS-ANALYSIS.md` §5. The rule that
> matters: a veterans' rate is real and most shoppers cannot use it, so folding it
> into the ranking makes the site's central number one nobody can reach.

### Lume runs ~38 Michigan stores on one origin

`/shop/all` is whichever store the profile last selected. Capturing Monroe and
publishing it as Coldwater is the worst failure available here: plausible,
silent, and found by a shopper rather than by us. Two guards — `BATCH_KEY`
includes the path on `lume.com`, and the harvester refuses the shop unless the
page still says *Coldwater* (`SHOP_POLICY.lume.expectText`).

### Two Woo/Shopify traps worth carrying over

**WooCommerce quotes money in minor units** (`4999` = `$49.99`, per
`currency_minor_unit`). Reading it as dollars is the 100× error. And its
`weight` field is *shipping* weight — the variation's attribute label is the only
honest source of grams.

**Detection is by page, not by URL.** A Woo store serving Shopify-style
`/collections/` URLs (a migration leftover) sent the collector down the Shopify
branch, which got nothing and fell through to a page scan that read 23
pseudo-products out of a marketing page's nav. Ask the page what it is
(`window.Shopify`, a `wp-json` link, `wc_add_to_cart_params`), never the link shape.

---

## 6 · SHOP — the seven, specifically

| Key | Menu URL to run on | Collection on the shelf | Paging | Notes |
|---|---|---|---|---|
| `lume` | `lume.com/shop/all` after `/stores/coldwater-mi-dispensary` | `all` | scroll | **21+ age gate**; chain — pin the store |
| `sapura` | `dutchie.com/embedded-menu/northeast-alternatives-coldwater/products` | `northeast-alternatives-coldwater` | **pager**, 7 pages | the frame URL, not `sapuralife.com` |
| `dude` | `dudeabides-willow.dispensary.shop/menu` | `menu` | scroll | `connect-src` blocks the in-page POST |
| `herbology` | `shophcc.com/shop/coldwater` | `coldwater` | auto | |
| `greentree` | `greentreerelief.com/coldwater/menu/all` | `all` | scroll | Jane; shadow DOM; 29 on the shelf — virtualisation |
| `banzen` | `banzencoldwater.com/menu` | `topicals` ⚠ misnamed | auto | rows link to brand pages, not products |
| `exclusive` | resolve the Dutchie frame on `exclusivemi.com/shop/` | `menu` (after clearing) | auto | **shelf is wrong today — §7.1, §7.2** |

**Age gates and cookie banners are a judgement call, not a technical one.**
Lume's gate asks whether you are 21 *and* accepts their Privacy Policy and Terms
on the same click. A scheduled run clicking that is making a legal declaration on
somebody's behalf every night. The chosen answer here is to **prime the profile
once, by hand**, and let the stored cookie carry it — the operator makes the
declaration, once, knowingly. The harvester does not click gates.

---

## 7 · Bugs found in the 2026-08-17 re-pull, and what was done

**7.1 · `guessStore()` tested for an id that is not in the URL.** *(SOFTWARE, fixed)*

```js
if (/dutchie\.com/.test(h)) return /6226401db296a22c98dfb676/.test(p) ? "sapura" : "exclusive";
```

Sapura's Dutchie URL is `/embedded-menu/northeast-alternatives-coldwater/products`.
The retailer id is **not in it**, so the test could only ever fail and every
`dutchie.com` capture pre-filled **`exclusive`** — including Sapura's own. The
operator accepted the default, which is what defaults are for, and **693 of
Sapura's 698 rows published under Exclusive's name.**

Fixed by matching the path slug (`DUTCHIE_SLUGS`), with unknown slugs returning
`""` on purpose: an empty Store key box stops the operator, a plausible wrong one
does not.

**7.2 · The `notAListing` guard tested the wrong thing.** *(SOFTWARE, fixed)*

```js
if (found[i].url && found[i].url !== location.href) linked++;
```

The rendered-page and printed-text layers write `location.href` into *every* row,
so this only ever meant "did this row's url come from an earlier page than the
one we are on now". On a paginated shop `location.href` changes as you page, so
stale page-urls counted as product links. **697 rows of nav copy** (`Name Z - A`,
`SPECIAL OFFER`, `MARKET`) sailed through. Watched live: navigating Sapura page 1
→ page 3 moved `rowsWithLink` from 0 to 98 without a single row changing.

Fixed by counting **distinct** urls as a ratio of rows.

**7.3 · `autoScan` handled scroll but not pagination.** *(SOFTWARE, fixed)*

Not a bug — a gap, and the one thing standing between the current workflow and an
unattended one. `autoPage()` now sits beside `autoScan` in the collector and is
exposed on the handle, so **both lanes** agree on what a complete capture is. The
harvester feature-detects it.

**7.4 · Banzen's whole store is filed under `topicals`.** *(SHOP, not fixed — deliberately)*

1412 rows spanning every category, because `guessCollection()` read the path of
whatever page the run started on. Harmless while it is the only collection, and a
live grenade the next time someone captures the *real* topicals page: 1412 rows
would be replaced by 14. **Renaming it is not a code change** — a capture under a
new name adds a second collection rather than renaming the first. Press **Clear**
on `/coldwater-collect` for `banzen`, then re-capture.

---

## 8 · The guards — why a row count is not a result

*(SOFTWARE, `tools/harvest-guards.mjs`)*

Every capture failure this project has had was a capture that **succeeded and was
wrong**. None of them threw. A scheduled lane that only checks for exceptions
publishes all of them, on a timer, at night.

**Blocking** — nothing is published:

| Guard | Catches |
|---|---|
| `expectMin` | a menu that never finished mounting or paging |
| `refuseVia` | the printed-text layer running where a better one exists (§7.2) |
| `shopSays` | more rows than the shop's own feed declares — nav collected as products |
| cross-shop overlap >60% | one shop's menu under another shop's key (§7.1), generically |
| `expectText` | a chain serving the wrong town's store (Lume) |

**Warning only** — said out loud, published anyway:

| Guard | Why not blocking |
|---|---|
| low distinct-url ratio | normal for Dutchie (no per-row link) and Banzen (brand pages) |
| low weight coverage | a fact about the shop, not evidence the capture is wrong |
| collector's `notAListing` | already softened by the ratio fix; worth surfacing |

> A guard that cries wolf is worse than no guard: it teaches whoever is on call
> to pass `--force`, and `--force` disables every *other* guard at the same time.
> That is why the split above is argued case by case rather than set to a
> uniform strictness.

---

## 9 · Running it

```bash
# scheduled lane, all shops
node tools/harvest-coldwater.mjs --site https://legal-leafmarket.com \
     --token "$LL_ADMIN_TOKEN"

node tools/harvest-coldwater.mjs --site … --dry              # capture, report, post nothing
node tools/harvest-coldwater.mjs --site … --only sapura      # one shop
node tools/harvest-coldwater.mjs --site … --concurrency 1    # strict cross-shop guard
```

| Flag | Default | Notes |
|---|---|---|
| `--settle` | 45000 | ms cap on a single-page `autoScan` |
| `--paged-settle` | 300000 | ms cap when `autoPage` is available — a paged menu is N scans, not one |
| `--concurrency` | 2 | the cross-shop guard is best-effort above 1 |
| `--spacing` | 1500 | ms between store *starts*; courtesy, not tuning |
| `--force` | off | publish past a failed guard. Disables **all** of them |

`.github/workflows/harvest-coldwater.yml` runs it nightly on GitHub's hardware.
A Vercel cron cannot: a browser is ~300 MB and 10–20 s per store.

**Zero dependencies.** The harvester drives Chromium over raw CDP with
`spawn()`, the pattern this repo's suites already use. No Playwright import, no
`package.json` change — which is what keeps `dependencies` empty (CLAUDE.md §1,
§11). Do not "simplify" it by adding Playwright.

### Verify

```bash
node test-collector-autopage.mjs     # the pager (40 rows across 4 pages) + every guard
node test-harvest-coldwater.mjs      # the lane end to end, incl. walled ≠ empty ≠ error
node test-collector-batch.mjs        # batch identity and paging in the browser
node test-coldwater-collect.mjs      # the whole bookmarklet round trip
```

---

## 10 · When a shop comes back empty

Read `diag()` **before** changing anything. It already recorded which of these it was.

| `diag` says | Meaning | Do |
|---|---|---|
| `crossOriginIframes > 0` | STANDARD — the menu is in a frame | capture the frame's own URL |
| `pricesOnPage: 0` + `shadowRoots`/`opaqueHosts` | STANDARD — closed shadow root | find the menu's own URL; the text layer is all there is |
| `pricesOnPage: 0`, nothing else | the page had not finished loading | scroll first, then rerun |
| `domGroup < 3` | a product page or a cart, not a listing | open the full menu |
| `pricesOnPage` high, `domPriceNodes` low | markup the query is not reaching | send the diagnostics — this is a real gap |
| `notAListing: true` | nav and banner copy read as products | you are on a marketing page |
| `react: true`, `reactHits: 0` | the array is above the host nodes | the fiber walk handles it; check layer order |
| count stuck at a round number | **pagination**, not a cap | §5; check `pagesVisited` / `pagedStop` |
| count stuck at ~22 | virtualisation | `autoScan` |
| `batchSaveError` | storage refused the write | send before navigating |
| `rows` far below `pageSays` | the page declares more than you captured | **Scan everything**, or capture the remaining pages |
| `ambiguousUrls` > 0 | the shop links cards to brand/category pages, not products | nothing — the rows are being keyed by name, which is correct |
| `batchExpired` | the 18h TTL dropped a previous sitting | expected; `batchExpiredRows` says how many |

### Three diagnostics that are easy to misread

**`rowCoverage` describes the BATCH; `stateCoverage` describes one layer.** They used to
be the same field, and it reported the page-state rows — so on any page the DOM layer
answers, it read `{img:0,desc:0,cat:0,sizes:0,grams:0}` however good the capture was.
That is what "its row parser isn't matching this template" was actually looking at. The
tell was in the same blob: `withGrams: 76` against a 119-row batch. Both cannot be true.
A zero in `stateCoverage` now means only "page state contributed nothing", which is
normal and often correct.

**`pageSays` is the denominator, and without it a row count has no scale.** A category
holding 13 products and a category of 235 showing its first screen are the same number
on screen. Read from the platform's own `total_count`, the same principle as Woo's
`X-WP-Total` — declared keys only, never inferred. The scheduled lane **blocks** a
capture far below it, because a capture *replaces* the collection it names: 13 of 235
does not add a partial menu, it deletes the other 222.

**`ambiguousUrls` is a report, not a fault.** It counts urls carrying more than one
product name — brand pages, category pages — which are keyed by name instead. A non-zero
number on Banzen is the fix working, not a problem to chase.

`autoPage` adds two of its own: **`pagesVisited`** (how many pages it drove) and
**`pagedStop`** (`"two pages added nothing"`, `"no next control"`, `"page cap"`).
A shop reporting `pagesVisited: 1` and `"no next control"` either has no pager or
has one this rule does not recognise — and the second is worth a look, because
it is the difference between a whole shop and a seventh of one.

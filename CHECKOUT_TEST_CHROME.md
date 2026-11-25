# Checkout test run for Claude in Chrome

You are testing every path from "I like that" to the Shopify checkout on
**shop.legalleafmarket.shop**, in the owner's own Chrome. The owner is next to you.
Work in a **new tab**, write down what you see, and **stop at payment**. You are a
tester here, not a shopper: nothing gets bought unless the owner says so on that screen.

This file lives at `CHECKOUT_TEST_CHROME.md` in Legal-Leaf-Market/LegalLeafMarketShop.
It is not served by the site (Netlify publishes `public/` only).

---

## Rules (read before step 0)

1. **Never enter a card number, bank login, SSN or password.** The owner types those.
2. **Never press "Pay now" / "Complete order"** unless the owner says yes on that exact
   screen *and* the store is in test mode (section I.6). A real order books a real sale and a
   real dropship request to a supplier.
3. **Never change theme code or settings except step 0**, and only after the owner says go.
   Write down every value you change, before you change it, so it can be put back.
4. **Do not "fix" anything you find.** Record it with the URL, what you did, what you expected
   and what happened, plus a screenshot. Claude Code makes the fixes.
5. Empty the cart (section G.7) at the end of every section that fills it, so one test does not
   leak into the next.
6. If a page shows an age gate, answer it the way an adult shopper would (the owner is 21+).
7. Read the browser console on every page you test (errors only). A blocked third-party tracker
   is not a finding; anything mentioning `ll-shop`, `ll-cart`, `shop-dispensary`, `cart` or
   `CartLinesUpdateEvent` is.

---

## Step 0. Put the new storefront code live (owner says go first)

The storefront loads three files from this repo through jsDelivr, pinned to a commit. The new
look is commit **`5675e0c4aac61f5101defbc317620d22385b91a6`** (branch
`claude/magical-gauss-8iu1q5`). Pinning a commit that is not on `main` yet works on jsDelivr;
the owner should still merge the pull request so `main` matches what is live.

1. First check jsDelivr can serve it. Open each in a tab; each must show code, not an error:
   - `https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@5675e0c4aac61f5101defbc317620d22385b91a6/public/ll-shop.js`
   - `https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@5675e0c4aac61f5101defbc317620d22385b91a6/public/ll-cart.css`

   The first line of `ll-shop.js` is `/* public/ll-shop.js -- the homepage feed ...` and the
   file contains the words `Smoothing pass`. If either is missing, stop and report.
2. Shopify admin -> Online Store -> Themes -> the live theme -> **Customize**.
3. Change the commit in **three** Custom Liquid sections. In each, copy the current `src` /
   `href` into your notes first (that is the rollback), then replace only the commit hash
   after `LegalLeafMarketShop@`:
   - **Home page** template: the section holding `<div id="ll-feed"></div>` (`ll-shop.js`).
   - **Collection** template (default collection): the section holding
     `<div id="ll-slicer" ...>` (`ll-shop.js`). Leave its `data-*` attributes alone.
   - **Header** group: the section holding the `<link rel="stylesheet" ...ll-cart.css">`.
4. **Save**. Open the storefront in a fresh tab and hard-reload (Ctrl+Shift+R).
5. Confirm it took: on the homepage, run in the console
   `document.getElementById('ll-shop-css').textContent.includes('llShimmer')`. It must be `true`.

The dispensary page (`/pages/dispensary`) loads `https://legalleafmarket.shop/shop-dispensary.js`
from Netlify, which is paused, so its polish will not show until Netlify deploys again. That is
expected; do not change its section.

**Rollback** (only if something is broken and the owner agrees): put the three old commit
hashes from your notes back and Save.

---

## Test setup

- **Desktop:** a normal Chrome window at least 1280px wide.
- **Phone width:** make the window about 400px wide (or use the device toolbar if you can open
  DevTools). Repeat the sections marked **[phone]** there.
- Start each section from `https://shop.legalleafmarket.shop/` unless it says otherwise.
- Record every check as **PASS**, **FAIL** or **N/A** in the results table at the end.

---

## A. Homepage feed (look and feel)

| ID | Do this | Expect |
|---|---|---|
| A1 | Load the homepage, watch the feed area | A grey shimmering skeleton with the word "Loading the feed..." shows first, then the feed. Never a blank gap, never a stuck skeleton. |
| A2 | Look at the top of the feed | Gold kicker "The Feed · <today's date>", heading "Things worth a second look", a row of round photo circles (All, Glass, Jars & Stash ... Saved). |
| A3 | Cover story | One large card: whole product photo on white, title, a short line of copy, maker, price, and either **Add to cart** or **See options**. |
| A4 | Scroll the feed | Cards fade up into place. Columns are 4 wide (desktop), 3 (mid), 2 (phone). Reading across a row goes glass, herbal, jars... rather than one shelf down a whole column. |
| A5 | Keep scrolling to the bottom | More cards load **by themselves** (no click needed). Cards already on screen do **not** jump or blink. It ends at "You are all caught up" with a "Browse everything" link. |
| A6 | Hover a card (desktop) | Card lifts slightly, photo zooms a touch, and where the product has a second photo it cross-fades to it. |
| A7 | Click a circle (e.g. Grinders), then **All** | Feed narrows to that shelf, the circle gets a blue glow; All brings everything back. |
| A8 | Type `jar` in "Search the feed" | Only matching cards; clearing the box brings them back. |
| A9 | Shop / price / sort dropdowns | Each one changes the list; the dropdown arrows are drawn by the site (a thin chevron), not the browser's default. |
| A10 | Tap the heart on two cards, then the **Saved** circle | Heart turns pink with a small pop. Saved shows exactly those two. Reload: still saved (it is per browser only). Un-heart one: it leaves Saved. |
| A11 | [phone] Repeat A1-A5 | No sideways scroll anywhere on the page. Price and button sit stacked and even on every card (button full width under the price). |

## B. Add to cart from a feed card

| ID | Do this | Expect |
|---|---|---|
| B1 | On a card whose button says **Add** (single size), click it | Button reads "Adding..." then turns green "Added ✓", then back to "Add" after about 2 seconds. A toast at the bottom says "Added to your cart. View cart". |
| B2 | Look at the header cart icon | The count went up by 1 **without a page reload**. |
| B3 | Open the cart drawer (header cart icon) | The item is there with the right title, photo and price. |
| B4 | Click **Add** twice quickly on a different card | Only one unit is added (the button ignores the second click while busy). |
| B5 | Click **View cart** in the toast | Goes to `/cart` and the items are listed. |
| B6 | On a card whose button says **Options** | Goes to the product page. Pick a size, use the theme's own Add to cart, confirm the drawer shows that size. |
| B7 | Cover story button (A3) | Add to cart behaves like B1; See options behaves like B6. |
| B8 | [phone] Repeat B1-B3 | Same results; the toast sits above the phone's bottom bar. |

If an Add ever turns **red "Not added"** with "Could not add that. Try the product page.",
record the product URL: that is a real failure from Shopify (sold out, deleted variant, or a
cart limit).

## C. "Shop the set" cards

| ID | Do this | Expect |
|---|---|---|
| C1 | Find a "Shop the set" card in the feed (one every nine cards; up to four exist) | Three thumbnails, three lines with prices, a full-width button "Add all 3, $<total>". |
| C2 | Add the prices on the card yourself | They equal the total on the button. |
| C3 | Click **Add all 3** | Green "Added ✓", cart count +3, drawer shows all three lines at the prices printed on the card. |
| C4 | Note any set that never appears | A set hides itself when one of its items is sold out or gone. List which sets you saw by name (Mix your own blend, The rolling session, Wind down, Glass night). |

## D. Collection pages (the slicer)

Test `https://shop.legalleafmarket.shop/collections/all`, then
`/collections/herbal-leaf-market` and `/collections/nicotia-market`.

| ID | Do this | Expect |
|---|---|---|
| D1 | Load the page | Skeleton with "Loading <collection name>...", then one row of photo circles, a search box, dropdowns, an item count, In stock / On sale chips, sort, Clear all. The theme's own product grid is **not** also showing underneath. |
| D2 | Desktop: arrows on the circle row | Right arrow appears when the row overflows; clicking it slides the row smoothly; left arrow appears once scrolled. |
| D3 | Pick a circle, a type, a brand and a price | Count updates ("N of M items"), dropdown counts update, circles with nothing left fade out and cannot be clicked. |
| D4 | Copy the address bar, open it in a new tab | The same filters come back (the URL carries `ll_shelf`, `ll_brand`, `ll_cat`, `ll_price` and so on). |
| D5 | **Clear all** | Everything resets; count shows the full total. |
| D6 | Untick **In stock** | Sold-out items appear with a "Sold out" pill and no Add button. |
| D7 | Scroll to the end, **Show more** | 36 more load; the page footer is still reachable (no endless scroll here, by design). |
| D8 | **Add** on a grid card | Same as B1-B3. |
| D9 | [phone] Repeat D1, D3, D8 | Two columns, filters stacked neatly, no sideways scroll. |

## E. Product page

| ID | Do this | Expect |
|---|---|---|
| E1 | Open any multi-size product | Theme product page. Each size shows its own price; sold-out sizes cannot be added. |
| E2 | Add 2 of one size with the quantity picker | Drawer shows quantity 2 and the line price is 2 x unit. |

## F. Herbal Leaf, Nicotia and compliance-tagged items

The owner switched every product live on 2 Nov 2026, but nicotine pouches, cigars and the CBD
makers still carry the tag `compliance-review` because they need the LLC, a tobacco certificate,
a non-Shopify-Payments processor and checkout age verification before they can really be sold.

| ID | Do this | Expect / record |
|---|---|---|
| F1 | Add one nicotine pouch product and one CBD product to the cart | Record whether Shopify lets them into the cart and through to checkout. Do not judge it; the owner decides. |
| F2 | `https://shop.legalleafmarket.shop/herbal-leaf` and `/nicotia` | Redirect to the matching collections. |
| F3 | `https://legalleafmarket.shop/` (bare domain) | Lands on the Shopify store (302). |

## G. Cart drawer

Put **at least 8 different items** in the cart first (that is what makes scrolling matter).

| ID | Do this | Expect |
|---|---|---|
| G1 | Open the drawer | Dark drawer, "Cart" with a gold count badge, line items as rounded cards with photos on white. |
| G2 | Scroll the list | **One** scroll area. The summary (discount, Estimated total, Check out) stays pinned at the bottom, slightly see-through and blurred over the list, and **Check out is always visible and clickable**. |
| G3 | Quantity **+** and **−** on a line | The number is clearly readable (white), changes, line price and total update. At 1, **−** looks disabled or removes the line (record which). |
| G4 | Type a quantity (e.g. 3) into the box and press Enter / click away | Updates to 3. |
| G5 | Remove (bin icon) | Line disappears, total and badge update. Hover turns the bin pink. |
| G6 | Discount: open it, type `NOTAREALCODE`, apply | A clear "not valid" style message, nothing breaks, text in the field is readable. If the owner has a real code, apply it and check the total drops by the right amount. |
| G7 | Remove everything | Empty-cart message and a working "continue shopping" style button (pill shaped). |
| G8 | Close button (round ✕) | Hover rotates it; it closes the drawer. Esc also closes it. |
| G9 | [phone] Repeat G1-G5 | Drawer fills the screen height; Check out is never hidden under the browser's bottom toolbar. |
| G10 | Logged in to Shopify admin (preview bar visible at the bottom) | Check out still sits above the preview bar, not under it. |

## H. Cart page `/cart`

| ID | Do this | Expect |
|---|---|---|
| H1 | Same items as G, go to `/cart` | Lines, quantities and total match the drawer. |
| H2 | Change a quantity and remove a line here | Same as G3/G5. |
| H3 | **Check out** button | Goes to checkout (section I). |

## I. Checkout (stop at payment)

Start from a cart with 2-3 ordinary accessories (glass, grinder, jar). Use the owner's own
name, email and Indiana address; **the owner types them** if they prefer.

| ID | Do this | Expect / record |
|---|---|---|
| I1 | Check out from the drawer | Shopify checkout opens (shop domain `/checkouts/...`). Line items and subtotal match the cart. |
| I2 | Age check | Record whether a 21+ / ID verification step appears anywhere before payment, and which app runs it. The site's age gate promises "every order is age-verified at checkout"; **no check here is a FAIL**. |
| I3 | Shipping methods for an Indiana address | Write down every option and price. The homepage feed has a note card that says **"Free local delivery. We deliver free across South Central Indiana. We do not ship."** while the Shipping page says orders are dropshipped by suppliers. If checkout offers paid shipping, or no local delivery, record it as a FAIL against that note card (copy mismatch). |
| I4 | Taxes | Indiana sales tax (7%) is charged on the subtotal, or record what is shown. |
| I5 | Discount at checkout | `NOTAREALCODE` is refused cleanly; a real code from the owner applies. |
| I6 | Payment step | Record which payment methods and which gateway are shown (Shopify Payments, PaymentCloud/Authorize.net, NMI, "Bogus Gateway", or "This store can't accept payments right now"). **Stop here.** Only if the owner says "run a test order": the owner turns on test mode (Settings -> Payments -> Bogus Gateway, or the gateway's own test mode), pays with the test card the gateway documents, and afterwards cancels the order in Admin -> Orders and turns test mode off. Record the order number and that it was cancelled. |
| I7 | Back out of checkout to the store | The cart still holds the items. |
| I8 | [phone] Repeat I1-I3 | Same results at phone width. |

## J. Dispensary hand-off (not a Shopify checkout)

`https://shop.legalleafmarket.shop/pages/dispensary` shows partner shops' flower. We do not sell
it; each card sends the shopper to the partner shop, which is the seller.

| ID | Do this | Expect |
|---|---|---|
| J1 | Open the page | A 21+ prompt, then the shelf. If it says "The partner shelves did not load", record it (it reads from Netlify, which is paused) and skip J2-J4. |
| J2 | Card buttons | Every button says "Shop at <store> →", **never** "Add to cart". |
| J3 | Right-click "Shop at THCA Small Buds" -> Copy link address, paste into your notes | The link goes to thcasmallbuds.com and carries `ref=coffeeandajoint`. |
| J4 | Same for Black Tie CBD | Goes to Black Tie and carries `ref=coffeeandajoint`. Puffweiser has no affiliate id yet, so a clean link with no `ref` is correct. |
| J5 | Do not buy anything on a partner site | (Self-referral breaks partner terms.) |

---

## Results

Fill this in as you go, then paste the whole table back to the owner.

| ID | PASS / FAIL / N/A | Notes (URL, what happened, screenshot name) |
|---|---|---|
| Step 0 | | old commit hashes: feed `...`, slicer `...`, header css `...` |
| A1 | | |
| A2 | | |
| A3 | | |
| A4 | | |
| A5 | | |
| A6 | | |
| A7 | | |
| A8 | | |
| A9 | | |
| A10 | | |
| A11 | | |
| B1 | | |
| B2 | | |
| B3 | | |
| B4 | | |
| B5 | | |
| B6 | | |
| B7 | | |
| B8 | | |
| C1 | | |
| C2 | | |
| C3 | | |
| C4 | | sets seen: |
| D1 | | |
| D2 | | |
| D3 | | |
| D4 | | |
| D5 | | |
| D6 | | |
| D7 | | |
| D8 | | |
| D9 | | |
| E1 | | |
| E2 | | |
| F1 | | |
| F2 | | |
| F3 | | |
| G1 | | |
| G2 | | |
| G3 | | |
| G4 | | |
| G5 | | |
| G6 | | |
| G7 | | |
| G8 | | |
| G9 | | |
| G10 | | |
| H1 | | |
| H2 | | |
| H3 | | |
| I1 | | |
| I2 | | age check app: |
| I3 | | shipping options: |
| I4 | | |
| I5 | | |
| I6 | | gateway shown: |
| I7 | | |
| I8 | | |
| J1 | | |
| J2 | | |
| J3 | | |
| J4 | | |
| Console | | any errors naming ll-shop / ll-cart / cart: |

## Hand back to Claude Code

Give the owner this to paste into the Claude Code session:

> Checkout test run done on shop.legalleafmarket.shop, theme on commit `<hash>`.
> FAILs: <IDs, one line each>. Gateway at payment: <name>. Age check at checkout: <yes, app name / no>.
> Shipping options for Indiana: <list>. Full results table below.

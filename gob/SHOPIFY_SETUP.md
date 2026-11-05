# G.O.B. on shop.legalleafmarket.shop

Three pre-order products and a brand band for the collection page. Built from the
Golden Hemp handoff package on 5 Nov 2026. The images live in `public/img/gob/`
and are served through jsDelivr pinned to commit `a13f7e1`, the same way
`ll-shop.js` is while Netlify deploys are paused.

## Files

The browser half (importing, collections, pages, the Founders Club) is written up for Claude in Chrome in `HANDOFF_CHROME_GOB.md`.


- `gob-products.csv`: Shopify product import, three products, four images each
  (packshot, staged scene, medallion, flat wrap).
- `gob-section.liquid`: paste into a Custom Liquid section on the collection.

## Steps

1. **Products > Import**, upload `gob-products.csv`. All three arrive as **drafts at
   $0.00**. That is deliberate: no price exists yet, and a live $0 vape is worse
   than a hidden one.
2. On each product: set the **price**, the **shipping weight** (set to 0 in the
   CSV because nobody has weighed a boxed unit), then set Status to **Active**.
   Inventory is 0 with "continue selling when out of stock" on, which is what
   makes it a pre-order.
3. **Products > Collections > Create**: title `G.O.B. Good Old Boys`, handle `gob`,
   automated, condition *Product tag is equal to* `gob`.
4. **Online Store > Themes > Customize**, open the collection template (or a
   G.O.B.-only template assigned to that collection), add a **Custom Liquid**
   section above the product grid, paste `gob-section.liquid`.
5. Add the collection to the menu wherever you want it.

## What stops these from actually selling

These are not code. Each one can make a live pre-order unlawful or get the
store shut off, so clear them before step 2's "Active".

- **Payment processor.** Shopify Payments prohibits THC products. The store needs
  a processor that accepts them, plus checkout age verification. `terms.html`
  already promises "every order is age-verified at checkout".
- **Federal hemp definition.** `CLAUDE.md` records that from 11 Dec 2026 most
  THCa products stop being hemp federally. A 2 mL THC disposable from a hemp
  supplier is very likely inside that. Confirm with Golden Hemp and a lawyer.
- **We become seller of record.** `CLAUDE.md` ("Dropship does not get around the
  hemp rules") says to keep our own catalogue to accessories for exactly this
  reason. Selling G.O.B. ourselves is a decision to override that, so record it.
- **Shipping.** USPS will not carry vapes to consumers (PACT Act), and UPS/FedEx
  refuse them to consumers too. A carrier has to be settled before anything ships.
- **Lab results.** The QR code on the wrap and box is still a placeholder shared
  by all three strains.

## Copy decisions

The product copy is flavor only. It leaves out the effect claims ("mood-lifting",
"uplifting", "relaxation") and the strain lineages from `STRAIN_SPECS_AND_COPY.md`
until Golden Hemp confirms what oil goes in the device and compliance review
signs off. "Sold by Legal-Leaf Market" is on every product, which `terms.html`
requires.

## G.O.B. on every page (5 Nov 2026)

`public/gob-promo.js` puts a G.O.B. banner at the top of every page and a floating flavor card
in the bottom corner. It already runs on legalleafmarket.shop/cafe and /shelf. On the Shopify
store, add ONE line to the header group's Custom Liquid section (the one that loads
`ll-cart.css`, so it is on every page), with the commit filled in:

    <script src="https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@<commit>/public/gob-promo.js" defer></script>

The flavor links go to `/pages/gob-lab-results#<flavor>` because the vapes are in person only
and their product pages stay drafts. Change the three `href`s in `FLAVORS` if that ever changes.

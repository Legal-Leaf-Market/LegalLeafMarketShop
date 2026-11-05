# Handoff to Claude in Chrome: G.O.B. launch on Shopify

> **STOP, 5 Nov 2026: do not import `gob-products.csv` (the three vapes) at all.** From
> 11 Dec 2026 a 2 mL THC vape is no longer hemp under federal law (see
> `gob/research/GEMINI_RESULTS_2026-11-05.md`). Skip task 2's first file until the owner says
> a lawyer has cleared it. The Founders Club steps are also on hold until the owner decides
> how the club changes. Ask him before starting anything here.

You are taking over the browser half of the G.O.B. / Good Old Boys Cannabis launch on
**shop.legalleafmarket.shop**. Claude Code built every file; your job is to get them into
the Shopify admin. The owner (Jacob) is next to you. Work in a new tab, one task at a time,
and **stop for the owner** at anything marked STOP.

## Ground rules

- **Nothing goes live without the owner.** Every product imports as a **draft**. Never set a
  product to Active, and never change a price, unless the owner tells you the number in this
  session.
- **The three G.O.B. vapes stay drafts no matter what.** `HANDOFF_CHROME.md` in this repo says
  the store sells no vapes on Shopify. Shopify Payments prohibits THC products, and they need
  age verification and a carrier that ships vapes. If the owner asks you to activate them,
  remind him of that first.
- **Do not touch** Settings > Payments, the domain, theme code files, or any app install or
  billing screen. Flag it and stop.
- **Never place a test order with a real card.**
- **Copy is final as written.** Do not add effect claims ("relaxing", "uplifting"), strain
  lineages or THC numbers. Founders tiers must keep the line saying a membership is
  **not an investment**.
- No em dashes in anything you type into the store.

## Where the files are

All in the repo `Legal-Leaf-Market/LegalLeafMarketShop`, folder `gob/`. Once the latest pull
request is merged, they download from:

`https://raw.githubusercontent.com/Legal-Leaf-Market/LegalLeafMarketShop/main/gob/<file>`

| File | What it is |
|---|---|
| `gob-products.csv` | The 3 vape products (Strawberry Pie, Lemon Cherry Gelato, Purple Haze) |
| `gob-founders.csv` | The 4 Founders Club tiers |
| `gob-section.liquid` | Brand banner for the G.O.B. collection page |
| `gob-founders-section.liquid` | The Founders Club page |
| `gob-founders-wall.liquid` | The Founders Wall page |
| `SHOPIFY_SETUP.md` | Background on the vape products and what blocks selling them |

If a raw link 404s, the pull request is not merged yet. Ask the owner to merge it.

## Tasks, in order

### 1. Check the images load
Open `https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@e5455c5c7be3938378c9ae940a8a4a6a1b7026be/public/img/gob/founders-badge.jpg`.
It must show the round G.O.B. badge. If it does not, STOP: the CSV imports would come in
without photos.

### 2. Import the products
1. Admin > **Products > Import**. Upload `gob-products.csv`. Leave "overwrite existing" off.
2. Repeat with `gob-founders.csv`.
3. Confirm 7 new **draft** products, each with its photo. The vapes have 4 photos each.

### 3. Collections
1. **Products > Collections > Create.** Title `G.O.B. Good Old Boys`, handle `gob`,
   automated, condition *Product tag is equal to* `gob`.
2. Create a second one: title `G.O.B. Founders Club`, handle `founders-club`, condition
   *Product tag is equal to* `founders-club`.

### 4. The Founders Wall data
1. **Settings > Custom data > Metaobjects > Add definition.** Name `Founder`, type `founder`.
2. Fields: `name` (single line text), `tier` (single line text, choices: Trailhead, Ridge,
   Summit, Lodge), `number` (integer, optional).
3. Turn **Storefront access** on. Without it the wall page shows nothing.
4. Add no entries yet. Entries come from paid orders (task 8).

### 5. Pages
1. **Online Store > Pages > Add page**: `Founders Club` (handle `founders-club`) and
   `Founders Wall` (handle `founders-wall`). Leave the body empty.
2. **Online Store > Themes > Customize.** Create a page template for each, add a
   **Custom Liquid** section, and paste the matching file:
   `gob-founders-section.liquid` into Founders Club, `gob-founders-wall.liquid` into
   Founders Wall. Assign each page its template.
3. Open the `G.O.B. Good Old Boys` collection template, add a Custom Liquid section above the
   product grid, paste `gob-section.liquid`.
4. Do not add any of this to the main menu. STOP and ask the owner where it goes.

### 6. Prices: STOP
The tier prices in the CSV are Trailhead $25, Ridge $75, Summit $250 (50 made), Lodge
$10/month. Read them to the owner and change any he wants changed. **The vapes import at
$0.00 and stay at $0.00 until the owner gives you a number.**

### 7. Lodge is monthly: STOP
A CSV cannot make a product recurring. Until a subscriptions app is attached, Lodge would
charge **$10 once**. Keep Lodge a draft. Tell the owner it needs Shopify's free
**Shopify Subscriptions** app (an app install, so the owner does it), then attach a monthly
plan to the Lodge product.

### 8. After launch: filling the wall
For each paid Founders order, check the line item properties **Founders Wall name** and
**Show on wall**. Only when Show on wall says `Yes`, add a `founder` metaobject entry with the
name exactly as typed and the tier. For Summit, set `number` in order of purchase (1 to 50).
Never add someone who did not tick the box.

## Before the owner switches Founders tiers to Active

Read this list to him. It is his call, not yours.
- Shopify Payments may refuse a membership from a brand named "Cannabis". He should ask
  Shopify before launch, not find out from a frozen payout.
- Merch quotes (patches, pins, hats, tees, hoodies, brass coins) should be in, so each tier
  still makes money after shipping.
- Set a shipping weight on each tier. The CSV sets 0.
- The refund line ("full refund any time before your pack ships") is a promise. He keeps
  it or edits it.

## Report back

When you stop, tell the owner: which tasks are done, every STOP you hit, and anything that
did not match this file.

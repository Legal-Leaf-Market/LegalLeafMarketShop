# G.O.B. go-live: instructions for a browser agent (ChatGPT agent or Gemini)

You are taking over the **Shopify admin work** to launch the G.O.B. Founders Club on
**shop.legalleafmarket.shop**. All files are already built and published in the GitHub repo
`Legal-Leaf-Market/LegalLeafMarketShop`, folder `gob/`. The owner, Jacob, is with you and
signs in for you. Work in one tab, one step at a time.

**Every file downloads from:**
`https://raw.githubusercontent.com/Legal-Leaf-Market/LegalLeafMarketShop/main/gob/<file>`

## Rules

1. **Stop and ask Jacob** before you: set any product to Active, change a price, install an
   app, touch Settings > Payments, or anything that charges money.
2. **Never import `gob-products.csv`** (the vapes). They sell in person only, never on Shopify.
3. **Do not change any wording** in the files. Paste them exactly as they are.
4. If a step does not match what you see on screen, stop and describe what you see.

## Steps

### 1. Check the images load
Open
`https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@e5455c5c7be3938378c9ae940a8a4a6a1b7026be/public/img/gob/founders-badge.jpg`.
You should see a round gold-and-green G.O.B. badge. If not, stop.

### 2. Import the Founders Club tiers
Shopify admin > **Products > Import** > upload `gob-founders.csv` > Import. You should get
4 **draft** products: Trailhead, Ridge, Summit, Lodge, each with a photo.

### 3. Two collections
**Products > Collections > Create collection**, automated, condition *Product tag is equal to*:
- `G.O.B. Founders Club`, tag `founders-club`

### 4. Custom data (Settings > Custom data > Metaobjects > Add definition)
Turn **Storefront access on** for each one. Field types in brackets.

| Name / type | Fields |
|---|---|
| Founder / `founder` | `name` (single line text), `tier` (single line text), `number` (integer), `note` (single line text) |
| G.O.B. stop / `gob_stop` | `title`, `venue`, `address`, `starts`, `ends`, `note` (single line text), `date` (date) |
| G.O.B. batch / `gob_batch` | `strain`, `batch`, `lab` (single line text), `made_on`, `best_by` (date), `coa` (file) |

### 5. Pages
**Online Store > Pages > Add page**, body left empty:

| Page title | Handle | Section file |
|---|---|---|
| Founders Club | `founders-club` | `gob-founders-section.liquid` |
| Founders Wall | `founders-wall` | `gob-founders-wall.liquid` |
| Find us | `find-us` | `gob-find-us.liquid` |
| G.O.B. lab results | `gob-lab-results` | `gob-lab-results.liquid` |

For each page: **Online Store > Themes > Customize** > top menu, choose **Pages > Create
template**, name it after the page, add a **Custom Liquid** section, paste the whole file,
save. Then go back to the page and set its template to the new one.

Open each page in a new tab and confirm it shows. Founders Club shows "Opening soon" on each
tier until the products are Active. That is expected.

### 6. STOP: Jacob decides
Read Jacob this list and do what he says:
- Tier prices are Trailhead $25, Ridge $75, Summit $250 (50 made), Lodge $10/month.
  Change any he wants.
- Set a **shipping weight** on each tier (the import sets 0).
- **Lodge** needs the free **Shopify Subscriptions** app to bill monthly. Jacob installs it.
  Until then Lodge stays a draft.
- Then set Trailhead, Ridge and Summit to **Active**.

### 7. Menu and links
- Ask Jacob where in the menu the Founders Club and Find us pages go, then add them.
- Instagram bio link: use the `instagram-bio` link from `gob/LINKS.md`.

### 8. First stops on Find us
Ask Jacob for upcoming market or pop-up dates. Add each as a `gob_stop` entry
(Settings > Custom data > G.O.B. stop > Add entry). Times are 24-hour, like `10:00`.

## After launch (ongoing)

- **New member who ticked "Show on wall":** add a `founder` entry: their wall name exactly as
  typed, their tier, the Summit number in order of purchase, and their wall note if it is kind
  and on topic. Never edit their words.
- **Order with "Referred by":** tell Jacob, so both members get a bonus patch.
- **New vape batch:** add a `gob_batch` entry with the lab report PDF.

## Report back
Tell Jacob which steps are done, anything you skipped, and anything that looked different.

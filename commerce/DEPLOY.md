# Putting the store backend online

The website (legalleafmarket.shop) stays on Netlify. This folder is the store
behind it: products, carts, orders, card payments. It runs on Render.

## One time, about 10 minutes

1. Sign in at render.com (GitHub sign-in is easiest) and allow it to see the
   `Legal-Leaf-Market/LegalLeafMarketShop` repository.
2. **New -> Blueprint**, pick the repo. Render reads `render.yaml` and offers a
   database and a web service. Leave the three `NMI_*` keys blank for now and
   click **Apply**. The first deploy takes several minutes; it builds, creates
   the tables, sets the store up and imports the whole catalogue.
3. Make your admin login. In the service's **Shell** tab:

       cd .medusa/server && npx medusa user -e jake@legalleafmarket.shop -p 'a-long-password'

   Then open https://legal-leaf-commerce.onrender.com/app and sign in.
4. Copy the **Web storefront** publishable key: Settings -> Publishable API Keys
   (it also appears in the deploy log as `Publishable key for Web: pk_...`).
5. In Netlify (project legalleafmarket-shop -> Environment variables) add
   `MEDUSA_URL = https://legal-leaf-commerce.onrender.com` and
   `MEDUSA_PUBLISHABLE_KEY = pk_...`, then trigger a deploy. /shop now reads
   the store live.

## When PaymentCloud approves the account

Paste `NMI_SECURITY_KEY`, `NMI_TOKENIZATION_KEY` and `NMI_WEBHOOK_SECRET` into
the Render service's environment, set `NMI_SANDBOX` to `false` once they are
live keys, and redeploy. `yarn setup` (run on every deploy) puts the card
provider on the region by itself.

## If the address changes

If Render gives the service a different address, or you point a domain such as
commerce.legalleafmarket.shop at it, update `ADMIN_CORS`, `AUTH_CORS` and
`MEDUSA_BACKEND_URL` in Render and `MEDUSA_URL` in Netlify to match.

# Putting the store backend online

The website (legalleafmarket.shop) stays on Netlify. This folder is the store
behind it: products, carts, orders and an admin dashboard. It runs on Render.

**Right now this is a free test (owner, 27 Nov 2026).** `render.yaml` asks for
Render's free plans, and `/shop` does not read this backend: the live shop is
still cash at delivery through `api/order.js` and the Google Sheet. Step 5 is
for later, if and when the owner decides to switch `/shop` over.

## One time, about 15 minutes

1. Sign in at render.com (GitHub sign-in is easiest) and allow it to see the
   `Legal-Leaf-Market/LegalLeafMarketShop` repository.
2. **New -> Blueprint**, pick the repo. Render reads `render.yaml` and offers a
   free database and a free web service. Leave the three `NMI_*` keys blank and
   click **Apply**. The first deploy takes 10 to 15 minutes: the build compiles
   the store, creates the tables, sets the store up and imports the whole
   catalogue (`commerce/render-build.sh`).
3. Make your admin login. Free services have no Shell, so the build does it: in
   the deploy's log, find the line `Invite token: invite_...` and open

       https://legal-leaf-commerce.onrender.com/app/invite?token=<that token>

   Choose your own password there, then sign in at
   https://legal-leaf-commerce.onrender.com/app. Afterwards, delete
   `ADMIN_INVITE_EMAIL` from the service's **Environment** tab so later deploys
   stop making new invites. If the invite expires before you use it, trigger a
   new deploy and a fresh one is printed.
4. The **Web storefront** publishable key is in the same log
   (`Publishable key for Web: pk_...`) and in the admin under Settings ->
   Publishable API Keys.
5. Only when `/shop` should read the store live: in Netlify (project
   legalleafmarket-shop -> Environment variables) add
   `MEDUSA_URL = https://legal-leaf-commerce.onrender.com` and
   `MEDUSA_PUBLISHABLE_KEY = pk_...`, then trigger a deploy. Do not do this on
   the free plan: the first shopper after a quiet spell would wait about a
   minute for the store to wake.

## What the free plan means

- The service sleeps after 15 minutes without a visitor and takes about a
  minute to wake. The first page of the admin after a break is slow; that is
  the plan, not a fault.
- 512 MB of memory. If the service restarts with an out-of-memory error, that
  is the free plan's limit.
- **The free database expires 30 days after it is created**, and Render deletes
  it, with every product and order in it, 14 days after that. Upgrade it before
  then to keep the data.
- To keep it for real, change both `plan:` values in `render.yaml` (for example
  web `starter` and Postgres `basic-256mb`, about $13/month when this was
  written) and redeploy. The build script works the same on a paid plan.

## If card payments ever come back

The shop is cash at delivery and card processing is archived. If that changes:
paste `NMI_SECURITY_KEY`, `NMI_TOKENIZATION_KEY` and `NMI_WEBHOOK_SECRET` into
the Render service's environment, set `NMI_SANDBOX` to `false` once they are
live keys, and redeploy. `yarn setup` (run on every deploy) puts the card
provider on the region by itself.

## If the address changes

If Render gives the service a different address, or you point a domain such as
commerce.legalleafmarket.shop at it, update `ADMIN_CORS`, `AUTH_CORS` and
`MEDUSA_BACKEND_URL` in Render (and `MEDUSA_URL` in Netlify, if it is set) to
match. The invite link in step 3 uses the same address.

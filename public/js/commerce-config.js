/* public/js/commerce-config.js -- where /shop finds the store backend.
 *
 * EMPTY = static mode: /shop reads /shop/catalog.json (a snapshot made by
 * tools/snapshot-catalog.mjs) and checkout sends an order request instead of
 * taking a card. That is the state until the Medusa backend in commerce/ is
 * hosted and the card processor (NMI, via PaymentCloud) is approved.
 *
 * LIVE = set both values: the backend's public URL and the "Web storefront"
 * publishable key that commerce/src/scripts/setup-store.ts prints. A
 * publishable key is public by design (it only scopes the store API to a sales
 * channel), so it is fine in this file. Never put an admin token or the NMI
 * security key here.
 */
window.LL_COMMERCE = {
  url: "",
  key: "",
}

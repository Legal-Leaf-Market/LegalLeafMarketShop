/* /api/promo -- which stores take the house coupon, and for how much.
 *
 * Read by public/js/promo.js, the banner every shopping page carries. It is a
 * tiny answer on purpose: the banner sits on library pages too, and asking
 * /api/products for 7 MB to learn five store names would be absurd.
 *
 * THE STORES COME FROM THE REGISTRY, never from copy. A store is listed only if
 * it is enabled and its own `coupon` is the code, which is the same field the
 * cart applies at checkout -- so the banner cannot name a store whose checkout
 * would refuse the code (a delisted store, or one whose code was removed, drops
 * off by itself).
 *
 * Greek Glass is the one exception, because it is not in STORES (CLAUDE.md §7:
 * greekglass.html reads Big Cartel itself). Its code and percentage are the
 * COUPON / OFF constants in public/greekglass.html; change one, change this.
 */
import { STORES } from './products.js';

export const HOUSE_CODE = 'JACOBKENNEDY';
const GREEK_GLASS = { name: 'Greek Glass', pct: 10, url: '/greekglass' };

/* The store's own home page, stamped with OUR referral the way refUrl() stamps a
   product link. A bare link here would work, sell, and pay nothing (§7). */
function storeUrl(s) {
  const u = new URL('https://' + (s.displayDomain || s.domain) + '/');
  if (s.ref) u.searchParams.set(s.refParam || 'ref', s.ref);
  return u.toString();
}

export function promoStores(stores = STORES, code = HOUSE_CODE) {
  const out = stores
    .filter((s) => s && s.enabled !== false && String(s.coupon || '').toUpperCase() === code)
    .map((s) => ({ name: s.name, pct: Number(s.couponPct) || 0, url: storeUrl(s) }));
  out.push(GREEK_GLASS);
  return out.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ ok: true, code: HOUSE_CODE, stores: promoStores() });
}

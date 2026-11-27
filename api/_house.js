/* api/_house.js -- products we sell ourselves that no catalogue source carries.
 *
 * G.O.B. (Good Old Boys) 2 mL disposables, three flavours. Owner, 27 Nov 2026:
 * "I really want those to be on the site for cash on delivery." They are added
 * to /api/catalog here, after the source rows, so they bypass catalog.js's
 * BLOCKED list on purpose: that list still keeps every OTHER THC-family row an
 * import brings in off /shop. It names "gob" and "good old boys" so a Shopify or
 * Medusa copy of these can never appear twice beside this one.
 *
 * The owner chose to list these knowing the card processor (PaymentCloud) does
 * not allow THC products on the site it reviews, and that most THC hemp
 * products stop counting as hemp federally from 11 Dec 2026. Recorded in
 * CLAUDE.md ("G.O.B. is on /shop").
 *
 * PRICE, owner's words: "1 should be $30 flat, I take the tax out, and 2 should
 * be $50, I take the tax out." So:
 *   - taxIncluded: the price IS what the customer pays; the 7% Indiana sales
 *     tax is carved out of it for the books, never added on top;
 *   - pack: any 2 from the same pack group cost $50, flavours can be mixed.
 *     3 is $80, 4 is $100. api/order.js prices it and public/js/shop.js shows it.
 *
 * COPY RULES (gob/HANDOFF_CHROME_GOB.md): flavour notes only. No effect claims,
 * no lineages, no THC numbers. No em dashes.
 *
 * Underscore file: never routed (netlify/lib/routes.mjs).
 */

const PACK = { group: 'gob-2ml', qty: 2, price: 50 };

const FLAVOURS = [
  { key: 'lemon-cherry-gelato', name: 'Lemon Cherry Gelato', notes: 'Lemon / Cherry / Cream',
    blurb: 'Lemon candy and cherry syrup up front, then a creamy dessert finish with a light touch of gas.' },
  { key: 'purple-haze', name: 'Purple Haze', notes: 'Lavender / Berry',
    blurb: 'Sweet berry and lavender-like florals over spicy herbal tea, bright citrus zest and a dry pine finish.' },
  { key: 'strawberry-pie', name: 'Strawberry Pie', notes: 'Strawberry / Vanilla',
    blurb: 'Strawberry jam on buttery pastry, with vanilla sugar and a soft herbal finish. Sweet and bakery-rich without being heavy.' },
];

export const HOUSE_PRODUCTS = FLAVOURS.map((f) => {
  const img = (s) => `/img/gob/${f.key}-${s}`;
  const images = [img('packshot.jpg'), img('staged.jpg'), img('medallion.webp'), img('wrap.jpg')];
  return {
    id: `gob-${f.key}-2ml`,
    title: `G.O.B. ${f.name} 2 mL Disposable`,
    brand: 'G.O.B. Good Old Boys',
    type: 'Disposable Vape',
    tags: ['gob', 'house', 'vape', '2ml-disposable', f.key],
    price: 30,
    priceMax: 30,
    image: images[0],
    images,
    variants: [{ id: `gob-${f.key}-2ml`, title: '', price: 30, compareAt: null, available: true }],
    description: `${f.notes}. ${f.blurb} 2 mL disposable, black hardware, clear tank. $30 each or any 2 for $50, mix the flavours, Indiana sales tax included. Hand-delivered in Indiana, paid in cash at the door, with a valid 21+ photo ID checked before hand-over. Sold by Legal-Leaf Market.`,
    ageRestricted: true,
    taxIncluded: true,
    pack: PACK,
  };
});

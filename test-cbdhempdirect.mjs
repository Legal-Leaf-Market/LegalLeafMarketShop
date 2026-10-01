/* CBD Hemp Direct, run against a stubbed WooCommerce Store API.
 *
 * The bug this pins: the store shipped with platform:'auto' and no wooVariations, so every
 * variable product published its price_range MINIMUM as a single flat row. The owner saw it as
 * "you are only picking up the smallest size on cbd hemp", and it is the whole pitch of the site
 * missing, since the ounce is the row that sells.
 *
 * The fixture is the real Candy Paint product: three variations under attribute_pa_net-weight at
 * 7 Grams $33.53, 14 Grams $62.10 and 28 Grams $114.99, ids 153528/153529/153530, taken from the
 * page source rather than invented. Note the shipping weights (23/46/40 g) deliberately disagree
 * with the net weights: WooCommerce's `weight` field is what the box weighs, so grams have to come
 * from the variation label, and a regression that starts trusting that field will fail here.
 *
 * Run: node test-cbdhempdirect.mjs
 */
import handler from './api/products.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

/* The Store API quotes money in MINOR UNITS beside a currency_minor_unit, so $33.53 is the
   string "3353". Writing the fixture in dollars made every price come out 100x low, which is
   exactly what a real feed would do to us if normWoo ever stopped dividing. */
const money = (cents) => ({ price: String(cents), regular_price: String(cents), currency_minor_unit: 2, currency_code: 'USD' });

const PARENT = {
  id: 153500, name: 'THCA Flower - Candy Paint', slug: 'thca-flower-candy-paint',
  permalink: 'https://cbdhemp.direct/products/thca-flower-candy-paint',
  type: 'variable', is_in_stock: true, date_created: '2026-01-05T00:00:00',
  prices: { ...money(3353), price_range: { min_amount: '3353', max_amount: '11499' } },
  categories: [{ name: 'THCA Flower' }], tags: [{ name: 'Indoor' }],
  /* The parent declares the attribute with its real TAXONOMY and its real terms. That taxonomy
     (`pa_net-weight`) is the only place the add-to-cart key can come from: slugifying the label
     "Net Weight" gives `net-weight` and Woo would reject it. */
  attributes: [{ id: 1, name: 'Net Weight', taxonomy: 'pa_net-weight', has_variations: true,
    terms: [{ id: 11, name: '7 Grams', slug: '7-grams' },
            { id: 12, name: '14 Grams', slug: '14-grams' },
            { id: 13, name: '28 Grams', slug: '28-grams' }] }],
  short_description: 'Indoor THCa flower.', description: 'Hand trimmed indoor buds.',
  /* The Brands taxonomy, core since WooCommerce 9.4. It sits beside the pa_net-weight
     VARIATION attribute above, which is the trap: read that as a maker and every
     flower product in this catalogue files under a brand called "28 Grams". */
  brands: [{ id: 44, name: 'CBD Hemp Direct', slug: 'cbd-hemp-direct' }],
  images: [{ src: 'https://cbdhemp.direct/wp-content/uploads/candy-paint.jpg' }],
  weight: '40',
};
/* Same store, a listing whose offcut grade lives in ONE variation rather than in the title. This
   is the case the per-row flag exists for: banner the whole card and the whole-bud rows are
   libelled, banner none of it and the shake is sold as flower. */
const MIXED_PARENT = {
  ...PARENT, id: 153600, name: 'THCA Flower - House Blend', slug: 'thca-flower-house-blend',
  permalink: 'https://cbdhemp.direct/products/thca-flower-house-blend',
  description: 'Indoor buds.', short_description: 'Indoor.',
};
const VARIATIONS = [
  { id: 153528, parent: 153500, variation: 'Net Weight: 7 Grams', prices: money(3353), is_in_stock: true, weight: '23', images: [], attributes: [{ name: 'Net Weight', value: '7-grams' }] },
  { id: 153529, parent: 153500, variation: 'Net Weight: 14 Grams', prices: money(6210), is_in_stock: true, weight: '46', images: [], attributes: [{ name: 'Net Weight', value: '14-grams' }] },
  { id: 153530, parent: 153500, variation: 'Net Weight: 28 Grams', prices: money(11499), is_in_stock: true, weight: '40', images: [], attributes: [{ name: 'Net Weight', value: '28-grams' }] },
  { id: 153601, parent: 153600, variation: 'Net Weight: 28 Grams', prices: money(9900), is_in_stock: true, images: [] },
  { id: 153602, parent: 153600, variation: 'Shake 28 Grams', prices: money(4400), is_in_stock: true, images: [] },
];

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
/* Same, but carrying response headers. The Store API states the size of the collection it is
   paginating in X-WP-Total, and the sweep reports a shortfall against that number rather than
   guessing at one. Real Headers rather than a plain object, so a case-sensitivity bug in the
   reader would fail here the way it would fail against a real response. Note `json` above
   deliberately keeps NO headers, which pins that the reader tolerates their absence. */
const jsonH = (body, headers) => ({
  ok: true, status: 200, headers: new Headers(headers || {}), text: async () => JSON.stringify(body),
});
let variationSweeps = 0;
/* THIS SUITE STANDS THE NO-REAL-STORE GUARD DOWN, and substitutes a stronger one.
   LL_NO_STORE_FETCH makes api/products.js refuse at its fetch chokepoint, which is
   right for every suite that boots the real server -- but this one drives the REAL
   handler against a stubbed WooCommerce Store API, so it has to reach that stub.
   A fetch replaced three lines down cannot touch a real merchant at all, which is
   what the flag is for; leaving it set would only stop the scraper being tested.

   Deleted here rather than at the top of the file, because api/products.js reads
   the flag PER CALL: the stub and the standing-down arrive together, so there is
   no window in which this suite could make a real request. */
delete process.env.LL_NO_STORE_FETCH;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
  const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
  if (u.includes('type=variation')) {
    if (page === 1) variationSweeps++;
    return json(page === 1 ? VARIATIONS : []);
  }
  if (u.includes('/wp-json/wc/store/v1/products')) return json(page === 1 ? [PARENT, MIXED_PARENT] : []);
  /* A Shopify probe would mean the platform is still being guessed at. It is not: the page source
     settled it. */
  return { ok: false, status: 404, text: async () => 'not shopify' };
};

let payload = null;
await handler({ query: { debug: '' } }, {
  setHeader() {}, status() { return this; }, json(b) { payload = b; return this; },
});

console.log('=== CBD Hemp Direct publishes every size, not just the cheapest ===');
const mine = (payload.products || []).filter((p) => p.storeKey === 'cbdhempdirect');
console.log('  products: ' + JSON.stringify(mine.map((p) => [p.name, p.sizes.length])));
ok(mine.length === 2, 'both listings came through: ' + mine.length);

const candy = mine.find((p) => /Candy Paint/.test(p.name));
ok(!!candy, 'Candy Paint is in the payload');
console.log('  sizes: ' + JSON.stringify(candy.sizes));
ok(candy.sizes.length === 3, 'three size rows, not one flat "from" price: ' + candy.sizes.length);
ok(candy.sizes.map((s) => s[2]).join(',') === '7,14,28',
   'grams read off the variation LABEL, not the shipping weight field: ' + candy.sizes.map((s) => s[2]).join(','));
ok(candy.sizes.map((s) => s[1]).join(',') === '33.53,62.1,114.99', 'each row carries its own price');
ok(candy.sizes.map((s) => s[3]).join(',') === '153528,153529,153530',
   'and its own variation id, which is what the cart link adds');
ok(candy.sale === 33.53, 'the card still opens at the cheapest row');
ok(candy.perG === 4.11, 'and the per-gram figure is the best of them, 114.99/28: ' + candy.perG);
ok(candy.platform === 'woocommerce', 'platform settled as woocommerce');
/* THE MAKER, AND THE CASE WHERE THERE ISN'T ONE. The Woo path used to be told the Store
   API has no vendor field, so all six WooCommerce stores published 425 products with no
   brand at all -- measured on the live feed against every Shopify store at 100%. Two real
   fields carry it, and brandFromWoo() reads both (pinned in test-brand.mjs).
   THIS SHOP NAMES ITSELF, which is the fixture's own `brands` taxonomy verbatim -- and a
   shop is not a maker. Publishing it would put "CBD Hemp Direct" on the brand rail beside
   the identical chip on the store rail, which is what was reported on the live site. So
   the right answer here is an EMPTY brand, and asserting it is what stops the store-brand
   rule being quietly reverted. */
ok(candy.brand === '', 'a vendor that names its own store is not published as a maker: ' + JSON.stringify(candy.brand));
ok(!candy.brandKey, 'and it gets no facet key either: ' + JSON.stringify(candy.brandKey));
ok(!/gram/i.test(candy.brand || ''), 'the pa_net-weight VARIATION attribute did not become the maker');
ok(candy.cartPath === '/cart', 'the store\'s own cart path travels with the product');
ok(candy.refParam === 'sld' && candy.ref === '161', 'Solid Affiliate referral intact: ' + candy.refParam + '=' + candy.ref);
ok(candy.url.includes('sld=161'), 'and the product url is stamped with it: ' + candy.url);
ok(variationSweeps === 1, 'the variations sweep ran exactly once for the store: ' + variationSweeps);

console.log('\n=== trim and shake is answered per row ===');
ok(candy.subTags.trim === false, '"hand trimmed" is not trim, so the listing is not flagged');
ok(candy.sizes.every((s) => s[7] === 0), 'and none of its rows are either');

const mixed = mine.find((p) => /House Blend/.test(p.name));
console.log('  mixed rows: ' + JSON.stringify(mixed.sizes.map((s) => [s[0], s[7]])));
ok(mixed.subTags.trim === false, 'a listing selling buds AND shake is not trim throughout');
ok(mixed.sizes.find((s) => /Shake/.test(s[0]))[7] === 1, 'but its shake row is flagged');
ok(mixed.sizes.find((s) => !/Shake/.test(s[0]))[7] === 0, 'and its whole-bud row is not');

console.log('\n=== the add-to-cart query is derived, never guessed ===');
/* ?add-to-cart=<variation id> alone was rejected live: Woo answered "please choose product
   options by visiting <product>" with an empty cart. Its own form posts the parent id, the
   variation id and every attribute, so slot 8 carries that attribute query, built only from
   values the parent actually declares. */
const candyAttrs = candy.sizes.map((s) => s[8]);
console.log('  attr queries: ' + JSON.stringify(candyAttrs));
ok(candyAttrs.every((q) => /^attribute_pa_net-weight=/.test(q)),
   'the real taxonomy key is used, which slugifying the label would never produce');
ok(candyAttrs.join(',') === 'attribute_pa_net-weight=7-grams,attribute_pa_net-weight=14-grams,attribute_pa_net-weight=28-grams',
   'each row carries its own term SLUG: ' + candyAttrs.join(','));
/* A value the parent does not declare is a guess, and a guessed attribute fails Woo's validation
   exactly like a missing one. Better to emit nothing and send the shopper to the product page. */
const strayParent = { ...PARENT, id: 153700, slug: 'stray',
  attributes: [{ id: 1, name: 'Net Weight', taxonomy: 'pa_net-weight', has_variations: true,
    terms: [{ id: 1, name: '7 Grams', slug: '7-grams' }] }] };
const strayVar = { id: 153701, parent: 153700, variation: 'Net Weight: 99 Grams',
  prices: money(9999), is_in_stock: true, attributes: [{ name: 'Net Weight', value: '99-grams' }] };
{
  const saved = { p: PARENT.attributes, v: VARIATIONS.slice() };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    if (u.includes('type=variation')) return json(page === 1 ? [strayVar] : []);
    if (u.includes('/wp-json/wc/store/v1/products')) return json(page === 1 ? [strayParent] : []);
    return { ok: false, status: 404, text: async () => '' };
  };
  let p2 = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { p2 = b; return this; },
  });
  const stray = (p2.products || []).find((x) => x.storeKey === 'cbdhempdirect');
  ok(!!stray && stray.sizes[0][8] === '',
     'an undeclared term yields no query at all, so the link cannot argue with the shopper: ' +
     JSON.stringify(stray && stray.sizes[0][8]));
  void saved;
}

console.log('\n=== a short first page is not the end of the catalogue ===');
/* The bug this pins: fetchWoo used to stop as soon as a page came back with fewer than 100 rows,
   which assumes the server honoured per_page=100. Plenty of WooCommerce installs cap the page
   size lower, and when the FIRST page is short the loop stops there and the whole catalogue
   truncates to one page. CBD Hemp Direct publishes 312 products and the site was showing a few
   dozen. fetchWooVariations already stops only on an empty array; this makes fetchWoo agree. */
{
  const PAGE = 32;                                  // their server's real page size, not ours
  const TOTAL = 312;                                // what /shop reports
  const all = Array.from({ length: TOTAL }, (_, i) => ({
    id: 900000 + i, name: 'THCa Flower - Strain ' + i, slug: 's' + i,
    permalink: 'https://cbdhemp.direct/products/s' + i, type: 'variable', is_in_stock: true,
    date_created: '2026-08-01T00:00:00', prices: { ...money(3353), price_range: { min_amount: '3353', max_amount: '11499' } },
    categories: [{ name: 'THCa Flower' }], tags: [], short_description: '', description: '',
    images: [{ src: 'https://cbdhemp.direct/i/' + i + '.png' }],
  }));
  let pagesServed = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    if (u.includes('type=variation')) return json([]);
    if (u.includes('/wp-json/wc/store/v1/products')) {
      pagesServed++;
      return json(all.slice((page - 1) * PAGE, page * PAGE));   // always short, never 100
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  let p3 = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { p3 = b; return this; },
  });
  const got = (p3.products || []).filter((x) => x.storeKey === 'cbdhempdirect');
  console.log('  server page size ' + PAGE + ', catalogue ' + TOTAL + ', pages fetched ' + pagesServed);
  ok(got.length === TOTAL, 'the whole catalogue comes through, not just the first short page: ' + got.length);
  ok(new Set(got.map((x) => x.id)).size === got.length, 'and every row is distinct, so paging did not double-count');
}

/* A catalogue of `n` variable parents, each with 7/14/28 g variations, in the shape the Store API
   serves them. Used by the pagination blocks below, where what matters is not any one product but
   which rows a sweep does and does not reach. */
const catalogue = (n, base) => {
  const parents = [], variations = [];
  for (let i = 0; i < n; i++) {
    const id = base + i * 10;
    parents.push({
      id, name: 'THCa Flower - Strain ' + i, slug: 's' + i,
      permalink: 'https://cbdhemp.direct/products/s' + i, type: 'variable', is_in_stock: true,
      date_created: '2026-08-01T00:00:00',
      prices: { ...money(3353), price_range: { min_amount: '3353', max_amount: '11499' } },
      categories: [{ name: 'THCa Flower' }], tags: [], short_description: '', description: '',
      images: [{ src: 'https://cbdhemp.direct/i/' + i + '.png' }],
      attributes: [{ id: 1, name: 'Net Weight', taxonomy: 'pa_net-weight', has_variations: true,
        terms: [{ id: 11, name: '7 Grams', slug: '7-grams' }, { id: 12, name: '14 Grams', slug: '14-grams' },
                { id: 13, name: '28 Grams', slug: '28-grams' }] }],
    });
    [[7, 3353], [14, 6210], [28, 11499]].forEach(([g, cents], k) => variations.push({
      id: id + 1 + k, parent: id, variation: 'Net Weight: ' + g + ' Grams', prices: money(cents),
      is_in_stock: true, images: [], attributes: [{ name: 'Net Weight', value: g + '-grams' }],
    }));
  }
  return { parents, variations };
};

console.log('\n=== a store that ignores `page` still yields its whole catalogue, via offset ===');
/* THE BUG THE OWNER REPORTED as "we're only pulling 32 items", and the reason the previous fix
   did not move the number. Dropping the <100 early stop only helps a server that paginates; this
   one serves a 32-row page and ignores `page` entirely, so page 2 came back identical to page 1,
   the repeat guard read that as the end of the catalogue, and the sweep stopped at exactly 32 of
   312. A repeat is not the end: WP_Query honours `offset` in preference to `paged`, and it is a
   different URL, so it also defeats a cache that is keyed on one. Both collections need this, not
   just the catalogue: the variations sweep was reaching only the first 32 variations, so ~280
   products fell back to their flat price_range minimum -- the smallest-size bug, back again. */
{
  const PAGE = 32, TOTAL = 312;
  const { parents, variations } = catalogue(TOTAL, 900000);
  let productReqs = 0, variationReqs = 0;
  /* Honours `offset`, ignores `page`. Any request without an offset gets the head of the list. */
  const serve = (u, all) => {
    const off = Number((u.match(/[?&]offset=(\d+)/) || [])[1] || 0);
    return jsonH(all.slice(off, off + PAGE), { 'X-WP-Total': String(all.length) });
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    if (u.includes('type=variation')) { variationReqs++; return serve(u, variations); }
    if (u.includes('/wp-json/wc/store/v1/products')) { productReqs++; return serve(u, parents); }
    return { ok: false, status: 404, text: async () => '' };
  };
  let p4 = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { p4 = b; return this; },
  });
  const got = (p4.products || []).filter((x) => x.storeKey === 'cbdhempdirect');
  console.log('  requests: ' + productReqs + ' product, ' + variationReqs + ' variation'
    + ' (page size ' + PAGE + ', ' + TOTAL + ' products, ' + variations.length + ' variations)');
  ok(got.length === TOTAL, 'the whole catalogue comes through, not the first page of it: ' + got.length);
  ok(new Set(got.map((x) => x.id)).size === got.length, 'and every row is distinct');
  /* The point of recovering the variations sweep: every parent gets its real size ladder, not
     just the parents the first page of variations happened to cover. */
  const laddered = got.filter((x) => x.sizes.length === 3);
  ok(laddered.length === TOTAL, 'every product has its full 7/14/28 ladder: ' + laddered.length + '/' + TOTAL);
  const last = got.find((x) => /Strain 311$/.test(x.name));
  ok(!!last && last.sizes.map((s) => s[2]).join(',') === '7,14,28',
     'including the very last one, which only offset pagination could reach: '
     + JSON.stringify(last && last.sizes.map((s) => s[2])));
  ok(got.every((x) => x.perG === 4.11), 'so every product has a real per-gram price');
  /* Bounded, and both budgets (maxPages 20, wooVariationPages 80) cover it with room. */
  ok(productReqs <= 20 && variationReqs <= 80,
     'and the sweep stays inside its request budget: ' + productReqs + '/20, ' + variationReqs + '/80');
}

console.log('\n=== a store that ignores both levers stops, says how short it is, and does not duplicate ===');
/* The other half. A store that clamps `page` AND `offset` cannot be paginated at all, so the
   sweep has to stop rather than spin its budget out against their API -- 80 identical variation
   requests is the kind of thing that gets an IP blocked. Two things must survive that:

   Rows are deduped by id. The variations sweep had no dedupe at all, so a clamped `page` pushed
   the same variations into the same parent once per request and a product came out with its 7 g
   row listed 25 times at 25 identical prices.

   And it is reported. X-WP-Total is the store's own count of the collection, so `products:short
   32/312` in ?debug names the shortfall with their number instead of ours. Without those headers
   this failure is indistinguishable from a small shop, which is exactly how it survived. */
{
  const { parents, variations } = catalogue(32, 950000);
  let productReqs = 0, variationReqs = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    if (u.includes('type=variation')) { variationReqs++; return jsonH(variations, { 'X-WP-Total': '936' }); }
    if (u.includes('/wp-json/wc/store/v1/products')) {
      productReqs++; return jsonH(parents, { 'X-WP-Total': '312' });   // the same page, always
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  let p5 = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { p5 = b; return this; },
  });
  const got = (p5.products || []).filter((x) => x.storeKey === 'cbdhempdirect');
  const drops = Object.keys((p5.dropped || {}).cbdhempdirect || {});
  console.log('  requests: ' + productReqs + ' product, ' + variationReqs + ' variation');
  console.log('  dropped:  ' + JSON.stringify(drops));
  /* Three requests, not twenty: `page`, the repeat that proves `page` is dead, and the one offset
     attempt that proves offset is dead too. */
  ok(productReqs === 3, 'it stops after proving both levers dead, not at the cap: ' + productReqs);
  ok(variationReqs === 3, 'and the variations sweep stops the same way: ' + variationReqs);
  ok(got.length === 32, 'it still publishes what it did get: ' + got.length);
  ok(got.every((x) => x.sizes.length === 3),
     'each with its 3 real rows and no duplicates: ' + JSON.stringify(got.map((x) => x.sizes.length).slice(0, 5)));
  ok(drops.includes('products:short 32/312'),
     'and ?debug names the shortfall using the store\'s own total: ' + JSON.stringify(drops));
  ok(drops.includes('products:pageIgnored@32'), 'having recorded which lever failed first');
}

console.log('\n=== a well-behaved store is not made to pay for any of this ===');
/* The sweep is shared with Exhale, Bloomz and Nothing But Canna, so a store that paginates
   properly must come out exactly as before: one request per full page, one empty page to end it,
   no offset attempt, and no drop reasons. The offset fallback costs a request only where `page`
   has already been shown not to move. */
{
  const { parents, variations } = catalogue(250, 100000);
  let productReqs = 0, offsetReqs = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    if (/[?&]offset=/.test(u)) offsetReqs++;
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    const all = u.includes('type=variation') ? variations : parents;
    if (!u.includes('type=variation')) productReqs++;
    if (u.includes('/wp-json/wc/store/v1/products')) {
      return jsonH(all.slice((page - 1) * 100, page * 100), { 'X-WP-Total': String(all.length) });
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  let p6 = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { p6 = b; return this; },
  });
  const got = (p6.products || []).filter((x) => x.storeKey === 'cbdhempdirect');
  const drops = Object.keys((p6.dropped || {}).cbdhempdirect || {});
  console.log('  requests: ' + productReqs + ' product, offset attempts ' + offsetReqs);
  ok(got.length === 250, 'all 250 products: ' + got.length);
  ok(got.every((x) => x.sizes.length === 3), 'all with full size ladders');
  ok(productReqs === 4, '3 pages plus the empty one that ends it, and nothing more: ' + productReqs);
  ok(offsetReqs === 0, 'offset is never reached when `page` works: ' + offsetReqs);
  ok(drops.length === 0, 'and nothing is reported as dropped or short: ' + JSON.stringify(drops));
}

console.log('\n=== the payload says how many rows the grid will actually show ===');
/* "298 fetched but 32 on the page" was unanswerable from the site itself: meta published only
   the fetched count, so a store whose variants are nearly all sold out looked identical to a
   store we were silently dropping. Every page hides sold-out rows by default, so the count that
   matters to a shopper is the in-stock one, and it now travels beside the fetched count. The
   category histogram is the other half: it separates "the vendor is out" from "these rows landed
   in a category the page being looked at does not show". */
{
  const LIVE = 12, DEAD = 88;
  const mk = (i, live) => ({
    id: 960000 + i, name: 'THCA Flower - Stock ' + i, slug: 'st' + i,
    permalink: 'https://cbdhemp.direct/products/st' + i, type: 'variable', is_in_stock: live,
    date_created: '2026-08-01T00:00:00', prices: { ...money(3353), price_range: { min_amount: '3353', max_amount: '11499' } },
    categories: [{ name: 'THCA Flower' }], tags: [], short_description: '', description: '', images: [],
  });
  const prods = [
    ...Array.from({ length: LIVE }, (_, i) => mk(i, true)),
    ...Array.from({ length: DEAD }, (_, i) => mk(LIVE + i, false)),
  ];
  /* Sold out is expressed the way their feed expresses it, on the VARIATIONS. A product whose
     every variation is unavailable is what the grid hides, and it is still published, per the
     rule that out-of-stock rows publish with inStock:false rather than being dropped. */
  const vars = prods.map((p, i) => ({
    id: 970000 + i, parent: p.id, variation: 'Net Weight: 28 Grams', prices: money(11499),
    is_in_stock: i < LIVE, images: [],
  }));
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    if (u.includes('type=variation')) return json(page === 1 ? vars : []);
    if (u.includes('/wp-json/wc/store/v1/products')) return json(page === 1 ? prods : []);
    return { ok: false, status: 404, text: async () => '' };
  };
  let p5 = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { p5 = b; return this; },
  });
  const got = (p5.products || []).filter((x) => x.storeKey === 'cbdhempdirect');
  ok(got.length === LIVE + DEAD, 'sold-out listings are still published, not dropped: ' + got.length);

  const entry = (p5.meta.stores || []).find((s) => s.name === 'CBD Hemp Direct');
  console.log('  meta entry: ' + JSON.stringify(entry));
  ok(!!entry, 'the store has a meta entry');
  ok(entry.count === LIVE + DEAD, 'count is what we fetched: ' + entry.count);
  ok(entry.inStock === LIVE, 'inStock is what the grid will show: ' + entry.inStock);
  ok(entry.oos === DEAD, 'and oos is the difference, so the gap explains itself: ' + entry.oos);
  ok(entry.count === entry.inStock + entry.oos, 'the two halves add back up to the whole');

  ok(p5.perStoreInStock.cbdhempdirect === LIVE, '?debug carries the same in-stock count per store');
  const hist = p5.perStoreCategory.cbdhempdirect;
  console.log('  categories: ' + JSON.stringify(hist));
  ok(Object.values(hist).reduce((a, b) => a + b, 0) === LIVE + DEAD,
     'the category histogram accounts for every fetched row');
}

console.log('\n=== ?debug&slim answers the coverage question without the 7 MB ===');
{
  /* The census in enrichCoverage() exists because the two sparse fields -- vendor-stated lineage and
     the terpene panels -- can only be described by counting the whole feed, and the full ?debug
     payload is ~7 MB, which is more than a log line, a phone, or a proxied agent will carry. Driven
     through the real handler rather than the lifted function, because the half that breaks silently
     is the wiring: an omitted `products` is invisible until somebody needs the number. */
  const LINEAGE = '<p>Genetics: Sunset Sherbert x Thin Mint GSC</p> Hand trimmed indoor flower.';
  const prods = [{
    id: 991001, name: 'Sunset Mints THCa Flower', slug: 'sunset-mints', permalink: 'https://cbdhemp.direct/product/sunset-mints/',
    prices: money(3999), description: LINEAGE, short_description: '', is_in_stock: true,
    type: 'variable', images: [], categories: [{ name: 'THCa Flower' }], attributes: [],
  }];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('cbdhemp.direct')) return { ok: false, status: 404, text: async () => '' };
    const page = Number((u.match(/[?&]page=(\d+)/) || [])[1] || 1);
    if (u.includes('type=variation')) return json([]);
    if (u.includes('/wp-json/wc/store/v1/products')) return json(page === 1 ? prods : []);
    return { ok: false, status: 404, text: async () => '' };
  };
  let full = null, slim = null;
  await handler({ query: { debug: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { full = b; return this; },
  });
  await handler({ query: { debug: '', slim: '', refresh: '' } }, {
    setHeader() {}, status() { return this; }, json(b) { slim = b; return this; },
  });
  ok(Array.isArray(full.products), '?debug still carries the catalogue');
  ok(!('products' in slim), 'and ?debug&slim does not');
  ok(slim.count === full.count, 'while reporting the same count: ' + slim.count + ' / ' + full.count);
  ok(!!slim.coverage, 'the coverage census is present');
  console.log('  coverage: ' + JSON.stringify(slim.coverage.lineage));
  ok(slim.coverage.lineage.products === 1, 'and it found the one vendor-stated lineage in this feed');
  ok(slim.coverage.lineage.examples[0].includes('Sunset Sherbert x Thin Mint GSC'),
     'reported verbatim, so a parse gone wrong is legible: ' + slim.coverage.lineage.examples[0]);
  ok(JSON.stringify(slim.coverage) === JSON.stringify(full.coverage),
     'the two responses agree -- slim drops rows, never changes the answer');
  const bytes = JSON.stringify(slim).length;
  ok(bytes < JSON.stringify(full).length, 'slim is the smaller payload (' + bytes + ' bytes here)');

  /* A public request must never be answered from, or turned into, a slim cache entry: the shape
     the engine and all three satellites read is {products, meta} and nothing else. */
  let pub = null;
  await handler({ query: {} }, { setHeader() {}, status() { return this; }, json(b) { pub = b; return this; } });
  ok(Array.isArray(pub.products) && !!pub.meta && !('coverage' in pub),
     'the public shape is untouched by any of this');
  ok(pub.products.length === full.count, 'and a warm cache hit still serves every product');
}

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);

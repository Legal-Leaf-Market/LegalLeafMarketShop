/* test-shop.mjs -- /shop's two endpoints, with no network.
 *
 * What it holds, because each is a rule the card processor or the law cares
 * about and none of them would show up as a broken page:
 *   - THC-family, cannabis-worded and smokable-hemp rows never reach /shop,
 *     and a cannabis-worded sentence is cut from a description that is kept;
 *   - vape / e-liquid / nicotine / tobacco rows are flagged 21+;
 *   - an order is refused under 21, outside Indiana, without the ID agreement,
 *     or for a product that is not in the catalogue;
 *   - the price charged is the catalogue's, never the request's;
 *   - an order nobody received is never reported as received.
 *
 *     node test-shop.mjs
 */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';

const fails = [];
const ok = (n, c, x = '') => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${x ? '   (' + x + ')' : ''}`); if (!c) fails.push(n); };

for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RESEND_API_KEY', 'LL_ORDER_WEBHOOK', 'MEDUSA_URL', 'MEDUSA_PUBLISHABLE_KEY', 'LL_DELIVERY_FEE']) delete process.env[k];

const v = (id, price, title = 'Default Title', extra = {}) => ({ id, title, price: String(price), compare_at_price: null, available: true, ...extra });
const FIXTURE = [
  { handle: 'beaker-bong-12', title: '12" Beaker Water Pipe', vendor: 'Zam Grinders', product_type: 'Water Pipes', tags: 'glass, head shop',
    body_html: '<p>Thick borosilicate glass with a high quality ice catcher.</p><p>Perfect for your favorite strain.</p>', variants: [v(1, 74.99)], images: [{ src: 'https://cdn.shopify.com/a.png' }] },
  { handle: 'lookah-seahorse', title: 'Lookah Seahorse Pro Vaporizer', vendor: 'Lookah', product_type: 'Vaporizers', tags: [],
    body_html: 'A portable vaporizer.', variants: [v(2, 59.99, 'Black'), v(3, 64.99, 'Purple')], images: [] },
  { handle: 'gob-purple-haze', title: 'Purple Haze 2 mL Disposable', vendor: 'G.O.B. Good Old Boys Cannabis', product_type: 'Disposables', tags: 'gob', body_html: '', variants: [v(4, 40)], images: [] },
  { handle: 'thca-flower', title: 'THCa Flower 3.5g', vendor: 'Herbal Leaf', product_type: 'Flower', tags: '', body_html: '', variants: [v(5, 30)], images: [] },
  { handle: 'delta8-gummies', title: 'Delta 8 Gummies', vendor: 'Someone', product_type: 'Edibles', tags: '', body_html: '', variants: [v(6, 20)], images: [] },
  { handle: 'nicotia-pouches', title: 'Nicotia Mint Pouches', vendor: 'Nicotia', product_type: 'Nicotine', tags: '', body_html: '', variants: [v(7, 6.5)], images: [] },
  { handle: 'mullein-tea', title: 'Lotus and Mullein Herbal Tea', vendor: 'Legal-Leaf', product_type: 'Tea', tags: 'herbal', body_html: '', variants: [v(8, 12)], images: [] },
  { handle: 'free-sample', title: 'Free Sticker', vendor: 'Legal-Leaf', product_type: 'Merch', tags: '', body_html: '', variants: [v(9, 0)], images: [] },
];

/* A local stand-in for the Shopify storefront. */
let hits = 0;
const shop = createServer((req, res) => {
  hits++;
  const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ products: page === 1 ? FIXTURE : [] }));
});
await new Promise((r) => shop.listen(0, '127.0.0.1', r));
process.env.SHOPIFY_STORE = `http://127.0.0.1:${shop.address().port}`;

const cat = await import('./api/catalog.js');
const ord = await import('./api/order.js');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, val) => { res.headers[k.toLowerCase()] = val; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  res.end = () => res;
  return res;
}
function fakeReq(method, body) {
  const r = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  r.method = method; r.headers = { 'content-type': 'application/json' }; r.query = {};
  return r;
}

console.log('\nCATALOGUE');
{
  const res = fakeRes();
  await cat.default(fakeReq('GET'), res);
  ok('GET /api/catalog answers 200', res.statusCode === 200, String(res.statusCode));
  const ids = (res.body.products || []).map((p) => p.id);
  ok('glass, vaporizer, pouches and tea are listed', ['beaker-bong-12', 'lookah-seahorse', 'nicotia-pouches', 'mullein-tea'].every((i) => ids.includes(i)), ids.join(','));
  ok('the G.O.B. THC disposable is not', !ids.includes('gob-purple-haze'));
  ok('THCa flower is not', !ids.includes('thca-flower'));
  ok('delta-8 is not', !ids.includes('delta8-gummies'));
  ok('a $0 row is not', !ids.includes('free-sample'));
  ok('meta counts what was hidden', res.body.meta.hidden === 4 && res.body.meta.source === 'shopify', JSON.stringify(res.body.meta));
  const by = Object.fromEntries(res.body.products.map((p) => [p.id, p]));
  ok('the vaporizer is flagged 21+', by['lookah-seahorse'].ageRestricted === true);
  ok('nicotine pouches are flagged 21+', by['nicotia-pouches'].ageRestricted === true);
  ok('the water pipe and the tea are not', !by['beaker-bong-12'].ageRestricted && !by['mullein-tea'].ageRestricted);
  ok('a strain sentence is cut, the rest of the description kept',
    /borosilicate/.test(by['beaker-bong-12'].description) && !/strain/i.test(by['beaker-bong-12'].description), by['beaker-bong-12'].description);
  ok('"high quality" does not trip the sentence filter', /high quality/.test(by['beaker-bong-12'].description));
  ok('a product with options carries both, priced from the lowest', by['lookah-seahorse'].variants.length === 2 && by['lookah-seahorse'].price === 59.99 && by['lookah-seahorse'].priceMax === 64.99);
  ok('it is cacheable at the CDN', /s-maxage/.test(res.headers['cache-control'] || ''));
  const before = hits;
  await cat.default(fakeReq('GET'), fakeRes());
  ok('a second request inside 15 minutes reads the cache, not the store', hits === before);
}

console.log('\nORDER RULES');
const { products } = await cat.loadCatalog();
const NOW = new Date('2026-11-25T12:00:00Z');
const good = () => ({
  items: [{ id: 'lookah-seahorse', variant: '3', qty: 2, price: 0.01 }, { id: 'beaker-bong-12', qty: 1 }],
  customer: { name: 'Pat Adult', email: 'pat@example.com', phone: '(812) 555-0100', dob: '1990-05-01' },
  address: { line1: '100 Washington St', city: 'Columbus', state: 'IN', zip: '47201' },
  agree: true,
});
const fieldsOf = (r) => r.errors.map((e) => e.field).sort().join(',');
{
  const r = ord.buildOrder(good(), products, NOW);
  ok('a complete Indiana order from an adult passes', r.errors.length === 0, fieldsOf(r));
  ok('the price is the catalogue\'s, not the request\'s', r.order.lines[0].price === 64.99 && r.order.lines[0].total === 129.98, JSON.stringify(r.order.lines[0]));
  ok('a single-option product needs no variant id', r.order.lines[1].price === 74.99);
  ok('subtotal, 7% tax and total add up', r.order.subtotal === 204.97 && r.order.tax === 14.35 && r.order.total === 219.32, `${r.order.subtotal} ${r.order.tax} ${r.order.total}`);
  ok('the order is marked as containing a 21+ item', r.order.ageRestricted === true);
  ok('payment is at delivery', r.order.payment === 'at_delivery');
  ok('an order number is issued', /^LL-\d{6}-[A-Z0-9]{4}$/.test(r.order.number), r.order.number);
}
{
  const b = good(); b.customer.dob = '2006-01-01';
  ok('a 20-year-old is refused', fieldsOf(ord.buildOrder(b, products, NOW)) === 'dob');
  b.customer.dob = '2005-11-26';
  ok('...including one whose 21st birthday is tomorrow', fieldsOf(ord.buildOrder(b, products, NOW)) === 'dob');
  b.customer.dob = '2005-11-25';
  ok('...and someone who turns 21 today is not', ord.buildOrder(b, products, NOW).errors.length === 0);
  b.customer.dob = '';
  ok('no date of birth is refused', fieldsOf(ord.buildOrder(b, products, NOW)) === 'dob');
}
{
  const b = good(); b.address.state = 'OH'; b.address.zip = '45201';
  ok('an Ohio address is refused', fieldsOf(ord.buildOrder(b, products, NOW)) === 'zip');
  const c = good(); c.address.zip = '45201';
  ok('an Indiana state with a non-Indiana ZIP is refused', fieldsOf(ord.buildOrder(c, products, NOW)) === 'zip');
  ok('Indiana ZIPs 46001 and 47997 pass, 48001 does not', ord.isIndianaZip('46001') && ord.isIndianaZip('47997') && !ord.isIndianaZip('48001'));
}
{
  const b = good(); b.agree = false;
  ok('the ID agreement is required', fieldsOf(ord.buildOrder(b, products, NOW)) === 'agree');
  const c = good(); c.items = [{ id: 'gob-purple-haze', qty: 1 }];
  ok('a product that is not in the catalogue cannot be ordered', fieldsOf(ord.buildOrder(c, products, NOW)) === 'items');
  const d = good(); d.items = [{ id: 'lookah-seahorse', qty: 1 }];
  ok('a multi-option product needs its option', fieldsOf(ord.buildOrder(d, products, NOW)) === 'items');
  const e = good(); e.items = [{ id: 'beaker-bong-12', qty: 999 }];
  ok('quantity is capped at 20', ord.buildOrder(e, products, NOW).order.lines[0].qty === 20);
  const f = good(); f.items = [];
  ok('an empty cart is refused', fieldsOf(ord.buildOrder(f, products, NOW)) === 'items');
}

console.log('\nORDER DELIVERY');
{
  const res = fakeRes();
  await ord.default(fakeReq('POST', good()), res);
  ok('with nothing configured, an order is NOT reported as received', res.statusCode === 503 && res.body.ok === false && res.body.fallback === 'email', String(res.statusCode));
  ok('...and the page is handed the text to email instead', /Lookah Seahorse Pro Vaporizer/.test(res.body.text || '') && /ID/.test(res.body.text || ''));
}
{
  let got = null;
  const hook = createServer((req, res) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => { got = JSON.parse(d); res.end('ok'); }); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  process.env.LL_ORDER_WEBHOOK = `http://127.0.0.1:${hook.address().port}/exec`;
  const res = fakeRes();
  await ord.default(fakeReq('POST', good()), res);
  ok('with a webhook, the order is accepted', res.statusCode === 200 && res.body.ok === true, String(res.statusCode));
  ok('...the webhook receives it, priced from the catalogue', got && got.type === 'order' && got.total === 219.32 && got.customer.age === 36, got && String(got.total));
  ok('...and the answer carries the number and total', /^LL-/.test(res.body.order.number) && res.body.order.total === 219.32);
  const bad = fakeRes();
  const b = good(); b.customer.dob = '2010-01-01';
  await ord.default(fakeReq('POST', b), bad);
  ok('an under-21 order through the handler is a 400 naming the field', bad.statusCode === 400 && bad.body.errors[0].field === 'dob');
  const get = fakeRes();
  await ord.default(fakeReq('GET'), get);
  ok('GET is refused', get.statusCode === 405);
  delete process.env.LL_ORDER_WEBHOOK;
  hook.close();
}

shop.close();
if (fails.length) { console.log(`\nFAILED: ${fails.join(' | ')}`); process.exit(1); }
console.log('\nAll shop checks passed.');

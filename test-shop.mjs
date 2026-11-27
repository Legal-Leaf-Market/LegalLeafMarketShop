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
process.env.LL_CATALOG_SOURCE = "shopify"; // the fixture, not api/_catalog-data.json

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
  ok('a G.O.B. row from an import is not', !ids.includes('gob-purple-haze'));
  const gob = (res.body.products || []).filter((p) => p.tags.includes('gob'));
  ok('...but our own three G.O.B. 2 mL disposables are (api/_house.js)', gob.length === 3 && ['lemon-cherry-gelato', 'purple-haze', 'strawberry-pie'].every((k) => ids.includes(`gob-${k}-2ml`)), gob.map((p) => p.id).join(','));
  ok('...at $30, any 2 for $50, tax included, 21+', gob.every((p) => p.price === 30 && p.pack.qty === 2 && p.pack.price === 50 && p.taxIncluded && p.ageRestricted));
  ok('...and lead the catalogue, so Featured shows them first', ids.slice(0, 3).every((i) => /^gob-/.test(i)), ids.slice(0, 3).join(','));
  ok('...with their own photos', gob.every((p) => /^\/img\/gob\/.+-packshot\.jpg$/.test(p.image) && p.images.length === 4));
  ok('THCa flower is not', !ids.includes('thca-flower'));
  ok('delta-8 is not', !ids.includes('delta8-gummies'));
  ok('a $0 row is not', !ids.includes('free-sample'));
  ok('meta counts what was hidden', res.body.meta.hidden === 4 && res.body.meta.house === 3 && res.body.meta.source === 'shopify', JSON.stringify(res.body.meta));
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

console.log('\nG.O.B. PRICING (1 for $30, 2 for $50, tax included)');
{
  const lcg = { id: 'gob-lemon-cherry-gelato-2ml' }, ph = { id: 'gob-purple-haze-2ml' }, sp = { id: 'gob-strawberry-pie-2ml' };
  const at = (items) => { const b = good(); b.items = items; return ord.buildOrder(b, products, NOW); };
  let r = at([{ ...lcg, qty: 1 }]);
  ok('one is $30 at the door, nothing added', r.errors.length === 0 && r.order.total === 30 && r.order.subtotal === 28.04, JSON.stringify([r.errors, r.order && r.order.total]));
  ok('...and $1.96 of it is the 7% tax, for the books', r.order.tax === 1.96 && r.order.taxIncluded === 1.96, String(r.order.tax));
  ok('...and it is a 21+ order', r.order.ageRestricted === true);
  r = at([{ ...lcg, qty: 1 }, { ...ph, qty: 1 }]);
  ok('two different flavours are $50', r.order.total === 50 && r.order.discount === 10 && r.order.packs === 1, `${r.order.total} ${r.order.discount}`);
  ok('...with $3.27 tax inside it', r.order.tax === 3.27, String(r.order.tax));
  r = at([{ ...sp, qty: 2 }]);
  ok('two of one flavour are $50 too', r.order.total === 50);
  r = at([{ ...lcg, qty: 1 }, { ...ph, qty: 1 }, { ...sp, qty: 1 }]);
  ok('three are $80 (a pair and a single)', r.order.total === 80 && r.order.tax === 5.23, `${r.order.total} ${r.order.tax}`);
  r = at([{ ...lcg, qty: 4 }]);
  ok('four are $100', r.order.total === 100);
  r = at([{ ...lcg, qty: 2 }, { id: 'beaker-bong-12', qty: 1 }]);
  ok('a pair with a pipe: $50 tax-in plus $74.99 with 7% added', r.order.total === 130.24 && r.order.tax === 8.52, `${r.order.total} ${r.order.tax}`);
  ok('the order text names the pack and the included tax', /Pack price \(1 set\)\s+-\$10\.00/.test(ord.orderText(r.order)) && /\$3\.27 of it already in the price/.test(ord.orderText(r.order)));
  ok('subtotal + delivery + tax is the cash taken, so the Sheet\'s Sales and Tax columns file correctly', [at([{ ...lcg, qty: 3 }]).order, r.order].every((o) => Math.abs(o.subtotal + o.delivery + o.tax - o.total) < 0.005));
  ok('priceLines with no pack or included tax is the old arithmetic', ord.priceLines([{ price: 10, qty: 1, total: 10 }], 0).total === 10.7);
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
  let answer = '{"ok":true}';
  const hook = createServer((req, res) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => { got = JSON.parse(d); res.end(answer); }); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  process.env.LL_ORDER_WEBHOOK = `http://127.0.0.1:${hook.address().port}/exec`;
  const res = fakeRes();
  await ord.default(fakeReq('POST', good()), res);
  ok('with a webhook, the order is accepted', res.statusCode === 200 && res.body.ok === true, String(res.statusCode));
  ok('...the webhook receives it, priced from the catalogue', got && got.type === 'order' && got.total === 219.32 && got.customer.age === 36, got && String(got.total));
  ok('...and the answer carries the number and total', /^LL-/.test(res.body.order.number) && res.body.order.total === 219.32);
  /* Apps Script answers 200 even when the script throws, with an HTML page or
     with the script's own {ok:false}. Neither is a received order. */
  for (const [label, body] of [['an HTML error page', '<html><body>TypeError: Cannot read properties</body></html>'], ['{ok:false}', '{"ok":false,"error":"boom"}'], ['a bare "ok"', 'ok']]) {
    answer = body;
    const r2 = fakeRes();
    await ord.default(fakeReq('POST', good()), r2);
    ok(`a webhook answering 200 with ${label} is NOT a received order`, r2.statusCode === 503 && r2.body.fallback === 'email', String(r2.statusCode));
  }
  answer = '{"ok":true}';
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

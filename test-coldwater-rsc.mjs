/* The Next.js App Router reader, and the store it was blocking.
 *
 * THE BUG THIS PINS. fromGeneric() looked for __NEXT_DATA__ and for
 * <script type="application/json"> tags. The App Router ships NEITHER: it
 * streams its payload as a run of self.__next_f.push([1,"<chunk>"]) calls,
 * with the JSON escaped inside JS string literals. So The Dude Abides -- a
 * page that server-renders its whole menu and hands 960,541 bytes to a plain
 * server GET -- came back as:
 *
 *     no parseable JSON in 960541 bytes (page may render client-side)
 *
 * The bytes were there. The diagnosis was wrong, and a wrong diagnosis is
 * worse than a failure here, because it sends you to look at browser
 * automation for a page that never needed it.
 *
 * THE FIXTURE IS SHAPED TO BREAK THE OBVIOUS IMPLEMENTATION. The flight stream
 * reads as "<id>:<json>" rows, so splitting the concatenated buffer on \n is
 * the tempting parse -- and it is wrong, because a chunk boundary lands
 * wherever the server flushed, including in the middle of a string value that
 * itself contains \n and ][ and {} characters. This fixture puts all three in
 * the data on purpose:
 *
 *   - a product split across two pushes, mid-string
 *   - a description containing a literal newline and unbalanced-looking
 *     brackets ("]" and "{")
 *   - a decoy array before the real one, so "first array found" fails
 *
 * Run: node test-coldwater-rsc.mjs
 */
import { rscRoots, remixRoots, balancedEnd } from './api/coldwater.js';

let fails = 0;
const ok = (c, m, x = '') => { console.log((c ? '  ok   ' : '  FAIL ') + m + (x ? '   (' + x + ')' : '')); if (!c) fails++; };

/* ---------------------------------------------------------------- fixture --- */

const PRODUCTS = [
  { id: 'p1', name: 'Blue Dream', brand: 'Local Roots', category: 'Flower', strain: 'Sativa',
    percentTHC: 22.4,
    /* The nasty one: a newline, a close bracket and an open brace inside a
       string value. A line-splitting parser cuts this product in half; a
       bracket counter that is not string-aware ends the array early. */
    description: 'Sweet berry.\nGreat for daytime [see menu] {ask budtender}',
    variants: [
      { option: '3.5g', price: 35 },
      { option: '7g', price: 65 },
      { option: '28g', price: 220 },
    ] },
  { id: 'p2', name: 'GMO Cookies', brand: 'Local Roots', category: 'Flower', strain: 'Indica',
    percentTHC: 27.1, description: 'Savory.', variants: [{ option: '3.5g', price: 40 }] },
  { id: 'p3', name: 'Wedding Cake', brand: 'North Star', category: 'Flower', strain: 'Hybrid',
    percentTHC: 24.0, description: 'Vanilla.', variants: [{ option: '1g', price: 12 }, { option: '28g', price: 180 }] },
];

/* A decoy that appears FIRST in the stream and is product-shaped enough to be
   tempting, but shorter. The reader keeps every root and lets the existing
   "largest array of name+price objects" rule choose, so this must not win. */
const DECOY = [{ name: 'Rolling papers', price: 2 }];

/* Build the flight stream the way Next does: "<id>:<json>" rows, newline
   separated, then chopped into chunks at positions that ignore those rows. */
const stream =
  '1:HL["/_next/static/css/app.css","style"]\n' +
  '2:' + JSON.stringify(DECOY) + '\n' +
  '3:I[4707,[],""]\n' +
  '4:' + JSON.stringify(PRODUCTS) + '\n' +
  '5:{"buildId":"abc123"}\n';

/* Chop at a point that lands inside the Blue Dream description string. */
const cut = stream.indexOf('Great for daytime') + 6;
const chunks = [stream.slice(0, 240), stream.slice(240, cut), stream.slice(cut)];
ok(chunks.length === 3 && chunks.every(c => c.length), 'fixture chopped into 3 chunks');
ok(chunks.join('') === stream, 'chunks reassemble to the original stream');

const PAGE =
  '<!doctype html><html><head><title>Menu</title></head><body>' +
  '<div id="__next">menu renders here</div>' +
  chunks.map(c => '<script>self.__next_f.push([1,' + JSON.stringify(c) + '])</script>').join('') +
  '</body></html>';

console.log('\nNext.js App Router (RSC) payload reader\n');
ok(!/__NEXT_DATA__/.test(PAGE), 'fixture has no __NEXT_DATA__, like the real page');
ok(!/type="application\/json"/.test(PAGE), 'fixture has no JSON script tag, like the real page');

/* ------------------------------------------------------------ balancedEnd --- */

ok(balancedEnd('[{"a":1}]', 0) === 9, 'balancedEnd closes a simple array');
ok(balancedEnd('[{"a":"]}"}]', 0) === 12, 'brackets inside a string do not close the value',
   String(balancedEnd('[{"a":"]}"}]', 0)));
ok(balancedEnd('[{"a":"\\""}]', 0) === 12, 'an escaped quote does not end the string',
   String(balancedEnd('[{"a":"\\""}]', 0)));
ok(balancedEnd('[{"a":1}', 0) === -1, 'an unterminated value reports -1');

/* --------------------------------------------------------------- roots ------ */

const roots = rscRoots(PAGE);
ok(roots.length >= 2, 'recovered more than one array root', `${roots.length} roots`);

const big = roots.reduce((a, b) => (b.length > a.length ? b : a), []);
ok(big.length === 3, 'the product array survived the chunk boundary', `${big.length} products`);
ok(big.map(p => p.name).join('|') === 'Blue Dream|GMO Cookies|Wedding Cake',
   'every product came back, in order', big.map(p => p.name).join('|'));

const bd = big.find(p => p.name === 'Blue Dream');
ok(!!bd && bd.variants.length === 3, 'variants survived', bd ? String(bd.variants.length) : 'missing');
ok(!!bd && bd.variants[2].price === 220, 'the ounce price is intact', bd ? String(bd.variants[2].price) : '');
ok(!!bd && /\n/.test(bd.description) && /\[see menu\]/.test(bd.description),
   'the newline and brackets inside the description round-tripped', bd ? JSON.stringify(bd.description) : '');

ok(roots.some(r => r.length === 1 && r[0].name === 'Rolling papers'), 'the decoy was read too, not skipped');
ok(big !== roots[0] || roots[0].length === 3, 'the decoy did not win on being first');

/* ------------------------------------------------------------- negatives ---- */

ok(rscRoots('<html><body>nothing here</body></html>').length === 0, 'a page with no pushes yields no roots');
ok(rscRoots('<script>self.__next_f.push([1,"2:not json\\n"])</script>').length === 0,
   'a push carrying no array yields no roots');

/* A page whose pushes are present but truncated mid-value must not hang or
   throw -- a serverless timeout here reads as the store being down. */
const truncated = '<script>self.__next_f.push([1,' + JSON.stringify('4:' + JSON.stringify(PRODUCTS).slice(0, 200)) + '])</script>';
const t0 = Date.now();
const tr = rscRoots(truncated);
ok(Date.now() - t0 < 1000, 'a truncated stream returns fast', `${Date.now() - t0}ms`);
ok(tr.length === 0, 'a truncated stream yields no roots rather than a partial product');

/* =====================================================================
   REMIX, WHICH SHIPS THE SAME IDEA THROUGH A DIFFERENT DOOR
   =====================================================================

   THE DUDE ABIDES PUBLISHED ITS PRICE TIER TABLE AS NINE PRODUCTS -- Ounce,
   Half, Quarter, Eighth, Grams -- with no images, no descriptions, no THC and
   no categories, on a public city page, for weeks.

   Three things had to be ruled out before the cause was found, and each looked
   guilty: the catalogue scorer (it was picking the richest array it was
   offered), gIsProduct (it already accepts a price living in the variants), and
   the walk depth. None of them. The reader never SAW the menu.

   A Remix route that defers its slow loader -- which a dispensary menu always
   is -- server-renders only the cheap data into `__remixContext = {...}` and
   streams the rest as `__remixContext.streamController.enqueue("<escaped>")`.
   remixRoots() stepped over those string arguments, because it was written to
   walk PAST a leading string to find a JSON argument after it. That is right
   for the calls whose payload is a later argument and blind for the ones where
   the payload IS the string.

   TWO FAULTS, AND EITHER ALONE KEEPS THE MENU INVISIBLE:
     1. the string arguments were skipped rather than unescaped;
     2. the pattern matched only `__remixContext.foo(`, so it never even fired
        on `__remixContext.streamController.enqueue(` -- a dotted path.

   The fixture reproduces the live shape: a tier table in the synchronous
   global, the real menu deferred and SPLIT MID-JSON across two calls, so
   neither chunk parses alone. */

const TIERS = [{ name: 'Ounce (28g)', weight: 28, price: 7500 },
               { name: 'Half (14g)', weight: 14, price: 4000 }];
const MENU = [
  { name: 'Blue Dream 3.5g', brand: 'Local Co', category: 'Flower', image: 'a.jpg',
    variants: [{ name: '3.5g', price: 3500 }] },
  { name: 'Gelato 3.5g', brand: 'Local Co', category: 'Flower', image: 'b.jpg',
    variants: [{ name: '3.5g', price: 4000 }] },
];
const deferred = JSON.stringify({ loaderData: { menu: { products: MENU } } });
const half = Math.floor(deferred.length / 2);
const rPage =
  '<!DOCTYPE html><html><body>' +
  '<script>window.__remixContext = ' + JSON.stringify({ state: { loaderData: { tiers: TIERS } } }) + ';</script>' +
  '<script>__remixContext.streamController.enqueue(' + JSON.stringify(deferred.slice(0, half)) + ');</script>' +
  '<script>__remixContext.streamController.enqueue(' + JSON.stringify(deferred.slice(half)) + ');</script>' +
  '</body></html>';

ok(deferred.slice(0, half).lastIndexOf('{') > deferred.slice(0, half).lastIndexOf('}'),
   'the fixture really is split mid-object, so neither chunk parses alone');

const rRoots = remixRoots(rPage);
const rJson = JSON.stringify(rRoots);
ok(rJson.includes('Ounce (28g)'), 'the synchronous tier table is still read');
ok(rJson.includes('Blue Dream 3.5g'), 'AND THE DEFERRED MENU IS READ -- this is the bug');
ok(rJson.includes('Gelato 3.5g'), '...all of it, not just the first chunk');

/* THE COUNTER-CASE. A call whose payload is a JSON argument AFTER a string was
   the shape remixRoots was originally written for, and it must keep working --
   a fix that trades one Remix shape for another is not a fix. */
ok(JSON.stringify(remixRoots('<script>__remixContext.f("x",{"a":[{"name":"Legacy","price":5}]});</script>'))
     .includes('Legacy'),
   'a JSON argument after a string still parses, as it always did');

/* REACT ROUTER 7 IS REMIX UNDER A NEW NAME and ships the identical payload as
   `__reactRouterContext`. Measured on the live store: markers reported
   remixCtx AND a react-router marker, all three roots came from the remix
   reader, and the menu was still missing -- a reader one word out of date reads
   like a shop with a tiny menu. Both names, same fixture, same assertions. */
const rr = rPage.replace(/__remixContext/g, '__reactRouterContext');
const rrJson = JSON.stringify(remixRoots(rr));
ok(rrJson.includes('Ounce (28g)'), 'react-router: the synchronous half is read');
ok(rrJson.includes('Blue Dream 3.5g') && rrJson.includes('Gelato 3.5g'),
   'react-router: AND the deferred menu, under the new global name');

/* And the dotted path must not have broken the single-segment one. */
ok(JSON.stringify(remixRoots('<script>__remixContext.g({"a":[{"name":"OneLevel","price":1}]});</script>'))
     .includes('OneLevel'),
   'a single-segment call still fires');

/* Negatives: a page with neither shape, and a truncated stream, must return
   fast and empty rather than hanging a serverless invocation. */
ok(remixRoots('<html><body>nothing</body></html>').length === 0, 'no remix payload yields no roots');
const rt0 = Date.now();
const rTrunc = remixRoots('<script>__remixContext.streamController.enqueue(' +
  JSON.stringify(deferred.slice(0, 120)) + ');</script>');
ok(Date.now() - rt0 < 1000, 'a truncated remix stream returns fast', `${Date.now() - rt0}ms`);
ok(!JSON.stringify(rTrunc).includes('Gelato'), 'a truncated remix stream yields no partial product');

/* =====================================================================
   A PRICE LIST IS NOT A MENU
   =====================================================================

   The reader is only ever offered what a page contains, and The Dude Abides
   contains a weight table and no machine-readable menu -- measured: no
   __NEXT_DATA__, no JSON script tags, no RSC chunks, no streaming at all
   (streamController 0, .enqueue( 0), reactRouterCtx false), three
   __remixContext roots holding 33 objects of which every one is a tier. Its
   real menu is in 957KB of server-rendered markup.

   Publishing that produced `Ounce / Half / Quarter / Eighth / Grams` as nine
   products on a public city page for weeks. A shop that ERRORS gets looked at;
   a shop quietly serving its price list looks like a working scrape of a
   nine-product dispensary.

   The refusal tests catalogue SIGNAL rather than the words. Matching "Ounce"
   would be a guess about one shop's vocabulary and would refuse a real listing
   called "Ounce of Gelato". */
{
  const TIER_PAGE =
    '<script>window.__remixContext = ' +
    JSON.stringify({ state: { loaderData: { sizes: [
      { name: 'Ounce (28g)', weight: 28, price: 7500 },
      { name: 'Half (14g)', weight: 14, price: 4000 },
      { name: 'Quarter (7g)', weight: 7, price: 2200 },
      { name: 'Eighth (3.5g)', weight: 3.5, price: 1200 },
    ] } } }) + ';</script>';
  const tierRoots = remixRoots(TIER_PAGE);
  ok(JSON.stringify(tierRoots).includes('Ounce (28g)'),
     'the tier table is still PARSED -- the refusal is downstream of the reader');

  /* The gate itself is exercised through the real handler in
     test-coldwater.mjs; here we pin the property it turns on, so a future
     change to CATALOGUE_KEYS cannot silently make a tier table look rich. */
  const tiers = [{ name: 'Ounce (28g)', weight: 28, price: 7500 },
                 { name: 'Half (14g)', weight: 14, price: 4000 }];
  const menu = [{ name: 'Blue Dream', brand: 'L', category: 'Flower', image: 'a.jpg', price: 3500 },
                { name: 'Gelato', brand: 'L', category: 'Flower', image: 'b.jpg', price: 4000 }];
  const score = a => { let n = 0;
    const KEYS = ['brand','category','product_name','productName','variant_name','variantName',
                  'sku','image','image_url','imageUrl','thumbnail','strain','description','slug'];
    for (const o of a) for (const k of KEYS) if (o && o[k] != null && o[k] !== '') n++;
    return n / a.length; };
  ok(score(tiers) === 0, 'a tier row carries no catalogue signal at all', String(score(tiers)));
  ok(score(menu) >= 0.25, 'a real listing carries plenty', String(score(menu)));
  /* THE COUNTER-CASE THAT KEEPS THE BAR HONEST: a thin but genuine menu, with
     only a category, must stay above the line. A gate that refuses real shops
     to catch one fake one is a worse bug than the one it fixes. */
  const thin = [{ name: 'House Flower', category: 'Flower', price: 2000 },
                { name: 'House Shake', category: 'Flower', price: 900 }];
  ok(score(thin) >= 0.25, 'a thin but real menu still clears the bar', String(score(thin)));
}

console.log('\n' + (fails ? `FAILED (${fails})` : 'All assertions passed.') + '\n');
process.exit(fails ? 1 : 0);

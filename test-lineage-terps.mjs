// test-lineage-terps.mjs -- pins parseLineage() in api/products.js and the measured-terpene path
// through api/concierge.js. `node test-lineage-terps.mjs [--feed ./feed.json]`.
//
// TWO THINGS ARE PINNED HERE AND THEY ARE DIFFERENT KINDS OF CLAIM.
//
// 1. LINEAGE is what the vendor SAYS the parents are, lifted verbatim from the description the
//    scraper already fetches. It is a fact about the listing, checkable against their own page. It
//    must never become a chemistry claim: a cross is not its parents' average, because breeders
//    select phenotypes precisely for what the parents lacked.
//
// 2. MEASURED TERPENES exist on a small number of listings and BUDTENDER_PLAN.md said they did not.
//    Its exact words were "cannabinoid-only. No terpene panel on any of them" and "no terpene data at
//    all". That was wrong: Black Tie's FESA full-panel PDFs carry them, 37 records in
//    api/coa-blacktie.js already hold them, and because attachLab() assigns the whole record they
//    have been riding /api/products unused. This file asserts they survive into the concierge's
//    projection, so the claim cannot quietly regress to "we have none" a third time.
//
// The regexes and functions are lifted out of source rather than restated, same reasoning as
// lume-overlap.mjs reading LAB_NOISE: a second copy drifts from the one that runs.

import { readFile } from 'node:fs/promises';
import { _internals } from './api/concierge.js';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${extra ? `\n       ${extra}` : ''}`); }
}
function eq(a, b, label) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, label, same ? '' : `expected ${JSON.stringify(b)}\n       got      ${JSON.stringify(a)}`);
}

const src = await readFile(new URL('./api/products.js', import.meta.url), 'utf8');
function lift(name, kind) {
  const re = kind === 'const'
    ? new RegExp('^const ' + name + ' = .+?;$', 'm')
    : new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}$', 'm');
  const m = src.match(re);
  if (!m) throw new Error(`could not lift ${name} from api/products.js -- fix this test to find the `
    + 'new declaration rather than copying the code in.');
  return m[0];
}
const { parseLineage } = new Function([
  lift('plainDesc', 'fn'), lift('LINEAGE_LABELLED', 'const'), lift('LINEAGE_PROSE', 'const'),
  lift('LINEAGE_SPLIT', 'const'), lift('NOT_A_PARENT', 'const'), lift('BLOCK_BREAK', 'const'),
  lift('parseLineage', 'fn'),
  'return { parseLineage };'
].join('\n'))();

const parents = (html) => { const r = parseLineage(html); return r ? r.parents : null; };

// The census that ?debug&slim publishes. enrichCoverage is not exported, so it is still lifted -- but
// anyInStock now IS exported (one stock test for the whole codebase, after the concierge was caught
// asking a weaker one), so it is IMPORTED and injected rather than lifted. That means the census is
// measured against the same function the grid, the store counts and the concierge use, not a copy of
// its source text that could pass while the real one changed.
const { anyInStock } = await import('./api/products.js');
const { enrichCoverage } = new Function('anyInStock', [
  lift('LAB_NOISE', 'const'), lift('labStrainKey', 'fn'),
  lift('enrichCoverage', 'fn'), 'return { enrichCoverage };'
].join('\n'))(anyInStock);

console.log('\n== the forms vendors actually write ==');
{
  eq(parents('<p>Lineage: Biscotti x Jealousy</p>'), ['Biscotti', 'Jealousy'], 'Lineage: A x B');
  eq(parents('<p>Genetics: Sunset Sherbert × Thin Mint GSC</p>'), ['Sunset Sherbert', 'Thin Mint GSC'],
    'Genetics: A × B, with the multiplication sign');
  eq(parents('Parents: Chemdawg and Sour Diesel.'), ['Chemdawg', 'Sour Diesel'], 'Parents: A and B');
  eq(parents('<div>A cross of Gelato 41 and Zkittlez.</div>'), ['Gelato 41', 'Zkittlez'], 'a cross of A and B');
  eq(parents('This is a cross between Wedding Cake x Jealousy.'), ['Wedding Cake', 'Jealousy'], 'a cross between A x B');
  eq(parents('<p>Genetics: Runtz x Gelato x Biscotti</p>'), ['Runtz', 'Gelato', 'Biscotti'], 'three parents');
  eq(parents('<p>GENETICS - Blue Dream X OG Kush</p>'), ['Blue Dream', 'OG Kush'], 'a dash label and a capital X');
  eq(parents('<p>Genetics: Sunset Sherbert × Thin Mint GSC. Grown indoors in Oregon.</p>'),
    ['Sunset Sherbert', 'Thin Mint GSC'], 'and it stops at the end of the sentence');
}

console.log('\n== a paragraph end is a hard boundary ==');
{
  // Found by the census printing its examples, not by this file: a vendor whose genetics line has no
  // full stop leaked the NEXT paragraph into the second parent, and at exactly 40 characters it slid
  // under the length guard. Putting the genetics on its own line is the common case, so this is the
  // shape that matters most, not an edge one.
  eq(parents('<p>Genetics: Sunset Sherbert x Thin Mint GSC</p> Hand trimmed indoor flower.'),
    ['Sunset Sherbert', 'Thin Mint GSC'], 'a </p> with no full stop still ends the clause');
  eq(parents('Genetics: Biscotti x Jealousy<br>Grown indoors under LED.'),
    ['Biscotti', 'Jealousy'], 'so does a <br>');
  eq(parents('<li>Lineage: Runtz x Gelato</li><li>Grown outdoors in Oregon</li>'),
    ['Runtz', 'Gelato'], 'and a list item');
  eq(parents('<div>Genetics: Blue Dream x OG Kush</div><div>Small batch harvest</div>'),
    ['Blue Dream', 'OG Kush'], 'and a </div>');
  eq(parents('<h3>Genetics: Wedding Cake x Jealousy</h3><p>Hand trimmed</p>'),
    ['Wedding Cake', 'Jealousy'], 'and a heading');
  // The boundary must not become a separator: two parents split across a break are not a cross we
  // can read, and a miss is the cheap failure.
  eq(parents('<p>Genetics: Blue Dream</p><p>x OG Kush</p>'), null,
    'a cross split across two paragraphs is a miss, not a guess');
}

console.log('\n== what it refuses, which is the point ==');
{
  // Product copy is full of quantities. Inventing a lineage is worse than missing one, so every
  // ambiguous shape returns null.
  eq(parents('<p>Premium indoor THCa flower. 10 grams (2 x 5 gram bags) available now.</p>'), null,
    'a quantity "2 x 5 gram bags" is not a cross');
  eq(parents('<p>(3x) 1 Gram pre-rolls</p>'), null, 'and neither is a pack count');
  eq(parents('<p>Lineage: 28 grams x 2</p>'), null, 'nor a labelled quantity');
  eq(parents('<p>Blue Dream x OG Kush</p>'), null,
    'a BARE "A x B" with no label is refused -- too easily a measurement or a size');
  eq(parents('<p>Blue Dream x</p>'), null, 'one parent is not a cross');
  eq(parents('<p>Lineage: unknown</p>'), null, 'and neither is a single word');
  eq(parents('<p>Great flower, top shelf!</p>'), null, 'no lineage means null');
  eq(parents(''), null, 'empty');
  eq(parents(null), null, 'null');
  eq(parents(undefined), null, 'undefined');
  // The comma decision, which cost real hits on purpose.
  eq(parents('<div>A cross of Gelato 41 and Zkittlez, grown indoors.</div>'), ['Gelato 41', 'Zkittlez'],
    'a trailing clause after a comma does not become a third parent');
  eq(parents('<p>Genetics: Gelato 41, Zkittlez</p>'), null,
    'and a comma-separated list is a deliberate MISS rather than a guess');
}

console.log('\n== the claim travels with its provenance ==');
{
  const r = parseLineage('<p>Genetics: Biscotti x Jealousy. Indoor.</p>');
  eq(r.source, 'vendor-description', 'the source is named on the record');
  eq(r.stated, 'Biscotti x Jealousy', 'and the verbatim clause is kept so a reader can check it');
  ok(r.stated.length <= 90, 'bounded, so a pathological description cannot bloat the feed');
  // No profile, no effects, no terpenes. If this object ever grows one of those fields, the rail in
  // api/concierge.js is no longer true and this assertion is the tripwire.
  eq(Object.keys(r).sort(), ['parents', 'source', 'stated'], 'and it carries NOTHING inferred');
}

console.log('\n== measured terpenes survive into the concierge projection ==');
{
  // Shaped exactly like a real Black Tie row: attachLab() assigns the whole coa-blacktie record, so
  // terps/totalTerps/safety arrive on p.lab without any code asking for them.
  const p = {
    id: 'blacktiecbd__purple-urkle', name: 'PURPLE URKLE (EXOTIC) THCA FLOWER', store: 'Black Tie CBD',
    storeKey: 'blacktiecbd', category: 'THCa Flower', type: 'Indica', potency: 26.4, perG: 1.11,
    startsAt: 31.1, ship: 0, inStock: true, url: 'https://example.com/p', sizes: [],
    lineage: { parents: ['Purple Urkle', 'Granddaddy Purple'], stated: 'Purple Urkle x Granddaddy Purple', source: 'vendor-description' },
    lab: {
      lab: 'FESA Labs', sample: 'PURPLE URKLE', tested: '2026-05-26', thca: 30.1, totalThc: 26.4,
      cbd: 0, trust: 90, flags: [], coa: 'https://example.com/coa.pdf',
      terps: [['ß-Myrcene', 0.58], ['α-Humulene', 0.5], ['Nerolidol', 0.44], ['δ-Limonene', 0.3]],
      totalTerps: 2.17,
      safety: { foreign: 'Pass', metals: 'Pass' }
    }
  };
  const d = _internals.detail(p);
  ok(Array.isArray(d.lab.terpenes), 'get_product exposes lab.terpenes');
  eq(d.lab.terpenes.length, 4, 'with every analyte');
  eq(d.lab.terpenes[0], { name: 'ß-Myrcene', pct: 0.58 }, 'as {name, pct} rather than a bare tuple');
  eq(d.lab.totalTerpenes, 2.17, 'and the panel total');
  eq(d.lab.safety.metals, 'Pass', 'the safety panel comes through too -- also unused until now');
  eq(d.lab.thcaAdvertised, 30.1, 'alongside the advertised THCa');
  eq(d.lab.totalThcMeasured, 26.4, 'and the measured Total THC');
  eq(d.lineage.parents, ['Purple Urkle', 'Granddaddy Purple'], 'and the vendor lineage');
  eq(d.lineage.source, 'vendor-description', 'with its provenance intact');

  // The row projection must NOT carry the panel -- it would cost tokens on every search hit -- but
  // must say one exists, or the model has no reason to call get_product.
  const r = _internals.row(p);
  eq(r.hasTerpenePanel, true, 'search rows flag that a panel exists');
  eq(r.hasLineage, true, 'and that lineage exists');
  ok(!('terpenes' in r) && !r.lab, 'without carrying either payload');

  // A listing with no panel must not acquire an empty one that reads as "tested, found nothing".
  const bare = _internals.detail({ ...p, lab: { lab: 'X', thca: 25, totalThc: 21.9, trust: 80, flags: [] } });
  ok(!('terpenes' in bare.lab), 'a cannabinoid-only sheet gets no terpenes key at all');
  const noLab = _internals.detail({ ...p, lab: null, lineage: null });
  eq(noLab.lab, null, 'and no sheet stays null');
  ok(!('lineage' in noLab), 'with no lineage key invented either');
}

console.log('\n== the rail matches what the data can support ==');
{
  const sys = _internals.systemFor('budtender', false, { updated: 'x', stores: [] });
  // The old rail said "This catalogue has no terpene data at all". That is false and would have the
  // model deny data it holds.
  ok(!/no terpene data at all/i.test(sys), 'the prompt no longer claims the catalogue has none');
  ok(/lab\.terpenes/.test(sys), 'it tells the model where the measured panel lives');
  ok(/measured/i.test(sys) && /panel/i.test(sys), 'and to treat it as measured');
  ok(/lineage/i.test(sys), 'lineage is covered');
  ok(/vendor/i.test(sys), 'and attributed to the vendor');
  ok(/parents' average|not its parents|breeders select/i.test(sys),
    'with the reason a cross is not its parents averaged');
  for (const reg of ['budtender', 'sommelier']) {
    const s = _internals.systemFor(reg, false, { updated: 'x', stores: [] });
    ok(/never.{0,40}(treatment|medical)/is.test(s), `${reg}: the no-medical-claims rail is intact`);
    ok(/lineage/i.test(s), `${reg}: gets the lineage rule`);
  }
}

console.log('\n== the census ?debug&slim publishes ==');
{
  // Both fields are sparse, so the number that matters is a count over the whole feed. This is the
  // half of it that can be pinned without a feed: that the count counts the right things.
  const list = [
    { name: 'Biscotti THCA Flower', storeKey: 'bt', category: 'THCA Flower',
      lineage: { parents: ['Gelato 25', 'South Florida OG'] }, lab: { terps: [['Limonene', 0.6]], totalTerps: 1.8 },
      sizes: [['3.5 Grams', 33, 3.5, null, true, null, '', false]] },
    { name: 'Sour Diesel THCA Flower', storeKey: 'bt', category: 'THCA Flower',
      lineage: { parents: ['Chemdawg', 'Super Skunk'] },
      sizes: [['28 Grams', 99, 28, null, false, null, '', false]] },           // out of stock
    { name: 'Gummies 25mg', storeKey: 'bz', category: 'Edibles', inStock: false,
      lab: { terps: [['Myrcene', 0.2]] } },
    { name: 'Royal Gorilla', storeKey: 'sb', category: 'THCA Flower', lab: { terps: [] } },  // panel-less sheet
    { name: 'Cap City Kush', storeKey: 'sb', category: 'THCA Flower', lineage: { parents: [] } },  // parsed to nothing
    // No sizes and no inStock declaration. anyInStock() calls that LIVE on purpose -- a flat product
    // that never said -- so the census inherits that, and the in-stock half of these counts is
    // "not known to be sold out" rather than "confirmed buyable". Pinned because it inflates.
    { name: 'Hash Rosin', storeKey: 'bt', category: 'Concentrate', lab: { terps: [['b-Caryophyllene', 0.4]] } },
    null
  ];
  const cov = enrichCoverage(list);
  eq(cov.products, 7, 'the denominator is every row it was handed, nulls included');
  eq(cov.inStock, 4, 'in-stock uses the same anyInStock the store counts use');
  eq(cov.flower, 4, 'flower is counted separately, because that is what lineage is 2 out of');
  eq(cov.flowerInStock, 3, 'and in-stock flower separately again');
  eq(cov.lineage.products, 2, 'a lineage with parents counts');
  eq(cov.lineage.inStock, 1, 'only one of which is buyable');
  eq(cov.lineage.strains, 2, 'distinct strain keys, so one strain at four stores is not four finds');
  eq(cov.lineage.byStore, { bt: 2 }, 'attributed to the store whose copy carried it');
  eq(cov.lineage.examples.length, 2, 'and up to three verbatim examples ride along');
  ok(cov.lineage.examples[0] === 'Biscotti THCA Flower -> Gelato 25 x South Florida OG',
    'each example names the product and the parents, so a bad parse is visible where it is counted');
  eq(cov.terpenes.products, 3, 'an empty terps array is not a panel');
  eq(cov.terpenes.inStock, 2, 'and the edible that declared itself sold out drops out');
  eq(cov.terpenes.withTotal, 1, 'totalTerps is counted apart from the panel, because 37 sheets carry both');
  eq(cov.terpenes.byStore, { bt: 2, bz: 1 }, 'terpene panels attributed per store too');
  eq(enrichCoverage([]).lineage.strains, 0, 'an empty feed is 0 and not a crash');
}

console.log('\n== against the real feed, if one is given ==');
{
  const i = process.argv.indexOf('--feed');
  if (i === -1) {
    console.log('  --   skipped (pass --feed ./feed.json; counts below came from a 2026-08-11 production pull)');
  } else {
    const feed = JSON.parse(await readFile(process.argv[i + 1], 'utf8'));
    const P = feed.products || feed;
    const withTerps = P.filter((p) => p.lab && Array.isArray(p.lab.terps) && p.lab.terps.length);
    const inStock = withTerps.filter((p) => p.inStock !== false);
    console.log(`  --   ${P.length} products; ${withTerps.length} carry a measured terpene panel, ${inStock.length} in stock`);
    ok(withTerps.length > 0,
      'the live feed really does carry measured terpene panels (if this fails, verify before believing "we have none")');
    ok(inStock.length > 0, 'and some of them are in stock, which is where they are worth showing');
    ok(withTerps.every((p) => p.lab.terps.every((t) => Array.isArray(t) && typeof t[1] === 'number')),
      'every analyte is a [name, percent] pair');
    // Lineage cannot be measured from this feed: `lineage` is computed at scrape time from body_html,
    // and a pull taken before that code existed has no such field. Said rather than asserted away.
    const withLineage = P.filter((p) => p.lineage);
    console.log(`  --   ${withLineage.length} carry lineage`
      + (withLineage.length === 0 ? '  (expected 0 on a feed pulled before parseLineage existed -- redeploy and re-pull to measure)' : ''));

    // The census against the same feed, cross-checked against plain filters over it. This is the
    // assertion that makes the published number trustworthy: ?debug&slim is the only way anyone
    // reads this coverage, so the tally has to agree with what counting by hand finds.
    const cov = enrichCoverage(P);
    eq(cov.products, P.length, 'the census counts the whole feed');
    eq(cov.terpenes.products, withTerps.length, 'and finds exactly the terpene panels a filter finds');
    eq(cov.lineage.products, withLineage.filter((p) => (p.lineage.parents || []).length).length,
      'and exactly the lineages');
    ok(cov.lineage.inStock <= cov.lineage.products && cov.terpenes.inStock <= cov.terpenes.products,
      'in-stock is a subset of found, never a bigger number');
    ok(cov.flower > 0 && cov.flower <= cov.products, 'flower is a real, bounded slice of the feed');
    if (cov.lineage.products) {
      console.log(`  --   lineage: ${cov.lineage.products} products / ${cov.lineage.inStock} in stock / `
        + `${cov.lineage.strains} distinct strains, of ${cov.flower} flower (${cov.flowerInStock} in stock)`);
      console.log('  --   by store: ' + JSON.stringify(cov.lineage.byStore));
      for (const ex of cov.lineage.examples) console.log('  --   e.g. ' + ex);
      ok(cov.lineage.strains <= cov.lineage.products, 'distinct strains cannot exceed products');
    }
  }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exitCode = 1; }

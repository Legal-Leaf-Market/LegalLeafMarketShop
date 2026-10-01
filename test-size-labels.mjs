// test-size-labels.mjs -- pins cleanSizeLabel / stripSizeFieldLabels in api/products.js.
// `node test-size-labels.mjs` (offline), or with a saved feed:
// `node test-size-labels.mjs --feed ./feed.json` to re-measure against real data.
//
// WHY THIS EXISTS
//
// WooCommerce bakes the attribute name into the variation label, so a size dropdown reads
// "Net Weight: 3.5 Grams / Net Weight: 7 Grams / Net Weight: 28 Grams" -- the same words in front of
// every option in the same select. Stripping that is obvious. What is NOT obvious, and is the reason
// this file is longer than the change, is that the first version of the rule stripped whatever every
// row shared, and two real listings show why that is wrong. Both are pinned below.
//
// The strip also sits upstream of three consumers that read the row label -- the grid's trim chip,
// /p/'s banner, and consumables.html's size rows -- so a label that stops saying "shake" is a shake
// ounce sold as whole flower. That invariant is asserted rather than assumed.

import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${extra ? `\n       ${extra}` : ''}`); }
}
function eq(a, b, label) { ok(a === b, label, `expected ${JSON.stringify(b)}\n       got      ${JSON.stringify(a)}`); }

// api/products.js exports only its handler, so the two functions are read out of the source and
// evaluated in isolation. Same reasoning as lume-overlap.mjs reading LAB_NOISE rather than restating
// it: a second copy of the regex here would drift from the one that actually runs.
const src = await readFile(new URL('./api/products.js', import.meta.url), 'utf8');
function lift(name, kind) {
  const re = kind === 'const'
    ? new RegExp('^const ' + name + ' = .+?;$', 'm')
    : new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}$', 'm');
  const m = src.match(re);
  if (!m) throw new Error(`could not lift ${name} from api/products.js -- did it move or change shape? `
    + 'Fix this test to find the new declaration rather than copying the code in.');
  return m[0];
}
const mod = new Function(
  [lift('SIZE_FIELD_LABEL', 'const'), lift('SIZE_KEEP', 'const'),
    lift('cleanSizeLabel', 'fn'), lift('stripSizeFieldLabels', 'fn'),
    'return { cleanSizeLabel, stripSizeFieldLabels, SIZE_FIELD_LABEL };'].join('\n')
)();
const { cleanSizeLabel, stripSizeFieldLabels } = mod;

console.log('\n== the field labels it is for ==');
{
  eq(cleanSizeLabel('Net Weight: 3.5 Grams'), '3.5 Grams', 'Net Weight:');
  eq(cleanSizeLabel('Quantity: 28 Grams'), '28 Grams', 'Quantity:');
  eq(cleanSizeLabel('Options: Plastic (3pc – Random Color)'), 'Plastic (3pc – Random Color)', 'Options:');
  eq(cleanSizeLabel('Size: Large'), 'Large', 'Size:');
  eq(cleanSizeLabel('Choose an option: 7 Grams'), '7 Grams', 'Choose an option:');
  eq(cleanSizeLabel('NET WEIGHT - 14 Grams'), '14 Grams', 'a dash separator, and case-insensitively');
  eq(cleanSizeLabel('Net Weight – 14 Grams'), '14 Grams', 'an en dash');
  eq(cleanSizeLabel('Quantity: 10 grams (2 x 5 gram bags)'), '10 grams (2 x 5 gram bags)',
    'and it keeps everything after the separator, parentheses included');
}

console.log('\n== the two real listings that narrowed the rule ==');
{
  // Version one stripped whatever every row shared. Both of these come from the live feed.
  //
  // "(3x)" is shared by every row AND is information: you are buying three of them. A shared-prefix
  // strip turns "(3x) 1 Gram" into "1 Gram" and sells a three-pack as a single.
  eq(cleanSizeLabel('(3x) 1 Gram'), '(3x) 1 Gram', 'a shared "(3x)" is information and survives');
  eq(cleanSizeLabel('(3x) 3.5 Grams'), '(3x) 3.5 Grams', 'on every row of that listing');

  // This listing's rows share only the word "Dank", because its variants are "Dank & Sticky" and
  // "Dank Work - New Mixed Bag". A shared-run strip yields "& Sticky / 3.5 Grams".
  eq(cleanSizeLabel('Dank & Sticky / 3.5 Grams'), 'Dank & Sticky / 3.5 Grams',
    'a partial shared word is not a field label and is left alone');
  eq(cleanSizeLabel('Dank Work - New Mixed Bag / 1/2 LB (225 g)'), 'Dank Work - New Mixed Bag / 1/2 LB (225 g)',
    'and neither is its sibling, despite the dash');

  // The general form of the same point.
  eq(cleanSizeLabel('Frog Poison (Light Assist) - New Arrival / 7 Grams'),
    'Frog Poison (Light Assist) - New Arrival / 7 Grams',
    'a variant name that happens to contain a dash is not a field label');
  eq(cleanSizeLabel('1oz'), '1oz', 'a plain weight is untouched');
  eq(cleanSizeLabel('One Size'), 'One Size', 'and so is a label with no separator at all');
}

console.log('\n== it never eats the grade ==');
{
  // The grid chip, /p/ and consumables.html all read this label. A row that stops saying shake is a
  // shake ounce sold as whole flower -- the exact failure the trim banner exists to prevent.
  // These strip, and that is correct: "Type: Shake" -> "Shake" still says shake. The guard is for a
  // strip that would REMOVE the token, which the current field vocabulary cannot do -- "trim" and
  // "shake" are not field names, so the token can never sit inside the matched prefix. It is kept as
  // belt-and-braces for the day somebody adds "grade" or similar to SIZE_FIELD_LABEL, and described
  // as currently unreachable rather than dressed up as load-bearing.
  eq(cleanSizeLabel('Type: Shake'), 'Shake', 'the field name goes and the grade token stays');
  eq(cleanSizeLabel('Type: Trim'), 'Trim', 'both words');
  eq(cleanSizeLabel('Weight: Shake 28 Grams'), 'Shake 28 Grams',
    'but a strip that leaves the grade intact still happens');
  eq(cleanSizeLabel('Quantity: 28 Grams Trim'), '28 Grams Trim', 'wherever the token sits');
}

console.log('\n== degenerate input ==');
{
  eq(cleanSizeLabel('Net Weight:'), 'Net Weight:', 'a label that is nothing but the field name is left alone');
  eq(cleanSizeLabel('Quantity:   '), 'Quantity:   ', 'and one that would strip to whitespace');
  eq(cleanSizeLabel(''), '', 'empty stays empty');
  eq(cleanSizeLabel(null), '', 'null becomes empty rather than "null"');
  eq(cleanSizeLabel(undefined), '', 'so does undefined');
  eq(cleanSizeLabel(28), '28', 'a number stringifies');
}

console.log('\n== the post-pass ==');
{
  const list = [
    { sizes: [['Net Weight: 3.5 Grams', 33, 3.5, null, null, null, '', false],
      ['Net Weight: 28 Grams', 114, 28, null, null, null, '', false]] },
    { sizes: [['1oz', 99, 28, null, null, null, '', false]] },
    { sizes: null },
    { },
    { sizes: [null, ['Quantity: 7 Grams', 62, 7, null, null, null, '', false]] }
  ];
  const stat = stripSizeFieldLabels(list);
  eq(stat.products, 2, 'counts only the products it changed');
  eq(stat.rows, 3, 'and the rows');
  eq(list[0].sizes[0][0], '3.5 Grams', 'the label is rewritten in place');
  eq(list[0].sizes[1][0], '28 Grams', 'on every affected row');
  eq(list[1].sizes[0][0], '1oz', 'an unaffected product is untouched');
  eq(list[0].sizes[0][1], 33, 'and no other slot moves');
  eq(list[0].sizes[0][7], false, 'including the per-row trim flag, which was computed upstream');
  ok(list[2].sizes === null && !('sizes' in list[3]), 'a product with no sizes array does not throw');
  eq(list[4].sizes[1][0], '7 Grams', 'a null row is skipped rather than crashing the pass');
}

console.log('\n== against the real feed, if one is given ==');
{
  const i = process.argv.indexOf('--feed');
  if (i === -1) {
    console.log('  --   skipped (pass --feed ./feed.json to re-measure; the counts in the source '
      + 'comment came from a 2026-08-11 production pull)');
  } else {
    const feed = JSON.parse(await readFile(process.argv[i + 1], 'utf8'));
    const products = feed.products || feed;
    const TRIM = /(^|[^a-z])(trim|shake)s?([^a-z]|$)/i;
    // Snapshot before, so the invariants are checked against what actually changed.
    const before = products.flatMap((p) => (p.sizes || []).filter(Array.isArray).map((s) => String(s[0] || '')));
    const stat = stripSizeFieldLabels(products);
    const after = products.flatMap((p) => (p.sizes || []).filter(Array.isArray).map((s) => String(s[0] || '')));
    console.log(`  --   feed: ${products.length} products, changed ${stat.products} products / ${stat.rows} rows`);
    ok(stat.rows > 0, 'the rule still fires on real data (if this fails, the feed changed shape)');
    eq(before.length, after.length, 'no row was added or lost');
    ok(after.every((l) => l.trim().length > 0 || before[after.indexOf(l)] === ''),
      'no label was emptied');
    const lostGrade = before.filter((b, k) => TRIM.test(b) && !TRIM.test(after[k]));
    eq(lostGrade.length, 0, 'not one row lost a trim or shake token', lostGrade.slice(0, 3).join(' | '));
    const stillPrefixed = after.filter((l) => /^\s*(net\s*weight|quantity|qty|options?)\s*:/i.test(l));
    eq(stillPrefixed.length, 0, 'and no field label survived', stillPrefixed.slice(0, 3).join(' | '));
    // Idempotent: running the pass twice must be a no-op the second time.
    const second = stripSizeFieldLabels(products);
    eq(second.rows, 0, 'the pass is idempotent -- a warm cache re-enrich cannot double-strip');
  }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exitCode = 1; }

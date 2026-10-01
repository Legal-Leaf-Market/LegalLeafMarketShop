/* test-kit.mjs — the rig builder.
 *
 * Every failure this suite guards against SHIPS A RECOMMENDATION. Nothing
 * throws, nothing renders blank; a shopper is simply handed the wrong object
 * and told it is what they need. That is worse than a broken page, which is
 * why the four picks the first draft actually made are pinned by name.
 *
 * Five claims:
 *
 *   1. THE CATEGORY AND THE NAME ARE BOTH REQUIRED. Either alone is too
 *      loose, and the golf rangefinder proves it: accessoryCat() files that
 *      row under Vaporizers, so the bucket alone hands you a golf gadget.
 *   2. THE JOINT IS A WARNING, NOT A GATE -- and the three verdicts are
 *      distinct, because "unknown" is the common one and must not read as
 *      either of the other two.
 *   3. SEEDED MEANS REPRODUCIBLE. A kit that cannot be linked to or supported
 *      is a slot machine.
 *   4. AN EMPTY ROLE IS A REAL ANSWER, reported rather than filled with
 *      whatever was nearest.
 *   5. PRICING AND SHOPS ARE STATED HONESTLY -- the total is the sum of what
 *      was picked, and a kit spanning shops says how many.
 *
 *     node test-kit.mjs
 */
process.env.LL_NO_STORE_FETCH = '1';
import { KITS, buildKit, kitKey, jointOf, jointVerdict, rng } from './api/kit.js';
import { COMBUSTION, VAPOR } from './api/heat.js';
import { SHELVES } from './api/shelves.js';
import { readFileSync } from 'node:fs';

const fails = [];
const ok = (n, c, x = '') => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${x ? '   (' + x + ')' : ''}`); if (!c) fails.push(n); };
const group = m => console.log('\n' + m);

let uid = 0;
/* A gear row shaped the way both feeds publish one. */
const g = (name, category, price, extra = {}) => ({
  id: 'x' + (++uid), name, category, cannabinoid: 'Accessory', group: 'gear',
  store: 'Shop A', storeKey: 'a', image: '/i.png', url: 'https://a.test/p',
  inStock: true, startsAt: price, sale: price, ship: 0, heat: '', ...extra,
});

console.log('\nThe rig builder\n');

/* PICKED ACROSS MANY SEEDS, NEVER ONE.
 *
 * buildKit draws at random from the top WINDOW of each role, which is the
 * feature. So a two-row pool where BOTH rows are candidates is a coin flip,
 * and a single-seed assertion passes about half the time -- it is not a test,
 * it is a bet. The first draft of the whitelist block did exactly this and
 * stayed green with the whitelist DELETED, because seed 1 happened to draw
 * the right row.
 *
 * A row that is properly REFUSED cannot be drawn on any seed. So the question
 * is asked over a sweep: which products did this role ever pick? */
function pickedOver(pool, type, roleKey, seeds = 24) {
  const out = new Set();
  for (let i = 1; i <= seeds; i++) {
    const built = buildKit(pool, { type, seed: i });
    const p = built.picks.find(x => x.role === roleKey);
    out.add(p && p.product ? p.product.id : '(empty)');
  }
  return out;
}

/* ------------------------------------------------------------------ */
group('THE FOUR PICKS THE FIRST DRAFT ACTUALLY MADE');
/* Each of these is a real product name off the live catalogue, and each was
   chosen by the first implementation for the role named. All four are the
   same bug: one loose regex tested against `name + " " + category`. */
const TRAPS = [
  ['vape', 'vape',   g('Handheld Golf Laser Rangefinder with Slope Calculation', 'Vaporizers', 75.99),
   g('Arizer Solo II Dry Herb Vaporizer', 'Vaporizers', 189)],
  ['pen',  'batt',   g('Keychain Battery Shaped Smoking Pipe', 'Vaporizers', 15.99),
   g('LOOKAH Egg | 350 mAh Mini 510 Vape Battery', 'Vaporizers', 29.99)],
  ['roll', 'papers', g('70mm Metal Herb Grinder with Pre-Roll Cone Filler', 'Rolling', 39.99),
   g('RAW Classic Cones 1 1/4 - 32 pack', 'Rolling', 8.99)],
  ['bong', 'light',  g('Creative Painted Car Ashtray (Lighter Style)', 'Accessories', 59),
   g('Clipper Lighter - Assorted', 'Accessories', 4.99)],
];
/* DRIVEN THROUGH THE REAL buildKit, NOT THROUGH A RESTATEMENT OF ITS FILTER.
   The first draft of this block re-implemented candidatesFor() inline --
   whitelist, name test, exclusion -- and therefore tested the role DATA while
   proving nothing about the code that reads it. Verified: deleting the
   category whitelist from candidatesFor(), and deleting the exclusion test,
   each left this suite fully green. Both now fail it.

   The pool is exactly two rows so the assertion is unambiguous: the role must
   choose the real product over the trap, and with only those two candidates
   there is nowhere else for it to go. */
for (const [kitType, roleKey, trap, good] of TRAPS) {
  const ever = pickedOver([trap, good], kitType, roleKey);
  ok(`${kitType}/${roleKey} never picks "${trap.name.slice(0, 38)}"`,
     !ever.has(trap.id), [...ever].join(','));
  /* ...and the counter-case, or a role that refuses everything would pass. */
  ok(`  ...while always picking "${good.name.slice(0, 38)}"`,
     ever.size === 1 && ever.has(good.id), [...ever].join(','));
}

/* ------------------------------------------------------------------ */
group('THE WHITELIST IS THE ONLY THING THAT SAVES THESE');
/* THE FOUR TRAPS ABOVE ARE ALL DISQUALIFIED BY THE NAME TEST, so they stayed
   green with the category whitelist DELETED -- verified against exactly that
   edit. A whitelist can only be shown to be load bearing by a row whose NAME
   matches the role perfectly and whose BUCKET is wrong, which is what these
   are. Each is a real shape: an accessory FOR the thing, named after it. */
const WRONG_BUCKET = [
  ['vape', 'vape',    g('Dry Herb Vaporizer Cleaning Brush Set', 'Accessories', 8.99),
   g('Arizer Solo II Dry Herb Vaporizer', 'Vaporizers', 189)],
  ['bong', 'bong',    g('Beaker Bong Cleaning Solution 16oz', 'Accessories', 11.99),
   g('Glass Beaker Bong 18 inch', 'Bongs & Rigs', 90)],
  ['roll', 'grinder', g('Grinder Cleaning Brush', 'Accessories', 4.99),
   g('4 Piece Aluminium Grinder', 'Grinders', 25.99)],
];
for (const [kitType, roleKey, trap, good] of WRONG_BUCKET) {
  const role = KITS[kitType].roles.find(r => r.key === roleKey);
  /* Assert the premise first, or this block proves nothing: the trap MUST
     satisfy the name test, so that only the bucket can be refusing it. */
  ok(`  premise: "${trap.name.slice(0, 38)}" does pass ${kitType}/${roleKey}'s name test`,
     role.re.test(trap.name) && !(role.no && role.no.test(trap.name)));
  const ever = pickedOver([trap, good], kitType, roleKey);
  ok(`${kitType}/${roleKey} never picks it, on its bucket alone`,
     !ever.has(trap.id), [...ever].join(','));
  ok(`  ...and always picks "${good.name.slice(0, 34)}"`,
     ever.size === 1 && ever.has(good.id), [...ever].join(','));
}

/* ------------------------------------------------------------------ */
group('THE CATEGORY ALONE IS NOT ENOUGH, AND NEITHER IS THE NAME');
const vape = KITS.vape.roles.find(r => r.key === 'vape');
/* Right bucket, wrong thing -- the rangefinder case, stated as the rule. */
ok('a row in the right bucket whose name says nothing is refused',
   !vape.re.test('Handheld Golf Laser Rangefinder with Slope Calculation'));
/* Right name, wrong bucket -- a vaporizer filed under Rolling is a data bug
   upstream and must not be dragged in by the name alone. */
ok('a row with the right name in the wrong bucket is refused',
   vape.cats.indexOf('Rolling') < 0);
ok('...and the two together accept a real one',
   vape.cats.indexOf('Vaporizers') >= 0 && vape.re.test('Arizer Solo II Dry Herb Vaporizer'));
/* Only cleaning is allowed to span every bucket. */
const spanning = [];
for (const [k, spec] of Object.entries(KITS)) for (const r of spec.roles) if (!r.cats) spanning.push(k + '/' + r.key);
ok('only cleaning roles are allowed a null whitelist',
   spanning.every(s => s.endsWith('/clean')), spanning.join(', '));

/* ------------------------------------------------------------------ */
group('THE JOINT: THREE VERDICTS, AND UNKNOWN IS THE COMMON ONE');
const j = (name, desc) => ({ name, description: desc || '' });
ok('reads a size and a gender off a name',
   JSON.stringify(jointOf(j('14mm Male 90° Quartz Banger'))) === '{"mm":14,"gender":"male"}',
   JSON.stringify(jointOf(j('14mm Male 90° Quartz Banger'))));
ok('reads a size out of a description when the name has none',
   jointOf(j('Chill Quartz Diamond Knot Banger', 'fits any water device with a 14mm taper')).mm === 14);
/* 18.8 and 19 are the same joint as 18 written long. Without normalising,
   an 18mm banger and an 18.8mm bong read as a CONFLICT and the pair is
   refused for no reason -- worse than saying nothing. */
ok('18.8mm and 18mm are the same joint', jointOf(j('18.8mm Female Bowl')).mm === 18);
ok('14.5mm and 14mm are the same joint', jointOf(j('14.5mm Male Banger')).mm === 14);
ok('says nothing when nothing is stated',
   JSON.stringify(jointOf(j('Cool Skull Glass Bong'))) === '{"mm":0,"gender":""}');

ok('opposite genders at the same size fit',
   jointVerdict(j('14mm Male Banger'), j('14mm Female Joint Rig')).fit === 'fits');
ok('SAME genders at the same size conflict',
   jointVerdict(j('14mm Male Banger'), j('14mm Male Rig')).fit === 'conflict');
ok('different sizes conflict',
   jointVerdict(j('14mm Male Banger'), j('18mm Female Rig')).fit === 'conflict');
/* The two that must never be confused with a fit. */
ok('a size on only one side is UNKNOWN, never a fit',
   jointVerdict(j('14mm Male Banger'), j('Cool Skull Bong')).fit === 'unknown');
ok('matching sizes with only one gender is LIKELY, never a fit',
   jointVerdict(j('14mm Male Banger'), j('14mm Bong')).fit === 'likely');
/* A gate would have emptied the shelf: measured, 3.6% of rows state both. */
ok('...and an unknown joint never blocks a pairing',
   jointVerdict(j('Banger'), j('Bong')).fit === 'unknown');

/* ------------------------------------------------------------------ */
group('SEEDED MEANS REPRODUCIBLE');
const POOL = [
  g('Lookah Glass Dab Rig with Showerhead Perc', 'Bongs & Rigs', 115.89, { heat: VAPOR }),
  g('Mystic Wizard Glass Dab Rig', 'Bongs & Rigs', 96, { heat: VAPOR }),
  g('Mini Recycler Dab Rig', 'Bongs & Rigs', 88, { heat: VAPOR }),
  g('Hourglass Spine Recycler Dab Rig', 'Bongs & Rigs', 132, { heat: VAPOR }),
  g('14mm Male 90° Quartz Banger with Terp Pearls', 'Parts & Tools', 19.99, { heat: VAPOR }),
  g('Flat Top Quartz Banger 14mm', 'Parts & Tools', 24.99, { heat: VAPOR }),
  g('Titanium Dab Nail 18mm', 'Parts & Tools', 14.99, { heat: VAPOR }),
  g('Bamboo Carb Cap', 'Parts & Tools', 12.99, { heat: VAPOR }),
  g('Butane Gas Torch', 'Accessories', 19.99, { storeKey: 'b', store: 'Shop B', ship: 5 }),
  g('Stainless Steel Dab Tool', 'Parts & Tools', 9.99, { heat: VAPOR }),
  g('Silicone Dab Mat', 'Storage & Trays', 17.99),
  g('Isopropyl Cleaning Solution 16oz', 'Accessories', 13.99),
];
const a = buildKit(POOL, { type: 'dab', budget: 250, seed: 4242 });
const b = buildKit(POOL, { type: 'dab', budget: 250, seed: 4242 });
const ids = k => k.picks.map(x => x.product && x.product.id).join(',');
ok('the same seed builds the same kit', ids(a) === ids(b), ids(a));
ok('...and the seed travels in the payload', a.seed === 4242);
/* Enough of the pool has alternatives that a different seed should differ.
   Asserted over several seeds rather than one, or a tie could pass it. */
const varied = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => ids(buildKit(POOL, { type: 'dab', budget: 250, seed: s }))));
ok('a different seed can build a different kit', varied.size > 1, varied.size + ' distinct over 8 seeds');
/* The PRNG itself: same seed, same stream; different seed, different stream. */
const r1 = rng(99), r2 = rng(99), r3 = rng(100);
ok('the prng is seeded, not ambient', r1() === r2() && r1() !== r3());

/* ------------------------------------------------------------------ */
group('HEAT KEEPS A DAB KIT OFF THE COMBUSTION SHELF');
const MIXED = POOL.concat([
  g('Glass Beaker Bong 18"', 'Bongs & Rigs', 90, { heat: COMBUSTION }),
  g('Herb Bowl 14mm', 'Parts & Tools', 11, { heat: COMBUSTION }),
]);
const dab = buildKit(MIXED, { type: 'dab', budget: 250, seed: 11 });
ok('the rig picked for a dab kit is not a combustion piece',
   dab.picks.find(x => x.role === 'rig').product.heat !== COMBUSTION);
const bong = buildKit(MIXED, { type: 'bong', budget: 250, seed: 11 });
ok('...and a bong kit picks the combustion piece',
   bong.picks.find(x => x.role === 'bong').product.heat === COMBUSTION);

/* ------------------------------------------------------------------ */
group('AN EMPTY ROLE IS REPORTED, NOT FILLED WITH WHATEVER WAS NEAREST');
const THIN = [g('Glass Beaker Bong', 'Bongs & Rigs', 90, { heat: COMBUSTION })];
const thin = buildKit(THIN, { type: 'bong', budget: 200, seed: 5 });
ok('the required role fills', !!thin.picks.find(x => x.role === 'bong').product);
ok('...and every unfillable role is named in the notes',
   thin.notes.some(n => /nothing on the shelf/i.test(n)), thin.notes[0] || '(none)');
/* The required role of a kit nothing can fill comes back present and null,
   rather than silently absent -- a missing slot must be visible. */
const none = buildKit([], { type: 'dab', budget: 200, seed: 5 });
const req = none.picks.filter(x => x.need);
ok('a required role with no candidate is present and null',
   req.length > 0 && req.every(x => x.product === null), req.length + ' required');
ok('...and the total is zero rather than NaN', none.totals.all === 0, String(none.totals.all));

/* ------------------------------------------------------------------ */
group('THE MONEY IS THE SUM OF WHAT WAS PICKED');
const money = buildKit(POOL, { type: 'dab', budget: 250, seed: 4242 });
const sum = money.picks.filter(x => x.product).reduce((t, x) => t + (x.product.sale || x.product.startsAt), 0);
ok('the gear total is the sum of the picks', Math.abs(money.totals.gear - sum) < 0.011,
   money.totals.gear + ' vs ' + sum.toFixed(2));
ok('shipping is counted once per shop, not once per item',
   money.totals.shipping === money.shops.reduce((t, s) => t + s.ship, 0),
   money.totals.shipping + ' over ' + money.shops.length + ' shops');
ok('...and the shop count is real', money.totals.shops === money.shops.length && money.totals.shops >= 1,
   String(money.totals.shops));
ok('every pick carries its own why', money.picks.filter(x => x.product).every(x => Array.isArray(x.why) && x.why.length));

/* ------------------------------------------------------------------ */
group('THE CONSUMABLE IS SEPARATE FROM THE RIG');
const WITH_FLOWER = POOL.concat([
  { id: 'f1', name: 'Blue Dream THCA Flower', category: 'THCA Flower', cannabinoid: 'THCa',
    group: 'cons', store: 'Flower Shop', storeKey: 'f', image: '/i.png', url: 'https://f.test/p',
    inStock: true, startsAt: 40, sale: 40, perG: 1.43, ship: 0 },
]);
const wf = buildKit(WITH_FLOWER, { type: 'bong', budget: 250, seed: 3 });
ok('a bong kit recommends something to smoke', !!(wf.consumable && wf.consumable.product), wf.consumable ? wf.consumable.product.name : '(none)');
ok('...and it is NOT counted in the rig total',
   wf.picks.every(x => !x.product || x.product.id !== 'f1'));
ok('...and it carries its own reason', !!(wf.consumable && wf.consumable.why.length));
/* Gear must never be offered as a consumable. */
ok('a kit with no consumable on the shelf says nothing rather than offering gear',
   buildKit(POOL, { type: 'bong', budget: 250, seed: 3 }).consumable === null);

/* ------------------------------------------------------------------ */
group('THE TYPE KEY');
ok('a known type resolves', kitKey('dab') === 'dab' && kitKey('DAB') === 'dab');
ok('aliases resolve', kitKey('rig') === 'dab' && kitKey('dry herb') === 'vape' && kitKey('510') === 'pen');
ok('an unknown type is null, not a default', kitKey('banana') === null);
/* Same guard test-shelves.mjs runs, asserted here so this file is not the
   one that reintroduces a slug outside the registry. */
const src = readFileSync('api/kit.js', 'utf8');
for (const s of SHELVES.map(x => x.slug)) {
  ok(`api/kit.js never spells "${s}" in a quoted string`,
     !new RegExp('["\'`]' + s + '["\'`]').test(src));
}

console.log(fails.length ? `\nFAILED: ${fails.join(' | ')}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);

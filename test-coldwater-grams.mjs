/* Size labels to grams. This is the number the whole site is built on: get it
   wrong and every price-per-gram, every ranking, and the "best $/g" badge are
   wrong with it -- silently, and in a way that looks like a real figure.
 *
 * THE BUG THIS EXISTS FOR. "1/8 oz" was matched by the OUNCE rule before any
 * fraction rule ran, and its [\d.]+ took the 8 after the slash. Eight ounces,
 * 224 g, and a $10 eighth published at four cents a gram -- reported from the
 * live shelf as "I see an eighth as .04 cents per gram lol".
 *
 * Run: node test-coldwater-grams.mjs
 */
import { gramsOf } from './api/coldwater.js';

let fails = 0;
const eq = (label, want) => {
  const got = gramsOf(label);
  const ok = Math.abs(got - want) < 0.001;
  console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(label) + ' -> ' + got + (ok ? '' : '   (want ' + want + ')'));
  if (!ok) fails++;
};

console.log('\nSize label -> grams\n');

/* The regression itself, in every form these menus write it. */
eq('1/8 oz', 3.5);
eq('1/8oz', 3.5);
eq('1/4 oz', 7);
eq('1/2 oz', 14);
eq('1/2 OZ', 14);
eq('1 oz', 28);
eq('1/8', 3.5);
eq('1/4', 7);

/* Named sizes. */
eq('Eighth', 3.5);
eq('Eighth · 3.5 g', 3.5);
eq('Quarter', 7);
eq('Half Oz', 14);
eq('Ounce', 28);
eq('oz', 28);

/* Plain grams, which always worked and must keep working. */
eq('1g', 1);
eq('3.5g', 3.5);
eq('28 g', 28);
eq('28 grams', 28);
eq('7 Grams', 7);
eq('2 oz', 56);

/* Things that are NOT a weight. A gummy pack is not ten grams. */
eq('10 x 10 mg', 0);
eq('100mg', 0);
eq('1-Pack', 0);
eq('One Size', 0);
eq('', 0);
eq('Live Resin Cart', 0);

/* A fraction of a gram, the same trap in the other unit. */
eq('1/2 gram', 0.5);

/* THE POUND, which nothing here could read until a bulk catalogue arrived and
   came back with "withGrams":0 against 170 products -- no price-per-gram, no
   ranking and no "best $/g" badge on the whole store, which is the site's
   entire proposition missing for a shop that sells nothing else.

   448, not 453.59: a pound is 16 of the 28 g ounces this file already uses, and
   every figure on the shelf being comparable to every other is the only thing
   the number is for. */
eq('1 LB', 448);
eq('1lb', 448);
eq('2 lbs', 896);
eq('1 pound', 448);
eq('Pound', 448);
eq('LB', 448);
eq('1/4 lb', 112);
eq('1/2 lb', 224);
eq('1/8 lb', 56);
eq('QP', 112);
eq('qp', 112);
eq('Q.P.', 112);
eq('QP (112g)', 112);
eq('HP', 224);

/* THE ORDERING TRAP, and it is the reason the pound rules sit above the named
   ounce fractions rather than below them. Read in the wrong order these do not
   fail -- /\bquarter\b/ answers 7 for 113 g and /\bhalf\b/ answers 14 for 227,
   which publishes a $180 quarter-pound at $25.71/g instead of $1.59/g. Inside
   the MIN_PERG/MAX_PERG bounds, so nothing downstream catches it. Same family
   as the 1/8-oz bug above: a confident wrong number, not a missing one. */
eq('quarter pound', 112);
eq('Quarter Pound (113g)', 112);
eq('half pound', 224);
eq('Half Pound', 224);
eq('eighth pound', 56);

/* DECOYS, and these are why the unqualified rules are the WHOLE label rather
   than a word inside it. POUND CAKE IS A STRAIN, and textHarvest() offers this
   function the printed line above a price as a candidate size -- so a loose
   rule turns a $45 eighth into 448 g at ten cents a gram, which then ranks
   first because it is cheapest. Same reason "HP" is not read as a prefix. */
eq('Pound Cake', 0);
eq('Pound Cake 3.5g', 3.5);
eq('HP Sauce Gummies', 0);
eq('Quarter Pounder Gummies', 112);   // genuinely ambiguous; the weight reading is the safe one

console.log('\n' + (fails ? `FAILED (${fails})` : 'All assertions passed.') + '\n');
process.exit(fails ? 1 : 0);

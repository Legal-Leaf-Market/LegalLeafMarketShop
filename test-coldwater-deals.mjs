/* Deal arithmetic: what may be computed, and what must be refused.
   A confident wrong number is worse than a missing one -- it looks
   authoritative -- so the refusals matter as much as the sums. */
import { dealMath } from './api/coldwater.js';
let fails = 0;
const ok = (c, m, x='') => { console.log((c?'  ok   ':'  FAIL ')+m+(x?'   ('+x+')':'')); if(!c) fails++; };

let d = dealMath("5 for $100", 25);
ok(d && d.unit === 20 && d.minQty === 5, '"5 for $100" on a $25 cart is $20 each at 5', JSON.stringify(d));

d = dealMath("Buy 10 for $150", 20);
ok(d && d.unit === 15 && d.minQty === 10, '"Buy 10 for $150" is $15 each at 10', JSON.stringify(d));

d = dealMath("buy 2 get 1 free", 30);
ok(d && Math.abs(d.unit - 20) < 0.001 && d.minQty === 3, 'buy 2 get 1 free is 3 for the price of 2', JSON.stringify(d));

d = dealMath("20% off", 50);
ok(d && d.unit === 40 && d.minQty === 1, 'a percentage applies to one unit', JSON.stringify(d));

/* The refusals. */
ok(dealMath("mix and match", 25) === null, 'mix and match is refused: different items, no unit price');
ok(dealMath("BOGO", 25) === null, 'a bare BOGO is refused: free in some shops, half off in others');
ok(dealMath("buy 2 get 1", 30) === null, 'buy 2 get 1 without "free" is refused: the discount is unstated');
ok(dealMath("Weekend special", 25) === null, 'a special with no arithmetic in it yields none');
ok(dealMath("bundle deal", 25) === null, 'nor does a bundle');
ok(dealMath("5 for $100", 0) === null, 'no price, no maths');
ok(dealMath("", 25) === null, 'no deal, no maths');
ok(dealMath("120% off", 50) === null, 'a nonsense percentage is refused rather than making a price negative');

/* THE SLASH FORM. Herbology writes every offer this way, and 466 of their 597
   products carried one that the "for" rule could not read, so their whole
   catalogue ranked at shelf price on a page whose entire job is ranking. */
d = dealMath("Flower OZs $90 or 2/$160", 90);
ok(d && d.unit === 80 && d.minQty === 2, '"2/$160" is the same offer as "2 for $160"', JSON.stringify(d));
ok(d && d.basis === "2/$160", 'and it quotes the shop back verbatim', d && d.basis);

d = dealMath("Flower OZs $125 or 2/$230", 125);
ok(d && d.unit === 115 && d.minQty === 2, 'a second real Herbology string', JSON.stringify(d));

/* The $ is the whole guard. Without it a weight reads as an offer, and "1/8 oz"
   would put an eighth on the page at eight dollars for two. */
ok(dealMath("1/8 oz special", 25) === null, 'a weight is not a multi-buy: no $ after the slash');
ok(dealMath("Sale ends 2/16", 25) === null, 'nor is a date');
ok(dealMath("Special 1/$50", 60) === null, 'one of something is not a multi-buy');

/* A multi-buy total is absolute, so it says nothing about the row it is tested
   against. An ounce offer landing on a gram row computes $80 for one gram --
   arithmetic that is correct and an answer that is nonsense. */
ok(dealMath("Flower OZs $90 or 2/$160", 10) === null,
   'an ounce offer is refused on a gram row: $80/g is not a saving on a $10 gram');
ok(dealMath("5 for $200", 25) === null,
   'the for-form gets the same guard: a "deal" dearer than the shelf is not one');

d = dealMath("OZs 2/$500 or 10% off", 40);
ok(d && d.unit === 36 && d.minQty === 1,
   'a refused multi-buy falls through rather than swallowing the offer', JSON.stringify(d));

/* MIX AND MATCH. 237 of Herbology's 348 offers were refused wholesale -- 79% of
   their catalogue ranking at shelf price. The blanket refusal was right about
   the general form and wrong about this one, and the offer says which it is. */
d = dealMath("Mix & Match Vapes $7.50 or 10/$70", 7.5);
ok(d && d.unit === 7 && d.minQty === 10 && d.mix === true && d.group === "Vapes",
   'a mix-and-match that names its tier price is computable', JSON.stringify(d));
ok(d && d.mix === true, 'and it is flagged, so the card can say the quantity is met with other items');

d = dealMath("Mix & Match Pre-Packed Flower $30 or 3/$84", 30);
ok(d && d.unit === 28 && d.minQty === 3 && d.group === "Pre-Packed Flower",
   'the group travels with it, because "3+" alone would claim three of THIS item',
   JSON.stringify(d));

/* THE TIER GUARD IS THE WHOLE SAFETY ARGUMENT. "$7.50 or 10/$70" is an offer on
   the $7.50 shelf; a $25 vape is covered by a different line entirely, and
   applying this one to it would invent a discount nobody offers. */
ok(dealMath("Mix & Match Vapes $7.50 or 10/$70", 25) === null,
   'a row on a different tier is refused, not silently discounted');
ok(dealMath("Mix & Match Edibles $6 or 4/$20", 3) === null,
   'and so is a cheaper row that the offer does not name');

/* Still refused: the form the original objection was actually about. */
ok(dealMath("Mix & Match Everything", 25) === null,
   'a mix-and-match with no tier price stays refused');
ok(dealMath("mix and match", 25) === null, 'as does the bare phrase');

console.log('\n' + (fails ? `FAILED (${fails})` : 'All assertions passed.') + '\n');
process.exit(fails ? 1 : 0);

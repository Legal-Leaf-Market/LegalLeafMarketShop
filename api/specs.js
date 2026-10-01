/* api/specs.js — the four facts a shopper asks about hardware, pulled out of
 * the text the merchant already wrote.
 *
 * WHY THESE FOUR. "Specs on the card back: joint size, height, material, mAh."
 * They are not an arbitrary list -- they are the questions somebody asks BEFORE
 * they can buy, and the only ones a comparison site can answer from a feed:
 *
 *   joint / thread   WILL IT FIT? A 14mm banger does not go in an 18mm rig and
 *                    a 510 cart does not fire on an 810 battery. This is the
 *                    single most expensive thing to get wrong, because the
 *                    shopper finds out after the parcel arrives.
 *   height           HOW BIG IS IT, on a shelf where every photo is cropped to
 *                    the same square and a 4" bubbler and a 16" tube look
 *                    identical.
 *   material         WHAT IS IT, which is most of the price difference between
 *                    two objects of the same shape.
 *   capacity (mAh)   HOW LONG DOES IT LAST, the one number that separates two
 *                    batteries that look the same.
 *
 * ------------------------------------------------------------------
 * MEASURED FIRST, AND THE MEASUREMENT SAID BUILD THE CENSUS TOO.
 *
 * Against the 124 gear products baked into public/engine.js -- Greek Glass, the
 * only real corpus reachable from the containers this repo is edited in -- the
 * NAMES alone yield 3 joint sizes, 6 materials, 0 heights and 0 mAh. That is
 * not evidence the feature is worthless; it is evidence that corpus is the
 * wrong one. Those are an artisan's terse titles ("GG Wine Glass") and they
 * carry no description at all, while the shops this is actually for --
 * Grasscity, Chill, Lookah, Vapor.com, Hitoki, Zam -- write specifications into
 * theirs.
 *
 * Egress to every one of them is refused here, so the real hit rate CANNOT be
 * measured from this container. api/products.js therefore publishes a `specs`
 * census in ?debug&slim alongside this, exactly as the lineage and terpene work
 * did for the same reason: "both fields are sparse, so a sample cannot describe
 * them". The first thing to do with this on production is read that number.
 *
 * ------------------------------------------------------------------
 * PRECISION OVER RECALL, which for specs is sharper than usual. A missing spec
 * is a blank row nobody notices. A WRONG one is a shopper buying a 14mm banger
 * for an 18mm rig on our say-so -- we told them it fits, and it does not. Every
 * rule below therefore refuses rather than guesses, and the refusals are the
 * half worth reading.
 *
 * FIVE TRAPS, each of which produces a confident wrong answer:
 *
 * A. ONLY GEAR GETS SPECS, and the gate is inside this function rather than
 *    left to the caller -- isGear is imported from api/heat.js rather than
 *    restated, because that file already argues the case and already carries
 *    the flower counter-examples. "Zangbanger THCA Flower" contains `banger`
 *    and "Pound Cake" is a strain; this repo has shipped a device word matching
 *    a flower name twice. A caller-side gate is one the second caller forgets,
 *    which is what the capture lane did with the synthetics exclusion.
 *
 * B. NOT EVERY MILLIMETRE IS A JOINT. "25mm Banger" is the BUCKET diameter and
 *    "4mm thick" is wall thickness -- neither is a fitting, and publishing
 *    either as one is the exact "it fits" lie above. Only 10, 14, 18 and 19 are
 *    real joint sizes, so the set is closed rather than a range: 25 cannot be
 *    read as a joint because it is not in it. (14.5 and 18.8 are the same
 *    fittings written precisely and are folded in.)
 *
 * C. `in` IS NOT A UNIT IN PROSE. "Made in USA", "6 in stock" and "comes in
 *    black" all match a naive inches pattern, and the third would publish a
 *    height of 6 inches on a product that has none. Inches must be written as
 *    a quote mark or the word, never the bare preposition.
 *
 * D. A DIMENSION LIST IS NOT A HEIGHT. "5" x 3" x 3"" states a footprint, and
 *    taking the first number publishes a depth as a height half the time. A
 *    lone measurement is a height; several are refused unless one is explicitly
 *    labelled.
 *
 * E. THE SPECIFIC MATERIAL WINS. Borosilicate IS glass, quartz IS glass, and a
 *    rule that answers "glass" for a borosilicate tube has thrown away the only
 *    part a shopper was reading for. The ladder runs specific to generic and
 *    stops at the first hit, same shape as classify()'s synthetics ladder.
 */
import { isGear } from './heat.js';

/* Trap B: a closed set, not a range. */
const JOINT_MM = { 10: '10mm', 14: '14mm', '14.5': '14mm', 18: '18mm', '18.8': '18mm', 19: '19mm' };

/* Trap E: specific first. Each entry is [label, test]; the first hit wins. */
const MATERIALS = [
  ['Borosilicate glass', /\bborosilicate\b|\bboro\b(?!\w)/i],
  ['Quartz',             /\bquartz\b/i],
  ['Titanium',           /\btitanium\b|\bti\b(?=\s*(nail|bucket|insert))/i],
  ['Ceramic',            /\bceramics?\b/i],
  ['Silicone',           /\bsilicone\b/i],
  ['Stainless steel',    /\bstainless(\s*steel)?\b/i],
  ['Aluminium',          /\baluminium\b|\baluminum\b/i],
  ['Zinc alloy',         /\bzinc(\s*alloy)?\b/i],
  ['Wood',               /\b(wood(en)?|rosewood|walnut|bamboo)\b/i],
  ['Acrylic',            /\bacrylic\b/i],
  ['Glass',              /\bglass\b/i],
];

const clean = (s) => String(s == null ? '' : s)
  .replace(/<[^>]*>/g, ' ')          /* descriptions arrive as HTML */
  .replace(/&[a-z]+;|&#\d+;/gi, ' ')
  .replace(/\s+/g, ' ');

/* WHAT DOES IT FIT -- the joint, and its gender where the merchant says so. */
function jointOf(hay) {
  const seen = [];
  for (const m of hay.matchAll(/\b(\d{1,2}(?:\.\d)?)\s*mm\b/gi)) {
    const label = JOINT_MM[m[1]] || JOINT_MM[Number(m[1])];
    if (label && !seen.includes(label)) seen.push(label);
  }
  if (!seen.length) return '';
  /* An adapter legitimately states two, and so does "fits 14mm & 18mm". More
     than two is a parts listing describing a range we are not going to
     summarise correctly, so it is refused rather than truncated. */
  if (seen.length > 2) return '';
  const gender = /\bfemale\b/i.test(hay) ? ' female' : /\bmale\b/i.test(hay) ? ' male' : '';
  return seen.join(' / ') + gender;
}

/* Cartridge and battery threading. Unambiguous, and the other half of "will it
   fit" -- but ONLY where it is stated as a thread: heat.js's ladder already
   shows /\b510\b/ matching model numbers and quantities in the wild. */
function threadOf(hay) {
  const m = hay.match(/\b(510|810|610|710)\b(?=[^.]{0,24}\b(thread|threading|threaded|connection|compatible|compatibility)\b)/i)
    || hay.match(/\b(thread|threading|threaded)\b[^.]{0,24}\b(510|810|610|710)\b/i);
  if (!m) return '';
  const n = (m[0].match(/\b(510|810|610|710)\b/) || [])[1];
  return n ? n + ' thread' : '';
}

/* HOW BIG. Traps C and D both live here. */
function heightOf(hay) {
  /* Explicitly labelled wins outright, and may appear in a dimension list. */
  const named = hay.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:"|''|”|inch(?:es)?)\s*(?:tall|high|height)\b/i)
    || hay.match(/\b(?:height|tall)\b[^.]{0,12}?(\d{1,2}(?:\.\d+)?)\s*(?:"|''|”|inch(?:es)?)/i)
    || hay.match(/\b(?:height|tall)\b[^.]{0,12}?(\d{1,3}(?:\.\d+)?)\s*cm\b/i);
  if (named) {
    const n = Number(named[1]);
    const cm = /cm\b/i.test(named[0]);
    if (n > 0 && n < (cm ? 200 : 80)) return cm ? n + ' cm' : n + '"';
  }
  /* Trap C: the word or the mark, never a bare `in`.

     NO TRAILING \b HERE, and that is not a loosening. A word boundary after a
     quote mark can never match -- the mark and the space that follows it are
     both non-word characters -- so the quote alternative was dead and only the
     spelled-out `inch` could ever hit. The boundary belongs to the WORD form
     alone, which is where it does something. */
  const all = [...hay.matchAll(/\b(\d{1,2}(?:\.\d+)?)\s*(?:"|''|”|inch(?:es)?\b)/gi)]
    .map((m) => Number(m[1])).filter((n) => n > 0 && n < 80);
  /* Trap D: a lone measurement is a height; a list is a footprint. */
  const distinct = [...new Set(all)];
  if (distinct.length === 1) return distinct[0] + '"';
  return '';
}

/* HOW LONG DOES IT LAST. The least ambiguous of the four. */
function capacityOf(hay) {
  const m = hay.match(/\b(\d{3,5})\s*mah\b/i);
  if (!m) return '';
  const n = Number(m[1]);
  /* A 60,000 mAh vape is a typo or a power bank; a 90 mAh one is not a battery
     anybody sells. Wide bounds -- this guards arithmetic, not marketing. */
  return n >= 100 && n <= 30000 ? n + ' mAh' : '';
}

function materialOf(hay) {
  for (const [label, re] of MATERIALS) if (re.test(hay)) return label;
  return '';
}

/* The four (five, counting thread) as an object. Absent keys rather than empty
   strings, so a caller can ask Object.keys(...).length and a card can decide
   whether it has anything worth drawing a heading for. */
function specsOf(p) {
  if (!p) return {};
  /* Trap A: flower is not hardware. Imported, never restated. */
  if (!isGear(p)) return {};
  const hay = clean([p.name, p.description, p.type].filter(Boolean).join(' . '));
  if (!hay) return {};

  const out = {};
  const joint = jointOf(hay);      if (joint) out.joint = joint;
  const thread = threadOf(hay);    if (thread) out.thread = thread;
  const height = heightOf(hay);    if (height) out.height = height;
  const material = materialOf(hay); if (material) out.material = material;
  const capacity = capacityOf(hay); if (capacity) out.capacity = capacity;
  return out;
}

/* The label a card prints for each key, and the order it prints them in --
   "will it fit" first, because that is the question that stops a purchase. */
const SPEC_ORDER = [
  ['joint', 'Joint'],
  ['thread', 'Thread'],
  ['height', 'Height'],
  ['material', 'Material'],
  ['capacity', 'Battery'],
];

export { specsOf, SPEC_ORDER, jointOf, threadOf, heightOf, materialOf, capacityOf, JOINT_MM, MATERIALS };

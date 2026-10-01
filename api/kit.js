/* api/kit.js — build a whole rig, across shops, for a real number.
 *
 * "Random rig generator that picks out a bundle for a full rig and provides
 * recommendations on consumables too."
 *
 * WHY THIS IS THE MARKETPLACE FEATURE. Everything else here compares one
 * product against the same product somewhere else, and on gear that comparison
 * barely exists -- 155 brands in the catalogue and exactly ONE appears at more
 * than one shop, so the gear shelf is a federated catalogue rather than a
 * price comparison. A KIT is the thing only a site spanning sixteen shops can
 * do: a rig from one, a banger from another, a grinder from a third, totalled.
 * Nobody selling their own catalogue can build it.
 *
 * IT IS THE MOOD MATCHER'S SIBLING, deliberately, and inherits four rules from
 * api/concierge.js's scorer rather than restating them:
 *
 *   - DETERMINISTIC AND ZERO-TOKEN. No model call. `GET /api/kit` is real
 *     inventory scored by real arithmetic, the same way `?mood=` is, so it
 *     works on a deploy with no provider key and cannot be run up a bill.
 *   - SCORED, NOT CLAMPED. A role is allowed to come back weak, and "we could
 *     not fill this from today's shelf" is a true and useful answer. A floor
 *     that hid it would be the recommendation-engine version of ranking by
 *     commission.
 *   - EVERY PICK CARRIES ITS OWN `why`. That is the whole difference between
 *     a pick and a shrug, and it is what a card renders.
 *   - VALUE IS RELATIVE TO TODAY'S SHELF, not to an absolute price.
 *
 * ------------------------------------------------------------------
 * THE JOINT SIZE IS A WARNING, NOT A GATE, AND THAT WAS MEASURED.
 *
 * A 14mm male banger fits a 14mm female joint, and pairing the wrong two is
 * the single most annoying thing a kit builder can get wrong. The tempting
 * implementation gates on it. Measured over the 815 named Lookah rows held
 * locally: 15.1% state a millimetre size anywhere in the name or description,
 * 3.6% state a size AND a gender, and among the 379 rows that actually carry a
 * joint -- bangers, nails, rigs, bongs, downstems, bowls -- only 20 state
 * both. A compatibility GATE would therefore reject about 95% of the shelf and
 * return an empty kit, which is exactly the trap api/concierge.js writes up
 * about terpenes: a scorer that needs a field present on 1% of rows ranks 1%
 * of the shelf and silently drops the rest.
 *
 * So: a KNOWN conflict is refused, a KNOWN match is stated as a positive, and
 * anything unread is paired anyway and SAYS it is unread. Never claim a fit
 * that was not read. Same side of the line as perGSuppressed, dealMath()'s
 * refusals and isNonConsumable() -- a miss costs a warning, a false positive
 * sends somebody a banger that does not fit their rig.
 *
 * ------------------------------------------------------------------
 * RANDOM, BUT SEEDED. "Random rig generator" is the ask, and a generator that
 * gives a different answer on every reload cannot be shared, screenshotted or
 * supported. So the roll is a seeded PRNG and the seed travels in the payload
 * and the URL: ?seed=<n> reproduces a kit exactly. The pick is a random draw
 * from the top WINDOW of each role rather than from the whole role, which is
 * the same shape as public/js/shelf-shuffle.js -- what leads is still among
 * the strongest, it is just not always the same one.
 */
import { anyInStock } from './products.js';
import { loadCatalogue } from './feed.js';
import { COMBUSTION, VAPOR } from './heat.js';

/* ------------------------------------------------------------------ *
 * The joint                                                           *
 * ------------------------------------------------------------------ */

/* Real forms off the shelf: "90 degree - Male 14mm", "14mm M", "14MM Male
   90 deg", "2mm Female Quartz Thermal Banger Nail - 14mm", and a description
   reading "any other water device with a 14mm taper". 18.8 and 14.5 are the
   same joints as 18 and 14 written the long way, so they are normalised --
   otherwise an 18mm banger and an 18.8mm bong read as a conflict and the pair
   is refused for no reason, which is worse than saying nothing. */
const MM_RE = /\b(10|14|14\.5|18|18\.8|19)\s*(?:mm|MM)\b/;
const GENDER_RE = /\b(male|female)\b/i;
/* Only after a size, so the M in "2mm M" is a gender and the M in "Mystic"
   is not. */
const ABBR_RE = /\b(?:10|14|14\.5|18|18\.8|19)\s*(?:mm|MM)\s*[-\s]*\b(m|f)\b/i;

function normMm(raw) {
  const n = parseFloat(raw);
  if (!(n > 0)) return 0;
  if (n === 14.5) return 14;
  if (n === 18.8 || n === 19) return 18;
  return n;
}

/* What joint does this listing state? Reads the name and the description,
   because Chill states "14mm taper" only in the description. Returns
   { mm, gender } with 0 / "" meaning "not stated", never a guess. */
function jointOf(p) {
  const hay = String((p && p.name) || '') + ' ' + String((p && (p.description || p.desc)) || '');
  const mm = MM_RE.exec(hay);
  const full = GENDER_RE.exec(hay);
  const abbr = ABBR_RE.exec(hay);
  const g = full ? full[1].toLowerCase() : abbr ? (abbr[1].toLowerCase() === 'm' ? 'male' : 'female') : '';
  return { mm: mm ? normMm(mm[1]) : 0, gender: g };
}

/* Do these two go together? THREE ANSWERS, and "unknown" is the common one.
 *
 * The genders must be OPPOSITE, not equal, and that is the half most likely to
 * be written backwards: a rig with a female joint takes a MALE banger. A
 * listing states the joint it IS (a banger) or the joint it HAS (a rig), and
 * this codebase cannot tell those apart from a string -- so gender is only
 * ever used to REFUSE a same-gender pair where both are stated, never to
 * assert a fit on its own. */
function jointVerdict(a, b) {
  const x = jointOf(a), y = jointOf(b);
  if (!x.mm || !y.mm) return { fit: 'unknown', note: 'joint size is not stated on both listings -- check it before you buy' };
  if (x.mm !== y.mm) return { fit: 'conflict', note: `${x.mm}mm against ${y.mm}mm` };
  if (x.gender && y.gender && x.gender === y.gender) {
    return { fit: 'conflict', note: `both listed ${x.gender} at ${x.mm}mm` };
  }
  if (x.gender && y.gender) return { fit: 'fits', note: `${x.mm}mm, ${x.gender} into ${y.gender}` };
  return { fit: 'likely', note: `both ${x.mm}mm, but only one states male or female` };
}

/* ------------------------------------------------------------------ *
 * The kits                                                            *
 * ------------------------------------------------------------------ */

/* A role is a slot in a rig and a test for what can fill it. `need` is what
   the rig does not work without; everything else is bought while the budget
   lasts, in the order written -- so the order IS the priority. `share` is the
   fraction of budget this role is expected to want, used to score price fit
   rather than to cap anything.
 *
 * A CANDIDATE MUST SATISFY THE CATEGORY **AND** THE NAME, and that pairing is
 * the whole guard rather than a belt-and-braces nicety. The first draft tested
 * one loose regex against `name + " " + category` and produced a kit whose
 * vaporizer was a "Handheld Golf Laser Rangefinder with Slope Calculation" --
 * because accessoryCat() files that row under Vaporizers upstream, so the
 * word "vaporizer" was in the haystack while the product was a golf gadget.
 * One bad classification upstream became a confidently wrong recommendation,
 * and a kit that recommends a rangefinder as a vaporizer is worse than no kit
 * at all.
 *
 * So `cats` is a WHITELIST over the eight gear buckets -- classification work
 * this repo has already done and tested -- and `re` is a REFINEMENT tested
 * against the name alone. Either one on its own is too loose: the category is
 * eight buckets over 2,500 products, and the name is somebody's marketing
 * copy. `cats` null means any bucket, which is right only for roles that
 * genuinely span them, like cleaning. */
const R = (key, label, need, share, cats, re, no) =>
  ({ key, label, need, share, cats: cats || null, re, no: no || null });

const KITS = {
  dab: {
    label: 'Dab rig setup',
    blurb: 'A rig, something to heat, and the tools to work it',
    heat: VAPOR,
    consumable: { label: 'To smoke', re: /concentrate|rosin|resin|badder|budder|shatter|diamond|hash|wax\b/i },
    roles: [
      R('rig',    'The rig',    true,  0.45, ['Bongs & Rigs', 'Vaporizers'],
        /dab[- ]?rig|e-?rig\b|\berig\b|recycler|electric\s*dab|nectar\s*collector/i,
        /\bbowl\b|downstem|adapter|attachment|\bbong\b/i),
      R('banger', 'Banger',     true,  0.15, ['Parts & Tools', 'Bongs & Rigs'],
        /\bbangers?\b|quartz\s*nail|dab\s*nail|titanium\s*nail/i, /carb[- ]?cap\s*only/i),
      R('cap',    'Carb cap',   false, 0.10, ['Parts & Tools', 'Accessories'], /carb[- ]?caps?\b/i),
      R('torch',  'Torch',      false, 0.15, ['Accessories', 'Parts & Tools'],
        /\btorch(es)?\b/i, /ashtray|\bpipe\b|lighter\s*style/i),
      R('tool',   'Dab tool',   false, 0.06, ['Parts & Tools', 'Accessories'],
        /dab[- ]?tools?\b|\bdabbers?\b|dab\s*tool\s*kit/i),
      R('mat',    'Mat or jar', false, 0.05, ['Storage & Trays', 'Accessories', 'Parts & Tools'],
        /dab[- ]?mat|silicone\s*(jar|container)|storage\s*jar|reclaim|\bcontainer\b/i),
      /* Cleaning genuinely spans every bucket, which is why this one role is
         allowed a null whitelist. */
      R('clean',  'Cleaning',   false, 0.04, null,
        /\bisopropyl\b|\bcleaner\b|cleaning\s*(kit|solution|brush)|resin\s*remov|pipe\s*cleaners?\b|\bswabs?\b/i),
    ],
  },
  bong: {
    label: 'Bong setup',
    blurb: 'Glass, a grinder, and everything that keeps it running',
    heat: COMBUSTION,
    consumable: { label: 'To smoke', re: /flower|bud\b|smalls|pre[- ]?roll/i },
    roles: [
      R('bong',    'The bong',    true,  0.50, ['Bongs & Rigs'],
        /\bbongs?\b|water[- ]?pipes?\b|\bbeakers?\b|straight[- ]?tube|\bbubblers?\b/i,
        /attachment|adapter|\bbowl\b|downstem|dab\s*rig|\bmat\b|cleaner/i),
      R('bowl',    'Spare bowl',  false, 0.10, ['Parts & Tools'],
        /herb[- ]?bowls?\b|\bbowls?\b|\bslides?\b/i, /\bmixing\b|\bfood\b/i),
      R('grinder', 'Grinder',     false, 0.15, ['Grinders'], /\bgrinders?\b/i, /\bkit\b.*\bpipe\b/i),
      R('ash',     'Ash catcher', false, 0.12, ['Parts & Tools'], /ash[- ]?catchers?\b/i),
      R('light',   'A light',     false, 0.05, ['Accessories'],
        /\blighters?\b|hemp[- ]?wick/i, /ashtray|lighter\s*style|\bpipe\b|\bcase\b/i),
      R('clean',   'Cleaning',    false, 0.05, null,
        /\bisopropyl\b|\bcleaner\b|cleaning\s*(kit|solution|brush)|resin\s*remov|pipe\s*cleaners?\b|\bplugs?\b/i),
    ],
  },
  vape: {
    label: 'Dry herb vaporizer',
    blurb: 'A vaporizer, a fine grind, and somewhere to keep it',
    heat: VAPOR,
    consumable: { label: 'To vaporize', re: /flower|bud\b|smalls/i },
    roles: [
      /* THE ROLE THAT PROVED THE WHITELIST IS NOT ENOUGH ON ITS OWN. A
         "Handheld Golf Laser Rangefinder with Slope Calculation" is filed
         under Vaporizers by accessoryCat(), so the bucket alone hands you a
         golf gadget. The name must ALSO say what it is. */
      R('vape',    'The vaporizer', true,  0.60, ['Vaporizers'],
        /vapor?izers?\b|dry[- ]?herb|convection|conduction|\bvolcano\b|\bmighty\b|\bcrafty\b|\barizer\b|\bdavinci\b|\bpax\b|\bventy\b|herbal\s*vap/i,
        /\bcarts?\b|\b510\b|disposable|\bcoils?\b|dab[- ]?pen|rangefinder|\bbatter(y|ies)\b/i),
      R('grinder', 'Grinder',       false, 0.18, ['Grinders'], /\bgrinders?\b/i, /\bkit\b.*\bpipe\b/i),
      R('jar',     'Storage',       false, 0.10, ['Storage & Trays'],
        /storage\s*jar|\bstash\b|smell[- ]?proof|airtight|\bcontainers?\b|\bcases?\b/i),
      R('clean',   'Cleaning',      false, 0.07, null,
        /\bisopropyl\b|\bcleaner\b|cleaning\s*(kit|solution|brush)|\bbrush(es)?\b|\bswabs?\b/i),
      R('tray',    'Tray',          false, 0.05, ['Storage & Trays'], /rolling\s*tray|\btrays?\b/i),
    ],
  },
  pen: {
    label: 'Cart and battery',
    blurb: 'The cheapest way in, and the one that fits in a pocket',
    heat: VAPOR,
    consumable: { label: 'To fill it', re: /cartridge|\bcarts?\b|\bpods?\b|disposable/i },
    roles: [
      /* "Keychain Battery SHAPED Smoking Pipe" is a pipe. The exclusion is
         not decoration -- it was the first draft's pick for this role. */
      R('batt',  'The battery', true,  0.70, ['Vaporizers'],
        /\b510\b|\bbatter(y|ies)\b|vape\s*pen/i,
        /disposable|\bshaped\b|\bpipe\b|\bcharger\s*only\b/i),
      R('case',  'Somewhere to keep it', false, 0.15, ['Storage & Trays', 'Accessories'],
        /\bcases?\b|\bstash\b|smell[- ]?proof|\bpouch(es)?\b/i, /nectar|collector|\bpipe\b/i),
      R('clean', 'Cleaning',    false, 0.10, null,
        /\bisopropyl\b|\bswabs?\b|\bcleaner\b|cleaning\s*(kit|solution|brush)/i),
    ],
  },
  roll: {
    label: 'Rolling setup',
    blurb: 'Papers, a grinder, and a flat surface to work on',
    heat: COMBUSTION,
    consumable: { label: 'To roll', re: /flower|bud\b|smalls/i },
    roles: [
      /* A grinder that happens to have a cone filler on it is a GRINDER, and
         it was the first draft's pick for this role on the word "cone". */
      R('papers',  'Papers or cones', true,  0.20, ['Rolling'],
        /rolling\s*papers?|\bpapers?\b|\bcones?\b|blunt\s*wraps?|hemp\s*wraps?/i,
        /\bgrinders?\b|\btray\b/i),
      R('grinder', 'Grinder',         false, 0.35, ['Grinders'], /\bgrinders?\b/i, /\bkit\b.*\bpipe\b/i),
      R('tray',    'Rolling tray',    false, 0.25, ['Storage & Trays', 'Rolling'], /rolling\s*trays?|\btrays?\b/i),
      R('tips',    'Tips',            false, 0.08, ['Rolling'],
        /filter\s*tips?|\btips\b|\broach\b/i, /\b510\b|ceramic|nectar/i),
      R('light',   'A light',         false, 0.07, ['Accessories'],
        /\blighters?\b|hemp[- ]?wick/i, /ashtray|lighter\s*style|\bpipe\b|\bcase\b/i),
      R('case',    'A case',          false, 0.05, ['Storage & Trays', 'Accessories'],
        /\bcases?\b|\bpouch(es)?\b|smell[- ]?proof/i, /nectar|collector/i),
    ],
  },
};

/* ------------------------------------------------------------------ *
 * The roll                                                            *
 * ------------------------------------------------------------------ */

/* Mulberry32. Seeded so a kit can be shared, screenshotted and supported --
   a generator whose answer changes on every reload cannot be any of those.
   Deliberately not Math.random(): the workflow scripts in this repo cannot
   call it at all, and neither can a test that needs to pin an outcome. */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* One draw from the strongest few rather than always the same winner. Same
   shape and the same reason as shelf-shuffle.js's WINDOW. */
const WINDOW = 4;

const priceOf = p => {
  const n = Number((p && (p.sale || p.startsAt)) || 0);
  return n > 0 ? n : 0;
};

/* ------------------------------------------------------------------ *
 * Scoring one candidate for one role                                  *
 * ------------------------------------------------------------------ */

function scoreCandidate(p, role, ctx) {
  const why = [];
  let score = 40;

  /* A kit with a blank tile in it looks broken, and a photograph is the one
     thing a shopper uses to decide they want the thing at all. */
  if (p.image) score += 10; else { score -= 18; why.push('no photo on this listing'); }

  /* HEAT, WHICH IS WHY api/heat.js CAME FIRST. A dab kit must not be filled
     with combustion parts and vice versa. Unclassified is not penalised --
     "" is a real verdict covering grinders, trays and jars, which most of
     these roles want. */
  if (ctx.heat && p.heat) {
    if (p.heat === ctx.heat) { score += 12; why.push(`${p.heat} gear, which is what this rig is`); }
    else { score -= 40; why.push(`${p.heat} gear in a ${ctx.heat} rig`); }
  }

  /* PRICE FIT AGAINST THIS ROLE'S SHARE, not cheapest-wins. Cheapest-wins
     builds a kit out of the worst thing in every category, which is how a
     recommendation loses trust in one purchase. A role that wants 45% of a
     $200 budget is looking for something near $90, and something at $12 is
     as suspicious as something at $300. */
  const price = priceOf(p);
  if (ctx.budget > 0 && price > 0) {
    const target = ctx.budget * role.share;
    const ratio = price / (target || price);
    if (ratio > 0.5 && ratio < 1.6) { score += 16; why.push('priced for this slot'); }
    else if (ratio >= 1.6 && ratio < 2.4) score += 4;
    else if (ratio <= 0.5) { score += 6; why.push('cheap for what it is'); }
    else { score -= 22; why.push('well over what this slot can carry'); }
  } else if (ctx.perStore.length && price > 0) {
    /* No budget given, so value is relative to what this shelf charges for
       this kind of thing -- the same argument as the mood matcher's 80th
       percentile per-gram ceiling. */
    const med = ctx.perStore[Math.floor(ctx.perStore.length / 2)];
    if (med > 0 && price < med) { score += 8; why.push('under the going rate for this slot'); }
  }

  if (p.ship === 0) { score += 4; why.push('ships free'); }
  if (p.coa) score += 2;

  /* A listing whose own feed says a discount is live. */
  if (p.startsAt && p.sale && p.startsAt > p.sale + 0.001) {
    score += 8;
    why.push(`down from $${Number(p.startsAt).toFixed(2)}`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), why };
}

/* ------------------------------------------------------------------ *
 * Building one                                                        *
 * ------------------------------------------------------------------ */

function kitKey(raw) {
  /* Digits are KEPT. Stripping to letters alone turned the '510' alias into
     the empty string, so the one type key a shopper is most likely to type
     verbatim resolved to nothing -- caught by the suite, not by reading. */
  const k = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (KITS[k]) return k;
  if (k === 'rig' || k === 'dabrig' || k === 'concentrate' || k === 'wax') return 'dab';
  if (k === 'glass' || k === 'waterpipe' || k === 'bongs') return 'bong';
  /* The PLURAL is deliberately absent, and this is not an oversight: it is the
     slug of a shelf, and test-shelves.mjs greps every api/ file for a quoted
     shelf slug precisely because it cannot tell a definition from a
     comparison. Nothing outside api/shelves.js should spell one. The singular
     catches the same intent -- kitKey() strips punctuation and case before it
     gets here -- and a shopper who types the plural lands on the default kit
     rather than on a wrong one. Same trade api/heat.js makes with its verdict
     words. */
  if (k === 'dryherb' || k === 'vaporizer' || k === 'herbvape') return 'vape';
  if (k === 'cart' || k === 'carts' || k === 'battery' || k === '510') return 'pen';
  if (k === 'rolling' || k === 'papers' || k === 'joint') return 'roll';
  return null;
}

/* Candidates for one role: in stock, priced, matching the role's test and not
   its exclusion, and not already used by an earlier role in this kit. */
function candidatesFor(pool, role, used) {
  return pool.filter(p => {
    if (used.has(p.id)) return false;
    /* The whitelist, then the name. Both, never either -- see the note on R. */
    if (role.cats && role.cats.indexOf(p.category) < 0) return false;
    const name = String(p.name || '');
    if (!role.re.test(name)) return false;
    if (role.no && role.no.test(name)) return false;
    return true;
  });
}

/* Build one kit.
 *
 * `products` is the whole feed -- gear AND consumables -- because the
 * consumable recommendation is the half that makes it a setup rather than a
 * shopping list, and that lives on the other shelf. */
function buildKit(products, opts = {}) {
  const type = kitKey(opts.type) || 'dab';
  const spec = KITS[type];
  const budget = Number(opts.budget) > 0 ? Number(opts.budget) : 0;
  const seed = Number.isFinite(Number(opts.seed)) && Number(opts.seed) !== 0
    ? Number(opts.seed) : 1;
  const rand = rng(seed);

  const live = (products || []).filter(p => p && p.name && anyInStock(p) && priceOf(p) > 0);
  const gear = live.filter(p => p.cannabinoid === 'Accessory' || p.group === 'gear');

  const used = new Set();
  const picks = [];
  const notes = [];
  let spent = 0;

  /* Required roles first, in order, then the optional ones while the budget
     lasts -- so the order a kit declares its roles IS its priority order. */
  const order = spec.roles.filter(r => r.need).concat(spec.roles.filter(r => !r.need));

  for (const role of order) {
    const cands = candidatesFor(gear, role, used);
    if (!cands.length) {
      notes.push(`Nothing on the shelf could fill ${role.label.toLowerCase()} today.`);
      if (role.need) picks.push({ role: role.key, label: role.label, need: true, product: null });
      continue;
    }
    const prices = cands.map(priceOf).filter(n => n > 0).sort((a, b) => a - b);
    const ctx = { heat: spec.heat, budget, perStore: prices };
    const scored = cands
      .map(p => ({ p, ...scoreCandidate(p, role, ctx) }))
      .sort((a, b) => b.score - a.score);

    /* An optional role is skipped rather than blowing the budget. Required
       roles are always filled, and going over is REPORTED rather than
       silently avoided by picking something wrong. */
    let chosen = null;
    const window = scored.slice(0, Math.min(WINDOW, scored.length));
    const affordable = role.need ? window : window.filter(c => budget <= 0 || spent + priceOf(c.p) <= budget);
    const from = affordable.length ? affordable : (role.need ? window : []);
    if (from.length) chosen = from[Math.floor(rand() * from.length)];

    if (!chosen) {
      notes.push(`Skipped ${role.label.toLowerCase()} -- it would not fit the budget.`);
      continue;
    }
    used.add(chosen.p.id);
    spent += priceOf(chosen.p);
    picks.push({
      role: role.key, label: role.label, need: !!role.need,
      score: chosen.score, why: chosen.why, product: chosen.p,
    });
  }

  /* THE FIT CHECK, run only between the two parts whose joint actually has to
     agree, and reported rather than enforced (see the header). */
  let fit = null;
  const rigPick = picks.find(x => x.role === 'rig' || x.role === 'bong');
  const partPick = picks.find(x => x.role === 'banger' || x.role === 'bowl' || x.role === 'ash');
  if (rigPick && rigPick.product && partPick && partPick.product) {
    const v = jointVerdict(rigPick.product, partPick.product);
    fit = { a: rigPick.role, b: partPick.role, ...v };
    if (v.fit === 'conflict') {
      notes.push(`These two do not go together: ${v.note}. Pick another ${partPick.label.toLowerCase()} or re-roll.`);
    }
  }

  /* The consumable. Not part of the rig total, and kept separate on purpose:
     a rig is bought once and this is bought again every time. */
  let consumable = null;
  if (spec.consumable) {
    const pool = live.filter(p => {
      if (p.cannabinoid === 'Accessory' || p.group === 'gear') return false;
      return spec.consumable.re.test(String(p.name || '') + ' ' + String(p.category || ''));
    });
    /* Ranked on price per gram where the feed has one -- this site's own
       number -- and on price otherwise. */
    const withPerG = pool.filter(p => typeof p.perG === 'number' && p.perG > 0 && !p.offcut);
    const ranked = (withPerG.length ? withPerG.sort((a, b) => a.perG - b.perG) : pool.sort((a, b) => priceOf(a) - priceOf(b)));
    const w = ranked.slice(0, Math.min(WINDOW, ranked.length));
    const c = w.length ? w[Math.floor(rand() * w.length)] : null;
    if (c) {
      consumable = {
        label: spec.consumable.label, product: c,
        why: typeof c.perG === 'number' && c.perG > 0
          ? [`$${c.perG.toFixed(2)}/g, among the best on the shelf today`]
          : ['cheapest of what fits this setup right now'],
      };
    }
  }

  /* SHOPS AND SHIPPING, STATED RATHER THAN OPTIMISED. A kit spanning four
     shops is four deliveries and four shipping charges, and that is a real
     cost this site is uniquely placed to show. Consolidating would undercut
     the comparison; hiding it would be dishonest. So it is reported. */
  const shops = {};
  for (const x of picks) {
    if (!x.product) continue;
    const k = x.product.storeKey || 'unknown';
    shops[k] = shops[k] || { store: x.product.store || k, items: 0, subtotal: 0, ship: 0 };
    shops[k].items++;
    shops[k].subtotal += priceOf(x.product);
    shops[k].ship = Math.max(shops[k].ship, Number(x.product.ship) || 0);
  }
  const shipTotal = Object.values(shops).reduce((a, s) => a + s.ship, 0);

  if (budget > 0 && spent > budget) {
    notes.push(`The parts this rig cannot work without come to $${spent.toFixed(2)}, over the $${budget.toFixed(2)} asked for.`);
  }

  return {
    type, label: spec.label, blurb: spec.blurb, heat: spec.heat, seed, budget,
    picks, consumable, fit, notes,
    totals: {
      gear: Math.round(spent * 100) / 100,
      shipping: Math.round(shipTotal * 100) / 100,
      all: Math.round((spent + shipTotal) * 100) / 100,
      shops: Object.keys(shops).length,
    },
    shops: Object.values(shops).map(s => ({
      ...s, subtotal: Math.round(s.subtotal * 100) / 100,
    })),
  };
}

export { KITS, buildKit, kitKey, jointOf, jointVerdict, rng, WINDOW, normMm };

/* ------------------------------------------------------------------ *
 * Handler                                                             *
 * ------------------------------------------------------------------ */

/* GET /api/kit                      -> the kit types on offer
 * GET /api/kit?type=dab&budget=200  -> one kit, seeded at random
 * GET /api/kit?type=dab&seed=12345  -> that exact kit again
 *
 * ZERO-TOKEN, like GET /api/concierge?mood=. No model is involved: this is
 * real inventory and real arithmetic, so it works on a deploy with no provider
 * key configured and cannot be run up a bill by a stranger.
 *
 * THE SEED IS ALWAYS RETURNED, including when the caller did not supply one.
 * That is what makes a roll shareable -- somebody screenshots a kit, and the
 * seed in the payload is how it is reproduced, supported, or linked to. A
 * generator without it is a slot machine.
 */
export default async function handler(req, res) {
  const q = (req && req.query) || {};

  if (!q.type) {
    res.setHeader('Cache-Control', 'public, s-maxage=600');
    return res.status(200).json({
      kits: Object.keys(KITS).map(k => ({
        key: k, label: KITS[k].label, reads: KITS[k].blurb, heat: KITS[k].heat,
        roles: KITS[k].roles.map(r => ({ key: r.key, label: r.label, need: !!r.need })),
      })),
      note: 'GET ?type=<key> for a whole rig. Add &budget= to size it and &seed= to reproduce one.',
    });
  }

  const type = kitKey(q.type);
  if (!type) {
    return res.status(400).json({
      error: 'unknown kit type',
      known: Object.keys(KITS),
    });
  }

  /* An unseeded call rolls a fresh one. Date.now() is the only entropy here
     and it is used ONCE, at the edge, never inside buildKit -- everything
     downstream of this line is a pure function of (products, type, budget,
     seed), which is what makes the suite able to pin an outcome at all. */
  const seed = Number(q.seed) || (Date.now() % 2147483647);

  let catalogue;
  try {
    catalogue = await loadCatalogue(req);
  } catch (e) {
    /* The shelf is the whole input. Saying so beats returning an empty rig
       that reads as "we sell nothing that fits". */
    return res.status(503).json({ error: 'catalogue unavailable', detail: String(e && e.message || e) });
  }

  const kit = buildKit(catalogue.products, { type, budget: q.budget, seed });

  /* Short, because a kit is a roll: a long CDN window would hand the same
     "random" rig to everybody who arrived in that window, which is the one
     thing this endpoint must not do. Same reasoning as /api/coldwater's
     s-maxage=30 -- long enough to shield the origin, short enough that the
     feature still works. */
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  return res.status(200).json(kit);
}

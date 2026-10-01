/* api/heat.js — combustion or vaporizing, stated once.
 *
 * WHY THIS EXISTS. "We need to do combustion devices and vaporizing devices"
 * -- it is the distinction a head shop actually sorts its wall by, and this
 * site had no word for it. A shopper who owns a dab rig and a shopper who owns
 * a bong want two different halves of the same 2,500-product gear shelf, and
 * `Bongs & Rigs` puts both in one bucket while `Parts & Tools` splits a banger
 * from the rig it screws into.
 *
 * IT IS AN OVERLAY, NOT A CATEGORY. A vaporizer is a Vaporizer AND vaporizing;
 * a banger is Parts & Tools AND vaporizing. Same shape as the trim sub-tag and
 * the four virtual chips: it cuts ACROSS the eight gear buckets rather than
 * replacing one, and `category` is untouched.
 *
 * ------------------------------------------------------------------
 * THE ORDER IS THE RULE, and it is the same argument classify() makes about
 * the synthetics ladder: a name matching both answers gets the first branch,
 * so the order decides the verdict and reordering it is a behaviour change
 * that nothing errors on.
 *
 *   1. VAPORIZING WINS FIRST. "Dry Herb Vaporizer Bong Attachment" carries
 *      both words and is a vaporizer; "Dab Rig" is glass and is vaporizing.
 *      That is the owner's own exception, stated in exactly these terms: a
 *      bong defaults to combusting "unless it's explicitly a dab rig".
 *   2. COMBUSTION SECOND, so a bare "Bong", "Beaker" or "Spoon Pipe" -- which
 *      matched nothing above -- lands where the default belongs.
 *   3. THE SHOP'S OWN DEFAULT LAST, for a catalogue whose product names carry
 *      no signal at all.
 *   4. OTHERWISE NOTHING. A grinder, a tray, a jar and a cleaning kit heat
 *      nothing, and "" is the honest answer for them. An empty string is not
 *      a failure here; it is most of the third bucket.
 *
 * ------------------------------------------------------------------
 * THREE TRAPS, ALL OF WHICH PRODUCE A CONFIDENT WRONG ANSWER:
 *
 * A. ONLY GEAR GETS A VERDICT, AND THE GATE IS INSIDE THIS FUNCTION rather
 *    than left to whoever calls it. "Zangbanger THCA Flower" and "THCa Flower
 *    - Headbanger #7 (Smalls)" are both live products and both contain
 *    `banger`; "Pound Cake" is a strain and "Special Sauce Rosin" is a strain,
 *    and this repo has now shipped that bug twice by matching a device word
 *    inside a flower name. Flower is not a device, so it is refused before a
 *    single regex runs. Putting the gate in the caller means the second caller
 *    forgets it -- which is what the capture lane did with the synthetics
 *    exclusion for months.
 *
 * B. A COIL IS A VAPORIZER PART AND A PERC IS A BONG PART, and `coil perc` is
 *    a real, common bong shape. `\bcoils?\b` alone therefore reads a coil-perc
 *    beaker as an atomizer. The perc veto is narrow on purpose: it suppresses
 *    the COIL signal only, so "Coil Perc Bong" still reaches the combustion
 *    branch on `bong`, and a genuine "Seahorse Replacement Coils" is untouched
 *    because it says nothing about percolators.
 *
 * C. A TORCH IS DELIBERATELY UNCLASSIFIED. It burns butane, which sounds like
 *    combustion, and its whole purpose is heating a banger, which is
 *    vaporizing. Both readings are arguable, so neither is asserted: a bare
 *    torch returns "". `dab torch` is explicit and does get the vaporizing
 *    answer. Precision over recall, the same side isNonConsumable() errs on --
 *    a miss costs one listing an overlay, a false positive files a product
 *    under a heat it does not use.
 */

/* THE VERDICT WORDS ARE NOT THE SHELF SLUGS, AND THAT IS ON PURPOSE. The pages
   are /combustion and /vaporizers; the verdicts are "combusting" and
   "vaporizing" -- both present participles, because a verdict describes what
   the DEVICE DOES and a slug names a PAGE. Keeping them distinct means
   api/shelves.js has to import these constants to build its test rather than
   restating a string that happens to match, which is the difference between a
   link and a coincidence (the same argument the four copies of
   storeCheckoutUrl() lost). It also keeps test-shelves.mjs's registry guard
   blunt: that check greps every api/ file for a quoted shelf slug, and it is
   valuable precisely because it cannot tell a definition from a comparison, so
   nothing outside the registry should spell a slug at all. */
const COMBUSTION = "combusting";
const VAPOR = "vaporizing";

/* Heated without burning: the material is brought under its combustion point.
   Grouped by what each line is about so a future addition lands in the right
   one; they are alternated into a single test below. */
const VAPOR_TESTS = [
  /* Devices whose whole name is the method. */
  /\bvapor?ize(r|rs)?\b|\bvapes?\b|\bvaping\b|dry[- ]?herb|desktop\s*vap|convection|conduction/i,
  /* Concentrate hardware. */
  /dab[- ]?pens?\b|wax[- ]?pens?\b|nectar[- ]?collector|honey[- ]?straw|\bdab[- ]?straw/i,
  /e-?rigs?\b|e-?nails?\b|\benail\b|\berig\b|electric[- ]?dab|induction[- ]?heater/i,
  /* Cartridges, pods and the batteries that fire them. */
  /\b(510|710|810|910)\b|cartridges?\b|\bcarts?\b|\bpods?\b|disposable|\bbatter(y|ies)\b|\batomizers?\b/i,
  /* The concentrate half of the glass, which is the owner's stated exception:
     glass defaults to combustion UNLESS it is explicitly for dabs. */
  /dab[- ]?rigs?\b|\bbangers?\b|carb[- ]?caps?\b|terp[- ]?(pearls?|slurpers?|beads?|screws?)/i,
  /dab[- ]?(nails?|tools?|mats?|kits?|torch|dish|inserts?)|quartz[- ]?(nail|insert|dish)|titanium[- ]?nail|\bdabbers?\b|\breclaim\b/i,
  /* Device lines whose names carry no method word at all. Brands only -- a
     model number is a guess about somebody else's catalogue. */
  /\bseahorse\b|\bpuffco\b|\bvolcano\b|\bmighty\b|\bcrafty\b|\bdynavap\b|\bpax\b|\bfirefly\b|\barizer\b|\bdavinci\b|storz|boundless|\bxmax\b|tinymight|\bventy\b|\bmigvape\b/i,
];
/* Kept out of the array above because it is the one test with a veto (trap B). */
const COIL = /\bcoils?\b/i;
const PERC_VETO = /\bpercs?\b|percolator/i;

/* Something is set on fire. */
const COMBUSTION_TESTS = [
  /* Water pipes. A bong is a bong whatever you screw onto it -- the owner's
     own point -- and the default for one is combusting. */
  /\bbongs?\b|water[- ]?pipes?\b|\bbeakers?\b|\bbubblers?\b|percolator|straight[- ]?tube|gravity[- ]?(bong|pipe)|\bhookahs?\b|\bshisha\b/i,
  /* Hand pipes. The bare `pipe` at the end is safe BY CONSTRUCTION rather than
     by luck: every pipe that is not a combustion device -- a vapor pipe, a dab
     pipe, a water pipe -- has already been answered by an earlier ladder or an
     earlier line here, so what reaches this test is a pipe nobody has claimed.
     It was added after measuring: 193 Lookah rows came back unclassified and
     the largest group in them was "Hand Carved Rosewood ... Smoking Pipe" and
     "Creative Pagoda Metal Smoking Pipes", which is the most combusting object
     in the catalogue. It also sweeps pipe screens, cases and cleaners onto the
     combustion side, which is where they serve. */
  /hand[- ]?pipes?\b|spoon[- ]?pipes?\b|\bchillums?\b|one[- ]?hitters?\b|\bdugouts?\b|sherlock|gandalf|glass[- ]?blunts?\b|steam[- ]?roller|\bbats?\s*(and|&)?\s*dugout|\bpipes?\b/i,
  /* Rolling. Nothing here is heated any other way. */
  /rolling[- ]?(papers?|machine|kit)|\bpapers?\b|\bcones?\b|blunt[- ]?wraps?\b|hemp[- ]?wraps?\b|filter[- ]?tips?\b|\broach\b|\bdoob\b/i,
  /* Parts that exist only on a combusting device -- ash is the tell, and a
     bowl or a slide holds flower where a banger holds concentrate. */
  /ash[- ]?catchers?\b|\bashtrays?\b|herb[- ]?bowls?\b|\bbowls?\b|\bslides?\b|down[- ]?stems?\b|\bscreens?\b|\bsnuffers?\b/i,
  /* Ignition. */
  /\blighters?\b|hemp[- ]?wick|\bflints?\b|\bmatches\b/i,
];

/* A shop whose product names carry no method word, consulted only after both
   ladders come back empty. Deliberately almost empty: a store default is a
   blunt instrument that answers for a whole catalogue at once, so it is set
   only where the shop sells one kind of thing and the names do not say so.

   Hitoki is here because the owner named it: their laser IGNITES the flower,
   so a Trident or a Saber is a combustion device however electronic it looks,
   and neither name contains a word either ladder tests for. */
const STORE_DEFAULT = { hitoki: COMBUSTION };

/* Only a device gets a verdict (trap A). Flower, edibles, tinctures and
   apparel are not heated by anything on this shelf, and their names are full
   of device words. `accessory` is how both feeds already say "this is gear". */
function isGear(p) {
  return !!p && (p.cannabinoid === "Accessory" || p.group === "gear" || p.accessory === true);
}

/* The verdict for one product: COMBUSTION, VAPOR, or the empty string -- and
   the empty string is a real answer, not a failure. Named through the
   constants rather than spelled out, both because the words are theirs to
   define and because a quoted slug in a comment is enough to trip the registry
   guard in test-shelves.mjs. That guard has now gone red against prose six
   times in this repo (the !important note in plate.css, normCategory, the
   shelf-defaults block naming #toggleFilters, twice more) -- the rule is the
   same every time: strip the comments before you ask, or do not write the
   string in one. */
function heatOf(p) {
  if (!isGear(p)) return "";
  const hay = [p && p.name, p && p.category, p && p.type, p && p.brand]
    .filter(Boolean).join(" ");
  if (!hay) return STORE_DEFAULT[p && p.storeKey] || "";

  for (const re of VAPOR_TESTS) if (re.test(hay)) return VAPOR;
  if (COIL.test(hay) && !PERC_VETO.test(hay)) return VAPOR;
  for (const re of COMBUSTION_TESTS) if (re.test(hay)) return COMBUSTION;

  return STORE_DEFAULT[p && p.storeKey] || "";
}

export { COMBUSTION, VAPOR, STORE_DEFAULT, isGear, heatOf };

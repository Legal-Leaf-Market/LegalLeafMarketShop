/* api/scene.js — what a curated shop carries, and what it lets past.
 *
 * "We could do huge electronic places, but filter down to what would be good
 * for gaming and really do that."
 *
 * THIS IS THE THIRD TIME THIS SITE HAS NEEDED THE SAME IDEA, and the owner
 * named the other two: Legal-Leaf Market refuses Δ8 and the synthetics
 * (EXCLUDE in api/products.js), and Kawaii Katz refuses clothing that is not
 * kid-appropriate. A curated shop is defined as much by what it turns away as
 * by what it stocks, and in every case the rule has to live in ONE file that
 * both the feed and the diagnostics read.
 *
 * WRITTEN HERE, FOR A SITE THAT DOES NOT EXIST YET. Brayton's scene shop will
 * be a fork of this codebase -- api/products.js already reads Shopify
 * /products.json and nearly every merchant on the shortlist is Shopify -- so
 * the rule travelling with the fork is the point. Nothing in this repo imports
 * it yet, and that is fine: it costs nothing and it is testable today.
 *
 * ------------------------------------------------------------------
 * IT IS AN ADMISSION GATE, WHICH IS A THIRD JOB.
 *
 *   api/shelves.js   SLICES a catalogue that is already ours
 *   api/heat.js      OVERLAYS an axis across gear we already carry
 *   api/scene.js     decides whether we carry the thing AT ALL
 *
 * Confusing the three is how a shop ends up with a shelf for refrigerators.
 *
 * ------------------------------------------------------------------
 * AN ALLOWLIST, NOT A BLOCKLIST, AND THE DIFFERENCE IS THE WHOLE DESIGN.
 *
 * EXCLUDE works as a blocklist because the thing being refused is a short,
 * closed vocabulary: there are maybe a dozen synthetic cannabinoids and they
 * are all named. "Everything Newegg sells that is not gaming" is neither short
 * nor closed -- it is white goods, car parts, medical devices, office
 * furniture, kitchen scales and ten thousand things nobody has thought of. A
 * blocklist against that leaks by construction, and the leak is invisible:
 * nothing errors, the shop just quietly stops being curated.
 *
 * So the default is REFUSE, and a product has to earn its way in. The cost is
 * recall -- genuinely good things will be turned away because nobody wrote the
 * word -- and that is the right cost. A missing product is a gap somebody
 * notices and fixes; a fridge on a gaming shelf is the shop losing its
 * character, and by the time it is obvious there are four hundred of them.
 * Same side of the line isNonConsumable() and the synthetics gate err on.
 *
 * ------------------------------------------------------------------
 * THE ADMIT RULES ARE DELIBERATELY SPECIFIC, WHICH LOOKS LIKE TIMIDITY AND IS
 * NOT. `\bchair\b` would admit every office chair a big catalogue carries;
 * `gaming chair` admits the one we want. `\blaptop\b` admits a business
 * ultrabook; `gaming laptop` does not. Every rung below that could have been
 * written as a bare noun and was not, was not for this reason.
 *
 * VETOES ARE FOR COLLISIONS ONLY -- words a specific admit rule cannot avoid
 * sharing. A baby monitor and a gaming monitor are both monitors; a car
 * amplifier and a headphone amplifier are both amps. The veto list stays short
 * BECAUSE the allowlist does the work; if it starts growing, an admit rule has
 * been written too loosely and that is where to fix it.
 */

/* The shop's departments. Exported so a fork's shelf registry can slice on
   them without restating the vocabulary -- the mistake api/shelves.js exists
   to prevent. */
const SCENE_CATS = [
  "Battlestation",   // the desk: keys, mice, pads, chairs, lighting
  "Displays",
  "Audio",
  "Power & cables",
  "Play",            // consoles, controllers, handhelds, retro, arcade
  "Capture",         // streaming and recording
  "Build",           // PC parts, cooling, cases, 3D printing, maker
  "Collect",         // figures, TCG, plush, print
  "Wear",
];

/* ORDER IS THE RULE, as it is in classify() and heatOf(). A product matching
   two rungs gets the first, so the more specific department goes above the
   more general one: a "streaming microphone" is Capture, not Audio; a "gaming
   monitor" is Displays, not Battlestation. Reordering this list is a
   behaviour change that nothing errors on. */
const ADMIT = [
  ["Capture", /capture\s*card|stream\s*deck|streaming\s*(mic|microphone|kit|light)|\bwebcam\b|\belgato\b|green\s*screen|ring\s*light|\bshock\s*mount\b|\bpop\s*filter\b|boom\s*arm/i],

  ["Play", /\bconsole\b|\bcontroller\b|\bgamepad\b|\bjoystick\b|\bjoy-?con\b|\bdualsense\b|\bdualshock\b|\bhandheld\s*(console|gaming)|\bsteam\s*deck\b|\bswitch\s*(oled|lite|dock|case)|\bnintendo\b|playstation|\bxbox\b|\bnes\b|\bsnes\b|game\s*boy|gameboy|\bfamicom\b|\bsega\b|\batari\b|retro\s*(gam|console|handheld)|\barcade\s*(stick|cabinet|machine|button|joystick)|\bfight\s*stick\b|\bemulat|\bpinball\b|\bamiibo\b|game\s*cartridge/i],

  ["Displays", /gaming\s*monitor|\bmonitor\b.*(gaming|144hz|165hz|240hz|curved|ultrawide|portable)|portable\s*monitor|ultrawide\s*monitor|\bprojector\b|monitor\s*(arm|stand|riser)|\boled\s*monitor\b/i],

  ["Battlestation", /\bkeyboards?\b|\bkeycaps?\b|\bkeyswitch|switch\s*tester|\bmouse\s*pad|mousepad|\bdesk\s*mat|deskmat|gaming\s*(mouse|chair|desk|glove)|racing\s*chair|\bwrist\s*rest\b|cable\s*management|\brgb\s*(strip|light|panel|sign)|led\s*(strip|panel|sign)|\bhex\s*light|desk\s*(shelf|riser|pad)|\bmouse\s*bungee|\bcoiled\s*cable\b|artisan\s*keycap/i],

  /* The amplifier forms are QUALIFIED rather than bare, and this rung is where
     the allowlist's cost showed up in testing: "Fosi Audio BT20A Bluetooth
     Amplifier" -- a real brand, and the best electronics fit on the merchant
     shortlist -- was refused, because `headphone amp` and `dac/amp` were the
     only amp forms written. A bare \bamp\b would fix it and would also admit
     every guitar and PA amplifier in a big catalogue. So the qualifiers are
     named instead. Car and marine amps are refused a step earlier by the
     automotive veto, which is what that veto is for. */
  ["Audio", /\bheadsets?\b|\bheadphones?\b|\bearbuds?\b|\biems?\b|in-?ear\s*monitor|\bdac\b|\bheadphone\s*amp|\bdac\/amp|\b(bluetooth|desktop|stereo|integrated|class[\s-]?d|tube)\s*amp(lifier)?\b|\bhi-?fi\b|\bbookshelf\s*speaker|desktop\s*speaker|\bsoundbar\b|\bmicrophone\b|\bxlr\b|audio\s*interface|\bturntable\b|\bvinyl\s*record/i],

  ["Power & cables", /power\s*bank|\bpowerbank\b|\bgan\s*charger|usb-?c\s*(charger|cable|hub|dock)|charging\s*(dock|station|stand)|\bthunderbolt\b|\bhdmi\b|\bdisplayport\b|\bkvm\s*switch|\busb\s*hub\b|docking\s*station|surge\s*protect|\bpower\s*strip\b|\bups\b\s*battery|\bsolar\s*(charger|panel)/i],

  ["Build", /\bgpu\b|graphics\s*card|\bmotherboard\b|\bcpu\s*cooler|\baio\s*cooler|water\s*cool|\bthermal\s*paste|\bpc\s*case\b|\bmini-?itx\b|\bpsu\b|power\s*supply\s*unit|\bnvme\b|\bssd\b|\bram\b\s*(kit|module|memory)|\bddr[45]\b|case\s*fan|\bmini\s*pc\b|gaming\s*(pc|laptop|rig)|3d\s*print|\bfilament\b|\bresin\s*print|soldering|\bmultimeter\b|raspberry\s*pi|\barduino\b/i],

  ["Collect", /\bfunko\b|\bnendoroid\b|\bfigma\b|\bamiibo\b|scale\s*figure|\bfigurine\b|blind\s*box|\bgachapon\b|\bgashapon\b|\bplush(ie|ies)?\b|\btrading\s*cards?\b|\btcg\b|booster\s*(box|pack)|card\s*sleeve|\bplaymat\b|\bdeck\s*box\b|\bdice\s*(set|tray)\b|\bminiature\b|\bwarhammer\b|\bposters?\b|\bart\s*print|\bwall\s*scroll|\bmanga\b|\bcomics?\b|\bvinyl\s*figure/i],

  ["Wear", /\bcosplay\b|\bhoodie\b|\bt-?shirt\b|\btee\b|\bsnapback\b|\bbeanie\b|\bjersey\b|\benamel\s*pin|\bpatches?\b|\blanyard\b|\bbackpack\b|\bsling\s*bag\b|\bkigurumi\b|\bharajuku\b|\bdecora\b|\blolita\b/i],
];

/* COLLISIONS ONLY, AND EVERY ENTRY MUST BE LOAD BEARING.
 *
 * A veto exists because a specific admit rung above cannot avoid sharing a
 * word with something this shop does not sell -- "Office Chair with RGB Light"
 * reaches Battlestation, "Hearing Aid Headphones" reaches Audio, "Wedding
 * Hoodie" reaches Wear, "Mechanical Keyboard Masterclass Course" reaches
 * Battlestation on the word keyboard.
 *
 * THE FIRST DRAFT HAD TEN AND TWO OF THEM GUARDED NOTHING. `appliance` and
 * `beauty` were written on the assumption that a blocklist was needed for
 * fridges and moisturiser; the allowlist already refuses both by default,
 * because no admit rung comes near them. Dead code that looks like a guard is
 * worse than no code -- somebody later reads the list, believes refrigerators
 * are handled here, and loosens a rung. They were deleted, and test-scene.mjs
 * now proves each survivor by probing what the ADMIT rungs would wrongly admit
 * WITHOUT it. A veto with no leak is dead and the suite says so.
 *
 * If this list starts growing, an admit rung has been written too loosely.
 * Fix it there, not here. */
const VETO = [
  ["medical",    /\bbaby\b|\binfant\b|\bblood\s*pressure|heart\s*rate\s*monitor|\bfetal\b|\bhearing\s*aid|\bnebuli|\bthermometer\b|\bglucose\b|\bcpap\b/i],
  ["automotive", /\bcar\s*(audio|amp|speaker|charger|stereo|dvd)|\bmarine\s*(audio|speaker)|\bsubwoofer\s*box|\bdash\s*cam|\bobd2?\b|\bmotorcycle\b/i],
  ["office",     /\boffice\s*chair|\bexecutive\s*chair|\bfiling\s*cabinet|\blaminator\b|\bshredder\b|\bprinter\s*(ink|toner|cartridge)|\bink\s*cartridge|\blabel\s*maker/i],
  ["industrial", /\bindustrial\b|\bcnc\s*machine|\bforklift\b|\bwelding\s*helmet|\blathe\b|\bhvac\b|\bsurveillance\s*(system|dvr)/i],
  ["apparel-generic", /\bwedding\b|\bbridal\b|\blingerie\b|\bswimwear\b|\bmaternity\b|\bscrubs\b|\bworkwear\b|\buniform\b/i],
  ["pet",        /\bdog\b|\bcat\s*(toy|tree|litter)|\bpet\s*(bed|toy|bowl)|\baquarium\b|\bcanine\b|\bfeline\b/i],
  /* Carried over from this repo's own EXCLUDE, because a scene shop that
     accidentally lists a vape has the SAME publisher-approval problem that
     keeps this whole site off Impact's gaming programmes. */
  ["restricted", /\bcbd\b|\bthc\b|\bthca\b|\bdelta[\s-]?[89]\b|\bkratom\b|\bnicotine\b|\be-?liquid\b|\bvape\s*juice|\bbong\b|\bdab\s*rig\b/i],
  ["not-a-product", /\bgift\s*card\b|\bcourse\b|\bebook\b|\bmasterclass\b|\bcoaching\b|\bpresets?\b|\bbacklink|\bseo\s*service|\bsubscription\s*only\b/i],
];

const hayOf = p => [p && p.name, p && p.category, p && p.type, p && p.brand, p && p.tags]
  .filter(Boolean).join(" ");

/* The full answer, for diagnostics: which department, or why not.
 *
 * REFUSALS ARE COUNTED, not silent, and that is what makes an allowlist
 * survivable. `?debug` on a fork can print exactly what this rule turned away
 * and on which rung -- so "the catalogue looks thin" is answerable by reading
 * a tally rather than by guessing, which is the same reason api/products.js
 * keeps its drop counts per store. An allowlist you cannot audit is an
 * allowlist that slowly strangles the shop. */
function sceneVerdict(p) {
  const hay = hayOf(p);
  if (!hay.trim()) return { ok: false, cat: "", reason: "noName" };

  /* Vetoes run FIRST. A "baby monitor" must not be admitted as Displays and
     then argued about; a "car amplifier" must not become Audio. The admit
     rules are specific enough that this rarely fires, which is the intent --
     it is a backstop, not the mechanism. */
  for (const [why, re] of VETO) if (re.test(hay)) return { ok: false, cat: "", reason: "veto:" + why };

  for (const [cat, re] of ADMIT) if (re.test(hay)) return { ok: true, cat, reason: "" };

  /* THE DEFAULT, AND THE WHOLE POINT. Nobody wrote a word for it, so we do not
     carry it. This is where the fridge goes, and the kitchen scale, and the
     nine thousand things a big catalogue holds that a scene shop does not. */
  return { ok: false, cat: "", reason: "notScene" };
}

/* The department, or "" for a product this shop does not carry. */
function sceneCat(p) {
  return sceneVerdict(p).cat;
}

/* Convenience for a feed's filter step. */
function inScene(p) {
  return sceneVerdict(p).ok;
}

export { SCENE_CATS, ADMIT, VETO, sceneVerdict, sceneCat, inScene };

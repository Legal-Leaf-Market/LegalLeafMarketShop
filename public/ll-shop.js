/* public/ll-shop.js -- the homepage feed and the collection slicers on the Shopify storefront.
 *
 * WHERE IT RUNS. shop.legalleafmarket.shop, mounted by two-line Custom Liquid sections, the same
 * way shop-dispensary.js is (code lives HERE, versioned; the theme holds only the mount):
 *
 *   Homepage, under the Dispensary / Herbal Leaf / Nicotia cards:
 *     <div id="ll-feed"></div>
 *     <script src="https://cdn.jsdelivr.net/gh/Legal-Leaf-Market/LegalLeafMarketShop@<commit>/public/ll-shop.js" defer></script>
 *
 *   Collection template, above the main product grid:
 *     <div id="ll-slicer" data-collection="{{ collection.handle }}" data-title="{{ collection.title | escape }}" data-heading="off"></div>
 *     <script src="(the same src)" defer></script>
 *
 * WHY jsDelivr, AND WHY A COMMIT. On 2 Nov 2026 Netlify paused production deploys for the team
 * (out of plan credits), so https://legalleafmarket.shop/ll-shop.js answered 404 while the merge
 * that added it sat on main. The repo is public, so jsDelivr serves this file straight from
 * GitHub. Pin the src to a commit: a pinned file never changes under the theme, so a live page
 * only moves when somebody edits the src. To ship a change: merge it, then put the new commit in
 * BOTH theme sections. Once Netlify deploys again the src can go back to
 * https://legalleafmarket.shop/ll-shop.js.
 *
 * WHAT IT READS. The storefront's own public /products.json (or /collections/<h>/products.json),
 * same origin, paged at 250. Price and stock are read live on every load, so the rules below are
 * enforced against today's catalogue, not a list typed once.
 *
 * THE FEED RULES (owner, 2 Nov 2026): a curated blend, like flipping an old magazine or a social
 * feed. Nothing over $250, and anything over $150 must be glass worth it (bong, rig, bubbler).
 * No bulk lots ("100 cigars for $1,000"). Sold-out items never show. Smoking blends, Herbal Leaf
 * teas, a few CBD things, grinders, jars and glass, mixed so no shelf takes over a screen.
 * PICKS is the hand-curated list (by product handle): those lead, the rules fill the rest.
 *
 * WHAT THE FIRST LIVE RUN TAUGHT (2 Nov 2026, 1,728 products). The rules alone, guessing shelves
 * from title words, opened with CBD capsules as the cover story, filled "Herbal Leaf" with vintage
 * ashtrays (the herb shop that sells them is tagged herbal-leaf), showed no apothecary jar and no
 * real glass, and let "Mystery Weed Box ... SUPERANGEBOT" and two vape mouthpieces onto the front
 * page. Four fixes, each of which was needed:
 *   - the shelf comes from Shopify's product_type (TYPE_LANE), which the catalogue fills cleanly,
 *     and only a weak type (Accessories, Incense & Ritual, Storage & Trays) is overruled by what
 *     the thing plainly is: an apothecary jar is a jar, a "Secret Stash" tray is a tray;
 *   - hand PICKS, chosen by looking at the photos, plus a COVERS list that rotates daily;
 *   - caps per maker and per near-identical family, so one brand's twelve ashtrays or eight
 *     colourways of one bong cannot wall up the page;
 *   - FEED_SKIP: never on the front page, whatever the score (parts, multipacks, THC gummies,
 *     marijuana wording, merch). Collections still show all of it; this is the front page only.
 *
 * FAILS OPEN. If the catalogue cannot be read, the feed renders nothing and the collection page
 * keeps the theme's own grid (it is only hidden after the slicers have rendered).
 */
(function () {
  'use strict';
  if (window.__llShop) return;
  window.__llShop = 1;

  /* Hand picks, by Shopify product handle, chosen from the live catalogue on 2 Nov 2026 by looking
   * at the photos rather than the titles. A pick leads its shelf (the rhythm below still mixes
   * shelves, and the daily shuffle reorders picks among themselves); a pick that sells out, goes
   * over the price rules or is deleted simply drops out and the rules fill its place. Add
   * Ada-style picks here. */
  var PICKS = [
    /* glass: one big piece, then character */
    'll-chill-chill-limited-edition-rainbow-mirror', 'll-gg-gg-lamp', 'll-gg-gg-saki-bottle',
    'll-grasscity-la-pipes-mini-sherlock-with-slyme-cane-and-dichro', 'll-grasscity-empire-glassworks-bomber-spoon-pipe',
    'ceramic-cat-pipe-pipe-for-herbs', 'lookah-statue-of-liberty-ceramic-bong', 'll-grasscity-wulf-mods-curv-hand-pipe',
    /* Herbal Leaf: the way in to smoking blends */
    /* (Natural Smoke Shop picks were trimmed from 10 to 6 after a crawl found it holding 7 of the
     * first 27 cards: picks are exempt from VENDOR_CAP, so the cap could not catch it.) */
    'whole-blue-lotus-flowers-extra-large', 'kaleidoscope', 'flower-power-sampler', 'coneheads',
    /* jars and stash */
    '10-oz-glass-apothecary-jar-with-airtight-bamboo-lid', 'll-chill-re-cache-storage-container-matte-black',
    'll-grasscity-famous-x-ceramic-stash-jar-with-lid-black', 'll-grasscity-jay-and-silent-bob-glass-stash-jar-buddy-christ',
    /* grinders */
    'll-grasscity-cheech-chong-s-up-in-smoke-grinder-old', 'll-grasscity-the-beach-bum-4-part-magnetic-aluminum-grinder-moondog-silver',
    'herbs-only-wood-grinder', 'll-zamgrinders-small-4-piece-stainless-steel-grinder',
    /* rolling */
    'll-grasscity-cheech-chong-s-40th-anniversary-aluminum-rolling-tray-red', 'rose-cone', 'll-grasscity-famous-design-space-rolling-tray',
    'raw-classic-pre-rolled-cone-6-piece', 'leopard-print-rolling-papers',
    /* incense and ash */
    'zodiac-sun-ashtray-ceremonial-bowl', 'blue-lotus-ashtray', 'nepali-sandalwood-rope-incense-and-burner',
    'soapstone-smudge-bowl', 'tsubota-pearl-queue-lighter',
    /* a few CBD things, all THC-free or plain CBD */
    'sleep-25mg-thc-free-cbd-gummies', 'cbd-oil-drops', 'rapid-relief-cbd-cream', 'cbd-gummies'
  ];
  var PICK_RANK = {}; PICKS.forEach(function (h, i) { PICK_RANK[h] = i; });

  /* The cover story rotates daily among these, each with its own line of copy. Every one is a photo
   * that holds up at full width. Product facts only: no health or effect claims. */
  var COVERS = [
    { h: 'whole-blue-lotus-flowers-extra-large', d: 'Whole flowers, petals and all. Steep them for tea or crumble them into a blend.' },
    { h: 'll-chill-chill-limited-edition-rainbow-mirror', d: 'Steel that will not shatter, in a finish nobody misses. The one big piece on this page.' },
    { h: 'zodiac-sun-ashtray-ceremonial-bowl', d: 'A vintage sun dish that works as an ashtray or a ceremonial bowl.' },
    { h: '10-oz-glass-apothecary-jar-with-airtight-bamboo-lid', d: 'Ten ounces of glass under an airtight bamboo lid. Keeps a blend fresh and looks good on the shelf.' },
    { h: 'll-gg-gg-lamp', d: 'A small Greek Glass rig shaped like a lava lamp.' },
    { h: 'kaleidoscope', d: 'Red, white and blue lotus in one gourmet blend. Roll it or steep it.' },
    { h: 'll-grasscity-la-pipes-mini-sherlock-with-slyme-cane-and-dichro', d: 'Hand-blown with slyme cane and dichro, and small enough for a pocket.' }
  ];

  var MAX_PRICE = 250;
  var GLASS_ONLY_OVER = 150;
  var FEED_SIZE = 60;
  var VENDOR_CAP = 5;       /* rules-filled cards per maker; picks are exempt */
  var VENDOR_LANE_CAP = 2;  /* rules-filled cards per maker per shelf: no wall of one shop's ashtrays */

  /* ---------------- shared helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return '$' + Number(n).toFixed(2).replace(/\.00$/, ''); }
  function low(s) { return String(s || '').toLowerCase(); }
  function img(src, w) {
    if (!src) return '';
    return src + (src.indexOf('?') > -1 ? '&' : '?') + 'width=' + (w || 600);
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function fetchAll(base) {
    var out = [];
    function page(n) {
      return fetch(base + '?limit=250&page=' + n, { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var list = (j && j.products) || [];
          out = out.concat(list);
          if (list.length === 250 && n < 12) return page(n + 1);
          return out;
        });
    }
    return page(1);
  }

  /* Shelves. `re` is only the last resort for a product with no product_type; plurals are matched
   * on purpose ("Grinders" and "Bongs & Rigs" both missed a singular-only test). */
  var LANES = [
    { k: 'glass', name: 'Glass', re: /\b(bongs?|water ?pipes?|bubblers?|beakers?|rigs?|recyclers?|hand ?pipes?|spoon pipes?|chillums?|one ?hitters?|steamrollers?|glass pipes?|pipes?)\b/ },
    { k: 'herbal', name: 'Herbal Leaf', re: /\b(herbal|smoking blends?|blends?|teas?|botanical|mullein|damiana|lavender|chamomile|raspberry leaf|mugwort|lotus)\b/ },
    { k: 'storage', name: 'Jars & Stash', re: /\b(jars?|apothecary|stash|containers?|canisters?|storage)\b/ },
    { k: 'grinder', name: 'Grinders', re: /\b(grinders?|crushers?|herb mills?)\b/ },
    { k: 'rolling', name: 'Rolling', re: /\b(papers?|cones?|rolling|rollers?|trays?|tips)\b/ },
    { k: 'ritual', name: 'Incense & Ash', re: /\b(incense|ashtrays?|smudge|sage|palo santo|resin|burners?|lighters?)\b/ },
    { k: 'cbd', name: 'CBD', re: /\b(cbd|cbg|cbn)\b/ },
    { k: 'vape', name: 'Vapes', re: /\b(vapes?|vaporizers?|e-?rigs?|nectar collectors?)\b/ },
    { k: 'nicotia', name: 'Nicotia', re: /\b(nicotine|pouch|pouches|snus|cigars?|cigarillos?|tobacco|humidors?)\b/ },
    { k: 'gear', name: 'Gear', re: /./ }
  ];
  var LANE_NAME = {}; LANES.forEach(function (l) { LANE_NAME[l.k] = l.name; });
  /* In a collection's category chips, a shop name is the wrong word for a category. */
  var SLICER_CAT = {}; LANES.forEach(function (l) { SLICER_CAT[l.k] = l.name; });
  SLICER_CAT.nicotia = 'Cigar Accessories'; SLICER_CAT.herbal = 'Herbs & Blends'; SLICER_CAT.gear = 'Accessories';

  /* Shopify product_type -> shelf. The catalogue fills product_type cleanly (2 Nov 2026), so this
   * decides, and the title only breaks a tie for the WEAK types below. */
  var TYPE_LANE = {
    'bongs & rigs': 'glass', 'bongs': 'glass', 'pipes': 'glass', 'dab rigs': 'glass',
    'herbal smokes': 'herbal', 'herbal blends': 'herbal', 'single herbs': 'herbal', 'herbal bundles': 'herbal',
    'herbal teas': 'herbal', 'herbal wellness': 'herbal', 'herbal diffusers': 'herbal',
    'grinders': 'grinder', 'rolling': 'rolling', 'storage & trays': 'storage', 'incense & ritual': 'ritual',
    'cbd edibles': 'cbd', 'cbd oils & capsules': 'cbd', 'cbd topicals': 'cbd', 'cbd drinks': 'cbd',
    'vaporizers': 'vape',
    'nicotine pouches': 'nicotia', 'nicotine-free pouches': 'nicotia', 'nicotine long cut': 'nicotia', 'cigars': 'nicotia', 'tobacco wraps': 'nicotia',
    'accessories': 'gear', 'parts & tools': 'gear'
  };
  /* A weak type is a bin, not a shelf: an herb shop files its apothecary jars under Incense &
   * Ritual, a stash brand files rolling trays under Storage & Trays. For those, what the thing
   * plainly IS wins, in this order (a cigar ashtray is Nicotia before it is an ashtray; a "Secret
   * Stash Rolling Tray" is a tray before it is stash). */
  var WEAK = { gear: 1, ritual: 1, storage: 1, rolling: 1 };
  var WHAT = [
    ['nicotia', /\b(cigars?|cigarillos?|humidors?)\b/],
    ['rolling', /\b(rolling trays?|rolling tray|trays?)\b/],
    ['grinder', /\b(grinders?|herb mills?|crushers?)\b/],
    ['storage', /\b(jars?|apothecary|stash|containers?|canisters?|re ?cache)\b/],
    ['ritual', /\b(ashtrays?|ash tray|incense|smudge|sage|palo santo|resin|burners?|lighters?|wick)\b/],
    ['rolling', /\b(papers?|cones?|rolling)\b/]
  ];

  function textOf(p) {
    return low([p.title, p.product_type, p.vendor, (p.tags || []).join(' ')].join(' '));
  }
  function laneOf(p) {
    var tags = (p.tags || []).map(low);
    var title = low(p.title);
    var byType = TYPE_LANE[low(p.product_type)];
    if (byType && !WEAK[byType]) return byType;
    if (tags.indexOf('nicotia') > -1 || tags.indexOf('cigar-accessories') > -1) return 'nicotia';
    for (var w = 0; w < WHAT.length; w++) if (WHAT[w][1].test(title)) return WHAT[w][0];
    if (byType) return byType;
    var t = textOf(p);
    for (var i = 0; i < LANES.length; i++) if (LANES[i].re.test(t)) return LANES[i].k;
    return 'gear';
  }

  function norm(p) {
    var vs = (p.variants || []).map(function (v) {
      return {
        id: v.id, title: v.title, price: parseFloat(v.price), cmp: parseFloat(v.compare_at_price) || 0,
        ok: v.available !== false, o1: v.option1, o2: v.option2, o3: v.option3
      };
    }).filter(function (v) { return isFinite(v.price) && v.price > 0; });
    var live = vs.filter(function (v) { return v.ok; });
    var pick = (live.length ? live : vs).slice().sort(function (a, b) { return a.price - b.price; })[0];
    if (!pick) return null;
    var images = (p.images || []).map(function (i) { return i.src; });
    var first = (p.images || [])[0] || {};
    var ar = first.width && first.height ? first.width / first.height : 1;
    return {
      p: p, id: p.id, handle: p.handle, title: p.title, vendor: p.vendor || '', type: p.product_type || '',
      tags: (p.tags || []).map(low), lane: laneOf(p), vs: vs, v: pick, price: pick.price,
      sale: pick.cmp > pick.price, stock: live.length > 0, img: images[0] || '', img2: images[1] || '',
      nImg: images.length, ar: Math.max(0.75, Math.min(1.34, ar)),
      text: textOf(p), created: Date.parse(p.published_at || p.created_at || '') || 0,
      options: (p.options || []).map(function (o) { return { name: o.name, pos: o.position, values: o.values }; })
    };
  }

  /* A bulk lot is a box of things priced as one: "100 Cigars", "Case of 24", "50 pack". A capacity
   * is not a lot: "Humidor ... Holds 20-30 Cigars" is one humidor, so capacity phrases are struck
   * before the count is read. */
  var CAPACITY = /\b(holds?|hold up to|up to|for up to|fits?|capacity(?: of)?|stores?)\s+(?:about\s+)?\d+(?:\s*-\s*\d+)?\s*(?:pcs\s+)?(?:cigars?|sticks?|pcs|joints?|cones?)\b/g;
  function isBulk(x) {
    var t = low(x.title + ' ' + x.v.title).replace(CAPACITY, ' ');
    var m = t.match(/\b(\d{2,4})\s*(?:-|\s)?(?:ct|count|pc|pcs|pack|pk|cigars?|sticks?|units?|jars?|tins?)\b/);
    if (m && parseInt(m[1], 10) >= 20) return true;
    if (/\b([4-9]|\d{2,})\s*-?\s*(?:pcs|pc|pk)\b/.test(t)) return true;   /* "6PCS Pumpkin Grinder": six grinders */
    return /\b(case of|box of \d{2,}|wholesale|bulk|master case|display box)\b/.test(t);
  }

  /* Never on the front page, whatever the score. Tested against title + handle only (tags carry
   * shelf names like "Bongs & Rigs" that would trip these). Every line is something that got there.
   * Collections are unaffected: this is the front page's editorial line, not a delisting.
   *
   * TASTE ONLY, NEVER LICENSING (owner, 2 Nov 2026: "ALL products need to be live. I won't push the
   * site until licenses are in place but I need to work on the tech in isolation now"). THC
   * gummies, nicotine pouches and marijuana wording were kept off here for a few minutes on
   * compliance grounds and were put back on that instruction. The licensing gate is the owner's,
   * at launch, and it is not this file's job. */
  var FEED_SKIP_TYPES = { 'parts & tools': 1, 'herbal diffusers': 1 };
  var FEED_SKIP = [
    /* importer and marketplace junk */
    /\b(mystery|superangebot|geschenkgutschein|gutschein|gravur|edelstahl|gift ?card|package protection|savedby|test product|deposit|insurance)\b/,
    /* merch and novelties that are not the shop */
    /\b(stickers?|brooch|keychains?|t-?shirt|hoodie|dice|card dealer|shuffler|ice cube|penis|genitals?)\b/,
    /* parts: right for someone who knows exactly what they need, wrong for a scroll */
    /\b(replacement|mouth ?pieces?|carbon filters?|coils?|screens?|o-?rings?|cartridges?|510|batter(?:y|ies)|neckpieces?|downstems?|bangers?|quartz|nails?|slides?|carb caps?|spinners?|auto-spinner|slurpers?|attachments?|dry top|bong bowls?|bowl pieces?|ash catchers?|dab tools?|dab straws?|sapphire|ceramic tips?|heating tips?|rolling tip|torch(?:es)?|chamber base|lid & plug|lid and plug|plug set|lid set)\b/
  ];
  function skipped(x) {
    if (FEED_SKIP_TYPES[low(x.type)]) return true;
    var t = low(x.title + ' ' + x.handle.replace(/-/g, ' '));
    for (var i = 0; i < FEED_SKIP.length; i++) if (FEED_SKIP[i].test(t)) return true;
    return false;
  }
  function feedEligible(x) {
    if (!x.stock || !x.img) return false;
    if (x.price > MAX_PRICE) return false;
    if (x.price > GLASS_ONLY_OVER && x.lane !== 'glass') return false;
    if (isBulk(x)) return false;
    if (skipped(x)) return false;
    return true;
  }

  /* Things the owner called out as loved on the front page get a nudge, not a guarantee. */
  var LOVED = /\b(apothecary|glass jar|grinder|smoking blend|herbal blend|lotus|tea|cbd|ashtray|rolling tray|mullein|lavender|incense)\b/;
  function score(x, seed) {
    var s = 0;
    if (PICK_RANK[x.handle] != null) s += 8;          /* a pick leads its shelf */
    if (LOVED.test(low(x.title))) s += 2;
    s += Math.min(x.nImg, 5) * 0.3;                   /* a maker that shot five photos usually shot one good one */
    if (x.nImg <= 1) s -= 0.8;
    if (x.sale) s += 0.6;
    if (x.price >= 8 && x.price <= 80) s += 1;        /* the impulse band that makes a feed feel generous */
    if (x.price < 4) s -= 1;                          /* a $2 wick belongs in a set, not a post */
    s += (hash(seed + ':' + x.handle) % 1000) / 1000 * 2.5; /* daily freshness, stable within a day */
    return s;
  }

  /* Two listings are one family when the same maker names them the same way: eight colourways of
   * "Chill - Limited Edition - ... Bong", nine "Jay and Silent Bob Rolling Tray | Medium | ...".
   * A family gets one card. The key is the maker and the shelf plus the first three words of the
   * title once the maker's own name and anything after a " - ", " | " or "(" are dropped. The
   * shelf is in it because one licence sells different things under one name: the Cheech & Chong
   * grinder and the Cheech & Chong tray are not colourways of each other. */
  var STOP = { the: 1, of: 1, and: 1, a: 1, an: 1, with: 1, for: 1, in: 1, s: 1 };
  function famKey(x) {
    var t = low(x.title);
    var v = low(x.vendor);
    if (v && t.indexOf(v) > -1) t = t.replace(v, ' ');
    t = t.split(/\s[|–—-]\s|\(/)[0];
    var w = t.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(function (s) { return s && !STOP[s]; });
    if (!w.length) w = low(x.title).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    return v + ':' + x.lane + ':' + w.slice(0, 3).join(' ');
  }

  /* Magazine rhythm: no two neighbours from one shelf or one maker, shelves rotate, the weightiest
   * shelves recur. Nicotia and vapes appear, briefly; they have their own pages. */
  var RHYTHM = ['glass', 'herbal', 'storage', 'grinder', 'ritual', 'rolling', 'cbd', 'herbal', 'glass', 'ritual', 'storage', 'rolling', 'grinder', 'nicotia', 'herbal', 'gear', 'glass', 'cbd', 'vape'];
  var LANE_CAP = { nicotia: 2, vape: 2, gear: 4, cbd: 5 };
  function curate(items, seed) {
    var buckets = {};
    items.filter(feedEligible)
      .map(function (x) { return { x: x, s: score(x, seed) }; })
      .sort(function (a, b) { return b.s - a.s; })
      .forEach(function (r) { (buckets[r.x.lane] = buckets[r.x.lane] || []).push(r.x); });
    var fam = {}, ven = {}, venLane = {}, seen = {};
    function room(x) {
      if (seen[x.handle] || fam[famKey(x)]) return false;
      if (PICK_RANK[x.handle] != null) return true;
      if ((ven[x.vendor] || 0) >= VENDOR_CAP) return false;
      if ((venLane[x.vendor + '|' + x.lane] || 0) >= VENDOR_LANE_CAP) return false;
      return true;
    }
    /* No maker twice within SPREAD cards where the shelf allows it. "Not the previous card" was
     * not enough: picks skip VENDOR_CAP, so Natural Smoke Shop still came back every other card
     * on the first screen (5 of 24 on 2 Nov 2026). Only the strongest few candidates are
     * considered for the spread, so a weak card is never pulled forward just to vary the maker. */
    var SPREAD = 3, LOOK = 8;
    function nextFrom(b, recent) {
      var prevV = recent[recent.length - 1], notPrev = -1, any = -1, looked = 0;
      for (var k = 0; k < b.length; k++) {
        if (!room(b[k])) continue;
        if (any < 0) any = k;
        if (notPrev < 0 && b[k].vendor !== prevV) notPrev = k;
        if (looked < LOOK && recent.indexOf(b[k].vendor) < 0) return k;
        looked++;
        if (looked >= LOOK && notPrev >= 0) break;
      }
      return notPrev >= 0 ? notPrev : any;
    }
    var out = [], taken = {}, i = 0, guard = 0;
    var start = hash(seed) % RHYTHM.length;
    while (out.length < FEED_SIZE && guard++ < FEED_SIZE * RHYTHM.length * 2) {
      var lane = RHYTHM[(start + i++) % RHYTHM.length];
      var b = buckets[lane];
      if (!b || !b.length) continue;
      if ((taken[lane] || 0) >= (LANE_CAP[lane] || 99)) continue;
      var prev = out[out.length - 1];
      if (prev && prev.lane === lane) continue;
      var k = nextFrom(b, out.slice(-SPREAD).map(function (y) { return y.vendor; }));
      if (k < 0) { buckets[lane] = []; continue; }
      var x = b.splice(k, 1)[0];
      seen[x.handle] = 1; fam[famKey(x)] = 1;
      ven[x.vendor] = (ven[x.vendor] || 0) + 1;
      venLane[x.vendor + '|' + x.lane] = (venLane[x.vendor + '|' + x.lane] || 0) + 1;
      out.push(x); taken[lane] = (taken[lane] || 0) + 1;
    }
    return out;
  }

  /* Today's cover: the first COVERS entry, counted from a daily offset, that is eligible today. */
  function pickCover(items, seed) {
    var byHandle = {}; items.forEach(function (x) { byHandle[x.handle] = x; });
    var n = COVERS.length, off = hash(seed + ':cover') % n;
    for (var i = 0; i < n; i++) {
      var c = COVERS[(off + i) % n], x = byHandle[c.h];
      if (x && feedEligible(x)) return { x: x, d: c.d };
    }
    return null;
  }

  /* Adding to the cart in a way Horizon notices. Nothing in this Horizon build listens for the old
   * `cart:refresh` event, so the item was added while the drawer re-opened with the old contents
   * and the header count stayed put (found by a crawl on 2 Nov 2026). Horizon's cart icon and
   * cart-items-component wait for a CartLinesUpdateEvent from '@shopify/events' whose promise
   * resolves to {cart, detail}, with detail.sections holding the re-rendered drawer; this does
   * what the theme's own product-form.js does. The event must not be dispatched from inside
   * cart-items-component (it ignores its own events), so it goes from the clicked button.
   * Themes without '@shopify/events' fall back to the old event and a count rewrite. */
  var horizonEvents = null;
  function loadHorizonEvents() {
    if (!horizonEvents) {
      try { horizonEvents = import('@shopify/events').then(function (m) { return m; }, function () { return null; }); }
      catch (e) { horizonEvents = Promise.resolve(null); }
    }
    return horizonEvents;
  }
  function legacyRefresh(c) {
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    document.querySelectorAll('.cart-count-bubble span, [data-cart-count], .cart-count').forEach(function (el) {
      if (/^\d+$/.test(el.textContent.trim())) el.textContent = c.item_count;
    });
  }
  function addToCart(id, qty, sourceEl) {
    var ids = [].concat(id).map(function (v) { return +v; });
    var n = qty || 1;
    var sectionIds = [].map.call(document.querySelectorAll('cart-items-component'), function (e) { return e.dataset.sectionId; }).filter(Boolean);
    return loadHorizonEvents().then(function (mod) {
      var Ev = mod && mod.CartLinesUpdateEvent, deferred = null;
      if (Ev && Ev.createPromise) {
        deferred = Ev.createPromise();
        (sourceEl || document.body).dispatchEvent(new Ev({
          action: 'add', context: 'product',
          lines: ids.map(function (v) { return { merchandiseId: v, quantity: n }; }),
          promise: deferred.promise
        }));
      }
      return fetch('/cart/add.js', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: ids.map(function (v) { return { id: v, quantity: n }; }), sections: sectionIds.join(',') })
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.description || 'cart'); return j; }); })
        .then(function (res) {
          return fetch('/cart.js', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (c) {
            if (deferred) {
              deferred.resolve({
                cart: Ev.createCartFromAjaxResponse ? Ev.createCartFromAjaxResponse(c) : c,
                detail: { items: c.items, source: 'll-shop', itemCount: ids.length * n, sections: res.sections, didError: false }
              });
            } else legacyRefresh(c);
            return c;
          });
        })
        .catch(function (err) { if (deferred) deferred.reject(err); throw err; });
    });
  }
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'll-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = msg; toastEl.classList.add('on');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('on'); }, 3200);
  }
  /* The second photo is fetched on the first hover only, so a phone never downloads it. */
  function bindAlt(root) {
    if (!window.matchMedia || !matchMedia('(hover:hover)').matches) return;
    root.addEventListener('mouseover', function (e) {
      var post = e.target.closest && e.target.closest('.ll-post');
      var alt = post && post.querySelector('img.alt[data-alt]');
      if (alt) { alt.src = alt.getAttribute('data-alt'); alt.removeAttribute('data-alt'); }
    });
  }
  function skeleton(label, withRow) {
    var cells = ''; for (var i = 0; i < 8; i++) cells += '<div class="ll-sk"></div>';
    var row = ''; if (withRow) for (var j = 0; j < 9; j++) row += '<div class="ll-sk"></div>';
    return '<p class="ll-load" role="status">' + label + '</p>' + (withRow ? '<div class="ll-skrow" aria-hidden="true">' + row + '</div>' : '') +
      '<div class="ll-skgrid" aria-hidden="true">' + cells + '</div>';
  }
  function bindCart(root) {
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]');
      if (!b) return;
      e.preventDefault();
      var ids = b.getAttribute('data-add').split(',');
      if (b.disabled) return;
      b.disabled = true; var was = b.textContent; b.textContent = 'Adding...'; b.classList.add('busy');
      addToCart(ids, 1, b).then(function () {
        b.classList.remove('busy'); b.classList.add('ok'); b.textContent = 'Added \u2713';
        toast('Added to your cart. <a href="/cart">View cart</a>');
      }).catch(function () {
        b.classList.remove('busy'); b.classList.add('err'); b.textContent = 'Not added';
        toast('Could not add that. Try the product page.');
      }).then(function () { setTimeout(function () { b.disabled = false; b.classList.remove('ok', 'err'); b.textContent = was; }, 1800); });
    });
  }

  /* ---------------- styles ---------------- */
  /* Smoothing pass (8 Nov 2026, owner: "smooth out the aesthetics"). What changed and why:
   * cards rise in on paint and lift on hover (hover devices only), the photo zooms a touch inside
   * its frame and swaps to the second photo where there is one; selects and search carry their own
   * chevron and icon instead of the browser's; every tap target in a card is at least 36px; the
   * loading state is a skeleton that still says "Loading"; the heart pops; the Add button shows
   * what happened (Adding, Added, failed). All motion is off under prefers-reduced-motion. */
  var CSS = [
    '.ll-x{--bg:#0b0f17;--card:#141a26;--card2:#18202e;--line:#263044;--line2:#34415c;--ink:#f4f6fb;--muted:#9aa6bd;--soft:#c9d2e3;--accent:#4ec9ff;--a2:#8b5cf6;--gold:#f0b93c;',
    '--ease:cubic-bezier(.2,.7,.2,1);--shadow:0 14px 34px rgba(0,0,0,.42);',
    'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);background:radial-gradient(1200px 420px at 10% -10%,rgba(78,201,255,.07),transparent 60%),radial-gradient(900px 380px at 100% 0,rgba(139,92,246,.07),transparent 60%),var(--bg);',
    'border-radius:20px;padding:24px 18px 38px;max-width:1400px;margin:24px auto;box-sizing:border-box;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}',
    '@media(max-width:560px){.ll-x{padding:18px 12px 28px;border-radius:16px;margin:12px auto}}',
    '.ll-x *{box-sizing:border-box}',
    '.ll-x a{color:inherit}',
    '.ll-x .ll-kicker{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin:0 0 6px}',
    '.ll-x h2.ll-h{margin:0;font:800 clamp(28px,4vw,42px)/1.04 Georgia,"Times New Roman",serif;letter-spacing:-.015em;text-wrap:balance}',
    '.ll-x .ll-sub{color:var(--muted);font-size:14px;line-height:1.5;margin:8px 0 0;max-width:46em}',
    /* story circles */
    '.ll-x .ll-stories{display:flex;gap:12px;overflow-x:auto;padding:18px 4px 8px;scrollbar-width:none;scroll-snap-type:x proximity;overscroll-behavior-x:contain}',
    '.ll-x .ll-stories::-webkit-scrollbar{display:none}',
    '@media(max-width:760px){.ll-x .ll-stories{margin:0 -12px;padding-left:12px;padding-right:12px;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}}',
    '.ll-x .ll-story{all:unset;cursor:pointer;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:7px;width:76px;text-align:center;scroll-snap-align:start;-webkit-tap-highlight-color:transparent}',
    '.ll-x .ll-story span.r{width:68px;height:68px;border-radius:50%;padding:3px;background:conic-gradient(from 210deg,var(--gold),var(--a2),var(--accent),var(--gold));transition:transform .25s var(--ease),box-shadow .25s var(--ease),filter .25s}',
    '.ll-x .ll-story[aria-pressed="true"] span.r{box-shadow:0 0 0 2px var(--bg),0 0 0 4px rgba(78,201,255,.55),0 6px 18px rgba(78,201,255,.25)}',
    '.ll-x .ll-story img,.ll-x .ll-story i{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid var(--bg);background:#fff;transition:transform .35s var(--ease)}',
    '.ll-x .ll-story b{font-size:11.5px;font-weight:700;line-height:1.2;color:var(--soft);transition:color .2s}',
    '.ll-x .ll-story[aria-pressed="true"] b{color:var(--accent)}',
    '@media(hover:hover){.ll-x .ll-story:not(.off):hover span.r{transform:translateY(-2px)}.ll-x .ll-story:not(.off):hover img{transform:scale(1.07)}.ll-x .ll-story:not(.off):hover b{color:var(--ink)}}',
    '.ll-x .ll-story:active span.r{transform:scale(.94)}',
    '.ll-x .ll-story:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:10px}',
    /* toolbar */
    '.ll-x .ll-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}',
    '.ll-x input[type=search],.ll-x select{background-color:#0f1520;color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:9px 12px;font:inherit;font-size:14px;min-height:42px;transition:border-color .2s,box-shadow .2s,background-color .2s;outline:none}',
    '.ll-x select{-webkit-appearance:none;appearance:none;cursor:pointer;padding-right:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%278%27 viewBox=%270 0 12 8%27%3E%3Cpath d=%27M1 1.5l5 5 5-5%27 fill=%27none%27 stroke=%27%239aa6bd%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 8px}',
    '.ll-x select option{background:#0f1520;color:var(--ink)}',
    '.ll-x input[type=search]{flex:1 1 220px;min-width:0;padding-left:38px;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239aa6bd%27 stroke-width=%272.2%27 stroke-linecap=%27round%27%3E%3Ccircle cx=%2711%27 cy=%2711%27 r=%277%27/%3E%3Cpath d=%27M20 20l-3.5-3.5%27/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:13px center;background-size:16px 16px}',
    '.ll-x input[type=search]::-webkit-search-cancel-button{filter:invert(.7)}',
    '.ll-x input[type=search]:hover,.ll-x select:hover{border-color:var(--line2)}',
    '.ll-x input[type=search]:focus,.ll-x select:focus-visible{border-color:var(--accent);box-shadow:0 0 0 3px rgba(78,201,255,.18);background-color:#111a27}',
    '.ll-x input::placeholder{color:#7d89a0;opacity:1}',
    '.ll-x .ll-chip{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid var(--line);background:rgba(78,201,255,.06);transition:border-color .2s,background .2s,color .2s}',
    '@media(hover:hover){.ll-x .ll-chip:hover{border-color:var(--line2);background:rgba(78,201,255,.1)}}',
    '.ll-x .ll-chip small{opacity:.7;margin-left:4px}',
    '.ll-x .ll-chip[aria-pressed="true"],.ll-x .ll-chip:has(input:checked){background:linear-gradient(90deg,rgba(23,135,196,.35),rgba(34,168,232,.28));border-color:rgba(78,201,255,.55);color:#fff}',
    '.ll-x .ll-chip:focus-visible,.ll-x .ll-chip:focus-within{outline:2px solid var(--accent);outline-offset:2px}',
    '.ll-x .ll-count{color:var(--muted);font-size:13px;margin:4px 0 12px;font-variant-numeric:tabular-nums}',
    /* cards: the feed is masonry, the collection is a grid; both share .ll-post */
    /* masonry by hand (colsFor/masonry below): row-major, so the curated order reads left to right,
       and prefix-stable, so loading more never moves a card that is already on screen */
    '.ll-x .ll-cols{display:flex;gap:16px;align-items:flex-start}',
    '.ll-x .ll-col{flex:1 1 0;min-width:0}',
    '@media(max-width:760px){.ll-x .ll-cols{gap:10px}}',
    '@keyframes llIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
    '@keyframes llShimmer{0%{background-position:150% 0}100%{background-position:-50% 0}}',
    '@keyframes llPop{0%{transform:scale(1)}40%{transform:scale(1.28)}100%{transform:scale(1)}}',
    '.ll-x .ll-post{display:block;margin:0 0 16px;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:18px;overflow:hidden;',
    'animation:llIn .5s var(--ease) both;transition:transform .3s var(--ease),box-shadow .3s var(--ease),border-color .3s}',
    '@media(max-width:760px){.ll-x .ll-post{margin-bottom:10px;border-radius:16px}}',
    '.ll-x .ll-post:nth-child(2){animation-delay:.04s}.ll-x .ll-post:nth-child(3){animation-delay:.08s}.ll-x .ll-post:nth-child(4){animation-delay:.12s}.ll-x .ll-post:nth-child(5){animation-delay:.16s}.ll-x .ll-post:nth-child(n+6){animation-delay:.2s}',
    '.ll-x .ll-post.still,.ll-x .ll-cover.still{animation:none}',
    '@media(hover:hover){.ll-x .ll-post:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:var(--line2)}}',
    '.ll-x .ll-post .ph{position:relative;display:block;overflow:hidden;background:#fff linear-gradient(100deg,#f3f5f8 30%,#fff 50%,#f3f5f8 70%);background-size:200% 100%;animation:llShimmer 1.4s linear infinite}',
    '.ll-x .ll-post .ph img{display:block;width:100%;height:auto;aspect-ratio:var(--ar,1);object-fit:cover;background:#fff;transition:transform .6s var(--ease),opacity .35s ease}',
    '.ll-x .ll-post .ph img.alt{position:absolute;inset:0;height:100%;opacity:0;pointer-events:none}',
    '@media(hover:hover){.ll-x .ll-post:hover .ph img{transform:scale(1.035)}.ll-x .ll-post:hover .ph img.alt[src]{opacity:1}}',
    '.ll-x .ll-post .tag{position:absolute;z-index:1;left:8px;top:8px;background:rgba(11,15,23,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#fff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;border-radius:999px}',
    '.ll-x .ll-post .tag.sale{left:auto;right:8px;background:var(--gold);color:#1a1300}',
    '.ll-x .ll-post .bd{position:relative;padding:11px 12px 12px}',
    /* two lines at most: 92 titles run past 90 characters and one runs to 232 */
    '.ll-x .ll-post .t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:700;line-height:1.32;text-decoration:none;transition:color .2s}',
    '@media(hover:hover){.ll-x .ll-post .t:hover{color:var(--accent)}}',
    '.ll-x .ll-post .m{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px}',
    '.ll-x .ll-post .pr{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;line-height:1.2}',
    '.ll-x .ll-post .pr s{color:var(--muted);font-weight:500;font-size:12px;margin-left:5px}',
    '.ll-x .ll-post .v{color:var(--muted);font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ll-x .ll-add{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:36px;font-size:12.5px;font-weight:800;padding:0 14px;border-radius:999px;background:var(--ink);color:#0b0f17;white-space:nowrap;',
    'transition:background .2s,color .2s,transform .15s var(--ease),box-shadow .2s;-webkit-tap-highlight-color:transparent}',
    '@media(hover:hover){.ll-x .ll-add:hover{background:var(--accent);box-shadow:0 6px 16px rgba(78,201,255,.3)}}',
    '.ll-x .ll-add:active{transform:scale(.95)}',
    '.ll-x .ll-add:disabled{cursor:default}',
    '.ll-x .ll-add.busy{opacity:.75}',
    '.ll-x .ll-add.ok{background:#34d399;color:#04130c}',
    '.ll-x .ll-add.err{background:#ff6b8a;color:#1a0207}',
    '.ll-x .ll-add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.ll-x .ll-save{all:unset;cursor:pointer;position:absolute;z-index:1;right:8px;bottom:8px;width:34px;height:34px;border-radius:50%;background:rgba(11,15,23,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#fff;display:grid;place-items:center;font-size:16px;transition:background .2s,color .2s,transform .15s var(--ease);-webkit-tap-highlight-color:transparent}',
    '@media(hover:hover){.ll-x .ll-save:hover{background:rgba(11,15,23,.85)}}',
    '.ll-x .ll-save:active{transform:scale(.9)}',
    '.ll-x .ll-save[aria-pressed="true"]{color:#ff6b8a;background:rgba(255,255,255,.92)}',
    '.ll-x .ll-save.pop{animation:llPop .35s var(--ease)}',
    '.ll-x .ll-save:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    /* cover + editorial cards */
    /* the cover shows the whole photo: most are product shots on white, and a bong cropped to a
       landscape frame loses its top and its base */
    '.ll-x .ll-cover{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:0;background:linear-gradient(135deg,#161f30,#121827 55%,#17132a);border:1px solid var(--line);border-radius:22px;overflow:hidden;margin:8px 0 20px;box-shadow:var(--shadow);animation:llIn .55s var(--ease) both}',
    '@media(max-width:760px){.ll-x .ll-cover{grid-template-columns:1fr;border-radius:18px}}',
    '.ll-x .ll-cover a.ci{display:block;background:#fff;overflow:hidden}',
    '.ll-x .ll-cover img{display:block;width:100%;aspect-ratio:1;max-height:480px;object-fit:contain;background:#fff;transition:transform .8s var(--ease)}',
    '@media(hover:hover){.ll-x .ll-cover a.ci:hover img{transform:scale(1.03)}}',
    '@media(max-width:760px){.ll-x .ll-cover img{max-height:340px}}',
    '.ll-x .ll-cover .cb{padding:26px clamp(18px,3vw,40px);display:flex;flex-direction:column;justify-content:center;gap:12px}',
    '.ll-x .ll-cover h3{margin:0;font:800 clamp(24px,3vw,36px)/1.08 Georgia,serif;letter-spacing:-.01em;text-wrap:balance}',
    '.ll-x .ll-cover .dek{margin:0;color:var(--soft);font-size:15.5px;line-height:1.6;max-width:36em}',
    '.ll-x .ll-cover .ll-add{min-height:44px;padding:0 22px;font-size:14px}',
    '.ll-x .ll-set p.dk{margin:2px 0 0;color:var(--soft);font-size:12.5px;line-height:1.45}',
    '.ll-x .ll-note{padding:18px 16px;background:linear-gradient(160deg,#1b2440,#16122a);position:relative}',
    '.ll-x .ll-note::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--gold),var(--a2),var(--accent))}',
    '.ll-x .ll-note h4{margin:0 0 6px;font:800 20px/1.15 Georgia,serif}',
    '.ll-x .ll-note p{margin:0 0 12px;color:var(--soft);font-size:13.5px;line-height:1.55}',
    '.ll-x .ll-note a.go{display:inline-flex;align-items:center;gap:4px;min-height:32px;font-weight:700;font-size:13px;color:var(--accent);text-decoration:none;transition:gap .2s var(--ease)}',
    '@media(hover:hover){.ll-x .ll-note a.go:hover{gap:9px}}',
    '.ll-x .ll-set{padding:14px}',
    '.ll-x .ll-set .th{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}',
    '.ll-x .ll-set .th a{display:block;background:#fff;border-radius:10px;overflow:hidden}',
    '.ll-x .ll-set .th img{display:block;width:100%;aspect-ratio:1;object-fit:cover;transition:transform .5s var(--ease)}',
    '@media(hover:hover){.ll-x .ll-set .th a:hover img{transform:scale(1.06)}}',
    '.ll-x .ll-set ul{margin:0 0 12px;padding:0;list-style:none;font-size:12.5px;color:var(--soft)}',
    '.ll-x .ll-set li{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dashed rgba(38,48,68,.8)}',
    '.ll-x .ll-set li:last-child{border-bottom:0}',
    '.ll-x .ll-set li b{font-variant-numeric:tabular-nums}',
    '.ll-x .ll-set .ll-add{display:flex;width:100%}',
    '.ll-x .ll-end{text-align:center;padding:30px 10px 6px;color:var(--muted)}',
    '.ll-x .ll-end b{display:block;color:var(--ink);font:800 21px Georgia,serif;margin-bottom:6px}',
    '.ll-x .ll-end a{color:var(--accent);text-decoration:none;font-weight:700}',
    '.ll-x .ll-more{all:unset;box-sizing:border-box;cursor:pointer;display:block;margin:14px auto 0;padding:12px 24px;border-radius:999px;border:1px solid var(--line);background:rgba(78,201,255,.05);font-weight:700;font-size:14px;text-align:center;transition:border-color .2s,background .2s,transform .15s var(--ease)}',
    '@media(hover:hover){.ll-x .ll-more:hover{border-color:var(--accent);background:rgba(78,201,255,.1)}}',
    '.ll-x .ll-more:active{transform:scale(.97)}',
    '.ll-x .ll-more:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '@media(max-width:560px){.ll-x .ll-more{display:block;width:100%;box-sizing:border-box}}',
    '.ll-x .ll-empty{padding:34px 18px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:16px;line-height:1.6}',
    /* loading: a skeleton of the page to come, and the word Loading for anyone who cannot see it */
    '.ll-x .ll-load{color:var(--muted);font-size:13px;margin:0 0 12px}',
    '.ll-x .ll-sk{border-radius:16px;background:linear-gradient(100deg,#121926 30%,#1a2333 50%,#121926 70%);background-size:200% 100%;animation:llShimmer 1.3s linear infinite}',
    '.ll-x .ll-skrow{display:flex;gap:12px;overflow:hidden;margin:14px 0}',
    '.ll-x .ll-skrow .ll-sk{flex:0 0 68px;height:68px;border-radius:50%}',
    '.ll-x .ll-skgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}',
    '@media(max-width:560px){.ll-x .ll-skgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}',
    '.ll-x .ll-skgrid .ll-sk{height:280px}',
    '.ll-x .ll-skgrid .ll-sk:nth-child(3n+2){height:240px}',
    /* collection slicer: the homepage's story circles in one scrolling row, arrows on desktop */
    '.ll-x .ll-srow{position:relative}',
    '.ll-x .ll-srow .ll-stories{scroll-behavior:smooth}',
    '.ll-x .ll-srow .ll-story b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:76px}',
    '.ll-x .ll-story.off{opacity:.3;cursor:default}',
    '.ll-x .ll-arw{all:unset;cursor:pointer;position:absolute;top:35px;z-index:2;width:36px;height:36px;border-radius:50%;display:none;place-items:center;background:rgba(20,26,38,.92);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);border:1px solid var(--line2);color:var(--ink);font-size:22px;line-height:1;box-shadow:0 6px 18px rgba(0,0,0,.5);transition:background .2s,transform .15s var(--ease)}',
    '.ll-x .ll-arw:hover{background:#1d2638}.ll-x .ll-arw:active{transform:scale(.92)}',
    '.ll-x .ll-arw.l{left:-8px}.ll-x .ll-arw.r{right:-8px}',
    '.ll-x .ll-srow.can-l .ll-arw.l,.ll-x .ll-srow.can-r .ll-arw.r{display:grid}',
    '.ll-x .ll-arw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '@media(hover:none){.ll-x .ll-srow .ll-arw{display:none!important}}',
    '.ll-x .ll-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 14px}',
    '.ll-x .ll-meta .ll-count{margin:0 auto 0 0}',
    '@media(max-width:560px){.ll-x .ll-meta .ll-count{flex:1 0 100%;margin:0 0 2px}.ll-x .ll-meta select{flex:1 1 auto}}',
    '.ll-x .ll-meta .ll-chip{display:inline-flex;align-items:center;gap:6px;padding:0 12px;min-height:34px;font-size:12.5px}',
    '.ll-x .ll-chip input{margin:0;accent-color:var(--accent)}',
    '.ll-x .ll-meta select{min-height:34px;padding:5px 32px 5px 12px;font-size:13px;border-radius:999px;background-position:right 11px center}',
    '.ll-x .ll-clr{all:unset;cursor:pointer;color:var(--muted);font-size:12.5px;font-weight:600;text-decoration:underline;text-underline-offset:3px;padding:8px 4px;transition:color .2s}',
    '.ll-x .ll-clr:hover{color:var(--ink)}',
    '.ll-x .ll-clr:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}',
    '.ll-x .ll-bar select{max-width:220px}',
    '@media(max-width:560px){.ll-x .ll-bar select{flex:1 1 calc(50% - 4px);min-width:0;max-width:none}}',
    /* collection grid */
    '.ll-x .ll-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}',
    '@media(max-width:560px){.ll-x .ll-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}',
    '.ll-x .ll-grid .ll-post{margin:0;display:flex;flex-direction:column}',
    '.ll-x .ll-grid .ll-post .ph img{aspect-ratio:1}',
    '.ll-x .ll-grid .ll-post .bd{flex:1;display:flex;flex-direction:column}',
    '.ll-x .ll-grid .ll-post .m{margin-top:auto;padding-top:9px}',
    '.ll-x .ll-grid .oos{color:var(--muted);font-size:12px;font-weight:700;padding:4px 10px;border:1px solid var(--line);border-radius:999px}',
    '.ll-x details.ll-more-f summary{cursor:pointer;color:var(--muted);font-size:13px;margin:10px 0}',
    /* a two-up grid on a small phone has no room for price and button side by side: stack them the
       same way on every card so the row stays even */
    '@media(max-width:420px){.ll-x .ll-post .bd{padding:10px}.ll-x .ll-post .m{flex-direction:column;align-items:stretch;gap:8px}.ll-x .ll-post .m .ll-add,.ll-x .ll-post .m .oos{width:100%;text-align:center;justify-content:center}}',
    '.ll-toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translate(-50%,24px) scale(.98);opacity:0;pointer-events:none;background:rgba(20,26,38,.94);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#fff;border:1px solid #34415c;padding:12px 18px;border-radius:14px;font:600 14px system-ui,sans-serif;z-index:99999;box-shadow:0 16px 40px rgba(0,0,0,.5);transition:transform .3s cubic-bezier(.2,.7,.2,1),opacity .25s;max-width:calc(100vw - 32px)}',
    '.ll-toast.on{transform:translate(-50%,0) scale(1);opacity:1;pointer-events:auto}',
    '.ll-toast a{color:#4ec9ff;margin-left:6px;font-weight:700}',
    '@media(prefers-reduced-motion:reduce){.ll-x *,.ll-x *::before,.ll-toast{animation:none!important;transition:none!important}.ll-x .ll-post:hover{transform:none}}'
  ].join('');
  function injectCss() {
    if (document.getElementById('ll-shop-css')) return;
    var s = document.createElement('style'); s.id = 'll-shop-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  /* saved items, per device only */
  var SAVE_KEY = 'll_saved';
  function saved() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); } catch (e) { return []; } }
  function toggleSave(h) {
    var s = saved(), i = s.indexOf(h);
    if (i > -1) s.splice(i, 1); else s.push(h);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
    return i < 0;
  }

  function postHTML(x, opts) {
    opts = opts || {};
    var ar = opts.ar || x.ar || 1;   /* the photo's own shape, clamped: that is what staggers the columns */
    var isSaved = saved().indexOf(x.handle) > -1;
    var multi = x.vs.length > 1;
    var cta = !x.stock ? '<span class="oos">Sold out</span>'
      : multi ? '<a class="ll-add" href="/products/' + esc(x.handle) + '">Options</a>'
      : '<button class="ll-add" type="button" data-add="' + x.v.id + '">Add</button>';
    return '<article class="ll-post">' +
      '<a class="ph" href="/products/' + esc(x.handle) + '" style="--ar:' + ar + '">' +
      '<img loading="lazy" decoding="async" src="' + esc(img(x.img, 600)) + '" alt="' + esc(x.title) + '">' +
      (x.img2 ? '<img class="alt" alt="" decoding="async" data-alt="' + esc(img(x.img2, 600)) + '">' : '') +
      (opts.tag !== false ? '<span class="tag">' + esc(LANE_NAME[x.lane] || 'Gear') + '</span>' : '') +
      (x.sale ? '<span class="tag sale">Sale</span>' : '') +
      '</a>' +
      '<div class="bd" style="position:relative">' +
      '<a class="t" href="/products/' + esc(x.handle) + '">' + esc(x.title) + '</a>' +
      (x.vendor ? '<div class="v">' + esc(x.vendor) + '</div>' : '') +
      '<div class="m"><span class="pr">' + (multi ? 'From ' : '') + money(x.price) + (x.sale ? '<s>' + money(x.v.cmp) + '</s>' : '') + '</span>' + cta + '</div>' +
      '</div>' +
      '</article>';
  }

  /* ---------------- HOMEPAGE FEED ---------------- */
  var NOTES = [
    { k: 'Herbal Leaf', h: 'Meet the smoking blends', p: 'Herbal Leaf is our corner for botanical smoking blends and teas: mullein, damiana, lavender and friends, made by small makers.', href: '/collections/herbal-leaf-market', go: 'Browse Herbal Leaf' },
    { k: 'Dispensary', h: 'Flower, compared', p: 'The Dispensary lines up flower and more from partner shops side by side, so you can see the price per gram before you click through.', href: '/pages/dispensary', go: 'Open the Dispensary' },
    { k: 'Delivery', h: 'Free local delivery', p: 'We deliver free across South Central Indiana. We do not ship.', href: '/cart', go: 'View your cart' },
    { k: 'Nicotia', h: 'Pouches, cigars and more', p: 'Nicotia is the nicotine side of the shop, kept on its own shelf.', href: '/collections/nicotia-market', go: 'Browse Nicotia' }
  ];
  /* Sets: three things that are bought together, by handle. Each slot lists fallbacks in order; the
   * first in stock wins, and a set with an empty slot is not shown at all (two-thirds of a set is
   * not a set). The cheapest in-stock size is the one added, and its size is printed. */
  var SETS = [
    { h: 'Mix your own blend', d: 'A mullein base, lavender for the nose, and a jar to keep it in.',
      slots: [['10-oz-glass-apothecary-jar-with-airtight-bamboo-lid', 'glass-apothecary-jar-with-wood-lid'], ['mullein'], ['lavender-flowers-lavandula-certified-organic', 'damiana-leaf-turnera-diffusa']] },
    { h: 'The rolling session', d: 'A blend made for cones, the cones, and something to grind with.',
      slots: [['coneheads', 'chiapas-green-label'], ['raw-classic-pre-rolled-cone-6-piece', 'rose-cone'], ['herbs-only-wood-grinder', 'revolution-herb-mill']] },
    { h: 'Wind down', d: 'Sandalwood incense, a lavender-and-mint blend, and a THC-free gummy.',
      slots: [['nepali-sandalwood-rope-incense-and-burner', 'nepali-sandalwood-rope-incense'], ['luna', 'blue-sky'], ['sleep-25mg-thc-free-cbd-gummies', 'calm-25mg-thc-free-cbd-gummies']] },
    { h: 'Glass night', d: 'A blown-glass bottle, a steel stash jar and a grinder to go with them.',
      slots: [['ll-gg-gg-saki-bottle', 'll-grasscity-empire-glassworks-bomber-spoon-pipe'], ['ll-chill-re-cache-storage-container-matte-black', 'll-grasscity-famous-x-ceramic-stash-jar-with-lid-black'], ['ll-grasscity-cheech-chong-s-up-in-smoke-grinder-old', 'll-grasscity-the-beach-bum-4-part-magnetic-aluminum-grinder-moondog-silver']] }
  ];
  function setPicks(def, byHandle) {
    var picks = [];
    def.slots.forEach(function (slot) {
      for (var i = 0; i < slot.length; i++) {
        var x = byHandle[slot[i]];
        if (x && x.stock && x.img && x.price <= MAX_PRICE && picks.indexOf(x) < 0) { picks.push(x); return; }
      }
    });
    return picks.length === def.slots.length ? picks : null;
  }

  function feed(mount) {
    injectCss();
    mount.classList.add('ll-x');
    mount.innerHTML = skeleton('Loading the feed...', true);
    fetchAll('/products.json').then(function (raw) {
      var all = raw.map(norm).filter(Boolean);
      var seed = new Date().toISOString().slice(0, 10);
      var list = curate(all, seed);
      if (!list.length) { mount.innerHTML = ''; mount.style.display = 'none'; return; }
      var cover = pickCover(all, seed);
      if (cover) list = [cover.x].concat(list.filter(function (x) { return x !== cover.x; }));
      renderFeed(mount, list, all, seed, cover ? cover.d : '');
    }).catch(function () { mount.innerHTML = ''; mount.style.display = 'none'; });
  }

  /* Which shop a product belongs to. Herbal Leaf and Nicotia already have their own cards above
   * the feed, so they are a separate selector, never circles (owner, 2 Nov 2026: "they are already
   * up top ... it should at least be its own selector"). The circles are categories only. */
  var SHOPS = [
    { k: 'legal-leaf', name: 'Legal-Leaf' }, { k: 'herbal-leaf', name: 'Herbal Leaf' }, { k: 'nicotia', name: 'Nicotia' }
  ];
  var NOT_A_CIRCLE = { herbal: 1, nicotia: 1 };
  function shopOf(x) {
    if (x.tags.indexOf('nicotia') > -1) return 'nicotia';
    if (x.tags.indexOf('herbal-leaf') > -1) return 'herbal-leaf';
    return 'legal-leaf';
  }

  /* Column count follows the old column-count breakpoints, measured on the mount, not the window. */
  function colsFor(el) { var w = el.clientWidth || innerWidth; return w > 1068 ? 4 : w > 728 ? 3 : 2; }
  /* Greedy shortest-column, on heights estimated from each photo's own aspect ratio (known before
   * any image loads). Greedy is prefix-stable: the first N cards land in the same columns whether
   * N or N+24 are dealt, which is what lets the feed grow without anything jumping. */
  function masonry(parts, n) {
    var cols = [], h = [];
    for (var i = 0; i < n; i++) { cols.push([]); h.push(0); }
    parts.forEach(function (pt) {
      var k = 0; for (var j = 1; j < n; j++) if (h[j] < h[k] - 0.01) k = j;
      cols[k].push(pt.html); h[k] += pt.h;
    });
    return '<div class="ll-cols">' + cols.map(function (c) { return '<div class="ll-col">' + c.join('') + '</div>'; }).join('') + '</div>';
  }

  function renderFeed(mount, list, all, seed, dek) {
    var st = { lane: '', shop: '', q: '', price: '', sort: 'curated', savedOnly: false, shown: 24 };
    var lanesPresent = LANES.filter(function (l) { return !NOT_A_CIRCLE[l.k] && list.some(function (x) { return x.lane === l.k; }); });
    var shopsPresent = SHOPS.filter(function (s) { return list.some(function (x) { return shopOf(x) === s.k; }); });
    var cover = list[0];
    var byHandle = {}; all.forEach(function (x) { byHandle[x.handle] = x; });

    var storyHTML = '<button class="ll-story" type="button" data-lane="" aria-pressed="true"><span class="r"><i style="background:linear-gradient(135deg,#f0b93c,#8b5cf6)"></i></span><b>All</b></button>' +
      lanesPresent.map(function (l) {
        var face = list.filter(function (x) { return x.lane === l.k; })[0];
        return '<button class="ll-story" type="button" data-lane="' + l.k + '" aria-pressed="false"><span class="r"><img alt="" src="' + esc(img(face.img, 160)) + '"></span><b>' + esc(l.name) + '</b></button>';
      }).join('') +
      '<button class="ll-story" type="button" data-lane="__saved" aria-pressed="false"><span class="r"><i style="background:#1b2440;display:grid;place-items:center;color:#ff6b8a;font-size:24px">&#9829;</i></span><b>Saved</b></button>';

    mount.innerHTML =
      '<p class="ll-kicker">The Feed &middot; ' + esc(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })) + '</p>' +
      '<h2 class="ll-h">Things worth a second look</h2>' +
      '<p class="ll-sub">A hand-mixed scroll of glass, jars, blends, CBD and gear. Fresh picks every day, all under $250.</p>' +
      '<div class="ll-stories" role="toolbar" aria-label="Shelves">' + storyHTML + '</div>' +
      '<div class="ll-bar">' +
      '<input type="search" placeholder="Search the feed" aria-label="Search the feed">' +
      (shopsPresent.length > 1 ? '<select aria-label="Shop" data-f="shop"><option value="">All shops</option>' +
        shopsPresent.map(function (s) { return '<option value="' + s.k + '">' + esc(s.name) + '</option>'; }).join('') + '</select>' : '') +
      '<select aria-label="Price" data-f="price"><option value="">Any price</option><option value="0-25">Under $25</option><option value="25-50">$25 to $50</option><option value="50-100">$50 to $100</option><option value="100-250">$100 to $250</option></select>' +
      '<select aria-label="Sort" data-f="sort"><option value="curated">Curated</option><option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select>' +
      '</div>' +
      '<div class="ll-body"></div>';

    var body = mount.querySelector('.ll-body');
    var cols = 0, stillUpTo = 0;
    function more() { stillUpTo = body.querySelectorAll('.ll-post').length; st.shown += 24; paint(); }
    window.addEventListener('resize', function () { if (cols && colsFor(body) !== cols) { stillUpTo = 1e9; paint(); } });

    function filtered() {
      var sv = saved();
      var r = list.filter(function (x) {
        if (st.savedOnly && sv.indexOf(x.handle) < 0) return false;
        if (st.lane && x.lane !== st.lane) return false;
        if (st.shop && shopOf(x) !== st.shop) return false;
        if (st.price) { var b = st.price.split('-'); if (x.price < +b[0] || x.price > +b[1]) return false; }
        if (st.q) { var words = low(st.q).split(/\s+/).filter(Boolean); for (var i = 0; i < words.length; i++) if (x.text.indexOf(words[i]) < 0) return false; }
        return true;
      });
      if (st.sort === 'low') r.sort(function (a, b) { return a.price - b.price; });
      if (st.sort === 'high') r.sort(function (a, b) { return b.price - a.price; });
      if (st.sort === 'new') r.sort(function (a, b) { return b.created - a.created; });
      return r;
    }
    function untouched() { return !st.lane && !st.shop && !st.q && !st.price && st.sort === 'curated' && !st.savedOnly; }

    function setCard(def) {
      var picks = setPicks(def, byHandle);
      if (!picks) return '';
      var total = picks.reduce(function (s, x) { return s + x.price; }, 0);
      function size(x) { return x.vs.length > 1 && x.v.title && !/default title/i.test(x.v.title) ? ' <small style="opacity:.7">(' + esc(x.v.title) + ')</small>' : ''; }
      return '<article class="ll-post ll-set"><p class="ll-kicker" style="margin:0">Shop the set</p><h4 style="margin:2px 0 0;font:800 18px Georgia,serif">' + esc(def.h) + '</h4>' +
        (def.d ? '<p class="dk">' + esc(def.d) + '</p>' : '') +
        '<div class="th">' + picks.map(function (x) { return '<a href="/products/' + esc(x.handle) + '"><img loading="lazy" alt="' + esc(x.title) + '" src="' + esc(img(x.img, 300)) + '"></a>'; }).join('') + '</div>' +
        '<ul>' + picks.map(function (x) { return '<li><span>' + esc(x.title) + size(x) + '</span><b>' + money(x.price) + '</b></li>'; }).join('') + '</ul>' +
        '<button class="ll-add" type="button" data-add="' + picks.map(function (x) { return x.v.id; }).join(',') + '">Add all ' + picks.length + ', ' + money(total) + '</button></article>';
    }
    function noteCard(n) {
      return '<article class="ll-post ll-note"><p class="ll-kicker">' + esc(n.k) + '</p><h4>' + esc(n.h) + '</h4><p>' + esc(n.p) + '</p><a class="go" href="' + esc(n.href) + '">' + esc(n.go) + ' &rarr;</a></article>';
    }

    function paint() {
      var r = filtered();
      var plain = untouched();
      var html = '';
      if (plain && cover) {
        html += '<div class="ll-cover' + (stillUpTo ? ' still' : '') + '"><a class="ci" href="/products/' + esc(cover.handle) + '"><img alt="' + esc(cover.title) + '" src="' + esc(img(cover.img, 1000)) + '"></a>' +
          '<div class="cb"><p class="ll-kicker" style="margin:0">Cover story &middot; ' + esc(LANE_NAME[cover.lane]) + '</p><h3>' + esc(cover.title) + '</h3>' +
          (dek ? '<p class="dek">' + esc(dek) + '</p>' : '') +
          '<p class="ll-sub" style="margin:0">' + esc(cover.vendor) + '</p><div class="m" style="display:flex;gap:12px;align-items:center"><b style="font-size:20px">' + (cover.vs.length > 1 ? 'From ' : '') + money(cover.price) + '</b>' +
          (cover.vs.length > 1 ? '<a class="ll-add" href="/products/' + esc(cover.handle) + '">See options</a>' : '<button class="ll-add" type="button" data-add="' + cover.v.id + '">Add to cart</button>') + '</div></div></div>';
        r = r.slice(1);
      }
      var shown = r.slice(0, st.shown);
      var parts = [], ni = 0, si = 0;
      /* heights in card widths: the photo is 1/ar, the text block about 0.55 of a width */
      shown.forEach(function (x, i) {
        var ar = plain ? (x.ar || 1) : 1;
        parts.push({ html: postHTML(x, plain ? {} : { ar: 1 }), h: 1 / ar + 0.55 });
        if (plain && i % 9 === 4 && ni < NOTES.length) parts.push({ html: noteCard(NOTES[ni++]), h: 1.05 });
        if (plain && i % 9 === 8) { while (si < SETS.length) { var s = setCard(SETS[si++]); if (s) { parts.push({ html: s, h: 1.5 }); break; } } }
      });
      /* cards already on screen before Keep scrolling do not fade in a second time */
      parts.forEach(function (pt, i) { if (i < stillUpTo) pt.html = pt.html.replace('<article class="ll-post', '<article class="ll-post still'); });
      stillUpTo = 0;
      cols = colsFor(body);
      html += r.length ? masonry(parts, cols)
        : '<p class="ll-empty">' + (st.savedOnly ? 'Nothing saved yet. Tap the heart on anything you like.' : 'Nothing matches that. Try another shelf.') + '</p>';
      if (r.length > st.shown) html += '<button class="ll-more" type="button">Keep scrolling (' + (r.length - st.shown) + ' more)</button>';
      else if (r.length) html += '<div class="ll-end"><b>You are all caught up</b>New picks land every day. <a href="/collections/all">Browse everything &rarr;</a></div>';
      body.innerHTML = html;
      watchMore();
      body.querySelectorAll('.ll-post .ph').forEach(function (ph) {
        var h = (ph.getAttribute('href') || '').split('/').pop();
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'll-save'; b.setAttribute('data-save', h);
        var on = saved().indexOf(h) > -1;
        b.setAttribute('aria-label', on ? 'Saved' : 'Save'); b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '&#9829;';
        ph.appendChild(b);
      });
    }

    /* A feed scrolls. The feed is capped at FEED_SIZE, so this always ends at "all caught up" and
     * the footer stays reachable; the slicer, which can run to 1,700 items, keeps its button. */
    var io = null;
    function watchMore() {
      if (!('IntersectionObserver' in window)) return;
      if (io) io.disconnect();
      var btn = body.querySelector('.ll-more');
      if (!btn) return;
      io = new IntersectionObserver(function (ents) {
        if (ents.some(function (en) { return en.isIntersecting; })) { io.disconnect(); more(); }
      }, { rootMargin: '0px 0px 400px 0px' });
      io.observe(btn);
    }
    mount.addEventListener('click', function (e) {
      var s = e.target.closest('.ll-story');
      if (s) {
        var lane = s.getAttribute('data-lane');
        st.savedOnly = lane === '__saved'; st.lane = st.savedOnly ? '' : lane; st.shown = 24;
        mount.querySelectorAll('.ll-story').forEach(function (b) { b.setAttribute('aria-pressed', b === s ? 'true' : 'false'); });
        paint(); return;
      }
      var sv = e.target.closest('[data-save]');
      if (sv) {
        e.preventDefault(); e.stopPropagation();
        var on = toggleSave(sv.getAttribute('data-save'));
        sv.setAttribute('aria-pressed', on ? 'true' : 'false'); sv.setAttribute('aria-label', on ? 'Saved' : 'Save');
        sv.classList.remove('pop'); void sv.offsetWidth; if (on) sv.classList.add('pop');
        if (st.savedOnly) paint(); return;
      }
      if (e.target.closest('.ll-more')) more();
    });
    var t;
    mount.querySelector('input[type=search]').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.q = v.trim(); paint(); }, 200); });
    mount.querySelectorAll('select[data-f]').forEach(function (sel) { sel.addEventListener('change', function () { st[sel.getAttribute('data-f')] = sel.value; paint(); }); });
    bindCart(mount);
    bindAlt(mount);
    paint();
  }

  /* ---------------- COLLECTION SLICERS ---------------- */
  var THEME_GRID = ['#ProductGridContainer', '#product-grid', '#main-collection-product-grid', '.collection .product-grid', '.collection-grid', '.product-grid-container', '[data-collection-grid]'];
  function hideThemeGrid(mount) {
    var hidden = 0;
    THEME_GRID.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (mount.contains(el) || el.contains(mount)) return;
        var sec = el.closest('.shopify-section') || el;
        if (sec.contains(mount)) sec = el;
        sec.style.display = 'none'; hidden++;
      });
    });
    document.querySelectorAll('facet-filters-form, .facets-container, .facets-vertical').forEach(function (el) {
      if (!mount.contains(el)) { var sec = el.closest('.shopify-section') || el; if (!sec.contains(mount)) sec.style.display = 'none'; }
    });
    return hidden;
  }

  function optKind(name) {
    var n = low(name);
    if (/strength|nicotine|\bmg\b|potency/.test(n)) return 'strength';
    if (/flavou?r|scent|taste/.test(n)) return 'flavor';
    return '';
  }

  function slicer(mount) {
    injectCss();
    mount.classList.add('ll-x');
    var handle = mount.getAttribute('data-collection') || '';
    var title = mount.getAttribute('data-title') || 'Shop';
    var base = handle && handle !== 'all' ? '/collections/' + encodeURIComponent(handle) + '/products.json' : '/products.json';
    mount.innerHTML = skeleton('Loading ' + esc(title) + '...', true);
    fetchAll(base).then(function (raw) {
      var all = raw.map(norm).filter(Boolean);
      if (!all.length) { mount.innerHTML = ''; mount.style.display = 'none'; return; }
      all.forEach(function (x) {
        /* A catch-all type (Accessories, Incense & Ritual, Storage & Trays, Rolling) is replaced
         * by what the thing is, so the apothecary jar is not filed under Incense & Ritual and the
         * Accessories collection gets real category chips instead of none. */
        var byType = TYPE_LANE[low(x.type)];
        x.cat = !x.type ? (SLICER_CAT[x.lane] || 'Other')
          : byType && WEAK[byType] && x.lane !== byType ? SLICER_CAT[x.lane] : x.type;
        x.strength = []; x.flavor = [];
        x.options.forEach(function (o) {
          var k = optKind(o.name);
          if (k) x[k] = (o.values || []).filter(function (val) {
            return x.vs.some(function (v) { return v.ok && v['o' + o.pos] === val; });
          });
        });
      });
      renderSlicer(mount, all, title);
      hideThemeGrid(mount);
    }).catch(function () { mount.innerHTML = ''; mount.style.display = 'none'; });
  }

  /* WHICH ROW OF CIRCLES. The collection page wears the homepage's story circles (owner, 2 Nov
   * 2026: "use the main legalleafmarket.shop gallery pills"), not the 99-card brand wall and four
   * chip walls it had, which ran 1,500px before the first product. One row of circles, picked per
   * collection: shelves when the collection spans several (Shop all, Accessories, Herbal Leaf),
   * else product types when those split it (Nicotia: pouches, cigars, wraps), else brands (Bongs
   * & Rigs, Grinders, Pipes, Vaporizers). A field is skipped when one value holds 85% of it (Parts
   * & Tools is 96% one shelf). Every other facet is a dropdown in the bar. */
  function pillField(all) {
    function split(get) {
      var c = {}; all.forEach(function (x) { var v = get(x); if (v) c[v] = (c[v] || 0) + 1; });
      var n = Object.keys(c).length, top = 0; for (var k in c) if (c[k] > top) top = c[k];
      return { n: n, top: top / all.length };
    }
    var lane = split(function (x) { return x.lane; });
    if (lane.n >= 3 && lane.top <= 0.85) return 'lane';
    var cat = split(function (x) { return x.cat; });
    if (cat.n >= 3 && cat.top <= 0.85) return 'cat';
    if (split(function (x) { return x.vendor; }).n >= 2) return 'brand';
    if (cat.n >= 2) return 'cat';
    return '';
  }

  function renderSlicer(mount, all, title) {
    var P = new URLSearchParams(location.search);
    var st = {
      lane: P.get('ll_shelf') || '', brand: P.get('ll_brand') || '', cat: P.get('ll_cat') || '', strength: P.get('ll_str') || '', flavor: P.get('ll_flv') || '',
      price: P.get('ll_price') || '', q: P.get('ll_q') || '', sort: P.get('ll_sort') || 'featured',
      sale: P.get('ll_sale') === '1', stock: P.get('ll_all') !== '1', shown: 36
    };
    function valOf(x, field) { return field === 'brand' ? [x.vendor] : field === 'cat' ? [x.cat] : field === 'lane' ? [x.lane] : x[field]; }
    function distinct(field) { var c = {}; all.forEach(function (x) { valOf(x, field).forEach(function (v) { if (v) c[v] = 1; }); }); return Object.keys(c).length; }
    /* strength and flavor are variant options on a handful of CBD items (5 and 16 of 1,728 on
     * 2 Nov 2026): a dropdown only where at least a tenth of the collection has them */
    function covers(field) { return all.filter(function (x) { return valOf(x, field).length; }).length / all.length; }

    /* the circles: built once, so the row never jumps; paint() only presses and dims them */
    var pf = pillField(all);
    var pills = [];
    if (pf) {
      var tally = {}; all.forEach(function (x) { valOf(x, pf).forEach(function (v) { if (v) tally[v] = (tally[v] || 0) + 1; }); });
      pills = pf === 'lane' ? LANES.filter(function (l) { return tally[l.k]; }).map(function (l) { return l.k; })
        : Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a] || a.localeCompare(b); });
    }
    /* a circle's face: a hand pick if the shelf has one, else the first in-stock photo */
    function faceOf(v) {
      var best = null, rank = 1e9;
      all.forEach(function (x) {
        if (!x.img || valOf(x, pf).indexOf(v) < 0) return;
        var r = (PICK_RANK[x.handle] != null ? PICK_RANK[x.handle] : 5000) + (x.stock ? 0 : 10000);
        if (r < rank) { rank = r; best = x; }
      });
      return best ? best.img : '';
    }
    function pillName(v) { return pf === 'lane' ? LANE_NAME[v] || v : v; }
    var rowLabel = pf === 'lane' ? 'Shelves' : pf === 'cat' ? 'Categories' : 'Brands';
    var storyHTML = pf ? '<div class="ll-srow"><button class="ll-arw l" type="button" tabindex="-1" aria-label="Scroll left">&#8249;</button>' +
      '<div class="ll-stories" role="toolbar" aria-label="' + rowLabel + '">' +
      '<button class="ll-story" type="button" data-k="' + pf + '" data-v="" aria-pressed="true"><span class="r"><i style="background:linear-gradient(135deg,#f0b93c,#8b5cf6)"></i></span><b>All</b></button>' +
      pills.map(function (v) {
        var f = faceOf(v);
        return '<button class="ll-story" type="button" data-k="' + pf + '" data-v="' + esc(v) + '" aria-pressed="false"><span class="r">' +
          (f ? '<img alt="" loading="lazy" src="' + esc(img(f, 160)) + '">' : '<i style="background:#1b2440"></i>') + '</span><b>' + esc(pillName(v)) + '</b></button>';
      }).join('') + '</div><button class="ll-arw r" type="button" tabindex="-1" aria-label="Scroll right">&#8250;</button></div>' : '';

    /* every other facet is a dropdown, shown only when the collection has a choice to make */
    var DROPS = [['cat', 'All types'], ['brand', 'All brands'], ['strength', 'Any strength'], ['flavor', 'Any flavor']]
      .filter(function (d) { return d[0] !== pf && distinct(d[0]) >= 2 && (d[0] === 'cat' || d[0] === 'brand' || st[d[0]] || covers(d[0]) >= 0.1); });

    /* data-heading="off" when the theme's own Heading section already prints the collection title
     * and description above the mount (Horizon's collection template does). */
    var heading = mount.getAttribute('data-heading') === 'off' ? '' : '<p class="ll-kicker">Shop</p><h2 class="ll-h">' + esc(title) + '</h2>';
    mount.innerHTML = heading + storyHTML +
      '<div class="ll-bar">' +
      '<input type="search" placeholder="Search ' + esc(title) + '" aria-label="Search" value="' + esc(st.q) + '">' +
      DROPS.map(function (d) { return '<select data-f="' + d[0] + '" aria-label="' + esc(d[1].replace(/^(All|Any) /, '')) + '"></select>'; }).join('') +
      '<select data-f="price" aria-label="Price"><option value="">Any price</option><option value="0-25">Under $25</option><option value="25-50">$25 to $50</option><option value="50-100">$50 to $100</option><option value="100-250">$100 to $250</option><option value="250-99999">$250 and up</option></select>' +
      '</div>' +
      '<div class="ll-meta"><p class="ll-count"></p>' +
      '<label class="ll-chip"><input type="checkbox" data-t="stock"' + (st.stock ? ' checked' : '') + '> In stock</label>' +
      '<label class="ll-chip"><input type="checkbox" data-t="sale"' + (st.sale ? ' checked' : '') + '> On sale</label>' +
      '<select data-f="sort" aria-label="Sort"><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">Newest</option><option value="az">A to Z</option></select>' +
      '<button class="ll-clr" type="button" data-clear>Clear all</button>' +
      '</div>' +
      '<div class="ll-grid"></div><div class="ll-foot"></div>';
    mount.querySelector('[data-f=price]').value = st.price;
    mount.querySelector('[data-f=sort]').value = st.sort;

    var row = mount.querySelector('.ll-srow'), strip = row && row.querySelector('.ll-stories');
    function arrows() {
      if (!strip) return;
      row.classList.toggle('can-l', strip.scrollLeft > 4);
      row.classList.toggle('can-r', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4);
    }
    if (strip) {
      strip.addEventListener('scroll', arrows, { passive: true });
      window.addEventListener('resize', arrows);
      /* a shared link with a circle chosen opens with that circle in view */
      var on = [].filter.call(strip.querySelectorAll('.ll-story'), function (b) { return st[pf] && b.getAttribute('data-v') === st[pf]; })[0];
      if (on && on.offsetLeft > strip.clientWidth - 80) { strip.style.scrollBehavior = 'auto'; strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + 38; strip.style.scrollBehavior = ''; }
      setTimeout(arrows, 0);
    }

    function pass(x, skip) {
      if (st.stock && !x.stock) return false;
      if (st.sale && !x.sale) return false;
      if (skip !== 'lane' && st.lane && x.lane !== st.lane) return false;
      if (skip !== 'brand' && st.brand && x.vendor !== st.brand) return false;
      if (skip !== 'cat' && st.cat && x.cat !== st.cat) return false;
      if (skip !== 'strength' && st.strength && x.strength.indexOf(st.strength) < 0) return false;
      if (skip !== 'flavor' && st.flavor && x.flavor.indexOf(st.flavor) < 0) return false;
      if (st.price) { var b = st.price.split('-'); if (x.price < +b[0] || x.price > +b[1]) return false; }
      if (st.q) { var w = low(st.q).split(/\s+/).filter(Boolean); for (var i = 0; i < w.length; i++) if (x.text.indexOf(w[i]) < 0) return false; }
      return true;
    }
    function counts(field) {
      var c = {};
      all.forEach(function (x) {
        if (!pass(x, field)) return;
        valOf(x, field).forEach(function (v) { if (v) c[v] = (c[v] || 0) + 1; });
      });
      return c;
    }
    function fillDrop(sel, field, anyLabel) {
      var c = counts(field), keys = Object.keys(c);
      if (st[field] && keys.indexOf(st[field]) < 0) keys.push(st[field]);
      keys.sort(function (a, b) { return field === 'strength' ? (parseFloat(a) || 0) - (parseFloat(b) || 0) : (c[b] || 0) - (c[a] || 0) || a.localeCompare(b); });
      sel.innerHTML = '<option value="">' + anyLabel + '</option>' +
        keys.map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + ' (' + (c[k] || 0) + ')</option>'; }).join('');
      sel.value = st[field];
    }
    function paintPills() {
      if (!strip) return;
      var c = counts(pf);
      strip.querySelectorAll('.ll-story').forEach(function (b) {
        var v = b.getAttribute('data-v'), n = v ? c[v] || 0 : 0, pressed = v ? st[pf] === v : !st[pf];
        b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        if (!v) return;
        var dead = !n && !pressed;
        b.classList.toggle('off', dead); b.disabled = dead;
        b.title = pillName(v) + ' · ' + n + (n === 1 ? ' item' : ' items');
      });
    }
    function syncUrl() {
      var u = new URL(location.href);
      [['ll_shelf', st.lane], ['ll_brand', st.brand], ['ll_cat', st.cat], ['ll_str', st.strength], ['ll_flv', st.flavor], ['ll_price', st.price], ['ll_q', st.q],
        ['ll_sort', st.sort === 'featured' ? '' : st.sort], ['ll_sale', st.sale ? '1' : ''], ['ll_all', st.stock ? '' : '1']]
        .forEach(function (p) { if (p[1]) u.searchParams.set(p[0], p[1]); else u.searchParams.delete(p[0]); });
      history.replaceState(null, '', u.toString());
    }
    function paint() {
      paintPills();
      DROPS.forEach(function (d) { fillDrop(mount.querySelector('select[data-f="' + d[0] + '"]'), d[0], d[1]); });
      var r = all.filter(function (x) { return pass(x); });
      if (st.sort === 'low') r.sort(function (a, b) { return a.price - b.price; });
      if (st.sort === 'high') r.sort(function (a, b) { return b.price - a.price; });
      if (st.sort === 'new') r.sort(function (a, b) { return b.created - a.created; });
      if (st.sort === 'az') r.sort(function (a, b) { return a.title.localeCompare(b.title); });
      mount.querySelector('.ll-count').textContent = r.length === all.length ? all.length + ' items' : r.length + ' of ' + all.length + ' items';
      mount.querySelector('.ll-grid').innerHTML = r.length ? r.slice(0, st.shown).map(function (x) { return postHTML(x, { tag: false }); }).join('')
        : '<p class="ll-empty" style="grid-column:1/-1">Nothing matches those filters. <button class="ll-chip" type="button" data-clear>Clear all</button></p>';
      mount.querySelector('.ll-foot').innerHTML = r.length > st.shown ? '<button class="ll-more" type="button">Show more (' + (r.length - st.shown) + ')</button>' : '';
      syncUrl();
    }
    function clearAll() {
      st.lane = st.brand = st.cat = st.strength = st.flavor = st.price = st.q = ''; st.sort = 'featured'; st.sale = false; st.stock = true; st.shown = 36;
      mount.querySelector('input[type=search]').value = ''; mount.querySelector('[data-f=price]').value = ''; mount.querySelector('[data-f=sort]').value = 'featured';
      mount.querySelector('[data-t=sale]').checked = false; mount.querySelector('[data-t=stock]').checked = true;
      paint();
    }
    mount.addEventListener('click', function (e) {
      var a = e.target.closest('.ll-arw');
      if (a && strip) { strip.scrollBy({ left: (a.classList.contains('l') ? -1 : 1) * Math.max(160, strip.clientWidth * 0.8), behavior: 'smooth' }); return; }
      if (e.target.closest('[data-clear]')) { clearAll(); return; }
      var c = e.target.closest('[data-k]');
      if (c) { if (c.disabled) return; var k = c.getAttribute('data-k'), v = c.getAttribute('data-v'); st[k] = st[k] === v ? '' : v; st.shown = 36; paint(); return; }
      if (e.target.closest('.ll-more')) { st.shown += 36; paint(); }
    });
    var t;
    mount.querySelector('input[type=search]').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.q = v.trim(); st.shown = 36; paint(); }, 200); });
    mount.querySelectorAll('select[data-f]').forEach(function (sel) { sel.addEventListener('change', function () { st[sel.getAttribute('data-f')] = sel.value; st.shown = 36; paint(); }); });
    mount.querySelectorAll('input[data-t]').forEach(function (cb) { cb.addEventListener('change', function () { st[cb.getAttribute('data-t')] = cb.checked; st.shown = 36; paint(); }); });
    bindCart(mount);
    bindAlt(mount);
    paint();
  }

  /* exposed for tests */
  window.LLShop = { norm: norm, curate: curate, feedEligible: feedEligible, isBulk: isBulk, laneOf: laneOf,
    famKey: famKey, pickCover: pickCover, setPicks: setPicks, skipped: skipped, shopOf: shopOf, PICKS: PICKS, COVERS: COVERS, SETS: SETS };

  function boot() {
    var f = document.getElementById('ll-feed');
    if (f && !f.getAttribute('data-ll-ready')) { f.setAttribute('data-ll-ready', '1'); feed(f); }
    var s = document.getElementById('ll-slicer');
    if (s && !s.getAttribute('data-ll-ready')) { s.setAttribute('data-ll-ready', '1'); slicer(s); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

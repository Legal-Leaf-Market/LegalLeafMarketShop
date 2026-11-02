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
    function nextFrom(b, prev) {
      var any = -1;
      for (var k = 0; k < b.length; k++) {
        if (!room(b[k])) continue;
        if (!prev || b[k].vendor !== prev.vendor) return k;
        if (any < 0) any = k;
      }
      return any;
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
      var k = nextFrom(b, prev);
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
  function bindCart(root) {
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]');
      if (!b) return;
      e.preventDefault();
      var ids = b.getAttribute('data-add').split(',');
      b.disabled = true; var was = b.textContent; b.textContent = 'Adding...';
      addToCart(ids, 1, b).then(function () {
        b.textContent = 'Added'; toast('Added to your cart. <a href="/cart">View cart</a>');
      }).catch(function () {
        b.textContent = was; toast('Could not add that. Try the product page.');
      }).then(function () { setTimeout(function () { b.disabled = false; if (b.textContent === 'Added') b.textContent = was; }, 1600); });
    });
  }

  /* ---------------- styles ---------------- */
  var CSS = [
    '.ll-x{--bg:#0b0f17;--card:#141a26;--line:#263044;--ink:#f4f6fb;--muted:#9aa6bd;--accent:#4ec9ff;--a2:#8b5cf6;--gold:#f0b93c;',
    'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--bg);border-radius:18px;padding:22px 16px 36px;max-width:1400px;margin:24px auto;box-sizing:border-box}',
    '.ll-x *{box-sizing:border-box}',
    '.ll-x a{color:inherit}',
    '.ll-x .ll-kicker{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin:0 0 6px}',
    '.ll-x h2.ll-h{margin:0;font:800 clamp(26px,4vw,40px)/1.05 Georgia,"Times New Roman",serif;letter-spacing:-.01em}',
    '.ll-x .ll-sub{color:var(--muted);font-size:14px;margin:6px 0 0}',
    '.ll-x .ll-stories{display:flex;gap:14px;overflow-x:auto;padding:16px 2px 6px;scrollbar-width:none}',
    '.ll-x .ll-stories::-webkit-scrollbar{display:none}',
    '.ll-x .ll-story{all:unset;cursor:pointer;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px;width:76px;text-align:center}',
    '.ll-x .ll-story span.r{width:68px;height:68px;border-radius:50%;padding:3px;background:conic-gradient(var(--gold),var(--a2),var(--accent),var(--gold))}',
    '.ll-x .ll-story img,.ll-x .ll-story i{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid var(--bg);background:#fff}',
    '.ll-x .ll-story b{font-size:11px;font-weight:700;line-height:1.2}',
    '.ll-x .ll-story[aria-pressed="true"] b{color:var(--accent)}',
    '.ll-x .ll-story:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:8px}',
    '.ll-x .ll-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}',
    '.ll-x input[type=search],.ll-x select{background:#0f1520;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;min-height:40px}',
    '.ll-x input[type=search]{flex:1 1 200px;min-width:0}',
    '.ll-x input::placeholder{color:#7d89a0;opacity:1}',
    '.ll-x .ll-chips{display:flex;flex-wrap:wrap;gap:7px}',
    '.ll-x .ll-chip{all:unset;cursor:pointer;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid var(--line);background:rgba(78,201,255,.06)}',
    '.ll-x .ll-chip small{opacity:.7;margin-left:4px}',
    '.ll-x .ll-chip[aria-pressed="true"]{background:linear-gradient(90deg,#1787c4,#22a8e8);border-color:transparent;color:#fff}',
    '.ll-x .ll-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.ll-x .ll-lab{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:14px 0 7px}',
    '.ll-x .ll-count{color:var(--muted);font-size:13px;margin:4px 0 12px}',
    /* masonry feed */
    '.ll-x .ll-cols{column-count:4;column-gap:14px}',
    '@media(max-width:1100px){.ll-x .ll-cols{column-count:3}}',
    '@media(max-width:760px){.ll-x .ll-cols{column-count:2;column-gap:10px}}',
    '.ll-x .ll-post{break-inside:avoid;display:block;margin:0 0 14px;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}',
    '.ll-x .ll-post .ph{position:relative;display:block;background:#fff}',
    '.ll-x .ll-post .ph img{display:block;width:100%;height:auto;aspect-ratio:var(--ar,1);object-fit:cover}',
    '.ll-x .ll-post .tag{position:absolute;left:8px;top:8px;background:rgba(11,15,23,.82);color:#fff;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;border-radius:999px}',
    '.ll-x .ll-post .tag.sale{left:auto;right:8px;background:var(--gold);color:#1a1300}',
    '.ll-x .ll-post .bd{padding:10px 12px 12px}',
    /* two lines at most: 92 titles run past 90 characters and one runs to 232 */
    '.ll-x .ll-post .t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:700;line-height:1.3;text-decoration:none}',
    '.ll-x .ll-post .m{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}',
    '.ll-x .ll-post .pr{font-weight:800;font-size:15px}',
    '.ll-x .ll-post .pr s{color:var(--muted);font-weight:500;font-size:12px;margin-left:5px}',
    '.ll-x .ll-post .v{color:var(--muted);font-size:12px;margin-top:2px}',
    '.ll-x .ll-add{all:unset;cursor:pointer;font-size:12px;font-weight:700;padding:7px 11px;border-radius:999px;background:var(--ink);color:#0b0f17;white-space:nowrap}',
    '.ll-x .ll-add:disabled{opacity:.6;cursor:default}',
    '.ll-x .ll-add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.ll-x .ll-save{all:unset;cursor:pointer;position:absolute;right:8px;bottom:8px;width:32px;height:32px;border-radius:50%;background:rgba(11,15,23,.7);color:#fff;display:grid;place-items:center;font-size:16px}',
    '.ll-x .ll-save[aria-pressed="true"]{color:#ff6b8a}',
    /* cover + editorial cards */
    /* the cover shows the whole photo: most are product shots on white, and a bong cropped to a
       landscape frame loses its top and its base */
    '.ll-x .ll-cover{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:0;background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;margin:6px 0 18px}',
    '@media(max-width:760px){.ll-x .ll-cover{grid-template-columns:1fr}}',
    '.ll-x .ll-cover a.ci{display:block;background:#fff}',
    '.ll-x .ll-cover img{display:block;width:100%;aspect-ratio:1;max-height:520px;object-fit:contain;background:#fff}',
    '@media(max-width:760px){.ll-x .ll-cover img{max-height:380px}}',
    '.ll-x .ll-cover .cb{padding:22px;display:flex;flex-direction:column;justify-content:center;gap:10px}',
    '.ll-x .ll-cover h3{margin:0;font:800 clamp(22px,3vw,32px)/1.1 Georgia,serif}',
    '.ll-x .ll-cover .dek{margin:0;color:#c9d2e3;font-size:15px;line-height:1.55;max-width:36em}',
    '.ll-x .ll-set p.dk{margin:2px 0 0;color:#c9d2e3;font-size:12.5px;line-height:1.45}',
    '.ll-x .ll-note{padding:16px;background:linear-gradient(160deg,#1b2440,#16122a);}',
    '.ll-x .ll-note h4{margin:0 0 6px;font:800 19px/1.15 Georgia,serif}',
    '.ll-x .ll-note p{margin:0 0 10px;color:#c9d2e3;font-size:13.5px;line-height:1.5}',
    '.ll-x .ll-note a.go{font-weight:700;font-size:13px;color:var(--accent);text-decoration:none}',
    '.ll-x .ll-set{padding:14px}',
    '.ll-x .ll-set .th{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}',
    '.ll-x .ll-set .th a{display:block;background:#fff;border-radius:10px;overflow:hidden}',
    '.ll-x .ll-set .th img{display:block;width:100%;aspect-ratio:1;object-fit:cover}',
    '.ll-x .ll-set ul{margin:0 0 10px;padding:0;list-style:none;font-size:12.5px;color:#c9d2e3}',
    '.ll-x .ll-set li{display:flex;justify-content:space-between;gap:8px;padding:2px 0}',
    '.ll-x .ll-end{text-align:center;padding:28px 10px 6px;color:var(--muted)}',
    '.ll-x .ll-end b{display:block;color:var(--ink);font:800 20px Georgia,serif;margin-bottom:4px}',
    '.ll-x .ll-more{all:unset;cursor:pointer;display:block;margin:10px auto 0;padding:11px 20px;border-radius:999px;border:1px solid var(--line);font-weight:700;font-size:14px}',
    '.ll-x .ll-empty{padding:30px;text-align:center;color:var(--muted)}',
    /* collection grid */
    '.ll-x .ll-brands{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}',
    '.ll-x .ll-brand{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;border:1px solid var(--line);background:var(--card);font-size:13px;font-weight:600;line-height:1.2}',
    '.ll-x .ll-brand img{width:34px;height:34px;border-radius:50%;object-fit:cover;background:#fff;flex:0 0 auto}',
    '.ll-x .ll-brand small{display:block;color:var(--muted);font-weight:500}',
    '.ll-x .ll-brand[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}',
    '.ll-x .ll-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}',
    '@media(max-width:560px){.ll-x .ll-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}}',
    '.ll-x .ll-grid .ll-post{margin:0;display:flex;flex-direction:column}',
    '.ll-x .ll-grid .ll-post .ph img{aspect-ratio:1}',
    '.ll-x .ll-grid .ll-post .bd{flex:1;display:flex;flex-direction:column}',
    '.ll-x .ll-grid .ll-post .m{margin-top:auto;padding-top:8px}',
    '.ll-x .ll-grid .oos{color:var(--muted);font-size:12px;font-weight:700}',
    '.ll-x details.ll-more-f summary{cursor:pointer;color:var(--muted);font-size:13px;margin:10px 0}',
    '.ll-toast{position:fixed;left:50%;bottom:20px;transform:translate(-50%,40px);opacity:0;background:#141a26;color:#fff;border:1px solid #263044;padding:11px 16px;border-radius:12px;font:600 14px system-ui,sans-serif;z-index:99999;transition:.2s}',
    '.ll-toast.on{transform:translate(-50%,0);opacity:1}',
    '.ll-toast a{color:#4ec9ff;margin-left:6px}'
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
    mount.innerHTML = '<p class="ll-empty">Loading the feed...</p>';
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
        html += '<div class="ll-cover"><a class="ci" href="/products/' + esc(cover.handle) + '"><img alt="' + esc(cover.title) + '" src="' + esc(img(cover.img, 1000)) + '"></a>' +
          '<div class="cb"><p class="ll-kicker" style="margin:0">Cover story &middot; ' + esc(LANE_NAME[cover.lane]) + '</p><h3>' + esc(cover.title) + '</h3>' +
          (dek ? '<p class="dek">' + esc(dek) + '</p>' : '') +
          '<p class="ll-sub" style="margin:0">' + esc(cover.vendor) + '</p><div class="m" style="display:flex;gap:12px;align-items:center"><b style="font-size:20px">' + (cover.vs.length > 1 ? 'From ' : '') + money(cover.price) + '</b>' +
          (cover.vs.length > 1 ? '<a class="ll-add" href="/products/' + esc(cover.handle) + '">See options</a>' : '<button class="ll-add" type="button" data-add="' + cover.v.id + '">Add to cart</button>') + '</div></div></div>';
        r = r.slice(1);
      }
      var shown = r.slice(0, st.shown);
      var parts = [], ni = 0, si = 0;
      shown.forEach(function (x, i) {
        parts.push(postHTML(x, plain ? {} : { ar: 1 }));
        if (plain && i % 9 === 4 && ni < NOTES.length) parts.push(noteCard(NOTES[ni++]));
        if (plain && i % 9 === 8) { while (si < SETS.length) { var s = setCard(SETS[si++]); if (s) { parts.push(s); break; } } }
      });
      html += r.length ? '<div class="ll-cols">' + parts.join('') + '</div>'
        : '<p class="ll-empty">' + (st.savedOnly ? 'Nothing saved yet. Tap the heart on anything you like.' : 'Nothing matches that. Try another shelf.') + '</p>';
      if (r.length > st.shown) html += '<button class="ll-more" type="button">Keep scrolling (' + (r.length - st.shown) + ' more)</button>';
      else if (r.length) html += '<div class="ll-end"><b>You are all caught up</b>New picks land every day. <a href="/collections/all">Browse everything &rarr;</a></div>';
      body.innerHTML = html;
      body.querySelectorAll('.ll-post .ph').forEach(function (ph) {
        var h = (ph.getAttribute('href') || '').split('/').pop();
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'll-save'; b.setAttribute('data-save', h);
        b.setAttribute('aria-label', 'Save'); b.setAttribute('aria-pressed', saved().indexOf(h) > -1 ? 'true' : 'false');
        b.innerHTML = '&#9829;';
        ph.appendChild(b);
      });
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
      if (sv) { e.preventDefault(); e.stopPropagation(); sv.setAttribute('aria-pressed', toggleSave(sv.getAttribute('data-save')) ? 'true' : 'false'); if (st.savedOnly) paint(); return; }
      if (e.target.closest('.ll-more')) { st.shown += 24; paint(); }
    });
    var t;
    mount.querySelector('input[type=search]').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.q = v.trim(); paint(); }, 200); });
    mount.querySelectorAll('select[data-f]').forEach(function (sel) { sel.addEventListener('change', function () { st[sel.getAttribute('data-f')] = sel.value; paint(); }); });
    bindCart(mount);
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
    mount.innerHTML = '<p class="ll-empty">Loading...</p>';
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

  function renderSlicer(mount, all, title) {
    var P = new URLSearchParams(location.search);
    var st = {
      brand: P.get('ll_brand') || '', cat: P.get('ll_cat') || '', strength: P.get('ll_str') || '', flavor: P.get('ll_flv') || '',
      price: P.get('ll_price') || '', q: P.get('ll_q') || '', sort: P.get('ll_sort') || 'featured',
      sale: P.get('ll_sale') === '1', stock: P.get('ll_all') !== '1', shown: 36
    };
    var anyStrength = all.some(function (x) { return x.strength.length; });
    var anyFlavor = all.some(function (x) { return x.flavor.length; });

    /* data-heading="off" when the theme's own Heading section already prints the collection title
     * and description above the mount (Horizon's collection template does). */
    var heading = mount.getAttribute('data-heading') === 'off' ? '' : '<p class="ll-kicker">Shop</p><h2 class="ll-h">' + esc(title) + '</h2>';
    mount.innerHTML = heading +
      '<div class="ll-bar">' +
      '<input type="search" placeholder="Search ' + esc(title) + '" aria-label="Search" value="' + esc(st.q) + '">' +
      '<select data-f="price" aria-label="Price"><option value="">Any price</option><option value="0-25">Under $25</option><option value="25-50">$25 to $50</option><option value="50-100">$50 to $100</option><option value="100-250">$100 to $250</option><option value="250-99999">$250 and up</option></select>' +
      '<select data-f="sort" aria-label="Sort"><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">Newest</option><option value="az">A to Z</option></select>' +
      '<label class="ll-chip" style="display:inline-flex;gap:6px"><input type="checkbox" data-t="sale"' + (st.sale ? ' checked' : '') + '> On sale</label>' +
      '<label class="ll-chip" style="display:inline-flex;gap:6px"><input type="checkbox" data-t="stock"' + (st.stock ? ' checked' : '') + '> In stock</label>' +
      '<button class="ll-chip" type="button" data-clear>Clear all</button>' +
      '</div>' +
      '<div class="ll-facets"></div><p class="ll-count"></p><div class="ll-grid"></div><div class="ll-foot"></div>';
    mount.querySelector('[data-f=price]').value = st.price;
    mount.querySelector('[data-f=sort]').value = st.sort;

    function pass(x, skip) {
      if (st.stock && !x.stock) return false;
      if (st.sale && !x.sale) return false;
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
        var vals = field === 'brand' ? [x.vendor] : field === 'cat' ? [x.cat] : x[field];
        vals.forEach(function (v) { if (v) c[v] = (c[v] || 0) + 1; });
      });
      return c;
    }
    function chipRow(field, label, cur) {
      var c = counts(field), keys = Object.keys(c);
      if (cur && keys.indexOf(cur) < 0) keys.push(cur);
      if (keys.length < 2 && !cur) return '';
      keys.sort(function (a, b) { return field === 'strength' ? (parseFloat(a) || 0) - (parseFloat(b) || 0) : (c[b] || 0) - (c[a] || 0) || a.localeCompare(b); });
      return '<p class="ll-lab">' + label + '</p><div class="ll-chips">' +
        '<button class="ll-chip" type="button" data-k="' + field + '" data-v="" aria-pressed="' + (!cur) + '">All</button>' +
        keys.map(function (k) { return '<button class="ll-chip" type="button" data-k="' + field + '" data-v="' + esc(k) + '" aria-pressed="' + (k === cur) + '">' + esc(k) + '<small>' + (c[k] || 0) + '</small></button>'; }).join('') + '</div>';
    }
    function brandRow() {
      var c = counts('brand'), keys = Object.keys(c);
      if (st.brand && keys.indexOf(st.brand) < 0) keys.push(st.brand);
      if (keys.length < 2 && !st.brand) return '';
      keys.sort(function (a, b) { return (c[b] || 0) - (c[a] || 0) || a.localeCompare(b); });
      var face = {}; all.forEach(function (x) { if (!face[x.vendor] && x.img) face[x.vendor] = x.img; });
      return '<p class="ll-lab">Brands</p><div class="ll-brands">' + keys.map(function (k) {
        return '<button class="ll-brand" type="button" data-k="brand" data-v="' + esc(k) + '" aria-pressed="' + (k === st.brand) + '">' +
          (face[k] ? '<img alt="" loading="lazy" src="' + esc(img(face[k], 80)) + '">' : '') + '<span>' + esc(k) + '<small>' + (c[k] || 0) + ' items</small></span></button>';
      }).join('') + '</div>';
    }
    function syncUrl() {
      var u = new URL(location.href);
      [['ll_brand', st.brand], ['ll_cat', st.cat], ['ll_str', st.strength], ['ll_flv', st.flavor], ['ll_price', st.price], ['ll_q', st.q],
        ['ll_sort', st.sort === 'featured' ? '' : st.sort], ['ll_sale', st.sale ? '1' : ''], ['ll_all', st.stock ? '' : '1']]
        .forEach(function (p) { if (p[1]) u.searchParams.set(p[0], p[1]); else u.searchParams.delete(p[0]); });
      history.replaceState(null, '', u.toString());
    }
    function paint() {
      var facets = brandRow() + chipRow('cat', 'Category', st.cat) +
        (anyStrength ? chipRow('strength', 'Strength', st.strength) : '') +
        (anyFlavor ? chipRow('flavor', 'Flavor', st.flavor) : '');
      mount.querySelector('.ll-facets').innerHTML = facets;
      var r = all.filter(function (x) { return pass(x); });
      if (st.sort === 'low') r.sort(function (a, b) { return a.price - b.price; });
      if (st.sort === 'high') r.sort(function (a, b) { return b.price - a.price; });
      if (st.sort === 'new') r.sort(function (a, b) { return b.created - a.created; });
      if (st.sort === 'az') r.sort(function (a, b) { return a.title.localeCompare(b.title); });
      mount.querySelector('.ll-count').textContent = r.length + ' of ' + all.length + ' items';
      mount.querySelector('.ll-grid').innerHTML = r.length ? r.slice(0, st.shown).map(function (x) { return postHTML(x, { tag: false }); }).join('')
        : '<p class="ll-empty" style="grid-column:1/-1">Nothing matches those filters. <button class="ll-chip" type="button" data-clear>Clear all</button></p>';
      mount.querySelector('.ll-foot').innerHTML = r.length > st.shown ? '<button class="ll-more" type="button">Show more (' + (r.length - st.shown) + ')</button>' : '';
      syncUrl();
    }
    function clearAll() {
      st.brand = st.cat = st.strength = st.flavor = st.price = st.q = ''; st.sort = 'featured'; st.sale = false; st.stock = true; st.shown = 36;
      mount.querySelector('input[type=search]').value = ''; mount.querySelector('[data-f=price]').value = ''; mount.querySelector('[data-f=sort]').value = 'featured';
      mount.querySelector('[data-t=sale]').checked = false; mount.querySelector('[data-t=stock]').checked = true;
      paint();
    }
    mount.addEventListener('click', function (e) {
      if (e.target.closest('[data-clear]')) { clearAll(); return; }
      var c = e.target.closest('[data-k]');
      if (c) { var k = c.getAttribute('data-k'), v = c.getAttribute('data-v'); st[k] = st[k] === v ? '' : v; st.shown = 36; paint(); return; }
      if (e.target.closest('.ll-more')) { st.shown += 36; paint(); }
    });
    var t;
    mount.querySelector('input[type=search]').addEventListener('input', function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.q = v.trim(); st.shown = 36; paint(); }, 200); });
    mount.querySelectorAll('select[data-f]').forEach(function (sel) { sel.addEventListener('change', function () { st[sel.getAttribute('data-f')] = sel.value; st.shown = 36; paint(); }); });
    mount.querySelectorAll('input[data-t]').forEach(function (cb) { cb.addEventListener('change', function () { st[cb.getAttribute('data-t')] = cb.checked; st.shown = 36; paint(); }); });
    bindCart(mount);
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

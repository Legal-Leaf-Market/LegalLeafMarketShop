/* public/js/gear-categories.js -- the eleven categories baked into the engine,
 * folded into the eight the feed publishes.
 *
 * THE PROBLEM IS THAT TWO CATALOGUES MEET ON ONE SHELF. api/products.js
 * classifies gear with accessoryCat() and now emits eight buckets; the engine
 * also carries a BAKED GREEK GLASS SEED -- 85 products inside the blob -- with
 * a vocabulary of its own, and the engine passes accessory categories straight
 * through. So #fCategory was showing both lists at once: Rigs beside Bongs &
 * Rigs, Terp Accessories beside Parts & Tools, and seven buckets nobody could
 * shop -- Tools held ONE product, Ash Catchers held two.
 *
 * THE SEED CANNOT BE EDITED. public/engine.js must re-encode byte-identically
 * to the base64 it came from (CLAUDE.md section 5, and the generator asserts
 * it), so its 85 products keep their words whatever this file does.
 *
 * THE ENGINE ALREADY HAS THE LEVER, so nothing is patched. Its normCategory
 * consults a MANUAL category override before any of its own rules and returns
 * it unconditionally. This is the same mechanism, and the same three traps, as
 * cw-catsplit in tools/make-coldwater.mjs -- which asserts the opposite split on
 * a city page. Worth reading them together.
 *
 *   1. MUTATED, NOT REPLACED. window.LL_MANUAL_CAT and the engine's closure
 *      variable are the same object; assigning a new one leaves the engine
 *      reading the old one and nothing happens, visibly or otherwise.
 *   2. NO name FIELD. The engine's lookup falls back to matching an entry's own
 *      name against the product's when the id misses, so an entry carrying one
 *      would be applied to a same-named product at another shop.
 *   3. MARKED SO AN OPERATOR CANNOT PUBLISH THEM. These are derived on every
 *      load, not decisions anybody made, and the admin console can push its
 *      override batch to /api/overrides -- which would freeze this map into
 *      shared storage and outlive the rule that produced it. exportBatch is
 *      wrapped to drop them.
 *
 * A REAL MANUAL DECISION OUTRANKS THIS, because somebody looked at the product.
 *
 * ON A CITY PAGE IT FINDS NOTHING AND STOPS. The generator blanks the Greek
 * Glass seed, so there is no product carrying any of these words and the loop
 * exits without touching the override map or calling reprocess. No flag, no
 * branch -- the same way feed-meta.js stands down there.
 */
(function () {
  var MARK = "gearFold";

  /* THE STATIC MAP THIS REPLACES COULD ONLY EVER COVER THE SEED, and CI proved
     it within an hour. The engine does not only carry the baked 85 -- it
     fetches https://api.bigcartel.com/greekglass/products.json and merges the
     live shop on top, so on a machine with network the shelf came back with
     120 products and BIG CARTEL'S OWN COLLECTION NAMES in the dropdown: "New
     Arrivals", "Elite Series", "Gemstones", "Puffco Attachments", "Carta
     Attachments", "Quartz Bangers", "Carb Caps".
     Two of those are not categories at all -- they are merchandising
     collections, and "New Arrivals" held 23 products of every kind -- which
     means they are part of the granularity this file exists to remove, and a
     hand-maintained list of eleven words would have missed all seven and gone
     stale again the next time the shop adds a collection.
     It was invisible locally because the containers this repo is edited from
     refuse egress, so only the baked seed ever loaded. Same trap the Google
     Fonts note in CLAUDE.md describes, in the other direction.

     SO: A LOOKUP FOR WHAT WE HAVE SEEN, A RULE FOR WHAT WE HAVE NOT.

     NAMES is the exact answer where the word itself settles it -- "Ash
     Catchers" is Parts & Tools whatever the product is called, and a lookup
     cannot be fooled by a product name that happens to say "puffco".

     gearCat() is the fallback and it is a DELIBERATE TWIN of accessoryCat() in
     api/products.js -- every rung, in order, byte for byte. The two files
     cannot import each other (the same reason public/js/overrides.js ports
     _applyOv rather than importing api/overrides.js), so
     test-gear-categories.mjs drives one corpus through BOTH and requires the
     same answer. Change one, change the other. */
  var NAMES = {
    /* Bong-shaped glass. */
    "Rigs":              "Bongs & Rigs",
    "Tubes":             "Bongs & Rigs",
    "Glassware":         "Bongs & Rigs",
    /* The bits that go with the thing you already own. An "attachment"
       collection is parts even when every product in it says "Puffco", which
       is precisely where the ladder alone would answer Vaporizers. */
    "Bangers":           "Parts & Tools",
    "Quartz Bangers":    "Parts & Tools",
    "Carb Caps":         "Parts & Tools",
    "Terp Accessories":  "Parts & Tools",
    "Ash Catchers":      "Parts & Tools",
    "E-Rig Attachments": "Parts & Tools",
    "Puffco Attachments":"Parts & Tools",
    "Carta Attachments": "Parts & Tools",
    "Tools":             "Parts & Tools",
    /* Not gear -- stickers, pins, art, marbles sold as objects. */
    "Collectibles":      "Accessories",
    "Gemstones":         "Accessories"
    /* "New Arrivals" and "Elite Series" are deliberately ABSENT. They are
       collections holding every kind of product, so no single answer is right
       and the ladder has to read each product instead. Adding them here would
       file 23 mixed products under one wrong word and look like a decision. */
  };

  /* The eight the feed publishes. A product already wearing one is left alone. */
  var KEEP = {
    "Vaporizers": 1, "Bongs & Rigs": 1, "Pipes": 1, "Grinders": 1,
    "Rolling": 1, "Storage & Trays": 1, "Parts & Tools": 1, "Accessories": 1
  };

  /* TWIN OF accessoryCat() IN api/products.js. Same rungs, same order, same
     regexes. The server reads name + categories + tags; here the haystack is
     the product name plus whatever category it arrived with, which is the same
     evidence this page has. */
  function gearCat(hay) {
    hay = String(hay || "").toLowerCase();
    if (/dry\s*herb|vaporizer|\bvape\b|induction\s*heater|\bheater\b|e-?rig|puffco|carta|dynavap|\bsaber\b|\blaser\b|dabbing\s*device/.test(hay)) return "Vaporizers";
    if (/\bbong\b|water\s*pipe|\brig\b|bubbler|beaker|recycler|dab\s*rig|incycler/.test(hay)) return "Bongs & Rigs";
    if (/one[\s-]?hitter|chillum|\bpipe\b|steel\s*pipe|spoon\s*pipe|hand\s*pipe|sherlock|taster/.test(hay)) return "Pipes";
    if (/banger|\bnail\b|carb\s*cap|\bterp\b|slurper|insert|dabber|quartz|\bhalo\b|marble|pillar/.test(hay)) return "Parts & Tools";
    if (/grinder/.test(hay)) return "Grinders";
    if (/downstem|down\s*stem|\bbowl\b|\bslide\b|mouthpiece|adapter|attachment|\bstem\b|ash\s*catcher/.test(hay)) return "Parts & Tools";
    if (/rolling|\bcone\b|\bpaper\b|\bwrap\b|\btip\b|filter\s*tip/.test(hay)) return "Rolling";
    if (/torch|lighter|butane/.test(hay)) return "Parts & Tools";
    if (/tray|ashtray|storage|stash|\bcase\b|\bjar\b|container|\bbag\b/.test(hay)) return "Storage & Trays";
    if (/clean|\biso\b|solution|\bbrush\b|\bswab\b|resin\s*remover/.test(hay)) return "Parts & Tools";
    return "Accessories";
  }

  /* ONLY GEAR. cannabinoid "Accessory" is the engine's own switch for a product
     with no weight and no per-gram; anything else here would refile flower. */
  function foldFor(p) {
    if (!p) return "";
    var cat = String(p.category || "");
    if (KEEP[cat]) return "";                       // already one of the eight
    if (p.cannabinoid !== "Accessory") return "";   // not gear, not ours
    if (NAMES[cat]) return NAMES[cat];
    return gearCat(String(p.name || "") + " " + cat);
  }

  var applied = false;

  function apply() {
    if (applied) return;
    var A = window.LL_admin;
    if (!A || typeof A.items !== "function" || typeof A.reprocess !== "function") return;
    var map = window.LL_MANUAL_CAT;
    if (!map || typeof map !== "object") return;

    var items;
    try { items = A.items() || []; } catch (e) { return; }
    if (!items.length) return;

    var n = 0;
    for (var i = 0; i < items.length; i++) {
      var p = items[i];
      if (!p || !p.id) continue;
      var to = foldFor(p);
      if (!to) continue;
      if (Object.prototype.hasOwnProperty.call(map, p.id)) continue;   // a real decision wins
      map[p.id] = { cat: to, t: 0, gearFold: true };
      n++;
    }
    if (!n) return;
    applied = true;
    guardExport();
    /* Re-runs the engine's own ingest over the raw feed: normCategory sees the
       overrides, the facets are rebuilt from the result, and the grid redraws.
       Nothing here re-implements any of that. */
    try { A.reprocess(); } catch (e) { applied = false; }
  }

  function guardExport() {
    var A = window.LL_admin;
    if (!A || typeof A.exportBatch !== "function" || A.exportBatch.__gearGuarded) return;
    var orig = A.exportBatch.bind(A);
    var wrapped = function () {
      var b = orig.apply(null, arguments);
      try {
        if (b && b.cat) {
          var out = {};
          for (var k in b.cat) {
            if (!Object.prototype.hasOwnProperty.call(b.cat, k)) continue;
            if (b.cat[k] && b.cat[k][MARK]) continue;
            out[k] = b.cat[k];
          }
          b.cat = out;
        }
      } catch (e) {}
      return b;
    };
    wrapped.__gearGuarded = true;
    A.exportBatch = wrapped;
  }

  /* THE SEED IS PRESENT AT BOOT AND THE LIVE FEED ARRIVES LATER, and the hot
     swap re-ingests everything -- so this has to run on both. `applied` stops
     it doing real work twice; the poll covers the case where LL_admin is not
     defined yet, which is every cold load. */
  var tries = 0;
  var t = setInterval(function () {
    apply();
    if (applied || ++tries > 60) clearInterval(t);
  }, 250);
  apply();
  document.addEventListener("ll-meta", function () { applied = false; apply(); });
})();

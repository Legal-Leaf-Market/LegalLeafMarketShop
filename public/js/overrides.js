/* ============================================================
   overrides.js : published admin overrides, for the satellite pages
   ------------------------------------------------------------
   WHY THIS EXISTS

   Admin overrides are published site wide. The console pushes a batch to
   /api/overrides and it comes back for everyone. But only index.html ever
   applied them, and it does so through two mechanisms that the satellite
   pages do not have:

     1. LL_FIELD_OV, loaded from the admin's own localStorage. That only
        ever shows the edit back to the person who made it, in the browser
        they made it in.
     2. The automatic pull block in index.html, which is gated on
        window.LL_admin existing. LL_admin is defined by the admin console
        IIFE, and that IIFE is only on index.html.

   So an owner who set a product image in the console saw it on / and saw
   nothing on /consumables, which reads as the edit not having saved. It had
   saved: it was in /api/overrides the whole time, with nothing reading it.

   Reported for THCa Hempire's "Triple Hashburger Snowcaps", which has NO
   image in the live feed at all. The override was the only source of one,
   so on the satellite pages the card rendered with an empty frame.

   WHAT THIS IS

   A faithful port of the engine's own _applyOv, so a satellite page and the
   home page agree about what an override means. The field list, the numeric
   coercion and the per variant image rule below are copied from the engine
   inside the base64 blob, not reinvented. If the engine's version changes,
   change this one to match.

   Deliberately NOT ported: the reclassification heuristics and grouping.
   Those belong to the home page's pipeline. This only patches fields onto
   products the satellite already has.
   ============================================================ */
(function () {
  "use strict";

  /* Copied from the engine. Order does not matter, membership does. */
  var OV_FIELDS = ["name", "image", "store", "cannabinoid", "category", "type",
                   "grow", "coupon", "startsAt", "sale", "perG", "ship",
                   "potency", "badges", "varImg", "subTags"];
  var OV_NUM = { startsAt: 1, sale: 1, perG: 1, ship: 1, potency: 1, added: 1 };

  var FIELDS = {};   /* id -> field patch   */
  var CATS = {};     /* id -> {cat:"..."}   */

  function idOf(p) {
    if (p && p.id != null) return String(p.id);
    if (p && p.store) return String(p.store) + "::" + String(p.name || "");
    return String((p && p.name) || "");
  }

  function applyOne(p) {
    var ov = FIELDS[idOf(p)];
    var out = p;

    if (ov && typeof ov === "object") {
      var patch = {};
      OV_FIELDS.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(ov, k)) return;
        var v = ov[k];
        if (k === "badges") {
          patch.badges = Array.isArray(v) ? v.slice()
            : String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
        } else if (k === "varImg" || k === "subTags") {
          patch[k] = (v && typeof v === "object") ? v : {};
        } else if (OV_NUM[k]) {
          var n = parseFloat(v);
          if (!isNaN(n)) patch[k] = n;
        } else {
          patch[k] = v;
        }
      });
      out = Object.assign({}, p, patch);

      /* Per variant image overrides land in sizes[i][6], matched on the
         variant id at sizes[i][3]. A human set photo for a specific size
         always beats the auto grabbed one. Same rule as the engine. */
      if (out.varImg && out.sizes && out.sizes.length) {
        out.sizes = out.sizes.map(function (s) {
          var vid = s[3];
          if (vid != null && Object.prototype.hasOwnProperty.call(out.varImg, String(vid))) {
            var row = s.slice();
            row[6] = out.varImg[String(vid)];
            return row;
          }
          return s;
        });
      }
    }

    /* Category overrides ride in their own map. Applied after the field
       patch so an explicit category edit wins. */
    var c = CATS[idOf(out)];
    if (c && c.cat && String(out.category || "") !== String(c.cat)) {
      out = Object.assign({}, out, { category: c.cat });
    }
    return out;
  }

  /* The satellite pages now WAIT on this before painting, so it must never be
     able to stop them painting. A 404 or a network error settles the promise
     on its own, but a hung request would not, and the page would sit on its
     loader forever over something entirely cosmetic. So the fetch races a
     timeout: whichever finishes first wins, and rendering is always bounded.
     Overrides are a nicety, the catalogue is the product. */
  var TIMEOUT_MS = 4000;

  var pull = fetch("/api/overrides", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b || b.source === "error") return false;
      FIELDS = (b && b.fields) || {};
      CATS = (b && b.cat) || {};
      return true;
    })
    /* Silent on failure, by design. A storefront visitor should never see
       admin plumbing, and an unconfigured backend returns an empty batch,
       in which case this does nothing at all. */
    .catch(function () { return false; });

  var timeout = new Promise(function (res) { setTimeout(function () { res(false); }, TIMEOUT_MS); });
  var ready = Promise.race([pull, timeout]);

  window.LL_OV = {
    ready: ready,
    apply: function (list) {
      if (!Array.isArray(list)) return list;
      if (!Object.keys(FIELDS).length && !Object.keys(CATS).length) return list;
      return list.map(applyOne);
    },
    /* exposed for debugging from the console */
    counts: function () {
      return { fields: Object.keys(FIELDS).length, cat: Object.keys(CATS).length };
    }
  };
})();

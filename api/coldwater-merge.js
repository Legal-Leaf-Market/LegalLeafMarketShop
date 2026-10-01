/* api/coldwater-merge.js — WHAT TRUMPS WHAT, and WHAT COLOURS WHAT.
 *
 * One module because this rule is about to have three callers, and this repo's
 * own lesson is that a rule restated is a rule that drifts: four copies of
 * storeCheckoutUrl() is what happens when a shared rule gets retyped instead of
 * imported (CLAUDE.md §7). api/coldwater.js and api/coldwater-ingest.js both
 * import from here; a fourth collector imports from here too.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS REPLACES. Both existing precedence rules were correct for
 * ONE automated source and become wrong at two:
 *
 *   1. api/coldwater.js spliced out every scraped row for a store and pushed the
 *      capture in its place. Correct when the only capture was a human's, for
 *      the reason its comment gives -- a shop read both ways would list twice at
 *      two prices. Destructive the moment a second automated source posts: a
 *      thin 30-row manual capture DELETES a rich 200-row harvest, and the shelf
 *      goes backwards while appearing to be freshly updated.
 *
 *   2. readIngest() merged collections keyed on lowercased name, "later
 *      collections win" -- where later meant Object.keys() order, i.e. whichever
 *      was written to storage FIRST. So which source won was an accident of
 *      write order rather than a decision.
 *
 * Neither failure is visible from outside. Both produce a shelf that looks
 * populated and is quietly wrong, which is the failure mode this whole codebase
 * is organised against.
 * ---------------------------------------------------------------------------
 *
 * THE STANDING REQUIREMENT, from the owner, which outranks every optimisation
 * below: the operator's own browser capture is NEVER retired, NEVER skipped, and
 * ALWAYS layers on top -- including when an automated source has already filled
 * every field. Two reasons it is a rule and not a preference:
 *
 *   - It is the ONLY route to the walled stores. Dutchie and Jane answer a
 *     server-side request with a bot challenge, so every automated lane here is
 *     permanently blind there. If automation is ever allowed to retire the
 *     manual lane, those shops leave the shelf.
 *   - A human sees what no reader can: whether the case is actually stocked,
 *     what the budtender says is moving, an in-store-only deal, a sign in the
 *     window. None of that is in any DOM. That is the COLOUR layer below, and it
 *     is worth MORE at full automated coverage, not less, because by then it is
 *     the only thing the machines cannot supply.
 */

/* ------------------------------------------------------------------ ladder ---
 * Every collection option, live at once, each in its own lane. This is
 * deliberately the full option space rather than the two lanes that exist
 * today: a lane costs nothing until something posts to it, and a source that
 * has nowhere to declare itself is a source that gets misfiled as another one.
 *
 * RANK IS DECLARED, NEVER INFERRED FROM ORDER. That is the entire point -- see
 * failure 2 above.
 */
const SOURCES = {
  /* Placeholder rows with placeholder shop names. Ranked at the bottom so that
     ANY real reading of ANY store displaces them, which is what makes the demo
     fixture safe to leave in place. */
  demo:       { rank:  0, label: "demo fixture",     colour: false },
  /* A licensed third-party feed (Weedmaps/Leafly/Headset/BDSA class). Lowest of
     the real sources on purpose: it is the only one not read from the merchant,
     so anything read closer to the shop corrects it. */
  aggregator: { rank: 10, label: "licensed feed",    colour: false },
  /* Server-side fetch from api/, the cheap lane -- one HTTP call, no browser. */
  adapter:    { rank: 20, label: "server adapter",   colour: false },
  /* Scheduled headless browser running the collector against a page that is
     served without challenge. Outranks the adapter because it reads what
     actually rendered rather than what a parser expected to find. */
  headless:   { rank: 30, label: "scheduled browser", colour: false },
  /* A feed the merchant themselves handed over. Outranks anything we read
     unassisted, because it is the shop stating its own catalogue. */
  feed:       { rank: 40, label: "merchant feed",    colour: false },
  /* THE OPERATOR'S OWN BROWSER. Top of the ladder, by requirement.
     Worth naming the tension rather than burying it: `feed` is arguably more
     authoritative about a catalogue than a human scrolling a page. It is ranked
     below anyway, because a feed describes what the shop LISTS and the operator
     describes what is ON THE SHELF THIS MORNING, and this site's promise is
     about the second one. */
  manual:     { rank: 50, label: "operator capture", colour: true },
};

/* Shoppers, ranked below every read source. Kept as a declared lane rather than
   left to be invented later, but deliberately NOT colour-bearing: an unverified
   submission must never reach the fields the operator vouches for. */
SOURCES.crowd = { rank: 5, label: "shopper submitted", colour: false };

/* An undeclared source ranks below every real lane and can therefore never
   outrank the operator by accident. It is reported rather than corrected --
   silently promoting an unknown writer is how a precedence system stops being
   one. */
const UNKNOWN_RANK = 1;

/* THE LANE IS NOT THE `source` FIELD, and conflating them would silently demote
 * every capture already in storage.
 *
 * The collector posts source = "collector/<host> via page state" -- that string
 * is the READER LAYER that answered (page state / React props / rendered DOM),
 * kept for diagnostics, and it is deliberately free text. It says nothing about
 * who is doing the reading. So the lane travels in its own field, and an absent
 * lane means `manual`: everything writing to this endpoint today is the
 * operator's own bookmarklet, and defaulting a stored capture to anything lower
 * would drop it below a harvest the day a harvester is switched on.
 */
const LANE_ALIAS = { collector: "manual", bookmarklet: "manual", browser: "manual", operator: "manual" };

function laneOf(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return "manual";
  if (LANE_ALIAS[s]) return LANE_ALIAS[s];
  return s;
}

function sourceRank(name) {
  const s = SOURCES[String(name || "").trim().toLowerCase()];
  return s ? s.rank : UNKNOWN_RANK;
}
function sourceKnown(name) {
  return Object.prototype.hasOwnProperty.call(SOURCES, String(name || "").trim().toLowerCase());
}
function canColour(name) {
  const s = SOURCES[String(name || "").trim().toLowerCase()];
  return !!(s && s.colour);
}

/* -------------------------------------------------------------- freshness ---
 * RANK IS AUTHORITY. FRESHNESS IS CURRENCY. They are different questions and
 * conflating them is the failure this whole section exists to prevent.
 *
 * The trap, and it is the one that makes a quiet statewide launch dangerous:
 * the engine RANKS on perG, and prices fall. So a stale row does not merely sit
 * there looking old -- it is CHEAPER than the fresh one beside it, so it sorts
 * to the top, and the first thing a shopper sees is the price least likely to
 * still be true. Staleness is not a display problem. It is a ranking problem
 * that happens to also be visible.
 *
 * Grassroots was self-correcting here: enter one town, and a local shopper
 * catches a wrong price fast and loudly. Arriving statewide at once means
 * nobody is watching any particular market, so this has to be enforced by the
 * code rather than by the audience.
 *
 * THREE STATES, and the middle one is the one people skip:
 *   fresh    -- counts at its declared rank
 *   stale    -- still shown, still flagged, but DEMOTED below every fresh lane
 *   expired  -- gone. Not greyed out, not sorted last. Gone.
 *
 * Per lane, because "no post since Tuesday" means different things depending on
 * who was posting. A cron adapter silent for a day is a broken cron. An
 * operator silent for a week is an operator with a job.
 */
const LANE_FRESHNESS = {
  /* Fetched on every sweep. A day old means the sweep is failing, not that the
     shop is quiet. */
  adapter:    { staleDays: 1,  expireDays: 3 },
  /* Nightly. Two days means last night's run did not happen. */
  headless:   { staleDays: 2,  expireDays: 7 },
  aggregator: { staleDays: 2,  expireDays: 7 },
  /* The merchant sends these when they send them; slightly more patience. */
  feed:       { staleDays: 3,  expireDays: 14 },
  /* DELIBERATELY GENEROUS, and this is a judgement worth stating. One person
     cannot hand-capture 836 shops weekly (Part I §5), and the walled Dutchie
     and Jane stores have NO other lane -- expiring manual captures on an
     automated cadence would quietly empty exactly the shops nothing else can
     reach. Thirty days is long. It is still finite, which is the point: at
     seven shops the operator remembered, at 836 nobody can. */
  manual:     { staleDays: 10, expireDays: 30 },
  /* Unverified to begin with; it should not also be old. */
  crowd:      { staleDays: 7,  expireDays: 21 },
  /* The fixture is not a reading and does not decay. It is displaced by any
     real lane rather than aged out. */
  demo:       { staleDays: Infinity, expireDays: Infinity },
};

const DAY_MS = 86400000;
/* An undeclared lane gets the strictest real policy. A source that will not say
   who it is does not also get to be trusted for a month. */
const DEFAULT_FRESHNESS = { staleDays: 1, expireDays: 3 };

function freshnessOf(capturedAt, lane, now) {
  const pol = LANE_FRESHNESS[laneOf(lane)] || DEFAULT_FRESHNESS;
  const t = capturedAt ? Date.parse(capturedAt) : NaN;
  const at = (now == null ? Date.now() : now);
  /* NO TIMESTAMP IS NOT FRESH, AND IT IS NOT EXPIRED EITHER. A record written
     before this field existed still has real rows in it; discarding them on a
     technicality would delete the operator's back catalogue. Flag it and let it
     rank low. */
  if (!isFinite(t)) {
    return { ageMs: null, ageDays: null, stale: true, expired: false, undated: true,
             staleDays: pol.staleDays, expireDays: pol.expireDays };
  }
  const ageMs = Math.max(0, at - t);
  const ageDays = ageMs / DAY_MS;
  return {
    ageMs, ageDays: Math.round(ageDays * 10) / 10, undated: false,
    stale: ageDays >= pol.staleDays,
    expired: ageDays >= pol.expireDays,
    staleDays: pol.staleDays, expireDays: pol.expireDays,
  };
}

/* Demotion, not deletion. A stale lane keeps its order relative to other stale
   lanes and drops beneath every fresh one -- so a ten-day-old hand price still
   beats a ten-day-old harvest, and both lose to last night's. The offset is
   larger than the whole ladder so the two bands can never interleave. */
const STALE_DEMOTION = 1000;

/* --------------------------------------------------------------- presence ---
 * "Has this source actually said something about this field?"
 *
 * false and 0 are ANSWERS, not absences. inStock:false is a store saying the
 * thing is gone, and treating it as "no opinion" would let a stale in-stock
 * from a lower lane win -- which is the §7 stock bug wearing yet another face.
 * Only undefined, null, "" and [] count as silence.
 */
function present(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/* ---------------------------------------------------------------- atomics ---
 * SOME FIELDS ARE ONE ANSWER SPREAD ACROSS SEVERAL KEYS, and merging them
 * field-by-field produces a card that is individually correct and collectively
 * nonsense.
 *
 * The pricing block is the case that forces this. startsAt, sale, perG,
 * shelfPerG and every deal field are DERIVED from `sizes` inside toProduct().
 * Take `sizes` from a fresh manual capture and `perG` from last night's harvest
 * and the card shows one source's rows under another source's per-gram -- a
 * number that no longer equals price divided by grams, which is precisely the
 * thing §"An implausible price per gram is suppressed" exists to prevent. The
 * per-gram is also what the engine RANKS on, so the damage is not cosmetic.
 *
 * So: whichever lane wins `sizes` supplies the whole pricing block, including
 * its absences. Same argument for lab (potency and lab.totalThc are one
 * measurement) and brand (brandKey is derived from brand).
 */
const ATOMIC_GROUPS = [
  { lead: "sizes",   fields: ["sizes", "startsAt", "sale", "perG", "shelfPerG", "dealPerG",
                              "dealMinQty", "dealBasis", "dealMix", "dealGroup", "deal",
                              "perGSuppressed", "inStock"] },
  { lead: "potency", fields: ["potency", "lab"] },
  { lead: "brand",   fields: ["brand", "brandKey"] },
];

/* Everything else merges independently: a lane that knows the image but not the
   description contributes the image alone. */
const SCALAR_FIELDS = [
  "image", "gallery", "description", "category", "type", "grow", "cannabinoid",
  "coa", "url", "batch", "packagedDate", "offcut", "subTags", "badges",
  "domain", "ship", "coupon", "ref",
];

/* ----------------------------------------------------------------- colour ---
 * THE HUMAN LAYER. Fields no reader can produce, only ever written by a
 * colour-bearing lane, and NEVER overwritten by anything -- including a later,
 * richer automated read. This is the "top level colour on top even if all
 * products have already been filled" requirement, expressed as a namespace
 * rather than as a rank, because a rank can be out-ranked and this must not be.
 *
 * Kept under one `colour` object rather than spread across the product so that
 * the engine's own fields can never be silently shadowed by an observation, and
 * so a card can render "what a person saw" as a distinct thing from "what the
 * menu said".
 */
const COLOUR_FIELDS = [
  "note",        // free text: what the operator wants said about this product
  "onShelf",     // observed physically stocked, which a menu routinely lies about
  "observedDeal",// in-store-only offer, never in any feed
  "staffPick",
  "photo",       // taken in the case, outranks any catalogue image for truth
  "seenAt",      // when the eyes were actually on it
];

/* NOT ALL COLOUR AGES THE SAME WAY, and treating it as one thing gets one half
 * wrong whichever way you pick.
 *
 * "Last two jars on the shelf" and "B2G1 at the counter" are CLAIMS ABOUT RIGHT
 * NOW. Three weeks later they are not old information, they are wrong
 * information, and they are the kind a shopper drives across town on. Those
 * perish.
 *
 * "Budtender says this is moving", a staff pick, a photo of the case: those are
 * observations, not claims about current state. They stay useful for as long as
 * the product exists, and deleting the operator's notes on a timer would throw
 * away the one thing automation cannot produce -- the whole reason this layer
 * outranks everything else.
 *
 * So the perishable half is dropped past its window and the durable half is
 * kept, with seenAt travelling either way so the card can date what it prints.
 */
const COLOUR_PERISHABLE = ["onShelf", "observedDeal"];
const COLOUR_PERISH_DAYS = 10;

/* Returns a colour record with expired perishable claims removed, or null if
   nothing is left. Never mutates its input. */
function ageColour(c, now) {
  if (!c || typeof c !== "object") return null;
  const seen = Date.parse(c.seenAt || "");
  const at = (now == null ? Date.now() : now);
  const out = {};
  /* NO seenAt MEANS WE CANNOT DATE THE CLAIM, so the perishable half is not
     trusted. Same reasoning as an undated capture ranking low rather than being
     deleted: the durable half still comes through. */
  const tooOld = !isFinite(seen) || ((at - seen) / DAY_MS) >= COLOUR_PERISH_DAYS;
  for (const f of COLOUR_FIELDS) {
    if (!present(c[f])) continue;
    if (tooOld && COLOUR_PERISHABLE.indexOf(f) >= 0) continue;
    out[f] = c[f];
  }
  /* seenAt alone is not colour -- it is the stamp on colour that is no longer
     there, and a card would render an empty note. */
  const real = Object.keys(out).filter(k => k !== "seenAt");
  return real.length ? out : null;
}

/* ------------------------------------------------------------------- keys ---
 * THE JOIN, and the batch tag is the whole reason this can be done at the row
 * rather than at the store.
 *
 * Michigan packages carry a state track-and-trace (Metrc) tag. Names drift,
 * prices change and SKUs are per-shop, but a tag IS the package -- which is why
 * api/coldwater.js already calls it "the only durable key a lab result could
 * ever be joined on". Where a lane reports one, two rows with the same tag at
 * the same store are the same jar and merge outright.
 *
 * Without a tag the fallback is store + normalised name, and it deliberately
 * does NOT include size: a manual capture that recorded one size and a harvest
 * that recorded four are the same product, and keying on size would list it
 * twice -- the exact double-listing the old splice was written to prevent.
 */
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function rowKey(p) {
  const store = String(p && p.storeKey || "").toLowerCase();
  const batch = String(p && p.batch || "").trim().toLowerCase();
  if (batch) return store + " batch " + batch;
  const brand = normName(p && p.brand);
  const name = normName(p && p.name);
  return store + " name " + (brand ? brand + " " : "") + name;
}

/* ------------------------------------------------------------------ merge ---
 * layers: [{ source, products: [...] }, ...] in any order. Rank decides, not
 * position, so a caller cannot get this wrong by assembling the array wrongly.
 *
 * THE THREE RULES:
 *   1. Row-level join (rowKey above), so nothing lists twice.
 *   2. Higher rank wins PER FIELD -- or per atomic group, where the fields are
 *      one answer.
 *   3. A higher rank NEVER deletes a row it merely did not see. Only a fresh
 *      read from the SAME lane replaces that lane's own earlier rows, and that
 *      happens upstream in storage, not here.
 *
 * Rule 3 is what makes "always on top" additive instead of destructive, and it
 * is the one the old splice got wrong.
 */
function mergeProducts(layers, opts) {
  const colourBook = (opts && opts.colour) || null;   // { rowKey: {..colour fields..} }
  const now = (opts && opts.now != null) ? opts.now : Date.now();
  const rows = new Map();

  const ordered = (layers || [])
    .filter(l => l && Array.isArray(l.products) && l.products.length)
    .map((l, i) => {
      /* A layer with NO capturedAt is treated as fresh, not as undated. Adapter
         rows are produced during this very request and have no timestamp to
         carry; demoting them would invert the ladder on every sweep. Only a
         STORED lane, which always stamps capturedAt, can be stale. */
      const f = l.capturedAt ? freshnessOf(l.capturedAt, l.source, now) : null;
      const base = sourceRank(l.source);
      return {
        ...l, seq: i, fresh: f,
        expired: !!(f && f.expired),
        rank: (f && f.stale) ? base - STALE_DEMOTION : base,
      };
    })
    /* EXPIRED LANES ARE DROPPED HERE, before anything can read a field off
       them. Sorting them last would leave a shopper looking at a month-old
       price on a card that says nothing about it. */
    .filter(l => !l.expired)
    /* Ascending, so higher ranks are applied last and simply win. Ties break on
       the caller's order, which is the only thing left that can decide them. */
    .sort((a, b) => (a.rank - b.rank) || (a.seq - b.seq));

  for (const layer of ordered) {
    for (const p of layer.products) {
      if (!p) continue;
      const k = rowKey(p);
      const cur = rows.get(k);
      if (!cur) {
        rows.set(k, { product: { ...p }, from: {}, ranks: {}, lanes: [layer.source], stampedAt: {} });
        const rec = rows.get(k);
        stamp(rec, p, layer);
        continue;
      }
      if (cur.lanes.indexOf(layer.source) < 0) cur.lanes.push(layer.source);
      stamp(cur, p, layer);
    }
  }

  const out = [];
  for (const [k, rec] of rows) {
    const prod = rec.product;
    /* Provenance travels with the row. ?debug can then answer "which lane said
       this price", which is the question every one of these merges eventually
       raises at 2am. */
    prod.sourceLanes = rec.lanes.slice();
    prod.fieldSource = rec.from;
    /* Freshness of the PRICE, carried on the row so the card can print it and
       so a stale row can be told apart from a fresh one downstream without
       re-deriving any of this. */
    const pl = rec.priceLayer;
    if (pl) {
      prod.priceLane = pl.source;
      prod.asOf = pl.capturedAt || null;
      prod.stale = !!(pl.fresh && pl.fresh.stale);
      prod.ageDays = pl.fresh ? pl.fresh.ageDays : null;
    }
    if (colourBook) {
      const c = colourBook[k];
      if (c) prod.colour = { ...c };
    }
    out.push(prod);
  }
  return out;
}

/* Apply one layer's view of one row, honouring atomic groups and rank. */
function stamp(rec, p, layer) {
  const rank = layer.rank;

  for (const g of ATOMIC_GROUPS) {
    /* THE GROUP IS CLAIMED BY ANY FIELD IN IT, not by the lead alone.
       Gating on `sizes` looked tidier and silently dropped the price from any
       lane that states one WITHOUT size rows -- an aggregator quoting a
       per-gram, a shopper submission, a menu with a flat price and no weights.
       The claim is what must be all-or-nothing, not the entry condition.

       A lane that claims the block supplies ALL of it, absences included. That
       is the coherence guarantee and it costs something on purpose: if the
       winning lane knows a price but not the rows, the rows go empty rather
       than being back-filled from a lane whose numbers no longer divide into
       that price. A card with a price and no size breakdown is honest; one
       showing last night's rows under this morning's per-gram is not, and the
       engine RANKS on that per-gram. */
    if (!g.fields.some(f => present(p[f]))) continue;
    const held = rec.ranks["@" + g.lead];
    if (held !== undefined && held >= rank) continue;
    for (const f of g.fields) {
      /* Absences inside a winning group are copied too -- that is what makes it
         atomic. A suppressed perG must not be back-filled from a lower lane. */
      rec.product[f] = p[f];
      rec.from[f] = layer.source;
    }
    rec.ranks["@" + g.lead] = rank;
    /* THE PRICE'S OWN AGE, tracked separately from the row's. A card can carry
       a fresh description and a stale price, and only one of those misleads
       anybody -- so "as of" on the card has to mean "as of when this PRICE was
       read", not when any field on the row was last touched. */
    if (g.lead === "sizes") rec.priceLayer = layer;
  }

  for (const f of SCALAR_FIELDS) {
    if (!present(p[f])) continue;
    const held = rec.ranks[f];
    if (held !== undefined && held >= rank) continue;
    rec.product[f] = p[f];
    rec.from[f] = layer.source;
    rec.ranks[f] = rank;
  }

  /* Identity fields that must never be blanked by a lane that happens to omit
     them, and are never worth fighting over: first writer keeps them. */
  for (const f of ["id", "name", "store", "storeKey"]) {
    if (!present(rec.product[f]) && present(p[f])) { rec.product[f] = p[f]; rec.from[f] = layer.source; }
  }
}

/* --------------------------------------------------------------- colour io ---
 * Colour is stored against the row key rather than against a product id,
 * because ids are per-lane (`toProduct` builds them from the store key plus the
 * lane's own slug) and would not survive the product being re-read by a
 * different collector tomorrow. The batch tag survives; the normalised name
 * survives; a lane's slug does not.
 */
function colourKeyFor(p) { return rowKey(p); }

function sanitiseColour(o) {
  if (!o || typeof o !== "object") return null;
  const out = {};
  for (const f of COLOUR_FIELDS) {
    const v = o[f];
    if (!present(v)) continue;
    out[f] = typeof v === "string" ? v.slice(0, 400) : v;
  }
  return Object.keys(out).length ? out : null;
}

export {
  SOURCES, COLOUR_FIELDS, ATOMIC_GROUPS, SCALAR_FIELDS,
  sourceRank, sourceKnown, canColour, laneOf,
  LANE_FRESHNESS, freshnessOf, STALE_DEMOTION,
  rowKey, colourKeyFor, sanitiseColour, ageColour,
  COLOUR_PERISHABLE, COLOUR_PERISH_DAYS,
  mergeProducts, present, normName,
};

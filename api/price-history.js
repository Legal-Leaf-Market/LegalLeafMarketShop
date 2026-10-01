/* api/price-history.js — "cheapest we've seen", which is the only claim this
 * site cannot make later.
 *
 * WHY THIS ONE FIRST, of everything left on the list: it is the only feature
 * where WAITING DESTROYS VALUE. A price you did not record is gone. Comments
 * can start empty and fill up; specs can be added whenever; a series that
 * started in August is worth something a series started in November is not.
 * Every night the shelf is re-read and the numbers thrown away is a night
 * spent and lost.
 *
 * AND IT CHANGES THE QUESTION THE SITE ANSWERS. Today it answers "what does
 * this cost", which is a fact a shopper can get from the shop. With history it
 * answers "is that a good price", which is the question they actually have and
 * which nobody in this category answers. Same shape as the difference between
 * a lab-measured Total THC and a label's claim: the number is not the product,
 * the provenance is.
 *
 * ------------------------------------------------------------------
 * A SUMMARY, NOT A SERIES, AND THAT IS A STORAGE DECISION WITH A REASON.
 *
 * 5,938 products x a point per day is a chart nobody asked for and a payload
 * nothing can hold. What the claim needs is four numbers per product: the
 * lowest ever and when, the highest ever and when, plus what it is now and how
 * many times we have looked. That is ~50 bytes a row and ~300KB for the whole
 * catalogue -- ONE key, one read, one write per night, which a KV plan will
 * carry indefinitely.
 *
 * Storing per-product keys instead would be 5,938 writes a night for the same
 * answer. Storing a full series would be megabytes for a sparkline nobody has
 * asked for. Both are available later from this shape; neither is needed to
 * say "cheapest we have seen".
 *
 * ------------------------------------------------------------------
 * THREE RULES THAT KEEP THE CLAIM HONEST, because a wrong "lowest price" is
 * worse than none -- it is the one number a shopper would screenshot.
 *
 *   1. AN OUT-OF-STOCK PRICE IS NOT A PRICE. A shop that sells out often
 *      leaves the row up at its old number, and a shelf-price on something
 *      nobody could buy would set a "low" that was never purchasable. Only
 *      rows the site itself considers in stock are folded in.
 *   2. ONE OBSERVATION IS NOT A HISTORY. A product seen once has a low equal
 *      to its price, and "cheapest we have ever seen: exactly what it costs
 *      right now" is a true sentence that tells a shopper nothing and looks
 *      like a bug. `n` travels with every row so a caller can refuse to draw a
 *      claim until it means something.
 *   3. A SILLY PRICE IS REFUSED RATHER THAN RECORDED. A feed hiccup that
 *      publishes $0.01 for an ounce would pin an all-time low that no later
 *      reading can ever beat -- the damage is permanent in a way a wrong
 *      current price is not. Bounds are deliberately wide: this guards
 *      arithmetic, not pricing, exactly as perGramSanity does.
 */
import { kvOn, kvGetJson, kvSetJson } from './kv.js';
import { neonOn, getJson as neonGetJson, setJson as neonSetJson } from './neon.js';
import { anyInStock } from './products.js';

const KEY = 'll_price_history_v1';
const VERSION = 1;

/* Wide on purpose. A $0.01 ounce and a $99,999 grinder are both feed damage
   rather than pricing, and an all-time low is permanent in a way a wrong
   current price is not. */
const MIN_PRICE = 0.50;
const MAX_PRICE = 20000;

/* Row layout, positional to keep the blob small. Named here once so nothing
   downstream counts indices by hand. */
const LO = 0, LO_AT = 1, HI = 2, HI_AT = 3, LAST = 4, LAST_AT = 5, N = 6;

/* AND THE LAYOUT TRAVELS WITH THE DATA, published as `cols` on every GET.
   public/index.html draws the card claim from this map, and it cannot import
   from api/ -- the same wall that makes public/js/overrides.js carry its own
   port of _applyOv and the collector its own rscRoots(). Every one of those
   twins has drifted at least once, silently, so this one is not created: the
   reader looks a name up in `cols` rather than knowing that `low` is index 0.
   Reorder the row here and the card follows without an edit. */
const COLS = ['low', 'lowAt', 'high', 'highAt', 'last', 'lastAt', 'n'];

const priceOf = p => {
  const n = Number((p && (p.sale || p.startsAt)) || 0);
  return n > 0 ? n : 0;
};

/* Is this reading worth recording at all? Returns the price, or 0. */
function observable(p) {
  if (!p || !p.id) return 0;
  /* Rule 1: the site's own stock test, imported rather than restated -- the
     same mistake api/concierge.js made for months by asking `inStock !== false`
     on its own while claiming it could not disagree with the grid. */
  if (!anyInStock(p)) return 0;
  const v = priceOf(p);
  if (!(v >= MIN_PRICE && v <= MAX_PRICE)) return 0;   /* rule 3 */
  return v;
}

/* Fold one day's shelf into the record. Pure: takes the old map and the
   products, returns the new map and what changed. Nothing here reads a clock
   except through `now`, so a test can pin an outcome. */
function fold(prev, products, now) {
  /* A SHALLOW COPY IS NOT A COPY HERE. Object.assign clones the map but shares
     every ROW ARRAY, so mutating row[LO] below reached back into the caller's
     map -- which meant a failed write left an in-memory record claiming a low
     that was never stored, and made the function impossible to reason about.
     Caught by the suite's purity assertion, not by reading. Rows are cloned on
     first touch instead of all at once: most days most rows do not move. */
  const src = (prev && prev.p) || {};
  const out = Object.assign({}, src);
  const stat = { seen: 0, added: 0, newLow: 0, newHigh: 0, skipped: 0, refused: 0 };
  const day = Math.floor(now / 86400000);

  for (const p of products || []) {
    const v = observable(p);
    if (!v) {
      if (p && p.id) (priceOf(p) > 0 ? stat.skipped++ : stat.refused++);
      continue;
    }
    stat.seen++;
    /* Clone before mutating, so the input map is never touched. */
    const row = out[p.id] ? (out[p.id] = out[p.id].slice()) : null;
    if (!row) {
      out[p.id] = [v, day, v, day, v, day, 1];
      stat.added++;
      continue;
    }
    /* READ THE PREVIOUS DAY BEFORE OVERWRITING IT. The first draft compared
       row[LAST_AT] to `day` AFTER assigning it, so the test could never fire
       and `n` counted every call rather than every day -- which would let a
       retried cron manufacture a history that never happened. */
    const prevDay = row[LAST_AT];
    if (v < row[LO]) { row[LO] = v; row[LO_AT] = day; stat.newLow++; }
    if (v > row[HI]) { row[HI] = v; row[HI_AT] = day; stat.newHigh++; }
    row[LAST] = v;
    row[LAST_AT] = day;
    /* ONE FOLD PER DAY COUNTS ONCE. The endpoint may be called twice by a
       retried cron, and a doubled `n` would make a one-day-old record claim a
       history it does not have. */
    if (day !== prevDay) row[N] = (row[N] || 0) + 1;
  }
  return { map: { v: VERSION, updated: now, p: out }, stat };
}

/* What a card needs, for one product. `enough` is the caller's cue that the
   record means something yet -- rule 2. */
function claimFor(map, id, minObservations = 3) {
  const row = map && map.p && map.p[id];
  if (!row) return null;
  const dayMs = 86400000;
  return {
    low: row[LO], lowAt: row[LO_AT] * dayMs,
    high: row[HI], highAt: row[HI_AT] * dayMs,
    last: row[LAST], lastAt: row[LAST_AT] * dayMs,
    observations: row[N] || 1,
    enough: (row[N] || 1) >= minObservations,
    /* The two sentences a card can actually print. */
    atLow: row[LAST] <= row[LO] + 0.001,
    downFromHigh: row[HI] > row[LAST] + 0.001
      ? Math.round((1 - row[LAST] / row[HI]) * 100) : 0,
  };
}

async function load() {
  if (kvOn()) return (await kvGetJson(KEY)) || null;
  if (neonOn()) return (await neonGetJson(KEY)) || null;
  return null;
}
async function save(map) {
  if (kvOn()) return kvSetJson(KEY, map);
  if (neonOn()) return neonSetJson(KEY, map);
  return false;
}

/* Read the shelf, fold it in, store it. Shared by the two ways in below, which
 * differ only in how they prove they are allowed to be here -- the recording
 * itself must not diverge between them, or the nightly run and a hand-run would
 * be two different features wearing one name. */
async function record(req, res, q) {
  if (!kvOn() && !neonOn()) {
    return res.status(501).json({ error: 'no storage backend',
      note: 'attach Upstash KV or Neon. Until then nothing is recorded, and nothing pretends to be.' });
  }
  /* IT SAYS WHY, IN THE LOGS, and that is not decoration. This runs unattended
     once a night and its only reader is whoever is diagnosing a record that
     stopped growing -- the response body goes to a scheduler that discards it.
     The first live failure was a 503 with a `detail` field nobody could ever
     see: fifteen seconds after the cron fired, cause unknown, and the whole
     morning went on guessing which of four things it was. Same `[name] ...`
     shape the concierge's spend line uses, for the same reason: it is greppable
     in the Vercel log viewer. */
  const t0 = Date.now();
  const { loadCatalogue } = await import('./feed.js');
  let cat;
  try { cat = await loadCatalogue(req); }
  catch (e) {
    const why = String((e && e.message) || e);
    console.error(`[price-history] catalogue unavailable after ${Date.now() - t0}ms: ${why}`);
    return res.status(503).json({ error: 'catalogue unavailable', detail: why });
  }
  console.log(`[price-history] catalogue ${cat.products.length} products in ${Date.now() - t0}ms`);

  const prev = await load();
  const now = Number(q.now) || Date.now();
  const { map, stat } = fold(prev, cat.products, now);
  const wrote = await save(map);
  /* A WRITE THAT RETURNS FALSE IS NOT A RECORDED NIGHT. save() answers false
     when no backend took it, and reporting ok:true over that is how a record
     stops growing while every reading says success. */
  if (!wrote) {
    console.error('[price-history] storage refused the write; nothing recorded');
    return res.status(503).json({ error: 'write failed',
      note: 'the storage backend did not accept the record. Nothing was saved.' });
  }
  console.log(`[price-history] recorded ${Object.keys(map.p).length} products · seen ${stat.seen} · new lows ${stat.newLow} · new highs ${stat.newHigh}`);
  return res.status(200).json({ ok: true, products: Object.keys(map.p).length, ...stat });
}

/* GET  /api/price-history            -> the whole map (small, cacheable)
 * GET  /api/price-history?id=<id>    -> one product's claim
 * GET  /api/price-history?record=1   -> fold today's shelf in (Vercel cron only)
 * POST /api/price-history            -> fold today's shelf in (token-gated)
 *
 * THE WRITE IS GATED and fails closed, the same way /api/overrides does. An
 * open write here is worse than an open write there: a stranger could pin a
 * false all-time low that no later reading can ever beat.
 */
export default async function handler(req, res) {
  const q = (req && req.query) || {};

  if (req.method === 'POST') {
    const tok = process.env.LL_ADMIN_TOKEN || '';
    if (!tok) {
      return res.status(501).json({ error: 'not configured',
        note: 'set LL_ADMIN_TOKEN to enable recording. Reads work without it.' });
    }
    const sent = (req.headers && (req.headers['x-ll-admin-token'] || req.headers['X-LL-Admin-Token'])) || '';
    if (sent !== tok) return res.status(403).json({ error: 'forbidden' });
    return record(req, res, q);
  }

  /* THE SCHEDULER'S REQUEST IS A GET, AND THAT IS NOT THIS FILE'S CHOICE.
     Vercel's cron only issues GET, so the one write this endpoint performs has
     to be reachable that way as well. Three things keep a side-effecting GET
     from being the mistake it usually is, and all three are load bearing:

       - IT IS OPT-IN PER REQUEST. `?record=1`, never the bare path, so nothing
         a browser, a crawler or a link preview follows can ever reach it.
       - IT IS GATED ON CRON_SECRET, which Vercel sends as `Authorization:
         Bearer` on its own scheduled calls and which nothing else knows. Unset,
         this refuses -- exactly as the POST refuses without LL_ADMIN_TOKEN, and
         for the stronger reason: a cron path that falls open when a variable is
         missing is an open write that looks configured.
       - IT ANSWERS `no-store`. A cacheable side-effecting GET is worse than a
         slow one in both directions: the edge would serve the recorder's own
         reply to a shopper asking for the history, and the cron would stop
         reaching the function at all after the first night.

     The POST above is unchanged and is still how a human records by hand. */
  if (q.record) {
    res.setHeader('Cache-Control', 'no-store');
    const secret = process.env.CRON_SECRET || '';
    if (!secret) {
      return res.status(501).json({ error: 'not configured',
        note: 'set CRON_SECRET to enable the scheduled recorder. Reads work without it, and POST with x-ll-admin-token still records.' });
    }
    const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    if (auth !== 'Bearer ' + secret) return res.status(403).json({ error: 'forbidden' });
    return record(req, res, q);
  }

  const map = await load();
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
  if (!map) {
    return res.status(200).json({ v: VERSION, cols: COLS, updated: 0, products: 0, p: {},
      note: kvOn() || neonOn() ? 'nothing recorded yet' : 'no storage backend configured' });
  }
  if (q.id) {
    const c = claimFor(map, String(q.id), Number(q.min) || 3);
    return res.status(200).json(c || { note: 'no history for that product' });
  }
  return res.status(200).json({ ...map, cols: COLS, products: Object.keys(map.p || {}).length });
}

export { fold, claimFor, observable, priceOf, KEY, VERSION, COLS, MIN_PRICE, MAX_PRICE, LO, LO_AT, HI, HI_AT, LAST, LAST_AT, N };

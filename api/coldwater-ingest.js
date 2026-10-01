/* api/coldwater-ingest.js — accept a menu captured by a person's own browser.
 *
 * WHY THIS EXISTS, and why it is not the same thing as getting round a wall.
 *
 * Three of the Coldwater shops sit behind platform bot-management: Dutchie for
 * Sapura and Exclusive, Jane for Green Tree Relief. A server-side request to
 * those APIs gets a Cloudflare challenge, and defeating that challenge -- stealth
 * headless, TLS fingerprint spoofing, solver services -- is the one thing this
 * project will not do. It is also the thing that would turn a defensible reading
 * position into an indefensible one.
 *
 * But the challenge exists to tell a script from a person, and a person looking
 * at a dispensary menu is exactly who those pages are for. So the collector
 * (public/coldwater-collector.js) runs in the operator's OWN browser, on a page
 * they are already looking at, and reads the DOM that was rendered for them. It
 * automates "copy what is on my screen". Nothing is bypassed, because nothing
 * was denied: the page was served.
 *
 * This endpoint is the other half. It takes what that browser saw and holds it
 * so /api/coldwater can serve it.
 *
 * GATED, AND IT FAILS CLOSED. Writes need x-ll-admin-token matching
 * LL_ADMIN_TOKEN, exactly as api/overrides.js does. With the variable unset,
 * POST is disabled outright rather than open -- an unconfigured deploy must not
 * be a catalogue anyone can write to.
 *
 * STORAGE IS KV -> NEON -> MEMORY, the same order and the same reasoning as
 * api/overrides.js (CLAUDE.md section 9): a write landing in one store while
 * reads come from another publishes an edit nobody sees. This used to be KV or
 * memory with no middle, which made the whole bookmarklet workflow conditional
 * on a KV store nobody had attached -- the operator captures a menu, sees
 * "Sent. 312 products stored", and the page shows the demo fixture, because the
 * lambda that answered /api/coldwater was a different instance with a different
 * Map. Neon is already wired for overrides and the spend ledger, so honouring it
 * here costs one import and removes that trap.
 *
 * Memory remains as the last resort and is REPORTED rather than papered over,
 * same as the spend ledger's fallback in api/concierge.js.
 */

import { neonOn, getJson as neonGetJson, setJson as neonSetJson, sql as neonSql } from "./neon.js";
import { laneOf, sourceRank, freshnessOf, rowKey, sanitiseColour, ageColour } from "./coldwater-merge.js";
/* Only to CHECK a storeKey against the market it was sent for, never to
   restrict what may be stored. See the note on onRoster() below. */
import { STORES } from "./market-stores.js";
import { marketKey, MARKETS, DEFAULT_MARKET } from "./markets.js";
import { kvUrl, kvTok, kvOn } from './kv.js';

/* NO SHARED-HOST LIST HERE, ON PURPOSE. public/coldwater-collector.js keeps a
   MULTI_SHOP_HOST regex for its batch key, and copying it here would be a twin
   that drifts -- and a WORSE answer besides, since a hand-kept list of
   platforms cannot know that House of Dank has shops in two cities on
   shophod.com. `shared` below is counted from the roster itself, so it is right
   about every case including the ones nobody thought to list. */

/* The credential trio lives in api/kv.js now -- it was byte-identical in
   four files and a fifth was about to be written. See that file's header. */
/* NAMESPACED BY MARKET, so one endpoint serves every shelf without any of them
   being able to see another. Cities are dispensary menus; "llm" is the national
   mail-order hemp feed behind /api/products. They are different markets to a
   customer and must never merge -- the same mistake the shared ll_cart key made
   on the front end.
 *
 * THIS WAS A THIRD REGISTRY, AND IT SWALLOWED A CITY. It read
 * `{ coldwater: 1, llm: 1 }` and defaulted everything else to coldwater -- so a
 * capture posted with market:"detroit" was written to
 * ll:coldwater:ingest:<store>, a key Coldwater's own feed never reads because
 * that store is not on Coldwater's roster. Stored perfectly, invisible on both
 * shelves, and reported as ok:true. Found while the operator was part way
 * through capturing a twenty-page Detroit menu.
 *
 * It is the same failure api/market-stores.js was created to end, one file
 * along: two lists of towns, one of them short, falling back silently rather
 * than erroring. The registry is api/markets.js. THERE IS NO OTHER ONE -- "llm"
 * is not a place and is the single exception, spelled out here rather than
 * carried in a map that will drift again. */
const mkt = m => {
  const v = String(m == null ? "" : m).trim().toLowerCase();
  if (v === "llm") return "llm";
  return marketKey(v);
};
const KEY = (k, m) => "ll:" + mkt(m) + ":ingest:" + k;

/* Per-instance fallback. Weaker than either shared backend -- a different lambda
   has a different map, so a capture can appear to vanish.

   KEYED BY THE NAMESPACED KEY, not by the bare store key. Keying it on
   storeKey alone made the two markets collide the moment no KV was attached:
   a hemp capture and a Coldwater capture of the same store id overwrote each
   other, which is precisely the isolation this namespace exists to provide.
   The suite caught it -- an llm capture surfaced on the Coldwater shelf. */
const MEM = new Map();

/* Which backend a write will go to, named for the diagnostic. */
export const backendName = () =>
  kvOn() ? "kv" : (neonOn() ? "neon" : "memory (per-instance; attach Upstash KV or set DATABASE_URL to persist)");

async function kvSet(storeKey, payload, market) {
  if (kvOn()) {
    try {
      const r = await fetch(`${kvUrl()}/set/${encodeURIComponent(KEY(storeKey, market))}`, {
        method: "POST",
        headers: { authorization: `Bearer ${kvTok()}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) return "kv";
      MEM.set(KEY(storeKey, market), payload);
      return "memory (kv " + r.status + ")";
    } catch (e) {
      MEM.set(KEY(storeKey, market), payload);
      return "memory (kv unreachable: " + String((e && e.message) || e).slice(0, 60) + ")";
    }
  }
  if (neonOn()) {
    try {
      await neonSetJson(KEY(storeKey, market), payload);
      return "neon";
    } catch (e) {
      MEM.set(KEY(storeKey, market), payload);
      return "memory (neon unreachable: " + String((e && e.message) || e).slice(0, 60) + ")";
    }
  }
  MEM.set(KEY(storeKey, market), payload);
  return "memory";
}

async function kvGet(storeKey, market) {
  if (kvOn()) {
    try {
      const r = await fetch(`${kvUrl()}/get/${encodeURIComponent(KEY(storeKey, market))}`, {
        headers: { authorization: `Bearer ${kvTok()}` },
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.result != null) return typeof j.result === "string" ? JSON.parse(j.result) : j.result;
      }
    } catch (e) { /* fall through to the next backend */ }
  }
  if (neonOn()) {
    try {
      const v = await neonGetJson(KEY(storeKey, market));
      if (v) return v;
    } catch (e) { /* fall through */ }
  }
  return MEM.get(KEY(storeKey, market)) || null;
}

/* ONE ROUND TRIP FOR THE WHOLE TOWN, NOT ONE PER SHOP.
 *
 * /api/coldwater read captures with `await readIngest(key)` inside a loop over
 * STORES -- sequential, one network round trip per shop, on EVERY request. At
 * seven shops that is invisible. At a statewide roster it is the hot path and
 * nothing else comes close: 800 sequential reads before a single byte is sent.
 *
 * The obvious fix is to cache the merged result, and it is the wrong one. That
 * cache is exactly what /api/coldwater deliberately does NOT keep -- the scrape
 * is cached and the captures are not, because a capture that stores correctly
 * and stays invisible for half an hour was a real bug here, reported as "the
 * tool refreshes the grab but the live site is not updating even when I ctrl
 * shft r". Immediacy is a requirement. So the reads are BATCHED rather than
 * cached: same freshness, one round trip.
 *
 * Falls back to the per-key path whenever a backend cannot do better, so this
 * can never be the reason a capture goes missing.
 */
async function kvGetMany(storeKeys, market) {
  const keys = storeKeys.map(k => KEY(k, market));
  const out = new Map();

  if (kvOn() && keys.length) {
    try {
      /* MGET returns a positional array, so a missing key is a null hole rather
         than a short array -- the index IS the store, and zipping them back up
         depends on that. */
      const r = await fetch(`${kvUrl()}/mget/${keys.map(encodeURIComponent).join("/")}`, {
        headers: { authorization: `Bearer ${kvTok()}` },
      });
      if (r.ok) {
        const j = await r.json();
        const arr = (j && j.result) || [];
        for (let i = 0; i < storeKeys.length; i++) {
          const v = arr[i];
          if (v == null) continue;
          try { out.set(storeKeys[i], typeof v === "string" ? JSON.parse(v) : v); } catch (e) {}
        }
        return out;
      }
    } catch (e) { /* fall through */ }
  }

  if (neonOn() && keys.length) {
    try {
      /* = ANY($1) rather than a built IN list: the key set is derived from our
         own roster, but building SQL by concatenation is a habit that outlives
         the context that made it safe. */
      const rows = await neonSql(
        "select k, v from ll_store where k = any($1) and (expires_at is null or expires_at > now())",
        [keys]);
      const byKey = new Map();
      for (const row of (rows || [])) {
        const k = row.k != null ? row.k : row[0];
        const v = row.v != null ? row.v : row[1];
        if (k == null) continue;
        try { byKey.set(String(k), typeof v === "string" ? JSON.parse(v) : v); } catch (e) {}
      }
      for (let i = 0; i < storeKeys.length; i++) {
        const v = byKey.get(keys[i]);
        if (v) out.set(storeKeys[i], v);
      }
      return out;
    } catch (e) { /* fall through */ }
  }

  for (let i = 0; i < storeKeys.length; i++) {
    const v = MEM.get(keys[i]);
    if (v) out.set(storeKeys[i], v);
  }
  return out;
}

/* The batched twin of readIngest. Same shape per store, same expiry, same rank
   ordering -- it differs only in how the records were fetched, which is the
   point: two functions that disagree about what a capture MEANS would be the
   drift this repo keeps writing notes about. */
async function readIngestMany(storeKeys, market) {
  const recs = await kvGetMany(storeKeys, market);
  const out = new Map();
  for (const k of storeKeys) {
    const rec = recs.get(k);
    if (!rec) continue;
    const shaped = shapeIngest(k, rec);
    if (shaped) out.set(k, shaped);
  }
  return out;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise(resolve => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 6e6) { s = ""; req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

/* Trust nothing about the shape. A capture arrives from a browser extension the
   operator pasted in; it is theirs, but it is still input, and the engine will
   render whatever gets through. Keep only known fields, coerce the types, and
   cap the size so one bad page cannot become the catalogue. */
/* http(s) only on the way out, but accept the protocol-relative form on the
   way in and normalise it, rather than dropping the picture silently. */
function imageUrl(v) {
  const u = String(v == null ? "" : v).trim();
  if (!u) return "";
  if (u.startsWith("//")) return ("https:" + u).slice(0, 400);
  return /^https?:\/\//i.test(u) ? u.slice(0, 400) : "";
}

function sanitize(raw) {
  const num = v => { const n = Number(v); return isFinite(n) ? n : null; };
  const str = (v, n) => String(v == null ? "" : v).slice(0, n || 200);
  const list = Array.isArray(raw && raw.products) ? raw.products.slice(0, 2000) : [];
  const rows = list.map(p => ({
    name: str(p.name, 160),
    brand: str(p.brand, 80),
    /* THIS IS A WHITELIST, so a field the collector captures is dropped here
       unless it is named -- which is silent, and is why the description has to
       be added in all four places or in none. */
    description: str(p.description, 1200),
    category: str(p.category, 60),
    type: str(p.type, 40),
    thc: num(p.thc),
    cbd: num(p.cbd),
    /* A PROTOCOL-RELATIVE URL IS A REAL URL. Requiring ^https?: threw away
       every //images.dutchie.com/... the collector sent, which is a silent way
       for a product with a perfectly good photo to arrive with none. Still
       nothing but http(s) reaches the shelf -- data: URIs and relative junk are
       rejected as before, and the collector already absolutises what it can. */
    image: imageUrl(p.image),
    /* The lab result, where the shop publishes one. Same URL discipline as the
       image: http(s) only, protocol-relative normalised. toProduct() already
       reads `coa`, and the engine already renders a "view COA" link on any card
       carrying one -- so this is the last missing link in that chain. */
    coa: imageUrl(p.coa),
    /* The multi-buy offer, verbatim. Never parsed into a price here: "5 for
       $100" is arithmetic, "buy 2 get 1" is not, and a guessed rule would put a
       wrong per-gram figure on exactly the products people came for. */
    deal: str(p.deal, 120),
    url: /^https?:\/\//.test(String(p.url || "")) ? str(p.url, 400) : "",
    batch: str(p.batch, 60),
    packagedDate: str(p.packagedDate, 40),
    inStock: p.inStock !== false,
    sizes: (Array.isArray(p.sizes) ? p.sizes.slice(0, 12) : []).map(s => ({
      label: str(s && s.label, 60),
      price: num(s && s.price),
      grams: num(s && s.grams) || 0,
      /* A stated discounted price, kept BESIDE the shelf price rather than
         replacing it, so the saving is visible instead of silently applied. */
      sale: num(s && s.sale),
    })).filter(s => s.price != null && s.price >= 0),
  }));

  /* A ROW WITH NO LINK OF ITS OWN IS NOT A PRODUCT HERE.
   *
   * A capture run on a marketing page put three real products on the shelf as
   * dead links and a fourth row named "THCA Deals, Delta 9 Products, THCA
   * Products" -- a breadcrumb trail read as a product name. All four carried no
   * product url, because there was none on the page to read.
   *
   * Rejected rather than stored, and that is the whole point: a dead link is a
   * shopper clicking through to nothing, and a breadcrumb on the shelf is the
   * site inventing a product. Failing here makes a bad capture fail LOUDLY --
   * the panel reports fewer rows stored than sent -- instead of quietly seeding
   * junk that has to be found later by eye.
   *
   * The rendered-page and printed-text layers are exempt by construction: they
   * fall back to location.href, which IS a url, and captureKeyer already knows
   * a url carrying many names is a page rather than an identity. What has no
   * url at all is a row nothing could ever link to. */
  /* THE CENSUS IS COUNTED HERE, over the rows as SENT, and handed back with
     them. It used to be recomputed inside the 400 branch, which meant it only
     existed on the path where every row failed -- see the note on `dropped` in
     the handler for what that cost. */
  const has = f => list.filter(f).length;
  const census = {
    received: list.length,
    withName:  has(p => p && String(p.name || "").trim()),
    withPrice: has(p => p && Array.isArray(p.sizes) &&
                        p.sizes.some(s => s && s.price != null && Number(s.price) >= 0)),
    withUrl:   has(p => p && /^https?:\/\//.test(String(p.url || ""))),
  };
  return { rows: rows.filter(p => p.name && p.sizes.length && String(p.url || "").trim()), census };
}

/* WHY ROWS WERE DROPPED, in the caller's words rather than ours. Shared by the
   400 and the 200, because a capture where EVERY row fails and one where 99%
   fail are the same bug and deserve the same sentence. */
function dropReason(c, stored) {
  if (!c.received) return "No products were sent at all.";
  const miss = [];
  if (c.withName  < c.received) miss.push((c.received - c.withName)  + " had no name");
  if (c.withPrice < c.received) miss.push((c.received - c.withPrice) + " had no size carrying a price");
  if (c.withUrl   < c.received) miss.push((c.received - c.withUrl)   +
    " had no product url (http/https) -- a bare slug or a relative path is not one, and a row " +
    "nothing can link to is not a product here (see the breadcrumb note in sanitize)");
  if (!miss.length) {
    return stored
      ? "Every row carried all three fields; the rest were dropped by a rule not counted here."
      : "Rows carried all three fields individually, but no single row carried all of them.";
  }
  return "Every row needs a name, a priced size AND a url. Of " + c.received + " sent, " +
         miss.join("; ") + ".";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  /* The collector runs on the dispensary's origin, so it posts cross-origin. */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-ll-admin-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");

  const q = req.query || {};

  if (req.method === "GET") {
    /* THE STORE DIRECTORY, FOR THE BOOKMARKLET. Served from HERE rather than
       from /api/market because this endpoint is already the cross-origin one --
       Access-Control-Allow-Origin is set above, and the collector already talks
       to it. A second CORS surface would be a second thing to get wrong.
     *
       WHY IT EXISTS: guessStore() in public/coldwater-collector.js was a
       hand-written table of hostnames, which is a twin of api/market-stores.js
       kept in step by discipline -- and at 16 shops that was merely fragile.
       Detroit alone has ~61 licences and Grand Rapids 27, so the table was
       about to become the reason adding a shop is a code change, in a file
       whose entire premise is that adding a shop is data (ONE_CORE.md 5).
     *
       AND IT ANSWERS A SECOND QUESTION THE BOOKMARKLET SHOULD NEVER HAVE
       ASKED. The market used to be baked into the bookmarklet's own url
       (?market=detroit), so an operator needed one bookmarklet per city and
       clicking last night's wrote a capture into last night's namespace --
       silently, since nothing on a shop's page says which one you clicked.
       A shop cannot be wrong about which city it is in, so the SHOP decides and
       the parameter is only a fallback for a host nobody has registered.
     *
       EVERY CITY, not the one asked about: the collector does not know which
       city it is standing in -- that is the question it is asking. Small enough
       to send whole (key, name, town, hosts, slugs) and it names nothing that
       is not already public on the site. */
    if (q.directory != null) {
      /* THE HEMP SHELF IS A MARKET TOO, AND LEAVING IT OUT COST TWO CAPTURES.
       *
       * Reported for Hitoki and again for YLLVAPE: "read the site great, but
       * then didn't successfully push back to llm or the collect page". Both
       * read perfectly -- 22 and 32 rows off the shops' own feeds -- and both
       * vanished, because the collector derives the market from THIS directory
       * and falls back to "coldwater" for a key it cannot find. So a national
       * mail-order shop's capture was written into a Michigan town's namespace,
       * where /api/products (which reads market "llm") never looks and
       * /coldwater (which reads its own roster) has no such shop. Stored
       * perfectly, invisible on both surfaces -- the failure this file's own
       * comments warn about, one level up: not a wrong key, a wrong MARKET.
       *
       * The directory exists so that identifying the shop identifies the
       * market. A shop cannot be wrong about which market it is in, and the
       * hemp shops are as identifiable by host as the dispensaries are.
       *
       * IMPORTED DYNAMICALLY because api/products.js imports THIS file, and a
       * static import back would close the cycle. Enabled only: a delisted shop
       * must not be offered, for the reason Binoid and DSquared came off the
       * roster -- an operator should never be handed a shop whose captures
       * nothing will read. */
      let hemp = [];
      try {
        const prod = await import("./products.js");
        hemp = (prod.STORES || [])
          .filter(st => st.enabled !== false && st.domain)
          .map(st => ({ key: st.key, name: st.name, town: "llm",
                        site: "https://" + String(st.domain).replace(/^https?:\/\//, "") }));
      } catch { /* the directory is still correct for every city without it */ }

      const dir = [];
      for (const st of STORES.concat(hemp)) {
        const hosts = [], slugs = [];
        for (const u of [st.menuUrl, st.site]) {
          if (!u) continue;
          let h = "", path = "";
          try { const parsed = new URL(u); h = parsed.hostname.replace(/^www\./i, ""); path = parsed.pathname; }
          catch { continue; }
          if (h && hosts.indexOf(h) < 0) hosts.push(h);
          /* SLUGS FOR EVERY STORE, and the reason is a chain on its own
             domain. This once collected them only for MULTI_SHOP_HOST -- the
             platforms KNOWN to be shared, dutchie.com and friends -- which
             misses the case that arrived with Grand Rapids: House of Dank has a
             shop in two cities on shophod.com, and Exclusive in two on
             exclusivemi.com. `shared` is computed from the real host counts, so
             those hosts were correctly marked shared and then had NO SLUGS to
             be told apart by, leaving the matcher permanently unable to name
             either. Failing closed rather than wrongly, but useless.

             Collecting them everywhere is safe because the two filters below do
             the deciding: a slug claimed by more than one store is dropped, and
             the matcher consults slugs ONLY when the host is shared. On a
             single-shop domain they are simply never read. */
          for (const seg of path.split("/")) {
            if (!seg || /^(menu|shop|stores?|products?|embedded-menu|dispensary|order-online)$/i.test(seg)) continue;
            if (slugs.indexOf(seg) < 0) slugs.push(seg);
          }
        }
        dir.push({ key: st.key, name: st.name, town: st.town || DEFAULT_MARKET, hosts, slugs });
      }

      /* WHICH HOSTS CANNOT DECIDE ALONE, counted from the roster rather than
         assumed from a list of platforms. Two shops of one chain on one domain
         are shared too -- House of Dank has one in Detroit and one in Grand
         Rapids on shophod.com -- and no hand-kept list of "multi-shop
         platforms" was ever going to know that. */
      const hostCount = {};
      for (const st of dir) for (const h of st.hosts) hostCount[h] = (hostCount[h] || 0) + 1;
      for (const st of dir) st.shared = st.hosts.filter(h => hostCount[h] > 1);

      /* A SLUG IS AMBIGUOUS WITHIN A HOST, NOT ACROSS THE STATE, and counting
         it globally was wrong in both directions.
       *
         It dropped a good one: Lume's Coldwater shop is
         lume.com/stores/coldwater-mi-dispensary and Banzen's own site happens
         to carry the same path on banzencoldwater.com, so a global count read
         two claimants and binned the only thing telling Lume's five towns
         apart. Different hosts -- they were never in competition.
       *
         And it is the wrong question anyway: slugs are consulted ONLY when a
         host is shared, so the only collision that can mislead anyone is one
         between two stores on the SAME host. That is the Sapura/Exclusive
         failure in its general form, and it is what "all" really was -- five
         Lume towns whose menu path is lume.com/shop/all. */
      const perHost = {};
      for (const st of dir) {
        for (const h of st.shared) {
          const seen = (perHost[h] = perHost[h] || {});
          for (const g of st.slugs) seen[g] = (seen[g] || 0) + 1;
        }
      }
      for (const st of dir) {
        st.slugs = st.slugs.filter(g => st.shared.every(h => (perHost[h] || {})[g] === 1));
      }

      return res.status(200).send(JSON.stringify({ stores: dir, markets: Object.keys(MARKETS) }, null, 2));
    }

    const market = mkt(q.market);
    /* THE ROSTER COMES FROM THE ROSTER. This line used to carry Coldwater's
       seven shops as a hardcoded default for every city market, which is the
       same bug the market registry note above describes, one function along and
       one class down: a list of shops rather than a list of towns.
     *
       It could not fail loudly. Asked about Detroit it reported on Coldwater's
       shops, found nothing under any of them -- correctly, they are not
       Detroit's -- and returned 200 with a well-formed object of nulls. The
       install page reads that map to decide each row's state, so House of Dank
       sat there reading "not connected" with 1880 of its own rows on the shelf
       behind it, and Ascend beside it with 460. The one screen an operator
       checks to find out whether their capture landed said it had not.
     *
       `llm` is the national mail-order feed, whose shops live in
       api/products.js rather than in the market roster, so it keeps its own
       list; every city reads api/market-stores.js. An explicit ?stores= still
       wins, because this endpoint is also how you look for a capture stored
       under a key that is NOT on the roster (see onRoster below) -- which is
       exactly the case a roster-derived default cannot show you. */
    /* DERIVED, NOT HAND-KEPT, AND THAT CHANGES TWO THINGS.
     *
     * This was a literal string of nine keys with a comment admitting it was "a
     * hand-kept twin of the enabled keys in products.js" that "drifts silently
     * in exactly one direction" -- which had already happened twice (DSquared,
     * then Binoid) and needed test-capture-guards.mjs to hold it in place. It is
     * read from products.js now, so the drift is structurally impossible rather
     * than merely tested for, and a delisted shop disappears from it the moment
     * enabled:false is set, which is what both those delistings wanted.
     *
     * AND IT NOW INCLUDES THE GEAR SHOPS, which is a reversal worth stating.
     * The old list held consumables only, on the argument that "an accessory
     * catalogue is scraped, not captured". Two reports overtook that: Hitoki and
     * YLLVAPE were both captured deliberately, both read their catalogues
     * perfectly, and both vanished. The deciding fact is that api/products.js
     * ALREADY merges captures for every enabled store -- readCaptures() is
     * called with enabled.map(s => s.key) -- so those captures are read whatever
     * this list says. Leaving gear off it only hid the one screen an operator
     * checks to find out whether their capture landed, which is the exact
     * failure the paragraph above describes for House of Dank.
     *
     * An explicit ?stores= still wins, because this endpoint is also how you
     * look for a capture stored under a key that is NOT on the roster. */
    let llmKeys = "";
    if (market === "llm") {
      try {
        const prod = await import("./products.js");
        llmKeys = (prod.STORES || []).filter(st => st.enabled !== false).map(st => st.key).join(",");
      } catch { /* an empty roster reads as "nothing connected", not as a crash */ }
    }
    const keys = String(q.stores || (market === "llm"
      ? llmKeys
      : STORES.filter(st => (st.town || "coldwater") === market).map(st => st.key).join(",")))
      .split(",").map(k => k.trim()).filter(Boolean);
    const out = {};
    for (const k of keys) {
      const v = await readIngest(k, market);
      out[k] = v
        ? {
            products: (v.products || []).length,
            capturedAt: v.capturedAt,
            /* Per-collection counts, so the install page can show a capture
               accumulating rather than just a total that might be one section
               overwriting another -- which is the bug this shape fixes. */
            collections: v.collections || ["default"],
            source: v.source,
          }
        : null;
    }
    return res.status(200).send(JSON.stringify({
      storage: backendName(),
      persistent: kvOn() || neonOn(),
      writable: !!process.env.LL_ADMIN_TOKEN,
      stores: out,
      collector: "/coldwater-collector.js",
      install: "/coldwater-collect",
    }, null, 2));
  }

  if (req.method !== "POST") return res.status(405).send(JSON.stringify({ error: "method not allowed" }));

  const token = process.env.LL_ADMIN_TOKEN || "";
  if (!token) {
    return res.status(501).send(JSON.stringify({
      error: "ingest disabled",
      why: "LL_ADMIN_TOKEN is not set. Writes fail closed on purpose so an unconfigured deploy cannot have its catalogue written by a stranger.",
      fix: "Set LL_ADMIN_TOKEN in Vercel > Project > Settings > Environment Variables.",
    }));
  }
  if ((req.headers["x-ll-admin-token"] || "") !== token) {
    return res.status(401).send(JSON.stringify({ error: "bad or missing x-ll-admin-token" }));
  }

  const body = await readBody(req);
  /* From the body OR the query, since the collector posts one and the install
     page reads the other. Anything unrecognised falls back to coldwater, so a
     typo can never write into the hemp shelf by accident. */
  const market = mkt(body.market || q.market);
  const storeKey = String(body.storeKey || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  if (!storeKey) return res.status(400).send(JSON.stringify({ error: "storeKey required" }));

  /* Wipe the store's captures. A collection can be re-captured, but nothing
     could previously REMOVE one, so a menu section the shop retired would sit
     on the shelf forever. */
  /* Read once, up front: colour is written into this same record, and a second
     read would race the colour write against the collection write. */
  const existingRec = (await kvGet(storeKey, market)) || {};

  if (body.reset) {
    const cleared = await kvSet(storeKey, { storeKey, collections: {}, updated: new Date().toISOString() }, market);
    return res.status(200).send(JSON.stringify({ ok: true, storeKey, reset: true, via: cleared }));
  }

  /* COLOUR: the operator's own observations, written BEFORE the products gate
     because a note is a legitimate post on its own. Somebody standing in a shop
     with "they are out of the ounce" to record should not have to re-capture the
     whole menu to say it.

     STORED AT STORE LEVEL, NOT INSIDE A COLLECTION, and that is the load-bearing
     part. A collection is replaced wholesale by the next capture of it, so
     colour kept there would be wiped by the next harvest -- silently, and worst
     on the shops that are harvested most often. Colour has to outlive the rows
     it annotates, because the rows are re-read nightly and the observation is
     not.

     Keyed by the merge's rowKey so it survives re-reading: a lane's product id
     is built from that lane's own slug and will not exist tomorrow, while the
     batch tag and the normalised name will. */
  const colourIn = Array.isArray(body.colour) ? body.colour.slice(0, 500) : null;
  let colourWritten = 0;
  if (colourIn) {
    const book = (existingRec && existingRec.colour && typeof existingRec.colour === "object")
      ? { ...existingRec.colour } : {};
    const stamp = new Date().toISOString();
    for (const c of colourIn) {
      if (!c || typeof c !== "object") continue;
      const k = rowKey({ storeKey, batch: c.batch, brand: c.brand, name: c.name });
      /* A key with no name and no batch is the STORE's key alone, which would
         paint one note onto every product in the shop. */
      if (!k || !(String(c.name || "").trim() || String(c.batch || "").trim())) continue;
      const clean = sanitiseColour(c);
      /* An empty observation is a DELETE. That is the only way to take back a
         note that has stopped being true, and without it the layer that
         outranks everything would be the one thing nobody could correct. */
      if (!clean) { delete book[k]; colourWritten++; continue; }
      /* seenAt is stamped here rather than trusted from the client, because it
         is what decides when a perishable claim stops being published. A caller
         may state an earlier one deliberately; it cannot state a later one. */
      const said = Date.parse(clean.seenAt || "");
      clean.seenAt = (isFinite(said) && said < Date.parse(stamp)) ? new Date(said).toISOString() : stamp;
      book[k] = { ...(book[k] || {}), ...clean };
      colourWritten++;
    }
    existingRec.colour = book;
  }

  const { rows: products, census } = sanitize(body);
  /* A colour-only post is complete without products. */
  if (!products.length && colourWritten) {
    const payload = { ...existingRec, storeKey, updated: new Date().toISOString() };
    const via = await kvSet(storeKey, payload, market);
    return res.status(200).send(JSON.stringify({
      ok: true, storeKey, colourWritten, colourKeys: Object.keys(existingRec.colour || {}).length, via,
    }));
  }
  if (!products.length) {
    /* SAY WHICH CONDITION FAILED, because the url one arrived last and this
       message did not learn it. A caller posting well-formed rows with no url
       got told its SIZES were the problem, went looking at the size parser, and
       found nothing wrong with it -- which is exactly how a suite spent eight
       commits red against a sanitiser that was working as designed. */
    return res.status(400).send(JSON.stringify({
      error: "no usable products",
      why: dropReason(census, 0),
      received: census.received,
      withName: census.withName, withPrice: census.withPrice, withUrl: census.withUrl,
    }));
  }

  /* CAPTURES ACCUMULATE PER COLLECTION, and the previous behaviour was wrong
     for the way these menus are actually built. A Dutchie menu is paginated by
     category -- flower, then edibles, then vapes -- so ONE capture can never be
     a whole shop. Storing a flat products array per store meant the second
     collection silently replaced the first, and the operator watched the count
     stay flat while doing everything right.

     So a store holds a MAP of collections. Re-capturing "flower" replaces only
     flower, which is what makes prices refresh and sold-out rows disappear;
     capturing "edibles" adds to it. Read merges them.

     One record per store rather than one per collection, because neither KV nor
     the Neon helper here does prefix scans, and a read that needs a key list is
     a read that eventually misses one. */
  const collection = String(body.collection || "default").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "default";

  const existing = existingRec;
  const collections = (existing && existing.collections && typeof existing.collections === "object")
    ? existing.collections
    /* A pre-collections record held its rows at the top level. Keep them rather
       than dropping the operator's earlier work on the floor. */
    : (Array.isArray(existing.products) && existing.products.length
        ? { default: { products: existing.products, capturedAt: existing.capturedAt, source: existing.source, href: existing.href } }
        : {});

  collections[collection] = {
    products,
    capturedAt: new Date().toISOString(),
    source: String(body.source || "collector").slice(0, 120),
    /* THE LANE, separate from `source` on purpose -- see LANE_ALIAS in
       api/coldwater-merge.js. `source` is the reader layer that answered and is
       free text; this is who was reading, and it is what decides precedence.
       Absent means `manual`, because the bookmarklet is the only thing that has
       ever written here and a stored capture must not lose its rank the day a
       harvester starts posting beside it. */
    lane: laneOf(body.lane),
    href: String(body.href || "").slice(0, 300),
  };

  /* Cap the whole store, not just one collection, or twenty captures of a big
     menu become a payload no backend wants to hold. */
  let total = 0;
  for (const k of Object.keys(collections)) total += (collections[k].products || []).length;

  const payload = { storeKey, collections, colour: existingRec.colour || null, updated: new Date().toISOString() };
  const via = await kvSet(storeKey, payload, market);

  /* A CAPTURE UNDER AN OFF-ROSTER KEY IS STORED AND NEVER SEEN, and until now
     it said "Stored." and nothing else.
     api/coldwater.js reads captures for roster keys ONLY --
     readIngestMany(ROSTER.map(s => s.key)) -- because the roster is what pairs a
     capture to a named shop. So a mistyped or unknown storeKey writes perfectly,
     returns ok:true, and produces an empty shelf; the operator finds out much
     later, having captured twenty pages, and the natural conclusion is that
     storage is broken rather than that one field was wrong.
     IT IS STILL STORED. Refusing would throw away work that is correct in every
     way but its label, and the fix is a rename rather than a re-capture. What
     changes is that the answer says so, in the field the panel already prints. */
  /* CITY MARKETS ONLY. "llm" is the national mail-order hemp shelf, whose shops
     live in api/products.js's own STORES -- checking it against the dispensary
     roster would tell every hemp capture it is about to vanish, which is both
     wrong and exactly the kind of false alarm that teaches an operator to
     ignore the field. */
  const roster = market === "llm" ? null : STORES.filter(st => (st.town || "coldwater") === market);
  const onRoster = !roster || roster.some(st => st.key === storeKey);
  const names = Object.keys(collections);
  return res.status(200).send(JSON.stringify({
    ok: true, storeKey, collection,
    onRoster,
    /* Named, so the correction is a copy and paste rather than a hunt. */
    rosterKeys: onRoster ? undefined : (roster || []).map(st => st.key),
    stored: products.length,
    /* A PARTIAL DROP WAS SILENT, AND THAT IS THE EXPENSIVE HALF.
     *
       Reported as "it scraped everything perfectly and then only sent 14": the
       panel said 1,378 products in the batch, pressed Send, and came back
       "Sent. 14 products" in the same green as a complete capture. 1,364 rows
       went in the bin with no number naming them and no reason given, because
       every diagnostic this endpoint had lived inside the 400 branch -- which
       only fires when EVERY row fails. A 99% loss took the success path.
     *
       So the census travels on the 200 too, and the reason with it whenever
       fewer rows were stored than sent. Same sentence as the 400: 99% failing
       and 100% failing are the same bug and the operator needs the same fact. */
    received: census.received,
    dropped: Math.max(0, census.received - products.length),
    withName: census.withName, withPrice: census.withPrice, withUrl: census.withUrl,
    why: products.length < census.received ? dropReason(census, products.length) : undefined,
    total,
    collections: names.map(n => ({ name: n, products: (collections[n].products || []).length })),
    via, capturedAt: collections[collection].capturedAt,
    /* COMPOSED, NOT A TERNARY CHAIN. These three facts are independent and can
       all be true at once, and the chain published whichever came first: a
       capture that dropped 1,364 rows AND was held in memory only reported the
       memory. Each one is separately capable of making a capture never reach a
       shopper, so the note carries every one that applies, worst first --
       "it will never appear" before "most of it was binned" before "it will not
       survive a cold start". */
    note: [
      !onRoster
        ? "STORED, BUT IT WILL NOT APPEAR. \"" + storeKey + "\" is not a shop on the " +
          market + " roster, and the shelf only reads captures for shops that are on it. " +
          "Nothing is lost -- re-send with one of: " + (roster || []).map(st => st.key).join(", ") + "."
        : "",
      products.length < census.received
        ? "STORED, BUT " + (census.received - products.length) + " OF " + census.received +
          " ROWS WERE DROPPED. " + dropReason(census, products.length)
        : "",
      via.indexOf("memory") === 0
        ? "Held in this instance's memory only -- another lambda will not see it, and it is lost " +
          "on cold start. Attach a KV store to persist."
        : "",
    ].filter(Boolean).join(" ") ||
      "Stored. " + names.length + " collection" + (names.length === 1 ? "" : "s") +
      " for this shop, " + total + " products in total.",
  }, null, 2));
}

/* ---- what makes two captured rows the SAME product ------------------------
   THE TITLE IS NOT AN IDENTITY, and reading it as one is a cap disguised as a
   dedupe. THCA Small Buds sells one strain as several listings, so its
   /collections/thca-products runs to hundreds of rows over ~170 distinct
   titles; keyed by name the batch stopped dead at 170 and every further page
   of the menu replaced rows instead of adding them. Reported as "capping out
   at 170 and not saving from page to page", which is exactly what it is.

   The link is the identity, because it is the only thing the shop itself
   treats as one -- and api/products.js has keyed captures that way since
   captures existed (capKey). Query and trailing slash come off so
   ?variant= and ?_pos= tracking do not split one product into several.

   EXCEPT WHEN A URL IS NOT A PRODUCT'S. Two capture paths fabricate one: the
   rendered-page and printed-text layers have no per-card link, so they fall
   back to location.href, and captureToProduct() falls back to the store's
   home page. Key on that and a whole menu collapses to ONE row -- the same
   failure this fixes, an order of magnitude worse. A url carrying two
   different names is therefore not an identity, and those rows fall back to
   the name, which is what they had before. */
function normUrl(u) {
  return String(u == null ? "" : u).trim().split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
}

function captureKeyer(rows, opts) {
  const namesFor = new Map();
  for (const p of (rows || [])) {
    const u = normUrl(p && p.url);
    if (!u) continue;
    if (!namesFor.has(u)) namesFor.set(u, new Set());
    namesFor.get(u).add(String((p && p.name) || "").trim().toLowerCase());
  }
  const ambiguous = new Set();
  for (const [u, ns] of namesFor) if (ns.size > 1) ambiguous.add(u);
  for (const u of ((opts && opts.alsoAmbiguous) || [])) { const n = normUrl(u); if (n) ambiguous.add(n); }

  /* The name fallback stays scoped by store, so two shops selling the same
     strain never merge. Rows inside one store's record carry no `store` field
     and all scope to "", which is the same store by construction. */
  return function key(p) {
    const u = normUrl(p && p.url);
    if (u && !ambiguous.has(u)) return "u:" + u;
    const n = String((p && p.name) || "").trim().toLowerCase();
    return n ? ((p && p.store) || "") + "|n:" + n : "";
  };
}

/* What /api/coldwater reads: every collection flattened into the flat
   {products, capturedAt} shape it already expects.
   DEDUPED BY PRODUCT (see captureKeyer), because a "Shop All" capture overlaps
   every category capture almost completely, and without this the shelf would
   show each of those products two or three times at whatever price happened to
   sort first. Later collections win, so a fresh capture of one category
   corrects the older catch-all rather than being buried under it. */
async function readIngest(storeKey, market) {
  const rec = await kvGet(storeKey, market);
  return shapeIngest(storeKey, rec);
}

/* WHAT A STORED RECORD MEANS, in one place. Extracted when the batched reader
   arrived: two functions that fetched differently AND shaped differently would
   be two answers to "is this capture expired", and the one that ran on the hot
   path would be the one nobody tested. Fetching is the only thing that differs. */
function shapeIngest(storeKey, rec) {
  if (!rec) return null;
  if (!rec.collections) return rec;                       // pre-collections record

  const names = Object.keys(rec.collections);
  let newest = "";
  const sources = [];

  /* ORDER BY DECLARED RANK, NEVER BY Object.keys().
     This used to be "later collections win", where later meant whichever was
     written to storage first -- so which reader won a contested product was an
     accident of write order rather than a decision. With one writer that was
     invisible; with a harvester posting beside the operator it decides whose
     price the shelf shows. See api/coldwater-merge.js. */
  const ordered = names
    .map(n => ({ n, c: rec.collections[n] || {} }))
    .map(o => ({ ...o, lane: laneOf(o.c.lane), rank: sourceRank(laneOf(o.c.lane)) }))
    .sort((a, b) => (a.rank - b.rank) || (a.n < b.n ? -1 : 1));

  /* EXPIRY IS DECIDED FIRST, BEFORE THE KEYER IS BUILT.
     Nothing aged a capture out before this: at seven shops the operator
     remembered which were current, and at statewide scale nobody can. An
     expired capture is worse than an absent one -- absence reads as "not
     covered" while a month-old price reads as an offer. What is dropped is
     REPORTED rather than silently vanishing, because a store that quietly
     empties must look like a broken lane and not like a shop with an empty
     shelf.

     Ordering matters here: captureKeyer decides whether a url is ambiguous by
     looking across the whole set, so feeding it rows we are about to discard
     would let an expired capture change the key chosen for a live one. */
  const live = [];
  const dropped = [];
  for (const o of ordered) {
    const f = freshnessOf(o.c.capturedAt, o.lane);
    if (f.expired) {
      dropped.push({ collection: o.n, lane: o.lane, capturedAt: o.c.capturedAt || "",
                     ageDays: f.ageDays, expireDays: f.expireDays });
      continue;
    }
    live.push({ ...o, fresh: f });
  }

  /* THE KEY IS captureKeyer'S, NOT THE MERGE'S rowKey. They answer different
     questions and both are right: rowKey joins ACROSS LANES in product shape
     (batch tag, then normalised name), while this one dedupes WITHIN the stored
     captures in capture shape, preferring a product url and falling back to the
     title only where that url cannot tell two rows apart. Using rowKey here
     would undo #144's fix -- keying the batch by product rather than by title. */
  const every = [];
  for (const o of live) for (const p of (o.c.products || [])) every.push(p);
  const key = captureKeyer(every);

  const seen = new Map();
  const lanes = [];
  for (const { n, c, lane, fresh } of live) {
    if (c.capturedAt && c.capturedAt > newest) newest = c.capturedAt;
    if (c.source) sources.push(n + ":" + c.source);
    lanes.push({ collection: n, lane, products: c.products || [], capturedAt: c.capturedAt || "",
                 source: c.source || "", stale: fresh.stale, ageDays: fresh.ageDays });
    for (const p of (c.products || [])) {
      /* Ascending rank means a higher lane simply overwrites a lower one. */
      const id = key(p);
      if (id) seen.set(id, p);
    }
  }
  return {
    products: Array.from(seen.values()),
    capturedAt: newest || rec.updated,
    source: sources.join(" | ").slice(0, 300),
    collections: names,
    /* Colour is stored per store, keyed by row, and rides along untouched. */
    /* Perishable claims past their window are dropped on READ, the same way
       expires_at is enforced on read for Neon: there is no timer to run. */
    colour: (() => {
      const src = rec.colour && typeof rec.colour === "object" ? rec.colour : null;
      if (!src) return null;
      const out = {};
      for (const k of Object.keys(src)) { const a = ageColour(src[k]); if (a) out[k] = a; }
      return Object.keys(out).length ? out : null;
    })(),
    expiredLanes: dropped,
    /* Kept UNMERGED as well, because api/coldwater.js has to merge these against
       the scrape in product shape rather than capture shape, and flattening here
       would throw away the lane it needs to do that. */
    lanes,
  };
}

export { readIngest, readIngestMany, captureKeyer, normUrl };

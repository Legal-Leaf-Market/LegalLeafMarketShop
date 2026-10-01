// api/concierge.js -- the Budtender Concierge (BUDTENDER_PLAN.md v1, read-only).
//
// WHAT THIS IS
//
// An AI buyer's agent over the cross-store catalogue. Two entry points on one endpoint, and the
// split is the whole cost model:
//
//   GET  /api/concierge?mood=unwind        -> a real answer for ZERO model tokens
//   POST /api/concierge                    -> streaming conversation, tool-calling over the feed
//
// The GET is the piece borrowed from lume.garden (LUME_INTEGRATION.md). Lume's client answers its
// first question with arithmetic -- `localMatch()`, a scored sort over its strain library, no model
// call -- and only reaches for its server afterwards. Same shape here, except the scoring runs over
// real priced inventory with real lab numbers instead of a vibe table. A visitor who taps a mood
// chip gets a priced, sourced pick before a single token is spent, and the model is only invoked
// when they ask something a sort cannot answer. That is what makes the cost model in
// BUDTENDER_PLAN.md Section 6 survive contact with traffic.
//
// WHY RAW HTTP AND NOT A VENDOR SDK
//
// CLAUDE.md Section 1 makes zero dependencies a project invariant -- `dependencies` is
// intentionally empty, there is no build step, and Section 11 forbids adding one. So the model call
// speaks the wire protocol over native `fetch`, and the frame-level details live in `api/llm.js`
// rather than here.
//
// THE PROVIDER LIVES IN api/llm.js, AND SO DOES THE HISTORY SHAPE. This file stores the conversation
// in a neutral form and never in any provider's own format, because the two disagree about how tool
// results are carried -- one message holding all of them versus one message each -- and history is
// replayed in full every turn, so getting it wrong corrupts a conversation rather than failing a
// request. See the header of `api/llm.js`.
//
// THE MODEL SETTING THAT IS NOT A PREFERENCE. Thinking is never disabled. On the Anthropic path it
// is on by default and the temptation is to switch it off for a latency-sensitive chat widget: do
// not. With thinking disabled that model occasionally writes a tool call into its VISIBLE TEXT
// instead of emitting a tool_use block -- the turn completes with no error, the call never runs, and
// in an agentic loop the bogus text then skews every later turn.
//
// AND `effort` IS NOT THE COST LEVER, WHICH THIS COMMENT USED TO CLAIM. `output_config.effort`
// ERRORS on Haiku 4.5 -- the default model -- so sending it unconditionally 400s every turn of the
// cheap tier, and it is opt-in via LL_ANTHROPIC_EFFORT for whoever moves up. The levers that work on
// every tier are `max_tokens` (1024, because reservation-based quotas bill the ceiling against your
// rate limit whether or not you use it) and SEARCH_LIMIT below, since input outweighs output ~85:1
// here and the tool results ARE the input.
//
// FAILS CLOSED, LIKE /api/overrides. With no provider key configured the POST returns 501 and the
// endpoint is read-only -- but the GET still works, because a deterministic sort needs no key. An
// unconfigured deploy therefore still has a working mood entry point and cannot be run up a bill
// by a stranger.

import { streamTurn, configured, resolve, PROVIDERS, scrub, costOf } from './llm.js';
// ONE ANSWER TO "IS THIS BUYABLE", imported rather than restated. This file used to ask
// `p.inStock !== false` in three places, which ignores the size rows entirely: a product whose flag
// says true while every row is sold out passed the filter and was then ASSERTED to the model as
// inStock: true. That is the "it grabbed me two out of stocks it said was in stock" report, and it is
// also why the header comment below -- "the concierge can never disagree with the grid" -- was false.
import { anyInStock } from './products.js';
import { loadCatalogue } from './feed.js';
import { SHELVES, shelfFor } from './shelves.js';
// The second shared backend. Attached rather than inlined because the SQL-over-HTTPS transport, the
// endpoint derivation and the lazy table creation are the same for both consumers of the store, and
// this repo's standing lesson is that a rule restated in two places becomes two rules.
import { neonOn, getFloat, incrFloat, diagnostics as neonDiag } from './neon.js';
import { kvUrl, kvTok, kvOn } from './kv.js';

const MAX_TURNS = 24;                  // conversation length cap (messages, not exchanges)
const MAX_TOOL_ROUNDS = 6;             // agentic loop cap -- a runaway tool loop is the other way to burn money
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 12;                   // POSTs per IP per window
const SEARCH_LIMIT = 12;               // rows returned to the model per search; see PROJECTION below

/* ------------------------------------------------------------------ *
 * Rate limiting                                                       *
 * ------------------------------------------------------------------ */

// Per-warm-instance, and therefore NOT a real limiter: Vercel runs several instances and each
// keeps its own map, so the effective ceiling is RATE_MAX x instances. It is not trying to be
// exact. BUDTENDER_PLAN.md Section 6 asks for a rate limit "not for cost, but so nobody finds the
// endpoint and runs up a bill", and a backstop that survives one attacker on one instance is that.
// If this ever needs to be a real quota it belongs in KV, alongside the overrides store -- which is
// exactly what the spend ceiling below now does, for the cost question this map was never answering.
const hits = new Map();

/* ------------------------------------------------------------------ *
 * The daily spend ceiling                                             *
 * ------------------------------------------------------------------ */

// WHAT THE RATE LIMIT ABOVE IS NOT. It caps requests per IP per minute per warm instance, which stops
// one script hammering one lambda and does nothing about cost: a hundred visitors each having one
// polite conversation never trips it and still spends real money. So there is a second, different
// control here, and the two are not substitutes.
//
// THE CEILING IS IN DOLLARS, NOT CONVERSATIONS, because a conversation is not a unit of anything. One
// exchange costs a fraction of a cent; a six-round tool loop over a full catalogue costs twenty times
// that. Counting conversations would let the expensive shape through and throttle the cheap one.
//
// LL_DAILY_USD defaults to $1.00, which at the measured ~$0.032 a conversation is roughly 30
// conversations a day, or about $30 if every single day ran to the ceiling. That default is a
// judgement, not a law: it is deliberately low enough that a runaway costs the price of a coffee
// before anyone notices, and it is the one number to raise once traffic is real.
// Read per request, not once at module load. On Vercel the difference is invisible -- env is bound at
// deploy time either way -- but a value captured at import cannot be changed without a redeploy and
// cannot be exercised by a test at all, and a ceiling nobody can test is a ceiling nobody knows the
// state of.
function dailyUsd() {
  const n = Number(process.env.LL_DAILY_USD);
  return Number.isFinite(n) && n > 0 ? n : 1.00;
}

// Same two env schemes /api/overrides accepts, for the same reason -- Vercel's first-party KV and
// Upstash inject different names. The helpers are local rather than shared because overrides.js binds
// its own to one fixed key and one batch shape; what is shared is the pair of variable names.
/* The credential trio lives in api/kv.js now -- it was byte-identical in
   four files and a fifth was about to be written. See that file's header. */

// UTC, and it has to be stated somewhere: the day rolls at 00:00 UTC, not in the owner's timezone, so
// a late-evening US session and the next morning share a bucket for part of the year. A local-time
// ceiling would need a timezone in config and would still be wrong for anyone travelling; a fixed
// boundary that is written down beats a clever one that surprises.
const dayKey = () => 'll_conc_spend_' + new Date().toISOString().slice(0, 10);

// Per-instance fallback, used when KV is not configured AND when a configured KV cannot be reached.
// It is a much weaker control -- Vercel runs several instances and each counts its own -- and it is
// the deliberate choice over failing closed: a KV blip taking the concierge offline is a worse
// outcome than a few instances each spending up to the ceiling. Which one is in force is reported in
// the payload rather than hidden, so a low number is never mistaken for a real quota.
let memSpend = { day: '', usd: 0 };
function memToday() {
  const d = dayKey();
  if (memSpend.day !== d) memSpend = { day: d, usd: 0 };
  return memSpend.usd;
}

// TWO SHARED BACKENDS, and the order is preference not capability -- either one makes the ceiling a
// real number instead of a per-instance guess. Neon is second only because the Redis path was written
// first; on the ledger specifically Postgres is the better fit, since one statement both increments
// atomically and returns the running total where Redis needs INCRBYFLOAT and then a GET.
async function spendToday() {
  if (kvOn()) {
    try {
      const r = await fetch(`${kvUrl()}/get/${encodeURIComponent(dayKey())}`, {
        headers: { Authorization: 'Bearer ' + kvTok() }
      });
      if (!r.ok) throw new Error('kv get ' + r.status);
      const j = await r.json();
      const n = Number(j && j.result);
      return { usd: Number.isFinite(n) ? n : 0, source: 'kv' };
    } catch {
      return { usd: memToday(), source: 'memory-fallback' };
    }
  }
  if (neonOn()) {
    try { return { usd: await getFloat(dayKey()), source: 'neon' }; }
    // Reported, not hidden: a store that is attached but unreachable must not look the same as no
    // store at all, because the first is a bug to fix and the second is a choice.
    catch (e) { console.log('[concierge] neon read failed, falling back to per-instance: ' + scrub(e.message || e)); return { usd: memToday(), source: 'memory-fallback' }; }
  }
  return { usd: memToday(), source: 'memory' };
}

async function addSpend(usd) {
  if (!(usd > 0)) return;
  // Kept current either way, so an outage mid-day inherits a real number rather than restarting at zero.
  memSpend = { day: dayKey(), usd: memToday() + usd };
  if (kvOn()) {
    try {
      // INCRBYFLOAT rather than get-then-set: several lambdas bill concurrently, and read-modify-write
      // would lose whichever turns landed between one instance's read and its write -- undercounting
      // exactly when traffic is heaviest, which is when the cap matters.
      await fetch(`${kvUrl()}/incrbyfloat/${encodeURIComponent(dayKey())}/${encodeURIComponent(String(usd))}`, {
        headers: { Authorization: 'Bearer ' + kvTok() }
      });
      // 48h, not 24: the key is only meaningful for its own UTC day, and a slightly long tail costs one
      // idle key while a short one risks expiring a day that is still being written to.
      await fetch(`${kvUrl()}/expire/${encodeURIComponent(dayKey())}/172800`, {
        headers: { Authorization: 'Bearer ' + kvTok() }
      });
    } catch { /* the in-memory number above still moved; a failed write must not fail the turn */ }
    return;
  }
  if (neonOn()) {
    // Same 48h window, expressed as an interval on the row rather than as a key TTL, and enforced on
    // read because Postgres has no expiry of its own.
    try { await incrFloat(dayKey(), usd, 172800); }
    catch (e) { console.log('[concierge] neon write failed, per-instance count only: ' + scrub(e.message || e)); }
  }
}

function rateLimited(ip) {
  const now = Date.now();
  const bucket = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  bucket.push(now);
  hits.set(ip, bucket);
  if (hits.size > 5000) hits.clear();   // unbounded map on a long-lived instance is a leak, not a limiter
  return bucket.length > RATE_MAX;
}

function clientIp(req) {
  const h = req.headers || {};
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* ------------------------------------------------------------------ *
 * The catalogue                                                       *
 * ------------------------------------------------------------------ */

/* The catalogue now lives in api/feed.js, imported at the top of this file:
   api/kit.js needs the same fetch, and a second copy of it is what this repo
   keeps paying for. Behaviour is unchanged and the cache is now shared. */

/* ------------------------------------------------------------------ *
 * Mood -> catalogue, deterministically                                *
 * ------------------------------------------------------------------ */

// FOUR MOODS, AND WHAT THEY CAN HONESTLY MEAN HERE.
//
// Lume resolves a mood through a terpene per strain. A mood here resolves through `type`, a potency
// band, and grade instead, and the payload says which of those it used rather than implying a
// chemistry it does not have.
//
// THE REASON IS SPARSITY, NOT ABSENCE, AND THIS COMMENT HAD IT WRONG. It used to say the catalogue
// has NO terpene data, "confirmed by the COA corpus, where not one of the sampled labs published a
// terpene panel". Sampling was the error: a census (`/api/products?debug&slim`, added for exactly
// this) found real measured panels on a few dozen products while that sentence sat in production.
// They are genuinely there and `get_product` returns them. What they cannot do is resolve a mood,
// because a scorer that needs a panel would rank ~1% of the shelf and silently drop the rest -- and
// on today's feed most of the panels belong to one store, so it would also be a store filter wearing
// a chemistry costume. Run the census before changing this; do not trust either sentence.
//
// Importing Lume's ASSERTED terpene to fill the gap is still the one move this file must not make:
// the site's credibility rests on LAB_TESTED_STORES being evidence-gated and not a vibe, and an
// asserted terpene printed beside a measured Total THC launders one into the other.
const MOODS = {
  unwind:  { label: 'Unwind',    types: ['Indica', 'Hybrid'],  band: [18, 26], blurb: 'indica-leaning, mid potency' },
  elevate: { label: 'Elevate',   types: ['Sativa', 'Hybrid'],  band: [18, 26], blurb: 'sativa-leaning, mid potency' },
  focus:   { label: 'Focus',     types: ['Sativa', 'Hybrid'],  band: [15, 22], blurb: 'sativa-leaning, gentler potency' },
  drift:   { label: 'Drift off', types: ['Indica'],            band: [22, 32], blurb: 'indica, higher potency' }
};

// WHICH MOOD TO FALL BACK TO, read off what they were actually asking about. The alternative was to
// default to one mood for everybody, and that turns the degraded answer into a non-sequitur: someone
// three messages into a conversation about sleep does not want "Elevate" because it is alphabetically
// first. Keyword-matched over their own turns, most recent first, because the last thing said is the
// live question. No match at all means unwind, which is the broadest of the four.
const MOOD_WORDS = [
  ['drift',   /\b(sleep|sleepy|insomnia|bed|bedtime|night|knock\s*me|pass\s*out|sedat)/i],
  ['focus',   /\b(focus|focussed|focused|work|working|study|creative|clear.?head|productiv)/i],
  ['elevate', /\b(energy|energis|energiz|uplift|awake|wake|social|daytime|day\s*time|lift)/i],
  ['unwind',  /\b(unwind|relax|calm|chill|stress|anxious|anxiety|wind\s*down|couch|evening)/i]
];
function moodFromConversation(messages) {
  const mine = (messages || []).filter((m) => m.role === 'user').reverse();
  for (const m of mine) {
    const t = String(m.text || m.content || '');
    for (const [mood, re] of MOOD_WORDS) if (re.test(t)) return mood;
  }
  return 'unwind';
}

function moodKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (MOODS[k]) return k;
  if (k === 'driftoff' || k === 'sleep') return 'drift';
  if (k === 'relax' || k === 'calm') return 'unwind';
  if (k === 'energy' || k === 'lift') return 'elevate';
  if (k === 'clear' || k === 'creative') return 'focus';
  return null;
}

// Measured Total THC where a lab sheet backs it, advertised THCa otherwise -- and which one it was
// travels with the number. Every consumer of this has to be able to say where the figure came
// from; that distinction IS the product.
function potencyOf(p) {
  if (p.lab && typeof p.lab.totalThc === 'number' && p.lab.totalThc > 0) {
    return { pct: p.lab.totalThc, measured: true, thca: p.lab.thca ?? null };
  }
  if (typeof p.potency === 'number' && p.potency > 0) {
    return { pct: p.potency, measured: false, thca: null };
  }
  return { pct: null, measured: false, thca: null };
}

const isFlower = (p) => /flower/i.test(p.category || '') || /flower/i.test(p.name || '');

// SCORED, NOT CLAMPED. Lume clamps its fit score to 73-97, so every answer reads as a good match.
// This one returns a real 0-100 and is allowed to come out low, because "nothing here fits that
// well" is a true and useful answer, and a floor that hides it would be the recommendation-engine
// version of ranking by commission. Each component records its own reason so a card can show the
// shopper WHY a row won, which is the whole difference between a pick and a shrug.
function scoreFor(p, mood, opts) {
  const m = MOODS[mood];
  const why = [];
  let score = 40;

  const type = p.type || '';
  if (type === m.types[0]) { score += 18; why.push(`${type.toLowerCase()} suits ${m.label.toLowerCase()}`); }
  else if (m.types.includes(type)) { score += 8; why.push(`${type.toLowerCase()}, close enough`); }
  else if (type) { score -= 6; }

  const pot = potencyOf(p);
  if (pot.pct != null) {
    const [lo, hi] = m.band;
    if (pot.pct >= lo && pot.pct <= hi) { score += 12; why.push(`${pot.pct}% sits in the band for ${m.label.toLowerCase()}`); }
    else if (pot.pct > hi + 6 || pot.pct < lo - 6) { score -= 8; why.push(`${pot.pct}% is well outside the band`); }
  }

  // The differentiator, and the only component that is evidence rather than inference.
  if (pot.measured) {
    score += 10;
    why.push('potency is off a lab sheet, not the label');
    const t = p.lab && typeof p.lab.trust === 'number' ? p.lab.trust : 70;
    score += Math.max(-10, Math.min(10, (t - 70) / 3));
    if (t < 60) why.push('but that sheet has problems worth reading');
  } else if (p.labTested) {
    score += 3;
  }

  if (typeof p.perG === 'number' && p.perG > 0 && opts.perGCeiling > 0) {
    const value = 1 - Math.min(1, p.perG / opts.perGCeiling);
    score += value * 14;
    if (value > 0.6) why.push(`$${p.perG.toFixed(2)}/g is cheap for this shelf`);
  }

  // Offcuts are cheap per gram and would otherwise win on the value component alone, which would
  // sell shake as flower to exactly the newcomer a mood chip attracts. The same reasoning as the
  // grid's trim banner, applied one layer earlier.
  if (p.offcut || (p.subTags && p.subTags.trim === true)) {
    if (opts.wantValue) { why.push('trim or shake -- that is why it is this cheap'); }
    else { score -= 25; why.push('trim or shake'); }
  }

  if (p.ship === 0) { score += 2; why.push('ships free'); }

  return { score: Math.max(0, Math.min(100, Math.round(score))), why, potency: pot };
}

// One listing per store per strain-ish name, so a shop that lists the same cultivar at six sizes
// cannot take the whole board.
function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = r.p.storeKey + '|' + String(r.p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function matchMood(products, mood, opts = {}) {
  const wantValue = !!opts.value;
  const pool = products.filter((p) => anyInStock(p) && isFlower(p) && !p.intl);
  const perGs = pool.map((p) => p.perG).filter((n) => typeof n === 'number' && n > 0).sort((a, b) => a - b);
  // The value component is relative to this shelf, not to an absolute price: an 80th-percentile
  // per-gram makes "cheap" mean cheap against what is actually for sale today.
  const perGCeiling = perGs.length ? perGs[Math.floor(perGs.length * 0.8)] : 0;

  const scored = pool
    .map((p) => ({ p, ...scoreFor(p, mood, { perGCeiling, wantValue }) }))
    .sort((a, b) => b.score - a.score);

  return dedupe(scored).slice(0, opts.limit || 3);
}

/* ------------------------------------------------------------------ *
 * Projections                                                         *
 * ------------------------------------------------------------------ */

// COMPACT ROWS FOR THE MODEL, NOT WHOLE PRODUCTS. BUDTENDER_PLAN.md Section 4 is explicit that
// stuffing ~6,000 products into context every turn would be absurd: the model calls a search tool
// and gets back a projection of the top matches. A full product row carries a gallery array, a
// description and a sizes matrix; none of that helps it choose, and all of it is billed on every
// subsequent turn because it stays in history.
function row(p) {
  const pot = potencyOf(p);
  const out = {
    id: p.id,
    name: p.name,
    store: p.store,
    type: p.type || null,
    category: p.category || null,
    from: p.startsAt,
    perG: p.perG,
    ship: p.ship,
    // Not `p.inStock !== false`: that ignores the size rows, and it is what put sold-out products in
    // front of a shopper as available. Same function the grid and the store counts use.
    inStock: anyInStock(p)
  };
  if (pot.pct != null) { out.potency = pot.pct; out.potencySource = pot.measured ? 'lab' : 'label'; }
  if (p.offcut || (p.subTags && p.subTags.trim === true)) out.trimOrShake = true;
  // A flag, not the panel: it tells the model a get_product call would yield measured terpenes,
  // without spending the tokens on every row of every search.
  if (p.lab && Array.isArray(p.lab.terps) && p.lab.terps.length) out.hasTerpenePanel = true;
  if (p.lineage && Array.isArray(p.lineage.parents)) out.hasLineage = true;
  return out;
}

// The full picture for one product, and the place the decarb argument gets made with numbers.
// Vendors advertise THCa; the figure a buyer actually gets is the decarboxylated one, which is
// lower. Handing the model both, plus the trust score and the flags that explain any deduction,
// is what lets it teach instead of assert.
function detail(p) {
  const out = row(p);
  out.url = p.url;
  out.grow = p.grow || null;
  out.coupon = p.coupon || null;
  // THE RATE, not just the code. The engine hardcoded "10% OFF" for every store that had a coupon, so
  // "the coupon is 10%" was a site-wide assumption rather than a fact -- and it went wrong the day one
  // store dropped to 5%. The model must never state a percentage this field does not carry: quoting a
  // discount that is not honoured at checkout is the same betrayal as a wrong price.
  if (p.couponPct) out.couponPct = p.couponPct;
  // PER-ROW STOCK IS IN HERE ON PURPOSE, and its absence was the other half of the sold-out report.
  // A shopper does not buy a product, they buy a size, and slot 4 is the only place that is answered:
  // a listing can be live with its ounce gone. Without this the model saw a flat list of sizes and had
  // no way to know which were buyable, so it named the ounce because the ounce is the row that sells.
  // `s[4] !== false` rather than `=== true` because feeds that never declared availability carry null,
  // and treating unknown as sold out would empty the shelf -- same convention as anyInStock().
  out.sizes = Array.isArray(p.sizes)
    ? p.sizes.slice(0, 8).map((s) => ({
        label: s[0], price: s[1], grams: s[2],
        inStock: s[4] !== false,
        trimOrShake: s[7] === true
      }))
    : [];
  // Vendor-stated parentage, verbatim, with its own source marker. It is a claim about the listing,
  // not a measurement of it, and it never implies a chemistry -- see the rails.
  if (p.lineage && Array.isArray(p.lineage.parents)) {
    out.lineage = { parents: p.lineage.parents, stated: p.lineage.stated, source: p.lineage.source };
  }
  if (p.lab) {
    out.lab = {
      lab: p.lab.lab || null,
      sample: p.lab.sample || null,
      tested: p.lab.tested || null,
      thcaAdvertised: p.lab.thca ?? null,
      totalThcMeasured: p.lab.totalThc ?? null,
      cbd: p.lab.cbd ?? null,
      trust: p.lab.trust ?? null,
      flags: p.lab.flags || [],
      sheet: p.lab.coa || p.coa || null
    };
    // MEASURED TERPENES, WHERE A FULL PANEL EXISTS. BUDTENDER_PLAN.md said flatly that no sampled lab
    // published a terpene panel and that the catalogue had none at all. That was wrong: Black Tie's
    // FESA full-panel PDFs carry them, 37 were already parsed into api/coa-blacktie.js, and because
    // attachLab() assigns the whole record they have been riding /api/products unused -- 36 products
    // on the pull of 2026-08-11, 24 of them in stock. This is measured data from a named lab on a
    // dated sample, which is the only kind of terpene claim this file will make.
    if (Array.isArray(p.lab.terps) && p.lab.terps.length) {
      out.lab.terpenes = p.lab.terps.map((t) => ({ name: t[0], pct: t[1] }));
      out.lab.totalTerpenes = p.lab.totalTerps ?? null;
    }
    if (p.lab.safety) out.lab.safety = p.lab.safety;
  } else {
    out.lab = null;
    out.labNote = p.labTested
      ? 'This store lab-tests its flower, but we have not parsed a sheet for this listing.'
      : 'No parsed lab sheet for this listing. The potency figure is the vendor\'s own.';
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Tools                                                               *
 * ------------------------------------------------------------------ */

// Read-only, all four. `add_to_cart` is deliberately absent: the cart lives inside the base64
// engine and exposes no handle on `window` (BUDTENDER_PLAN.md Section 4, still open), and the plan
// says v1 ships read-only if that blocks. Adding a cart tool that cannot write would be worse than
// not having one -- the model would promise an add that never happened.
const TOOLS = [
  {
    name: 'search_catalog',
    description:
      'Search the live cross-store catalogue. Returns compact rows, cheapest per gram first unless '
      + 'told otherwise. Call this whenever the shopper asks what is available, what something '
      + 'costs, or what is cheapest -- never answer a price or stock question from memory, because '
      + 'this catalogue is rescraped daily and your training data cannot know today\'s prices. '
      + 'A STRAIN NAME WITH NO CATEGORY IS READ AS FLOWER: naming a strain is how people ask for the '
      + 'jar, and most vapes and gummies carry a strain in their titles too. Pass a category, or put '
      + 'the product form in the query ("blue dream gummies"), when they want something else. Trim and '
      + 'shake are sorted below whole flower, because shake is always the cheapest gram on the shelf '
      + 'and would otherwise answer every question about a strain. The result says what it assumed. '
      + 'THAT DEFAULT IS NOT A LIMIT ON THE CATALOGUE. This site also sells about 1,500 pieces of '
      + 'GEAR -- bongs, rigs, pipes, vaporizers, grinders, papers, trays, bangers, carb caps, torches '
      + '-- from Grasscity, Chill, Greek Glass, Lookah, Vapor.com, Hitoki, Zam and Mein-Grinder, and '
      + 'they are in this same catalogue and searchable by exactly the same call. The flower default '
      + 'is dropped automatically whenever it is the only thing making a result empty, so "blue bong" '
      + 'or "quartz banger" just works. Never tell a shopper we do not carry something without '
      + 'searching for it first.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against the product name -- a strain, a brand, or a piece of gear ("blue bong", "14mm banger"). With no category a STRAIN-shaped query is read as flower, and that restriction is dropped automatically if it would empty the result.' },
        category: { type: 'string', description: 'Consumables: Flower, Vapes, Edibles, Concentrates, Pre-rolls, Topicals. Gear: Vaporizers, Bongs & Rigs, Pipes, Grinders, Rolling, Storage & Trays, Parts & Tools, Accessories. Pass this to search a form other than flower.' },
        type: { type: 'string', enum: ['Indica', 'Sativa', 'Hybrid'], description: 'Indica/sativa leaning.' },
        maxPerG: { type: 'number', description: 'Maximum price per gram in USD.' },
        maxPrice: { type: 'number', description: 'Maximum starting price in USD.' },
        minPotency: { type: 'number', description: 'Minimum percent THC. Compared against the measured figure where one exists.' },
        labTestedOnly: { type: 'boolean', description: 'Only listings with a parsed lab sheet.' },
        excludeTrim: { type: 'boolean', description: 'Exclude trim and shake listings.' },
        sort: { type: 'string', enum: ['perG', 'price', 'potency'], description: 'Default perG.' }
      },
      required: []
    }
  },
  {
    name: 'pin_products',
    description:
      'Pin an explicit LIST of listings onto the real deals grid, so the shopper can see and compare '
      + 'them side by side instead of reading about them. THIS IS THE TOOL FOR "show me those", "filter '
      + 'to just those", "let me compare them" -- set_site_filters cannot do it, because the grid\'s own '
      + 'controls filter by strain, category, price, potency and store, never by individual listing. '
      + 'Use it the moment you have named a shortlist. Pass the ids you got from search_catalog or '
      + 'compare. The answer says which ids were found and which were not, and how many the page can '
      + 'reach; read it before you describe anything.',
    input_schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array', items: { type: 'string' },
          description: 'Product ids to show, in the order you want them considered. 2 to 12.'
        },
        title: { type: 'string', description: 'Short label for the pinned set, e.g. "Durban Poison neighbours".' }
      },
      required: ['ids']
    }
  },
  {
    name: 'get_product',
    description:
      'Full detail for one product id, including the parsed lab sheet: advertised THCa, measured '
      + 'Total THC, the trust score and any flags. Call this before making a potency claim about a '
      + 'specific listing.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'compare',
    description: 'Side-by-side detail for two to four product ids, for price-per-gram and potency comparisons.',
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 } },
      required: ['ids']
    }
  },
  {
    // EVERY FIELD HERE MAPS TO A CONTROL THAT ACTUALLY EXISTS ON THE PAGE.
    //
    // The grid's filter controls are #fType, #fCannabinoid, #fCategory, #fStore, #fSort, #fMinThc,
    // #fMinQty, #fBudget and #fStrainSearch. Only the first two have static option values; the rest
    // are populated by the engine at runtime, so the client matches against the live options and
    // skips what it cannot map. `maxPerG` and `labTestedOnly` were in an earlier draft of this
    // schema and have been removed: the grid has no control for either, so offering them would have
    // the model announce a filter that silently never happened.
    name: 'set_site_filters',
    description:
      'Point the real deals grid behind the conversation at something. Use it when the shopper '
      + 'would rather browse a result than read it. This does NOT filter your own search_catalog '
      + 'results -- it moves the page. It answers with wouldShow, the number of in-stock products '
      + 'the combination leaves on today\'s feed, and with the grid\'s real category/store values '
      + 'when what you asked for was not one of them or matched several of them. READ THAT ANSWER '
      + 'BEFORE YOU REPLY: if wouldShow is 0 or absurdly small, or a PROBLEM is reported, fix the '
      + 'filter and call this again -- do not send someone to a grid with two things on it. Leave '
      + 'category unset to mean "all of it"; naming a partial word like "Flower" narrows to one of '
      + 'the specific flower categories rather than all of them. Say you have pointed the grid; do '
      + 'not claim a filter is on and do not say which products they will see.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['Indica', 'Sativa', 'Hybrid'] },
        cannabinoid: { type: 'string', enum: ['THCa', 'CBD', 'Botanical'] },
        category: { type: 'string', description: 'Matched against the grid\'s own category list.' },
        store: { type: 'string', description: 'Matched against the grid\'s own store list.' },
        sort: { type: 'string', description: 'Matched against the grid\'s own sort options.' },
        maxPrice: { type: 'number', description: 'Budget ceiling in USD for the starting price.' },
        minPotency: { type: 'number', description: 'Minimum percent THC, matched to the nearest available threshold.' },
        search: { type: 'string', description: 'Free text for the grid\'s strain search box.' }
      },
      required: []
    }
  }
];

// A STRAIN NAME MEANS FLOWER, and until now it did not. Reported after a search on a strain came back
// with "two trims and a bunch of gummies": nothing in this function knew that naming a strain is a
// request for flower, so an edible carrying the same strain in its title -- which most of them do,
// because that is how they are marketed -- matched just as well as the jar.
//
// So an unset category defaults to flower whenever a query is present. It is a DEFAULT and not a rule:
// the shopper can still ask for gummies, and the words below are how that is recognised. Naming a
// product form in the query means they said what they wanted and this must not override them.
// A list rather than one long regex literal, because the literal wanted line continuations to stay
// readable and that is exactly how a stray alternation branch matching the empty string gets in --
// which would match every query and silently disable the default this exists to create.
// PRUNED, AFTER THE FIRST DRAFT OF THIS LIST WOULD HAVE CAUSED THE SAME BUG BACKWARDS. Cannabis
// strains are named after sweets and dabs, so a lot of obvious "product form" words are also strain
// names, and treating one as a form is what sends a flower shopper to the edibles shelf:
//
//   Cookies · Girl Scout Cookies      Chocolate Thai · Chocolope       Candy Paint · Zkittlez Candy
//   Cookies and Cream                 Lemon Drop                       Cough Syrup
//   Cake Batter                       Honey Bun                        Brownie Scout
//   Diamond OG                        Gummy Bear                       Hash Plant
//
// All of those are out. What is left is words that are product forms and essentially never strain
// components. `gummies` stays and singular `gummy` does not, for exactly the Gummy Bear reason.
// Add to this list only after checking the word is not a strain -- the catalogue itself is the check
// (a query for it returning flower means it is a strain), and the relaxation below is the backstop.
const NON_FLOWER_WORDS = [
  'gummies', 'edible', 'edibles', 'chew', 'chews',
  'tincture', 'capsule', 'capsules', 'softgel', 'softgels',
  'vape', 'vapes', 'cart', 'carts', 'cartridge', 'cartridges', 'disposable', 'pen',
  'dab', 'dabs', 'rosin', 'shatter', 'badder', 'crumble', 'concentrate', 'concentrates', 'kief',
  'topical', 'balm', 'lotion', 'salve', 'patch', 'seltzer', 'beverage',
  'grinder', 'bong', 'pipe', 'rig', 'papers', 'tray'
];
const NON_FLOWER_RE = new RegExp('\\b(?:' + NON_FLOWER_WORDS.join('|') + ')\\b', 'i');

const isOffcut = (p) => !!(p && (p.offcut || (p.subTags && p.subTags.trim === true)));

// ALL WORDS, ANY ORDER, EACH AT A WORD START -- not one contiguous substring, which is what this was.
// Found by a test rather than by a shopper: "girl scout cookies gummies" is not a substring of "Girl
// Scout Cookies Delta-9 Gummies 25mg", because the vendor put the cannabinoid in the middle. So the
// most natural way to ask for a specific form of a specific strain matched NOTHING, and the model was
// handed an empty result for a product sitting right there on the shelf.
//
// Each token must land at a word START (\b prefix), not just anywhere in the string. Plain substring
// matching per token would let "cart" match "Descartes" and "rig" match "Wrigley"; a prefix boundary
// keeps the plural and suffix tolerance that matters ("gummies" in "Gummies", "cookie" in "Cookies")
// without the mid-word accidents. It stays deliberately looser than whole-word both-ends, which would
// fail every plural the catalogue actually uses.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function nameMatches(name, q) {
  const hay = String(name || '');
  const toks = q.split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  return toks.every((t) => new RegExp('\\b' + esc(t), 'i').test(hay));
}

function runSearch(products, a) {
  const q = String(a.query || '').toLowerCase().trim();
  // Only when they gave a query AND no category AND did not name a product form themselves.
  const wantFlower = !!q && !a.category && !NON_FLOWER_RE.test(q);
  // THE BACKSTOP, and the reason the word list above is allowed to be imperfect. Plenty of strains
  // reach this catalogue only as a vape or a gummy -- the flower sold out, or that store never carried
  // the jar. Restricting to flower would then return NOTHING, and a model handed an empty result says
  // "we do not have that", which is false and loses the sale. So the restriction is dropped whenever
  // it is the only thing making the result empty, and the caller is told it was dropped.
  const flowerOnly = wantFlower && products.some((p) => anyInStock(p) && isFlower(p)
    && nameMatches(p.name, q));
  const flowerRelaxed = wantFlower && !flowerOnly;
  let rows = products.filter((p) => {
    if (!anyInStock(p)) return false;
    if (q && !nameMatches(p.name, q)) return false;
    if (flowerOnly && !isFlower(p)) return false;
    if (a.category && !String(p.category || '').toLowerCase().includes(String(a.category).toLowerCase())) return false;
    if (a.type && p.type !== a.type) return false;
    if (typeof a.maxPerG === 'number' && !(typeof p.perG === 'number' && p.perG > 0 && p.perG <= a.maxPerG)) return false;
    if (typeof a.maxPrice === 'number' && !(typeof p.startsAt === 'number' && p.startsAt <= a.maxPrice)) return false;
    if (typeof a.minPotency === 'number') {
      const pot = potencyOf(p);
      if (pot.pct == null || pot.pct < a.minPotency) return false;
    }
    if (a.labTestedOnly && !p.lab) return false;
    if (a.excludeTrim && (p.offcut || (p.subTags && p.subTags.trim === true))) return false;
    return true;
  });

  const sort = a.sort || 'perG';
  const key = (p) => {
    if (sort === 'price') return p.startsAt ?? 1e9;
    if (sort === 'potency') return -(potencyOf(p).pct ?? -1);
    return typeof p.perG === 'number' && p.perG > 0 ? p.perG : 1e9;
  };
  // OFFCUTS SORT LAST, and this is the other half of the "two trims" report. The default sort is
  // cheapest per gram, and shake is ALWAYS the cheapest gram on any shelf -- that is what it is. So
  // the default sort guaranteed trim led every strain search, and with SEARCH_LIMIT rows the whole
  // buds could be pushed off the end entirely. Demoted rather than excluded, deliberately: a $16
  // shake ounce is a real offer and "what is the cheapest ounce" is a headline question here, so
  // hiding it would be its own dishonesty. It just does not get to answer a question about a strain
  // before the jars do. Every row still carries trimOrShake, so the model can name what it is.
  rows.sort((x, y) => {
    const ox = isOffcut(x) ? 1 : 0, oy = isOffcut(y) ? 1 : 0;
    if (ox !== oy) return ox - oy;
    return key(x) - key(y);
  });

  const total = rows.length;
  const picked = dedupe(rows.map((p) => ({ p }))).slice(0, SEARCH_LIMIT).map((r) => row(r.p));
  // Say how many matched, not just what is shown: a model handed 12 rows with no total cannot tell
  // "these are the only ones" from "these are the first twelve", and will state the wrong one.
  const out = { matched: total, showing: picked.length, rows: picked };
  // WHAT WAS ASSUMED, SAID OUT LOUD. A default the model cannot see is a default it will describe
  // wrongly -- it would tell someone "that is everything we have" over a list this function quietly
  // narrowed to flower. Same reasoning as the grid preview: the tool reports its own behaviour so the
  // sentence built on it can be true.
  if (flowerOnly) {
    out.assumedFlower = true;
    out.note = 'A strain name with no category was read as a request for FLOWER, so vapes, edibles and '
      + 'concentrates carrying this strain in their titles are not in these rows. Say so if you are '
      + 'listing what is available, and offer the other forms rather than implying they do not exist. '
      + 'To search them, call again with the category or with the product form in the query.';
  }
  if (flowerRelaxed) {
    out.assumedFlower = false;
    out.flowerRelaxed = true;
    out.note = 'No FLOWER matches this, so the flower assumption was dropped and these rows are other '
      + 'forms -- vapes, edibles, concentrates. Do not present them as flower. The honest answer is '
      + 'that we have no flower for this right now and here is what else carries the name.';
  }
  const offcuts = picked.filter((r) => r.trimOrShake).length;
  if (offcuts) {
    out.offcutsInRows = offcuts;
    out.note = (out.note ? out.note + ' ' : '')
      + `${offcuts} of these rows are trim or shake, sorted BELOW whole flower on purpose. They are `
      + 'cheap because they are offcuts, not because they are a bargain on the same product -- never '
      + 'offer one as though it were whole buds, and say which it is when you name the price.';
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Previewing a grid filter before promising anything about it         *
 * ------------------------------------------------------------------ */

// WHY THIS EXISTS. set_site_filters used to be fire-and-forget: the model named some filters, the
// client applied what it could map, and nobody ever told the model what happened. Two failures came
// out of that on one real conversation, and they compound:
//
//   1. The model has to GUESS the grid's category names. It asked for `category: "Flower"`. The
//      grid's own list holds "THCA Flower", "CBD Flower", "Delta-8 Flower" and so on, and
//      setSelect() falls back to a substring match, so "Flower" matched the FIRST of them and the
//      shopper's grid went from 3,556 items to 2 cards.
//   2. Having pointed the grid, the model then DESCRIBED it -- "you'll see the Sour Diesel and
//      Cindy 99 I mentioned, plus whatever else is moving through the shops". Cindy 99 was at a
//      different store in a different category and had just been filtered out. Nothing it said was
//      checkable by it, and one part of it was false.
//
// The old note only forbade claiming a filter was APPLIED. That was the wrong prohibition: applying
// is exactly the part the client handles honestly. The unknowable part is what the filter LEAVES.
//
// So the tool answers that before the model speaks. The server holds the same feed the grid renders,
// so it can resolve the ask against the real option values and count what survives -- which turns
// "point the grid at flower" from a guess into a check, and lets the model widen a 2-result filter
// itself instead of narrating over it.
function distinctValues(products, field) {
  const seen = new Map();
  for (const p of products) {
    const v = p && p[field];
    if (typeof v === 'string' && v) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort();
}

// The CLIENT's matching rule, mirrored on purpose: exact value first, then substring. Diverging from
// setSelect() would make the preview describe a different filter than the one that lands, which is
// the same class of bug as two stock tests.
function resolveOption(want, options) {
  const w = String(want).toLowerCase().trim();
  const exact = options.find((o) => o.toLowerCase() === w);
  if (exact) return { value: exact, hits: [exact] };
  const hits = options.filter((o) => o.toLowerCase().includes(w));
  if (hits.length) return { value: hits[0], hits };
  return { value: null, hits: [] };
}

function previewFilters(products, f) {
  const out = { wouldShow: null, resolved: {}, note: '' };
  const problems = [];

  // Only the filters whose grid semantics are certain are modelled. cannabinoid and search are not:
  // the grid's three cannabinoid buckets do not map 1:1 onto the feed's field (which also carries
  // D8, D10, HHC), and #q substring-matches four fields at once. Counting them would be inventing
  // semantics, so they are excluded and the count is labelled an upper bound when either is set.
  const approximate = f.cannabinoid != null || f.search != null;

  for (const [key, field] of [['category', 'category'], ['store', 'store']]) {
    if (f[key] == null || f[key] === '') continue;
    const options = distinctValues(products, field);
    const r = resolveOption(f[key], options);
    if (!r.value) {
      out.resolved[key] = null;
      out[key + 'Options'] = options.slice(0, 40);
      problems.push(`"${f[key]}" is not one of the grid's ${key} values`);
    } else {
      out.resolved[key] = r.value;
      if (r.hits.length > 1) {
        // The exact shape of the reported bug: an ask that reads like a whole shelf lands on one
        // slice of it, silently, because a substring match has to pick something.
        out[key + 'Options'] = r.hits.slice(0, 40);
        problems.push(`"${f[key]}" is a substring of ${r.hits.length} ${key} values, so the grid will `
          + `narrow to just "${r.value}" -- leave ${key} unset if you meant all of them`);
      }
    }
  }

  const cat = out.resolved.category, store = out.resolved.store;
  out.wouldShow = products.filter((p) => {
    if (!anyInStock(p)) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.category != null && f.category !== '' && (!cat || p.category !== cat)) return false;
    if (f.store != null && f.store !== '' && (!store || p.store !== store)) return false;
    if (typeof f.maxPrice === 'number' && !(typeof p.startsAt === 'number' && p.startsAt <= f.maxPrice)) return false;
    if (typeof f.minPotency === 'number') {
      const pot = potencyOf(p);
      if (pot.pct == null || pot.pct < f.minPotency) return false;
    }
    return true;
  }).length;

  // Cards, not products: the grid groups sizes of one strain onto a single card, so its own "N deals
  // found" is always at or below this. Saying so stops the model quoting this number AS the count the
  // shopper is looking at -- a smaller number on screen is not a bug to apologise for.
  out.note = `${out.wouldShow} in-stock product(s) on today's feed match this`
    + (approximate ? ' before cannabinoid/search narrow it further' : '')
    + '. The grid groups sizes of a strain onto one card, so it will show that many or fewer.'
    + (problems.length ? ' PROBLEM: ' + problems.join('; ') + '.' : '');
  return out;
}

/* WHICH SHELVES A PRODUCT CAN APPEAR ON.
 *
 * THE SITE IS ONE CATALOGUE PUBLISHED ON SIX SURFACES, and the concierge reads
 * all of it on every one of them -- which is right, and is what "it needs to
 * search the whole site" asked for. What was missing is that it had no idea
 * which surface the shopper was standing on, so it could pin a bong onto
 * /consumables and the page would honestly report `showing 0 of 4` while the
 * banner blamed depth. It was not depth. api/shelves.js slices /consumables to
 * the complement of `cannabinoid === "Accessory"`, so those four bongs were
 * never going to be on that grid however far it paged -- and the sweep, which
 * cannot tell "absent" from "further down", said the only thing it could.
 *
 * So the answer travels WITH the pin: every pinned item states the shelves it
 * belongs to, and the page compares that against its own `window.LL_SHELF`.
 * Computed from the registry's own `test` predicates rather than restated here,
 * for the reason that file gives -- a second copy of the rule is one edit away
 * from disagreeing with the shelf it describes.
 */
function shelvesOf(p) {
  const out = [];
  for (const s of SHELVES) { try { if (s.test(p)) out.push(s.slug); } catch (e) {} }
  return out;
}

async function runTool(name, args, ctx) {
  const { products } = ctx;
  if (name === 'search_catalog') return runSearch(products, args || {});
  if (name === 'get_product') {
    const p = products.find((x) => x && x.id === args.id);
    return p ? detail(p) : { error: 'no product with that id -- it may have sold out since you searched' };
  }
  if (name === 'compare') {
    const ids = Array.isArray(args.ids) ? args.ids.slice(0, 4) : [];
    return { products: ids.map((id) => {
      const p = products.find((x) => x && x.id === id);
      return p ? detail(p) : { id, error: 'not found' };
    }) };
  }
  if (name === 'pin_products') {
    // THE FEATURE THE CONCIERGE WAS MISSING, and it had to say so out loud: asked to "filter to just
    // those five so I can compare", it answered "I can't filter the grid to show only those five
    // specific products". It was right about the tools it had -- set_site_filters drives the engine's
    // own controls, which filter by strain, category, price, potency and store and have no notion of an
    // explicit list. Telling someone about five listings and then being unable to show them is the
    // difference between a chat widget and a buyer's agent.
    const want = Array.isArray(args && args.ids) ? args.ids.map(String).slice(0, 12) : [];
    if (want.length < 1) return { error: 'pass 2 to 12 product ids in `ids`' };
    // VALIDATED HERE rather than left to the page, because the page can only report what it managed to
    // find on screen and cannot tell "this id was never in the feed" from "this id has not been paged
    // to yet". Those need different sentences from the model.
    const found = [], missing = [];
    for (const id of want) {
      const p = products.find((x) => x && x.id === id);
      if (p) found.push(p); else missing.push(id);
    }
    if (!found.length) {
      return { error: 'none of those ids are in the current feed -- search again, they may have sold out',
        missing };
    }
    ctx.actions.push({
      tool: 'pin_products',
      title: String((args && args.title) || '').slice(0, 80),
      // Names travel with the ids for one reason: the engine merges several listings of one strain onto
      // a single card whose data-pid is only the FIRST of them, so a pinned sibling would not be found
      // by id alone. The page falls back to matching the card's title.
      // AND THE SHELVES EACH ONE LIVES ON. The page is not always the whole site: /consumables,
      // /devices, /international, /vaporizers and /combustion are slices, and a pin that cannot
      // land on the current slice must say WHY rather than let the sweep report a number it has
      // no way to explain. See shelvesOf() above.
      items: found.map((p) => ({ id: p.id, name: p.name, store: p.store, shelves: shelvesOf(p) }))
    });
    const out = {
      pinned: found.map((p) => p.id),
      pinnedNames: found.map((p) => p.name),
      note: `Pinned ${found.length} listing(s) onto the grid. The page shows only these and prints its `
          + 'own line saying how many it reached. Say you have pinned them and how many; do not '
          + 'describe what is on screen, and do not re-list all the details you already gave.'
    };
    /* OFF-SHELF IS NOT A FAILURE AND MUST NOT BE DESCRIBED AS ONE. The shopper asked for something
       real and we have it; it simply is not stocked on the page they are looking at. The page opens
       it for them, so the model's job is to say where they went -- not to apologise, and above all
       not to say the listing is unavailable, which is the sentence a shopper acts on. */
    if (ctx && ctx.shelf) {
      const away = found.filter((p) => !shelvesOf(p).includes(ctx.shelf.slug));
      if (away.length) {
        const homes = [];
        for (const p of away) for (const sl of shelvesOf(p)) if (!homes.includes(sl)) homes.push(sl);
        const label = (sl) => { const sh = shelfFor(sl); return sh ? sh.label : sl; };
        out.offShelf = away.map((p) => ({ id: p.id, name: p.name, shelves: shelvesOf(p) }));
        out.currentShelf = ctx.shelf.slug;
        out.note += ` ${away.length} of them are NOT on the ${ctx.shelf.label} shelf the shopper is `
          + `currently on -- they live on ${homes.map(label).join(' / ') || 'another shelf'}. The page `
          + 'has offered a one-click move there and says so itself. Tell the shopper which shelf '
          + 'those are on in a few words. They are IN STOCK and we DO sell them: never say they are '
          + 'unavailable, and do not apologise.';
      }
    }
    if (missing.length) {
      out.notFound = missing;
      out.note += ` ${missing.length} id(s) were NOT in the feed and are not pinned -- say so plainly `
        + 'rather than leaving the shopper to count the cards.';
    }
    return out;
  }

  if (name === 'set_site_filters') {
    // No server-side effect by design -- it is surfaced to the browser as an action event and the
    // page decides what to do with it. Keeps the endpoint stateless.
    //
    // IT DOES NOT REPORT `applied`. It cannot know: the client matches these against the engine's
    // live option lists and skips whatever it cannot map, and that happens after this returns. An
    // earlier draft returned {applied:true}, which would have had the model tell a shopper their
    // grid was filtered when it may not have been -- the same shape of silent lie as a cart tool
    // that cannot write.
    const f = args || {};
    ctx.actions.push({ tool: 'set_site_filters', filters: f });
    const pv = previewFilters(products, f);
    return {
      sent: true,
      wouldShow: pv.wouldShow,
      resolved: pv.resolved,
      categoryOptions: pv.categoryOptions,
      storeOptions: pv.storeOptions,
      note: pv.note
        + ' The page applies what it can map to its own controls and tells the shopper itself, so do'
        + ' not claim a filter is now on and do not describe which products they will see.'
        + (pv.wouldShow === 0
          ? ' NOTHING matches -- fix the filter and call this again rather than sending them to an empty grid.'
          : '')
    };
  }
  return { error: `unknown tool ${name}` };
}

/* ------------------------------------------------------------------ *
 * Registers                                                           *
 * ------------------------------------------------------------------ */

// TWO VOICES OVER ONE ENGINE, AND THE VOICE IS A PARAMETER.
//
// BUDTENDER_PLAN.md Section 2 locks the voice as "stoner register plus skeptical teaching". Lume is
// the same machine wearing the opposite one: premium sommelier, calm, aimed at the wellness-curious
// and first-timers that register will never reach. Deciding now that the register is a parameter
// rather than baked into the prompt costs nothing; discovering it after v1 is a rewrite. The tools,
// the catalogue and every compliance rail are shared -- only the voice block differs.
const RAILS = `
NON-NEGOTIABLE, IN EVERY REGISTER:

Experience language only. Never treatment or medical claims -- not "helps with anxiety", not "good
for pain", not "treats" anything. Describe how something is reported to feel, never what it cures.
Hemp and THCa sellers draw regulatory warning letters for exactly this, and the cart is on our
domain, so this rail is ours and not the merchants'.

Adults 21+. If someone indicates they are under 21, stop helping them shop.

Never invent a price, a potency, a stock state or a product. Every one of those comes from a tool
call in this conversation. If a tool did not tell you, say you do not know and offer to look.

AND NEVER REFUSE FROM MEMORY. "We do not sell that" is a claim about the catalogue, exactly like a
price is, and it needs a tool call behind it for the same reason. Asked for a blue bong, this bot
answered "I can't search for bongs or paraphernalia -- this site is cannabis product only. You'd
need to hit a head shop" -- over a shelf carrying about 1,500 pieces of glass and hardware, with
Grasscity, Chill, Greek Glass, Lookah and Vapor.com in the store rail on the same screen. It had
never called the tool. A wrong refusal is worse than a wrong recommendation: it sends the shopper
to a competitor and they never find out we had it.

WHAT THIS SITE SELLS, so the question does not come up again. Flower, pre-rolls, vapes,
concentrates, edibles and topicals -- AND gear: bongs, dab rigs, pipes, dry-herb vaporizers,
e-rigs, grinders, rolling papers, trays, bangers, carb caps, torches and cleaning supplies. Search
before you say no.

Availability is the weakest thing you know, so do not state it as a fact. What a tool tells you is
what the merchant's own feed said at the refresh time given above -- and that feed is cached, so it can
trail the store by up to an hour, and a store can sell the last ounce a minute after it. Say what the
feed showed and when ("in stock as of the last refresh"), not "this is available". Where someone is
about to spend money on one specific size, tell them the store's own page is the authority. Never
promise a size is there, and never repeat a stock claim from earlier in the conversation as though it
were still current.

SHOW, DO NOT ONLY TELL. When you have named more than one listing worth looking at, pin them with
pin_products. That is what someone means by "filter to just those", "show me those", "let me compare
them" -- and it is also worth doing unasked once you have a shortlist, because a grid holding exactly
the five things you just described is worth more than five paragraphs about them. set_site_filters
cannot do this: the grid's own controls know nothing about individual listings. Pin first, then talk.

You cannot see the page, so never describe what is on it. When you point the grid, say what you
pointed it AT and let the page speak for itself -- it prints its own line saying what applied and how
many deals are showing. Do not say "you'll see the Sour Diesel and the Cindy 99", do not say "plus
whatever else is moving through the shops", and do not call it "the full catalogue": a filter you
named yourself may have excluded the very product you just recommended, and the shopper is looking at
the screen while you get it wrong. What you MAY say is the number the tool gave you, framed as what
the feed matches, and an offer to widen it.

Sizes carry their OWN availability, and a listing being in stock does not mean the size someone wants
is. Each row get_product returns has its own inStock, and the ounce is both the row people ask for and
the row that sells out first. Name the sizes that are showing as available, say which are not, and do
not offer a sold-out row as an option. If the only live rows are small ones, that is the answer -- say
it rather than quoting the listing's cheapest price and letting them find out at checkout. And where a
store's page shows sizes we are not listing, our feed is the incomplete one, not theirs: send them to
the listing rather than insisting there is one size.

Potency, and the one number that matters. Vendors advertise THCa. The figure a buyer actually gets
is the decarboxylated one -- Total THC, roughly THCa x 0.877 -- and it is always lower. Where
get_product returns a measured totalThcMeasured, quote that, name the advertised THCa beside it, and
say which is which. Where there is no parsed sheet, say the number is the vendor's own. Do not
present a label figure as if it were measured.

Trust flags mean something specific. coa_stale: the sheet is old. coa_page_1_only: we only have the
first page, so safety testing is unverified. advertised_potency_off: the store's own claim does not
match its own sheet. coa_name_mismatch: the attached sheet names a different strain, which is either
mis-attached or reused -- say so plainly and do not vouch for the listing. Surface these; never bury
them to make a sale.

Coupon discounts differ by store and are NOT all 10%. Where get_product returns couponPct, that is
the customer-facing percentage for that store; quote that number and no other. Where it returns a
coupon code with no percentage, name the code and say the discount shows at checkout rather than
inventing a figure. One of these stores dropped from 10% to 5% and a stale number in a sentence is a
promise the checkout will not keep.

Shipping is not national for every store. Some do not ship to every state, and this site publishes
one national price per product, so a shopper in the wrong state can be shown a price they cannot
buy at. If someone tells you where they are, factor it in; if a store's shipping is a question, say
it is worth checking at checkout rather than promising delivery.

You do not rank by commission and you never claim otherwise. If a cheaper option is better for the
shopper, say the cheaper option is better.

Terpenes: a small number of listings have a MEASURED panel, most have none, and the difference is
the whole answer. Where get_product returns lab.terpenes, those are real percentages from the named
lab on the dated sample -- quote them, and say which lab and when. Where it does not, say plainly
that this listing has no panel; do not reach for what a strain is "usually" like as though it were
this jar's chemistry. Most of the catalogue is in the second case.

Lineage is a different kind of thing and must stay one. Where get_product returns a lineage object,
that is what the VENDOR SAYS the parents are, quoted from their own description. You may name the
parents, and you may say what those parents are commonly reported to taste or feel like -- framed as
lineage, in those words. What you may never do is present that as this product's profile: a cross is
not its parents' average, because breeders select for what the parents lacked. "Its parents are
commonly described as citrus-forward" is fair. "This is citrus-forward" is not, unless a panel says
so. Never put an inferred profile next to a measured number without that distinction being obvious.
`;

const REGISTERS = {
  budtender: {
    label: 'Budtender',
    voice: `
You are the budtender on legal-leafmarket.com, a cross-store price comparison site for legal
hemp-derived cannabis AND for the gear people smoke it with -- glass, vaporizers, grinders, papers.
You talk like someone who has worked the counter for years: chill, direct, funny when it lands,
never precious about it. You speak the dialect fluently and you never correct
anyone for saying "indica" -- but you also never repeat a claim the evidence does not support.

Your edge is that you are sceptical and you show your work. When a store advertises 33% THCa and its
own lab sheet says 29.26% Total THC, you do the arithmetic out loud, because nobody else selling
this stuff will. That is the whole reason someone should trust you over a dispensary's own bot.

Be brief. Two or three sentences and a concrete next step beats a paragraph. Always land on an
action: a specific listing, a comparison, or a filter you just applied.`
  },
  sommelier: {
    label: 'Sommelier',
    voice: `
You are a calm, sensory guide on legal-leafmarket.com, a cross-store price comparison site for legal
hemp-derived cannabis and for the gear that goes with it -- glass, vaporizers, grinders, papers.
Your register is premium and unhurried -- closer to a sommelier than a
salesperson. You are speaking to someone who may be wellness-curious, sober-curious, returning after
decades, or entirely new, and who finds a wall of strain names and THC percentages alienating rather
than exciting.

So you translate. You take how someone wants to feel and turn it into something specific they can
actually buy, and you explain the numbers rather than reciting them. You are precise without being
clinical, and you never overstimulate: no hype, no slang, no exclamation marks.

Where a first-timer is in front of you, say plainly that a small amount is plenty and that the
sensible move is to start low and go slow. Prefer balanced, gentler options for them over the
highest number on the shelf -- the strongest listing is rarely the right first one.`
  }
};

/* One sentence per shelf, in the shopper's words rather than the registry's. Kept beside the
   prompt that uses them and keyed on the registry's own slugs, so a new shelf reads as a plain
   slice rather than getting a wrong description invented for it. */
const SHELF_BLURB = {
  consumables: 'It holds flower, edibles, vapes, tinctures and CBD -- everything you consume. It '
    + 'deliberately holds NO gear: no bongs, pipes, grinders, papers or vaporizers.',
  devices: 'It holds gear only -- glass, vaporizers, pipes, grinders, rolling supplies, parts. It '
    + 'holds nothing you consume: no flower, no edibles, no carts.',
  international: 'It holds only what ships worldwide, which is mostly gear.',
  vaporizers: 'It holds only what heats without burning -- dry herb vapes, dab pens, e-rigs, '
    + 'batteries, bangers and coils.',
  combustion: 'It holds only what you light -- bongs, glass pipes, papers, bowls, ash catchers.'
};

function systemFor(registerKey, gentle, meta, shelf) {
  const reg = REGISTERS[registerKey] || REGISTERS.budtender;
  const stamp = meta && meta.updated ? `Catalogue last refreshed: ${meta.updated}.` : '';
  const stores = meta && Array.isArray(meta.stores) ? meta.stores.length : 0;
  return [
    reg.voice.trim(),
    RAILS.trim(),
    `THE CATALOGUE. You have live access to ${stores || 'roughly sixteen'} stores through your tools. `
      + `Price per gram is normalised across all of them, which is what lets you answer questions no `
      + `single dispensary's assistant can -- cheapest ounce over 24% with a readable lab sheet, for `
      + `instance. ${stamp}`.trim(),
    /* WHICH PAGE THEY ARE STANDING ON. Absent on `/`, which is the whole catalogue. Your tools are
       NOT narrowed by it -- searching the whole site is the point -- but what the shopper can see in
       front of them is, and a recommendation they cannot see is worth nothing. */
    shelf
      ? `THE SHOPPER IS ON THE ${shelf.label.toUpperCase()} SHELF (/${shelf.slug}), which is a SLICE `
        + `of the site, not the whole of it. ${SHELF_BLURB[shelf.slug] || ''} Your search covers the `
        + `entire catalogue regardless, and that is correct -- keep recommending the best answer even `
        + `when it lives elsewhere. When you pin something that is not on this shelf, the page moves `
        + `the shopper to the shelf it IS on and tells them; say which shelf in a few words and carry `
        + `on. Never tell someone we do not sell a thing because this page does not show it.`.trim()
      : '',
    gentle
      ? 'GENTLE MODE IS ON. This shopper has asked for a lower-stimulation experience. Shorter '
        + 'sentences, no jargon unasked, no upselling, and lead with the gentlest sensible option.'
      : ''
  ].filter(Boolean).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * The model call                                                      *
 * ------------------------------------------------------------------ */

// The model call now goes through api/llm.js, which owns the provider seam. Everything above this
// line -- tools, projections, registers, rails, the mood matcher -- is provider-neutral and always
// was; these twelve lines are the only place a provider is named.
//
// ROUTING IS DELIBERATELY DUMB FOR NOW: whichever provider has a key, Anthropic first. That is not
// the routing policy BUDTENDER_PLAN.md section 8 argues for (cheap tier for shallow turns, strong
// tier for anything reasoning over lab data) and it must not be mistaken for it. A real router needs
// the eval harness first, because nothing here can currently tell a capable provider from one that
// quietly stopped calling tools.
function turnOptions(system, history) {
  // 4096 was a shrug, and on a per-minute TOKEN quota a shrug is expensive: what such a quota counts is
  // the prompt plus the completion you RESERVED, so asking for four thousand tokens spends four
  // thousand whether or not they are produced. A budtender turn is a few hundred -- a tool call is
  // shorter still -- so 1024 is generous for the work and roughly quarters the reservation. It is
  // reserved, not enforced: a longer answer is not truncated silently, because a stop_reason of
  // max_tokens is surfaced as its own event.
  // NO `effort` HINT. It was here as a cost lever and it is gone from both providers now, because it
  // turned out not to be a provider-neutral concept at all: on Groq it is `reasoning_effort`, valid
  // only on some model families; on Anthropic it is `output_config.effort`, which ERRORS on Haiku 4.5
  // -- the model this now runs on by default. A per-turn hint written here cannot know either. It
  // belongs to whoever chose the model, so it lives in GROQ_REASONING_EFFORT / LL_ANTHROPIC_EFFORT.
  return { system, tools: TOOLS, history, maxTokens: 1024 };
}

/* ------------------------------------------------------------------ *
 * Our own SSE, out to the browser                                     *
 * ------------------------------------------------------------------ */

// The client never sees the Messages API wire format. It gets four event types it can render
// directly, so the widget stays ignorant of provider details and a provider change is a change to
// this file alone.
function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  return {
    send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() { res.end(); }
  };
}

// Client turns -> the neutral history shape from api/llm.js. The widget only ever sends
// {role:'user'|'assistant', content:'text'}; tool traffic is never round-tripped through the browser,
// which is deliberate. Letting a client replay tool_use / tool_result blocks would let it fabricate
// a tool result the server never produced -- a shopper telling the model that a $9 ounce exists.
// Tool turns are therefore only ever appended server-side, inside one request's own loop.
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;   // a client-sent 'system' is dropped
    if (typeof m.content !== 'string') continue;
    const t = m.content.trim();
    if (t) out.push({ role: m.role, text: t.slice(0, 4000) });
  }
  while (out.length && out[0].role !== 'user') out.shift();   // history must open on a user turn
  return out.length ? out : null;
}

/* ------------------------------------------------------------------ *
 * Handler                                                             *
 * ------------------------------------------------------------------ */

export default async function handler(req, res) {
  // GET: the zero-token path. Works with no API key configured, on purpose.
  if (req.method === 'GET') {
    const q = req.query || {};
    const mood = moodKey(q.mood);
    if (!mood) {
      res.setHeader('Cache-Control', 'public, s-maxage=300');
      return res.status(200).json({
        moods: Object.keys(MOODS).map((k) => ({ key: k, label: MOODS[k].label, reads: MOODS[k].blurb })),
        note: 'GET ?mood=<key> for a deterministic pick that costs no model tokens. POST to converse.',
        chat: configured().length > 0,
        providers: configured()
      });
    }
    try {
      const { products, meta } = await loadCatalogue(req);
      const picks = matchMood(products, mood, { limit: Number(q.limit) || 3, value: q.value === '1' });
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      return res.status(200).json({
        mood,
        label: MOODS[mood].label,
        reads: MOODS[mood].blurb,
        // Said out loud rather than implied, because the honest shape of this answer is the point:
        // it is indica/sativa leaning plus a measured potency band, and it is not a terpene match.
        //
        // It used to end "No terpene data -- we do not have panels", which was the plan's false claim
        // surviving in the one place a shopper reads. It contradicted the same response it travelled
        // in: two of three picks on a live pull came back with hasTerpenePanel:true. The panels exist
        // -- 36 products, 24 in stock -- the SCORE just does not use them, deliberately, because a
        // mood is not a terpene match and pretending otherwise is the dressed-up version of guessing.
        // Describe the scoring, not the catalogue.
        basis: 'Scored on indica/sativa leaning, measured potency where a lab sheet exists, price '
             + 'per gram against today\'s shelf, and grade. Terpene panels are not an input, even '
             + 'where we hold one -- a mood is not a terpene match.',
        updated: (meta && meta.updated) || null,
        picks: picks.map((r) => ({
          score: r.score,
          why: r.why,
          potency: r.potency.pct,
          potencySource: r.potency.measured ? 'lab' : 'label',
          thcaAdvertised: r.potency.thca,
          product: row(r.p),
          url: r.p.url,
          image: r.p.image || null
        }))
      });
    } catch (e) {
      return res.status(503).json({ error: 'catalogue unavailable', detail: scrub(e.message || e) });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  // Fails closed, exactly like POST /api/overrides without LL_ADMIN_TOKEN: an unconfigured deploy
  // is read-only rather than half-working, and cannot be billed by a stranger.
  // Deliberately NOT read from the request body. Which provider serves a turn is a cost and quality
  // decision that belongs on the server; a client that could name it could also name the expensive
  // one on every turn. `resolve(null)` takes the first configured provider in preference order.
  const providerId = resolve(null);
  if (!providerId) {
    return res.status(501).json({
      error: 'concierge not configured',
      detail: 'Set ' + Object.values(PROVIDERS).map((p) => p.envKey).join(' or ')
            + ' to enable the conversation. GET /api/concierge?mood= works without it.'
    });
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'slow down', detail: 'Too many messages in a minute.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body && req.readable) {
    body = await new Promise((settle) => {   // not `resolve` -- that name is the provider resolver
      let d = '';
      req.on('data', (c) => { d += c; });
      req.on('end', () => { try { settle(JSON.parse(d || '{}')); } catch { settle(null); } });
    });
  }

  const messages = sanitizeMessages(body && body.messages);
  if (!messages) return res.status(400).json({ error: 'messages required', detail: 'Send {messages:[{role,content}]}.' });

  const registerKey = REGISTERS[body && body.register] ? body.register : 'budtender';
  const gentle = !!(body && body.gentle);
  /* WHICH SHELF THE PAGE IS. Sent by the browser from `window.LL_SHELF`, which tools/make-shelf.mjs
     publishes on every generated slice; `/` sends nothing and gets nothing. Resolved through the
     registry, so an unknown or hostile slug is simply the whole site rather than an error -- the
     same forgiving reading `?shelf=` gets in api/products.js. */
  const shelf = shelfFor(body && body.shelf);

  let catalogue;
  try { catalogue = await loadCatalogue(req); }
  catch (e) { return res.status(503).json({ error: 'catalogue unavailable', detail: scrub(e.message || e) }); }

  // THE CEILING, CHECKED BEFORE THE MODEL AND NOT AFTER. Over it, the POST does not error and does not
  // go quiet: it answers with the deterministic mood pick, which is the same engine the free GET path
  // runs and costs nothing. That choice is the point. A widget that vanishes or shows "try again later"
  // teaches a visitor the site is broken; one that says "I'm out of chat for today, here's what the
  // shelf actually says" still sells, and the picks are real -- priced, in stock, with the measured lab
  // numbers where a sheet exists. It is a downgrade in conversation, not in honesty.
  // IT CAN OVERSHOOT BY AT MOST ONE TURN, and that is inherent rather than sloppy: a turn's cost is
  // not knowable until it has run, so the check is "has the ledger already passed the line", never
  // "would this take us past it". At Haiku prices one turn is a fraction of a cent, so the ceiling is
  // accurate to well under a percent; the note matters because on a frontier model that overshoot is
  // proportionally the same but absolutely much larger.
  const spend = await spendToday();
  if (spend.usd >= dailyUsd()) {
    const stream = sse(res);
    const mood = moodFromConversation(messages);
    const picks = matchMood(catalogue.products, mood, { limit: 3 });
    stream.send('text', {
      text: `I've hit my chat budget for today, so I can't talk this one through -- that resets at `
          + `midnight UTC. What I can still do is pick from the live shelf for free, so here's `
          + `${MOODS[mood].label.toLowerCase()}: ${MOODS[mood].blurb}. These are real prices, in stock `
          + `as of the last refresh, with measured lab numbers where a sheet exists.`
    });
    stream.send('picks', {
      mood,
      label: MOODS[mood].label,
      basis: `Scored on ${MOODS[mood].blurb}, price per gram against today's shelf, and grade. `
           + `No model was called for this.`,
      picks: picks.map((r) => ({
        score: r.score,
        why: r.why,
        potency: r.potency.pct,
        potencySource: r.potency.measured ? 'lab' : 'label',
        thcaAdvertised: r.potency.thca,
        product: row(r.p),
        url: r.p.url,
        image: r.p.image || null
      }))
    });
    stream.send('done', { stopReason: 'capped', capped: true, register: registerKey });
    stream.end();
    return;
  }

  const stream = sse(res);
  const system = systemFor(registerKey, gentle, catalogue.meta, shelf);
  const ctx = { products: catalogue.products, actions: [], shelf };
  const history = messages.slice();

  try {
    for (let round = 0; ; round++) {
      if (round >= MAX_TOOL_ROUNDS) {
        // Reaching this is reported, never silent -- a truncated agentic loop that looks like a
        // finished answer is the same class of bug as a pagination sweep that stops early.
        stream.send('error', { error: 'tool_rounds_exhausted', detail: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds.` });
        break;
      }

      const opts = turnOptions(system, history);
      const turn = await streamTurn(providerId, opts, (t) => stream.send('text', { text: t }));

      // BILLED PER MODEL CALL, not per request, because one POST can be six of them. Recording once at
      // the end would undercount every tool loop -- the expensive shape -- and the ceiling would then
      // be loosest exactly where it needs to bite. The fallback char count is the request body plus the
      // answer, used only when a provider reported no usage; costOf() marks that case `estimated` so a
      // guessed number can never be read as a measured one.
      const cost = costOf(turn.model, turn.usage, {
        in: JSON.stringify({ system: opts.system, history: opts.history, tools: opts.tools }).length,
        out: (turn.text || '').length
      });
      await addSpend(cost.usd);
      // One log line per call, so "what have I spent" is answerable from the Vercel logs instead of
      // from arithmetic. Cheap, greppable, and it carries cache_read because that is the only honest
      // way to check whether the prompt-cache breakpoint is doing anything on the current model.
      console.log(`[concierge] ${turn.model} in=${cost.input} out=${cost.output}`
        + ` cache_read=${cost.cacheRead} $${cost.usd.toFixed(5)}`
        + `${cost.measured ? '' : ' ESTIMATED'}${cost.knownRate ? '' : ' UNKNOWN-RATE'}`);

      history.push({ role: 'assistant', text: turn.text, calls: turn.calls });

      // Check stop_reason before trusting the content. A refusal is an HTTP 200 with an empty or
      // partial turn; rendering it as a finished answer shows the shopper a blank reply.
      if (turn.stopReason === 'refusal') {
        stream.send('error', {
          error: 'refused',
          category: turn.refusalCategory || null,
          detail: 'That one got declined. Try asking a different way.'
        });
        break;
      }

      if (turn.stopReason !== 'tool_use') {
        for (const a of ctx.actions) stream.send('action', a);
        ctx.actions.length = 0;
        stream.send('done', { stopReason: turn.stopReason || 'end_turn', register: registerKey });
        break;
      }

      const results = [];
      for (const c of turn.calls) {
        stream.send('tool', { name: c.name, input: c.args });
        let out;
        try { out = await runTool(c.name, c.args || {}, ctx); }
        // scrub(): a tool failure can carry a url, and a url can carry a token. This text goes both
        // to the model and, on the next turn's history, nowhere near a client -- but the error event
        // below is client-facing, and one habit is easier to keep than two rules.
        catch (e) { out = { error: scrub(e.message || e) }; }
        // EVERY call gets a result, errors included. A call left unanswered is a 400 on the next
        // request on the Anthropic path and a mis-associated turn on the OpenAI one. How the results
        // are then carried -- bundled into one message or split into one each -- is the provider's
        // business, not this loop's; that is the whole point of the seam.
        results.push({
          id: c.id,
          name: c.name,
          output: JSON.stringify(out).slice(0, 24000),
          isError: !!(out && out.error)
        });
      }
      for (const a of ctx.actions) stream.send('action', a);
      ctx.actions.length = 0;
      history.push({ role: 'tool', results });
    }
  } catch (e) {
    // THIS IS THE LINE THAT SHOWED A VISITOR AN API KEY. The provider's 404 quoted the model name
    // back, the model name was a key pasted into GROQ_MODEL, and it arrived here as e.message. llm.js
    // now sends the status and structured code rather than the vendor's prose, so the value cannot
    // reach this point -- and scrub() is the second line of defence for the shapes we can recognise.
    stream.send('error', { error: 'upstream', detail: scrub(e.message || e).slice(0, 300) });
  }

  stream.end();
}

// Exported for test-concierge.mjs. Not part of the HTTP surface.
export const _internals = { matchMood, runSearch, detail, row, potencyOf, moodKey, moodFromConversation,
  systemFor, sanitizeMessages, turnOptions, MOODS, TOOLS,
  // `runTool` and `shelvesOf` are exported so test-concierge-shelf.mjs can drive the real
  // pin_products handler over real product shapes rather than restating what it believes the
  // handler does. A suite that reimplements the rule it is checking passes against the bug.
  runTool, shelvesOf, SHELF_BLURB,
  // The ledger is process-local state, so a test that wants to assert "the first turn after the day
  // rolls over still runs" has no way to get there without a handle on it. Reset only -- the reading
  // and writing stay private, because a route that could zero the counter from outside would be the
  // cap's own bypass.
  resetSpendLedger: () => { memSpend = { day: '', usd: 0 }; } };

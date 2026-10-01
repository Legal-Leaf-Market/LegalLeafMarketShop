/* api/comments.js — what other people thought, per product.
 *
 * "We could/should first comment on back of card and say expand full thread and
 * you can see everyone's comments on those products."
 *
 * ------------------------------------------------------------------
 * THIS IS THE FIRST THING ON THIS SITE A STRANGER CAN WRITE INTO, and that
 * changes what "shipping it" means. Every other endpoint here either reads a
 * merchant's feed or is gated on LL_ADMIN_TOKEN. An open POST on a public
 * cannabis affiliate site attracts, in roughly this order: SEO link spam,
 * sourcing requests ("who ships to X"), dosing advice from strangers, and
 * medical claims. The first is a nuisance; the last two are a liability, and
 * they arrive attached to real product listings we are paid to link to.
 *
 * SO NOTHING IS PUBLISHED BY A STRANGER. Anyone may write; a comment lands in a
 * queue with status "pending" and is invisible until somebody with the admin
 * token approves it. That is the whole safety design, and it is deliberately
 * not clever: no word filter to tune, no score to calibrate, no reputation to
 * game. A filter that is 95% right on a page like this is wrong once a week in
 * public, under a product we recommend.
 *
 * The cost is that comments only appear as fast as they are read. That is the
 * correct trade for a shelf whose entire proposition is that a number on it can
 * be trusted.
 *
 * ------------------------------------------------------------------
 * TWO KEYS, NOT ONE, AND THE SPLIT IS A READ-PATH DECISION.
 *
 *   ll_comments_v1        approved only, and shaped for the SHELF: one entry
 *                         per product carrying a count and the FIRST comment.
 *                         Every card back reads this, so it is fetched on every
 *                         page load and must stay small -- a full thread per
 *                         product would put a growing payload on the critical
 *                         path forever.
 *   ll_comments_queue_v1  everything ever written, pending and approved, with
 *                         full bodies. Read by the product page (one product at
 *                         a time) and by moderation. Never on the shelf path.
 *
 * The summary is DERIVED from the queue on every write rather than maintained
 * separately, because two stores of one truth is how they drift -- this repo
 * has the capture roster and four copies of storeCheckoutUrl() to prove it.
 *
 * ------------------------------------------------------------------
 * WHAT IS REFUSED AT THE DOOR, before anything is stored:
 *
 *   - LINKS. Any URL, any bare domain. This is the single biggest reason an
 *     open comment box exists on somebody else's site, and there is no version
 *     of "a link in a product comment" this site needs. Refused, not stripped:
 *     silently editing what somebody wrote is worse than declining it.
 *   - HTML. Angle brackets never survive; every surface escapes again anyway,
 *     because defence at one layer is defence nowhere.
 *   - Anything too long to be a comment or too short to be one.
 *   - A second comment on the same product from the same writer inside a
 *     minute, which is the shape of a script rather than a person.
 *
 * A NAME IS NOT AN IDENTITY, and the UI must never imply it is. There are no
 * accounts here; a name is whatever was typed. The only badge that means
 * anything is `staff`, set server-side when the admin token is present, and a
 * stranger cannot ask for it -- it is ignored on the public path rather than
 * validated, so there is no field to probe.
 */
import { kvOn, kvGetJson, kvSetJson } from './kv.js';
import { neonOn, getJson as neonGetJson, setJson as neonSetJson } from './neon.js';

const SUMMARY_KEY = 'll_comments_v1';
const QUEUE_KEY = 'll_comments_queue_v1';
const VERSION = 1;

const MAX_BODY = 1200;
const MIN_BODY = 2;
const MAX_NAME = 40;
/* Per product. A thread longer than this is not a thread, and the queue is one
   value in one key -- it has to stay a size a KV plan will hand back. */
const MAX_PER_PRODUCT = 200;
const REPEAT_WINDOW_MS = 60 * 1000;

/* Refused, not stripped. Bare domains too: "grab it at examplestore dot com"
   is the same advert with the punctuation removed, but a rule that chases
   every spelling of a dot is a rule that also refuses "3.5g", so this catches
   the honest forms and moderation catches the rest -- which is what moderation
   is for. */
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|shop|store|co|io|xyz|ru|cn)\b)/i;

function clean(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* Returns { ok:true, value } or { ok:false, why } -- a reason a caller can put
   in front of a person, rather than a boolean they have to guess about. */
function validate({ productId, name, body }) {
  const pid = clean(productId, 200);
  if (!pid) return { ok: false, why: 'No product was named.' };
  const who = clean(name, MAX_NAME) || 'Anonymous';
  const text = clean(body, MAX_BODY + 1);
  if (text.length < MIN_BODY) return { ok: false, why: 'That is too short to be a comment.' };
  if (text.length > MAX_BODY) return { ok: false, why: `Please keep it under ${MAX_BODY} characters.` };
  if (/[<>]/.test(text) || /[<>]/.test(who)) return { ok: false, why: 'Angle brackets are not allowed.' };
  if (LINKISH.test(text)) return { ok: false, why: 'Links are not allowed in comments.' };
  return { ok: true, value: { productId: pid, name: who, body: text } };
}

/* THE SUMMARY IS DERIVED, NEVER MAINTAINED. Two stores of one truth drift; one
   store and a projection cannot. */
function summarise(queue) {
  const out = {};
  for (const [pid, list] of Object.entries((queue && queue.p) || {})) {
    const live = (list || []).filter((c) => c && c.status === 'ok');
    if (!live.length) continue;
    const first = live[0];
    out[pid] = {
      n: live.length,
      first: { name: first.name, body: first.body, at: first.at, staff: !!first.staff },
    };
  }
  return { v: VERSION, updated: Date.now(), p: out };
}

async function loadQueue() {
  if (kvOn()) return (await kvGetJson(QUEUE_KEY)) || null;
  if (neonOn()) return (await neonGetJson(QUEUE_KEY)) || null;
  return null;
}
async function saveQueue(q) {
  const summary = summarise(q);
  if (kvOn()) { await kvSetJson(QUEUE_KEY, q); await kvSetJson(SUMMARY_KEY, summary); return true; }
  if (neonOn()) { await neonSetJson(QUEUE_KEY, q); await neonSetJson(SUMMARY_KEY, summary); return true; }
  return false;
}
async function loadSummary() {
  if (kvOn()) return (await kvGetJson(SUMMARY_KEY)) || null;
  if (neonOn()) return (await neonGetJson(SUMMARY_KEY)) || null;
  return null;
}

const storageOn = () => kvOn() || neonOn();

/* An id that sorts by time and needs no counter, so two lambdas writing in the
   same millisecond cannot collide on it. */
function newId(now, salt) {
  return now.toString(36) + '-' + String(salt || Math.random().toString(36).slice(2, 8));
}

function tokenOk(req) {
  const want = process.env.LL_ADMIN_TOKEN || '';
  if (!want) return false;
  const got = (req.headers && (req.headers['x-ll-admin-token'] || req.headers['X-LL-Admin-Token'])) || '';
  return got === want;
}

/* GET  /api/comments                    -> the shelf summary (small, cacheable)
 * GET  /api/comments?id=<pid>           -> one product's approved thread
 * GET  /api/comments?pending=1          -> the moderation queue   (token)
 * POST /api/comments                    -> write one              (public, queued)
 * POST /api/comments?action=approve|hide|delete&cid=<id>&id=<pid>  (token)
 */
export default async function handler(req, res) {
  const q = (req && req.query) || {};

  if (req.method === 'POST') {
    const admin = tokenOk(req);

    /* ---- moderation ---- */
    if (q.action) {
      if (!admin) return res.status(403).json({ error: 'forbidden' });
      if (!storageOn()) return res.status(501).json({ error: 'no storage backend' });
      const queue = (await loadQueue()) || { v: VERSION, p: {} };
      const list = (queue.p && queue.p[String(q.id)]) || null;
      if (!list) return res.status(404).json({ error: 'no thread for that product' });
      const i = list.findIndex((c) => c && c.id === String(q.cid));
      if (i < 0) return res.status(404).json({ error: 'no such comment' });
      if (q.action === 'delete') list.splice(i, 1);
      else if (q.action === 'approve') list[i].status = 'ok';
      else if (q.action === 'hide') list[i].status = 'hidden';
      else return res.status(400).json({ error: 'unknown action' });
      await saveQueue(queue);
      return res.status(200).json({ ok: true, action: q.action, id: String(q.cid) });
    }

    /* ---- somebody writing one ---- */
    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'expected a JSON body' });

    const v = validate(payload);
    if (!v.ok) return res.status(400).json({ error: v.why });

    /* FAILS CLOSED, and says so rather than accepting into nowhere. A comment
       box that swallows what somebody wrote is worse than one that is honestly
       switched off. */
    if (!storageOn()) {
      return res.status(501).json({
        error: 'comments are not configured',
        note: 'attach Upstash KV or Neon. Nothing is accepted until something can store it.',
      });
    }

    const now = Number(q.now) || Date.now();
    const queue = (await loadQueue()) || { v: VERSION, p: {} };
    queue.p = queue.p || {};
    const list = queue.p[v.value.productId] || (queue.p[v.value.productId] = []);

    /* The shape of a script rather than a person. */
    const recent = list.find((c) => c && c.name === v.value.name && now - (c.at || 0) < REPEAT_WINDOW_MS);
    if (recent) return res.status(429).json({ error: 'One at a time, please. Try again in a minute.' });

    if (list.length >= MAX_PER_PRODUCT) {
      return res.status(409).json({ error: 'This thread is full.' });
    }

    const c = {
      id: newId(now, q.salt),
      name: v.value.name,
      body: v.value.body,
      at: now,
      /* Set here or not at all. A stranger cannot ask for it: the field is
         taken from the token, never from the payload, so there is nothing to
         probe. */
      staff: admin || undefined,
      /* The whole safety design in one field. Admins publish immediately
         because an admin is the moderator. */
      status: admin ? 'ok' : 'pending',
    };
    list.push(c);
    await saveQueue(queue);
    return res.status(200).json({
      ok: true,
      status: c.status,
      note: c.status === 'pending'
        ? 'Thanks. It will appear once it has been read.'
        : 'Posted.',
    });
  }

  /* ---- reads ---- */
  if (q.pending) {
    if (!tokenOk(req)) return res.status(403).json({ error: 'forbidden' });
    const queue = (await loadQueue()) || { v: VERSION, p: {} };
    const rows = [];
    for (const [pid, list] of Object.entries(queue.p || {}))
      for (const c of list || []) if (c && c.status === 'pending') rows.push({ ...c, productId: pid });
    rows.sort((a, b) => (a.at || 0) - (b.at || 0));
    return res.status(200).json({ pending: rows.length, rows });
  }

  if (q.id) {
    /* One product's thread. Short cache: a newly approved comment should show
       up without waiting out a shelf-length window. */
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
    const queue = await loadQueue();
    const list = ((queue && queue.p && queue.p[String(q.id)]) || [])
      .filter((c) => c && c.status === 'ok')
      .map((c) => ({ id: c.id, name: c.name, body: c.body, at: c.at, staff: !!c.staff }));
    return res.status(200).json({ id: String(q.id), n: list.length, comments: list });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  const summary = await loadSummary();
  if (!summary) {
    return res.status(200).json({ v: VERSION, updated: 0, products: 0, p: {},
      note: storageOn() ? 'nothing approved yet' : 'no storage backend configured' });
  }
  return res.status(200).json({ ...summary, products: Object.keys(summary.p || {}).length });
}

export { validate, summarise, LINKISH, MAX_BODY, MIN_BODY, MAX_NAME, MAX_PER_PRODUCT,
         SUMMARY_KEY, QUEUE_KEY, VERSION };

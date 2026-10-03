// api/overrides.js — SHARED admin overrides, so a category or image fix made in the
// admin console is seen by every visitor instead of living in one browser's localStorage.
//
// This replaces the engine's dead `google.script.run -> getOverrides()` call. That was an
// Apps Script host API; it does not exist on Vercel, which is why admin edits stopped
// being shared when the site moved.
//
// Follows the same shape as api/subscribe.js: pick a backend from env vars, degrade
// gracefully, never break the site if nothing is configured.
//
//   GET  /api/overrides  -> { version, updated, cat:{}, fields:{}, source }
//   POST /api/overrides  -> save a batch. Requires header  x-ll-admin-token
//
// BACKENDS, in priority order:
//   1) Vercel KV / Upstash Redis  — KV_REST_API_URL + KV_REST_API_TOKEN
//        Vercel sets both automatically when you attach a KV store to the project.
//   2) Apps Script Web App        — LL_OVERRIDES_WEBHOOK  (the /exec url)
//        Matches the existing LL_CRM_WEBHOOK pattern; see APPS_SCRIPT_WEBHOOK.gs.
//   3) nothing configured        — GET returns an empty batch, POST returns 501 with
//        instructions. The site keeps working; overrides just stay per-browser.
//
// SECURITY, read this before enabling writes:
//   The admin console's PIN (5824) lives in client-side source. It is a speed bump, NOT
//   authentication — anyone can read it. So writes here are gated on LL_ADMIN_TOKEN, a
//   secret that must NEVER be committed or embedded in client code. The console prompts
//   for it once and keeps it in sessionStorage for that tab only.
//   If LL_ADMIN_TOKEN is unset, POST is disabled entirely. That is deliberate: failing
//   closed means an unconfigured deploy cannot have its catalog rewritten by a stranger.

import { neonOn, getJson as neonGetJson, setJson as neonSetJson, diagnostics as neonDiag } from './neon.js';
import { kvUrl, kvTok, kvOn } from './kv.js';

/* NAMESPACED BY MARKET, and the default is the ORIGINAL key byte for byte.
 *
 * /coldwater runs the same engine as the hemp shelf, so it has the same
 * window.LL_admin and can use the same override machinery -- but the two are
 * different catalogues to a customer and must never see each other's edits. A
 * shared key here would be the ll_cart mistake again: one operator renaming a
 * product in Coldwater would rename something on the national mail-order shelf,
 * and the first person to notice would be a shopper.
 *
 * api/coldwater-ingest.js already solved this exact problem and this copies its
 * shape -- a small allowlist, an unknown value folded to the default rather than
 * trusted, so ?market= cannot be used to write into an arbitrary key.
 *
 * `llm` KEEPS THE UNNAMESPACED KEY. Every override the hemp shelf has ever saved
 * lives under 'll:overrides', and a rename would orphan the lot silently -- the
 * page would come up with an empty batch and look like it had simply never been
 * configured. New markets get a suffix; the original keeps its name. */
const MARKETS = { llm: 1, coldwater: 1 };
const mkt = m => (MARKETS[String(m || '').toLowerCase()] ? String(m).toLowerCase() : 'llm');
const KEY_FOR = m => (mkt(m) === 'llm' ? 'll:overrides' : 'll:overrides:' + mkt(m));
const NEON_KEY_FOR = m => (mkt(m) === 'llm' ? 'll_overrides_v1' : 'll_overrides_v1_' + mkt(m));
const EMPTY = { version: 1, updated: 0, cat: {}, fields: {} };

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      try { return resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body); }
      catch (e) { return resolve({}); }
    }
    let d = ''; req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
  });
}

// Accept BOTH naming schemes. Vercel's first-party KV injected KV_REST_API_URL/TOKEN;
// Redis attached through the Vercel Marketplace (Upstash) injects UPSTASH_REDIS_REST_URL/
// TOKEN instead, and some setups inject REDIS_URL-style names. Reading only one set is a
// silent-failure trap: storage would be attached, the vars present, and publishing would
// still report "no storage backend configured" with nothing obviously wrong.
// The Neon backend, for the same reason the KV one exists: a store reachable over plain HTTPS. Added
// after Redis Cloud turned out to be TCP-only -- it is the obvious thing to attach from Vercel's
// Storage tab, it hands you a REDIS_URL, and there is no way to use that from a zero-dependency
// function. See the header of api/neon.js.
/* The credential trio lives in api/kv.js now -- it was byte-identical in
   four files and a fifth was about to be written. See that file's header. */
const hookOn = () => !!process.env.LL_OVERRIDES_WEBHOOK;

async function kvGet(market) {
  const r = await fetch(`${kvUrl()}/get/${encodeURIComponent(KEY_FOR(market))}`, {
    headers: { Authorization: 'Bearer ' + kvTok() }
  });
  if (!r.ok) throw new Error('kv get ' + r.status);
  const j = await r.json();
  if (!j || j.result == null) return null;
  // Upstash returns the stored string in `result`; it may already be an object.
  return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
}

async function kvSet(batch, market) {
  const r = await fetch(`${kvUrl()}/set/${encodeURIComponent(KEY_FOR(market))}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + kvTok(), 'Content-Type': 'application/json' },
    body: JSON.stringify(batch)
  });
  if (!r.ok) throw new Error('kv set ' + r.status);
  return true;
}

async function hookGet() {
  const url = process.env.LL_OVERRIDES_WEBHOOK;
  // Apps Script /exec urls 302-redirect to script.googleusercontent.com for the real body;
  // fetch follows that automatically. A 401/403 here means Google itself refused the
  // ANONYMOUS request -- i.e. the web app's "Who has access" is not "Anyone", or the url is
  // the login-required /dev variant. Include a snippet of Google's own error text (tags
  // stripped) because "401" alone cannot distinguish those cases.
  const r = await fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'fn=getOverrides');
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const snip = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error('hook get ' + r.status + (snip ? ' :: ' + snip : ''));
  }
  const t = await r.text();
  return JSON.parse(t || '{}');
}

async function hookSet(batch) {
  // An Apps Script Web App must be deployed "Anyone" for Vercel to reach it, which means
  // the /exec url is world-POSTable. So the write is authenticated a second time inside
  // the script: we forward LL_ADMIN_TOKEN and the .gs compares it to its own constant.
  // Without this, anyone who discovered the /exec url could rewrite the catalog even
  // though the Vercel route itself is gated. Reads need no secret -- the override data is
  // public by definition, every visitor fetches it.
  const r = await fetch(process.env.LL_OVERRIDES_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn: 'setOverrides', token: process.env.LL_ADMIN_TOKEN || '', batch })
  });
  if (!r.ok) throw new Error('hook set ' + r.status);
  const t = await r.text();
  let j = null; try { j = JSON.parse(t || '{}'); } catch (e) {}
  // Apps Script returns HTTP 200 even for application-level failures, so a bad shared
  // secret would otherwise look like a successful publish that silently saved nothing.
  if (j && j.ok === false) throw new Error('apps script: ' + (j.error || 'refused'));
  return true;
}

// Keep only the shape the engine's importBatch() understands, and drop anything huge or
// malformed. A corrupt shared batch would otherwise break the grid for every visitor.
function sanitize(raw) {
  const out = { version: 1, updated: Number(raw && raw.updated) || Date.now(), cat: {}, fields: {} };
  const copy = (src, dst, perKeyLimit) => {
    if (!src || typeof src !== 'object') return;
    for (const k of Object.keys(src)) {
      if (Object.keys(dst).length >= 20000) break;          // hard ceiling, not a silent trim
      const v = src[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      if (JSON.stringify(v).length > perKeyLimit) continue;  // one absurd entry cannot poison the batch
      dst[String(k)] = v;
    }
  };
  copy(raw && raw.cat, out.cat, 2000);
  copy(raw && raw.fields, out.fields, 8000);
  return out;
}

export default async function handler(req, res) {
  /* THE QUERY ONLY, because on a POST the body has not been read yet -- readBody()
     runs further down, so reaching for req.body here silently resolved every
     write to the default market and would have written Coldwater's edits into the
     hemp shelf's key. The exact collision this namespace exists to prevent. The
     POST branch re-resolves from its own parsed body. */
  const market = mkt(req.query && req.query.market);
  // ---------- READ: public. Every visitor pulls this so shared edits are visible. ----------
  if (req.method === 'GET') {
    // Short CDN cache: an admin edit should show up in well under a minute, but we do not
    // want a cold function on every pageview.
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    // Self-diagnosis for setup: which env vars did this deployment actually receive?
    // Booleans only -- never echo a token or url. Open /api/overrides in a browser after
    // configuring and this tells you whether the deploy picked the vars up, which is the
    // difference between "storage isn't attached" and "I forgot to redeploy".
    // Shape of the webhook url WITHOUT revealing it: host + suffix only, never the
    // deployment id. Distinguishes "/dev instead of /exec" and "not a web-app url at all"
    // from a genuine access-setting problem -- the three causes behind an identical 401.
    let webhookShape = null;
    if (hookOn()) {
      try {
        const u = new URL(process.env.LL_OVERRIDES_WEBHOOK);
        webhookShape = {
          host: u.host,
          endsWithExec: /\/exec$/.test(u.pathname),
          endsWithDev: /\/dev$/.test(u.pathname),
          looksLikeWebApp: /^\/macros\/s\/[^/]+\/(exec|dev)$/.test(u.pathname)
        };
      } catch (e) { webhookShape = { valid: false, error: 'LL_OVERRIDES_WEBHOOK is not a parseable url' }; }
    }
    const config = {
      storage: kvOn() ? 'kv' : (neonOn() ? 'neon' : (hookOn() ? 'webhook' : 'NOT CONFIGURED')),
      // Host and endpoint only, never the connection string -- it carries the password. "Which url did
      // it try" is the first question when a derived endpoint is wrong, and it has to be answerable
      // from a browser without reading logs.
      neon: neonDiag(),
      writes: process.env.LL_ADMIN_TOKEN ? 'enabled' : 'DISABLED (set LL_ADMIN_TOKEN)',
      webhookShape,
      saw: {
        KV_REST_API_URL: !!process.env.KV_REST_API_URL,
        KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
        UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
        DATABASE_URL: !!process.env.DATABASE_URL,
        POSTGRES_URL: !!process.env.POSTGRES_URL,
        // Present and useless on purpose: Redis Cloud injects this and it is a TCP url, so seeing it
        // true while storage reads NOT CONFIGURED is the expected answer, not a bug.
        REDIS_URL: !!process.env.REDIS_URL,
        LL_NEON_SQL_URL: !!process.env.LL_NEON_SQL_URL,
        LL_OVERRIDES_WEBHOOK: !!process.env.LL_OVERRIDES_WEBHOOK,
        LL_ADMIN_TOKEN: !!process.env.LL_ADMIN_TOKEN
      }
    };
    try {
      let batch = null, source = 'none';
      if (kvOn()) { batch = await kvGet(market); source = 'kv'; }
      else if (neonOn()) { batch = await neonGetJson(NEON_KEY_FOR(market)); source = 'neon'; }
      else if (hookOn()) { batch = await hookGet(); source = 'webhook'; }
      if (!batch) return res.status(200).json(Object.assign({}, EMPTY, { source, config }));
      const clean = sanitize(batch);
      clean.source = source;
      clean.counts = { cat: Object.keys(clean.cat).length, fields: Object.keys(clean.fields).length };
      clean.config = config;
      return res.status(200).json(clean);
    } catch (e) {
      // Never fail the storefront over overrides — return empty and say why.
      return res.status(200).json(Object.assign({}, EMPTY, { source: 'error', error: String(e.message || e), config }));
    }
  }

  // ---------- WRITE: gated. Fails closed when no token is configured. ----------
  if (req.method === 'POST') {
    const expected = process.env.LL_ADMIN_TOKEN;
    if (!expected) {
      return res.status(501).json({
        ok: false,
        error: 'writes disabled',
        hint: 'Set LL_ADMIN_TOKEN in Netlify > Project configuration > Environment variables, then redeploy, plus a backend: either an Upstash Redis store (KV_REST_API_URL and KV_REST_API_TOKEN, or the UPSTASH_REDIS_REST_ pair), a Neon database (DATABASE_URL), or LL_OVERRIDES_WEBHOOK set to an Apps Script /exec url.'
      });
    }
    const got = req.headers['x-ll-admin-token'];
    if (!got || String(got) !== String(expected)) {
      return res.status(401).json({ ok: false, error: 'bad or missing x-ll-admin-token' });
    }
    if (!kvOn() && !neonOn() && !hookOn()) {
      return res.status(501).json({
        ok: false,
        error: 'no storage backend configured',
        // Names the one that does NOT work, because it is the one most likely already attached: Redis
        // Cloud is offered right next to Upstash in Vercel's Storage tab and gives you a TCP url a
        // zero-dependency function cannot open.
        hint: 'Attach Upstash Redis (REST) or a Neon Postgres database, or set LL_OVERRIDES_WEBHOOK. '
            + 'A REDIS_URL on its own is not usable here -- that is a TCP endpoint and this runs with '
            + 'no database driver. See GET /api/overrides for what this deployment actually received.'
      });
    }
    const body = await readBody(req);
    /* Re-resolved from the body now that there IS one. The query still wins where
       it was given, so a form post and a fetch both work. */
    const wMarket = mkt((req.query && req.query.market) || (body && body.market) || '');
    /* THE WEBHOOK IS NOT NAMESPACED AND CANNOT BE. It is one Apps Script url
       configured for one shelf, so pointing a second market at it would merge the
       two by a route the key namespace never sees. Refused rather than shared --
       and refused loudly, because a silent merge is what this whole change is
       about. KV and Neon both namespace properly and are unaffected. */
    if (wMarket !== 'llm' && !kvOn() && !neonOn() && hookOn()) {
      return res.status(501).json({
        ok: false,
        error: 'webhook backend cannot hold a second market',
        hint: 'LL_OVERRIDES_WEBHOOK points at one Apps Script for one shelf. Attach Upstash KV or set DATABASE_URL to keep ' + wMarket + ' overrides separate.'
      });
    }
    const batch = sanitize(body && (body.batch || body));
    batch.updated = Date.now();
    try {
      // Same preference order as the read, which is the point: a write that landed in one backend
      // while reads came from another would publish an edit nobody ever sees.
      const backend = kvOn() ? 'kv' : (neonOn() ? 'neon' : 'webhook');
      if (backend === 'kv') await kvSet(batch, wMarket);
      else if (backend === 'neon') await neonSetJson(NEON_KEY_FOR(wMarket), batch);
      else await hookSet(batch);
      return res.status(200).json({
        ok: true,
        stored: { cat: Object.keys(batch.cat).length, fields: Object.keys(batch.fields).length },
        backend
      });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'GET or POST only' });
}

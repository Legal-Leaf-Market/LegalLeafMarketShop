/* api/kv.js — the one place this repo resolves KV credentials.
 *
 * WHY THIS EXISTS: FOUR BYTE-IDENTICAL COPIES. api/ambassador.js,
 * api/coldwater-ingest.js, api/concierge.js and api/overrides.js each carried
 * the same three lines, and a fifth was about to be written for price history.
 * That is the pattern this repo keeps paying for -- four copies of
 * storeCheckoutUrl(), two of rscRoots(), two of the capture keyer -- and every
 * one has cost a bug where the copies drifted and only somebody reading both
 * could tell.
 *
 * THE DRIFT HERE WOULD HAVE BEEN PARTICULARLY QUIET. If one file learned a new
 * env-var name and three did not, storage would be attached and working for
 * some features and reported as "NOT CONFIGURED" by others, on the same
 * deploy, with nothing obviously wrong. That is the exact failure the comment
 * in api/overrides.js already warns about for a single file; four files make
 * it four times as likely and no more visible.
 *
 * BOTH NAMING SCHEMES, AND THAT IS NOT OPTIONAL. Vercel's first-party KV
 * injects KV_REST_API_URL / KV_REST_API_TOKEN; Redis attached through the
 * Vercel Marketplace (Upstash) injects UPSTASH_REDIS_REST_URL / _TOKEN
 * instead. Reading only one set is a silent-failure trap: the store is
 * attached, the vars are present, and publishing still reports no backend.
 *
 * AND REDIS_URL ALONE IS USELESS HERE, which is worth repeating where the
 * credentials live rather than only in CLAUDE.md. Vercel's Storage tab offers
 * several Redis vendors and only Upstash exposes an HTTP data API. Redis Cloud
 * speaks RESP over TLS only, so a zero-dependency function cannot open it --
 * storage looks connected and every backend still reports unconfigured.
 */

const kvUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const kvTok = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const kvOn = () => !!(kvUrl() && kvTok());

/* Generic key/value over the same REST API the four callers use by hand.
 *
 * NEW CONSUMERS SHOULD USE THESE; the existing four keep their own get/set
 * because each shapes its own payload and rewiring working code at the same
 * time as extracting shared credentials is two changes wearing one commit.
 * They import the credential trio and nothing else, which is the part that was
 * actually duplicated. */
async function kvGetJson(key) {
  if (!kvOn()) return null;
  const r = await fetch(`${kvUrl()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: 'Bearer ' + kvTok() },
  });
  if (!r.ok) throw new Error('kv get ' + r.status);
  const j = await r.json();
  if (!j || j.result == null) return null;
  /* Upstash returns the stored string in `result`, and some paths hand back an
     object already. Both are normal; guessing which is not. */
  return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
}

/* `ttlSeconds` is optional. A key with no TTL lives until something deletes
   it, which is right for a catalogue-sized record and wrong for a daily
   counter -- so the caller says, rather than this file assuming. */
async function kvSetJson(key, value, ttlSeconds) {
  if (!kvOn()) return false;
  const q = ttlSeconds > 0 ? `?EX=${Math.floor(ttlSeconds)}` : '';
  const r = await fetch(`${kvUrl()}/set/${encodeURIComponent(key)}${q}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + kvTok(), 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error('kv set ' + r.status);
  return true;
}

/* What a diagnostic endpoint should print. Never the token -- the URL is
   harmless and the token is a credential, and a debug route that leaks one is
   worse than a debug route that says nothing. */
function kvDiagnostics() {
  return {
    on: kvOn(),
    url: kvUrl() ? kvUrl().replace(/^https?:\/\//, '').split('/')[0] : '',
    scheme: process.env.KV_REST_API_URL ? 'vercel-kv'
          : process.env.UPSTASH_REDIS_REST_URL ? 'upstash' : 'none',
    tokenPresent: !!kvTok(),
  };
}

export { kvUrl, kvTok, kvOn, kvGetJson, kvSetJson, kvDiagnostics };

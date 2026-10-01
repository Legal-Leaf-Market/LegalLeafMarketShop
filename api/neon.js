// api/neon.js -- Postgres over HTTPS, zero dependencies.
//
// WHY THIS EXISTS AT ALL
//
// The shared store behind /api/overrides and the concierge spend ledger needs to be reachable from a
// serverless function with NO client library, because CLAUDE.md Section 1 makes `dependencies`
// intentionally empty and Section 11 forbids adding a build step. That rules out most databases: a
// `postgres://host:5432` url is a raw TCP socket and needs `pg` or `ioredis` to speak.
//
// Two things pass that test. Upstash Redis exposes GET/SET over HTTPS, which is what the KV path in
// api/overrides.js already uses. And Neon exposes SQL over HTTPS -- the same endpoint its own
// serverless driver posts to -- so `fetch` can reach it directly.
//
// REDIS CLOUD DOES NOT PASS, and that is worth writing down because it is the obvious thing to attach
// from Vercel's Storage tab and it looks identical from the dashboard. It speaks RESP over TLS only.
// Its REST API at api.redislabs.com provisions databases; it does not read or write keys. Attaching it
// gives you a REDIS_URL and no way to use it from here.
//
// WHY POSTGRES IS ACTUALLY THE BETTER FIT FOR THE LEDGER
//
// The reason the Redis path used INCRBYFLOAT rather than get-then-set is that several lambdas bill
// concurrently and read-modify-write loses whichever turns land between one instance's read and its
// write -- undercounting exactly when traffic is heaviest. Postgres does that in one statement AND
// returns the new total, so it is one round trip where Redis needed two:
//
//   insert into ll_store (k, n) values ($1, $2)
//   on conflict (k) do update set n = coalesce(ll_store.n, 0) + $2
//   returning n
//
// NOT TESTED AGAINST A REAL NEON DATABASE. Egress from the container this was written in is refused,
// so every assertion about the wire format below comes from documentation and from the shape of Neon's
// own driver, not from a live call. Two consequences, both deliberate:
//
//   1. The endpoint is DERIVED from the connection string, and that derivation can be overridden with
//      LL_NEON_SQL_URL. If the derivation is wrong, it is fixable with an environment variable rather
//      than a code change and a deploy.
//   2. Failures are reported with the status, the body and the endpoint that was tried. A store that
//      silently does nothing is the failure mode this whole file exists to avoid, so it must never be
//      the failure mode of the file itself.

// Neon's Vercel integration injects several names depending on how it was attached, and reading only
// one is the silent-failure trap described in api/overrides.js: the database is connected, the vars are
// present, and the code reports "not configured". Pooled first -- serverless functions open and drop
// connections constantly, which is exactly what the pooler is for.
const CONN_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'NEON_DATABASE_URL'
];

export function connString() {
  for (const v of CONN_VARS) {
    const s = process.env[v];
    if (s && /^postgres(ql)?:\/\//i.test(s)) return s;
  }
  return '';
}

// The HTTP endpoint is the connection string's own host with /sql on it. Kept as its own function so
// the diagnostic route can print what would be called without calling it -- "which url did it try" is
// the first question when this does not work, and it must be answerable without a token in the output.
export function sqlEndpoint() {
  const explicit = process.env.LL_NEON_SQL_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const cs = connString();
  if (!cs) return '';
  try {
    const u = new URL(cs);
    if (!u.hostname) return '';
    return `https://${u.hostname}/sql`;
  } catch { return ''; }
}

export const neonOn = () => !!(connString() && sqlEndpoint());

// One table for both jobs -- a JSON blob column for the overrides batch and a float column for the
// spend counter. Two tables would be tidier in the abstract and worse here: this repo has never had a
// schema step, so every additional object is another thing that can be missing in one environment and
// present in another.
//
// `expires_at` is enforced on READ, not by the database, because Postgres has no TTL. A row whose time
// has passed is invisible rather than absent, which is the same observable behaviour as a Redis expiry;
// the cleanup below is housekeeping, not correctness.
const DDL = `
create table if not exists ll_store (
  k text primary key,
  v jsonb,
  n double precision,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
)`;

let ensured = false;

export async function sql(query, params = []) {
  const endpoint = sqlEndpoint();
  if (!endpoint) throw new Error('neon: no connection string -- looked for ' + CONN_VARS.join(', '));
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The driver authenticates by handing the whole connection string back in a header rather than
      // by a bearer token. It carries the password, so it must never be logged or echoed.
      'Neon-Connection-String': connString(),
      // Rows as objects keyed by column name. Without this some versions answer with arrays and every
      // row.n below would be undefined -- a wrong number rather than an error, which is worse.
      'Neon-Array-Mode': 'false'
    },
    body: JSON.stringify({ query, params })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // The endpoint is included because a derived host that does not exist is the single most likely
    // failure here and is otherwise indistinguishable from a credentials problem. The connection
    // string is NOT included: it contains the password.
    throw new Error(`neon ${r.status} at ${endpoint}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  const j = await r.json();
  return Array.isArray(j && j.rows) ? j.rows : [];
}

// Lazily, once per warm instance. Creating the table on first use is what keeps this from introducing
// a migration step somebody has to remember -- the alternative is a deploy that works on a database
// where the table happens to exist and fails on a fresh one, which is a difference nobody notices
// until they clone the project.
async function ensure() {
  if (ensured) return;
  await sql(DDL);
  // Housekeeping in the same cold-start window rather than on every write: expired rows are already
  // invisible to reads, so this is only about not accumulating one dead row per day forever.
  await sql('delete from ll_store where expires_at is not null and expires_at < now()').catch(() => {});
  ensured = true;
}

/* ------------------------------------------------------------------ *
 * The two operations the site actually needs                          *
 * ------------------------------------------------------------------ */

export async function getJson(key) {
  await ensure();
  const rows = await sql(
    'select v from ll_store where k = $1 and (expires_at is null or expires_at > now())', [key]);
  if (!rows.length || rows[0].v == null) return null;
  // jsonb comes back parsed on this transport, but a string is accepted too: guessing wrong here
  // would turn a working store into "no overrides" with nothing in the logs.
  return typeof rows[0].v === 'string' ? JSON.parse(rows[0].v) : rows[0].v;
}

export async function setJson(key, value) {
  await ensure();
  await sql(
    `insert into ll_store (k, v, updated_at) values ($1, $2::jsonb, now())
     on conflict (k) do update set v = excluded.v, updated_at = now()`,
    [key, JSON.stringify(value)]);
  return true;
}

// ATOMIC, AND IT RETURNS THE NEW TOTAL. Both halves matter: the increment cannot lose a concurrent
// lambda's turn, and getting the running total back means the caller does not need a second query to
// know where it stands.
//
// `expires_at` is only set when the row is created. On conflict it is deliberately left alone, so a
// day's window is fixed by its first write rather than sliding forward with every turn -- a sliding
// expiry on a daily counter would keep a busy day's row alive indefinitely.
export async function incrFloat(key, delta, ttlSeconds) {
  await ensure();
  const rows = await sql(
    `insert into ll_store (k, n, expires_at) values ($1, $2, now() + ($3 || ' seconds')::interval)
     on conflict (k) do update set n = coalesce(ll_store.n, 0) + $2, updated_at = now()
     returning n`,
    [key, delta, String(Math.max(1, Math.floor(ttlSeconds || 172800)))]);
  const n = rows.length ? Number(rows[0].n) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export async function getFloat(key) {
  await ensure();
  const rows = await sql(
    'select n from ll_store where k = $1 and (expires_at is null or expires_at > now())', [key]);
  const n = rows.length ? Number(rows[0].n) : 0;
  return Number.isFinite(n) ? n : 0;
}

// For the diagnostic route. Booleans and a host, never a credential.
export function diagnostics() {
  const cs = connString();
  let host = null;
  try { host = cs ? new URL(cs).hostname : null; } catch { host = 'UNPARSEABLE'; }
  return {
    configured: neonOn(),
    host,
    endpoint: sqlEndpoint() || null,
    explicitEndpoint: !!process.env.LL_NEON_SQL_URL,
    sawVar: CONN_VARS.find((v) => process.env[v] && /^postgres(ql)?:\/\//i.test(process.env[v])) || null
  };
}

// Test seam: the lazy-create latch is per-instance state, and a suite that runs several scenarios in
// one process needs to be able to assert the DDL is issued once per cold start rather than once ever.
export const _internals = { reset: () => { ensured = false; }, DDL, CONN_VARS };

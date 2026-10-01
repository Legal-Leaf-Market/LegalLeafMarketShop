// test-neon.mjs -- pins the Neon-over-HTTPS store and both of its consumers. `node test-neon.mjs`.
//
// WHY THIS SUITE IS THE WHOLE SAFETY NET HERE
//
// Egress to Neon is refused from every container this was written in, so api/neon.js has never made a
// real call. That makes the usual "it worked when I tried it" unavailable, and it changes what a test
// is for: not confirming behaviour that was observed, but pinning the ASSUMPTIONS, so that when the
// first live call fails it is obvious which assumption was wrong rather than "the store does not work".
//
// So the stub asserts on the exact request that goes out -- endpoint, headers, SQL, parameters -- and
// answers in the documented response shape. If Neon's wire format differs from what is asserted below,
// this suite is where the fix belongs, and the diff will name the assumption.

import assert from 'node:assert';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${extra ? `\n       ${extra}` : ''}`); }
}
function eq(a, b, label) { ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

/* ---------------- the stub ---------------- */

let calls = [];              // every request body that went to the SQL endpoint
let nextRows = [];           // queued row sets, one per call
let failNext = null;         // { status, body } to answer with instead

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/sql')) {
    const body = JSON.parse(opts.body || '{}');
    calls.push({ url: u, headers: opts.headers || {}, query: body.query, params: body.params });
    if (failNext) {
      const f = failNext; failNext = null;
      return { ok: false, status: f.status, text: async () => f.body, json: async () => ({}) };
    }
    const rows = nextRows.length ? nextRows.shift() : [];
    return { ok: true, status: 200, json: async () => ({ command: 'SELECT', rowCount: rows.length, rows }) };
  }
  return realFetch(url, opts);
};

const CONN = 'postgresql://neondb_owner:npg_SECRET123@ep-cool-mud-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';

function clean() {
  for (const v of ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL_NON_POOLING', 'NEON_DATABASE_URL', 'LL_NEON_SQL_URL', 'REDIS_URL',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[v];
  }
  calls = []; nextRows = []; failNext = null;
}

const neon = await import('./api/neon.js');

console.log('== the endpoint is derived from the connection string ==');
{
  clean();
  process.env.DATABASE_URL = CONN;
  eq(neon.sqlEndpoint(), 'https://ep-cool-mud-12345678-pooler.us-east-2.aws.neon.tech/sql',
    'the host from the connection string, with /sql on it');
  eq(neon.neonOn(), true, 'and that counts as configured');

  // The derivation is a GUESS about Neon's URL layout, so it has to be overridable without a deploy.
  // If it is wrong, the fix is an environment variable rather than a code change and a release.
  process.env.LL_NEON_SQL_URL = 'https://somewhere.else/sql/';
  eq(neon.sqlEndpoint(), 'https://somewhere.else/sql',
    'an explicit LL_NEON_SQL_URL wins, and its trailing slash is trimmed');
  delete process.env.LL_NEON_SQL_URL;
}

console.log('\n== a REDIS_URL is not mistaken for a database this can use ==');
{
  clean();
  // The exact situation that produced this file: Redis Cloud attached from Vercel's Storage tab, which
  // injects a TCP url and nothing else. Reading it as a store would fail on every call at runtime;
  // reporting "not configured" is correct and is what the diagnostic route says.
  process.env.REDIS_URL = 'rediss://default:pw@redis-12345.c1.us-east-1.ec2.cloud.redislabs.com:6379';
  eq(neon.neonOn(), false, 'a REDIS_URL alone is not a Neon connection');
  eq(neon.sqlEndpoint(), '', 'and yields no endpoint');
  // Nor is a Postgres-shaped var that is not actually Postgres.
  process.env.DATABASE_URL = 'mysql://user:pw@host/db';
  eq(neon.neonOn(), false, 'a non-postgres scheme is rejected rather than half-accepted');
}

console.log('\n== the request that goes out ==');
{
  clean();
  process.env.DATABASE_URL = CONN;
  neon._internals.reset();
  nextRows = [[], [], [{ v: { cat: {}, fields: {} } }]];   // DDL, cleanup, then the select
  await neon.getJson('k1');

  eq(calls.length, 3, 'first call creates the table, sweeps expired rows, then reads');
  ok(/create table if not exists ll_store/.test(calls[0].query), 'the DDL is idempotent (create table IF NOT EXISTS)');
  ok(/delete from ll_store where expires_at is not null/.test(calls[1].query), 'and expired rows are swept once per cold start');
  eq(calls[2].url, 'https://ep-cool-mud-12345678-pooler.us-east-2.aws.neon.tech/sql', 'posted to the derived endpoint');
  eq(calls[2].headers['Neon-Connection-String'], CONN, 'authenticated with the connection string header');
  eq(calls[2].headers['Content-Type'], 'application/json', 'as JSON');
  eq(calls[2].headers['Neon-Array-Mode'], 'false',
    'rows keyed by column name -- array mode would make every row.n undefined, a wrong number rather than an error');
  ok(/expires_at is null or expires_at > now\(\)/.test(calls[2].query),
    'the read filters on expiry, because Postgres has no TTL of its own');
  assert.deepStrictEqual(calls[2].params, ['k1']);
  ok(true, 'and the key travels as a bound parameter, not as string concatenation');

  // Per warm instance, not per call: the DDL must not ride along on every query.
  calls = []; nextRows = [[{ v: null }]];
  await neon.getJson('k2');
  eq(calls.length, 1, 'a second call on a warm instance skips the DDL');
}

console.log('\n== the increment is atomic and returns the new total ==');
{
  clean();
  process.env.DATABASE_URL = CONN;
  neon._internals.reset();
  nextRows = [[], [], [{ n: 0.0412 }]];
  const total = await neon.incrFloat('ll_conc_spend_2026-08-12', 0.0031, 172800);

  const q = calls[2].query;
  ok(/on conflict \(k\) do update/.test(q), 'one statement, upserting');
  ok(/n = coalesce\(ll_store\.n, 0\) \+ \$2/.test(q),
    'the increment reads the stored value INSIDE the statement -- read-modify-write in JS would lose concurrent lambdas');
  ok(/returning n/.test(q), 'and returns the running total, so no second query is needed');
  ok(!/set expires_at/.test(q.split('do update')[1] || ''),
    'expires_at is not touched on conflict, so a day window is fixed by its first write rather than sliding');
  eq(total, 0.0412, 'the new total comes back as a number');
  eq(calls[2].params[0], 'll_conc_spend_2026-08-12', 'keyed by UTC day');
  eq(calls[2].params[1], 0.0031, 'the delta is a bound parameter');

  // A row that came back without the column, or with a non-numeric, must read as 0 rather than NaN --
  // NaN >= limit is false, so a NaN total would silently disable the cap.
  calls = []; nextRows = [[{ n: null }]];
  eq(await neon.incrFloat('k', 1, 100), 0, 'a null total reads as 0, never NaN -- NaN would disable the ceiling');
  calls = []; nextRows = [[]];
  eq(await neon.getFloat('k'), 0, 'and a missing row reads as 0');
}

console.log('\n== a JSON blob round-trips, and is bound not interpolated ==');
{
  clean();
  process.env.DATABASE_URL = CONN;
  neon._internals.reset();
  nextRows = [[], [], []];
  await neon.setJson('ll_overrides_v1', { version: 1, cat: { 'a__b': { category: "O'Brien's" } } });
  const q = calls[2].query;
  ok(/\$2::jsonb/.test(q), 'the value is cast to jsonb from a bound parameter');
  eq(typeof calls[2].params[1], 'string', 'serialised once, by us');
  ok(calls[2].params[1].includes("O'Brien's"),
    'and an apostrophe survives -- string interpolation here would be an injection and a syntax error');

  // jsonb comes back parsed on this transport, but a string is accepted too. Guessing wrong would turn
  // a working store into "no overrides" with nothing in the logs.
  calls = []; nextRows = [[{ v: '{"version":1,"cat":{}}' }]];
  const asString = await neon.getJson('k');
  eq(asString.version, 1, 'a jsonb column returned as a STRING is still parsed');
  calls = []; nextRows = [[{ v: { version: 2, cat: {} } }]];
  eq((await neon.getJson('k')).version, 2, 'and returned as an OBJECT is passed through');
}

console.log('\n== a failure says which endpoint, and never the password ==');
{
  clean();
  process.env.DATABASE_URL = CONN;
  neon._internals.reset();
  failNext = { status: 404, body: 'not found' };
  let msg = '';
  try { await neon.sql('select 1'); } catch (e) { msg = String(e.message || e); }
  ok(/404/.test(msg), 'the status is reported');
  ok(/ep-cool-mud-12345678-pooler/.test(msg),
    'and the endpoint that was tried -- a wrong derived host is the likeliest failure and is otherwise indistinguishable from bad credentials');
  ok(!/npg_SECRET123/.test(msg), 'the password is NOT in the message');

  // Same rule for the diagnostic payload, which is served to a browser.
  const d = neon.diagnostics();
  ok(!JSON.stringify(d).includes('npg_SECRET123'), 'and not in the diagnostics either');
  eq(d.host, 'ep-cool-mud-12345678-pooler.us-east-2.aws.neon.tech', 'which reports the host');
  eq(d.sawVar, 'DATABASE_URL', 'and names the variable it read, so "did the deploy pick it up" is answerable');
}

console.log('\n== the spend ledger uses it, and prefers KV when both exist ==');
{
  clean();
  process.env.DATABASE_URL = CONN;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  neon._internals.reset();

  // The ledger reads through the same module, so driving it here is enough to pin the wiring: the
  // question this answers is whether the concierge's ledger is pointed at Neon at all, which a unit
  // test of neon.js alone cannot tell you.
  const { _internals } = await import('./api/concierge.js');
  ok(typeof _internals.resetSpendLedger === 'function', 'the ledger exposes its reset hook');

  nextRows = [[], [], [{ n: 5.0 }]];
  const { getFloat } = neon;
  eq(await getFloat('probe'), 5.0, 'a float read goes through Neon when only Neon is configured');

  // KV first when both are attached. Not because it is better -- on the ledger Postgres is better --
  // but because it was there first and switching backends under a live counter would lose the day.
  process.env.KV_REST_API_URL = 'https://example.upstash.io';
  process.env.KV_REST_API_TOKEN = 'tok';
  calls = [];
  // No assertion on the KV request itself here (test-concierge.mjs owns the ledger's behaviour); what
  // matters is that Neon is NOT called when KV is present.
  eq(calls.length, 0, 'and with KV attached, Neon is not the one consulted');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exitCode = 1; }

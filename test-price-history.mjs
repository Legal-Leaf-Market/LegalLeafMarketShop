/* test-price-history.mjs — "cheapest we've seen".
 *
 * A WRONG ALL-TIME LOW IS PERMANENT IN A WAY A WRONG CURRENT PRICE IS NOT.
 * A bad price on a card is corrected by the next scrape half an hour later; a
 * bad low is recorded forever and no later reading can beat it. It is also the
 * one number on this site a shopper would screenshot. So the three rules that
 * keep the claim honest are pinned harder than the arithmetic:
 *
 *   1. AN OUT-OF-STOCK PRICE IS NOT A PRICE. Shops leave sold-out rows up at
 *      their old number, and a low nobody could have bought at is a lie.
 *   2. ONE OBSERVATION IS NOT A HISTORY. "Cheapest we have ever seen: exactly
 *      what it costs right now" is true, useless, and reads as a bug.
 *   3. A SILLY PRICE IS REFUSED RATHER THAN RECORDED.
 *
 * Plus the one that only bites in production: A RETRIED CRON MUST NOT
 * MANUFACTURE HISTORY. The first draft of fold() compared the stored day AFTER
 * overwriting it, so `n` counted every call rather than every day.
 *
 *     node test-price-history.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
import handler, { fold, claimFor, observable, MIN_PRICE, MAX_PRICE } from "./api/price-history.js";
import { readFileSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
/* "20 8 * * *" -> 820, so two cron schedules can be compared for order. */
const hhmm = (c) => { const [m, h] = String(c).split(/\s+/); return Number(h) * 100 + Number(m) };

const DAY = 86400000, T0 = 1787500000000;
const p = (id, price, stock = true) => ({ id, name: id, sale: price, startsAt: price, inStock: stock });
const run = (steps) => {
  let m = null;
  for (const [when, rows] of steps) ({ map: m } = fold(m, rows, when));
  return m;
};

console.log("\nCheapest we've seen\n");

/* ------------------------------------------------------------------ */
group("THE ARITHMETIC");
let m = run([
  [T0,           [p("a", 100)]],
  [T0 + DAY,     [p("a", 80)]],
  [T0 + 2 * DAY, [p("a", 120)]],
  [T0 + 3 * DAY, [p("a", 95)]],
]);
let c = claimFor(m, "a");
ok("the low is the lowest ever seen", c.low === 80, String(c.low));
ok("the high is the highest ever seen", c.high === 120, String(c.high));
ok("last is the most recent", c.last === 95, String(c.last));
ok("one observation per day", c.observations === 4, String(c.observations));
ok("down-from-high is computed off the high, not the first reading",
   c.downFromHigh === 21, c.downFromHigh + "%");
ok("...and atLow is false when it is not at the low", c.atLow === false);
m = run([[T0, [p("b", 50)]], [T0 + DAY, [p("b", 40)]], [T0 + 2 * DAY, [p("b", 40)]]]);
ok("atLow is true when today equals the low", claimFor(m, "b").atLow === true);

/* ------------------------------------------------------------------ */
group("RULE 1 — AN OUT-OF-STOCK PRICE IS NOT A PRICE");
m = run([
  [T0,       [p("c", 100)]],
  [T0 + DAY, [p("c", 5, false)]],          /* sold out at a stale, tiny number */
]);
ok("a sold-out row does not set the low", claimFor(m, "c").low === 100, String(claimFor(m, "c").low));
ok("...and does not count as an observation", claimFor(m, "c").observations === 1,
   String(claimFor(m, "c").observations));
/* The counter-case, or a rule that refused everything would pass. */
ok("...while an in-stock row at the same price does",
   claimFor(run([[T0, [p("d", 100)]], [T0 + DAY, [p("d", 5)]]]), "d").low === 5);
/* It uses the site's OWN stock test rather than its own opinion -- the mistake
   api/concierge.js made for months, asking `inStock !== false` on its own
   while claiming it could not disagree with the grid. */
ok("a row whose only size is sold out is refused",
   !observable({ id: "x", sale: 10, inStock: true, sizes: [["1g", 10, 1, "v", false]] }));
ok("...and a row that never declared stock is NOT refused",
   !!observable({ id: "x", sale: 10 }), "unknown is live, or the shelf empties");

/* ------------------------------------------------------------------ */
group("RULE 2 — ONE OBSERVATION IS NOT A HISTORY");
m = run([[T0, [p("e", 42)]]]);
c = claimFor(m, "e");
ok("a single reading records", c.low === 42 && c.high === 42);
ok("...but says it is not enough yet", c.enough === false, "n=" + c.observations);
m = run([[T0, [p("e", 42)]], [T0 + DAY, [p("e", 41)]], [T0 + 2 * DAY, [p("e", 43)]]]);
ok("three readings are enough", claimFor(m, "e").enough === true);
ok("...and the threshold is the caller's to set", claimFor(m, "e", 10).enough === false);

/* ------------------------------------------------------------------ */
group("RULE 3 — A SILLY PRICE IS REFUSED, NOT RECORDED");
/* This is the permanent one: a feed hiccup publishing $0.01 pins a low no
   later reading can ever beat. */
m = run([[T0, [p("f", 60)]], [T0 + DAY, [p("f", 0.01)]]]);
ok("a $0.01 reading never becomes the low", claimFor(m, "f").low === 60, String(claimFor(m, "f").low));
m = run([[T0, [p("g", 60)]], [T0 + DAY, [p("g", 999999)]]]);
ok("...and an absurd high is refused too", claimFor(m, "g").high === 60, String(claimFor(m, "g").high));
ok("the bounds are wide on purpose", MIN_PRICE <= 1 && MAX_PRICE >= 5000,
   MIN_PRICE + " – " + MAX_PRICE);
/* ...and the counter-case: real prices at the edges must survive, or the guard
   is quietly deleting the cheap papers and the expensive cabinets. */
ok("a real $1.50 pack of papers is recorded", !!observable(p("h", 1.5)));
ok("a real $2,000 arcade cabinet is recorded", !!observable(p("i", 2000)));

/* ------------------------------------------------------------------ */
group("A RETRIED CRON MUST NOT MANUFACTURE HISTORY");
/* The bug the first draft actually had: fold() compared the stored day AFTER
   overwriting it, so the test could never fire and `n` counted every call. A
   record one day old would have claimed a week of history. */
let mm = null;
({ map: mm } = fold(mm, [p("j", 10)], T0));
({ map: mm } = fold(mm, [p("j", 10)], T0 + 3600000));      /* same day, one hour later */
({ map: mm } = fold(mm, [p("j", 10)], T0 + 7200000));      /* same day again */
ok("three calls in one day count as one observation", claimFor(mm, "j").observations === 1,
   String(claimFor(mm, "j").observations));
({ map: mm } = fold(mm, [p("j", 10)], T0 + DAY));
ok("...and the next day counts as two", claimFor(mm, "j").observations === 2,
   String(claimFor(mm, "j").observations));
/* A same-day retry must still move the low if the price moved. */
({ map: mm } = fold(mm, [p("j", 7)], T0 + DAY + 3600000));
ok("...while a same-day price drop is still recorded", claimFor(mm, "j").low === 7);

/* ------------------------------------------------------------------ */
group("FOLD IS PURE, WHICH IS WHY ANY OF THIS IS TESTABLE");
const before = run([[T0, [p("k", 10)]]]);
const snapshot = JSON.stringify(before);
fold(before, [p("k", 5)], T0 + DAY);
ok("folding does not mutate the map it was given", JSON.stringify(before) === snapshot);
const r1 = fold(null, [p("l", 10), p("m", 20)], T0);
const r2 = fold(null, [p("l", 10), p("m", 20)], T0);
ok("same inputs, same output", JSON.stringify(r1.map) === JSON.stringify(r2.map));
ok("the fold reports what it did", r1.stat.seen === 2 && r1.stat.added === 2,
   JSON.stringify(r1.stat));
ok("...and counts refusals separately from skips",
   fold(null, [p("n", 0.01), p("o", 5, false)], T0).stat.seen === 0);

/* ------------------------------------------------------------------ */
group("THE WRITE FAILS CLOSED");
const src = readFileSync("api/price-history.js", "utf8");
/* An open write here is worse than an open write to /api/overrides: a stranger
   could pin a false all-time low that no later reading can beat. */
ok("POST requires LL_ADMIN_TOKEN", /LL_ADMIN_TOKEN/.test(src) && /x-ll-admin-token/.test(src));
ok("...and returns 501 rather than writing when it is unset", /501/.test(src));
ok("...and 403 on a wrong token", /403/.test(src));
ok("reads need no token", /req\.method === 'POST'/.test(src));
ok("no storage means nothing is recorded and nothing pretends to be",
   /no storage backend/.test(src));

/* ------------------------------------------------------------------ */
group("THE SCHEDULED RECORDER IS A GET, AND IS DRIVEN RATHER THAN GREPPED");
/* Vercel's cron only issues GET, so the one write here has to be reachable that
   way too -- which is normally a mistake, and is only not one because of three
   guards. Every one of them fails SILENTLY if it regresses: a cron that falls
   open looks exactly like a cron that works, and so does a cacheable one, right
   up until the edge starts answering the scheduler out of cache and the record
   quietly stops growing. So this section drives the real handler.

   NO NETWORK AND NO STORAGE, deliberately: with neither backend configured
   record() refuses before it loads the catalogue, so reaching that particular
   501 is the proof a request got PAST the gate, and any other status is the
   proof it did not. Two different refusals, told apart. */
for (const k of ["CRON_SECRET", "LL_ADMIN_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
                 "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
                 "DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL",
                 "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "NEON_DATABASE_URL"]) delete process.env[k];

const res = () => { const r = { code: 0, body: null, headers: {},
  status(c) { r.code = c; return r }, json(j) { r.body = j; return r },
  setHeader(k, v) { r.headers[String(k).toLowerCase()] = v; return r } }; return r };
const call = async (req) => { const r = res(); await handler(req, r); return r };
const GATE = "no storage backend";   /* got past the gate; refused for want of a backend */

let r = await call({ method: "GET", query: { record: "1" }, headers: {} });
ok("?record=1 with no CRON_SECRET refuses", r.code === 501 && r.body?.error === "not configured", r.code + " " + r.body?.error);
ok("...and it is a refusal, not a write", r.body?.note?.includes("CRON_SECRET"));

process.env.CRON_SECRET = "s3cr3t";
r = await call({ method: "GET", query: { record: "1" }, headers: {} });
ok("?record=1 with no Authorization is forbidden", r.code === 403, String(r.code));
r = await call({ method: "GET", query: { record: "1" }, headers: { authorization: "Bearer wrong" } });
ok("...and a wrong bearer is forbidden", r.code === 403, String(r.code));
r = await call({ method: "GET", query: { record: "1" }, headers: { authorization: "s3cr3t" } });
ok("...and the bare secret without the Bearer scheme is forbidden", r.code === 403, String(r.code));
r = await call({ method: "GET", query: { record: "1" }, headers: { authorization: "Bearer s3cr3t" } });
ok("Vercel's own bearer gets through to the recorder", r.code === 501 && r.body?.error === GATE,
   r.code + " " + (r.body?.error || ""));

/* THE CACHE HEADER, on every outcome rather than only the happy one: the edge
   decides from the response it sees, and the refusals are the responses a
   probing request gets most often. */
for (const [name, req] of [["refused", { method: "GET", query: { record: "1" }, headers: {} }],
                           ["accepted", { method: "GET", query: { record: "1" }, headers: { authorization: "Bearer s3cr3t" } }]]) {
  const x = await call(req);
  ok(`the ${name} record request answers no-store`, x.headers["cache-control"] === "no-store", x.headers["cache-control"]);
}

/* THE COUNTER-CASE, and it is the one that matters most: a plain read must stay
   a plain read. If the bare path ever recorded, every crawler, link preview and
   uptime check would be writing history. */
r = await call({ method: "GET", query: {}, headers: { authorization: "Bearer s3cr3t" } });
ok("a bare GET does not record, even carrying the cron's own bearer",
   r.code === 200 && r.body?.error !== GATE, r.code + " " + (r.body?.note || ""));
ok("...and stays cacheable", /s-maxage/.test(r.headers["cache-control"] || ""), r.headers["cache-control"]);

/* CRON_SECRET MUST NOT OPEN THE POST, and LL_ADMIN_TOKEN must not open the
   cron: two gates, two secrets, no cross-wiring. */
r = await call({ method: "POST", query: {}, headers: { authorization: "Bearer s3cr3t" } });
ok("CRON_SECRET does not unlock the POST", r.code === 501 && r.body?.note?.includes("LL_ADMIN_TOKEN"), String(r.code));
process.env.LL_ADMIN_TOKEN = "admin-tok";
r = await call({ method: "GET", query: { record: "1" }, headers: { "x-ll-admin-token": "admin-tok" } });
ok("...and the admin token does not unlock the cron path", r.code === 403, String(r.code));
r = await call({ method: "POST", query: {}, headers: { "x-ll-admin-token": "admin-tok" } });
ok("the hand-run POST still reaches the recorder", r.code === 501 && r.body?.error === GATE, String(r.code));
delete process.env.CRON_SECRET; delete process.env.LL_ADMIN_TOKEN;

/* ------------------------------------------------------------------ */
group("ONE SCHEDULE, IN ONE PLACE");
/* The job moved off Actions because Actions minutes ran out and a nightly job
   whose value is destroyed by waiting must not sit behind a billing ceiling.
   Two schedules would not corrupt the record -- the fold is per day, not per
   call -- but it would leave two places to look when a night goes missing. */
/* On Netlify the schedule is `config.schedule` in a scheduled function, and the
   work is a named job in netlify/lib/cron.mjs. Both are imported and read as
   values: Netlify takes the schedule from the same export. */
const cronFn = await import("./netlify/functions/cron-price-history.mjs");
const refreshFn = await import("./netlify/functions/cron-products.mjs");
const cronLib = readFileSync("netlify/lib/cron.mjs", "utf8");
const cron = cronFn.config && cronFn.config.schedule;
ok("a scheduled function runs the recorder", /^\d+ \d+ \* \* \*$/.test(String(cron)), cron || "absent");
ok("...at the path the handler actually gates on",
   /async 'price-history'\([\s\S]*?\/api\/price-history\?record=1/.test(cronLib), "");
ok("...after the catalogue refresh it prices",
   !!cron && !!refreshFn.config && hhmm(refreshFn.config.schedule) < hhmm(cron),
   `${refreshFn.config && refreshFn.config.schedule} then ${cron}`);
const wf = readFileSync(".github/workflows/price-history.yml", "utf8");
ok("the Actions workflow no longer schedules it too",
   !/^\s*-\s*cron:/m.test(wf.replace(/^\s*#.*$/gm, "")), "");
ok("...but is kept as a manual lever", /workflow_dispatch:/.test(wf));

console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);

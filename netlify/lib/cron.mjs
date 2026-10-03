/* netlify/lib/cron.mjs — the two nightly jobs.
 *
 * WHY THIS IS THREE FUNCTIONS AND NOT TWO LINES OF CONFIG. A scheduled function
 * on Netlify is stopped after 30 seconds. A cold read of the catalogue takes
 * about that long on its own (api/products.js measures ~30s; the recorder's own
 * log line read `catalogue 5950 products in 32340ms`), so a job that waits for
 * one cannot live inside the thing that schedules it.
 *
 *   netlify/functions/cron-products.mjs        06:00 UTC   says "go"
 *   netlify/functions/cron-price-history.mjs   08:20 UTC   says "go"
 *   netlify/functions/cron-worker.mjs          a BACKGROUND function, which is
 *                                              allowed 15 minutes, does the work
 *
 * The scheduled pair do nothing but call the worker and return. The schedule
 * is `config.schedule` in each of those two files and nowhere else.
 *
 * THE WORKER IS A PUBLIC URL, so it is gated, and on the same secret as before.
 * CRON_SECRET was what the scheduler presented to /api/price-history?record=1,
 * and the handler's own check on it is untouched -- the worker presents it to
 * the handler exactly as the scheduler used to. Unset, the worker refuses: a
 * cron gate that falls open when a variable is missing is an open write that
 * looks configured (CLAUDE.md §9).
 *
 * A FAILED JOB THROWS, ON PURPOSE. Netlify retries a background function that
 * errors, one minute later and again two minutes after that. A retry is safe
 * for both jobs: a refresh is idempotent, and the recorder folds by DAY rather
 * than by call (see fold() in api/price-history.js), so recording twice cannot
 * manufacture history. A night that cannot be recovered is worth two retries.
 */
import { timingSafeEqual } from 'node:crypto';
import { load } from './routes.mjs';
import { serve } from './node-compat.mjs';

export const WORKER_PATH = '/.netlify/functions/cron-worker';

/* The site's own public address. context.site.url is the custom domain once
   one is attached; URL is the same value from the environment. */
export const siteOf = (context) =>
  String((context && context.site && context.site.url) || process.env.URL || '').replace(/\/+$/, '');

const same = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** May this request start a job? Fails closed when CRON_SECRET is unset. */
export function authorised(request, secret = process.env.CRON_SECRET || '') {
  if (!secret) return { ok: false, why: 'CRON_SECRET is not set' };
  const sent = request.headers.get('authorization') || '';
  return same(sent, 'Bearer ' + secret) ? { ok: true } : { ok: false, why: 'wrong or missing secret' };
}

/** The scheduled half: hand the job to the worker and return at once. */
export async function dispatch(job, context) {
  const secret = process.env.CRON_SECRET || '';
  const site = siteOf(context);
  if (!secret) throw new Error(`[cron] ${job}: CRON_SECRET is not set, so nothing was started`);
  /* A header loses its surrounding whitespace in transit and the variable does
     not, so a secret pasted with a trailing newline can never match itself:
     the worker would refuse, answer 202 anyway (a background function always
     does), and this log would say "started" over a job that never ran. */
  if (secret !== secret.trim()) throw new Error(`[cron] ${job}: CRON_SECRET has whitespace at one end, so the worker would refuse it. Re-enter it in Netlify without the space or newline.`);
  if (!site) throw new Error(`[cron] ${job}: this site's own URL is unknown, so nothing was started`);

  const r = await fetch(`${site}${WORKER_PATH}?job=${encodeURIComponent(job)}`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + secret },
  });
  /* 202 is the whole reply a background function ever gives: accepted, running. */
  if (r.status !== 202) throw new Error(`[cron] ${job}: the worker answered ${r.status}, not 202 -- it did not start`);
  /* "Handed over", not "ran". What the job did is in cron-worker's own log. */
  console.log(`[cron] ${job}: handed to cron-worker`);
}

const fetched = async (url, init) => {
  const t0 = Date.now();
  const r = await fetch(url, init);
  const body = await r.arrayBuffer();              // read to the end: a half-read reply is not one the edge keeps
  return { r, bytes: body.byteLength, ms: Date.now() - t0 };
};

export const JOBS = {
  /* WAS `/api/products?refresh=1` AT 06:00. A forced re-read of every shop, so
     there is a warm instance holding today's catalogue before anybody is awake.
     api/products.js says what that was for: "making sure there is always at
     least one request keeping the entry alive".

     THE SECOND REQUEST IS WHAT ACTUALLY DOES THAT. `?refresh=1` answers
     `no-store` and is a different cache key from the bare path (the price
     recorder's notes found this out: its own read came back MISS straight
     after the refresh). So the refresh is followed by one ordinary request for
     the feed, which the warm instance answers instantly and the edge keeps --
     that copy is the one a visitor is served. */
  async 'products-refresh'({ site }) {
    const a = await fetched(`${site}/api/products?refresh=1`, { headers: { accept: 'application/json' } });
    console.log(`[cron] products-refresh: ${a.r.status} in ${a.ms}ms, ${a.bytes} bytes`);
    if (!a.r.ok) throw new Error(`products refresh answered ${a.r.status}`);

    const b = await fetched(`${site}/api/products`, { headers: { accept: 'application/json' } });
    console.log(`[cron] products-refresh: edge copy ${b.r.status} in ${b.ms}ms, x-ll-cache=${b.r.headers.get('x-ll-cache') || '-'}, cache-status=${b.r.headers.get('cache-status') || '-'}`);
    if (!b.r.ok) throw new Error(`priming the feed answered ${b.r.status}`);
    return true;
  },

  /* WAS `/api/price-history?record=1` AT 08:20, with `maxDuration: 300`.
     Run in this process rather than fetched, so the recorder has the worker's
     fifteen minutes instead of a request's sixty seconds. The request it is
     given is the one the scheduler used to send -- same path, same query, same
     bearer -- so all three of the handler's guards are exercised, not bypassed. */
  async 'price-history'({ site, secret }) {
    const handler = await load('price-history');
    if (!handler) throw new Error('api/price-history.js has no handler');
    const res = await serve(handler, new Request(`${site}/api/price-history?record=1`, {
      headers: { authorization: 'Bearer ' + secret, accept: 'application/json' },
    }));
    const text = await res.text();
    if (res.ok) { console.log(`[cron] price-history: ${res.status} ${text.slice(0, 400)}`); return true; }
    /* 501 is "no storage attached" or "not configured": retrying in a minute
       will not attach one, so it is not thrown. It is still a night that was
       not recorded, and the log has to say that in words nobody can read as
       success. Anything else that is not a 2xx is worth the retry. */
    console.error(`[cron] price-history: NOT RECORDED -- ${res.status} ${text.slice(0, 400)}`);
    if (res.status !== 501) throw new Error(`price recorder answered ${res.status}`);
    return false;
  },
};

/** The worker half: check the caller, run the named job, log what it cost. */
export async function work(request, context) {
  const gate = authorised(request);
  if (!gate.ok) { console.error(`[cron] refused: ${gate.why}`); return; }

  const job = new URL(request.url).searchParams.get('job') || '';
  if (!Object.prototype.hasOwnProperty.call(JOBS, job)) { console.error(`[cron] refused: no such job "${job}"`); return; }

  const site = siteOf(context);
  if (!site) throw new Error(`[cron] ${job}: this site's own URL is unknown`);

  const t0 = Date.now();
  const did = await JOBS[job]({ site, secret: process.env.CRON_SECRET, context });
  if (did) console.log(`[cron] ${job}: done in ${Date.now() - t0}ms`);
  else console.error(`[cron] ${job}: finished in ${Date.now() - t0}ms WITHOUT doing its work -- see the line above`);
}

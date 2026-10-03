/* ============================================================================
   /api/track  ·  first-party event collector
   ----------------------------------------------------------------------------
   Paired with public/js/analytics.js. That file is identical across all four
   storefronts and so is this one, apart from the SITE constant and the legacy
   env var name kept for backwards compatibility. Fix a bug here and port it.

   WHY A FIRST-PARTY COLLECTOR EXISTS

   Roughly a quarter of a cannabis, hemp or nicotine audience runs a content
   blocker, and every mainstream blocklist kills googletagmanager.com outright.
   Those visitors are not a random quarter either: they skew toward the
   repeat, high-intent shopper, which is exactly the cohort whose behaviour the
   catalogue is being tuned for. Analytics that silently omit them will steer
   you wrong.

   A POST to this endpoint is same-origin, so it survives. When the browser
   tells us gtag.js never loaded (ga_ok === false), this function replays those
   events into the same GA4 property server-side over the Measurement Protocol.
   The blocked quarter lands in the same reports as everyone else.

   The ga_ok gate is load-bearing. Replaying unconditionally would double-count
   every event from every visitor who is not blocking anything.

   ENVIRONMENT (all optional, the endpoint degrades quietly without them)

     GA_MEASUREMENT_ID   G-XXXXXXXXXX. Same id as the tag in the page.
     GA_API_SECRET       GA4 Admin > Data Streams > your stream >
                         Measurement Protocol API secrets > Create.
                         Both are needed for the ad-block recovery path.
     LL_EVENTS_WEBHOOK   Legacy. An Apps Script /exec that appends to a Sheet.
     ANALYTICS_WEBHOOK   Same thing under the shared name the other three use.

   With none of them set this still returns 204 and still writes one structured
   line per batch to stdout, which lands in Netlify's function logs and in any
   log drain. That is the zero-configuration floor: it is not a dashboard, but
   it means no event is ever unrecoverable.
   ========================================================================= */

const SITE = 'legal-leaf';

/* Cheap, deliberately not clever. The goal is to keep obvious crawlers out of
   the engagement numbers, not to win an arms race with a headless browser. */
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pagespeed|monitor|curl|wget|python-requests|axios|node-fetch|preview|scan/i;

/* Events worth replaying to GA4 when the client-side tag was blocked. The
   noisy ones are deliberately excluded: web_vital and scroll_depth from a
   blocked minority skew the distributions without informing any decision, and
   Measurement Protocol calls are a per-event round trip from the function. */
const REPLAY = new Set([
  'page_view', 'session_start', 'affiliate_click', 'begin_checkout',
  'add_to_cart', 'remove_from_cart', 'view_cart', 'product_view',
  'search', 'newsletter_signup', 'outbound_click', 'pwa_install'
]);

const GA_NAME = {
  product_view: 'view_item',
  add_to_cart: 'add_to_cart',
  remove_from_cart: 'remove_from_cart',
  view_cart: 'view_cart',
  begin_checkout: 'begin_checkout',
  newsletter_signup: 'sign_up',
  search: 'search',
  outbound_click: 'click'
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Allow', 'POST'); return res.status(204).end(); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }

  /* Answer first, work second. Nothing downstream of this point is allowed to
     make a shopper wait, and a collector that adds latency to a page is a
     collector someone will eventually rip out. */
  const payload = await readBody(req);

  const ua = String(req.headers['user-agent'] || '');
  if (BOT.test(ua)) return res.status(204).end();

  const batch = normalise(payload);
  if (!batch.events.length) return res.status(204).end();

  /* Set by the host, never by the visitor: netlify/lib/node-compat.mjs writes
     these three from Netlify's own lookup and deletes any that arrived with
     the request. The local preview sets none, and the fields are then empty. */
  const geo = {
    country: header(req, 'x-geo-country'),
    region: header(req, 'x-geo-region'),
    city: safeDecode(header(req, 'x-geo-city'))
  };

  const enriched = {
    site: batch.site || SITE,
    visitor: batch.vid,
    session: batch.sid,
    ga_ok: batch.ga_ok,
    tz: batch.tz,
    ...geo,
    ua: ua.slice(0, 200),
    referer: String(req.headers.referer || '').slice(0, 300),
    at: new Date().toISOString(),
    events: batch.events
  };

  /* One line, one batch, JSON. Greppable in the Vercel log view and parseable
     by a drain without anyone having to write a parser for a bespoke format. */
  try { console.log('analytics ' + JSON.stringify(enriched)); } catch { /* never fatal */ }

  const jobs = [];

  /* The recovery path. Only for visitors whose gtag.js was blocked; ga_ok is
     explicitly false there, and null when the site has no GA4 id at all, so
     the strict comparison matters. */
  if (batch.ga_ok === false && process.env.GA_MEASUREMENT_ID && process.env.GA_API_SECRET) {
    jobs.push(sendToGa4(batch, enriched));
  }

  const hook = process.env.ANALYTICS_WEBHOOK || process.env.LL_EVENTS_WEBHOOK;
  if (hook) jobs.push(post(hook, enriched));

  /* Bounded. A hung webhook must not hold a serverless invocation open, and on
     a fire-and-forget sink a timeout is not an error worth reporting. */
  if (jobs.length) {
    try { await Promise.race([Promise.allSettled(jobs), sleep(2500)]); } catch { /* swallow */ }
  }

  return res.status(204).end();
}

/* --------------------------------------------------------------------------
   GA4 Measurement Protocol

   Two details that are easy to get wrong and produce a property full of
   "(not set)" with zero engaged sessions:

     - session_id must be sent as an event param on EVERY event, otherwise GA4
       cannot stitch them and each one becomes its own session.
     - engagement_time_msec must be present or the session is not counted as
       engaged, which silently zeroes the engagement rate for exactly the
       cohort this path exists to recover.
   -------------------------------------------------------------------------- */
async function sendToGa4(batch, enriched) {
  const url = 'https://www.google-analytics.com/mp/collect'
    + '?measurement_id=' + encodeURIComponent(process.env.GA_MEASUREMENT_ID)
    + '&api_secret=' + encodeURIComponent(process.env.GA_API_SECRET);

  const events = batch.events
    .filter((e) => REPLAY.has(e.name))
    .slice(0, 25)                       /* MP hard-caps a request at 25 events */
    .map((e) => {
      const p = { ...(e.props || {}) };
      delete p.visitor_id;              /* carried as client_id instead */
      if (e.name === 'search' && p.query) { p.search_term = p.query; delete p.query; }
      return {
        name: GA_NAME[e.name] || e.name,
        params: {
          ...trim(p),
          session_id: batch.sid,
          engagement_time_msec: 1,
          /* Geo is the one thing this path cannot recover: the Measurement
             Protocol attributes location to the caller, which here is the
             function's region, not the shopper. Sent as a plain param so the data is at
             least present in Explorations, rather than letting GA4 report
             every blocked visitor as being wherever the function ran. */
          edge_country: enriched.country || undefined,
          edge_region: enriched.region || undefined,
          blocked_client: true
        }
      };
    });

  if (!events.length) return;

  await post(url, {
    /* Prefer gtag's own id when the cookie survived, so a visitor who blocks
       the script on some visits and not others stays one user. */
    client_id: batch.ga_cid || batch.vid || String(Date.now()),
    timestamp_micros: Date.now() * 1000,
    non_personalized_ads: true,
    events
  });
}

/* --------------------------------------------------------------------------
   helpers
   -------------------------------------------------------------------------- */

function normalise(body) {
  if (!body || typeof body !== 'object') return { events: [] };

  /* Current shape from analytics.js. */
  if (Array.isArray(body.events)) {
    return {
      site: body.site, vid: body.vid, sid: body.sid,
      ga_ok: body.ga_ok, ga_cid: body.ga_cid, tz: body.tz,
      events: body.events.filter((e) => e && e.name).slice(0, 50)
    };
  }

  /* Legacy single-event shape. The old inline trackers on these sites posted
     {event, store, product, value} and a stale cached page can still be doing
     it hours after a deploy, so accepting it costs one branch and avoids a gap
     in the data every time something ships. */
  const name = body.name || body.event;
  if (!name) return { events: [] };
  return {
    site: body.site, vid: body.vid, sid: body.sid, ga_ok: body.ga_ok,
    events: [{ name: String(name), ts: Date.now(), props: body.props || body }]
  };
}

/* GA4 rejects a param over 100 chars and ignores objects. Truncating here
   rather than letting the API drop the whole event keeps a long product name
   from costing us the conversion it was attached to. */
function trim(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out[String(k).slice(0, 40)] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v).slice(0, 100);
  }
  return out;
}

function header(req, k) { return String(req.headers[k] || '').slice(0, 80); }
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function post(url, body) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch { /* analytics must never surface an error to the page */ }
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'string') { try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); } }
      return resolve(req.body);
    }
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 200000) d = d.slice(0, 200000); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

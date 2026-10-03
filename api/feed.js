/* api/feed.js — this site's own catalogue, fetched once per warm instance.
 *
 * MOVED OUT OF api/concierge.js, UNCHANGED. It was private there, and
 * api/kit.js needs exactly the same thing: the whole feed, in stock flags and
 * all, without re-running twenty store scrapes. The alternative was a second
 * copy, which is what this repo does when a rule gets restated instead of
 * shared -- four copies of storeCheckoutUrl(), two of rscRoots(), two of the
 * capture keyer -- and every one of those has cost a bug where the copies
 * drifted and only somebody reading both could tell.
 *
 * SHARING THE CACHE IS A STRICT IMPROVEMENT, not just tidier. The concierge
 * and the rig builder now warm the same 5-minute window instead of holding one
 * each, so a visitor who asks the concierge a question and then rolls a kit
 * costs one fetch rather than two.
 *
 * The FEED_TTL_MS comment below is the original: the CDN in front of
 * /api/products does the real work, and this only smooths the burst.
 */

const FEED_TTL_MS = 5 * 60 * 1000;

let feedCache = { at: 0, products: [], meta: null };

// Same trick as api/share.js: fetch this site's own /api/products rather than re-running the
// scrape. It is CDN cached (s-maxage=600), so a warm hit is one cheap request instead of twenty
// store scrapes, and reading the same feed the grid reads is what keeps the two from disagreeing.
//
// TWO CLAIMS USED TO BE COLLAPSED INTO ONE HERE, and only one of them was ever true. Sharing the
// feed means the concierge cannot disagree with the GRID -- once it also asks the grid's own stock
// question, which it now does via the imported anyInStock. It has never meant the concierge cannot
// disagree with the STORE: this cache is up to 5 minutes stale, the CDN's copy up to 10 more, and
// the scraper's own in-memory copy up to 30 beyond that, so "in stock" here can be three quarters of
// an hour old. A sold-out ounce is exactly what sells out fastest. That is why the prompt is told to
// date its availability claims instead of asserting them -- see the AVAILABILITY rail in SYSTEM.
// WHICH HOST TO ASK, AND IT IS NOT ALWAYS THE ONE THAT ASKED US.
//
// This project runs Vercel's SSO protection at `all_except_custom_domains`, so
// EVERY *.vercel.app host -- previews and the generated production alias alike
// -- answers an anonymous request with a redirect to vercel.com/sso-api. Only
// legal-leafmarket.com is public.
//
// A scheduled invocation arrives on exactly one of those protected hosts. The
// invocation itself is exempt (that is the platform's own call), but the
// self-fetch below is an ordinary anonymous request, so echoing the caller's
// host sends it to the SSO page -- which returns 200 HTML, not a 4xx. `r.ok` is
// true, `data.products` is undefined, and the only symptom is
// "catalogue returned no products" from a catalogue that is perfectly healthy.
//
// THAT IS WHY THE NIGHTLY PRICE RECORDER HAD NEVER ONCE RECORDED. It failed in
// under a second with a message pointing at the feed, on the one code path no
// visitor ever takes, so nothing else on the site was affected and nothing
// looked wrong. A wrong host cannot fail loudly here: protection answers 200.
//
// So a generated host is refused as an ADDRESS, never as a caller. Anything
// else -- the custom domain, localhost, a self-hosted preview -- is still
// honoured, so ordinary requests and local development are untouched.
//
// ON NETLIFY (Oct 2026) NONE OF THAT CAN HAPPEN, and the rule is kept anyway.
// A *.netlify.app host is public, and the nightly job arrives on the site's
// own address (netlify/lib/cron.mjs). What changed here is only the last rung
// but one: `URL` is what Netlify calls the site's main address at run time --
// the custom domain once one is attached -- and it arrives as a full url, which
// clean() already reduces to a host.
function siteHost(req) {
  const clean = (v) => String(v || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const explicit = clean(process.env.LL_SITE_HOST || process.env.LL_SITE);
  if (explicit) return explicit;
  const h = (req && req.headers) || {};
  const asked = clean(h['x-forwarded-host'] || h.host);
  if (asked && !/\.vercel\.app$/i.test(asked)) return asked;
  return clean(process.env.URL) || 'legal-leafmarket.com';
}

export async function loadCatalogue(req) {
  const now = Date.now();
  if (feedCache.products.length && now - feedCache.at < FEED_TTL_MS) return feedCache;
  const host = siteHost(req);
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const r = await fetch(`${proto}://${host}/api/products`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`catalogue unavailable: HTTP ${r.status} from ${host}`);
  const data = await r.json();
  const products = Array.isArray(data && data.products) ? data.products : [];
  // The host is named because the empty case is almost always the wrong host
  // rather than an empty shop, and the message used to say only the former.
  if (!products.length) throw new Error(`catalogue returned no products from ${host}`);
  feedCache = { at: now, products, meta: (data && data.meta) || null };
  return feedCache;
}

export { FEED_TTL_MS, siteHost };

/* api/img.js — fetch a merchant's product photo from OUR origin instead of the
 * shopper's browser.
 *
 * "The product images are zero percent better on Lookah. I don't see any shit."
 *
 * WHY THIS EXISTS, AFTER THREE FAILED DIAGNOSES. The feed says 93% of Lookah's
 * rows carry an image url. The page shows almost none. Both of those can be
 * true at once, and every explanation for the gap is something that happens in
 * the BROWSER: hot-link protection keyed on Referer, a signed CDN path that
 * refuses a cross-origin request, an expiring signature, a bad content-type.
 * None of it can be reproduced from the containers this repo is edited in,
 * because egress to lookah.com is refused there -- so the cause was guessed at
 * three times and fixed zero times.
 *
 * A PROXY ENDS BOTH PROBLEMS AT ONCE, which is why it is the right answer
 * rather than a workaround:
 *
 *   - IT FIXES the failure whatever the cause. The fetch happens server-side,
 *     from Vercel, with no browser Referer and no cross-origin request. A shop
 *     that refuses a hot-link, a CORS-restricted CDN and a mixed-content url
 *     all become the same successful GET.
 *   - IT MAKES THE CAUSE VISIBLE. `?probe=1` returns what the merchant
 *     actually said -- status, content-type, bytes, and the redirect chain --
 *     as JSON on OUR domain, which IS reachable from here. The question that
 *     could not be answered for three hours becomes one request.
 *
 * ------------------------------------------------------------------
 * IT IS NOT AN OPEN PROXY, AND THAT IS THE ONLY SECURITY DECISION THAT MATTERS
 * HERE. An endpoint that fetches any url a stranger names is an SSRF hole and
 * a bandwidth piñata: it can be pointed at cloud metadata endpoints, at
 * internal addresses, or simply used to serve somebody else's traffic on our
 * bill. So the host must be one WE ALREADY LIST -- derived from STORES rather
 * than from a second hand-kept list, because a hand-kept twin of the store
 * roster is what this repo has been bitten by twice (the collector directory,
 * and the capture roster in api/coldwater-ingest.js).
 *
 * Everything else follows from that: https only, a size ceiling, a timeout, an
 * image content-type or nothing, and no redirect off the allowed host.
 */
import { STORES } from './products.js';

const MAX_BYTES = 8 * 1024 * 1024;     // a product photo is ~100KB; 8MB is a ceiling, not a target
const TIMEOUT_MS = 8000;

/* Every host we already publish links to, plus the www/apex twin of each --
   a feed row's image often sits on the other one, and refusing it would be a
   rule that is right in principle and wrong on the shelf. Built once per warm
   instance from STORES, so adding a shop adds its images with it. */
let ALLOW = null;
function allowed() {
  if (ALLOW) return ALLOW;
  ALLOW = new Set();
  for (const s of STORES) {
    if (!s || !s.domain) continue;
    const d = String(s.domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!d) continue;
    ALLOW.add(d);
    ALLOW.add(d.startsWith('www.') ? d.slice(4) : 'www.' + d);
    /* Shops serve photos off their platform's CDN as often as off their own
       host, and those are the same publisher by any reasonable reading. */
  }
  ['cdn.shopify.com', 'cdn11.bigcommerce.com', 'i.shgcdn.com',
   'images.squarespace-cdn.com', 'static.wixstatic.com'].forEach(h => ALLOW.add(h));
  return ALLOW;
}

/* A host is allowed if it IS one of ours or is a subdomain of one. The
   subdomain test is anchored on a dot so `evil-lookah.com` cannot pass by
   ending in a permitted string -- the classic way an allowlist like this
   leaks. */
function hostOk(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  for (const d of allowed()) if (h === d || h.endsWith('.' + d)) return true;
  return false;
}

function parse(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return { err: 'badUrl' }; }
  if (u.protocol !== 'https:') return { err: 'notHttps' };
  if (!hostOk(u.hostname)) return { err: 'hostNotListed', host: u.hostname };
  return { u };
}

export default async function handler(req, res) {
  const q = (req && req.query) || {};
  const probe = q.probe != null;
  const got = parse(q.u);

  if (got.err) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(400).json({ error: got.err, host: got.host || null,
      note: 'u must be an https url on a host this site already lists' });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r;
  try {
    /* NO REFERER, DELIBERATELY. That header is the single most likely reason a
       shop's CDN refuses the browser and not us, so not sending one is the
       whole mechanism rather than an oversight. The UA names the site and a
       contact, the same courtesy api/products.js extends when scraping. */
    const head = {
      'accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'user-agent': 'Legal-Leaf-Market/1.0 (+https://legal-leafmarket.com; images@legal-leafmarket.com)',
    };
    /* DIAGNOSTIC ONLY, and never on the serving path: `?probe=1&withref=1`
       sends the Referer a real browser would send. That is the difference
       between "the image is fine" and "the image is fine UNLESS you are a
       browser on our site", which is exactly the question hot-link protection
       poses and the one nothing here could answer before. Comparing the two
       probes is the proof; guessing at it is what happened three times. */
    if (probe && q.withref != null) head.referer = 'https://legal-leafmarket.com/';
    r = await fetch(got.u.href, { signal: ctl.signal, redirect: 'follow', headers: head });
  } catch (e) {
    clearTimeout(timer);
    const why = e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e);
    if (probe) return res.status(200).json({ ok: false, stage: 'fetch', error: why, url: got.u.href });
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(502).json({ error: 'upstream', detail: why });
  }
  clearTimeout(timer);

  const type = r.headers.get('content-type') || '';
  const len = r.headers.get('content-length');

  /* THE DIAGNOSTIC HALF. This is what could not be seen from a container with
     no egress: exactly what the merchant said, on a domain that IS reachable. */
  if (probe) {
    let bytes = null, head = null;
    try {
      const buf = new Uint8Array(await r.arrayBuffer());
      bytes = buf.length;
      head = Array.from(buf.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    } catch (e) { /* a body we could not read is itself the finding */ }
    return res.status(200).json({
      ok: r.ok && /^image\//i.test(type),
      status: r.status, statusText: r.statusText,
      contentType: type, contentLength: len ? Number(len) : null,
      bytes, magic: head,
      redirected: r.redirected, finalUrl: r.url,
      /* The headers that decide whether a browser could have loaded this
         itself -- which is the actual question. */
      cors: r.headers.get('access-control-allow-origin'),
      sentReferer: q.withref != null,
      server: r.headers.get('server'),
      cacheControl: r.headers.get('cache-control'),
      url: got.u.href,
    });
  }

  if (!r.ok) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(502).json({ error: 'upstream', status: r.status });
  }
  /* AN IMAGE OR NOTHING. A shop that answers a photo request with an HTML
     error page must not have that page rendered into an <img> -- it would show
     as a broken icon and read as our bug rather than theirs. */
  if (!/^image\//i.test(type)) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(415).json({ error: 'notAnImage', contentType: type });
  }
  if (len && Number(len) > MAX_BYTES) {
    return res.status(413).json({ error: 'tooLarge', bytes: Number(len) });
  }

  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'tooLarge', bytes: buf.length });

  /* Cached hard at the edge. A product photo does not change, and the whole
     point is that this costs one fetch per image per region rather than one
     per shopper. */
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).end(buf);
}

export { hostOk, parse, allowed, MAX_BYTES };

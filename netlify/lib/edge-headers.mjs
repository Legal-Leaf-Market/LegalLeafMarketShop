/* netlify/lib/edge-headers.mjs — what Netlify is told about a function's answer.
 *
 * Kept out of netlify/functions/ because a file there exports a handler and its
 * `config` and nothing else, and kept out of node-compat.mjs because none of
 * this is about translating Node to the web. It is hosting policy.
 */

/* THE PLATFORM'S LAST WORD ON THE HEADERS OF A FUNCTION'S ANSWER.
 *
 * netlify.toml's [[headers]] apply to FILES only. Whatever a function's answer
 * needs has to be put on it here, or it is not there at all.
 *
 * THE CACHE POLICY IS STILL WRITTEN IN THE HANDLERS, as `Cache-Control: public,
 * s-maxage=N, stale-while-revalidate=M` (see THE SHARED CACHE in
 * api/products.js). What changes at this line is only who is told what:
 *
 *   Netlify-CDN-Cache-Control   the handler's policy, whole. This is what the
 *                               edge obeys. A 200 also gets `durable`, which
 *                               shares one stored copy between every edge node,
 *                               so a visitor arriving at a node that has never
 *                               seen the catalogue is not the one who waits
 *                               thirty seconds for the scrape. Anything else
 *                               keeps the handler's own lifetime but stays
 *                               per-node: api/share.js sets its policy before
 *                               it knows the outcome, and a "that product is
 *                               gone" caused by one bad read of the feed should
 *                               not become the answer everywhere at once.
 *
 *   Cache-Control               the same line with the two shared-cache
 *                               directives removed, which is what browsers were
 *                               always shown. A browser honours
 *                               stale-while-revalidate too, so handing it the
 *                               full line would let every shopper's own cache
 *                               serve day-old prices -- a second stale window
 *                               nobody chose, stacked on the edge's.
 *
 * A response with no `s-maxage` (`no-store`, or nothing) is passed through
 * untouched and is not cached at the edge, which is Netlify's default for a
 * function and the right one for a write.
 */
const SHARED_ONLY = /^(s-maxage|stale-while-revalidate)\s*=/i;

export function decorate(headers, { status = 200 } = {}) {
  if (!headers.has('x-content-type-options')) headers.set('X-Content-Type-Options', 'nosniff');

  const policy = headers.get('cache-control');
  if (policy && /(^|[\s,])s-maxage\s*=/i.test(policy)) {
    const parts = policy.split(',').map((s) => s.trim()).filter(Boolean);
    headers.set('Netlify-CDN-Cache-Control', (status === 200 ? [...parts, 'durable'] : parts).join(', '));
    headers.set('Cache-Control', parts.filter((d) => !SHARED_ONLY.test(d)).join(', ') || 'public');
  }
}

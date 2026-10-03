/* netlify/functions/api.mjs — every dynamic URL on the site, in production.
 *
 * One function, because there is one job: find the api/ module a URL belongs to
 * (netlify/lib/routes.mjs), and run it (netlify/lib/node-compat.mjs). The
 * handlers themselves are in api/ and do not know this file exists.
 *
 * THE STATIC HALF OF THE SITE NEVER COMES HERE. Netlify serves public/ on its
 * own, including /foo for public/foo.html, and netlify.toml carries the
 * redirects and the headers for those files. This function is handed only the
 * paths in `config` at the bottom.
 */
import { resolve, load } from '../lib/routes.mjs';
import { serve } from '../lib/node-compat.mjs';
import { decorate } from '../lib/edge-headers.mjs';
import { prepare } from '../lib/runtime.mjs';

const notFound = () => new Response(JSON.stringify({ error: 'Not found' }), {
  status: 404,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

export default async function api(request, context = {}) {
  prepare();
  const route = resolve(new URL(request.url).pathname);
  if (!route) return notFound();

  let handler;
  try {
    handler = await load(route.module);
  } catch (err) {
    console.error(`[api] could not load api/${route.module}.js:`, err && err.stack ? err.stack : err);
    return new Response(JSON.stringify({ error: 'server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (!handler) return notFound();

  return serve(handler, request, {
    client: { ip: context.ip, geo: context.geo },
    query: route.query,
    waitUntil: typeof context.waitUntil === 'function' ? context.waitUntil.bind(context) : undefined,
    decorate,
  });
}

/* A LITERAL, AND IT HAS TO STAY ONE. Netlify reads this object out of the
 * source at build time without running the file, so it cannot be computed from
 * routes.mjs however much it looks as though it should be.
 *
 * /api/* and /p/* are whole prefixes; the admin paths are named one by one so
 * that an unknown /admin/<anything> is a plain 404 rather than a function call.
 * /p/theloudpack is a real page (public/theloudpack.html) living under the
 * share prefix: it is excluded here and rewritten to its file in netlify.toml.
 */
export const config = {
  path: [
    '/api/*',
    '/p/*',
    '/admin',
    '/admin/sign-in',
    '/admin/operating-model',
    '/admin/gear-avail',
  ],
  excludedPath: ['/p/theloudpack'],
};

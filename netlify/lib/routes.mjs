/* netlify/lib/routes.mjs — which api/ module answers which URL, in production.
 *
 * THE FILESYSTEM IS THE ROUTE TABLE, and that is deliberate.
 *
 * server.mjs carries a hand-written map of every handler, and that map has
 * drifted four times: a handler is added, one side serves it, the other 404s,
 * and the only person who can see it is whoever is looking at the broken side
 * (test-server-routes.mjs tells the whole story). Writing a second such map
 * here would move that failure from the local preview into PRODUCTION, which is
 * the one place it was never able to happen before.
 *
 * So /api/<name> is answered by api/<name>.js if that file exists and its
 * default export is a function, and by nothing otherwise. Adding an endpoint is
 * adding a file, exactly as it always was. A library (api/kv.js, api/brand.js)
 * has no default handler and answers 404; a `_helper` is never looked at.
 *
 * WHAT IS LISTED BELOW IS ONLY WHAT THE FILESYSTEM CANNOT SAY: the handful of
 * URLs whose path is not the module's own name. These are the old rewrites,
 * one for one, and test-netlify.mjs holds them against server.mjs.
 *
 * THE OTHER HALF OF EVERY ENTRY IS `config.path` in netlify/functions/api.mjs.
 * Netlify only hands this function the paths named there, so a new alias
 * outside /api/ and /p/ has to be added in both places. The same suite checks
 * that it was.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALIASES = {
  /* THE CANONICAL NAMES ARE MARKET-NEUTRAL, and the old ones are kept forever:
     an installed bookmarklet posts to /api/coldwater/ingest until it is
     reinstalled, and a capture that 404s is a capture silently lost. */
  '/api/market': 'coldwater',
  '/api/market/ingest': 'coldwater-ingest',
  '/api/coldwater/ingest': 'coldwater-ingest',
  /* Clean admin paths, served by functions rather than files. */
  '/admin': 'admin/home',
  '/admin/sign-in': 'admin/sign-in',
  '/admin/operating-model': 'admin/model',
  '/admin/gear-avail': 'admin/gear',
};

/* One or two lower-case segments, none starting with `_` or `.`, none longer
   than any file here will ever be. That is the whole shape of api/, and it is
   also what keeps a request from naming a file outside it: there is no way to
   spell `..` in this alphabet. */
const MODULE = /^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63})?$/;

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** pathname -> { module, query } or null. Pure: no filesystem, no imports. */
export function resolve(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;

  if (Object.prototype.hasOwnProperty.call(ALIASES, path)) return { module: ALIASES[path], query: {} };

  /* /p/<id> is the share page. The id is the path remainder, as it was when
     this was the rewrite `/p/(.*)` -> `/api/share?id=$1`. /p/theloudpack is a
     static page living under the same prefix; it is excluded in api.mjs so it
     never arrives here. */
  if (pathname.startsWith('/p/')) return { module: 'share', query: { id: safeDecode(pathname.slice(3).replace(/\/+$/, '')) } };

  if (path.startsWith('/api/')) {
    const name = path.slice(5);
    if (MODULE.test(name)) return { module: name, query: {} };
  }
  return null;
}

const cache = new Map();

/** module name -> its handler, or null when there is no such endpoint. */
export async function load(module) {
  if (!MODULE.test(module)) return null;
  if (cache.has(module)) return cache.get(module);

  /* TWO PLACES TO LOOK, because this file is not always where it appears to be.
     Netlify inlines it into netlify/functions/api.mjs when it builds the
     bundle, so `import.meta.url` is that file in production and this one
     everywhere else. Both happen to sit two levels below the root, which is the
     kind of coincidence that holds until somebody moves a directory; the
     working directory is the root in both, so it is the second opinion. */
  const file = [
    fileURLToPath(new URL(`../../api/${module}.js`, import.meta.url)),
    join(process.cwd(), 'api', `${module}.js`),
  ].find((f) => existsSync(f));

  let handler = null;
  if (file) {
    /* Not caught. A handler that exists and cannot be imported is a broken
       deploy, and it must read as a 500 with a stack in the log -- not as a
       404 that sends somebody looking for a routing mistake that is not there. */
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.default === 'function') handler = mod.default;
  }
  /* Only what exists is remembered. A miss costs one existsSync; remembering
     every name anybody ever guessed would be a list a stranger gets to grow. */
  if (handler) cache.set(module, handler);
  return handler;
}

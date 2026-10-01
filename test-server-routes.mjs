/* EVERY SERVERLESS HANDLER MUST BE REACHABLE IN LOCAL PREVIEW TOO.

   Vercel runs every file in api/ as a function whether or not anything declares
   it. server.mjs cannot -- it carries a hand-written API map (CLAUDE.md §4), so
   that map is a TWIN OF THE FILESYSTEM, and it drifts in exactly one direction:
   a handler gets added, production serves it on the first deploy, and the local
   preview 404s it forever.

   THIS HAS NOW HAPPENED FOUR TIMES. /api/overrides carries a comment in the map
   recording its own turn ("was missing: prod served it, local preview 404'd").
   Then /api/img, /api/kit and /api/price-history were all absent at once --
   which meant the Lookah photo proxy, the rig builder behind /kit, and the
   price-history card display could not work in any local preview, while all
   three were fine in production. The last of those is how it was found: a
   browser suite that boots the real server.mjs reported a 404 in the console,
   and the assertion that caught it was about console noise rather than about
   routing.

   A HANDLER IS IDENTIFIED BY WHAT IT IS, not by a second list: `export default
   function handler(req, res)` is what Vercel invokes, so that is what has to be
   routed. Everything else in api/ is a library -- api/kv.js, api/brand.js,
   api/markets.js and the rest -- and libraries must NOT be routed, since a
   module with no handler would answer a request with a crash.

     node test-server-routes.mjs
*/
import { readFileSync, readdirSync, statSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

const srv = readFileSync("server.mjs", "utf8");

/* The map only, not the whole file. server.mjs mentions plenty of api/ paths in
   its prose, and this repo's oldest trap is a whole-file regex going green (or
   red) against a comment rather than against code. */
const mapStart = srv.indexOf("const API = {");
ok("the API map was located in server.mjs", mapStart > 0);
const API = srv.slice(mapStart, srv.indexOf("\n}", mapStart));
const routed = new Set([...API.matchAll(/"(\.\/api\/[a-z0-9/-]+\.js)"/g)].map(m => m[1].slice(2)));
ok("it routes handlers", routed.size >= 10, routed.size + " distinct modules");

const walk = d => readdirSync(d).flatMap(f => {
  const p = d + "/" + f;
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk("api").filter(f => f.endsWith(".js"));
ok("api/ has modules to check", files.length > 20, files.length + " files");

const isHandler = f => /export\s+default\s+(async\s+)?function\s+handler\s*\(/.test(readFileSync(f, "utf8"));
const handlers = files.filter(isHandler);
const libs = files.filter(f => !isHandler(f));
ok("handlers are identifiable by their default export", handlers.length >= 10,
   handlers.length + " handlers, " + libs.length + " libraries");

/* THE ONE THAT MATTERS. A handler production serves and preview does not is a
   page that works live and is broken for whoever is developing it -- the worst
   direction for a routing bug, because the person who could fix it is the only
   one who sees it. */
const missing = handlers.filter(f => !routed.has(f));
ok("every handler is routed in local preview", missing.length === 0,
   missing.join(", ") || handlers.length + " routed");

/* And the other direction: a route pointing at a module with no handler would
   answer a real request by crashing, which is worse than a 404 because it looks
   like the endpoint exists. */
const bogus = [...routed].filter(f => !handlers.includes(f));
ok("no route points at a module with no handler", bogus.length === 0,
   bogus.join(", ") || "none");

/* A route pointing at a file that is not there at all. */
const ghosts = [...routed].filter(f => !files.includes(f));
ok("every routed module exists on disk", ghosts.length === 0, ghosts.join(", ") || "all present");

console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All server route checks passed."}`);
process.exit(fails.length ? 1 : 0);

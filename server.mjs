// server.mjs — local/preview dev server ONLY.
//
// Vercel does NOT use this in production: it serves `public/` statically and
// `api/*.js` as serverless functions on its own. This tiny zero-dependency
// server reproduces that behavior (plus the vercel.json rewrites/redirects/
// clean URLs) so the v0 preview renders the real site and live API.
import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { join, extname, normalize } from "node:path"

const ROOT = process.cwd()
const PUBLIC = join(ROOT, "public")
const PORT = Number(process.env.PORT) || 3000

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
}

// ---- vercel.json parity ------------------------------------------------------
const REWRITES = {
  "/privacy": "/privacy.html",
  "/terms": "/terms.html",
  "/wholesale": "/wholesale.html",
  "/library": "/library.html",
  "/the-body-was-listening": "/the-body-was-listening.html",
  "/a-word-for-the-plant": "/a-word-for-the-plant.html",
  "/the-seam": "/the-seam.html",
  "/club-des-hashischins": "/club-des-hashischins.html",
  "/what-the-certificates-say": "/what-the-certificates-say.html",
  "/consumables": "/consumables.html",
  "/devices": "/devices.html",
  "/international": "/international.html",
  "/greekglass": "/greekglass.html",
  // Lookah's own shop front. Same inert shape as its siblings (CLAUDE.md §3:
  // serveStatic() resolves /lookah to lookah.html itself), listed for symmetry
  // and so the two routing files can be diffed against each other.
  "/lookah": "/lookah.html",
  // The two heat shelves. Same slice mechanism as /devices, a second axis
  // across the same gear -- api/shelves.js says why they do not sum to it.
  "/vaporizers": "/vaporizers.html",
  "/combustion": "/combustion.html",
  // The arcade. noindex, in no nav and in no sitemap on purpose (see the
  // head of arcade.html): two of the three cabinets are Brayton's and do not
  // have his sign-off yet.
  "/arcade": "/arcade.html",
  "/kit": "/kit.html",
  "/burned-at-a-funeral": "/burned-at-a-funeral.html",
  "/reels": "/reels.html",
  // Local guide. Listed here and in vercel.json to keep the two files in step
  // (CLAUDE.md §3), in the same shape as the siblings above: the filesystem
  // answers /coldwater before either rewrite is consulted, so like theirs this
  // entry never actually fires. It is safe in a way /p/theloudpack was not,
  // because that source had no file of its own behind it.
  "/coldwater": "/coldwater.html",
  "/coldwater-guide": "/coldwater-guide.html",
  // Operator tool for the browser collector. noindex, and deliberately not in
  // sitemap.xml or any nav: it is a way in to writing the catalogue, so it is
  // reached by someone who already knows the URL.
  "/coldwater-collect": "/coldwater-collect.html",
  // Internal, password-gated mockup for the pending Lookah affiliate
  // application (CLAUDE.md 7's "adding a store" section). noindex, and
  // deliberately not in any nav or sitemap.xml.
  "/lookah-preview": "/lookah-preview.html",
  /* Routing lives in TWO files and they must stay in sync (CLAUDE.md 3): a
     route added to vercel.json alone works in production and 404s in the
     popped-out preview, which is exactly how the consumable/consumables
     outage read from the outside. */
  "/ambassador": "/ambassador.html",
  // A static page living UNDER the /p/ prefix. Two things make it work:
  // vercel.json lists the same rewrite immediately before /p/(.*) so the more
  // specific source wins, and the /p/ prefix dispatch below is told to stand
  // aside (it checks REWRITES first), because that branch runs before this map.
  //
  // THE DESTINATION IS EXTENSIONLESS, AND THAT IS THE WHOLE BUG THIS FIXES.
  // With cleanUrls:true Vercel registers the static asset at /theloudpack; the
  // .html path only exists as a REDIRECT to it, and redirects are evaluated
  // BEFORE rewrites. So a rewrite whose destination carries .html resolves
  // against a path that is not in the route table by then and answers Vercel's
  // own NOT_FOUND -- which is exactly what /p/theloudpack did in production
  // while passing locally. The fourteen "/x": "/x.html" entries above have the
  // same defect and have never once shown it, because the filesystem answers
  // /privacy before any rewrite is consulted, so those rules never fire.
  // Do not "fix" them by adding .html here to match: serveStatic() resolves an
  // extensionless path to .html itself (see tryFiles), so this one value is
  // correct in BOTH files, which is the point.
  "/p/theloudpack": "/theloudpack",
}
const REDIRECTS = {
  /* THE TRIP PAGE IS SHARED BY EVERY CITY, so it stopped being named after
     one. Unlike /coldwater -- which is indexed and linked, and therefore does
     not move (ONE_CORE.md section 4) -- this page is noindex, nofollow and in
     no nav, so the only thing that can point at the old path is somebody's
     homescreen shortcut. That is what the redirect is for. */
  "/coldwater-list": "/trip",
  "/consumable": "/consumables",
  "/index.html": "/",
}
// serverless functions
const API = {
  "/api/products": "./api/products.js",
  "/api/subscribe": "./api/subscribe.js",
  "/api/track": "./api/track.js",
  "/api/overrides": "./api/overrides.js", // was missing: prod served it, local preview 404'd (CLAUDE.md §3 parity)
  "/api/concierge": "./api/concierge.js", // GET ?mood= is zero-token; POST streams SSE (BUDTENDER_PLAN.md v1)
  "/api/ig-research": "./api/ig-research.js", // /ig-studio's research half; admin-token gated, fails closed
  /* THE CANONICAL NAMES ARE MARKET-NEUTRAL, and the old ones are kept forever.
     `coldwater` was the product's name as well as a place, which was right for
     one town and wrong for thirty -- it made "is this string a city or the
     endpoint?" an ambiguous question, and test-one-core.mjs had to mask the
     endpoint before it could diff two cities.

     NOTHING IS REMOVED. The bookmarklet sitting in the operator's browser posts
     to /api/coldwater/ingest and will keep doing so until it is reinstalled, and
     a capture that 404s is a capture silently lost. Both paths reach the same
     handler; the old ones are aliases, not deprecations with a date on them. */
  "/api/market": "./api/coldwater.js",              // dispensary menus, {products,meta} like /api/products
  "/api/market/ingest": "./api/coldwater-ingest.js", // menus captured by a browser (public/coldwater-collector.js)
  "/api/coldwater": "./api/coldwater.js",           // alias, kept: indexed and in use
  "/api/coldwater/ingest": "./api/coldwater-ingest.js", // alias, kept: installed bookmarklets post here
  "/api/ambassador": "./api/ambassador.js", // applications to bring a town onto the site
  /* THREE THAT WERE MISSING, found the same way /api/overrides above was: a
     page asked for one and the local preview 404'd while production served it
     perfectly. Vercel runs every file in api/ as a function whether or not it
     is named here, so this map is a hand-kept TWIN of the filesystem and it
     drifts in exactly one direction -- silently, and only in preview.
     test-server-routes.mjs holds the two together now. */
  "/api/price-history": "./api/price-history.js", // "cheapest we've seen"; the card display reads it on every load
  "/api/img": "./api/img.js",                     // the restricted image proxy Lookah's photos ride through
  "/api/kit": "./api/kit.js",                     // the rig builder behind /kit
  "/api/comments": "./api/comments.js",           // per-product threads; public POST is queued, never published
  "/api/admin/session": "./api/admin/session.js",
  // vercel.json rewrites these clean paths to serverless functions rather than
  // static files; mapped directly here since the API check runs before REWRITES.
  "/admin": "./api/admin/home.js",
  "/admin/sign-in": "./api/admin/sign-in.js",
  "/admin/operating-model": "./api/admin/model.js",
  "/admin/gear-avail": "./api/admin/gear.js",
  // Wildcard, dispatched by prefix in the request handler rather than by exact
  // match: vercel.json rewrites /p/(.*) -> /api/share?id=$1.
  "/p/": "./api/share.js",
}
const apiCache = new Map()
async function loadApi(path) {
  if (!apiCache.has(path)) apiCache.set(path, await import(API[path]))
  return apiCache.get(path)
}

// Give Node's ServerResponse the small Vercel helper surface the handlers use.
function enhanceRes(res) {
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = (data) => {
    res.end(data)
    return res
  }
  return res
}

async function serveStatic(res, urlPath) {
  // Normalize + prevent path traversal, then resolve clean URLs to .html.
  let rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "")
  if (rel === "/" || rel === "" || rel === "\\") rel = "/index.html"
  let file = join(PUBLIC, rel)
  if (!file.startsWith(PUBLIC)) {
    res.statusCode = 403
    return res.end("Forbidden")
  }

  const tryFiles = extname(file) ? [file] : [file + ".html", join(file, "index.html")]
  for (const candidate of tryFiles) {
    try {
      const s = await stat(candidate)
      if (!s.isFile()) continue
      const buf = await readFile(candidate)
      res.setHeader("Content-Type", MIME[extname(candidate)] || "application/octet-stream")
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.statusCode = 200
      return res.end(buf)
    } catch {
      /* try next candidate */
    }
  }
  res.statusCode = 404
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.end("<!doctype html><meta charset=utf-8><title>404</title><h1>404 — Not Found</h1>")
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`)
    let path = url.pathname

    // 1) API functions (Vercel: /api/* -> serverless)
    if (API[path]) {
      req.query = Object.fromEntries(url.searchParams.entries())
      enhanceRes(res)
      const mod = await loadApi(path)
      await mod.default(req, res)
      if (!res.writableEnded) res.end()
      return
    }
    // 1b) /p/<id> -> api/share.js. vercel.json rewrites /p/(.*) to
    // /api/share?id=$1, but the API map above is exact-path only, so this
    // wildcard needs its own check or every share link 404s in preview while
    // working in production: exactly the two-files-out-of-sync trap CLAUDE.md §3
    // describes. The id is the path remainder, matching Vercel's $1 capture, and
    // any real query string is preserved alongside it.
    if (path.startsWith("/p/") && !REWRITES[path]) {
      req.query = {
        ...Object.fromEntries(url.searchParams.entries()),
        id: decodeURIComponent(path.slice(3)),
      }
      enhanceRes(res)
      const mod = await loadApi("/p/")
      await mod.default(req, res)
      if (!res.writableEnded) res.end()
      return
    }

    if (path.startsWith("/api/")) {
      res.statusCode = 404
      res.setHeader("Content-Type", "application/json")
      return res.end(JSON.stringify({ error: "Not found" }))
    }

    // 2) redirects (permanent)
    if (REDIRECTS[path]) {
      res.statusCode = 308
      res.setHeader("Location", REDIRECTS[path])
      return res.end()
    }

    // 3) rewrites (clean URL -> file)
    if (REWRITES[path]) path = REWRITES[path]

    // 4) static (with clean-URL .html resolution)
    await serveStatic(res, path)
  } catch (err) {
    console.log("[v0] server error:", err && err.message ? err.message : err)
    if (!res.writableEnded) {
      res.statusCode = 500
      res.end("Server error")
    }
  }
})

server.listen(PORT, () => {
  console.log(`[v0] Legal-Leaf Market dev server running on http://localhost:${PORT}`)
})

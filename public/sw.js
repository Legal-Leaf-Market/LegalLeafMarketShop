/* ============================================================
   Legal-Leaf Market service worker — THE SHELL, AND ONLY THE SHELL
   ------------------------------------------------------------
   /api/* is deliberately NEVER cached here.

   The whole promise of this site is live inventory: there is a LIVE
   INVENTORY pill in the results bar and an "Updated —" stamp that reads
   the API's own timestamp. Serving yesterday's feed from a service-worker
   cache would make both of those lie, and a price comparison that quietly
   goes stale is worse than one that fails loudly. The API already has its
   own CDN cache (s-maxage in vercel.json), which is the right layer.

   /api/overrides is covered by the same rule — admin category fixes are
   published so every visitor sees them, and a cached copy would pin a
   browser to a catalogue the owner has already corrected.

   Everything else — markup, icons, the manifest — is cached so the app
   opens instantly and survives a dropped connection.

   NOTE ON THE SHELL: index.html carries the engine inline (CLAUDE.md 5),
   so caching '/' caches the whole app in one entry. There is no /js or
   /css directory to precache; install.js is small and falls through to the
   runtime branch below.
   ============================================================ */

/* Bump this to retire every old cache on the next activate. */
var VERSION = 'll-shell-v1';

var SHELL = [
  '/',
  '/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      /* addAll is all-or-nothing: one 404 would abort the whole install
         and leave the app with no shell at all. Add them individually so
         a single missing file costs only that file. */
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { /* skip, not fatal */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Never touch a vendor's site — the checkout hand-off and the Greek
     Glass Big Cartel bookmarklet both leave this origin and must not be
     intercepted, cached or rewritten. */
  if (url.origin !== self.location.origin) return;

  /* Live inventory stays live. See the note at the top. */
  if (url.pathname.indexOf('/api/') === 0) return;

  /* Vercel's own edge routes — analytics and speed insights — are served
     from /_vercel/*. The insights script is a same-origin GET, so without
     this it would fall into the cache-first branch below and be frozen at
     whatever version was current the day a visitor first loaded the site:
     measurement that silently stops matching what Vercel expects, which
     is worse than no measurement. */
  if (url.pathname.indexOf('/_vercel/') === 0) return;

  /* Navigations: network first, so a deploy is picked up on the next open
     rather than after a cache expiry, with the cached shell as the
     offline fallback. The satellite pages (/consumables, /devices,
     /international, /greekglass) are separate documents, so each is
     cached under its own key rather than collapsed onto '/'. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match('/').then(function (root) {
            return root || new Response('Offline', {
              status: 503, headers: { 'Content-Type': 'text/plain' }
            });
          });
        });
      })
    );
    return;
  }

  /* install.js writes the install copy and is the only loose script left.
     Cache-first on it means a fix does not reach anyone until the load AFTER
     the one that fetched it, so it is network-first with cache as the
     offline fallback. */
  if (/\.js$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  /* Everything else — icons, the mark, the manifest — is immutable enough
     to serve from cache first and refresh behind. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

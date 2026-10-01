/* sw.js — installability, an offline shell, and the two push handlers.
   Network-first for everything: a deploy must never be shadowed by a cache. */
const CACHE = "popping-v1";
const SHELL = ["/", "/css/app.css", "/js/app.js", "/js/live.js", "/js/strategy.mjs", "/manifest.webmanifest", "/icon.svg", "/playbook"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/api/")) return;              // never cache data
  e.respondWith(
    fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(m => m || caches.match("/")))
  );
});

/* Background alerts arrive here when the server side is configured (see
   api/push.js). The page's own alerts do not go through this handler. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Popping", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Popping", {
    body: d.body || "", tag: d.tag || "popping", renotify: true, icon: "/icon-192.png", badge: "/icon-192.png",
    vibrate: d.level === "sell" ? [200, 100, 200, 100, 400] : [120], data: { url: d.url || "/#live" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#live";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ("focus" in c) { c.navigate && c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

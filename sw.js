// Bump CACHE_VERSION any time index.html, styles.css, or app.js changes —
// this is what forces installed clients to drop the stale cache and refetch.
const CACHE_VERSION = "v6";
const CACHE = `steady-${CACHE_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./offline.html",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./screenshots/today.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  // No self.skipWaiting() here on purpose — the new worker waits until the
  // page explicitly asks it to take over (see the "Update available" flow
  // in app.js), so an update never silently swaps content under someone
  // mid-session.
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match(e.request).then((cached) => cached || caches.match("./offline.html"))
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => cached))
  );
});

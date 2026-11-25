/* FLOWLINE service worker — cache-first with network fallback. */
const CACHE = 'flowline-v1';
const CORE = ['./', './index.html', './manifest.json', './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Serve the cached shell instantly, refresh it in the background so the
    // next launch picks up a new deploy (hashed assets follow automatically).
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => {
        const network = fetchAndCache(request).catch(() => cached || caches.match('./index.html'));
        return cached || network;
      }),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetchAndCache(request)));
});

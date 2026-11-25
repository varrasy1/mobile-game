/* FLOWLINE service worker — pages network-first, hashed assets cache-first. */
const CACHE = 'flowline-v2';
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

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network-first (short timeout) so every launch picks up a new deploy;
    // offline, fall back to the cached shell. Hashed assets stay cache-first.
    event.respondWith(
      withTimeout(fetchAndCache(request), 3500).catch(() =>
        caches.match(request, { ignoreSearch: true }).then((c) => c || caches.match('./index.html')),
      ),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetchAndCache(request)));
});

const CACHE = 'lift-log-cache-v1';
const ASSETS = ['/weightlifting-tracker-mvp/', '/weightlifting-tracker-mvp/index.html', '/weightlifting-tracker-mvp/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('/weightlifting-tracker-mvp/index.html')))
  );
});

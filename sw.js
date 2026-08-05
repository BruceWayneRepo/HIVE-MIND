// Network-first service worker: always fetch the latest files when online, so
// updates you push to GitHub take effect immediately. Falls back to cache only
// when offline. Bump CACHE to force old caches out.
const CACHE = 'mind-shell-v3';
const SHELL = [
  './', './index.html', './style.css', './app.js', './db.js', './ui.js',
  './search.js', './color.js', './ocr.js', './ai.js', './firebase.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // ignore CDN/API/fonts
  // Network-first: try the network, cache the fresh copy, fall back to cache offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});

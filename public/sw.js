// sw.js - DARK CHAT service worker
// Strategy: never cache API or realtime traffic; network-first for navigations
// and app code (so a new build always wins), cache-first only for immutable assets.
const VERSION = 'dark-chat-v3';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css?v=2',
  '/js/app.js',
  '/manifest.json',
  '/assets/logo.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(pathname) {
  return pathname.startsWith('/assets/')
    || pathname.startsWith('/icons/')
    || pathname === '/favicon.ico'
    || pathname === '/favicon.png'
    || pathname === '/icon-192.png'
    || pathname === '/icon-512.png';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch API or realtime traffic - always straight to the network.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  // Navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Immutable binaries: cache-first.
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      }))
    );
    return;
  }

  // App code / styles / everything else same-origin: network-first so a new
  // build is never masked by a stale cache entry.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || Response.error()))
  );
});
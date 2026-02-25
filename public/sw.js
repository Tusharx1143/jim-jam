/**
 * WeJam Service Worker
 * Network-first for everything — always fetch fresh, fall back to cache offline
 */

const CACHE_NAME = 'jimjam-v7';

const PRECACHE_ASSETS = [
  '/styles/variables.css',
  '/styles/reset.css',
  '/styles/base.css',
  '/styles/components.css',
  '/styles/home.css',
  '/styles/room.css',
  '/styles/responsive.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ===== INSTALL — pre-cache static assets =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ===== ACTIVATE — remove old caches =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ===== FETCH — serve strategy by request type =====
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests (YouTube, Google APIs, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API, socket.io — always needs live data
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Network-first for everything — always get fresh content, fall back to cache when offline
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

function fetchAndCache(request) {
  return fetch(request).then(response => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
    }
    return response;
  });
}

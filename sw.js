/*
 * Harbor service worker — makes the app work fully offline (spotty boat internet).
 *
 * RELEASE RULE: bump VERSION on every release (any change to any file below).
 * A new VERSION makes browsers download a fresh copy of every app file and
 * throw away the old cache. Forget to bump it and people keep the old app.
 *
 * Strategy: precache the app files on install, then serve same-origin GETs
 * cache-first. Page loads fall back to the cached index.html when offline.
 * Non-GET and cross-origin requests are never touched or cached.
 * All paths are relative so the app works from a sub-path (e.g. /track/).
 * User data lives in localStorage, never in this cache.
 */
const VERSION = 'harbor-v2';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './engine.js',
  './visuals.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // ignoreSearch lets "?today=..." (testing hook) and other query strings hit the cache.
    const cached = await cache.match(req, { ignoreSearch: isNav });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      // Only keep our own app's files (inside this worker's scope), never other sites' pages.
      if (res && res.ok && res.type === 'basic' && req.url.startsWith(self.registration.scope)) {
        event.waitUntil(cache.put(req, res.clone()));
      }
      return res;
    } catch (err) {
      if (isNav) {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

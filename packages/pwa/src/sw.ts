/// <reference lib="webworker" />
/**
 * The service worker.
 *
 * Cache-first for the shell and the puzzle bundle, because a year of puzzles
 * ships as a static file and never changes — that is what makes the game work
 * on a plane. Network-only for the players service, which must never be served
 * a stale leaderboard.
 */

declare const self: ServiceWorkerGlobalScope;

const VERSION = 'v1';
const SHELL = `sussed-shell-${VERSION}`;

const PRECACHE = ['/', '/index.html', '/puzzles.json', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  // Anything going to the players service goes to the network, always.
  if (url.pathname.startsWith('/api/') || url.hostname.startsWith('api.')) return;

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) {
        // Refresh in the background so the next load is current.
        void fetch(event.request)
          .then((res) => {
            if (res.ok) void caches.open(SHELL).then((c) => c.put(event.request, res.clone()));
          })
          .catch(() => undefined);
        return hit;
      }
      return fetch(event.request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            void caches.open(SHELL).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error());
    }),
  );
});

export {};

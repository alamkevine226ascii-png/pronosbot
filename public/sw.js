/* PronoBot Service Worker — v12
 * Cache-first pour assets statiques, network-first pour API et navigations.
 * Support offline complet + installable PWA + mode standalone.
 *
 * === SECURITY MODEL ===
 * - Only same-origin GET requests are cached (line ~52-53). Cross-origin
 *   assets (e.g. ESPN team logos loaded via <img>) bypass the SW entirely.
 * - POST/PUT/DELETE requests are NEVER cached — they pass straight through
 *   to the network. This is critical because /api/web-search is a POST that
 *   triggers an LLM call (costs money) and returns AI-generated insights;
 *   caching it could serve stale data or leak it to other users of the same
 *   device. The `req.method !== 'GET'` guard on line ~50 enforces this.
 * - Cached API responses have a 5-min TTL (API_CACHE_TTL_MS) so a poisoned
 *   or stale entry can persist for at most 5 minutes offline.
 * - HSTS (preload) at the HTTP layer ensures the SW itself is always served
 *   over HTTPS, preventing a network-level MITM from injecting a malicious SW
 *   that could control all future requests.
 * - The SW scope is '/' (set in layout.tsx via navigator.serviceWorker.register)
 *   which is required for full PWA offline support. A narrower scope would
 *   break offline navigation.
 *
 * Changes vs v11:
 *   - Bump version (v11 → v12) pour invalider les anciens caches après les
 *     multiples modifications de l'app (nouvelles ligues, web-search, redesign).
 *   - Précache étendu avec les favours et icônes pour un offline robuste.
 *   - Navigation fallback amélioré : sert '/' si la page demandée n'est pas
 *     cachée, ce qui permet à l'app de se lancer même offline.
 */
const VERSION = 'pronobot-v13';
const STATIC_CACHE = `${VERSION}-static`;
const API_CACHE = `${VERSION}-api`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const API_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — keep offline fallback fresh

const PRECACHE_URLS = [
  '/',
  '/?source=pwa',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // API: network-first, fallback cache (with 5-min TTL on cached entries)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => {
              // Wrap the response so we can stamp a Date header for TTL checks.
              // The original res is already consumed by the browser — clone is
              // independent, and we re-wrap with a Date header that we read
              // when serving from cache below.
              const stamped = new Response(clone.body, {
                status: res.status,
                statusText: res.statusText,
                headers: new Headers(res.headers),
              });
              stamped.headers.set('x-sw-cached-at', String(Date.now()));
              c.put(req, stamped).catch(() => {});
            }).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (!cached) {
            return Response.json({ error: 'offline' }, { status: 503 });
          }
          // Honor the TTL: if the cached entry is older than API_CACHE_TTL_MS,
          // drop it and return 503 so the client can show a clear offline state
          // instead of potentially very stale live scores.
          const cachedAt = parseInt(cached.headers.get('x-sw-cached-at') || '0', 10);
          if (cachedAt && Date.now() - cachedAt > API_CACHE_TTL_MS) {
            const cache = await caches.open(API_CACHE);
            cache.delete(req).catch(() => {});
            return Response.json({ error: 'offline' }, { status: 503 });
          }
          return cached;
        })
    );
    return;
  }

  // Navigation: network-first, fallback cached "/"
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

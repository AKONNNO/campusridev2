/* ============================================================================
 * KNUST Bus Tracker — Service Worker
 *
 * Makes the app installable and lets the core experience survive weak / absent
 * connections (spec: "no internet connection — show cached stops and routes",
 * and "must run well on low-end Android phones and weak connections").
 *
 * Cache strategy (deliberately simple, no build-plugin needed):
 *   • App shell (navigation + hashed /assets/*) — network-first for the HTML,
 *     stale-while-revalidate for the content-hashed JS/CSS. The first visit
 *     seeds the cache; afterwards the shell works fully offline.
 *   • Public snapshot API — only the whitelisted, shared GETs
 *     (/api/stops, /api/routes, /api/announcements, /api/buses/live) are cached
 *     stale-while-revalidate, and never when a query string is present, so the
 *     last-seen campus data is available offline. Anything that could carry the
 *     student's own input/position is never stored. (Real-time bus movement
 *     still needs a connection.)
 *   • Everything else (OSM tiles, sockets) — not cached here.
 *
 * PRIVACY: identical to the rest of the app — nothing user-identifying is
 * cached. Student locations are never sent, and bus history kept in the
 * service-worker cache is only the public broadcast data.
 *
 * Version bump CACHE_VERSION to invalidate caches on a new deploy.
 * ==========================================================================*/

const CACHE_VERSION = 'knust-bt-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;

/* Paths to precache straight away (fast first paint + offline shell). */
const PRECACHE_URLS = ['/', '/manifest.webmanifest', '/favicon.svg'];

/*
 * The ONLY public GET endpoints the student app caches offline — the shared
 * campus snapshot. Everything else (`/api/stops/:id/arrivals`,
 * `/api/trip-plan`, `/api/stops/nearest?lat=&lng=`, …) is deliberately NOT
 * cached because it may carry the student's own input or location. PRIVACY:
 * student positions are used on-device only and must never be written to disk.
 */
const SAFE_API_PATHS = new Set([
  '/api/stops',
  '/api/routes',
  '/api/announcements',
  '/api/buses/live',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn('[sw] precache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/*
 * The page (see client/src/lib/pwa.js) sends { type: 'SKIP_WAITING' } when a
 * freshly-installed SW is ready, so a new deploy takes over on next navigation.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/*
 * Tapping a notification (an arrival alert) focuses an open window or opens
 * the app at the URL carried in the notification's payload.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.navigate(url) || client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

/** Network-first for navigations: fresh page when online, shell from cache offline. */
async function navigationHandler(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    // Offline → fall back to the cached shell so the app still opens.
    const cached = await caches.match('/');
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/** Stale-while-revalidate: serve cached instantly, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin navigations (the app routes) → network-first with shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Same-origin hashed assets + manifest/icons → stale-while-revalidate.
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // Public read-only API → stale-while-revalidate ONLY for the whitelisted
  // campus-snapshot endpoints and ONLY when there is no query string (which
  // could carry the student's location/input). Anything else is left to the
  // network — it is never stored offline (privacy).
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    if (!SAFE_API_PATHS.has(url.pathname) || url.search.length > 0) return;
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // Everything else (OSM tiles, sockets) is left to the network (no caching).
});

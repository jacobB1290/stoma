/* public/service-worker.js
 * Stomaboard – Production Service Worker
 *
 * Strategy overview
 * ─────────────────
 *  • App shell (HTML, JS, CSS)   → Cache-first, updated in the background
 *  • Static assets (icons, fonts)→ Cache-first, long TTL
 *  • Supabase API / OpenAI calls → Network-only  (never cache live data)
 *  • Everything else             → Network-first with offline cache fallback
 *
 * The service worker is automatically re-registered on every new Vercel
 * deployment because CRA appends a content-hash to the bundle filenames,
 * so the new SW script will differ from the cached copy.
 */

const APP_SHELL_CACHE   = 'stomaboard-shell-v2';
const STATIC_ASSET_CACHE = 'stomaboard-static-v2';
const RUNTIME_CACHE     = 'stomaboard-runtime-v2';

// URLs that should NEVER be cached (live API traffic)
const NEVER_CACHE = [
  'supabase.co',
  'openai.com',
  'api.openai.com',
];

// Static assets that should be cached on first use and kept indefinitely
const STATIC_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.ttf'];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately on update
  self.skipWaiting();

  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      // Pre-cache the bare minimum app shell
      return cache.addAll([
        '/',
        '/manifest.json',
      ]).catch((err) => {
        // Non-fatal: if the shell can't be pre-cached, we fall back gracefully
        console.warn('[SW] Pre-cache failed:', err);
      });
    })
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const CURRENT_CACHES = [APP_SHELL_CACHE, STATIC_ASSET_CACHE, RUNTIME_CACHE];

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !CURRENT_CACHES.includes(key))
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests → always pass through
  if (request.method !== 'GET') return;

  // 2. Never-cache list (Supabase, OpenAI, etc.) → network only
  if (NEVER_CACHE.some((domain) => url.hostname.includes(domain))) {
    return; // let the browser handle it normally
  }

  // 3. Chrome extension requests → skip
  if (url.protocol === 'chrome-extension:') return;

  // 4. Static assets (images, fonts) → cache-first
  if (STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext))) {
    event.respondWith(cacheFirst(request, STATIC_ASSET_CACHE));
    return;
  }

  // 5. App shell files (same origin JS/CSS) → stale-while-revalidate
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/static/') || url.pathname === '/')) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    return;
  }

  // 6. Everything else → network-first with cache fallback
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ─── Strategy helpers ────────────────────────────────────────────────────────

/**
 * Cache-first: serve from cache; if miss, fetch, cache, and return.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    return new Response('Offline – resource not available', { status: 503 });
  }
}

/**
 * Stale-while-revalidate: serve cached copy immediately while fetching a
 * fresher version in the background for next time.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

/**
 * Network-first: try the network; if it fails (offline) fall back to cache.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'You are offline and this resource is not cached.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ─── Background Sync / Push (stubs for future use) ───────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

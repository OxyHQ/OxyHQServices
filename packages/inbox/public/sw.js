/**
 * Service Worker for Inbox by Oxy
 *
 * Strategies:
 * - App shell (HTML, JS, CSS): cache on install, network-first on fetch
 * - Static assets (images, fonts): cache-first
 * - API calls: network-first, fall back to cached response
 * - Offline mutations: queued via Background Sync
 */

const CACHE_NAME = 'inbox-v1';
const API_CACHE = 'inbox-api-v1';

// App shell files cached on install
const APP_SHELL = [
  '/',
  '/index.html',
];

// ─── Install ────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        // Non-fatal: shell will be cached on first fetch instead
        console.warn('[SW] Failed to pre-cache app shell:', err);
      });
    })
  );
  // Activate immediately without waiting for existing clients
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== API_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// ─── Fetch Strategies ───────────────────────────────────────────────

/**
 * Determine the caching strategy for a request.
 */
function getStrategy(request) {
  const url = new URL(request.url);

  // Skip non-GET requests (mutations go through offlineQueue, not SW cache)
  if (request.method !== 'GET') return 'network-only';

  // API requests: network-first
  if (url.pathname.startsWith('/api/') || url.hostname === 'api.oxy.so') {
    return 'network-first';
  }

  // Static assets: cache-first
  if (
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|ico|webp)$/) ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/assets/')
  ) {
    return 'cache-first';
  }

  // Navigation / HTML: network-first (app shell fallback)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    return 'network-first';
  }

  // Default: network-first
  return 'network-first';
}

/**
 * Network-first: try network, fall back to cache.
 */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // For navigation requests, return cached app shell
    if (request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }

    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Cache-first: try cache, fall back to network.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

self.addEventListener('fetch', (event) => {
  const strategy = getStrategy(event.request);

  if (strategy === 'network-only') return; // Let the browser handle it

  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // network-first (default)
  const cacheName = event.request.url.includes('api.oxy.so') || event.request.url.includes('/api/')
    ? API_CACHE
    : CACHE_NAME;
  event.respondWith(networkFirst(event.request, cacheName));
});

// ─── Background Sync ────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-mutations') {
    event.waitUntil(processOfflineQueue());
  }
});

/**
 * Process queued offline mutations.
 * Reads from IndexedDB (set by offlineQueue.ts in the app).
 */
async function processOfflineQueue() {
  let db;
  try {
    db = await openDB();
  } catch {
    return; // IndexedDB not available
  }

  const tx = db.transaction('mutations', 'readwrite');
  const store = tx.objectStore('mutations');
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = async () => {
      const mutations = request.result || [];
      const failed = [];

      for (const mutation of mutations) {
        try {
          const response = await fetch(mutation.url, {
            method: mutation.method,
            headers: mutation.headers,
            body: mutation.body ? JSON.stringify(mutation.body) : undefined,
          });

          if (!response.ok && response.status >= 500) {
            // Server error — keep in queue for retry
            failed.push(mutation);
          }
          // 4xx errors are not retried (bad request, auth issues, etc.)
        } catch {
          // Network error — keep in queue
          failed.push(mutation);
        }
      }

      // Clear processed, re-add failed
      const clearTx = db.transaction('mutations', 'readwrite');
      const clearStore = clearTx.objectStore('mutations');
      clearStore.clear();
      for (const m of failed) {
        clearStore.add(m);
      }

      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Open the offline mutations IndexedDB.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('inbox-offline', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('mutations')) {
        db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Messages from clients ──────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

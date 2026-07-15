/**
 * Offline strategy — what IS supported, and why raw fetch replay was rejected.
 *
 * ── PRIMARY (supported) ──────────────────────────────────────────────
 * Offline writes are handled by TanStack Query's paused-mutation mechanism,
 * NOT by the raw-fetch queue below. The critical message mutations (toggleRead,
 * toggleStar, archive, delete) set `networkMode: 'offlineFirst'`, so when the
 * device is offline they enter status "paused" and auto-resume when the network
 * returns (see `hooks/queries/queryClient.ts` for the resume + persistence
 * wiring). Because replay re-runs the mutation's `mutationFn`, every retried
 * request goes back through the SDK `httpService` and therefore keeps auth,
 * CSRF, and token-refresh intact.
 *
 * ── REJECTED: raw fetch replay ───────────────────────────────────────
 * The IndexedDB/localStorage queue in this file records `{ url, method, headers,
 * body }` and replays them with a bare `fetch`. That was deliberately NOT wired
 * into the app's mutations because a replayed raw request:
 *   - bypasses the SDK `httpService` (no automatic bearer-token refresh, so a
 *     token that expired while offline replays with a stale/absent Authorization
 *     header and 401s), and
 *   - carries no CSRF token, which the API requires for state-changing calls.
 * Persisting captured auth/CSRF headers to disk would also be a security
 * regression. The functions below are retained only as a platform-capability
 * probe (`isOfflineQueueSupported`) and connectivity helpers; `enqueue` /
 * `flushQueue` have no producers in the app.
 *
 * ── Cross-restart replay (future enhancement) ────────────────────────
 * Paused mutations are persisted (so they survive a cold restart), but full
 * cross-restart replay additionally needs `queryClient.setMutationDefaults(key,
 * { mutationFn })` for each mutation key so the dehydrated mutation can be
 * rehydrated with a live `mutationFn`. Within a single session the closure is
 * alive and replay works today. Adding `setMutationDefaults` keyed on the SDK
 * `api` instance is the clean upstream-friendly next step; it is intentionally
 * NOT hacked in here with a raw-fetch fallback.
 */

import { Platform } from 'react-native';

/**
 * Whether the offline mutation queue is supported on the current platform.
 *
 * The queue is built on IndexedDB + the `online`/`offline` window events and
 * Background Sync, all of which are web-only. On native this is `false` and
 * every queue operation is a documented no-op — callers should gate offline
 * affordances (and any "works offline" UX copy) on this flag rather than
 * relying on a silent native fallthrough.
 */
export const isOfflineQueueSupported = Platform.OS === 'web';

// ─── Types ──────────────────────────────────────────────────────────

export interface OfflineMutation {
  id?: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  timestamp: number;
}

// ─── IndexedDB helpers ──────────────────────────────────────────────

const DB_NAME = 'inbox-offline';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Queue Operations ───────────────────────────────────────────────

/**
 * Add a mutation to the offline queue.
 */
export async function enqueue(mutation: Omit<OfflineMutation, 'id' | 'timestamp'>): Promise<void> {
  if (Platform.OS !== 'web') return;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
      ...mutation,
      timestamp: Date.now(),
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Request Background Sync if available
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      await (registration as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register('offline-mutations');
    }
  } catch {
    // Fall back to localStorage if IndexedDB fails
    try {
      const existing = JSON.parse(localStorage.getItem('inbox_offline_queue') || '[]');
      existing.push({ ...mutation, timestamp: Date.now() });
      localStorage.setItem('inbox_offline_queue', JSON.stringify(existing));
    } catch {
      // Silently fail — mutation will be lost
    }
  }
}

/**
 * Get all queued mutations.
 */
export async function getQueue(): Promise<OfflineMutation[]> {
  if (Platform.OS !== 'web') return [];

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();

    return await new Promise<OfflineMutation[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Fall back to localStorage
    try {
      return JSON.parse(localStorage.getItem('inbox_offline_queue') || '[]');
    } catch {
      return [];
    }
  }
}

/**
 * Clear the entire queue (after successful flush).
 */
export async function clearQueue(): Promise<void> {
  if (Platform.OS !== 'web') return;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // noop
  }

  // Also clear localStorage fallback
  try {
    localStorage.removeItem('inbox_offline_queue');
  } catch {
    // noop
  }
}

/**
 * Flush the queue: replay all mutations in order.
 * Returns the number of successfully processed mutations.
 */
export async function flushQueue(): Promise<number> {
  if (Platform.OS !== 'web') return 0;

  const mutations = await getQueue();
  if (mutations.length === 0) return 0;

  let processed = 0;
  const failed: OfflineMutation[] = [];

  for (const mutation of mutations) {
    try {
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body ? JSON.stringify(mutation.body) : undefined,
      });

      if (response.ok || (response.status >= 400 && response.status < 500)) {
        // Success or client error (don't retry 4xx)
        processed++;
      } else {
        // Server error — keep for retry
        failed.push(mutation);
      }
    } catch {
      // Network error — keep for retry
      failed.push(mutation);
    }
  }

  // Replace queue with only failed items
  await clearQueue();
  for (const m of failed) {
    await enqueue({ url: m.url, method: m.method, headers: m.headers, body: m.body });
  }

  return processed;
}

// ─── Online Status ──────────────────────────────────────────────────

/**
 * Check if the browser is online.
 */
export function isOnline(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Listen for online/offline events.
 * Returns an unsubscribe function.
 */
export function onConnectivityChange(callback: (online: boolean) => void): () => void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return () => {};
  }

  const onOnline = () => {
    callback(true);
    // Auto-flush queue when coming back online
    flushQueue().catch(() => {});
  };
  const onOffline = () => callback(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

// ─── React Query Integration ────────────────────────────────────────

/**
 * Create an offline-aware mutation function.
 *
 * When online, calls the API directly.
 * When offline, queues the mutation for later replay.
 *
 * @param apiUrl - Full API URL
 * @param method - HTTP method
 * @param getHeaders - Function to get auth headers
 */
export function createOfflineMutation(
  apiUrl: string,
  method: string,
  getHeaders: () => Record<string, string>,
) {
  return async (body?: Record<string, unknown>): Promise<void> => {
    if (isOnline()) {
      const response = await fetch(apiUrl, {
        method,
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
    } else {
      await enqueue({
        url: apiUrl,
        method,
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body,
      });
    }
  };
}

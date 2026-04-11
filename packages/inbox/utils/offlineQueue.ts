/**
 * Offline mutation queue.
 *
 * When the app is offline, mutations (star, archive, delete, mark-read) are
 * queued in IndexedDB. When back online, the queue is flushed — either via
 * Background Sync (if supported) or via an online event listener.
 *
 * Integrates with React Query's optimistic update pattern:
 * - onMutate: apply optimistically + enqueue if offline
 * - onError: rollback + keep in queue
 * - onSettled: flush queue if online
 */

import { Platform } from 'react-native';

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

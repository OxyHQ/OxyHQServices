/**
 * Inbox QueryClient — offline-first + cross-restart persistence.
 *
 * - `networkMode: 'offlineFirst'` on queries serves cached data immediately and
 *   refetches in the background; on the critical message mutations (star, read,
 *   archive, delete — see `useMessageMutations`) it queues the mutation while
 *   offline and auto-resumes it when connectivity returns.
 * - `persistQueryClient(...)` dehydrates a whitelist of email queries AND every
 *   paused mutation to device storage so both survive a cold restart.
 * - `onlineManager` resume hook replays paused mutations the instant the network
 *   is reported back (network monitoring itself is wired by `OxyProvider`).
 *
 * Storage layer:
 * - Web    → `localStorage` via `createSyncStoragePersister`.
 * - Native → `AsyncStorage` via `createAsyncStoragePersister`.
 *
 * Isolation: the persisted blob is per-device, not per-account. `app/_layout`
 * clears the client (and this cache) whenever the active Oxy session changes,
 * so a different signed-in account never reads a previous account's mail.
 */

import { Platform } from 'react-native';
import { QueryClient, onlineManager, type Query, type Mutation } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Persister } from '@tanstack/react-query-persist-client';

import { PERSISTED_QUERY_ROOTS } from '@/hooks/queries/queryKeys';

const CACHE_KEY = 'inbox_query_cache_v1';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const PERSIST_THROTTLE_MS = 1_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 2,
      refetchOnWindowFocus: true,
      // Refetch stale data once the network is reported back.
      refetchOnReconnect: true,
      // Offline-first: serve cached data immediately, refetch in the background.
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Offline-first: pause and queue mutations when offline (see useMessageMutations).
      networkMode: 'offlineFirst',
      retry: 1,
    },
  },
});

// Replay any paused (offline) mutations the moment the network returns. TanStack
// does this internally too; wiring it explicitly keeps behaviour robust if the
// host swaps in a custom onlineManager implementation.
onlineManager.subscribe((isOnline) => {
  if (isOnline) {
    void queryClient.getMutationCache().resumePausedMutations();
  }
});

/**
 * Only persist queries that (a) completed successfully and (b) belong to the
 * email-read whitelist. AI results and errors are never persisted.
 */
function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false;
  const head = query.queryKey[0];
  return typeof head === 'string' && PERSISTED_QUERY_ROOTS.has(head);
}

/**
 * Persist every mutation regardless of status — paused mutations are exactly
 * the ones that must survive a restart to replay when back online.
 */
function shouldDehydrateMutation(_mutation: Mutation): boolean {
  return true;
}

/**
 * Build the platform-appropriate persister, or `null` when no storage is
 * available (e.g. during a Node static web export where `localStorage` is
 * undefined). Returning `null` makes persistence a safe no-op.
 */
function createInboxPersister(): Persister | null {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: CACHE_KEY,
      throttleTime: PERSIST_THROTTLE_MS,
    });
  }
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: CACHE_KEY,
    throttleTime: PERSIST_THROTTLE_MS,
  });
}

const persister = createInboxPersister();

/**
 * Resolves once the persisted query+mutation blob has been hydrated (or when
 * persistence is unavailable). `app/_layout` awaits this before rendering mail
 * UI so the first paint serves cached data instead of an empty cache.
 */
export let restoredInboxCache: Promise<void> = Promise.resolve();

if (persister) {
  const [, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: CACHE_MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateQuery,
      shouldDehydrateMutation,
    },
  });
  restoredInboxCache = restored;
  restored.catch(() => {
    // Non-fatal: a failed restore only means a cold start without offline cache.
  });
}

/**
 * Remove the persisted query+mutation blob. Called on active-account switch so
 * the next cold start never restores the previous account's mail. Safe to call
 * even when persistence was never attached.
 */
export async function clearPersistedInboxCache(): Promise<void> {
  if (!persister) return;
  try {
    await persister.removeClient();
  } catch {
    // Non-fatal: a failed purge only means slightly stale cache on next start.
  }
}

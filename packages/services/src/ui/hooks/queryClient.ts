import { QueryClient, onlineManager } from '@tanstack/react-query';
import { isDev } from '@oxyhq/core';
import type { StorageInterface } from '../utils/storageHelpers';

const QUERY_CACHE_KEY = 'oxy_query_cache';
const QUERY_CACHE_VERSION = '1';

/**
 * Custom persistence adapter for TanStack Query using our StorageInterface
 */
export const createPersistenceAdapter = (storage: StorageInterface) => {
  return {
    persistClient: async (client: any) => {
      try {
        const serialized = JSON.stringify({
          clientState: client,
          timestamp: Date.now(),
          version: QUERY_CACHE_VERSION,
        });
        await storage.setItem(QUERY_CACHE_KEY, serialized);
      } catch (error) {
        if (isDev()) {
          console.warn('[QueryClient] Failed to persist cache:', error);
        }
      }
    },
    restoreClient: async () => {
      try {
        const cached = await storage.getItem(QUERY_CACHE_KEY);
        if (!cached) return undefined;

        const parsed = JSON.parse(cached);
        
        // Check version compatibility
        if (parsed.version !== QUERY_CACHE_VERSION) {
          // Clear old cache on version mismatch
          await storage.removeItem(QUERY_CACHE_KEY);
          return undefined;
        }

        // Check if cache is too old (30 days)
        const maxAge = 30 * 24 * 60 * 60 * 1000;
        if (parsed.timestamp && Date.now() - parsed.timestamp > maxAge) {
          await storage.removeItem(QUERY_CACHE_KEY);
          return undefined;
        }

        return parsed.clientState;
      } catch (error) {
        if (isDev()) {
          console.warn('[QueryClient] Failed to restore cache:', error);
        }
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await storage.removeItem(QUERY_CACHE_KEY);
      } catch (error) {
        if (isDev()) {
          console.warn('[QueryClient] Failed to remove cache:', error);
        }
      }
    },
  };
};

/**
 * Create a QueryClient with offline-first configuration.
 *
 * Mutations marked with `networkMode: 'offlineFirst'` are queued by TanStack
 * Query when offline (status "paused") and resumed automatically when
 * `onlineManager` transitions back to online. Network monitoring wiring lives
 * in `OxyProvider.tsx`.
 *
 * NOTE: This is in-memory queueing only. The queue does not survive an app
 * restart while offline — for cross-restart persistence add
 * `@tanstack/react-query-persist-client` with an async storage persister.
 */
export const createQueryClient = (_storage?: StorageInterface | null): QueryClient => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Data is fresh for 5 minutes
        staleTime: 5 * 60 * 1000,
        // Keep unused data in cache for 30 minutes
        gcTime: 30 * 60 * 1000,
        // Retry 3 times with exponential backoff
        retry: 3,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        // Refetch on reconnect
        refetchOnReconnect: true,
        // Don't refetch on window focus (better for mobile)
        refetchOnWindowFocus: false,
        // Offline-first: use cache when offline
        networkMode: 'offlineFirst',
      },
      mutations: {
        // Retry once for mutations
        retry: 1,
        // Offline-first: queue mutations when offline
        networkMode: 'offlineFirst',
      },
    },
  });

  // Defensive: explicitly resume paused mutations whenever the network
  // transitions back to online. TanStack Query does this internally too,
  // but wiring it here keeps the behaviour robust if a custom onlineManager
  // implementation is swapped in by the host app.
  const unsubscribe = onlineManager.subscribe((isOnline) => {
    if (isOnline) {
      void client.getMutationCache().resumePausedMutations();
    }
  });

  // Stash the unsubscribe so callers (tests) can clean up if they replace
  // the client. We attach via a typed extension instead of `as any`.
  Object.defineProperty(client, '__oxyOnlineUnsubscribe', {
    value: unsubscribe,
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return client;
};

/**
 * Clear persisted query cache
 */
export const clearQueryCache = async (storage: StorageInterface): Promise<void> => {
  const adapter = createPersistenceAdapter(storage);
  await adapter.removeClient();
};


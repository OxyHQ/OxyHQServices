import { QueryClient } from '@tanstack/react-query';
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
        if (__DEV__) {
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
        if (__DEV__) {
          console.warn('[QueryClient] Failed to restore cache:', error);
        }
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await storage.removeItem(QUERY_CACHE_KEY);
      } catch (error) {
        if (__DEV__) {
          console.warn('[QueryClient] Failed to remove cache:', error);
        }
      }
    },
  };
};

/**
 * Create a QueryClient with offline-first configuration
 */
export const createQueryClient = (storage?: StorageInterface | null): QueryClient => {
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

  // Note: Persistence is handled by TanStack Query's built-in persistence
  // For now, we rely on the query client's default behavior with networkMode: 'offlineFirst'
  // The cache will be available in memory and queries will use cached data when offline
  // Full persistence to AsyncStorage can be added later with @tanstack/react-query-persist-client if needed

  return client;
};

/**
 * Clear persisted query cache
 */
export const clearQueryCache = async (storage: StorageInterface): Promise<void> => {
  const adapter = createPersistenceAdapter(storage);
  await adapter.removeClient();
};


/**
 * Web QueryClient with offline-first defaults + localStorage persistence.
 *
 * Mirrors the persistence behaviour in `@oxyhq/services/queryClient` so
 * web auth apps (FedCM and redirect flows) survive a page reload with
 * cached identity + paused mutations intact.
 *
 * Persistence is opt-in via `attachQueryPersistence(...)` so SSR callers
 * (Next.js getServerSideProps, Vite SSR, tests) can create a stateless
 * client without touching `window`.
 */

import { QueryClient, type Mutation, type Query } from '@tanstack/react-query';
import {
  persistQueryClient,
  type PersistedClient,
} from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { StorageInterface } from '../utils/storageHelpers';

const QUERY_CACHE_KEY = 'oxy_auth_query_cache_v2';
const QUERY_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const QUERY_PERSIST_THROTTLE_MS = 1_000;

/**
 * Query-key prefixes whose data is safe to restore across reloads.
 * Web auth surfaces are session/profile heavy — lists and history are not
 * persisted to keep the localStorage footprint small.
 */
const PERSISTED_QUERY_PREFIXES: ReadonlyArray<string> = [
  'accounts',
  'users',
  'sessions',
  'auth',
];

function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false;
  const head = query.queryKey[0];
  return typeof head === 'string' && PERSISTED_QUERY_PREFIXES.includes(head);
}

function shouldDehydrateMutation(_mutation: Mutation): boolean {
  return true;
}

/**
 * Best-effort detection — works in browsers, Node SSR, and React Server
 * Components. `localStorage` is gated behind `window` because Node and edge
 * runtimes may polyfill `globalThis.localStorage` inconsistently.
 */
function getBrowserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Access blocked (Safari Private Mode, sandboxed iframe, etc.)
    return null;
  }
}

export const createPersistenceAdapter = (storage: StorageInterface) => ({
  persistClient: async (client: unknown): Promise<void> => {
    try {
      await storage.setItem(QUERY_CACHE_KEY, JSON.stringify(client));
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[QueryClient] Failed to persist cache', error);
      }
    }
  },
  restoreClient: async (): Promise<unknown> => {
    try {
      const cached = await storage.getItem(QUERY_CACHE_KEY);
      return cached ? JSON.parse(cached) : undefined;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[QueryClient] Failed to restore cache', error);
      }
      return undefined;
    }
  },
  removeClient: async (): Promise<void> => {
    try {
      await storage.removeItem(QUERY_CACHE_KEY);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[QueryClient] Failed to remove cache', error);
      }
    }
  },
});

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        networkMode: 'offlineFirst',
      },
      mutations: {
        retry: 1,
        networkMode: 'offlineFirst',
      },
    },
  });

export interface AttachPersistenceResult {
  restored: Promise<void>;
  unsubscribe: () => void;
}

/**
 * Wire `persistQueryClient` to browser `localStorage` (or a no-op when not
 * in a browser). Returns the restore promise so consumers can `await` it
 * before exposing the client to <Suspense> boundaries.
 */
export const attachQueryPersistence = (
  queryClient: QueryClient,
): AttachPersistenceResult => {
  const localStorage = getBrowserLocalStorage();
  if (!localStorage) {
    return { restored: Promise.resolve(), unsubscribe: () => {} };
  }

  const persister = createSyncStoragePersister({
    storage: localStorage,
    key: QUERY_CACHE_KEY,
    throttleTime: QUERY_PERSIST_THROTTLE_MS,
  });

  const [unsubscribe, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: QUERY_CACHE_MAX_AGE,
    dehydrateOptions: {
      shouldDehydrateQuery,
      shouldDehydrateMutation,
    },
  });

  restored.catch((error) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[QueryClient] Failed to restore persisted cache', error);
    }
  });

  return { unsubscribe, restored };
};

export const clearQueryCache = async (
  storage: StorageInterface,
): Promise<void> => {
  try {
    await storage.removeItem(QUERY_CACHE_KEY);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[QueryClient] Failed to remove cache', error);
    }
  }
};

export const clearBrowserQueryCache = async (
  queryClient: QueryClient,
): Promise<void> => {
  queryClient.clear();

  const localStorage = getBrowserLocalStorage();
  if (!localStorage) return;

  try {
    localStorage.removeItem(QUERY_CACHE_KEY);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[QueryClient] Failed to remove cache', error);
    }
  }
};

export type { PersistedClient };

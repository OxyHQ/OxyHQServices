/**
 * App-Data Query Hooks
 *
 * Read side of the `/users/me/app-data/...` per-user JSON KV store. Gated on
 * `isAuthenticated` — when signed out the query stays `enabled: false` and
 * `data` is `null`, so consumers can fall back to localStorage without ever
 * issuing a doomed request.
 *
 * Errors from the network (404 because the endpoint isn't deployed yet,
 * 401 because the session lapsed, etc.) are not user-facing here. Hooks
 * return `data: null` on error so the calling component renders the
 * "nothing yet" state and the consuming app can quietly fall back to local
 * persistence. Mutations still propagate errors so write attempts surface
 * a toast — only reads are silent.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { authenticatedApiCall } from '@oxyhq/core';
import { useWebOxy } from '../../WebOxyProvider';
import { appDataQueryKeys, isMissingAppDataEndpointError } from './appDataQueryKeys';

interface AppDataQueryOptions {
  /** Disable the query without unmounting the component. */
  enabled?: boolean;
  /** Override the default 1-minute stale time. */
  staleTime?: number;
  /** Override the default 30-minute gc time. */
  gcTime?: number;
}

/**
 * Read a single per-user JSON value.
 *
 * @param namespace - kebab/snake-case identifier (e.g. `"academy"`).
 * @param key       - kebab/snake-case identifier (e.g. course slug).
 * @param options   - optional `enabled`/`staleTime`/`gcTime` overrides.
 *
 * @returns A `useQuery` result with `data` of type `T | null`. The query
 *   stays disabled when the user is signed out; when enabled but the server
 *   has no stored value, `data` is `null`. Reads that fail because the
 *   endpoint isn't reachable also resolve to `null` so the consumer can
 *   fall back to local persistence.
 */
export const useAppData = <T = unknown>(
  namespace: string,
  key: string,
  options?: AppDataQueryOptions,
): UseQueryResult<T | null, Error> => {
  const { oxyServices, activeSessionId, isAuthenticated } = useWebOxy();

  return useQuery<T | null, Error>({
    queryKey: appDataQueryKeys.value(namespace, key),
    queryFn: async () => {
      try {
        return await authenticatedApiCall(oxyServices, activeSessionId, () =>
          oxyServices.getAppData<T>(namespace, key),
        );
      } catch (error) {
        // Endpoint not deployed yet, no network, etc. — return null so the
        // consumer falls back to localStorage rather than rendering a broken
        // UI state. Authentication errors still bubble up so the auth retry
        // pipeline can surface them at the provider level.
        if (isMissingAppDataEndpointError(error)) {
          return null;
        }
        throw error;
      }
    },
    enabled: (options?.enabled !== false) && isAuthenticated,
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.gcTime ?? 30 * 60 * 1000,
  });
};

/**
 * Read every value in a namespace.
 *
 * @returns A `useQuery` result with `data` as a `Record<string, T>`. Empty
 *   object when the namespace contains nothing (or when fetching failed).
 */
export const useAppDataNamespace = <T = unknown>(
  namespace: string,
  options?: AppDataQueryOptions,
): UseQueryResult<Record<string, T>, Error> => {
  const { oxyServices, activeSessionId, isAuthenticated } = useWebOxy();

  return useQuery<Record<string, T>, Error>({
    queryKey: appDataQueryKeys.namespace(namespace),
    queryFn: async () => {
      try {
        return await authenticatedApiCall(oxyServices, activeSessionId, () =>
          oxyServices.listAppData<T>(namespace),
        );
      } catch (error) {
        if (isMissingAppDataEndpointError(error)) {
          return {};
        }
        throw error;
      }
    },
    enabled: (options?.enabled !== false) && isAuthenticated,
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.gcTime ?? 30 * 60 * 1000,
  });
};

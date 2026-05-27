/**
 * App-Data Mutation Hooks
 *
 * Write side of the per-user JSON KV store. Both `useSetAppData` and
 * `useDeleteAppData` apply optimistic updates against the two query keys
 * that observe this data (`appDataQueryKeys.value` and the surrounding
 * `appDataQueryKeys.namespace`) and roll back on error.
 *
 * When the underlying request fails because the endpoint isn't reachable
 * (404 / network), the mutation still surfaces the error — write attempts
 * are user-initiated and the caller may want to retry or fall back to
 * local persistence. Reads are silent about missing endpoints; writes are
 * not.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authenticatedApiCall } from '@oxyhq/core';
import { useWebOxy } from '../../WebOxyProvider';
import { appDataQueryKeys } from '../queries/appDataQueryKeys';

interface SetAppDataVariables<T> {
  namespace: string;
  key: string;
  value: T;
}

interface SetAppDataContext<T> {
  previousValue: T | null | undefined;
  previousNamespace: Record<string, T> | undefined;
}

/**
 * Upsert a per-user JSON value. Returns the value the server confirmed it
 * stored — typically identical to the input but consumers should prefer the
 * returned value (the server is the source of truth).
 *
 * Applies optimistic updates against both the single-value query key and
 * the surrounding namespace query key, then rolls back on error.
 */
export const useSetAppData = <T = unknown>() => {
  const { oxyServices, activeSessionId } = useWebOxy();
  const queryClient = useQueryClient();

  return useMutation<T, Error, SetAppDataVariables<T>, SetAppDataContext<T>>({
    mutationKey: ['appData', 'set'],
    mutationFn: async ({ namespace, key, value }) => {
      return authenticatedApiCall(oxyServices, activeSessionId, () =>
        oxyServices.setAppData<T>(namespace, key, value),
      );
    },
    onMutate: async ({ namespace, key, value }) => {
      const valueKey = appDataQueryKeys.value(namespace, key);
      const namespaceKey = appDataQueryKeys.namespace(namespace);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: valueKey }),
        queryClient.cancelQueries({ queryKey: namespaceKey }),
      ]);

      const previousValue = queryClient.getQueryData<T | null>(valueKey);
      const previousNamespace = queryClient.getQueryData<Record<string, T>>(namespaceKey);

      queryClient.setQueryData<T | null>(valueKey, value);
      if (previousNamespace) {
        queryClient.setQueryData<Record<string, T>>(namespaceKey, {
          ...previousNamespace,
          [key]: value,
        });
      }

      return { previousValue, previousNamespace };
    },
    onError: (_error, { namespace, key }, context) => {
      if (!context) return;
      const valueKey = appDataQueryKeys.value(namespace, key);
      const namespaceKey = appDataQueryKeys.namespace(namespace);

      // Restore exactly the snapshots we captured in onMutate. Don't merge
      // with whatever's currently in the cache — that could splice in writes
      // from concurrent mutations and undo their state.
      queryClient.setQueryData(valueKey, context.previousValue ?? null);
      if (context.previousNamespace !== undefined) {
        queryClient.setQueryData(namespaceKey, context.previousNamespace);
      }
    },
    onSuccess: (data, { namespace, key }) => {
      const valueKey = appDataQueryKeys.value(namespace, key);
      const namespaceKey = appDataQueryKeys.namespace(namespace);

      queryClient.setQueryData(valueKey, data);
      const existingNamespace = queryClient.getQueryData<Record<string, T>>(namespaceKey);
      if (existingNamespace) {
        queryClient.setQueryData<Record<string, T>>(namespaceKey, {
          ...existingNamespace,
          [key]: data,
        });
      }
    },
  });
};

interface DeleteAppDataVariables {
  namespace: string;
  key: string;
}

interface DeleteAppDataContext<T> {
  previousValue: T | null | undefined;
  previousNamespace: Record<string, T> | undefined;
}

/**
 * Delete a per-user JSON value. Optimistically removes the entry from the
 * single-value cache and from the surrounding namespace map, then rolls back
 * on error.
 */
export const useDeleteAppData = <T = unknown>() => {
  const { oxyServices, activeSessionId } = useWebOxy();
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteAppDataVariables, DeleteAppDataContext<T>>({
    mutationKey: ['appData', 'delete'],
    mutationFn: async ({ namespace, key }) => {
      await authenticatedApiCall(oxyServices, activeSessionId, () =>
        oxyServices.deleteAppData(namespace, key),
      );
    },
    onMutate: async ({ namespace, key }) => {
      const valueKey = appDataQueryKeys.value(namespace, key);
      const namespaceKey = appDataQueryKeys.namespace(namespace);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: valueKey }),
        queryClient.cancelQueries({ queryKey: namespaceKey }),
      ]);

      const previousValue = queryClient.getQueryData<T | null>(valueKey);
      const previousNamespace = queryClient.getQueryData<Record<string, T>>(namespaceKey);

      queryClient.setQueryData<T | null>(valueKey, null);
      if (previousNamespace && key in previousNamespace) {
        const next: Record<string, T> = { ...previousNamespace };
        delete next[key];
        queryClient.setQueryData(namespaceKey, next);
      }

      return { previousValue, previousNamespace };
    },
    onError: (_error, { namespace, key }, context) => {
      if (!context) return;
      const valueKey = appDataQueryKeys.value(namespace, key);
      const namespaceKey = appDataQueryKeys.namespace(namespace);

      queryClient.setQueryData(valueKey, context.previousValue ?? null);
      if (context.previousNamespace !== undefined) {
        queryClient.setQueryData(namespaceKey, context.previousNamespace);
      }
    },
    onSuccess: (_data, { namespace, key }) => {
      queryClient.setQueryData(appDataQueryKeys.value(namespace, key), null);
      // Confirm the value is gone from the namespace cache too. If the
      // optimistic update wasn't applied (e.g. cache was empty), this is a
      // no-op; if it was, we already removed it in onMutate, so this is also
      // a no-op. The work happens in onMutate — onSuccess is the commit point.
    },
  });
};

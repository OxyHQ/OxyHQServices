/**
 * useMutationStatus
 *
 * Aggregates counts of in-flight, paused (offline), and errored mutations
 * from the TanStack Query mutation cache. Useful for showing a global
 * "Syncing..." indicator in the app shell.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type Mutation, type QueryClient } from '@tanstack/react-query';

export interface MutationStatus {
  /** Mutations currently running (status === 'pending', not paused). */
  pending: number;
  /** Mutations paused waiting for the network to come back. */
  paused: number;
  /** Mutations that failed and have not been retried. */
  erroring: number;
  /** Total of `pending + paused + erroring`. */
  total: number;
  /** True if any mutation is paused (i.e. waiting for connectivity). */
  isOffline: boolean;
  /** True if any work is in flight or pending sync. */
  isSyncing: boolean;
}

function computeStatus(queryClient: QueryClient): MutationStatus {
  const mutations: Mutation[] = queryClient.getMutationCache().getAll();
  let pending = 0;
  let paused = 0;
  let erroring = 0;

  for (const m of mutations) {
    const { status, isPaused } = m.state;
    if (isPaused) {
      paused += 1;
      continue;
    }
    if (status === 'pending') {
      pending += 1;
      continue;
    }
    if (status === 'error') {
      erroring += 1;
    }
  }

  const total = pending + paused + erroring;
  return {
    pending,
    paused,
    erroring,
    total,
    isOffline: paused > 0,
    isSyncing: pending > 0 || paused > 0,
  };
}

const EMPTY_SNAPSHOT: MutationStatus = {
  pending: 0,
  paused: 0,
  erroring: 0,
  total: 0,
  isOffline: false,
  isSyncing: false,
};

function snapshotsEqual(a: MutationStatus, b: MutationStatus): boolean {
  return (
    a.pending === b.pending &&
    a.paused === b.paused &&
    a.erroring === b.erroring &&
    a.total === b.total &&
    a.isOffline === b.isOffline &&
    a.isSyncing === b.isSyncing
  );
}

export function useMutationStatus(): MutationStatus {
  const queryClient = useQueryClient();

  // Cache the last returned snapshot so `useSyncExternalStore`'s tearing
  // check sees the same reference between renders unless the underlying
  // mutation cache actually changed. Without this React 19 enters an
  // infinite render loop because every call to `computeStatus` returns
  // a fresh object literal.
  const cachedRef = useRef<MutationStatus>(EMPTY_SNAPSHOT);

  const subscribe = useCallback(
    (notify: () => void): (() => void) => {
      const cache = queryClient.getMutationCache();
      return cache.subscribe(() => {
        notify();
      });
    },
    [queryClient],
  );

  const getSnapshot = useCallback((): MutationStatus => {
    const next = computeStatus(queryClient);
    if (snapshotsEqual(cachedRef.current, next)) {
      return cachedRef.current;
    }
    cachedRef.current = next;
    return next;
  }, [queryClient]);

  const getServerSnapshot = useCallback((): MutationStatus => EMPTY_SNAPSHOT, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

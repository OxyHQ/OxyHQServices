/**
 * useMutationStatus
 *
 * Aggregates counts of in-flight, paused (offline), and errored mutations
 * from the TanStack Query mutation cache. Useful for showing a global
 * "Syncing..." indicator in the app shell.
 */

import { useSyncExternalStore } from 'react';
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

export function useMutationStatus(): MutationStatus {
  const queryClient = useQueryClient();

  const subscribe = (notify: () => void): (() => void) => {
    const cache = queryClient.getMutationCache();
    return cache.subscribe(() => {
      notify();
    });
  };

  const getSnapshot = (): MutationStatus => computeStatus(queryClient);

  // SSR fallback — empty status.
  const getServerSnapshot = (): MutationStatus => ({
    pending: 0,
    paused: 0,
    erroring: 0,
    total: 0,
    isOffline: false,
    isSyncing: false,
  });

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

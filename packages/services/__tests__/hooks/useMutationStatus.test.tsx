/**
 * Tests for `useMutationStatus`.
 *
 * The aggregator powers the app shell's "Syncing…" indicator. It must
 * correctly distinguish between pending (active), paused (offline-queued),
 * and erroring (failed-and-not-retried) mutations because those map to
 * different UI affordances. A bug here can either misleadingly mark a
 * fully-synced state as syncing or hide a real offline backlog.
 */

import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMutationStatus } from '../../src/ui/hooks/useMutationStatus';

const makeWrapper = (queryClient: QueryClient) => {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('useMutationStatus', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('reports zeroes when no mutations are active', () => {
    const { result } = renderHook(() => useMutationStatus(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current).toEqual({
      pending: 0,
      paused: 0,
      erroring: 0,
      total: 0,
      isOffline: false,
      isSyncing: false,
    });
  });

  it('counts a pending mutation while it is in flight', async () => {
    const { result } = renderHook(() => useMutationStatus(), {
      wrapper: makeWrapper(queryClient),
    });

    let releaseMutation: () => void = () => undefined;
    const cache = queryClient.getMutationCache();
    const mutation = cache.build(queryClient, {
      mutationFn: () =>
        new Promise<void>((resolve) => {
          releaseMutation = resolve;
        }),
    });

    await act(async () => {
      mutation.execute(undefined).catch(() => undefined);
      await Promise.resolve();
    });

    expect(result.current.pending).toBe(1);
    expect(result.current.isSyncing).toBe(true);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.total).toBe(1);

    await act(async () => {
      releaseMutation();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.pending).toBe(0);
    expect(result.current.total).toBe(0);
  });

  it('counts an errored mutation as `erroring`', async () => {
    const { result } = renderHook(() => useMutationStatus(), {
      wrapper: makeWrapper(queryClient),
    });

    const cache = queryClient.getMutationCache();
    const mutation = cache.build(queryClient, {
      mutationFn: () => Promise.reject(new Error('boom')),
    });

    await act(async () => {
      await mutation.execute(undefined).catch(() => undefined);
    });

    expect(result.current.erroring).toBe(1);
    expect(result.current.pending).toBe(0);
    expect(result.current.paused).toBe(0);
    expect(result.current.total).toBe(1);
    expect(result.current.isSyncing).toBe(false);
  });

  it('counts a paused (offline) mutation as `paused`', async () => {
    const { result } = renderHook(() => useMutationStatus(), {
      wrapper: makeWrapper(queryClient),
    });

    // Directly mutate the state and notify the cache so the hook recomputes.
    // Mutation instances expose `state` as a public field per query-core types,
    // and the cache subscriber fires on `cache.notify`. This is the standard
    // way to simulate a paused (offline-queued) mutation without spinning up
    // a real network-mode offline flow.
    const cache = queryClient.getMutationCache();
    const mutation = cache.build(queryClient, {
      mutationFn: () => Promise.resolve('ok'),
    });

    await act(async () => {
      mutation.state = {
        ...mutation.state,
        isPaused: true,
        status: 'pending',
      };
      cache.notify({ type: 'updated', mutation, action: { type: 'pause' } });
      await Promise.resolve();
    });

    expect(result.current.paused).toBe(1);
    expect(result.current.pending).toBe(0);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.isSyncing).toBe(true);
  });
});

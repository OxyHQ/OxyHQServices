/**
 * React Query wrapper around a user's reputation balance, plus the derived
 * "by source" view the civic reputation screen renders.
 *
 * `oxyServices.getReputationBalance(userId)` returns the canonical balance
 * (total, per-category breakdown, trust tier, influence, reliability). The
 * source split (Real life / Peer-civic / Apps / Penalties) is derived
 * client-side from `breakdown` via `deriveReputationSources` — the schema is not
 * changed. Offline-first by the same `civic`-namespaced React Query mechanism as
 * `useCivicCard`.
 */

import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type { ReputationBalance } from '@oxyhq/core';
import {
  deriveReputationSources,
  type ReputationSource,
} from '@/lib/civic/reputation-sources';

const BALANCE_STALE_TIME_MS = 5 * 60 * 1000;
const BALANCE_GC_TIME_MS = 24 * 60 * 60 * 1000;

/**
 * Query a user's reputation balance.
 *
 * @param userId - The subject account's id, or `null` (query disabled).
 */
export function useCivicReputation(
  userId: string | null,
): UseQueryResult<ReputationBalance> {
  const { oxyServices } = useOxy();

  return useQuery<ReputationBalance>({
    queryKey: ['civic', 'reputation', userId],
    queryFn: () => {
      if (!oxyServices) {
        throw new Error('OxyServices not initialized');
      }
      if (!userId) {
        throw new Error('No user id to resolve a balance for');
      }
      return oxyServices.getReputationBalance(userId);
    },
    enabled: Boolean(oxyServices) && Boolean(userId),
    staleTime: BALANCE_STALE_TIME_MS,
    gcTime: BALANCE_GC_TIME_MS,
  });
}

/**
 * The four ordered civic reputation sources derived from a balance, or `null`
 * until a balance has resolved. Memoized so the screen's list identity is
 * stable across re-renders.
 */
export function useReputationSources(
  balance: ReputationBalance | undefined,
): ReputationSource[] | null {
  return useMemo(
    () => (balance ? deriveReputationSources(balance.breakdown) : null),
    [balance],
  );
}

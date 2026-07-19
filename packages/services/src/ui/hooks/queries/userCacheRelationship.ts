import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import type { CacheableUser } from './userCache';

type CachedUser = CacheableUser & { id: string };

/**
 * Patch `relationship.isFollowing` on every cached single-profile entry for
 * `targetUserId` (by-id and viewer-scoped by-username keys) after a follow
 * toggle. Lives outside `userCache.ts` so hooks like `useFollow` can import it
 * without pulling the auth store (which `userCache` uses for viewer defaults).
 */
export function patchCachedUserRelationship(
  queryClient: QueryClient,
  targetUserId: string,
  isFollowing: boolean,
): void {
  queryClient.setQueriesData<CachedUser>(
    { queryKey: queryKeys.users.details() },
    (existing) => {
      if (!existing || existing.id !== targetUserId) return existing;
      return {
        ...existing,
        relationship: { ...existing.relationship, isFollowing },
      };
    },
  );
}

/**
 * Regression: useFollow multi-user mode must NOT enter an infinite render loop.
 *
 * The multi-user subscription previously returned a 2-level-nested `followData`
 * object through `useShallow`, whose one-level shallow compare always reported
 * inequality (freshly allocated per-user objects). That made
 * `useSyncExternalStore` resubscribe on every commit and loop until React threw
 * "Maximum update depth exceeded", which the app ErrorBoundary surfaced as a
 * render crash. It only fired once `userIds` was non-empty (populated map), i.e.
 * exactly the production `[] -> populated` transition the multi-mode
 * FollowButton drives. This test fails (throws) against the old selector and
 * passes with the flat-snapshot fix.
 */
import { renderHook, act } from '@testing-library/react';

const oxyServicesStub = {
  getFollowStatus: jest.fn(async () => ({ isFollowing: false })),
  getUserById: jest.fn(async () => ({ _count: { followers: 1, following: 2 } })),
  followUser: jest.fn(async () => ({})),
  unfollowUser: jest.fn(async () => ({})),
  followUsers: jest.fn(async (ids: string[]) => ({
    followedCount: ids.length,
    results: ids.map((id) => ({ userId: id, success: true, alreadyFollowing: false })),
  })),
  getCurrentUserId: jest.fn(() => 'me'),
};

let ctx = {
  oxyServices: oxyServicesStub,
  canUsePrivateApi: false,
  user: { id: 'me' },
};

jest.mock('../../src/ui/context/OxyContext', () => ({
  useOxy: () => ctx,
}));

jest.mock('@oxyhq/core', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { useFollow } from '../../src/ui/hooks/useFollow';
import { useFollowStore } from '../../src/ui/stores/followStore';

describe('useFollow multi-user mode — no infinite render loop', () => {
  beforeEach(() => {
    useFollowStore.getState().resetFollowState();
    ctx = { oxyServices: oxyServicesStub, canUsePrivateApi: false, user: { id: 'me' } };
  });

  it('survives userIds [] -> populated with canUsePrivateApi false -> true', () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useFollow(ids),
      { initialProps: { ids: [] as string[] } },
    );

    expect('followAllUsers' in result.current).toBe(true);

    act(() => {
      ctx = { ...ctx, canUsePrivateApi: true };
    });
    rerender({ ids: [] });
    expect('followAllUsers' in result.current).toBe(true);

    // The transition that used to loop forever:
    rerender({ ids: ['u1', 'u2', 'u3'] });
    expect('followAllUsers' in result.current).toBe(true);
    expect('isAnyLoading' in result.current).toBe(true);

    // Store churn from per-member buttons writing status while multi is mounted.
    act(() => {
      useFollowStore.getState().setFollowingStatus('u1', true);
      useFollowStore.getState().setFollowingStatus('u2', false);
    });
    rerender({ ids: ['u1', 'u2', 'u3'] });
    expect('followAllUsers' in result.current).toBe(true);
  });

  it('exposes a structurally correct followData map for multi mode', () => {
    const { result } = renderHook(() => useFollow(['u1', 'u2']));
    const multi = result.current;
    if ('followData' in multi) {
      expect(multi.followData.u1).toEqual({ isFollowing: false, isLoading: false, error: null });
      expect(multi.followData.u2).toEqual({ isFollowing: false, isLoading: false, error: null });
    } else {
      throw new Error('expected multi-user shape with followData');
    }
  });
});

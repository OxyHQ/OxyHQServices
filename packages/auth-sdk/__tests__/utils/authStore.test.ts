/**
 * Tests for `useAuthStore` (auth-sdk).
 *
 * The store is the source of truth for auth state on the web side and
 * has a 5-minute fetchUser cache. These tests pin the cache contract:
 * a stale store user gets refetched, a fresh one short-circuits.
 */

import type { User } from '@oxyhq/core';
import { useAuthStore } from '../../src/stores/authStore';

const sampleUser: User = {
  id: 'u1',
  username: 'alice',
  privacySettings: {},
} as User;

describe('useAuthStore actions', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      lastUserFetch: null,
    });
  });

  it('loginSuccess populates user, marks authenticated, and stamps lastUserFetch', () => {
    const before = Date.now();
    useAuthStore.getState().loginSuccess(sampleUser);
    const state = useAuthStore.getState();
    expect(state.user).toEqual(sampleUser);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isLoading).toBe(false);
    expect(state.lastUserFetch).not.toBeNull();
    expect((state.lastUserFetch ?? 0)).toBeGreaterThanOrEqual(before);
  });

  it('loginFailure clears loading and surfaces the error message', () => {
    useAuthStore.setState({ isLoading: true });
    useAuthStore.getState().loginFailure('bad password');
    const state = useAuthStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe('bad password');
  });

  it('logout wipes user, isAuthenticated, and lastUserFetch', () => {
    useAuthStore.getState().loginSuccess(sampleUser);
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.lastUserFetch).toBeNull();
  });

  it('setUser updates user and stamps lastUserFetch', () => {
    const before = Date.now();
    useAuthStore.getState().setUser(sampleUser);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
    expect((useAuthStore.getState().lastUserFetch ?? 0)).toBeGreaterThanOrEqual(before);
  });
});

describe('useAuthStore.fetchUser caching', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      lastUserFetch: null,
    });
  });

  it('fetches user when cache is empty', async () => {
    const getCurrentUser = jest.fn().mockResolvedValue(sampleUser);
    await useAuthStore.getState().fetchUser({ getCurrentUser });
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('short-circuits when cache is fresh (<5 min) and not forced', async () => {
    useAuthStore.setState({
      user: sampleUser,
      lastUserFetch: Date.now() - 60 * 1000, // 1 minute ago, well within 5
    });
    const getCurrentUser = jest.fn();
    await useAuthStore.getState().fetchUser({ getCurrentUser });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('refetches when cache is older than 5 minutes', async () => {
    useAuthStore.setState({
      user: sampleUser,
      lastUserFetch: Date.now() - 10 * 60 * 1000, // 10 minutes ago
    });
    const newUser: User = { ...sampleUser, username: 'bob' } as User;
    const getCurrentUser = jest.fn().mockResolvedValue(newUser);
    await useAuthStore.getState().fetchUser({ getCurrentUser });
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user?.username).toBe('bob');
  });

  it('refetches when forceRefresh=true regardless of cache age', async () => {
    useAuthStore.setState({
      user: sampleUser,
      lastUserFetch: Date.now(),
    });
    const getCurrentUser = jest.fn().mockResolvedValue(sampleUser);
    await useAuthStore.getState().fetchUser({ getCurrentUser }, true);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('captures error messages from rejected getCurrentUser', async () => {
    const getCurrentUser = jest.fn().mockRejectedValue(new Error('network down'));
    await useAuthStore.getState().fetchUser({ getCurrentUser });
    expect(useAuthStore.getState().isLoading).toBe(false);
    expect(useAuthStore.getState().error).toBe('network down');
    expect(useAuthStore.getState().user).toBeNull();
  });
});

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';

const hasIdentityMock = jest.fn<Promise<boolean>, []>();

// Mock KeyManager.hasIdentity surgically. Everything else from @oxyhq/core
// passes through to the real built module so types remain consistent.
jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    ...actual,
    KeyManager: {
      ...actual.KeyManager,
      hasIdentity: () => hasIdentityMock(),
    },
  };
});

// Imported AFTER jest.mock so the hook sees the patched KeyManager.
// eslint-disable-next-line import/first
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

// The hook now reads the shared identity probe via React Query, so each render
// needs its own QueryClient. A fresh client per render keeps the
// `staleTime: Infinity` cache from leaking across test cases.
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useOnboardingStatus', () => {
  beforeEach(() => {
    __resetOxyState();
    hasIdentityMock.mockReset();
    Platform.OS = 'ios';
  });

  it('reports status "none" when no identity exists', async () => {
    hasIdentityMock.mockResolvedValue(false);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.hasIdentity).toBe(false);
    expect(result.current.hasUsername).toBe(false);
  });

  it('reports status "in_progress" when identity exists but user is not authenticated', async () => {
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: false, user: null });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.hasIdentity).toBe(true);
  });

  it('reports status "complete" when identity exists, user is authenticated, and has username', async () => {
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: true, user: { username: 'alice' } });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });
    expect(result.current.hasUsername).toBe(true);
  });

  it('reports status "in_progress" when authenticated but username is missing', async () => {
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: true, user: {} });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.hasUsername).toBe(false);
  });

  it('needsAuth is true on native when status is "none"', async () => {
    Platform.OS = 'ios';
    hasIdentityMock.mockResolvedValue(false);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.needsAuth).toBe(true);
  });

  it('needsAuth is true on native when status is "in_progress"', async () => {
    Platform.OS = 'ios';
    hasIdentityMock.mockResolvedValue(true);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.needsAuth).toBe(true);
  });

  it('needsAuth is false on native when status is "complete"', async () => {
    Platform.OS = 'ios';
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: true, user: { username: 'alice' } });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });
    expect(result.current.needsAuth).toBe(false);
  });

  it('needsAuth is true on web when no session resolves (status "none")', async () => {
    // Regression guard: web previously hard-clamped needsAuth to false, which
    // routed unauthenticated visitors into (tabs). The (tabs) layout then
    // redirected them back to (auth), and the two guards deadlocked into a
    // blank screen. Web must follow the same status-driven gate as native so a
    // fresh visitor lands on the welcome/auth stack instead of an infinite
    // redirect loop.
    Platform.OS = 'web';
    hasIdentityMock.mockResolvedValue(false);
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.needsAuth).toBe(true);
  });

  it('needsAuth is false on web once a session is authenticated (status "complete")', async () => {
    // Once the device-first cold boot restores a session, the authenticated web
    // user must be able to reach (tabs) — needsAuth flips to false exactly as on
    // native.
    Platform.OS = 'web';
    hasIdentityMock.mockResolvedValue(false);
    __setOxyState({ isAuthenticated: true, user: { username: 'alice' } });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });
    expect(result.current.needsAuth).toBe(false);
  });

  it('treats a KeyManager error as "no identity"', async () => {
    hasIdentityMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.hasIdentity).toBe(false);
  });

  it('starts in "checking" state then transitions once oxy finishes loading', async () => {
    hasIdentityMock.mockResolvedValue(false);
    __setOxyState({ isLoading: true });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('checking');

    await act(async () => {
      __setOxyState({ isLoading: false });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
  });

  it('stays "checking" while the device-first cold boot is unresolved', async () => {
    // Regression guard for the cold-boot flash: while `isAuthResolved` is false
    // the SDK's device-first session mint has not concluded, so we cannot yet
    // know whether a returning user's persisted session will restore. The hook
    // must stay in the neutral "checking" state (not fall through to
    // "in_progress" and bounce the user through create-identity) even after the
    // local identity lookup resolves.
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthResolved: false, isAuthenticated: false, user: null });
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(hasIdentityMock).toHaveBeenCalled();
    });
    expect(result.current.status).toBe('checking');
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      __setOxyState({ isAuthResolved: true });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.isLoading).toBe(false);
  });
});

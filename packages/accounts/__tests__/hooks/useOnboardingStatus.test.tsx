import { act, renderHook, waitFor } from '@testing-library/react';
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

describe('useOnboardingStatus', () => {
  beforeEach(() => {
    __resetOxyState();
    hasIdentityMock.mockReset();
    Platform.OS = 'ios';
  });

  it('reports status "none" when no identity exists', async () => {
    hasIdentityMock.mockResolvedValue(false);
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.hasIdentity).toBe(false);
    expect(result.current.hasUsername).toBe(false);
  });

  it('reports status "in_progress" when identity exists but user is not authenticated', async () => {
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: false, user: null });
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.hasIdentity).toBe(true);
  });

  it('reports status "complete" when identity exists, user is authenticated, and has username', async () => {
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: true, user: { username: 'alice' } });
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });
    expect(result.current.hasUsername).toBe(true);
  });

  it('reports status "in_progress" when authenticated but username is missing', async () => {
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: true, user: {} });
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.hasUsername).toBe(false);
  });

  it('needsAuth is true on native when status is "none"', async () => {
    Platform.OS = 'ios';
    hasIdentityMock.mockResolvedValue(false);
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.needsAuth).toBe(true);
  });

  it('needsAuth is true on native when status is "in_progress"', async () => {
    Platform.OS = 'ios';
    hasIdentityMock.mockResolvedValue(true);
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('in_progress');
    });
    expect(result.current.needsAuth).toBe(true);
  });

  it('needsAuth is false on native when status is "complete"', async () => {
    Platform.OS = 'ios';
    hasIdentityMock.mockResolvedValue(true);
    __setOxyState({ isAuthenticated: true, user: { username: 'alice' } });
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('complete');
    });
    expect(result.current.needsAuth).toBe(false);
  });

  it('needsAuth is always false on web regardless of status', async () => {
    Platform.OS = 'web';
    hasIdentityMock.mockResolvedValue(false);
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.needsAuth).toBe(false);
  });

  it('treats a KeyManager error as "no identity"', async () => {
    hasIdentityMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useOnboardingStatus());
    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
    expect(result.current.hasIdentity).toBe(false);
  });

  it('starts in "checking" state then transitions once oxy finishes loading', async () => {
    hasIdentityMock.mockResolvedValue(false);
    __setOxyState({ isLoading: true });
    const { result } = renderHook(() => useOnboardingStatus());
    expect(result.current.status).toBe('checking');

    await act(async () => {
      __setOxyState({ isLoading: false });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });
  });
});

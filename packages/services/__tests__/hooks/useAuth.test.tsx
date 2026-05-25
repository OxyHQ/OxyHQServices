/**
 * Tests for the high-level `useAuth` hook.
 *
 * The hook routes a single `signIn(publicKey?)` call across three
 * different code paths depending on platform and arguments:
 *   1. Web (no publicKey, not on IdP) → opens popup, awaits session,
 *      calls handlePopupSession.
 *   2. Native (publicKey given OR identity stored) → calls into
 *      `oxySignIn(publicKey)` directly.
 *   3. Native with no identity → opens auth bottom sheet OR navigates
 *      to the login page on web fallback.
 *
 * Each branch is regression-tested because a mistake here either
 * silently sends users to the wrong screen, leaks the popup URL into
 * the SPA, or fails to surface "popup blocked" UX guidance.
 */

import { act, renderHook } from '@testing-library/react';

interface MockOxyState {
  user: { id: string; username: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  error: string | null;
  signIn: jest.Mock;
  handlePopupSession: jest.Mock;
  logout: jest.Mock;
  logoutAll: jest.Mock;
  refreshSessions: jest.Mock;
  oxyServices: {
    config?: { authWebUrl?: string };
    signInWithPopup?: jest.Mock;
  };
  hasIdentity: jest.Mock;
  getPublicKey: jest.Mock;
  showBottomSheet: jest.Mock;
  openAvatarPicker: jest.Mock;
}

const defaultMockState = (): MockOxyState => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isTokenReady: false,
  error: null,
  signIn: jest.fn(async (key: string) => ({ id: 'u1', username: 'native-user', publicKey: key })),
  handlePopupSession: jest.fn(async () => undefined),
  logout: jest.fn(async () => undefined),
  logoutAll: jest.fn(async () => undefined),
  refreshSessions: jest.fn(async () => undefined),
  oxyServices: {
    config: { authWebUrl: 'https://auth.oxy.so' },
    signInWithPopup: jest.fn(async () => ({
      sessionId: 'sess-1',
      deviceId: 'dev-1',
      expiresAt: '2030-01-01',
      user: { id: 'popup-user', username: 'alice' },
    })),
  },
  hasIdentity: jest.fn(async () => false),
  getPublicKey: jest.fn(async () => null),
  showBottomSheet: jest.fn(),
  openAvatarPicker: jest.fn(),
});

let mockState: MockOxyState = defaultMockState();

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => mockState,
}));

// The jsdom default URL (about:blank / localhost) is intentionally NOT the
// IdP host (auth.oxy.so), so the popup-based branch is exercised by default.
// The IdP-host branch lives in a sibling test file (useAuth.idp.test.tsx)
// whose docblock sets `window.location.href` at jsdom-instantiation time.
import { useAuth } from '../../src/ui/hooks/useAuth';

describe('useAuth — state passthrough', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('passes user, isAuthenticated, isLoading, isReady, and error through', () => {
    mockState.user = { id: 'u1', username: 'alice' };
    mockState.isAuthenticated = true;
    mockState.isLoading = false;
    mockState.isTokenReady = true;
    mockState.error = null;

    const { result } = renderHook(() => useAuth());
    expect(result.current.user).toEqual({ id: 'u1', username: 'alice' });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('forwards isTokenReady as `isReady`', () => {
    mockState.isTokenReady = true;
    const { result } = renderHook(() => useAuth());
    expect(result.current.isReady).toBe(true);

    mockState = { ...mockState, isTokenReady: false };
    const { result: result2 } = renderHook(() => useAuth());
    expect(result2.current.isReady).toBe(false);
  });
});

describe('useAuth.signIn — web popup path', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('opens the popup and forwards the returned user', async () => {
    const { result } = renderHook(() => useAuth());

    let returned: { id: string; username: string } | undefined;
    await act(async () => {
      returned = (await result.current.signIn()) as { id: string; username: string };
    });

    expect(mockState.oxyServices.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mockState.handlePopupSession).toHaveBeenCalledTimes(1);
    expect(returned).toEqual(expect.objectContaining({ id: 'popup-user' }));
  });

  it('surfaces a popup-blocked error with the friendlier message', async () => {
    mockState.oxyServices.signInWithPopup = jest.fn(async () => {
      throw new Error('popup was blocked by browser');
    });

    const { result } = renderHook(() => useAuth());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.signIn();
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as Error).message).toMatch(/Popup blocked\. Please allow popups/);
  });

  it('rethrows non-popup errors verbatim', async () => {
    mockState.oxyServices.signInWithPopup = jest.fn(async () => {
      throw new Error('user denied');
    });

    const { result } = renderHook(() => useAuth());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.signIn();
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as Error).message).toBe('user denied');
  });

  it('throws a helpful error when signInWithPopup resolves with no user', async () => {
    mockState.oxyServices.signInWithPopup = jest.fn(async () => undefined);

    const { result } = renderHook(() => useAuth());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.signIn();
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as Error).message).toMatch(/Sign-in failed/);
  });
});

describe('useAuth.signIn — native key-based path', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('calls signIn with the provided publicKey when one is passed', async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn('explicit-pubkey');
    });

    expect(mockState.signIn).toHaveBeenCalledWith('explicit-pubkey');
    // Popup was bypassed
    expect(mockState.oxyServices.signInWithPopup).not.toHaveBeenCalled();
  });
});

// IdP-host-specific behavior is tested in `useAuth.idp.test.tsx` because the
// jest-environment-options docblock that sets `window.location` to
// `https://auth.oxy.so/` must apply at file scope (jsdom's window.location
// is non-configurable at runtime).

describe('useAuth.signOut / signOutAll / refresh', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('delegates signOut to context.logout', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signOut();
    });
    expect(mockState.logout).toHaveBeenCalledTimes(1);
  });

  it('delegates signOutAll to context.logoutAll', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.signOutAll();
    });
    expect(mockState.logoutAll).toHaveBeenCalledTimes(1);
  });

  it('delegates refresh to context.refreshSessions', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockState.refreshSessions).toHaveBeenCalledTimes(1);
  });
});

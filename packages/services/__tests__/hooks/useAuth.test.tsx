/**
 * Tests for the high-level `useAuth` hook.
 *
 * The public web sign-in path is redirect-based. Silent SSO/FedCM is handled
 * during cold boot; an explicit user click sends the browser to the IdP.
 */

import { act, renderHook } from '@testing-library/react';

interface MockOxyState {
  user: { id: string; username: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  isAuthResolved: boolean;
  error: string | null;
  signIn: jest.Mock;
  logout: jest.Mock;
  logoutAll: jest.Mock;
  refreshSessions: jest.Mock;
  oxyServices: {
    config?: { authWebUrl?: string };
    signInWithRedirect?: jest.Mock;
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
  isAuthResolved: false,
  error: null,
  signIn: jest.fn(async (key: string) => ({ id: 'u1', username: 'native-user', publicKey: key })),
  logout: jest.fn(async () => undefined),
  logoutAll: jest.fn(async () => undefined),
  refreshSessions: jest.fn(async () => undefined),
  oxyServices: {
    config: { authWebUrl: 'https://auth.oxy.so' },
    signInWithRedirect: jest.fn(),
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

import { useAuth } from '../../src/ui/hooks/useAuth';

describe('useAuth — state passthrough', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('passes auth state through', () => {
    mockState.user = { id: 'u1', username: 'alice' };
    mockState.isAuthenticated = true;
    mockState.isLoading = false;
    mockState.isTokenReady = true;
    mockState.isAuthResolved = true;

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toEqual({ id: 'u1', username: 'alice' });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(true);
    expect(result.current.isAuthResolved).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

describe('useAuth.signIn — web redirect path', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('redirects to the IdP instead of using a popup', async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      void result.current.signIn();
    });

    expect(mockState.oxyServices.signInWithRedirect).toHaveBeenCalledWith({
      redirectUri: window.location.href,
    });
    expect(mockState.signIn).not.toHaveBeenCalled();
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
    expect(mockState.oxyServices.signInWithRedirect).not.toHaveBeenCalled();
  });
});

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

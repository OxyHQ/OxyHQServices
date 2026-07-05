/**
 * Tests for the high-level `useAuth` hook.
 *
 * The public web sign-in path opens the in-app "Sign in with Oxy" modal — there
 * is NO automatic navigation to any login page. Cross-domain restore is handled
 * during the device-first cold boot; an explicit user click just presents the
 * SDK sign-in surface (password / QR device flow / add account). Native with a
 * public key still signs in with the cryptographic identity directly.
 */

import { act, renderHook } from '@testing-library/react';

const showSignInModal = jest.fn();
jest.mock('../../src/ui/components/SignInModal', () => ({
  __esModule: true,
  showSignInModal: () => showSignInModal(),
}));

interface MockOxyState {
  user: { id: string; username: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  hasAccessToken: boolean;
  canUsePrivateApi: boolean;
  isPrivateApiPending: boolean;
  isAuthResolved: boolean;
  error: string | null;
  signIn: jest.Mock;
  logout: jest.Mock;
  logoutAll: jest.Mock;
  refreshSessions: jest.Mock;
  oxyServices: Record<string, unknown>;
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
  hasAccessToken: false,
  canUsePrivateApi: false,
  isPrivateApiPending: true,
  isAuthResolved: false,
  error: null,
  signIn: jest.fn(async (key: string) => ({ id: 'u1', username: 'native-user', publicKey: key })),
  logout: jest.fn(async () => undefined),
  logoutAll: jest.fn(async () => undefined),
  refreshSessions: jest.fn(async () => undefined),
  oxyServices: {},
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
    showSignInModal.mockClear();
  });

  it('passes auth state through', () => {
    mockState.user = { id: 'u1', username: 'alice' };
    mockState.isAuthenticated = true;
    mockState.isLoading = false;
    mockState.isTokenReady = true;
    mockState.hasAccessToken = true;
    mockState.canUsePrivateApi = true;
    mockState.isPrivateApiPending = false;
    mockState.isAuthResolved = true;

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toEqual({ id: 'u1', username: 'alice' });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(true);
    expect(result.current.hasAccessToken).toBe(true);
    expect(result.current.canUsePrivateApi).toBe(true);
    expect(result.current.isPrivateApiPending).toBe(false);
    expect(result.current.isAuthResolved).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

describe('useAuth.signIn — web modal path', () => {
  beforeEach(() => {
    mockState = defaultMockState();
    showSignInModal.mockClear();
  });

  it('opens the in-app sign-in modal instead of navigating to a login page', async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      // The web path returns a never-resolving promise (the caller reacts to
      // `isAuthenticated`), so fire-and-forget it.
      void result.current.signIn();
      await Promise.resolve();
    });

    expect(showSignInModal).toHaveBeenCalledTimes(1);
    // No key-based sign-in, no redirect helper.
    expect(mockState.signIn).not.toHaveBeenCalled();
  });
});

describe('useAuth.signIn — native key-based path', () => {
  beforeEach(() => {
    mockState = defaultMockState();
    showSignInModal.mockClear();
  });

  it('calls signIn with the provided publicKey when one is passed', async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn('explicit-pubkey');
    });

    expect(mockState.signIn).toHaveBeenCalledWith('explicit-pubkey');
    expect(showSignInModal).not.toHaveBeenCalled();
  });
});

describe('useAuth.signOut / signOutAll / refresh', () => {
  beforeEach(() => {
    mockState = defaultMockState();
    showSignInModal.mockClear();
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

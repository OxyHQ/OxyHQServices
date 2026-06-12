/**
 * @jest-environment-options {"url": "https://auth.oxy.so/"}
 *
 * Tests for `useAuth.signIn` behavior on the identity-provider host.
 *
 * On the IdP host, the popup branch is intentionally skipped (it would
 * authenticate against itself). The hook must instead either:
 *   - Sign in directly with the stored identity, OR
 *   - Open the OxyAuth bottom sheet when no identity exists.
 *
 * jsdom's `window.location` is non-configurable at runtime, so this
 * file pins the host via the `@jest-environment-options` docblock.
 */

import { act, renderHook } from '@testing-library/react';

interface MockOxyState {
  user: null;
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
    openBlankPopup?: jest.Mock;
  };
  hasIdentity: jest.Mock;
  getPublicKey: jest.Mock;
  showBottomSheet: jest.Mock | undefined;
  openAvatarPicker: jest.Mock;
}

const defaultMockState = (): MockOxyState => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isTokenReady: false,
  error: null,
  signIn: jest.fn(async (key: string) => ({ id: 'u1', username: 'user', publicKey: key })),
  handlePopupSession: jest.fn(async () => undefined),
  logout: jest.fn(async () => undefined),
  logoutAll: jest.fn(async () => undefined),
  refreshSessions: jest.fn(async () => undefined),
  oxyServices: {
    config: { authWebUrl: 'https://auth.oxy.so' },
    signInWithPopup: jest.fn(),
    openBlankPopup: jest.fn(() => null),
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

describe('useAuth.signIn — IdP hostname guard', () => {
  beforeEach(() => {
    mockState = defaultMockState();
  });

  it('confirms the test runs against the IdP host', () => {
    expect(window.location.hostname).toBe('auth.oxy.so');
  });

  it('skips popup and calls signIn() with the stored identity', async () => {
    mockState.hasIdentity = jest.fn(async () => true);
    mockState.getPublicKey = jest.fn(async () => 'stored-pubkey');

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn();
    });

    expect(mockState.oxyServices.signInWithPopup).not.toHaveBeenCalled();
    expect(mockState.signIn).toHaveBeenCalledWith('stored-pubkey');
  });

  it('with no stored identity, shows the OxyAuth bottom sheet', async () => {
    mockState.hasIdentity = jest.fn(async () => false);
    mockState.showBottomSheet = jest.fn();

    const { result } = renderHook(() => useAuth());

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.signIn();
      } catch (error) {
        caught = error;
      }
    });

    expect(mockState.showBottomSheet).toHaveBeenCalledWith('OxyAuth');
    expect((caught as Error).message).toMatch(/complete sign-in/);
    expect(mockState.oxyServices.signInWithPopup).not.toHaveBeenCalled();
  });

  it('does not invoke popup even when explicit publicKey is omitted', async () => {
    mockState.hasIdentity = jest.fn(async () => true);
    mockState.getPublicKey = jest.fn(async () => 'stored-pubkey');

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn();
    });

    expect(mockState.oxyServices.signInWithPopup).not.toHaveBeenCalled();
  });
});

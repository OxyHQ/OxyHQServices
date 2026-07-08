/**
 * `OxySignInButton` — the public "Sign in with Oxy" button.
 *
 * These tests cover the Fase 4 fork: on press the button resolves the requesting
 * Application (via `oxyServices.getPublicApplication(clientId)`) and routes by
 * type — an official / first-party app opens the in-app account dialog, a
 * `third_party` app starts an OAuth 2.0 + PKCE redirect to `auth.oxy.so`. The
 * cross-platform PKCE/URL helpers are the REAL `@oxyhq/core` implementations so
 * the asserted authorize URL is the one an RP actually receives.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Platform } from 'react-native';
import { logger } from '@oxyhq/core';
import type { PublicApplication } from '@oxyhq/core';
import { redirectToAuthorize, openAuthorizeUrlNative } from '../../src/ui/components/oauthNavigation';
import OxySignInButton, {
  OXY_OAUTH_STATE_STORAGE_KEY,
  OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY,
} from '../../src/ui/components/OxySignInButton';

const makeApp = (over: Partial<PublicApplication>): PublicApplication => ({
  id: 'app-1',
  name: 'Test App',
  type: 'first_party',
  isOfficial: false,
  isInternal: false,
  scopes: ['openid', 'profile'],
  ...over,
});

const openAccountDialog = jest.fn();
const getPublicApplication = jest.fn<Promise<PublicApplication>, [string]>();
let clientId: string | null = 'oxy_dk_test';

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({ openAccountDialog, oxyServices: { getPublicApplication }, clientId }),
}));

jest.mock('../../src/ui/stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { isAuthenticated: boolean; isLoading: boolean }) => unknown) =>
    selector({ isAuthenticated: false, isLoading: false }),
}));

jest.mock('zustand/react/shallow', () => ({
  __esModule: true,
  useShallow: (fn: unknown) => fn,
}));

jest.mock('../../src/ui/navigation/accountDialogManager', () => ({
  __esModule: true,
  subscribeToSignInModal: () => () => undefined,
}));

jest.mock('../../src/ui/components/logo/LogoIcon', () => ({ LogoIcon: () => null }));

jest.mock('../../src/ui/components/oauthNavigation', () => ({
  __esModule: true,
  redirectToAuthorize: jest.fn(),
  openAuthorizeUrlNative: jest.fn(async () => ({ redirectUrl: null })),
}));

const redirectToAuthorizeMock = redirectToAuthorize as jest.MockedFunction<typeof redirectToAuthorize>;
const openAuthorizeUrlNativeMock = openAuthorizeUrlNative as jest.MockedFunction<
  typeof openAuthorizeUrlNative
>;

beforeEach(() => {
  jest.clearAllMocks();
  clientId = 'oxy_dk_test';
  Platform.OS = 'web';
  openAuthorizeUrlNativeMock.mockResolvedValue({ redirectUrl: null });
  window.sessionStorage.clear();
});

afterEach(() => {
  Platform.OS = 'web';
});

describe('OxySignInButton', () => {
  it('opens the in-app dialog for a first-party / official application', async () => {
    getPublicApplication.mockResolvedValue(makeApp({ type: 'first_party', isOfficial: true }));

    render(<OxySignInButton oauthRedirectUri="https://rp.example/callback" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(openAccountDialog).toHaveBeenCalledWith('signin'));
    expect(getPublicApplication).toHaveBeenCalledWith('oxy_dk_test');
    expect(redirectToAuthorizeMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(OXY_OAUTH_STATE_STORAGE_KEY)).toBeNull();
  });

  it('starts an OAuth + PKCE redirect for a third_party application (web)', async () => {
    getPublicApplication.mockResolvedValue(
      makeApp({ type: 'third_party', isOfficial: false, name: 'Third Party' }),
    );

    render(<OxySignInButton oauthRedirectUri="https://rp.example/callback" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(redirectToAuthorizeMock).toHaveBeenCalledTimes(1));
    expect(openAccountDialog).not.toHaveBeenCalled();

    const url = new URL(redirectToAuthorizeMock.mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.oxy.so/authorize');
    expect(url.searchParams.get('client_id')).toBe('oxy_dk_test');
    expect(url.searchParams.get('redirect_uri')).toBe('https://rp.example/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = url.searchParams.get('state');
    const codeChallenge = url.searchParams.get('code_challenge');
    expect(state).toBeTruthy();
    expect(codeChallenge).toBeTruthy();

    // The CSRF state + PKCE verifier are persisted for the RP's redirect-URI
    // callback: state matches the redirect, and a verifier is stored.
    expect(window.sessionStorage.getItem(OXY_OAUTH_STATE_STORAGE_KEY)).toBe(state);
    expect(window.sessionStorage.getItem(OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY)).toBeTruthy();
  });

  it('aborts (no redirect) for a third_party application with no oauthRedirectUri', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    getPublicApplication.mockResolvedValue(makeApp({ type: 'third_party', isOfficial: false }));

    render(<OxySignInButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(redirectToAuthorizeMock).not.toHaveBeenCalled();
    expect(openAccountDialog).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(OXY_OAUTH_STATE_STORAGE_KEY)).toBeNull();

    errorSpy.mockRestore();
  });

  it('falls back to the dialog when the application cannot be resolved', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getPublicApplication.mockRejectedValue(new Error('network'));

    render(<OxySignInButton oauthRedirectUri="https://rp.example/callback" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(openAccountDialog).toHaveBeenCalledWith('signin'));
    expect(redirectToAuthorizeMock).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('opens the dialog without resolving when there is no clientId', async () => {
    clientId = null;

    render(<OxySignInButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(openAccountDialog).toHaveBeenCalledWith('signin'));
    expect(getPublicApplication).not.toHaveBeenCalled();
  });

  it('defers entirely to a caller-supplied onPress', () => {
    const onPress = jest.fn();

    render(<OxySignInButton onPress={onPress} />);
    fireEvent.click(screen.getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getPublicApplication).not.toHaveBeenCalled();
    expect(openAccountDialog).not.toHaveBeenCalled();
  });

  it('hands the OAuth handshake to onOAuthResult for a third_party application (native)', async () => {
    Platform.OS = 'ios';
    openAuthorizeUrlNativeMock.mockResolvedValue({ redirectUrl: 'myapp://cb?code=abc123&state=xyz' });
    getPublicApplication.mockResolvedValue(makeApp({ type: 'third_party', isOfficial: false }));
    const onOAuthResult = jest.fn();

    render(<OxySignInButton oauthRedirectUri="myapp://cb" onOAuthResult={onOAuthResult} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(openAuthorizeUrlNativeMock).toHaveBeenCalledTimes(1));
    // Native never touches sessionStorage or the web full-page redirect.
    expect(redirectToAuthorizeMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(OXY_OAUTH_STATE_STORAGE_KEY)).toBeNull();

    await waitFor(() => expect(onOAuthResult).toHaveBeenCalledTimes(1));
    const [authorizeUrl] = openAuthorizeUrlNativeMock.mock.calls[0];
    const sentState = new URL(authorizeUrl).searchParams.get('state');
    const result = onOAuthResult.mock.calls[0][0];
    expect(result.redirectUrl).toBe('myapp://cb?code=abc123&state=xyz');
    expect(result.state).toBe(sentState);
    expect(typeof result.codeVerifier).toBe('string');
    expect(result.codeVerifier.length).toBeGreaterThan(40);
  });

  it('warns when a native third_party sign-in has no onOAuthResult handler', async () => {
    Platform.OS = 'ios';
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getPublicApplication.mockResolvedValue(makeApp({ type: 'third_party', isOfficial: false }));

    render(<OxySignInButton oauthRedirectUri="myapp://cb" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(openAuthorizeUrlNativeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(redirectToAuthorizeMock).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('re-resolves the application when clientId changes (cache invalidation)', async () => {
    getPublicApplication.mockResolvedValue(makeApp({ type: 'first_party', isOfficial: true }));

    const { rerender } = render(<OxySignInButton />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(getPublicApplication).toHaveBeenCalledWith('oxy_dk_test'));

    clientId = 'oxy_dk_other';
    rerender(<OxySignInButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(getPublicApplication).toHaveBeenCalledWith('oxy_dk_other'));
    expect(getPublicApplication).toHaveBeenCalledTimes(2);
  });

  it('aborts the third_party web redirect when the handshake cannot be persisted', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    getPublicApplication.mockResolvedValue(makeApp({ type: 'third_party', isOfficial: false }));

    render(<OxySignInButton oauthRedirectUri="https://rp.example/callback" />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(redirectToAuthorizeMock).not.toHaveBeenCalled();
    expect(openAccountDialog).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

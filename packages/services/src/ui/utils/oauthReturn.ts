import type { OxyServices } from '@oxyhq/core';
import {
  clearOAuthHandshake,
  logger,
  normalizeOAuthRedirectUri,
  readOAuthHandshake,
} from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';

export interface OAuthReturnCommitInput {
  sessionId: string;
  accessToken?: string;
  deviceId?: string;
  deviceSecret?: string;
  userId: string;
  expiresAt?: string;
  user?: { id: string; username?: string; avatar?: string };
}

/**
 * When the RP lands with `?code=` after password sign-in at auth.oxy.so, exchange
 * the code for a device-first session before cold boot runs.
 */
export async function tryCompleteOAuthReturn(opts: {
  oxyServices: OxyServices;
  clientId?: string | null;
  authRedirectUri?: string;
  commitSession: (input: OAuthReturnCommitInput) => Promise<void>;
}): Promise<boolean> {
  if (!isWebBrowser()) return false;
  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return false;

  const clientId = opts.clientId;
  if (!clientId) {
    logger.warn('OAuth return ignored: missing clientId', { component: 'oauthReturn' });
    stripOAuthParamsFromUrl();
    return false;
  }

  const returnedState = params.get('state');
  const handshake = readOAuthHandshake();
  if (!handshake || !returnedState || handshake.state !== returnedState) {
    logger.warn('OAuth return ignored: missing or mismatched handshake', {
      component: 'oauthReturn',
    });
    clearOAuthHandshake();
    stripOAuthParamsFromUrl();
    return false;
  }

  const redirectUri = normalizeOAuthRedirectUri(
    opts.authRedirectUri ?? location.origin,
  );

  try {
    const result = await opts.oxyServices.exchangeOAuthCode({
      code,
      clientId,
      redirectUri,
      codeVerifier: handshake.codeVerifier,
    });
    await opts.commitSession({
      sessionId: result.sessionId,
      accessToken: result.accessToken,
      deviceId: result.deviceId,
      deviceSecret: result.deviceSecret,
      userId: result.user.id,
      expiresAt: result.expiresAt,
      user: result.user,
    });
    clearOAuthHandshake();
    stripOAuthParamsFromUrl();
    return true;
  } catch (error) {
    logger.warn('OAuth return exchange failed', { component: 'oauthReturn' }, error);
    clearOAuthHandshake();
    stripOAuthParamsFromUrl();
    return false;
  }
}

function stripOAuthParamsFromUrl(): void {
  const location = (globalThis as { location?: Location; history?: History }).location;
  const history = (globalThis as { history?: History }).history;
  if (!location || !history?.replaceState) return;
  const url = new URL(location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

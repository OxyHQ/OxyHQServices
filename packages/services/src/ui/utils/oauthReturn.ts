import type { OxyServices } from '@oxyhq/core';
import {
  clearOAuthHandshake,
  consumeOAuthReturnPath,
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
  const oauthError = params.get('error');
  if (oauthError) {
    stripOAuthParamsFromUrl();
    return false;
  }
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
    // Consume the return path before clearing the handshake — clearOAuthHandshake
    // drops the persisted path along with the PKCE keys.
    stripOAuthParamsFromUrl();
    clearOAuthHandshake();
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
    // Strip OAuth params before commit so a stale `?code=` cannot re-enter the exchange loop.
    // Read the return path first — clearOAuthHandshake drops it with the PKCE keys.
    stripOAuthParamsFromUrl();
    clearOAuthHandshake();
    await opts.commitSession({
      sessionId: result.sessionId,
      accessToken: result.accessToken,
      deviceId: result.deviceId,
      deviceSecret: result.deviceSecret,
      userId: result.user.id,
      expiresAt: result.expiresAt,
      user: result.user,
    });
    return true;
  } catch (error) {
    logger.warn('OAuth return exchange failed', { component: 'oauthReturn' }, error);
    stripOAuthParamsFromUrl();
    clearOAuthHandshake();
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
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('hub_sync');
  // The authorize round trip lands on the registered apex origin, so restore
  // the page the visit started on. Applies to the success path too: signing in
  // from a deep link should return you to that link, not to the home page.
  const returnPath = consumeOAuthReturnPath();
  history.replaceState(
    history.state,
    '',
    returnPath ?? `${url.pathname}${url.search}${url.hash}`,
  );
}

/**
 * When auth.oxy.so hub-sync redeem fails, the IdP redirects back with
 * `?hub_sync=failed`. Strip the param and log so cold boot can continue
 * without leaving a stale query string.
 */
export function consumeHubSyncFailure(): boolean {
  if (!isWebBrowser()) return false;
  const location = (globalThis as { location?: Location; history?: History }).location;
  const history = (globalThis as { history?: History }).history;
  if (!location) return false;

  const params = new URLSearchParams(location.search);
  if (params.get('hub_sync') !== 'failed') return false;

  logger.warn('Hub sync failed — IdP device session may be out of sync', {
    component: 'hubSync',
  });

  if (history?.replaceState) {
    const url = new URL(location.href);
    url.searchParams.delete('hub_sync');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return true;
}

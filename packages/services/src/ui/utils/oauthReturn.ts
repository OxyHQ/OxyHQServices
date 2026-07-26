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
    clearOAuthHandshake();
    return false;
  }
  if (!code) return false;

  const clientId = opts.clientId;
  if (!clientId) {
    logger.warn('OAuth return ignored: missing clientId', { component: 'oauthReturn' });
    stripOAuthParamsFromUrl();
    clearOAuthHandshake();
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

/**
 * Rewrite the address bar after an authorize round trip, and tell the router.
 *
 * Prefers the page the visit started on (see `persistOAuthReturnPath`) over the
 * bare origin the IdP redirected to, falling back to `fallbackUrl` when nothing
 * was recorded.
 *
 * The `popstate` dispatch is the load-bearing part. `history.replaceState`
 * fires no event, and cold boot runs *inside* the mounted app — by the time
 * this executes, a history-based router (React Router, Vue Router, …) has
 * already read `location` and rendered the route for `/`. Without a
 * notification the address bar would show the restored deep link while the page
 * still displayed the home page. `popstate` is the event the History API
 * defines for exactly this, and it is what those routers subscribe to.
 *
 * Only dispatched when the URL actually changed, so the common no-op case does
 * not push a spurious event at every listener on the page.
 */
export function replaceUrlAfterOAuthReturn(fallbackUrl: string): void {
  const location = (globalThis as { location?: Location }).location;
  const history = (globalThis as { history?: History }).history;
  if (!location || !history?.replaceState) return;

  const current = `${location.pathname}${location.search}${location.hash}`;
  const target = consumeOAuthReturnPath() ?? fallbackUrl;
  history.replaceState(history.state, '', target);
  if (target === current) return;

  const dispatch = (globalThis as { dispatchEvent?: (event: Event) => boolean }).dispatchEvent;
  if (typeof dispatch !== 'function') return;
  try {
    // `PopStateEvent` is web-only; plain `Event` is a good enough carrier for
    // any host that lacks it (routers read `location`, not `event.state`).
    const event =
      typeof PopStateEvent === 'function'
        ? new PopStateEvent('popstate', { state: history.state })
        : new Event('popstate');
    dispatch.call(globalThis, event);
  } catch (error) {
    logger.warn('Could not notify router of restored URL', { component: 'oauthReturn' }, error);
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
  replaceUrlAfterOAuthReturn(`${url.pathname}${url.search}${url.hash}`);
}

/**
 * When auth.oxy.so hub-sync redeem fails, the IdP redirects back with
 * `?hub_sync=failed`. Strip the param and log so cold boot can continue
 * without leaving a stale query string.
 */
export function consumeHubSyncFailure(): boolean {
  if (!isWebBrowser()) return false;
  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  const params = new URLSearchParams(location.search);
  if (params.get('hub_sync') !== 'failed') return false;

  logger.warn('Hub sync failed — IdP device session may be out of sync', {
    component: 'hubSync',
  });

  const url = new URL(location.href);
  url.searchParams.delete('hub_sync');
  replaceUrlAfterOAuthReturn(`${url.pathname}${url.search}${url.hash}`);
  return true;
}

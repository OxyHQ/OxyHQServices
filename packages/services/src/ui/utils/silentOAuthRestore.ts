import type { OxyServices } from '@oxyhq/core';
import {
  buildOAuthAuthorizeUrl,
  generateOAuthState,
  generatePkcePair,
  OXY_SILENT_OAUTH_ATTEMPTED_KEY,
  persistOAuthHandshake,
  normalizeOAuthRedirectUri,
  logger,
} from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { redirectToAuthorize } from '../components/oauthNavigation';

export interface SilentOAuthRestoreOptions {
  oxyServices: OxyServices;
  clientId: string;
  redirectUri?: string;
  scope?: string;
}

/**
 * Top-level redirect to auth.oxy.so/authorize with `prompt=none` for silent
 * cross-origin session restore. At most one attempt per navigation
 * (`sessionStorage.oxy.silent_oauth_attempted`).
 *
 * Returns `true` when a redirect was initiated.
 */
export async function maybeStartSilentOAuthRestore(
  opts: SilentOAuthRestoreOptions,
): Promise<boolean> {
  if (!isWebBrowser()) return false;

  const sessionStore = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (sessionStore?.getItem(OXY_SILENT_OAUTH_ATTEMPTED_KEY)) {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    return false;
  }

  try {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    const state = await generateOAuthState();
    if (!persistOAuthHandshake(state, codeVerifier)) {
      return false;
    }

    const redirectUri = normalizeOAuthRedirectUri(
      opts.redirectUri ?? location.origin,
    );

    const authorizeUrl = buildOAuthAuthorizeUrl({
      clientId: opts.clientId,
      redirectUri,
      state,
      codeChallenge,
      scope: opts.scope,
      prompt: 'none',
    });

    sessionStore?.setItem(OXY_SILENT_OAUTH_ATTEMPTED_KEY, '1');
    redirectToAuthorize(authorizeUrl);
    return true;
  } catch (error) {
    logger.warn('Silent OAuth restore skipped', { component: 'silentOAuthRestore' }, error);
    return false;
  }
}

/** Clear the silent-OAuth loop guard after a successful restore or terminal error. */
export function clearSilentOAuthAttemptFlag(): void {
  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_SILENT_OAUTH_ATTEMPTED_KEY,
    );
  } catch {
    // Best-effort only.
  }
}

/**
 * When the RP lands with OAuth error params from a silent authorize attempt,
 * strip them and return whether the error was terminal for silent restore.
 */
export function consumeSilentOAuthError(): 'login_required' | 'consent_required' | null {
  if (!isWebBrowser()) return null;
  const location = (globalThis as { location?: Location; history?: History }).location;
  const history = (globalThis as { history?: History }).history;
  if (!location) return null;

  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error !== 'login_required' && error !== 'consent_required') {
    return null;
  }

  clearSilentOAuthAttemptFlag();
  if (history?.replaceState) {
    const url = new URL(location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    url.searchParams.delete('state');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return error;
}

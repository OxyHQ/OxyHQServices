import type { OxyServices } from '@oxyhq/core';
import {
  buildOAuthAuthorizeUrl,
  generateOAuthState,
  generatePkcePair,
  isIdpHubOrigin,
  isLoopbackOrigin,
  isOfficialWebOrigin,
  OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY,
  OXY_SILENT_OAUTH_ATTEMPTED_KEY,
  persistOAuthHandshake,
  normalizeOAuthRedirectUri,
  logger,
} from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { redirectToAuthorize } from '../components/oauthNavigation';

function sessionStore(): Storage | undefined {
  return (globalThis as { sessionStorage?: Storage }).sessionStorage;
}

/** True when this tab already attempted cross-origin silent OAuth restore. */
export function isCrossOriginRestoreBlocked(): boolean {
  const store = sessionStore();
  if (!store) return false;
  return Boolean(
    store.getItem(OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY) ||
      store.getItem(OXY_SILENT_OAUTH_ATTEMPTED_KEY),
  );
}

/** Mark restore as attempted — never auto-retry until sign-out clears guards. */
export function markCrossOriginRestoreAttempted(): void {
  const store = sessionStore();
  if (!store) return;
  store.setItem(OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY, '1');
  store.setItem(OXY_SILENT_OAUTH_ATTEMPTED_KEY, '1');
}

/** Clear all cross-origin restore loop guards (call on sign-out). */
export function clearCrossOriginRestoreGuards(): void {
  const store = sessionStore();
  if (!store) return;
  for (const key of [OXY_CROSS_ORIGIN_RESTORE_ATTEMPTED_KEY, OXY_SILENT_OAUTH_ATTEMPTED_KEY]) {
    store.removeItem(key);
  }
}

/**
 * Whether cold boot should attempt silent cross-origin OAuth restore for the
 * given web origin.
 *
 * Mirrors the hub-sync WRITE gate (`syncHubAfterSignIn`): only OFFICIAL Oxy web
 * origins participate in cross-app SSO — a random third-party / preview origin
 * must never have its tab bounced to the IdP. Additionally, loopback / local-dev
 * origins are EXCLUDED here even though {@link isOfficialWebOrigin} treats them
 * as official: a developer's local app must never be redirected to a hosted IdP
 * on cold boot (it signs in through the in-app dialog instead). The central IdP
 * hub's own origin is excluded to avoid a wasteful self-hop.
 */
export function isSilentRestoreEligibleOrigin(origin: string): boolean {
  if (isLoopbackOrigin(origin)) return false;
  if (isIdpHubOrigin()) return false;
  return isOfficialWebOrigin(origin);
}

export interface SilentOAuthRestoreOptions {
  oxyServices: OxyServices;
  clientId: string;
  redirectUri?: string;
  scope?: string;
  /**
   * Authorize endpoint override (env-configurable per deployment). Defaults to
   * the production Oxy IdP when unset, so a local/staging app points silent
   * restore at its OWN IdP instead of production `auth.oxy.so`.
   */
  authorizeBaseUrl?: string;
}

/**
 * Top-level redirect to auth.oxy.so/authorize with `prompt=none` for silent
 * cross-origin session restore on all web apps (official + third-party).
 */
export async function maybeStartSilentOAuthRestore(
  opts: SilentOAuthRestoreOptions,
): Promise<boolean> {
  if (!isWebBrowser()) return false;

  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  // Defense-in-depth: never bounce a loopback / non-official / IdP-hub origin to
  // a hosted authorize endpoint (the caller gates on this too).
  if (!isSilentRestoreEligibleOrigin(location.origin)) {
    return false;
  }

  if (isCrossOriginRestoreBlocked()) {
    return false;
  }

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
      authorizeBaseUrl: opts.authorizeBaseUrl,
      clientId: opts.clientId,
      redirectUri,
      state,
      codeChallenge,
      scope: opts.scope,
      prompt: 'none',
    });

    markCrossOriginRestoreAttempted();
    redirectToAuthorize(authorizeUrl);
    return true;
  } catch (error) {
    logger.warn('Silent OAuth restore skipped', { component: 'crossOriginRestore' }, error);
    return false;
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

  markCrossOriginRestoreAttempted();

  if (history?.replaceState) {
    const url = new URL(location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    url.searchParams.delete('state');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return error;
}

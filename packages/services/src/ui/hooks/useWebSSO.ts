/**
 * Web SSO Hook
 *
 * Handles cross-domain SSO for web apps using FedCM (Federated Credential Management).
 *
 * FedCM is the modern, privacy-preserving standard for cross-domain identity federation.
 * It works across completely different TLDs (alia.onl, mention.earth, homiio.com, etc.)
 * without relying on third-party cookies.
 *
 * For browsers without FedCM support, users will need to click a sign-in button
 * which triggers a popup-based authentication flow.
 *
 * This is called automatically by OxyContext on web platforms.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/FedCM_API
 */

import { useEffect, useRef, useCallback } from 'react';
import type { OxyServices } from '@oxyhq/core';
import type { SessionLoginResponse } from '@oxyhq/core';

interface UseWebSSOOptions {
  oxyServices: OxyServices;
  onSessionFound: (session: SessionLoginResponse) => Promise<void>;
  onSSOUnavailable?: () => void;
  onError?: (error: Error) => void;
  enabled?: boolean;
}

interface UseWebSSOResult {
  /** Manually trigger SSO check */
  checkSSO: () => Promise<SessionLoginResponse | null>;
  /** Trigger interactive FedCM sign-in (shows browser UI) */
  signInWithFedCM: () => Promise<SessionLoginResponse | null>;
  /** Whether SSO check is in progress */
  isChecking: boolean;
  /** Whether FedCM is supported in this browser */
  isFedCMSupported: boolean;
}

/**
 * Module-level guard tracking which (origin + API) signatures have already
 * had a silent SSO attempt this page load.
 *
 * A per-component `useRef` guard resets whenever the provider remounts (route
 * churn, StrictMode double-invoke, error-boundary recovery), which previously
 * allowed silent SSO to re-fire and — combined with a routing redirect loop —
 * produced an accelerating `navigator.credentials.get` retry storm. Keying the
 * guard on a stable signature instead of the component instance makes silent
 * SSO fire EXACTLY ONCE per page load regardless of how many times the
 * provider mounts. The set is intentionally never cleared: a fresh page load
 * (the only thing that can change the answer) starts a fresh module scope.
 */
const silentSSOAttempted = new Set<string>();

/**
 * Build a stable signature for the silent-SSO run-once guard. Two providers
 * pointed at the same API from the same origin share one attempt.
 */
function ssoSignature(oxyServices: OxyServices): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'no-origin';
  let baseURL = '';
  try {
    baseURL = oxyServices.getBaseURL?.() ?? '';
  } catch {
    baseURL = '';
  }
  return `${origin}|${baseURL}`;
}

/**
 * Check if we're running in a web browser environment (not React Native)
 */
function isWebBrowser(): boolean {
  return typeof window !== 'undefined' &&
         typeof document !== 'undefined' &&
         typeof document.documentElement !== 'undefined';
}

/**
 * Check if we're on the identity provider domain (where FedCM would authenticate against itself)
 * Compares against config.authWebUrl if set, otherwise defaults to auth.oxy.so
 */
function isIdentityProvider(authWebUrl?: string): boolean {
  if (!isWebBrowser()) return false;
  const hostname = window.location.hostname;
  let idpHostname = 'auth.oxy.so';
  if (authWebUrl) {
    try { idpHostname = new URL(authWebUrl).hostname; } catch { /* malformed URL, use default */ }
  }
  return hostname === idpHostname;
}

/**
 * Hook for automatic cross-domain web SSO
 *
 * Uses FedCM (Federated Credential Management) - the modern browser-native
 * identity federation API. This is the same technology that powers
 * Google's cross-domain SSO (YouTube, Gmail, Maps, etc.).
 *
 * Key benefits:
 * - Works across different TLDs (alia.onl ↔ mention.earth ↔ homiio.com)
 * - No third-party cookies required
 * - Privacy-preserving (browser mediates identity, IdP can't track)
 * - Automatic silent sign-in after initial authentication
 *
 * For browsers without FedCM (Firefox, older browsers), automatic SSO
 * is not possible. Users will see a sign-in button instead.
 */
export function useWebSSO({
  oxyServices,
  onSessionFound,
  onSSOUnavailable,
  onError,
  enabled = true,
}: UseWebSSOOptions): UseWebSSOResult {
  const isCheckingRef = useRef(false);
  const hasCheckedRef = useRef(false);

  // Check FedCM support once
  const fedCMSupported = isWebBrowser() && oxyServices.isFedCMSupported?.();
  const authWebUrl = oxyServices.config?.authWebUrl;

  const checkSSO = useCallback(async (): Promise<SessionLoginResponse | null> => {
    if (!isWebBrowser() || isCheckingRef.current) {
      return null;
    }

    // Don't use FedCM on the auth domain itself - it would authenticate against itself
    if (isIdentityProvider(authWebUrl)) {
      onSSOUnavailable?.();
      return null;
    }

    // FedCM is the only reliable cross-domain SSO mechanism
    if (!fedCMSupported) {
      onSSOUnavailable?.();
      return null;
    }

    isCheckingRef.current = true;

    try {
      const session = await oxyServices.silentSignInWithFedCM?.();

      if (session) {
        await onSessionFound(session);
        return session;
      }

      onSSOUnavailable?.();
      return null;
    } catch (error) {
      onSSOUnavailable?.();
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      isCheckingRef.current = false;
    }
  }, [oxyServices, onSessionFound, onSSOUnavailable, onError, fedCMSupported, authWebUrl]);

  /**
   * Trigger interactive FedCM sign-in
   * This shows the browser's native "Sign in with Oxy" prompt.
   * Use this when silent mediation fails (user hasn't previously consented).
   */
  const signInWithFedCM = useCallback(async (): Promise<SessionLoginResponse | null> => {
    if (!isWebBrowser() || isCheckingRef.current) {
      return null;
    }

    if (!fedCMSupported) {
      onError?.(new Error('FedCM is not supported in this browser'));
      return null;
    }

    isCheckingRef.current = true;

    try {
      const session = await oxyServices.signInWithFedCM?.();

      if (session) {
        await onSessionFound(session);
        return session;
      }

      return null;
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      isCheckingRef.current = false;
    }
  }, [oxyServices, onSessionFound, onError, fedCMSupported]);

  // Auto-check SSO on mount (web only, FedCM only, not on auth domain).
  //
  // Run-once is enforced by TWO guards:
  //   1. `hasCheckedRef` — cheap per-instance fast-path so effect re-runs
  //      (from changing deps) within one mount never re-fire.
  //   2. `silentSSOAttempted` — module-level, survives remounts/StrictMode so
  //      silent SSO fires exactly once per page load even if the provider
  //      unmounts and remounts.
  useEffect(() => {
    if (!enabled || !isWebBrowser() || hasCheckedRef.current || isIdentityProvider(authWebUrl)) {
      if (isIdentityProvider(authWebUrl)) {
        onSSOUnavailable?.();
      }
      return;
    }

    const signature = ssoSignature(oxyServices);
    if (silentSSOAttempted.has(signature)) {
      // Already attempted this page load (e.g. before a remount) — do not
      // re-fire. Mark the local fast-path too so subsequent re-renders skip.
      hasCheckedRef.current = true;
      return;
    }

    hasCheckedRef.current = true;
    silentSSOAttempted.add(signature);

    if (fedCMSupported) {
      checkSSO();
    } else {
      onSSOUnavailable?.();
    }
  }, [enabled, checkSSO, fedCMSupported, onSSOUnavailable, oxyServices, authWebUrl]);

  return {
    checkSSO,
    signInWithFedCM,
    isChecking: isCheckingRef.current,
    isFedCMSupported: fedCMSupported,
  };
}

export { isWebBrowser };

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
import type { OxyServices } from '../../core/OxyServices';
import type { SessionLoginResponse } from '../../models/session';

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
  /** Whether SSO check is in progress */
  isChecking: boolean;
  /** Whether FedCM is supported in this browser */
  isFedCMSupported: boolean;
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
 * Check if we're on the auth domain (where FedCM would authenticate against itself)
 */
function isAuthDomain(): boolean {
  if (!isWebBrowser()) return false;
  const hostname = window.location.hostname;
  return hostname === 'accounts.oxy.so' ||
         hostname === 'auth.oxy.so';
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
  const fedCMSupported = isWebBrowser() && (oxyServices as any).isFedCMSupported?.();

  const checkSSO = useCallback(async (): Promise<SessionLoginResponse | null> => {
    if (!isWebBrowser() || isCheckingRef.current) {
      return null;
    }

    // Don't use FedCM on the auth domain itself - it would authenticate against itself
    if (isAuthDomain()) {
      onSSOUnavailable?.();
      return null;
    }

    // FedCM is the only reliable cross-domain SSO mechanism
    // Third-party cookies are deprecated and unreliable
    if (!fedCMSupported) {
      onSSOUnavailable?.();
      return null;
    }

    isCheckingRef.current = true;

    try {
      // Use FedCM for cross-domain SSO
      // This works because browser treats IdP requests as first-party
      const session = await (oxyServices as any).silentSignInWithFedCM?.();

      if (session) {
        await onSessionFound(session);
        return session;
      }

      // No session found - user needs to sign in
      onSSOUnavailable?.();
      return null;
    } catch (error) {
      // FedCM failed - could be network error, user not signed in, etc.
      onSSOUnavailable?.();
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      isCheckingRef.current = false;
    }
  }, [oxyServices, onSessionFound, onSSOUnavailable, onError, fedCMSupported]);

  // Auto-check SSO on mount (web only, FedCM only, not on auth domain)
  useEffect(() => {
    if (!enabled || !isWebBrowser() || hasCheckedRef.current || isAuthDomain()) {
      if (isAuthDomain()) {
        onSSOUnavailable?.();
      }
      return;
    }

    hasCheckedRef.current = true;

    if (fedCMSupported) {
      checkSSO();
    } else {
      // Browser doesn't support FedCM - notify caller
      onSSOUnavailable?.();
    }
  }, [enabled, checkSSO, fedCMSupported, onSSOUnavailable]);

  return {
    checkSSO,
    isChecking: isCheckingRef.current,
    isFedCMSupported: fedCMSupported,
  };
}

export { isWebBrowser };

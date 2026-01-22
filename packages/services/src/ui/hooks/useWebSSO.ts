/**
 * Web SSO Hook
 *
 * Automatically handles cross-domain SSO for web apps.
 * Uses a progressive enhancement strategy:
 * 1. Try FedCM (browser-native, works across domains, no cookies needed)
 * 2. Fallback to iframe-based silentSignIn (for browsers without FedCM)
 *
 * This is called automatically by OxyContext on web platforms.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { OxyServices } from '../../core/OxyServices';
import type { SessionLoginResponse } from '../../models/session';

interface UseWebSSOOptions {
  oxyServices: OxyServices;
  onSessionFound: (session: SessionLoginResponse) => Promise<void>;
  onError?: (error: Error) => void;
  enabled?: boolean;
}

interface UseWebSSOResult {
  checkSSO: () => Promise<SessionLoginResponse | null>;
  isChecking: boolean;
}

/**
 * Check if we're running in a web browser environment (not React Native)
 */
function isWebBrowser(): boolean {
  // Check for browser globals and that we have a real DOM (React Native has window but not documentElement)
  return typeof window !== 'undefined' &&
         typeof document !== 'undefined' &&
         typeof document.documentElement !== 'undefined';
}

/**
 * Hook for automatic web SSO
 *
 * Automatically checks for existing cross-domain session on mount.
 * Only runs on web platforms.
 *
 * Strategy:
 * 1. Try FedCM silentSignIn (browser-native, no cookies, works across TLDs)
 * 2. Fallback to iframe-based silentSignIn (needs third-party cookies)
 */
export function useWebSSO({
  oxyServices,
  onSessionFound,
  onError,
  enabled = true,
}: UseWebSSOOptions): UseWebSSOResult {
  const isCheckingRef = useRef(false);
  const hasCheckedRef = useRef(false);

  const checkSSO = useCallback(async (): Promise<SessionLoginResponse | null> => {
    if (!isWebBrowser() || isCheckingRef.current) {
      return null;
    }

    isCheckingRef.current = true;

    try {
      let session: SessionLoginResponse | null = null;

      // Strategy 1: Try FedCM first (works across different domains without cookies)
      // FedCM is the proper solution for cross-domain SSO in modern browsers
      if ((oxyServices as any).isFedCMSupported?.()) {
        try {
          session = await (oxyServices as any).silentSignInWithFedCM?.();
        } catch {
          // FedCM silent sign-in failed, will try iframe fallback
        }
      }

      // Strategy 2: Fallback to iframe-based silentSignIn
      // This works for same-domain or when third-party cookies are allowed
      if (!session) {
        try {
          session = await (oxyServices as any).silentSignIn?.();
        } catch {
          // Iframe-based silent sign-in also failed
        }
      }

      if (session) {
        await onSessionFound(session);
      }

      return session;
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      isCheckingRef.current = false;
    }
  }, [oxyServices, onSessionFound, onError]);

  // Auto-check SSO on mount (web only)
  useEffect(() => {
    if (!enabled || !isWebBrowser() || hasCheckedRef.current) {
      return;
    }

    hasCheckedRef.current = true;
    checkSSO();
  }, [enabled, checkSSO]);

  return {
    checkSSO,
    isChecking: isCheckingRef.current,
  };
}

export { isWebBrowser };

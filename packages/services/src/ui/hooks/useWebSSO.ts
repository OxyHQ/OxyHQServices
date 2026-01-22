/**
 * Web SSO Hook
 *
 * Automatically handles cross-domain SSO for web apps.
 * Uses the OxyServices.silentSignIn() method which loads a hidden iframe
 * to check for existing session at auth.oxy.so.
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
 * Only runs on web platforms. Uses OxyServices.silentSignIn() internally.
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
      // Use the existing silentSignIn method from OxyServices
      // which handles iframe creation, postMessage, and token storage
      const session = await (oxyServices as any).silentSignIn?.();

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

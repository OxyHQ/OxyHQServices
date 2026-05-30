import type { OnboardingStatus } from './useOnboardingStatus';

/**
 * Where the WEB `(auth)` entry should send a visitor, derived purely from the
 * resolved onboarding status.
 *
 * Web is a management surface for an EXISTING account — identity CREATION is
 * native-only. So unlike native (whose entry can route into the
 * create-identity flow), the web entry only ever resolves to:
 *
 *   - `'/(tabs)'`           — fully onboarded; enter the app shell
 *   - `null`               — still resolving (render a backdrop, never a CTA);
 *                            silent FedCM SSO may be about to succeed
 *   - `'/(auth)/sign-in'`  — unauthenticated; show the sign-in screen
 *
 * It NEVER returns a create-identity / welcome route: those are forbidden on
 * web. Keeping this a pure function (no React, no Platform) makes the web
 * routing contract directly unit-testable and impossible to drift.
 */
export type WebAuthEntryTarget = '/(tabs)' | '/(auth)/sign-in' | null;

export function getWebAuthEntryTarget(status: OnboardingStatus): WebAuthEntryTarget {
  if (status === 'complete') {
    return '/(tabs)';
  }
  if (status === 'checking') {
    return null;
  }
  // 'none' | 'in_progress' — no live session on web means sign in. We do NOT
  // resume a create-identity flow on web (status 'in_progress' on web can only
  // mean "session not yet established"; there is no local identity to resume).
  return '/(auth)/sign-in';
}

import type { OnboardingStatus } from './useOnboardingStatus';

/**
 * Where the WEB `(auth)` entry should send a visitor, derived purely from the
 * resolved onboarding status.
 *
 * Web is a management surface for an EXISTING account — identity CREATION is
 * native-only. So unlike native (whose entry can route into the
 * create-identity flow), the web entry only ever resolves to:
 *
 *   - `null`               — render a backdrop, NEVER navigate. Two distinct
 *                            states map here:
 *                              • `'complete'`  — fully onboarded. The root Stack
 *                                in `app/_layout.tsx` already owns the
 *                                `(auth)`↔`(tabs)` boundary via
 *                                `redirect={!needsAuth}`; once `needsAuth` flips
 *                                to false it swaps the active group to `(tabs)`.
 *                                The entry must NOT navigate to `(tabs)` itself
 *                                — doing so races the root swap (two independent
 *                                navigation authorities firing on the same
 *                                settled signal) and can land expo-router on no
 *                                matching route → permanent blank screen.
 *                              • `'checking'` — still resolving; silent FedCM
 *                                SSO may be about to succeed, so don't flash a
 *                                sign-in CTA.
 *   - `'/(auth)/sign-in'`  — unauthenticated; show the sign-in screen
 *
 * It NEVER returns a create-identity / welcome route (forbidden on web) and
 * NEVER returns `'/(tabs)'` (the root Stack owns that group-swap). Keeping this
 * a pure function (no React, no Platform) makes the web routing contract
 * directly unit-testable and impossible to drift.
 */
export type WebAuthEntryTarget = '/(auth)/sign-in' | null;

export function getWebAuthEntryTarget(status: OnboardingStatus): WebAuthEntryTarget {
  if (status === 'complete') {
    // Fully onboarded: the root Stack's `redirect={!needsAuth}` already swaps
    // the active group to `(tabs)`. Render a backdrop and let it perform the
    // single authoritative swap — navigating to `(tabs)` from here races it.
    return null;
  }
  if (status === 'checking') {
    return null;
  }
  // 'none' | 'in_progress' — no live session on web means sign in. We do NOT
  // resume a create-identity flow on web (status 'in_progress' on web can only
  // mean "session not yet established"; there is no local identity to resume).
  return '/(auth)/sign-in';
}

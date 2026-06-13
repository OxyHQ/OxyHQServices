import { getWebAuthEntryTarget } from '@/hooks/authEntryTarget';

/**
 * The web `(auth)` entry routing contract. This is the heart of the
 * native/web platform split:
 *
 *   - Native unauthenticated users go into the create-identity onboarding
 *     (verified by `useOnboardingStatus` + the native `(auth)/index.tsx`).
 *   - Web unauthenticated users go to SIGN-IN — never create-identity, never
 *     the marketing welcome. Identity creation is forbidden on web.
 *
 * These assertions lock that contract so a future refactor can't silently
 * route web visitors back into the (now-forbidden) create-identity flow.
 */
describe('getWebAuthEntryTarget (web auth-entry routing)', () => {
  it('renders a backdrop (null) for a fully-onboarded session and lets the root Stack swap groups', () => {
    // The root Stack in `app/_layout.tsx` owns the `(auth)`↔`(tabs)` boundary
    // via `redirect={!needsAuth}`. The web entry must NOT navigate to `(tabs)`
    // itself — doing so races the root swap and can blank the app. It renders a
    // backdrop and lets the root Stack perform the single authoritative swap.
    expect(getWebAuthEntryTarget('complete')).toBeNull();
  });

  it('renders a backdrop (null) while the status is still resolving', () => {
    // Silent FedCM SSO may be in flight — do not flash a sign-in CTA.
    expect(getWebAuthEntryTarget('checking')).toBeNull();
  });

  it('routes an unauthenticated visitor (status "none") to SIGN-IN, not create-identity', () => {
    const target = getWebAuthEntryTarget('none');
    expect(target).toBe('/(auth)/sign-in');
    expect(target).not.toBe('/(auth)/create-identity');
    expect(target).not.toBe('/(auth)/welcome');
  });

  it('routes status "in_progress" to SIGN-IN on web (no create-identity resume)', () => {
    // On web there is no local identity to resume — an unsettled session must
    // re-authenticate via FedCM, not re-enter the native creation flow.
    const target = getWebAuthEntryTarget('in_progress');
    expect(target).toBe('/(auth)/sign-in');
    expect(target).not.toBe('/(auth)/create-identity');
  });

  it('never returns a create-identity, welcome, or (tabs) route for any status', () => {
    // `(tabs)` is forbidden too: the root Stack owns the `(auth)`↔`(tabs)`
    // swap. The entry navigating there would race that swap and blank the app.
    const statuses = ['checking', 'none', 'in_progress', 'complete'] as const;
    for (const status of statuses) {
      const target = getWebAuthEntryTarget(status);
      expect(target).not.toBe('/(auth)/create-identity');
      expect(target).not.toBe('/(auth)/welcome');
      expect(target).not.toBe('/(tabs)');
    }
  });
});

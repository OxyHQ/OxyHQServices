import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { getWebAuthEntryTarget } from '@/hooks/authEntryTarget';

/**
 * Auth Index (Web)
 *
 * Web is a surface for managing an EXISTING account — identity CREATION is
 * native-only. So the web `(auth)` entry never shows the "Hello / Human"
 * marketing splash or the create-identity welcome (those belong to native's
 * `index.tsx`). Instead it sends unauthenticated visitors to the sign-in
 * screen, and authenticated visitors into the app shell.
 *
 * Routing:
 *   - `status === 'complete'` → blank backdrop. The root Stack in
 *     `app/_layout.tsx` owns the `(auth)`↔`(tabs)` boundary via
 *     `redirect={!needsAuth}`; once onboarded it swaps the active group to
 *     `(tabs)`. This entry must NOT navigate to `(tabs)` itself — doing so
 *     races the root swap and can blank the app — so it just renders a backdrop.
 *   - `status === 'checking'` → blank backdrop while silent FedCM SSO and the
 *     identity/session lookups resolve (a real terminal frame, never a loop)
 *   - otherwise (`none` / `in_progress`) → `/(auth)/sign-in`
 *
 * The platform split lives here (a dedicated `.web` route file) rather than in
 * `useOnboardingStatus`, so the hook's `needsAuth` stays platform-agnostic and
 * the web routing deadlock that the agnostic gate fixed stays fixed: the root
 * Stack still renders the `(auth)` group for unauthenticated web, and that
 * group now resolves to a real sign-in screen.
 */
export default function AuthIndexWebScreen() {
  const colors = useColors();
  const { status } = useOnboardingStatus();
  const target = getWebAuthEntryTarget(status);

  // `null` covers two states: 'complete' (fully onboarded — the root Stack is
  // swapping the active group to (tabs); we must NOT navigate there ourselves
  // and race it) and 'checking' (still resolving; silent FedCM SSO may be in
  // flight, so don't flash a "Sign in" button at a user whose SSO is about to
  // succeed). Both render a plain backdrop and never navigate.
  if (target === null) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  return <Redirect href={target} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

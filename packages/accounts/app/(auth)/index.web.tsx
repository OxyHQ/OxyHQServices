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
 *   - `status === 'complete'` → `/(tabs)` (fully onboarded; enter the app)
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

  // Still resolving the session/identity answer (silent FedCM SSO may be in
  // flight). Render a plain backdrop — not the sign-in CTA — so we don't flash
  // a "Sign in" button at a user whose silent SSO is about to succeed.
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

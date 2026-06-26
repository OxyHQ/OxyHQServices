import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Vault Layout
 *
 * The authenticated zone of Commons — the identity vault home plus the
 * key-management screens (about-identity, create-backup, delete-account).
 *
 * The root `<Stack>` in `app/_layout.tsx` is the SOLE authority for the
 * `(auth)`↔`(vault)` group swap (`redirect={needsAuth}`). Per the expo-router
 * "one authority for group-boundary swaps" rule, this child layout NEVER
 * redirects across that boundary — by the time it mounts the user is
 * authenticated and onboarded.
 */
export default function VaultLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="about-identity" />
      <Stack.Screen name="create-backup" />
      <Stack.Screen name="delete-account" />
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="approve" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

/**
 * Route-level error boundary. expo-router calls this when a render error
 * bubbles up from any screen inside `(vault)`. Keeps the user on the route
 * with a retry action instead of falling back to the LogBox screen.
 */
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

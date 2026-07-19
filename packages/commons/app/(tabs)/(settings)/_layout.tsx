import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Settings tab stack: the management menu (`index`) plus the identity/vault
 * management detail screens it pushes — about your identity, encrypted backup,
 * proof of personhood, verifiable credentials, and account deletion. Screens
 * self-render their headers/back affordances.
 */
export default function SettingsTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="about-identity" />
      <Stack.Screen name="create-backup" />
      <Stack.Screen name="rotate-key" />
      <Stack.Screen name="personhood" />
      <Stack.Screen name="credentials/index" />
      <Stack.Screen name="credentials/[recordId]" />
      <Stack.Screen name="node" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

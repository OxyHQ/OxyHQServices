import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Scan tab stack: the full-screen QR scanner (`index`) plus the screens it
 * deep-links into after parsing a QR — the "Sign in with Oxy" approval
 * (`approve`) and the real-life attestation confirmation (`attest`). Screens
 * self-render their chrome.
 */
export default function ScanTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="approve" options={{ presentation: 'modal' }} />
      <Stack.Screen name="attest" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

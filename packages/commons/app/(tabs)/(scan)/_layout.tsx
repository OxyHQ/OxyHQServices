import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Scan tab stack: the full-screen QR scanner (`index`) plus the
 * "Sign in with Oxy" approval screen (`approve`) it deep-links into after
 * scanning an approval QR. Screens self-render their chrome.
 */
export default function ScanTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="approve" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

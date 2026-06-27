import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Oxy ID tab stack: the landing/home + citizen ID card (`index`), the
 * scanned-person view (`card/[did]`) the QR scanner deep-links into, the
 * "confirm you met me IRL" QR screen (`attest-me`), and the vouch confirm screen
 * (`vouch/[did]`) the scanned card pushes. Screens self-render their headers, so
 * the stack headers stay hidden.
 */
export default function IdTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="card/[did]" />
      <Stack.Screen name="attest-me" />
      <Stack.Screen name="vouch/[did]" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

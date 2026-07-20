import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Oxy ID tab stack: the landing/home + citizen ID card (`index`), the
 * scanned-person view (`card/[did]`) the QR scanner deep-links into, the vouch
 * confirm screen (`vouch/[did]`), and the issue-a-credential form
 * (`credential/[did]`) the scanned card pushes. Screens self-render their
 * headers, so the stack headers stay hidden. The "confirm you met me IRL" QR is
 * no longer a screen — it's a bottom sheet (`AttestQrSheet`) on the home.
 */
export default function IdTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="card/[did]" />
      <Stack.Screen name="vouch/[did]" />
      <Stack.Screen name="credential/[did]" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

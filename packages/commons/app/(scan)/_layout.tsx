import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Scan modal stack — the root presents this whole group as a full-screen modal
 * (`presentation: 'fullScreenModal'`). It holds the full-screen QR scanner
 * (`index`) plus the screens it deep-links into after parsing a QR — the "Sign
 * in with Oxy" approval (`approve`) and the real-life attestation confirmation
 * (`attest`). The scanner `replace`s into approve/attest (no extra modal layer),
 * so these are plain screens here; all self-render their chrome.
 */
export default function ScanModalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="approve" />
      <Stack.Screen name="attest" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

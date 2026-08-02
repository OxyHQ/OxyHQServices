import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Scan modal stack — the root presents this whole group as a full-screen modal
 * (`presentation: 'fullScreenModal'`). It holds the full-screen QR scanner
 * (`index`) plus the real-life attestation confirmation (`attest`) the scanner
 * `replace`s into after parsing a QR — both full-bleed screens that self-render
 * their chrome and want the opaque full-screen presentation.
 *
 * The "Sign in with Oxy" approval is NOT here: it renders a Bloom bottom sheet
 * that must rise over the real underlying context, so it lives at the ROOT as a
 * `transparentModal` (`app/approve.tsx`, registered in `app/_layout.tsx`). An
 * opaque `fullScreenModal` group card behind the sheet would make it look like a
 * dedicated screen. The scanner `replace`s to `/approve` (a root route).
 */
export default function ScanModalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="attest" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

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
 *
 * `approve` is the exception: it renders a Bloom bottom sheet (`<Dialog
 * placement="bottom">`) instead of a full-bleed screen, so it is presented as a
 * TRANSPARENT modal with no stack transition — the sheet owns its own drag
 * handle, dimmed backdrop, and rise/settle animation over the underlying
 * context. `index` (the camera) and `attest` keep the group's opaque
 * full-screen presentation.
 */
export default function ScanModalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="approve"
        options={{ presentation: 'transparentModal', animation: 'none' }}
      />
      <Stack.Screen name="attest" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

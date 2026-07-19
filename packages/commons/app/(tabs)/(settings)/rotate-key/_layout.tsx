import React from 'react';
import { Stack } from 'expo-router';
import { RotateKeyFlowProvider } from '@/contexts/rotate-key-flow-context';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Key-rotation flow stack. Nested under the Settings tab so it inherits the
 * tab's stack while owning its own shared flow state (proof mode, the entered
 * current phrase, and the pre-derived new identity) via `RotateKeyFlowProvider`.
 *
 * Steps: choose a proof path → (Path B) enter current phrase → reveal + save the
 * NEW recovery phrase → biometric-gated confirm.
 */
export default function RotateKeyLayout() {
  return (
    <RotateKeyFlowProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="current-phrase" />
        <Stack.Screen
          name="recovery-phrase"
          options={{
            // Match create-identity: block iOS swipe-back before the new phrase
            // is acknowledged.
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="confirm" />
      </Stack>
    </RotateKeyFlowProvider>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

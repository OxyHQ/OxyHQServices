import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Reputation tab stack: the reputation breakdown (`index`) plus the juror
 * "validation requests" inbox (`validate`) and the per-request vote screen
 * (`validate/[id]`). Screens self-render their headers.
 */
export default function ReputationTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="validate/index" />
      <Stack.Screen name="validate/[id]" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

import React from 'react';
import { Stack } from 'expo-router';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * DNI tab stack: the citizen card (`index`) plus the scanned-person view
 * (`card/[did]`), which the QR scanner deep-links into. Screens self-render
 * their headers, so the stack headers stay hidden.
 */
export default function DniTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="card/[did]" />
    </Stack>
  );
}

export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}

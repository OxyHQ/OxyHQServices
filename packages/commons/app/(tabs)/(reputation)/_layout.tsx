import React from 'react';
import { Stack } from 'expo-router';

/**
 * Reputation tab stack. Single screen; nested `<Stack>` keeps the tab
 * consistent with the others and ready for future detail screens.
 */
export default function ReputationTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

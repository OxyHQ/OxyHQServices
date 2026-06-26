import React from 'react';
import { Stack } from 'expo-router';

/**
 * Home tab stack. Native tabs render no chrome, so each tab nests its own
 * `<Stack>`; the screens self-render their headers, so headers stay hidden
 * (consistent with the pre-tabs layout — no double titles).
 */
export default function HomeTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

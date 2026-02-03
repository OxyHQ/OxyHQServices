/**
 * Responsive settings layout.
 *
 * Desktop: two-column — SettingsNav on left, Slot (settings content) on right.
 * Mobile: Stack navigation — index shows full settings page.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Slot, Stack, usePathname } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { SettingsNav } from '@/components/SettingsNav';

export default function SettingsLayout() {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const pathname = usePathname();

  // Extract active section from pathname (e.g. /settings/signature → signature)
  const activeSection = pathname.split('/').pop() || 'general';

  if (isDesktop) {
    return (
      <View style={[styles.splitContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.navPane, { borderRightColor: colors.border }]}>
          <SettingsNav activeSection={activeSection} />
        </View>
        <View style={styles.contentPane}>
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[section]" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  navPane: {
    width: 280,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  contentPane: {
    flex: 1,
  },
});

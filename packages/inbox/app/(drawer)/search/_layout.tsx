/**
 * Responsive search layout.
 *
 * Desktop: two-column split — SearchList on left, Slot (child route) on right.
 * Mobile: Stack navigation — index shows search list, conversation/[id] pushes on top.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Slot, Stack } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { SearchList } from '@/components/SearchList';

export default function SearchLayout() {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;

  if (isDesktop) {
    return (
      <View style={[styles.splitContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.listPane, { borderRightColor: colors.border }]}>
          <SearchList replaceNavigation />
        </View>
        <View style={styles.detailPane}>
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="conversation/[id]" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  listPane: {
    width: 380,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  detailPane: {
    flex: 1,
  },
});

/**
 * Responsive inbox layout.
 *
 * Desktop (web ≥ 900px): two-column split — InboxList on left, Slot (child route) on right.
 * Mobile / narrow: Stack navigation — index shows list, conversation/[id] pushes on top.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Slot, Stack } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { InboxList } from '@/components/InboxList';

export default function InboxLayout() {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;

  if (isDesktop) {
    return (
      <View style={[styles.splitContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.listPane, { borderRightColor: colors.border }]}>
          <InboxList replaceNavigation />
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

/**
 * Responsive settings layout.
 *
 * Desktop: two-column — `SettingsNav` on the left, the active subscreen on
 * the right (rendered via `<Slot />`).
 *
 * Mobile / native: a `Stack` with one screen per section. Headers are owned
 * by `SettingsScreenShell` on each screen, so we hide the stack header.
 */

import React, { useMemo } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Slot, Stack, usePathname } from 'expo-router';

import { useColors } from '@/constants/theme';
import { SettingsNav } from '@/components/settings/SettingsNav';
import type { SettingsSectionKey } from '@/components/settings/sections-catalog';

const DESKTOP_BREAKPOINT = 900;

function deriveActiveSection(pathname: string): SettingsSectionKey | undefined {
  const last = pathname.split('/').filter(Boolean).pop();
  if (!last || last === 'settings') return undefined;
  // Path segments are already kebab-case matching SettingsSectionKey values.
  return last as SettingsSectionKey;
}

export default function SettingsLayout() {
  const { width } = useWindowDimensions();
  const colors = useColors();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
  const pathname = usePathname();
  const activeSection = useMemo(() => deriveActiveSection(pathname), [pathname]);

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

  return <Stack screenOptions={{ headerShown: false }} />;
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

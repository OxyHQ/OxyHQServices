/**
 * Desktop sidebar listing all settings sections.
 *
 * Mirrors the catalog in `sections-catalog.ts` so the landing page (mobile)
 * and this sidebar (desktop) always stay in sync. Each row navigates to the
 * corresponding subscreen via expo-router's typed paths.
 *
 * Uses the same tinted IconCircles as the landing rows so the visual
 * language is consistent across form factors (iOS Settings sidebar on iPad
 * is the reference). Auth-gated rows are visually subdued when the user
 * is signed out, with a trailing lock affordance.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { useTheme } from '@oxyhq/bloom/theme';
import { H3, Text } from '@oxyhq/bloom/typography';
import { Lock_Stroke2_Corner0_Rounded } from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { useSettingsTint } from './settings-tints';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
  type SettingsSectionKey,
  type SettingsSectionPath,
} from './sections-catalog';

interface SettingsNavProps {
  /** The currently-active section, used to highlight its row. */
  activeSection?: SettingsSectionKey;
}

interface SidebarRowProps {
  section: SettingsSectionDef;
  isActive: boolean;
  isLocked: boolean;
  onPress: () => void;
}

function SidebarRow({ section, isActive, isLocked, onPress }: SidebarRowProps) {
  const colors = useColors();
  const theme = useTheme();
  const tintHex = useSettingsTint(section.tint);
  const Icon = section.icon;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={section.label}
      accessibilityState={{ selected: isActive, disabled: false }}
      style={({ pressed }) => [
        styles.sectionItem,
        isActive && { backgroundColor: theme.colors.primarySubtle },
        pressed && !isActive && { backgroundColor: theme.colors.contrast50 },
      ]}
    >
      <Icon
        size="sm"
        style={{
          color: isActive ? theme.colors.primary : tintHex,
          opacity: isLocked ? 0.5 : 1,
        }}
      />
      <Text
        style={[
          styles.sectionLabel,
          { color: isActive ? theme.colors.primary : colors.text },
          isActive && styles.sectionLabelActive,
          isLocked && { opacity: 0.6 },
        ]}
        numberOfLines={1}
      >
        {section.label}
      </Text>
      {isLocked ? (
        <Lock_Stroke2_Corner0_Rounded
          size="sm"
          style={{ color: colors.icon, opacity: 0.6 }}
        />
      ) : null}
    </Pressable>
  );
}

export function SettingsNav({ activeSection }: SettingsNavProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isAuthenticated } = useOxy();

  const handleSelect = useCallback(
    (path: SettingsSectionPath) => {
      router.replace(path);
    },
    [router],
  );

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <H3 style={styles.headerTitle}>Settings</H3>
      </View>

      <View style={styles.sections}>
        {SETTINGS_SECTIONS.map((section) => (
          <SidebarRow
            key={section.key}
            section={section}
            isActive={activeSection === section.key}
            isLocked={section.requiresAuth && !isAuthenticated}
            onPress={() => handleSelect(section.path)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  sections: {
    paddingTop: 8,
    paddingHorizontal: 8,
    gap: 2,
  },
  sectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  sectionLabel: {
    fontSize: 14,
    flex: 1,
  },
  sectionLabelActive: {
    fontWeight: '600',
  },
});

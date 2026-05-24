/**
 * Mobile settings landing screen.
 *
 * Top: `SettingsHero` (account card or sign-in CTA).
 * Below: a stack of `SettingsCategoryCard`s, one per logical bucket:
 *  - Personal (Account, Notifications, Privacy)
 *  - Mail (Inbox, Labels, AI features, Storage)
 *  - System (Appearance, Advanced, About)
 *
 * Each row uses `SettingsCategoryRow` — a tinted `IconCircle` with the
 * section's signature color (iOS Settings convention: blue=Account,
 * purple=Appearance, red=Privacy, etc.) plus title + description + chevron.
 *
 * Locked rows (auth-gated when signed-out) still navigate so the user
 * lands on the section's auth gate, with a lock indicator on the right.
 */

import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { H3 } from '@oxyhq/bloom/typography';
import { Lock_Stroke2_Corner0_Rounded } from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SettingsHero } from './SettingsHero';
import { SettingsCategoryCard } from './SettingsCategoryCard';
import { SettingsCategoryRow } from './SettingsCategoryRow';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
  type SettingsSectionPath,
} from './sections-catalog';

type SectionBucketKey = 'personal' | 'mail' | 'system';

const BUCKETS: ReadonlyArray<{
  key: SectionBucketKey;
  title: string;
  sectionKeys: ReadonlyArray<SettingsSectionDef['key']>;
}> = [
  {
    key: 'personal',
    title: 'Personal',
    sectionKeys: ['account', 'notifications', 'privacy'],
  },
  {
    key: 'mail',
    title: 'Mail',
    sectionKeys: ['inbox-prefs', 'labels', 'ai', 'storage'],
  },
  {
    key: 'system',
    title: 'System',
    sectionKeys: ['appearance', 'advanced', 'about'],
  },
];

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) {
    throw new Error(`SettingsLanding: unknown section key "${key}"`);
  }
  return match;
}

export function SettingsLanding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isAuthenticated } = useOxy();

  const handleNavigate = useCallback(
    (path: SettingsSectionPath) => {
      router.push(path);
    },
    [router],
  );

  const buckets = useMemo(
    () =>
      BUCKETS.map((bucket) => ({
        ...bucket,
        sections: bucket.sectionKeys.map(findSection),
      })),
    [],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <H3 style={styles.headerTitle}>Settings</H3>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: Math.max(insets.left, insets.right),
        }}
        showsVerticalScrollIndicator={false}
      >
        <SettingsHero />

        {buckets.map((bucket) => (
          <SettingsCategoryCard key={bucket.key} title={bucket.title}>
            {bucket.sections.map((section) => {
              const isLocked = section.requiresAuth && !isAuthenticated;
              return (
                <SettingsCategoryRow
                  key={section.key}
                  icon={section.icon}
                  tint={section.tint}
                  title={section.label}
                  description={section.description}
                  trailing={
                    isLocked ? (
                      <Lock_Stroke2_Corner0_Rounded
                        size="sm"
                        style={{ color: colors.icon, opacity: 0.6 }}
                      />
                    ) : null
                  }
                  onPress={() => handleNavigate(section.path)}
                />
              );
            })}
          </SettingsCategoryCard>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 28,
    lineHeight: 34,
  },
  scroll: {
    flex: 1,
  },
});

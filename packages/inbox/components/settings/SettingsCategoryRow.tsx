/**
 * Settings landing row — modest icon + title + description + chevron.
 *
 * Sized to match Alia's restrained settings rows: a small (20px) Bloom
 * icon tinted with the section's signature color, the title and a short
 * description, and a trailing chevron. No oversized tinted circles.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';
import { Text } from '@oxyhq/bloom/typography';
import { ChevronRight_Stroke2_Corner0_Rounded } from '@oxyhq/bloom/icons';
import type { Props as IconProps } from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { useSettingsTint } from './settings-tints';
import type { SettingsTintKey } from './settings-tints';

interface SettingsCategoryRowProps {
  icon: React.ComponentType<IconProps>;
  tint: SettingsTintKey;
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  onPress: () => void;
}

export function SettingsCategoryRow({
  icon: Icon,
  tint,
  title,
  description,
  trailing,
  onPress,
}: SettingsCategoryRowProps) {
  const colors = useColors();
  const theme = useTheme();
  const tintHex = useSettingsTint(tint);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      android_ripple={{ color: theme.colors.border }}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Icon size="md" style={{ color: tintHex }} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.description, { color: colors.secondaryText }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
      <ChevronRight_Stroke2_Corner0_Rounded
        size="sm"
        style={{ color: colors.icon, opacity: 0.6 }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    minHeight: 52,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 19,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
});

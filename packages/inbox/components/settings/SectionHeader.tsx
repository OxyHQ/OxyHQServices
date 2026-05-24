/**
 * Small subsection eyebrow used inside every settings subscreen.
 *
 * Renders an icon (Bloom) + an uppercase letter-spaced label, sized down
 * so it doesn't compete with the screen header. Matches the Alia settings
 * subsection style.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';
import { Text } from '@oxyhq/bloom/typography';
import type { Props as IconProps } from '@oxyhq/bloom/icons';

interface SectionHeaderProps {
  icon: React.ComponentType<IconProps>;
  title: string;
}

export function SectionHeader({ icon: Icon, title }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Icon size="sm" style={{ color: theme.colors.primary }} />
      <Text style={[styles.title, { color: theme.colors.textSecondary }]}>
        {title.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});

/**
 * Rounded grouped card used on the settings landing.
 *
 * Bloom's `SettingsListGroup` hardcodes the divider inset at 16px (its
 * default fits the small 20px icons in `SettingsListItem`). The landing
 * rows use a 52px tinted IconCircle, so the divider needs to start past
 * the icon to read correctly — matching the iOS Settings reference.
 *
 * Renders an optional uppercase section title, a rounded backgroundSecondary
 * card holding the rows, and an optional footer caption.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';
import { Text } from '@oxyhq/bloom/typography';

interface SettingsCategoryCardProps {
  title?: string;
  footer?: string;
  /** Per-row divider inset (default: 46px to clear the icon + gap). */
  dividerInset?: number;
  children: React.ReactNode;
}

export function SettingsCategoryCard({
  title,
  footer,
  dividerInset = 46,
  children,
}: SettingsCategoryCardProps) {
  const theme = useTheme();
  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={styles.container}>
      {title ? (
        <Text style={[styles.title, { color: theme.colors.textSecondary }]}>
          {title}
        </Text>
      ) : null}

      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.backgroundSecondary },
        ]}
      >
        {childArray.map((child, index) => (
          <React.Fragment key={index}>
            {child}
            {index < childArray.length - 1 ? (
              <View
                style={[
                  styles.divider,
                  {
                    backgroundColor: theme.colors.border,
                    marginLeft: dividerInset,
                  },
                ]}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>

      {footer ? (
        <Text style={[styles.footer, { color: theme.colors.textTertiary }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  title: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  footer: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 20,
    paddingTop: 6,
  },
});

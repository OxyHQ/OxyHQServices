import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

interface CircleIconBadgeProps {
  /** Badge background color. */
  backgroundColor: string;
  /** Glyph or image rendered inside the circular badge. */
  children: React.ReactNode;
  /** Optional extra style merged onto the badge container. */
  style?: StyleProp<ViewStyle>;
}

/**
 * 36dp circular badge used as the leading `customIcon` for grouped-section
 * rows (identity cards, payments "about" section). Centers its child and clips
 * to the circle, so it works for both vector glyphs and full-bleed images.
 */
export function CircleIconBadge({ backgroundColor, children, style }: CircleIconBadgeProps) {
  return <View style={[styles.badge, { backgroundColor }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

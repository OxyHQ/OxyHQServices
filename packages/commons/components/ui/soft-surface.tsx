import React from 'react';
import { View, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SoftSurfaceProps {
  children: React.ReactNode;
  onPress?: () => void;
  /** `primary` = soft brand tint (the rare accent); `card` = neutral fill. */
  tone?: 'primary' | 'card';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one soft highlighted surface: a rounded `primarySubtle` (or `card`) fill
 * with a continuous corner and NO border — reserved for the single accented CTA
 * on an otherwise flat screen.
 */
export function SoftSurface({ children, onPress, tone = 'primary', accessibilityLabel, style }: SoftSurfaceProps) {
  const colors = useColors();
  const background = tone === 'primary' ? colors.primarySubtle : colors.card;

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[styles.surface, { backgroundColor: background }, style]}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={[styles.surface, { backgroundColor: background }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: 24,
    borderCurve: 'continuous',
    padding: 18,
  },
});

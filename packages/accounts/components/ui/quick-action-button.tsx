import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import type { MaterialCommunityIconName } from '@/types/icons';

interface QuickActionButtonProps {
  /** MaterialCommunityIcons glyph to render inside the circular badge. */
  icon: MaterialCommunityIconName;
  /** Badge background color; the glyph is rendered in a darkened variant. */
  backgroundColor: string;
  onPress: () => void;
  accessibilityLabel: string;
  /**
   * Optional override for the icon node — used by the theme toggle, which
   * wraps the glyph in an animated container for its rotate/scale transition.
   * When provided, `icon` is ignored.
   */
  iconNode?: React.ReactNode;
}

/**
 * Circular quick-action button used by the desktop and mobile bottom action
 * bars (reload, devices, theme toggle, scan QR). Consolidates the four
 * identical `TouchableOpacity` + badge blocks that were previously inlined
 * three times across the tabs layout.
 */
export function QuickActionButton({
  icon,
  backgroundColor,
  onPress,
  accessibilityLabel,
  iconNode,
}: QuickActionButtonProps) {
  const handlePressIn = useHapticPress();

  return (
    <TouchableOpacity
      style={styles.circleButton}
      onPressIn={handlePressIn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.menuIconContainer, { backgroundColor }]}>
        {iconNode ?? (
          <MaterialCommunityIcons name={icon} size={22} color={darkenColor(backgroundColor)} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  circleButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';

interface HomeBottomActionsProps {
  onReload: () => void;
  onDevices: () => void;
  onMenu: () => void;
  onPressIn: () => void;
}

/**
 * The three circular action buttons (reload, devices, menu) at the bottom of
 * the home screen. Extracted verbatim from the home screen's footer.
 */
export function HomeBottomActions({
  onReload,
  onDevices,
  onMenu,
  onPressIn,
}: HomeBottomActionsProps) {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <View style={styles.bottomActions}>
      <TouchableOpacity
        style={styles.circleButton}
        onPressIn={onPressIn}
        onPress={onReload}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.refresh')}
      >
        <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
          <MaterialCommunityIcons name="reload" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.circleButton}
        onPressIn={onPressIn}
        onPress={onDevices}
        accessibilityRole="button"
        accessibilityLabel={t('drawer.devices')}
      >
        <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
          <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.circleButton}
        onPressIn={onPressIn}
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={t('a11y.menu')}
      >
        <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
          <MaterialCommunityIcons name="menu" size={22} color={darkenColor(colors.sidebarIconData)} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    marginBottom: 24,
  } as const,
  circleButton: {
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
});

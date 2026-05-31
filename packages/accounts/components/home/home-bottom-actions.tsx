import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import { QuickActionButton } from '@/components/ui';

/** Diameter of the home footer's circular action badges. */
const HOME_BADGE_SIZE = 36;

interface HomeBottomActionsProps {
  onReload: () => void;
  onDevices: () => void;
  onMenu: () => void;
}

/**
 * The three circular action buttons (reload, devices, menu) at the bottom of
 * the home screen. Built on the shared {@link QuickActionButton}, which owns
 * the haptic press feedback.
 */
export function HomeBottomActions({ onReload, onDevices, onMenu }: HomeBottomActionsProps) {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <View style={styles.bottomActions}>
      <QuickActionButton
        icon="reload"
        backgroundColor={colors.sidebarIconSecurity}
        onPress={onReload}
        accessibilityLabel={t('a11y.refresh')}
        size={HOME_BADGE_SIZE}
      />
      <QuickActionButton
        icon="desktop-classic"
        backgroundColor={colors.sidebarIconDevices}
        onPress={onDevices}
        accessibilityLabel={t('drawer.devices')}
        size={HOME_BADGE_SIZE}
      />
      <QuickActionButton
        icon="menu"
        backgroundColor={colors.sidebarIconData}
        onPress={onMenu}
        accessibilityLabel={t('a11y.menu')}
        size={HOME_BADGE_SIZE}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    marginBottom: 24,
  },
});

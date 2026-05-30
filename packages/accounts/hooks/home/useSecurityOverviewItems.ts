import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';
import type { HomeHandlers } from './useHomeHandlers';

interface UseSecurityOverviewItemsArgs {
  biometricEnabled: boolean;
  canEnableBiometric: boolean;
  hasBiometricHardware: boolean;
  biometricLoading: boolean;
  userEmail: string | undefined;
  handleSecurity: HomeHandlers['handleSecurity'];
}

/**
 * Builds the security-overview rows on the home screen (biometric status,
 * recovery email, overall security status). Every row links to the security
 * screen. The biometric row is native-only.
 *
 * Extracted verbatim from the screen's inline `useMemo`.
 */
export function useSecurityOverviewItems({
  biometricEnabled,
  canEnableBiometric,
  hasBiometricHardware,
  biometricLoading,
  userEmail,
  handleSecurity,
}: UseSecurityOverviewItemsArgs): GroupedItem[] {
  const colors = useColors();
  const { t } = useTranslation();

  return useMemo<GroupedItem[]>(() => {
    const items: GroupedItem[] = [];

    // Biometric status
    if (Platform.OS !== 'web') {
      let biometricSubtitle = '';
      if (biometricLoading) {
        biometricSubtitle = t('home.securityOverview.biometricChecking');
      } else if (!hasBiometricHardware) {
        biometricSubtitle = t('home.securityOverview.biometricNotAvailable');
      } else if (biometricEnabled) {
        biometricSubtitle = t('home.securityOverview.biometricEnabled');
      } else if (canEnableBiometric) {
        biometricSubtitle = t('home.securityOverview.biometricAvailable');
      } else {
        biometricSubtitle = t('home.securityOverview.biometricNotSetUp');
      }

      items.push({
        id: 'biometric',
        icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
        iconColor: biometricEnabled ? colors.success : colors.sidebarIconSecurity,
        title: Platform.OS === 'ios' ? t('home.securityOverview.faceTouchId') : t('home.securityOverview.biometricAuth'),
        subtitle: biometricSubtitle,
        onPress: handleSecurity,
      });
    }

    // Recovery email
    items.push({
      id: 'recovery-email',
      icon: 'email-check-outline',
      iconColor: userEmail ? colors.success : colors.sidebarIconSecurity,
      title: t('home.securityOverview.recoveryEmail'),
      subtitle: userEmail ? t('common.set') : t('common.notSet'),
      onPress: handleSecurity,
    });

    // Security status based on recommendations
    const hasSecurityIssues = !userEmail || (Platform.OS !== 'web' && hasBiometricHardware && !biometricEnabled && canEnableBiometric);
    items.push({
      id: 'security-status',
      icon: 'shield-lock-outline',
      iconColor: hasSecurityIssues ? colors.sidebarIconPayments : colors.success,
      title: t('home.securityOverview.securityStatus'),
      subtitle: hasSecurityIssues ? t('home.securityOverview.needsAttention') : t('home.securityOverview.protected'),
      onPress: handleSecurity,
    });

    return items;
  }, [biometricEnabled, canEnableBiometric, hasBiometricHardware, biometricLoading, colors.sidebarIconSecurity, colors.sidebarIconPayments, colors.success, userEmail, handleSecurity, t]);
}

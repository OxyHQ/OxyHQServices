import type React from 'react';
import { useCallback } from 'react';
import { View } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
import { AccountSwitcherView } from '../components/AccountSwitcher';
import { useI18n } from '../hooks/useI18n';

/**
 * Bottom-sheet route wrapper around {@link AccountSwitcherView}. Used when the
 * switcher is opened as a sheet (e.g. from the "Your accounts" entry in
 * ManageAccount) rather than as the header-chip popover (which uses the
 * `AccountSwitcher` modal directly).
 */
const AccountSwitcherScreen: React.FC<BaseScreenProps> = ({ onClose, goBack, navigate }) => {
  const { t } = useI18n();

  const close = useCallback(() => {
    (onClose ?? goBack)?.();
  }, [onClose, goBack]);

  return (
    <View className="flex-1 bg-bg">
      <Header
        title={t('accountSwitcher.title') || 'Switch account'}
        onBack={goBack}
        onClose={onClose}
        showBackButton={!!goBack}
        showCloseButton={!!onClose}
        elevation="subtle"
      />
      <AccountSwitcherView
        onClose={close}
        onAddAccount={() => navigate?.('OxyAuth')}
        onNavigateManage={() => navigate?.('ManageAccount')}
        onCreateAccount={() => navigate?.('CreateAccount')}
        onOpenAccountSettings={(accountId) => navigate?.('AccountSettings', { accountId })}
      />
    </View>
  );
};

export default AccountSwitcherScreen;

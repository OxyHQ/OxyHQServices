import { useCallback, useMemo } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { OxySignInButton, useOxy } from '@oxyhq/services';
import Section from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LogoIcon } from '@/assets/logo';
import { Colors } from '@/constants/theme';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const {
    isAuthenticated,
    user,
    logout,
    showBottomSheet,
    currentLanguage,
    currentLanguageName,
    currentNativeLanguageName,
    currentLanguageMetadata
  } = useOxy();
  const displayName = useMemo(() => {
    if (!user) return 'Unknown user';

    const fullName = user.name?.full;
    const firstLast = [user.name?.first, user.name?.last].filter(Boolean).join(' ').trim();

    return fullName || firstLast || user.username || user.email || 'Unknown user';
  }, [user]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Failed to log out', error);
      Alert.alert('Logout failed', 'Check the console for details.');
    }
  }, [logout]);

  const handleOpenAccountSettings = useCallback(() => {
    if (!showBottomSheet) {
      Alert.alert('Unavailable', 'Account settings are not available right now.');
      return;
    }

    showBottomSheet('EditProfile');
  }, [showBottomSheet]);

  const handleOpenScreen = useCallback((screen: string) => {
    if (!showBottomSheet) {
      Alert.alert('Unavailable', 'Bottom sheet is not available right now.');
      return;
    }
    showBottomSheet(screen as any);
  }, [showBottomSheet]);

  const handleOpenPaymentGateway = useCallback(() => {
    if (!showBottomSheet) {
      Alert.alert('Unavailable', 'Bottom sheet is not available right now.');
      return;
    }
    showBottomSheet({
      screen: 'PaymentGateway',
      props: {
        amount: 10,
        currency: 'FAIR',
      },
    });
  }, [showBottomSheet]);

  const handleOpenPaymentGatewayWithProducts = useCallback(() => {
    if (!showBottomSheet) {
      Alert.alert('Unavailable', 'Bottom sheet is not available right now.');
      return;
    }
    showBottomSheet({
      screen: 'PaymentGateway',
      props: {
        amount: 18, // Total: (2 * 5) + (1 * 8) = 18 FAIR
        currency: 'FAIR',
        paymentItems: [
          {
            type: 'product',
            name: 'Test Product 1',
            description: 'A sample product for testing',
            quantity: 2,
            price: 5,
          },
          {
            type: 'product',
            name: 'Test Product 2',
            description: 'Another sample product',
            quantity: 1,
            price: 8,
          },
        ],
      },
    });
  }, [showBottomSheet]);

  // Use a lighter shade of pink for the header background
  const headerBgLight = '#f0d4f5'; // Light pink background
  const headerBgDark = '#6b2d7a'; // Darker purple-pink for dark mode

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: headerBgLight, dark: headerBgDark }}
      headerImage={
        <LogoIcon
          height={171}
          style={styles.oxyLogo}
          useThemeColors={true}
        />
      }>
      <ThemedView style={styles.content}>
        <ThemedText type="title" style={styles.title}>Oxy Services Playground</ThemedText>
        <ThemedText>
          Use the button below to launch the full Oxy sign-in flow directly inside this test app.
        </ThemedText>

        <OxySignInButton />

        {/* Current Language Display */}
        <ThemedView style={styles.languageInfo}>
          <ThemedText type="subtitle">Current Language</ThemedText>
          <ThemedText type="default">
            Code: <ThemedText type="defaultSemiBold">{currentLanguage}</ThemedText>
          </ThemedText>
          <ThemedText type="default">
            Name: <ThemedText type="defaultSemiBold">{currentLanguageName}</ThemedText>
          </ThemedText>
          {currentNativeLanguageName && (
            <ThemedText type="default">
              Native: <ThemedText type="defaultSemiBold">{currentNativeLanguageName}</ThemedText>
            </ThemedText>
          )}
          {currentLanguageMetadata?.flag && (
            <ThemedText type="default" style={styles.flag}>
              {currentLanguageMetadata.flag}
            </ThemedText>
          )}
          <Pressable
            style={styles.languageButton}
            onPress={() => showBottomSheet?.('LanguageSelector')}
          >
            <ThemedText type="defaultSemiBold" style={styles.languageButtonLabel}>
              Change Language
            </ThemedText>
          </Pressable>
        </ThemedView>

        {isAuthenticated && (
          <>
            <ThemedView style={styles.authenticatedState}>
              <ThemedText type="subtitle">Signed in as</ThemedText>
              <ThemedText type="defaultSemiBold">{displayName}</ThemedText>

              <Pressable style={styles.settingsButton} onPress={handleOpenAccountSettings}>
                <ThemedText type="defaultSemiBold" style={styles.settingsLabel}>
                  Account settings
                </ThemedText>
              </Pressable>

              <Pressable style={styles.logoutButton} onPress={handleLogout}>
                <ThemedText type="defaultSemiBold" style={styles.logoutLabel}>
                  Sign out
                </ThemedText>
              </Pressable>
            </ThemedView>

            {/* Account Overview & New Features */}
            <Section title="Account Overview & Features" isFirst={true}>
              <GroupedSection
                items={[
                  {
                    id: 'account-overview',
                    icon: 'cellphone',
                    iconColor: colors.iconHome,
                    title: 'Account Overview',
                    subtitle: 'Main account screen with all features',
                    onPress: () => handleOpenScreen('AccountOverview'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Authentication Screens */}
            <Section title="Authentication">
              <GroupedSection
                items={[
                  {
                    id: 'oxy-auth',
                    icon: 'qr-code',
                    iconColor: colors.iconSecurity,
                    title: 'Sign in with Oxy',
                    subtitle: 'QR code authentication flow',
                    onPress: () => handleOpenScreen('OxyAuth'),
                    showChevron: true,
                  },
                  {
                    id: 'welcome-new-user',
                    icon: 'hand-left-outline',
                    iconColor: colors.iconSecurity,
                    title: 'Welcome New User',
                    subtitle: 'New user welcome',
                    onPress: () => handleOpenScreen('WelcomeNewUser'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Account Management */}
            <Section title="Account Management">
              <GroupedSection
                items={[
                  {
                    id: 'account-center',
                    icon: 'home',
                    iconColor: colors.iconHome,
                    title: 'Account Center',
                    subtitle: 'Main account hub',
                    onPress: () => handleOpenScreen('AccountCenter'),
                    showChevron: true,
                  },
                  {
                    id: 'account-switcher',
                    icon: 'account-group',
                    iconColor: colors.iconData,
                    title: 'Switch Account',
                    subtitle: 'Switch between accounts',
                    onPress: () => handleOpenScreen('AccountSwitcher'),
                    showChevron: true,
                  },
                  {
                    id: 'session-management',
                    icon: 'cellphone',
                    iconColor: colors.iconSecurity,
                    title: 'Sessions',
                    subtitle: 'Manage device sessions',
                    onPress: () => handleOpenScreen('SessionManagement'),
                    showChevron: true,
                  },
                  {
                    id: 'account-verification',
                    icon: 'check-circle',
                    iconColor: colors.iconSuccess,
                    title: 'Verification',
                    subtitle: 'Account verification',
                    onPress: () => handleOpenScreen('AccountVerification'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Profile & Settings */}
            <Section title="Profile & Settings">
              <GroupedSection
                items={[
                  {
                    id: 'profile',
                    icon: 'account',
                    iconColor: colors.iconPersonalInfo,
                    title: 'Profile',
                    subtitle: 'User profile',
                    onPress: () => handleOpenScreen('Profile'),
                    showChevron: true,
                  },
                  {
                    id: 'user-links',
                    icon: 'link',
                    iconColor: colors.iconSharing,
                    title: 'Links',
                    subtitle: 'User links',
                    onPress: () => handleOpenScreen('UserLinks'),
                    showChevron: true,
                  },
                  {
                    id: 'privacy-settings',
                    icon: 'lock-closed',
                    iconColor: colors.iconSecurity,
                    title: 'Privacy',
                    subtitle: 'Privacy settings',
                    onPress: () => handleOpenScreen('PrivacySettings'),
                    showChevron: true,
                  },
                  {
                    id: 'language-selector',
                    icon: 'translate',
                    iconColor: colors.iconPersonalInfo,
                    title: 'Language',
                    subtitle: 'Change language',
                    onPress: () => handleOpenScreen('LanguageSelector'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Content & Features */}
            <Section title="Content & Features">
              <GroupedSection
                items={[
                  {
                    id: 'history-view',
                    icon: 'clock',
                    iconColor: colors.iconSecurity,
                    title: 'History',
                    subtitle: 'View & manage history',
                    onPress: () => handleOpenScreen('HistoryView'),
                    showChevron: true,
                  },
                  {
                    id: 'saves-collections',
                    icon: 'bookmark',
                    iconColor: colors.iconStorage,
                    title: 'Saves',
                    subtitle: 'Saved items & collections',
                    onPress: () => handleOpenScreen('SavesCollections'),
                    showChevron: true,
                  },
                  {
                    id: 'search-settings',
                    icon: 'magnify',
                    iconColor: colors.iconSecurity,
                    title: 'Search',
                    subtitle: 'SafeSearch & settings',
                    onPress: () => handleOpenScreen('SearchSettings'),
                    showChevron: true,
                  },
                  {
                    id: 'file-management',
                    icon: 'folder',
                    iconColor: colors.iconData,
                    title: 'Files',
                    subtitle: 'File management',
                    onPress: () => handleOpenScreen('FileManagement'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Karma System */}
            <Section title="Karma System">
              <GroupedSection
                items={[
                  {
                    id: 'karma-center',
                    icon: 'star',
                    iconColor: colors.iconPayments,
                    title: 'Karma Center',
                    subtitle: 'Main karma hub',
                    onPress: () => handleOpenScreen('KarmaCenter'),
                    showChevron: true,
                  },
                  {
                    id: 'karma-leaderboard',
                    icon: 'trophy',
                    iconColor: colors.iconPayments,
                    title: 'Leaderboard',
                    subtitle: 'Karma rankings',
                    onPress: () => handleOpenScreen('KarmaLeaderboard'),
                    showChevron: true,
                  },
                  {
                    id: 'karma-rewards',
                    icon: 'gift-outline',
                    iconColor: colors.iconStorage,
                    title: 'Rewards',
                    subtitle: 'Karma rewards',
                    onPress: () => handleOpenScreen('KarmaRewards'),
                    showChevron: true,
                  },
                  {
                    id: 'karma-rules',
                    icon: 'file-document',
                    iconColor: colors.iconSecurity,
                    title: 'Rules',
                    subtitle: 'Karma rules',
                    onPress: () => handleOpenScreen('KarmaRules'),
                    showChevron: true,
                  },
                  {
                    id: 'about-karma',
                    icon: 'information',
                    iconColor: colors.iconPersonalInfo,
                    title: 'About',
                    subtitle: 'About karma',
                    onPress: () => handleOpenScreen('AboutKarma'),
                    showChevron: true,
                  },
                  {
                    id: 'karma-faq',
                    icon: 'help-circle',
                    iconColor: colors.iconPersonalInfo,
                    title: 'FAQ',
                    subtitle: 'Karma FAQ',
                    onPress: () => handleOpenScreen('KarmaFAQ'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Payments & Subscriptions */}
            <Section title="Payments & Subscriptions">
              <GroupedSection
                items={[
                  {
                    id: 'payment-gateway',
                    icon: 'card',
                    iconColor: colors.iconPayments,
                    title: 'Payment',
                    subtitle: 'Test payment flow',
                    onPress: handleOpenPaymentGateway,
                    showChevron: true,
                  },
                  {
                    id: 'payment-gateway-products',
                    icon: 'cart',
                    iconColor: colors.iconPayments,
                    title: 'Products',
                    subtitle: 'Test with products',
                    onPress: handleOpenPaymentGatewayWithProducts,
                    showChevron: true,
                  },
                  {
                    id: 'premium-subscription',
                    icon: 'star',
                    iconColor: colors.iconPayments,
                    title: 'Premium',
                    subtitle: 'Premium subscription',
                    onPress: () => handleOpenScreen('PremiumSubscription'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>

            {/* Support & Legal */}
            <Section title="Support & Legal">
              <GroupedSection
                items={[
                  {
                    id: 'help-support',
                    icon: 'help-circle',
                    iconColor: colors.iconPersonalInfo,
                    title: 'Help',
                    subtitle: 'Support & resources',
                    onPress: () => handleOpenScreen('HelpSupport'),
                    showChevron: true,
                  },
                  {
                    id: 'feedback',
                    icon: 'chatbubble-ellipses-outline',
                    iconColor: colors.iconPersonalInfo,
                    title: 'Feedback',
                    subtitle: 'Send feedback',
                    onPress: () => handleOpenScreen('Feedback'),
                    showChevron: true,
                  },
                  {
                    id: 'legal-documents',
                    icon: 'file-document',
                    iconColor: colors.iconSecurity,
                    title: 'Legal',
                    subtitle: 'Privacy & Terms',
                    onPress: () => handleOpenScreen('LegalDocuments'),
                    showChevron: true,
                  },
                  {
                    id: 'app-info',
                    icon: 'information',
                    iconColor: '#8E8E93',
                    title: 'App Info',
                    subtitle: 'App information',
                    onPress: () => handleOpenScreen('AppInfo'),
                    showChevron: true,
                  },
                ]}
              />
            </Section>
          </>
        )}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  authenticatedState: {
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  settingsButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  settingsLabel: {
    color: '#ffffff',
  },
  logoutButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1d4ed8',
  },
  logoutLabel: {
    color: '#ffffff',
  },
  languageInfo: {
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  flag: {
    fontSize: 32,
    textAlign: 'center',
    marginTop: 4,
  },
  languageButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#10b981',
  },
  languageButtonLabel: {
    color: '#ffffff',
  },
  oxyLogo: {
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});

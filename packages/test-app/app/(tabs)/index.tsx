import { Image } from 'expo-image';
import { useCallback, useMemo } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { OxySignInButton, useOxy } from '@oxyhq/services';

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
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Account Overview & Features</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Test all the new account features
              </ThemedText>

              <Pressable 
                style={styles.featureButton} 
                onPress={() => handleOpenScreen('AccountOverview')}
              >
                <ThemedText type="defaultSemiBold" style={styles.featureButtonLabel}>
                  📱 Account Overview
                </ThemedText>
                <ThemedText type="default" style={styles.featureButtonSubtext}>
                  Main account screen with all features
                </ThemedText>
              </Pressable>
            </ThemedView>

            {/* Authentication Screens */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Authentication</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Sign in, sign up, and account recovery
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('SignIn')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔐 Sign In
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Sign in screen
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('SignUp')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ✍️ Sign Up
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Create new account
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('RecoverAccount')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔑 Recover
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Account recovery
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('WelcomeNewUser')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    👋 Welcome
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    New user welcome
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>

            {/* Account Management */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Account Management</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Account settings, switching, and sessions
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('AccountCenter')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🏠 Account Center
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Main account hub
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('AccountSwitcher')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔄 Switch Account
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Switch between accounts
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('SessionManagement')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    📱 Sessions
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Manage device sessions
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('AccountVerification')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ✅ Verification
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Account verification
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>

            {/* Profile & Settings */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Profile & Settings</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Profile, links, privacy, and preferences
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('Profile')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    👤 Profile
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    User profile
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('UserLinks')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔗 Links
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    User links
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('PrivacySettings')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔒 Privacy
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Privacy settings
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('LanguageSelector')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🌐 Language
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Change language
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>

            {/* Content & Features */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Content & Features</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                History, saves, search, and files
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('HistoryView')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ⏱️ History
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    View & manage history
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('SavesCollections')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔖 Saves
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Saved items & collections
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('SearchSettings')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🔍 Search
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    SafeSearch & settings
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('FileManagement')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    📁 Files
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    File management
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>

            {/* Karma System */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Karma System</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Karma center, leaderboard, rewards, and info
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('KarmaCenter')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ⭐ Karma Center
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Main karma hub
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('KarmaLeaderboard')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🏆 Leaderboard
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Karma rankings
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('KarmaRewards')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🎁 Rewards
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Karma rewards
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('KarmaRules')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    📋 Rules
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Karma rules
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('AboutKarma')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ℹ️ About
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    About karma
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('KarmaFAQ')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ❓ FAQ
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Karma FAQ
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>

            {/* Payments & Subscriptions */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Payments & Subscriptions</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Payment gateway and premium subscriptions
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={handleOpenPaymentGateway}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    💳 Payment
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Test payment flow
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={handleOpenPaymentGatewayWithProducts}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    🛒 Products
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Test with products
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('PremiumSubscription')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ⭐ Premium
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Premium subscription
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>

            {/* Support & Legal */}
            <ThemedView style={styles.featuresSection}>
              <ThemedText type="subtitle">Support & Legal</ThemedText>
              <ThemedText type="default" style={styles.sectionDescription}>
                Help, feedback, legal documents, and app info
              </ThemedText>

              <ThemedView style={styles.featureGrid}>
                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('HelpSupport')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ❓ Help
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Support & resources
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('Feedback')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    💬 Feedback
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Send feedback
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('LegalDocuments')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    📄 Legal
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    Privacy & Terms
                  </ThemedText>
                </Pressable>

                <Pressable 
                  style={styles.featureCard} 
                  onPress={() => handleOpenScreen('AppInfo')}
                >
                  <ThemedText type="defaultSemiBold" style={styles.featureCardTitle}>
                    ℹ️ App Info
                  </ThemedText>
                  <ThemedText type="default" style={styles.featureCardSubtext}>
                    App information
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
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
  featuresSection: {
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8b5cf6',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    marginTop: 8,
  },
  sectionDescription: {
    opacity: 0.7,
    fontSize: 13,
  },
  featureButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#8b5cf6',
    marginTop: 4,
  },
  featureButtonLabel: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 4,
  },
  featureButtonSubtext: {
    color: '#ffffff',
    opacity: 0.9,
    fontSize: 12,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  featureCard: {
    flex: 1,
    minWidth: '47%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#7c3aed',
    borderWidth: 1,
    borderColor: '#8b5cf6',
  },
  featureCardTitle: {
    color: '#ffffff',
    fontSize: 14,
    marginBottom: 4,
  },
  featureCardSubtext: {
    color: '#ffffff',
    opacity: 0.85,
    fontSize: 11,
  },
});

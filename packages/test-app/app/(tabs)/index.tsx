import { Image } from 'expo-image';
import { useCallback, useMemo } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { OxySignInButton, useOxy } from '@oxyhq/services';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function HomeScreen() {
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

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.content}>
        <ThemedText type="title">Oxy Services Playground</ThemedText>
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
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
});

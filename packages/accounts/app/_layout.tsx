import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useMemo, useState } from 'react';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider, ActingAsBanner } from '@oxyhq/services';
import { useTheme } from '@oxyhq/bloom/theme';

import { ScrollProvider } from '@/contexts/scroll-context';
import AppSplashScreen from '@/components/AppSplashScreen';
import { AppInitializer } from '@/lib/appInitializer';
import { AlertProvider } from '@/components/ui';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete
SplashScreen.preventAutoHideAsync();

// Get API URL from environment variable with fallback
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export const unstable_settings = {
  anchor: '(tabs)',
};

interface SplashState {
  initializationComplete: boolean;
  startFade: boolean;
  fadeComplete: boolean;
}

export default function RootLayout() {
  const [splashState, setSplashState] = useState<SplashState>({
    initializationComplete: false,
    startFade: false,
    fadeComplete: false,
  });

  const handleSplashFadeComplete = useCallback(() => {
    setSplashState((prev) => ({ ...prev, fadeComplete: true }));
  }, []);

  const initializeApp = useCallback(async () => {
    const result = await AppInitializer.initializeApp(true);
    // Always mark complete (even on error) to unblock the app
    setSplashState((prev) => ({ ...prev, initializationComplete: true }));
    return result;
  }, []);

  // Derive splash progression from state
  const startFade = splashState.initializationComplete;
  const appIsReady = splashState.initializationComplete && splashState.fadeComplete;

  // Fire-and-forget initializer on first render
  const [initCalled, setInitCalled] = useState(false);
  if (!initCalled) {
    setInitCalled(true);
    initializeApp();
  }

  return (
    <KeyboardProvider>
      <AlertProvider>
        <OxyProvider baseURL={API_URL} themeMode="system">
          {!appIsReady ? (
            <AppSplashScreen
              startFade={startFade}
              onFadeComplete={handleSplashFadeComplete}
            />
          ) : (
            <AppStackContent />
          )}
        </OxyProvider>
      </AlertProvider>
    </KeyboardProvider>
  );
}

/** Build the react-navigation theme from Bloom's resolved colors. */
function useNavigationTheme() {
  const { mode, colors } = useTheme();
  return useMemo(
    () => ({
      dark: mode === 'dark',
      colors: {
        primary: colors.primary,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        notification: colors.error,
      },
      fonts: {
        regular: { fontFamily: 'System', fontWeight: '400' as const },
        medium: { fontFamily: 'System', fontWeight: '500' as const },
        bold: { fontFamily: 'System', fontWeight: '700' as const },
        heavy: { fontFamily: 'System', fontWeight: '900' as const },
      },
    }),
    [mode, colors],
  );
}

/** Renders the navigation stack once the app is ready. */
function AppStackContent() {
  // Must be called inside OxyProvider (which wraps BloomThemeProvider)
  const navTheme = useNavigationTheme();
  const { needsAuth } = useOnboardingStatus();

  return (
    <SafeAreaProvider>
      <ScrollProvider>
        <ThemeProvider value={navTheme}>
          <ActingAsBanner />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* Auth route redirects based on onboarding status */}
            <Stack.Screen name="(auth)" redirect={!needsAuth} options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ScrollProvider>
    </SafeAreaProvider>
  );
}

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider, FontLoader } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ScrollProvider } from '@/contexts/scroll-context';
import { ThemeProvider as AppThemeProvider } from '@/contexts/theme-context';
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
  return (
    <AppThemeProvider>
      <RootLayoutContent />
    </AppThemeProvider>
  );
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();

  // State
  const [appIsReady, setAppIsReady] = useState(false);
  const [splashState, setSplashState] = useState<SplashState>({
    initializationComplete: false,
    startFade: false,
    fadeComplete: false,
  });

  // Fonts are now loaded automatically via FontLoader from @oxyhq/services
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    // Fonts load in background via FontLoader, mark as ready immediately
    setFontsLoaded(true);
  }, []);

  // Callbacks
  const handleSplashFadeComplete = useCallback(() => {
    setSplashState((prev) => ({ ...prev, fadeComplete: true }));
  }, []);

  const initializeApp = useCallback(async () => {
    if (!fontsLoaded) return;

    const result = await AppInitializer.initializeApp(fontsLoaded);

    if (result.success) {
      setSplashState((prev) => ({ ...prev, initializationComplete: true }));
    } else {
      console.error('App initialization failed:', result.error);
      // Still mark as complete to prevent blocking the app
      setSplashState((prev) => ({ ...prev, initializationComplete: true }));
    }
  }, [fontsLoaded]);

  // Load eager settings that don't block app initialization
  useEffect(() => {
    AppInitializer.loadEagerSettings();
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  useEffect(() => {
    if (fontsLoaded && splashState.initializationComplete && !splashState.startFade) {
      setSplashState((prev) => ({ ...prev, startFade: true }));
    }
  }, [fontsLoaded, splashState.initializationComplete, splashState.startFade]);

  // Set appIsReady only after both initialization and splash fade complete
  useEffect(() => {
    if (splashState.initializationComplete && splashState.fadeComplete && !appIsReady) {
      setAppIsReady(true);
    }
  }, [splashState.initializationComplete, splashState.fadeComplete, appIsReady]);

  // Memoize app content to prevent unnecessary re-renders
  // OxyProvider must always be rendered so screens can use useOxy() hook
  // FontLoader automatically loads Inter fonts from @oxyhq/services
  const appContent = useMemo(() => {
    return (
      <FontLoader>
        <KeyboardProvider>
          <AlertProvider>
            <OxyProvider baseURL={API_URL}>
              {!appIsReady ? (
                <AppSplashScreen
                  startFade={splashState.startFade}
                  onFadeComplete={handleSplashFadeComplete}
                />
              ) : (
                <AppStackContent colorScheme={colorScheme} />
              )}
            </OxyProvider>
          </AlertProvider>
        </KeyboardProvider>
      </FontLoader>
    );
  }, [
    appIsReady,
    splashState.startFade,
    colorScheme,
    handleSplashFadeComplete,
  ]);

  return appContent;
}

// Component that uses onboarding status hook for routing decisions
function AppStackContent({ colorScheme }: { colorScheme: 'light' | 'dark' | null }) {
  const { needsAuth } = useOnboardingStatus();

  return (
    <SafeAreaProvider>
      <ScrollProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* Auth route redirects based on onboarding status */}
            <Stack.Screen name="(auth)" redirect={!needsAuth} options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ScrollProvider>
    </SafeAreaProvider>
  );
}

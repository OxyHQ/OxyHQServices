import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { OxyProvider } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ScrollProvider } from '@/contexts/scroll-context';
import { ThemeProvider as AppThemeProvider } from '@/contexts/theme-context';
import AppSplashScreen from '@/components/AppSplashScreen';
import { AppInitializer } from '@/lib/appInitializer';
import { AlertProvider } from '@/components/ui';
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

  // Font Loading
  const [fontsLoaded] = useFonts({
    'Phudu-Light': require('@/assets/fonts/Phudu/Phudu-Light.ttf'),
    'Phudu-Regular': require('@/assets/fonts/Phudu/Phudu-Regular.ttf'),
    'Phudu-Medium': require('@/assets/fonts/Phudu/Phudu-Medium.ttf'),
    'Phudu-SemiBold': require('@/assets/fonts/Phudu/Phudu-SemiBold.ttf'),
    'Phudu-Bold': require('@/assets/fonts/Phudu/Phudu-Bold.ttf'),
    'Phudu-ExtraBold': require('@/assets/fonts/Phudu/Phudu-ExtraBold.ttf'),
    'Phudu-Black': require('@/assets/fonts/Phudu/Phudu-Black.ttf'),
  });

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
  const appContent = useMemo(() => {
    return (
      <AlertProvider>
        <OxyProvider baseURL={API_URL}>
          {!appIsReady ? (
            <AppSplashScreen
              startFade={splashState.startFade}
              onFadeComplete={handleSplashFadeComplete}
            />
          ) : (
            <SafeAreaProvider>
              <ScrollProvider>
                <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                  <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    {/* Auth route is only available on native platforms */}
                    <Stack.Screen name="(auth)" redirect={Platform.OS === 'web'} options={{ headerShown: false }} />
                    <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
                  </Stack>
                  <StatusBar style="auto" />
                </ThemeProvider>
              </ScrollProvider>
            </SafeAreaProvider>
          )}
        </OxyProvider>
      </AlertProvider>
    );
  }, [
    appIsReady,
    splashState.startFade,
    colorScheme,
    handleSplashFadeComplete,
  ]);

  return appContent;
}

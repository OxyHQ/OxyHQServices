import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider, toast } from '@oxyhq/services';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTheme } from '@oxyhq/bloom/theme';

import { queryClient } from '@/hooks/queries/queryClient';
import { ThemeProvider as AppThemeProvider } from '@/contexts/theme-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { registerServiceWorker } from '@/utils/registerServiceWorker';
import { onConnectivityChange, flushQueue } from '@/utils/offlineQueue';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AppThemeProvider>
        <RootLayoutContent />
      </AppThemeProvider>
    </ErrorBoundary>
  );
}

function RootLayoutContent() {
  const { mode } = useTheme();
  const [appIsReady, setAppIsReady] = useState(false);

  const initialize = useCallback(async () => {
    try {
      // Allow fonts to load via OxyProvider
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      setAppIsReady(true);
      await SplashScreen.hideAsync();
    }
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Register service worker on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    registerServiceWorker(() => {
      toast.info('New version available — refresh to update.');
    });

    // Flush offline queue when connectivity returns
    const unsubscribe = onConnectivityChange((online) => {
      if (online) {
        flushQueue().then((count) => {
          if (count > 0) {
            toast.success(`Synced ${count} offline action${count > 1 ? 's' : ''}.`);
          }
        }).catch(() => {});
      }
    });

    return unsubscribe;
  }, []);

  const content = useMemo(
    () => (
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <OxyProvider baseURL={API_URL}>
            <SafeAreaProvider>
              <ThemeProvider value={mode === 'dark' ? DarkTheme : DefaultTheme}>
                <Stack>
                  <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
                  <Stack.Screen name="+not-found" options={{ headerShown: false }} />
                </Stack>
                <StatusBar style="auto" />
              </ThemeProvider>
            </SafeAreaProvider>
          </OxyProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    ),
    [mode],
  );

  if (!appIsReady) return null;
  return content;
}

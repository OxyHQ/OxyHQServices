import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider } from '@oxyhq/services';
import { QueryClientProvider } from '@tanstack/react-query';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { queryClient } from '@/hooks/queries/queryClient';
import { ThemeProvider as AppThemeProvider } from '@/contexts/theme-context';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootLayoutContent />
    </AppThemeProvider>
  );
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
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

  const content = useMemo(
    () => (
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <OxyProvider baseURL={API_URL}>
            <SafeAreaProvider>
              <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                <Stack>
                  <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
                </Stack>
                <StatusBar style="auto" />
              </ThemeProvider>
            </SafeAreaProvider>
          </OxyProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    ),
    [colorScheme],
  );

  if (!appIsReady) return null;
  return content;
}

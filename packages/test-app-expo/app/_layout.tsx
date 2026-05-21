import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OxyProvider } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';
const AUTH_REDIRECT_URI = Linking.createURL('/');

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <OxyProvider baseURL={API_URL} authRedirectUri={AUTH_REDIRECT_URI}>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            <StatusBar style="auto" />
          </ThemeProvider>
        </OxyProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { OxyProvider } from '@oxyhq/services';
import { Toaster } from 'sonner-native';
import { SideBar } from '@/components/sidebar';
import { RightBar } from '@/components/rightbar';
import { BottomBar } from '@/components/bottombar';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { width } = useWindowDimensions();

  // Determine if we should show desktop layout
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          flexDirection: isDesktop ? 'row' : 'column',
          backgroundColor: colors.background,
        },
        mainContent: {
          flex: 1,
          maxWidth: isDesktop ? 1400 : undefined,
          marginHorizontal: isDesktop ? 'auto' : 0,
          flexDirection: isDesktop ? 'row' : 'column',
          backgroundColor: colors.background,
        },
        mainContentWrapper: {
          flex: isDesktop ? 2.2 : 1,
          ...(isDesktop
            ? {
              borderLeftWidth: 0.5,
              borderRightWidth: 0.5,
              borderColor: colors.border,
            }
            : {}),
          backgroundColor: colors.background,
        },
      }),
    [isDesktop, colors.background, colors.border]
  );

  return (
    <OxyProvider
      baseURL={process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001'}
    >
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {isDesktop ? (
          // Desktop layout with SideBar, MainContent, RightBar
          <View style={styles.container}>
            <SideBar />
            <View style={styles.mainContent}>
              <ThemedView style={styles.mainContentWrapper}>
                <Slot />
              </ThemedView>
              <RightBar />
            </View>
          </View>
        ) : (
          // Mobile layout with bottom bar
          <View style={{ flex: 1 }}>
            <Slot />
            <BottomBar />
          </View>
        )}
        <StatusBar style="auto" />
        <Toaster position="bottom-center" />
      </ThemeProvider>
    </OxyProvider>
  );
}

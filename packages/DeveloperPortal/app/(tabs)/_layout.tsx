import { Tabs } from 'expo-router';
import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { SideBar } from '@/components/sidebar';
import { RightBar } from '@/components/rightbar';
import { BottomBar } from '@/components/bottombar';
import { ThemedView } from '@/components/themed-view';

export default function TabLayout() {
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
          maxWidth: isDesktop ? 1100 : undefined,
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

  if (isDesktop) {
    // Desktop layout with SideBar, MainContent, RightBar
    return (
      <View style={styles.container}>
        <SideBar />
        <View style={styles.mainContent}>
          <ThemedView style={styles.mainContentWrapper}>
            <Tabs
              screenOptions={{
                tabBarActiveTintColor: colors.tint,
                headerShown: false,
                tabBarButton: HapticTab,
                tabBarStyle: { display: 'none' }, // Hide tab bar on desktop
              }}
            >
              <Tabs.Screen
                name="index"
                options={{
                  title: 'Apps',
                  tabBarIcon: ({ color }) => <Ionicons name="apps" size={24} color={color} />,
                }}
              />
              <Tabs.Screen
                name="explore"
                options={{
                  title: 'Documentation',
                  tabBarIcon: ({ color }) => <Ionicons name="book" size={24} color={color} />,
                }}
              />
              <Tabs.Screen
                name="settings"
                options={{
                  title: 'Settings',
                  tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
                }}
              />
            </Tabs>
          </ThemedView>
          <RightBar />
        </View>
      </View>
    );
  }

  // Mobile layout with bottom tab bar
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.tint,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: { display: 'none' }, // Hide default tab bar, we'll use custom BottomBar
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Apps',
            tabBarIcon: ({ color }) => <Ionicons name="apps" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: 'Documentation',
            tabBarIcon: ({ color }) => <Ionicons name="book" size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color }) => <Ionicons name="settings" size={24} color={color} />,
          }}
        />
      </Tabs>
      <BottomBar />
    </View>
  );
}

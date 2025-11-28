import { Tabs, Slot } from 'expo-router';
import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, TextInput } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { DesktopSidebar, Logo } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { Ionicons } from '@expo/vector-icons';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const toggleColorScheme = () => {
    // This would toggle between light and dark mode
    // You'd need to implement this based on your theme system
  };

  // Render desktop layout with sidebar
  if (isDesktop) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Top Header Bar */}
        <View style={[styles.desktopTopBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <View style={styles.topBarLeft}>
            <Logo height={32} />
          </View>
          <View style={styles.searchBarContainer}>
            <View style={[styles.searchBar, { backgroundColor: colors.card }]}>
              <Ionicons name="search-outline" size={20} color={colors.icon} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search Oxy Account"
                placeholderTextColor={colors.secondaryText}
              />
            </View>
          </View>
          <View style={styles.topBarRight}>
            <TouchableOpacity style={styles.iconButton} onPress={toggleColorScheme}>
              <Ionicons name={colorScheme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.icon} />
            </TouchableOpacity>
            <UserAvatar name="Nate Isern Alvarez" size={36} />
          </View>
        </View>

        <View style={styles.desktopBody}>
          <DesktopSidebar />
          <ScrollView
            style={styles.desktopMain}
            contentContainerStyle={styles.desktopMainContent}
            showsVerticalScrollIndicator={false}
          >
            <Slot />
          </ScrollView>
        </View>
      </View>
    );
  }

  // Mobile layout - use tabs
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="security"
        options={{
          title: 'Security',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="lock.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="clock.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="data"
        options={{
          title: 'Data',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="server.rack" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null, // Hide explore tab
        }}
      />
      <Tabs.Screen
        name="personal-info"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="password-manager"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="sharing"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="family"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="storage"
        options={{
          href: null, // Hide from tab bar
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  desktopTopBar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 200,
  },
  searchBarContainer: {
    flex: 1,
    maxWidth: 600,
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    gap: 12,
  },
  searchIcon: {
    opacity: 0.6,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 100,
    justifyContent: 'flex-end',
  },
  iconButton: {
    padding: 8,
    borderRadius: 20,
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopMain: {
    flex: 1,
  },
  desktopMainContent: {
    padding: 24,
  },
});

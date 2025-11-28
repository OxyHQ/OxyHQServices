import { Slot } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, TextInput } from 'react-native';
import { useRouter, usePathname, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { DesktopSidebar, DrawerContent, Logo, MobileHeader } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { Ionicons } from '@expo/vector-icons';
import { useScrollContext } from '@/contexts/scroll-context';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ q?: string }>();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);
  const { setIsScrolled } = useScrollContext();

  const handleScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    setIsScrolled(offsetY > 10);
  }, [setIsScrolled]);

  const toggleColorScheme = () => {
    // This would toggle between light and dark mode
    // You'd need to implement this based on your theme system
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    // Always navigate to search screen, even when empty
    if (pathname === '/(tabs)/search') {
      // If already on search screen, just update params
      router.setParams({ q: text || '' });
    } else {
      // Navigate to search screen
      router.push({
        pathname: '/(tabs)/search',
        params: { q: text || '' },
      });
    }
  };

  // Sync search query with route params when on search screen
  useEffect(() => {
    if (pathname === '/(tabs)/search') {
      // Sync header input with route params
      const queryFromParams = params.q || '';
      setSearchQuery(queryFromParams);
    } else {
      // Clear search when navigating away from search screen
      setSearchQuery('');
    }
  }, [pathname, params.q]);

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
              <Ionicons name="search-outline" size={20} color={colors.text} style={styles.searchIcon} />
              <TextInput
                ref={searchInputRef}
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search Oxy Account"
                placeholderTextColor={colors.secondaryText}
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
              />
            </View>
          </View>
          <View style={styles.topBarRight}>
            <TouchableOpacity style={styles.iconButton} onPress={toggleColorScheme}>
              <Ionicons name={colorScheme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={22} color={colors.text} />
            </TouchableOpacity>
            <UserAvatar name="Nate Isern Alvarez" size={36} />
          </View>
        </View>

        <View style={styles.desktopBody}>
          <View style={styles.desktopSidebarColumn}>
            <DesktopSidebar />
          </View>
          <View style={styles.desktopContentColumn}>
            <View style={styles.desktopContentWrapper}>
              <ScrollView
                style={styles.desktopMain}
                contentContainerStyle={styles.desktopMainContent}
                showsVerticalScrollIndicator={false}
              >
                <Slot />
              </ScrollView>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Mobile layout - use drawer
  // Note: expo-router Drawer renders screens independently, so we can't have a single ScrollView
  // Instead, we'll remove ScrollViews from screens and they should use ScreenContentWrapper
  // OR we apply ScrollView via a custom solution
  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: true,
        header: () => <MobileHeader />,
        headerStyle: {
          backgroundColor: colors.background,
        },
        drawerStyle: {
          backgroundColor: 'transparent',
        },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          drawerLabel: 'Home',
          title: 'Home',
        }}
      />
      <Drawer.Screen
        name="personal-info"
        options={{
          drawerLabel: 'Personal info',
          title: 'Personal info',
        }}
      />
      <Drawer.Screen
        name="security"
        options={{
          drawerLabel: 'Security & sign-in',
          title: 'Security & sign-in',
        }}
      />
      <Drawer.Screen
        name="password-manager"
        options={{
          drawerLabel: 'Password Manager',
          title: 'Password Manager',
        }}
      />
      <Drawer.Screen
        name="devices"
        options={{
          drawerLabel: 'Your devices',
          title: 'Your devices',
        }}
      />
      <Drawer.Screen
        name="data"
        options={{
          drawerLabel: 'Data & privacy',
          title: 'Data & privacy',
        }}
      />
      <Drawer.Screen
        name="sharing"
        options={{
          drawerLabel: 'People & sharing',
          title: 'People & sharing',
        }}
      />
      <Drawer.Screen
        name="family"
        options={{
          drawerLabel: 'Family Group',
          title: 'Family Group',
        }}
      />
      <Drawer.Screen
        name="payments"
        options={{
          drawerLabel: 'Payments & subscriptions',
          title: 'Payments & subscriptions',
        }}
      />
      <Drawer.Screen
        name="storage"
        options={{
          drawerLabel: 'Oxy storage',
          title: 'Oxy storage',
        }}
      />
      <Drawer.Screen
        name="explore"
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="sessions"
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="search"
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
    </Drawer>
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
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 350,
  },
  searchBarContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    gap: 12,
    maxWidth: 600,
    width: '100%',
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
  desktopSidebarColumn: {
    minWidth: 350,
    alignItems: 'flex-start',
  },
  desktopContentColumn: {
    flex: 1,
    alignItems: 'center',
  },
  desktopContentWrapper: {
    width: '100%',
    maxWidth: 800,
    flex: 1,
  },
  desktopMain: {
    flex: 1,
  },
  desktopMainContent: {
    padding: 24,
  },
});

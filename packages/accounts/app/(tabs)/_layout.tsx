import { Slot, useRouter, usePathname } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import React, { useMemo, useRef, useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, TextInput, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { DesktopSidebar, DrawerContent } from '@/components/ui';
import { Header } from '@/components/header';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useScrollContext } from '@/contexts/scroll-context';
import { useThemeContext } from '@/contexts/theme-context';
import { useOxy } from '@oxyhq/services';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useSearchNavigation } from '@/hooks/use-search-navigation';
import { darkenColor } from '@/utils/color-utils';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming, runOnJS } from 'react-native-reanimated';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const searchInputRef = useRef<TextInput>(null);

  // Use custom hook for search navigation management (has side effects)
  useSearchNavigation({ searchInputRef });
  const { setIsScrolled, scrollToTop, scrollY } = useScrollContext();
  const { toggleColorScheme } = useThemeContext();
  const [showGoToTopButton, setShowGoToTopButton] = useState(false);

  const { showBottomSheet, refreshSessions } = useOxy();
  const { scrollRef } = useScrollContext();

  const handlePressIn = useHapticPress();

  const handleReload = useCallback(async () => {
    if (!refreshSessions) return;
    try {
      await refreshSessions();
    } catch (error) {
      console.error('Failed to refresh sessions', error);
    }
  }, [refreshSessions]);

  const handleDevices = useCallback(() => {
    showBottomSheet?.('SessionManagement');
  }, [showBottomSheet]);

  const handleScanQR = useCallback(() => {
    router.push('/(tabs)/scan-qr');
  }, [router]);

  const handleGoToTop = useCallback(() => {
    scrollToTop();
  }, [scrollToTop]);

  // Update showGoToTopButton state using runOnJS to avoid reading .value during render
  const updateShowGoToTopButton = useCallback((shouldShow: boolean) => {
    setShowGoToTopButton(shouldShow);
  }, []);

  // Determine if FAB should show scan or go to top based on scroll position
  const showGoToTop = useDerivedValue(() => {
    const shouldShow = scrollY.value > 100; // Show go to top after scrolling 100px
    runOnJS(updateShowGoToTopButton)(shouldShow);
    return shouldShow;
  }, [updateShowGoToTopButton]);

  // Animated styles for FAB icon transition
  const fabIconAnimatedStyle = useAnimatedStyle(() => {
    const showTop = showGoToTop.value;
    return {
      opacity: withTiming(showTop ? 1 : 0, { duration: 200 }),
      transform: [{ scale: withTiming(showTop ? 1 : 0.8, { duration: 200 }) }],
    };
  }, []);

  const scanIconAnimatedStyle = useAnimatedStyle(() => {
    const showTop = showGoToTop.value;
    return {
      opacity: withTiming(showTop ? 0 : 1, { duration: 200 }),
      transform: [{ scale: withTiming(showTop ? 0.8 : 1, { duration: 200 }) }],
    };
  }, []);

  const handleScroll = useCallback((event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    setIsScrolled(offsetY > 10);
  }, [setIsScrolled]);

  if (isDesktop) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header />

        <View style={styles.desktopBody}>
          <View style={styles.desktopSidebarColumn}>
            <DesktopSidebar />
          </View>
          <View style={styles.desktopContentColumn}>
            <View style={styles.desktopContentWrapper}>
              <ScrollView
                ref={scrollRef as React.RefObject<ScrollView>}
                style={styles.desktopMain}
                contentContainerStyle={styles.desktopMainContent}
                showsVerticalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
              >
                <Slot />
              </ScrollView>
            </View>
          </View>
        </View>

        <View style={styles.desktopBottomActions}>
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleScanQR}>
              <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
                <MaterialCommunityIcons name="qrcode-scan" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleReload}>
            <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
              <MaterialCommunityIcons name="reload" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleDevices}>
            <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
              <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={toggleColorScheme}>
            <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
              <MaterialCommunityIcons name={colorScheme === 'dark' ? 'weather-sunny' : 'weather-night'} size={22} color={darkenColor(colors.sidebarIconData)} />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.mobileContainer, { backgroundColor: colors.background }]}>
      <Drawer
        drawerContent={(props) => <DrawerContent {...props} />}
        screenOptions={{
          headerShown: true,
          header: () => <Header />,
          headerTransparent: true,
          headerStyle: {
            backgroundColor: 'transparent',
            height: 0,
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
        {Platform.OS !== 'web' && (
          <Drawer.Screen
            name="about-identity"
            options={{
              drawerLabel: 'About Your Identity',
              title: 'About Your Identity',
            }}
          />
        )}
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
            drawerLabel: 'Third-party connections',
            title: 'Third-party connections',
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
        <Drawer.Screen
          name="authorize"
          options={{
            drawerItemStyle: { display: 'none' },
            title: 'Authorize',
          }}
        />
        <Drawer.Screen
          name="scan-qr"
          options={{
            drawerItemStyle: { display: 'none' },
            title: 'Scan QR Code',
            headerShown: false,
          }}
        />
      </Drawer>

      {/* Bottom actions - Mobile: keep parity with desktop quick actions */}
      <View style={styles.mobileBottomActions}>
        <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleReload}>
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
            <MaterialCommunityIcons name="reload" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleDevices}>
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
            <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={toggleColorScheme}>
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
            <MaterialCommunityIcons name={colorScheme === 'dark' ? 'weather-sunny' : 'weather-night'} size={22} color={darkenColor(colors.sidebarIconData)} />
          </View>
        </TouchableOpacity>
      </View>

      {/* FAB Button - Mobile - Changes between Scan and Go to Top */}
      {Platform.OS !== 'web' && !pathname.includes('scan-qr') && (
        <View style={styles.fabButton}>
          <TouchableOpacity
            style={styles.circleButton}
            onPressIn={handlePressIn}
            onPress={showGoToTopButton ? handleGoToTop : handleScanQR}
            activeOpacity={0.8}
          >
            <View style={[styles.fabIconContainer, { backgroundColor: colorScheme === 'dark' ? colors.text : colors.background }]}>
              {/* Scan Icon - shown when at top */}
              <Animated.View style={[styles.fabIconAbsolute, scanIconAnimatedStyle]}>
                <MaterialCommunityIcons name="qrcode-scan" size={26} color={colorScheme === 'dark' ? colors.background : colors.text} />
              </Animated.View>
              {/* Go to Top Icon - shown when scrolling */}
              <Animated.View style={[styles.fabIconAbsolute, fabIconAnimatedStyle]}>
                <MaterialCommunityIcons name="arrow-up" size={26} color={colorScheme === 'dark' ? colors.background : colors.text} />
              </Animated.View>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  mobileContainer: {
    flex: 1,
    position: 'relative',
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
    paddingTop: 88,
  },
  desktopBottomActions: {
    bottom: 24,
    right: 24,
    flexDirection: 'row',
    gap: 16,
    zIndex: 1000,
    ...Platform.select({
      web: {
        position: 'fixed' as any,
      },
      default: {
        position: 'absolute' as any,
      },
    }),
  },
  circleButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabButton: {
    bottom: 32,
    right: 32,
    zIndex: 1000,
    ...Platform.select({
      web: {
        position: 'fixed' as any,
      },
      default: {
        position: 'absolute' as any,
      },
    }),
  },
  fabIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      },
    }),
  },
  fabIconAbsolute: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileBottomActions: {
    bottom: 24,
    right: 24,
    flexDirection: 'row',
    gap: 12,
    zIndex: 1000,
    ...Platform.select({
      web: {
        position: 'fixed' as any,
      },
      default: {
        position: 'absolute' as any,
      },
    }),
  },
});

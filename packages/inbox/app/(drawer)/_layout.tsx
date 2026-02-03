import { Drawer } from 'expo-router/drawer';
import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { MailboxDrawer } from '@/components/MailboxDrawer';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';

export default function DrawerLayout() {
  const colorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { isAuthenticated, oxyServices } = useOxy();
  const _initApi = useEmailStore((s) => s._initApi);

  // Initialize email API with httpService when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      _initApi(oxyServices.httpService);
    }
  }, [isAuthenticated, oxyServices, _initApi]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Drawer
        drawerContent={(props) => (
          <MailboxDrawer
            onClose={() => {
              (props.navigation as any).closeDrawer();
            }}
          />
        )}
        screenOptions={{
          headerShown: false,
          drawerType: isDesktop ? 'permanent' : 'front',
          drawerStyle: {
            width: isDesktop ? 280 : 300,
            backgroundColor: colors.sidebarBackground,
            borderRightWidth: isDesktop ? StyleSheet.hairlineWidth : 0,
            borderRightColor: colors.border,
            ...Platform.select({
              web: {
                boxShadow: 'none',
              },
              default: {},
            }),
          },
          overlayColor: 'rgba(0,0,0,0.3)',
          swipeEnabled: Platform.OS !== 'web',
        }}
      >
        <Drawer.Screen name="home" options={{ title: 'Home', drawerItemStyle: { display: 'none' } }} />
        <Drawer.Screen name="(inbox)" options={{ title: 'Inbox' }} />
        <Drawer.Screen name="for-you" options={{ title: 'For You', drawerItemStyle: { display: 'none' } }} />
        <Drawer.Screen name="search" options={{ title: 'Search', drawerItemStyle: { display: 'none' } }} />
        <Drawer.Screen name="settings" options={{ title: 'Settings', drawerItemStyle: { display: 'none' } }} />
      </Drawer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

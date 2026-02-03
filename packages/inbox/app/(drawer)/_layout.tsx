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
  const sidebarCollapsed = useEmailStore((s) => s.sidebarCollapsed);

  // Initialize email API with httpService when authenticated
  useEffect(() => {
    console.log('[DrawerLayout] Auth state:', { isAuthenticated, hasHttpService: !!oxyServices?.httpService });
    if (isAuthenticated) {
      console.log('[DrawerLayout] Initializing email API...');
      const result = _initApi(oxyServices.httpService);
      console.log('[DrawerLayout] Email API initialized:', !!result);
    }
  }, [isAuthenticated, oxyServices, _initApi]);

  const drawerWidth = isDesktop ? (sidebarCollapsed ? 64 : 280) : 300;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Drawer
        drawerContent={(props) => (
          <MailboxDrawer
            collapsed={isDesktop && sidebarCollapsed}
            onToggle={() => useEmailStore.getState().toggleSidebar()}
            onClose={() => {
              (props.navigation as any).closeDrawer();
            }}
          />
        )}
        screenOptions={{
          headerShown: false,
          drawerType: isDesktop ? 'permanent' : 'front',
          drawerStyle: {
            width: drawerWidth,
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

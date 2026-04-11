import { Drawer } from 'expo-router/drawer';
import React, { useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useColors } from '@/constants/theme';
import { MailboxDrawer } from '@/components/MailboxDrawer';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';

export default function DrawerLayout() {
  const { width } = useWindowDimensions();
  const colors = useColors();
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { isAuthenticated, oxyServices } = useOxy();
  const _initApi = useEmailStore((s) => s._initApi);
  const hasApi = useEmailStore((s) => s._api !== null);
  const sidebarCollapsed = useEmailStore((s) => s.sidebarCollapsed);

  // Initialize email API with httpService when authenticated.
  // Also re-initializes after an account switch resets the store (_api becomes null).
  useEffect(() => {
    if (isAuthenticated && !hasApi) {
      _initApi(oxyServices.httpService);
    }
  }, [isAuthenticated, oxyServices, _initApi, hasApi]);

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
        <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
      </Drawer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

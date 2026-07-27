import { Drawer } from 'expo-router/drawer';
import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/constants/theme';
import { MailboxDrawer } from '@/components/MailboxDrawer';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import { useIsDesktopLayout } from '@/hooks/useIsDesktopLayout';

export default function DrawerLayout() {
  const colors = useColors();
  // Shared with the floating tab bar, which renders exactly when this is false.
  // One condition for both, so a viewport can never end up with a permanent
  // sidebar AND a floating bar, or with neither.
  const isDesktop = useIsDesktopLayout();
  const { isAuthenticated, oxyServices } = useOxy();
  const _initApi = useEmailStore((s) => s._initApi);
  const hasApi = useEmailStore((s) => s._api !== null);
  const sidebarCollapsed = useEmailStore((s) => s.sidebarCollapsed);

  // Initialize email API with httpService when authenticated.
  // Also re-initializes after an account switch resets the store (_api becomes null).
  // Deps deliberately exclude `oxyServices` (object identity changes on every
  // render) and `_initApi` (stable zustand action); the effect reads them
  // imperatively from the closure when triggered.
  useEffect(() => {
    if (hasApi) return;
    if (!isAuthenticated) return;
    _initApi(oxyServices.httpService);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, hasApi]);

  const drawerWidth = isDesktop ? (sidebarCollapsed ? 64 : 280) : 300;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Drawer
        drawerContent={(props) => (
          <MailboxDrawer
            collapsed={isDesktop && sidebarCollapsed}
            onToggle={() => useEmailStore.getState().toggleSidebar()}
            onClose={() => {
              // Synthesize the DrawerActions.closeDrawer payload inline —
              // expo-router v56 rejects direct `@react-navigation/*` imports.
              props.navigation.dispatch({ type: 'CLOSE_DRAWER' });
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

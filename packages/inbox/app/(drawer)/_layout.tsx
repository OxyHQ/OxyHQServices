import { Drawer } from 'expo-router/drawer';
import React, { useMemo, useEffect, useCallback } from 'react';
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
  const { isAuthenticated } = useOxy();
  const { getToken } = useOxy() as any;
  const { loadMailboxes, mailboxesLoaded, currentMailbox, loadMessages } = useEmailStore();

  // Load mailboxes on auth
  const initEmail = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const token = await getToken?.();
      if (!token) return;
      if (!mailboxesLoaded) {
        await loadMailboxes(token);
      }
    } catch {}
  }, [isAuthenticated, mailboxesLoaded, getToken, loadMailboxes]);

  useEffect(() => {
    initEmail();
  }, [initEmail]);

  // Load messages when mailbox is set
  useEffect(() => {
    if (!currentMailbox || !isAuthenticated) return;
    const load = async () => {
      try {
        const token = await getToken?.();
        if (token) {
          await loadMessages(token, currentMailbox._id);
        }
      } catch {}
    };
    load();
  }, [currentMailbox?._id, isAuthenticated]);

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
            borderRightWidth: 0,
            ...Platform.select({
              web: {
                boxShadow: isDesktop ? 'none' : '2px 0 8px rgba(0,0,0,0.15)',
              },
              default: {},
            }),
          },
          overlayColor: 'rgba(0,0,0,0.3)',
          swipeEnabled: Platform.OS !== 'web',
        }}
      >
        <Drawer.Screen name="index" options={{ title: 'Inbox' }} />
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

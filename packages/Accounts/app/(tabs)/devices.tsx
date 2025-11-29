import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import * as Haptics from 'expo-haptics';

export default function DevicesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const handlePressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const devices = useMemo(() => [
    {
      id: 'current',
      icon: 'laptop',
      iconColor: colors.sidebarIconDevices,
      title: 'MacBook Pro',
      subtitle: 'This device • Last active: Now',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Current</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'iphone',
      icon: 'cellphone',
      iconColor: colors.sidebarIconDevices,
      title: 'iPhone 15 Pro',
      subtitle: 'Last active: 2 hours ago',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Remove</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'ipad',
      icon: 'tablet',
      iconColor: colors.sidebarIconDevices,
      title: 'iPad Air',
      subtitle: 'Last active: 1 day ago',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Remove</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors, handlePressIn]);


  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Your devices" subtitle="Manage devices that have access to your account." />
        <AccountCard>
          <GroupedSection items={devices} />
        </AccountCard>
      </>
    );
  }

  return (
    <ScreenContentWrapper>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
        <ScreenHeader title="Your devices" subtitle="Manage devices that have access to your account." />
        <AccountCard>
          <GroupedSection items={devices} />
        </AccountCard>
        </View>
    </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopSidebar: {
    width: 260,
    padding: 20,
  },
  desktopHeader: {
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  },
  welcomeSubtext: {
    fontSize: 13,
    opacity: 0.6,
  },
  menuContainer: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 26,
    gap: 12,
  },
  menuItemActive: {},
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '400',
  },
  desktopMain: {
    flex: 1,
    maxWidth: 720,
  },
  desktopMainContent: {
    padding: 32,
  },
  headerSection: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
  },
  accountCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  mobileHeaderSection: {
    marginBottom: 20,
  },
  mobileTitle: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
  },
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
  },
});


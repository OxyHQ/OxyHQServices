import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';

export default function DataScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const dataItems = useMemo(() => [
    {
      id: 'download',
      icon: 'download-outline',
      iconColor: colors.sidebarIconData,
      title: 'Download your data',
      subtitle: 'Get a copy of your data',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Download</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'activity',
      icon: 'history',
      iconColor: colors.sidebarIconData,
      title: 'Activity controls',
      subtitle: 'Manage your activity history',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Manage</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'location',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Location history',
      subtitle: 'View and manage location data',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'privacy',
      icon: 'shield-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Privacy settings',
      subtitle: 'Control your privacy preferences',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Configure</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'delete',
      icon: 'delete-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Delete account',
      subtitle: 'Permanently delete your account',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: '#FF3B30' }]}>Delete</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors]);


  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Data & privacy" subtitle="Manage your data and privacy settings." />
        <AccountCard>
          <GroupedSection items={dataItems} />
        </AccountCard>
      </>
    );
  }

  return (
    <ScreenContentWrapper>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
        <ScreenHeader title="Data & privacy" subtitle="Manage your data and privacy settings." />
        <AccountCard>
          <GroupedSection items={dataItems} />
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

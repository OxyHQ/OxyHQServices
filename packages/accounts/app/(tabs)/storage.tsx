import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useHapticPress } from '@/hooks/use-haptic-press';

export default function StorageScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const handlePressIn = useHapticPress();

  const storageItems = useMemo(() => [
    {
      id: 'usage',
      icon: 'chart-pie',
      iconColor: colors.sidebarIconStorage,
      title: 'Storage used',
      subtitle: '12.5 GB of 15 GB',
      customContent: (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { backgroundColor: colors.tint, width: '83%' }]} />
          </View>
        </View>
      ),
    },
    {
      id: 'files',
      icon: 'file-outline',
      iconColor: colors.sidebarIconData,
      title: 'Files',
      subtitle: '8.2 GB',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'photos',
      icon: 'image-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Photos',
      subtitle: '3.1 GB',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'backups',
      icon: 'backup-restore',
      iconColor: colors.sidebarIconSecurity,
      title: 'Backups',
      subtitle: '1.2 GB',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Manage</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors]);

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Oxy storage" subtitle="Manage your storage usage and files." />
        <AccountCard>
          <GroupedSection items={storageItems} />
        </AccountCard>
      </>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenContentWrapper>
        <View style={styles.mobileContent}>
        <ScreenHeader title="Oxy storage" subtitle="Manage your storage usage and files." />
        <AccountCard>
          <GroupedSection items={storageItems} />
        </AccountCard>
        </View>
      </ScreenContentWrapper>
    </View>
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
  progressContainer: {
    width: 120,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
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


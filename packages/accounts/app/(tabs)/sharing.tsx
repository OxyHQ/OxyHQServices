import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useHapticPress } from '@/hooks/use-haptic-press';

export default function SharingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const handlePressIn = useHapticPress();

  const sharedItems = useMemo(() => [
    {
      id: 'user1',
      icon: 'account-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'John Doe',
      subtitle: 'john@example.com • Editor',
      customContent: (
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Manage</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'user2',
      icon: 'account-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Jane Smith',
      subtitle: 'jane@example.com • Viewer',
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
        <ScreenHeader title="People & sharing" subtitle="Manage shared accounts and permissions." />
        <AccountCard>
          <GroupedSection items={sharedItems} />
        </AccountCard>
        <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.tint }]} onPressIn={handlePressIn}>
          <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Invite user</Text>
        </TouchableOpacity>
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="People & sharing" subtitle="Manage shared accounts and permissions." />
          <AccountCard>
            <GroupedSection items={sharedItems} />
          </AccountCard>
          <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.tint }]} onPressIn={handlePressIn}>
            <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
            <Text style={styles.addButtonText}>Invite user</Text>
          </TouchableOpacity>
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
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-Bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
  },
  accountCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
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
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-Bold',
    marginBottom: 6,
  },
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
  },
});


import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';

export default function StorageScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

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
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
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
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
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
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Manage</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors]);

  const renderSidebar = () => (
    <View style={[styles.desktopSidebar, { backgroundColor: colors.sidebarBackground }]}>
      <View style={styles.desktopHeader}>
        <ThemedText style={styles.welcomeText}>Welcome, Nate.</ThemedText>
        <ThemedText style={styles.welcomeSubtext}>Manage your xAI account.</ThemedText>
      </View>

      <View style={styles.menuContainer}>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)' || pathname === '/(tabs)/' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)' || pathname === '/(tabs)/' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconHome }]}>
            <MaterialCommunityIcons name="home-variant" size={22} color={darkenColor(colors.sidebarIconHome)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)' || pathname === '/(tabs)/' ? colors.sidebarItemActiveText : colors.text }]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/personal-info' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/personal-info' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/personal-info')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconPersonalInfo }]}>
            <MaterialCommunityIcons name="card-account-details-outline" size={22} color={darkenColor(colors.sidebarIconPersonalInfo)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/personal-info' ? colors.sidebarItemActiveText : colors.text }]}>Personal info</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/security' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/security' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/security')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
            <MaterialCommunityIcons name="lock-outline" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/security' ? colors.sidebarItemActiveText : colors.text }]}>Security & sign-in</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/password-manager' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/password-manager' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/password-manager')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconPassword }]}>
            <MaterialCommunityIcons name="key-outline" size={22} color={darkenColor(colors.sidebarIconPassword)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/password-manager' ? colors.sidebarItemActiveText : colors.text }]}>Password Manager</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/devices' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/devices' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/devices')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
            <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/devices' ? colors.sidebarItemActiveText : colors.text }]}>Your devices</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/data' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/data' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/data')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
            <MaterialCommunityIcons name="toggle-switch-outline" size={22} color={darkenColor(colors.sidebarIconData)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/data' ? colors.sidebarItemActiveText : colors.text }]}>Data & privacy</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/sharing' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/sharing' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/sharing')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSharing }]}>
            <MaterialCommunityIcons name="account-group-outline" size={22} color={darkenColor(colors.sidebarIconSharing)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/sharing' ? colors.sidebarItemActiveText : colors.text }]}>People & sharing</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/family' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/family' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/family')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconFamily }]}>
            <MaterialCommunityIcons name="home-group" size={22} color={darkenColor(colors.sidebarIconFamily)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/family' ? colors.sidebarItemActiveText : colors.text }]}>Family Group</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/payments' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/payments' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/payments')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconPayments }]}>
            <MaterialCommunityIcons name="wallet-outline" size={22} color={darkenColor(colors.sidebarIconPayments)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/payments' ? colors.sidebarItemActiveText : colors.text }]}>Payments & subscriptions</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.menuItem, pathname === '/(tabs)/storage' ? styles.menuItemActive : null, { backgroundColor: pathname === '/(tabs)/storage' ? colors.sidebarItemActiveBackground : 'transparent' }]}
          onPress={() => router.push('/(tabs)/storage')}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconStorage }]}>
            <MaterialCommunityIcons name="cloud-outline" size={22} color={darkenColor(colors.sidebarIconStorage)} />
          </View>
          <Text style={[styles.menuItemText, { color: pathname === '/(tabs)/storage' ? colors.sidebarItemActiveText : colors.text }]}>Oxy storage</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.desktopBody}>
          {renderSidebar()}
          <ScrollView
            style={styles.desktopMain}
            contentContainerStyle={styles.desktopMainContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.headerSection}>
              <ThemedText style={styles.title}>Oxy storage</ThemedText>
              <ThemedText style={styles.subtitle}>Manage your storage usage and files.</ThemedText>
            </View>
            <View style={[styles.accountCard, { backgroundColor: colors.card }]}>
              <GroupedSection items={storageItems} />
            </View>
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.mobileContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.mobileHeaderSection}>
          <ThemedText style={styles.mobileTitle}>Oxy storage</ThemedText>
          <ThemedText style={styles.mobileSubtitle}>Manage your storage usage and files.</ThemedText>
        </View>
        <View style={[styles.accountCard, { backgroundColor: colors.card }]}>
          <GroupedSection items={storageItems} />
        </View>
      </ScrollView>
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


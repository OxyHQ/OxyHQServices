import React from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { UserAvatar } from '@/components/user-avatar';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { width } = useWindowDimensions();

  // Determine if we're on desktop (web with large screen)
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const accountItems = [
    {
      id: 'name',
      title: 'Full name',
      subtitle: 'Nate Isern Alvarez',
      customContent: (
        <TouchableOpacity style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit name</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'email',
      title: 'Email',
      subtitle: 'nate.isern.alvarez@gmail.com',
      customContent: (
        <TouchableOpacity style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Update email</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'subscription',
      title: 'Subscription',
      subtitle: 'Manage your Grok subscription',
      customContent: (
        <TouchableOpacity style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Manage</Text>
          <Ionicons name="open-outline" size={16} color={colors.text} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      ),
    },
    {
      id: 'created',
      title: 'Account created',
      subtitle: 'Feb 21, 2025',
    },
  ];

  const signInMethods = [
    {
      id: 'email',
      customIcon: (
        <View style={[styles.methodIcon, { backgroundColor: colors.card }]}>
          <Ionicons name="mail-outline" size={24} color={colors.text} />
        </View>
      ),
      title: 'Email and password',
      subtitle: 'Enable login with email',
      customContent: (
        <TouchableOpacity style={[styles.methodButton, { backgroundColor: colors.card }]}>
          <Text style={[styles.methodButtonText, { color: colors.text }]}>Enable</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'x',
      customIcon: (
        <View style={[styles.methodIcon, { backgroundColor: colors.card }]}>
          <Ionicons name="logo-twitter" size={24} color={colors.text} />
        </View>
      ),
      title: 'X',
      subtitle: 'NateIsern',
      customContent: (
        <TouchableOpacity style={[styles.methodButton, { backgroundColor: colors.card }]}>
          <Text style={[styles.methodButtonText, { color: colors.text }]}>Disable</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'google',
      customIcon: (
        <View style={[styles.methodIcon, { backgroundColor: colors.card }]}>
          <Ionicons name="logo-google" size={24} color={colors.text} />
        </View>
      ),
      title: 'Google',
      subtitle: 'nate.isern.alvarez@gmail.com',
      customContent: (
        <TouchableOpacity style={[styles.methodButton, { backgroundColor: colors.card }]}>
          <Text style={[styles.methodButtonText, { color: colors.text }]}>Disable</Text>
        </TouchableOpacity>
      ),
    },
  ];

  const renderContent = () => (
    <>
      <Section title={isDesktop ? "Your account" : undefined} isFirst>
        {isDesktop && <ThemedText style={styles.subtitle}>Manage your account information.</ThemedText>}
        <View style={styles.accountCard}>
          <GroupedSection items={accountItems} />
        </View>
      </Section>

      <Section title="Sign-in methods">
        <ThemedText style={styles.subtitle}>Manage your ways of logging into xAI & Grok.</ThemedText>
        <View style={styles.accountCard}>
          <GroupedSection items={signInMethods} />
        </View>
      </Section>
    </>
  ); const toggleColorScheme = () => {
    // This would toggle between light and dark mode
    // You'd need to implement this based on your theme system
  };

  if (isDesktop) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Top Header Bar */}
        <View style={[styles.desktopTopBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <View style={styles.topBarLeft}>
            <Ionicons name="logo-react" size={28} color={colors.text} />
          </View>
          <View style={styles.topBarRight}>
            <TouchableOpacity style={[styles.searchButton, { backgroundColor: colors.card }]}>
              <Ionicons name="search-outline" size={18} color={colors.icon} />
              <Text style={[styles.searchText, { color: colors.icon }]}>Ctrl+K</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={toggleColorScheme}>
              <Ionicons name={colorScheme === 'dark' ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.icon} />
            </TouchableOpacity>
            <UserAvatar name="Nate Isern Alvarez" size={36} />
          </View>
        </View>

        <View style={styles.desktopBody}>
          <View style={styles.desktopSidebar}>
            <View style={styles.desktopHeader}>
              <ThemedText style={styles.welcomeText}>Welcome, Nate.</ThemedText>
              <ThemedText style={styles.welcomeSubtext}>Manage your xAI account.</ThemedText>
            </View>

            <View style={styles.menuContainer}>
              <TouchableOpacity style={[styles.menuItem, styles.menuItemActive, { backgroundColor: colors.card }]}>
                <Ionicons name="person-outline" size={20} color={colors.text} />
                <Text style={[styles.menuItemText, { color: colors.text }]}>Account</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.icon} />
                <Text style={[styles.menuItemText, { color: colors.icon }]}>Security</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <Ionicons name="time-outline" size={20} color={colors.icon} />
                <Text style={[styles.menuItemText, { color: colors.icon }]}>Sessions</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <Ionicons name="server-outline" size={20} color={colors.icon} />
                <Text style={[styles.menuItemText, { color: colors.icon }]}>Data</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.desktopMain}
            contentContainerStyle={styles.desktopMainContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.desktopMainHeader}>
              <UserAvatar name="Nate Isern Alvarez" size={100} />
            </View>
            {renderContent()}
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
          <ThemedText style={styles.mobileTitle}>Your account</ThemedText>
          <ThemedText style={styles.mobileSubtitle}>Manage your account information.</ThemedText>
        </View>
        <View style={styles.mobileHeader}>
          <UserAvatar name="Nate Isern Alvarez" size={100} />
        </View>
        {renderContent()}
      </ScrollView>
    </View>
  );
} const styles = StyleSheet.create({
  container: {
    flex: 1,
  } as const,
  scrollView: {
    flex: 1,
  } as const,
  desktopTopBar: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    borderBottomWidth: 1,
  } as const,
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  } as const,
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  } as const,
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  } as const,
  searchText: {
    fontSize: 13,
    fontWeight: '500',
  } as const,
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  } as const,
  desktopContent: {
    flexDirection: 'row',
    minHeight: '100vh' as any,
  } as const,
  desktopSidebar: {
    width: 280,
    padding: 24,
    borderRightWidth: 0,
  } as const,
  desktopHeader: {
    marginBottom: 32,
  } as const,
  logoContainer: {
    marginBottom: 24,
  } as const,
  welcomeText: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  } as const,
  welcomeSubtext: {
    fontSize: 14,
    opacity: 0.6,
  } as const,
  menuContainer: {
    gap: 4,
  } as const,
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 12,
  } as const,
  menuItemActive: {
    // backgroundColor is set dynamically
  } as const,
  menuItemText: {
    fontSize: 15,
    fontWeight: '500',
  } as const,
  desktopMain: {
    flex: 1,
    maxWidth: 720,
  } as const,
  desktopMainContent: {
    padding: 40,
  } as const,
  desktopMainHeader: {
    alignItems: 'center',
    marginBottom: 40,
  } as const,
  mobileContent: {
    padding: 20,
    paddingBottom: 40,
  } as const,
  mobileHeaderSection: {
    marginBottom: 24,
  } as const,
  mobileTitle: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 8,
  } as const,
  mobileSubtitle: {
    fontSize: 16,
    opacity: 0.6,
  } as const,
  mobileHeader: {
    alignItems: 'center',
    marginBottom: 32,
  } as const,
  subtitle: {
    fontSize: 15,
    opacity: 0.7,
    marginBottom: 16,
  } as const,
  accountCard: {
    marginBottom: 8,
  } as const,
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  } as const,
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  } as const,
  methodIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as const,
  methodButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  } as const,
  methodButtonText: {
    fontSize: 14,
    fontWeight: '500',
  } as const,
  mobileTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: 20,
    paddingTop: 8,
  } as const,
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  } as const,
  tabLabel: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '500',
  } as const,
});

import React, { useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import LottieView from 'lottie-react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { UserAvatar } from '@/components/user-avatar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import lottieAnimation from '@/assets/lottie/welcomeheader_background_op1.json';

/**
 * Darkens a color by a specified factor
 * Returns a darker version of the color
 */
const darkenColor = (color: string, factor: number = 0.6): string => {
  // Remove # if present
  const hex = color.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Darken by factor
  const newR = Math.max(0, Math.round(r * (1 - factor)));
  const newG = Math.max(0, Math.round(g * (1 - factor)));
  const newB = Math.max(0, Math.round(b * (1 - factor)));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = useMemo(() => Platform.OS === 'web' && width >= 768, [width]);

  const accountItems = useMemo(() => [
    {
      id: 'name',
      title: 'Full name',
      subtitle: 'Aloha Haloe',
      customContent: (
        <TouchableOpacity style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit name</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'email',
      title: 'Email',
      subtitle: 'hello@oxy.so',
      customContent: (
        <TouchableOpacity style={styles.button}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Update email</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'subscription',
      title: 'Subscription',
      subtitle: 'Manage your Oxy subscription',
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
  ], [colors.text]);

  const signInMethods = useMemo(() => [
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
  ], [colors.card, colors.text]);

  const content = useMemo(() => (
    <>
      <Section title={isDesktop ? "Your account" : undefined} isFirst>
        {isDesktop && <ThemedText style={styles.subtitle}>Manage your account information.</ThemedText>}
        <View style={styles.accountCard}>
          <GroupedSection items={accountItems} />
        </View>
      </Section>

      <Section title="Sign-in methods">
        <ThemedText style={styles.subtitle}>Manage your ways of logging into Oxy.</ThemedText>
        <View style={styles.accountCard}>
          <GroupedSection items={signInMethods} />
        </View>
      </Section>
    </>
  ), [accountItems, isDesktop, signInMethods]);

  const toggleColorScheme = useCallback(() => {
    // This would toggle between light and dark mode
    // You'd need to implement this based on your theme system
  }, []);

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
          <View style={[styles.desktopSidebar, { backgroundColor: colors.sidebarBackground }]}>
            <View style={styles.desktopHeader}>
              <ThemedText style={styles.welcomeText}>Welcome, Nate.</ThemedText>
              <ThemedText style={styles.welcomeSubtext}>Manage your xAI account.</ThemedText>
            </View>

            <View style={styles.menuContainer}>
              <TouchableOpacity style={[styles.menuItem, styles.menuItemActive, { backgroundColor: colors.sidebarItemActiveBackground }]}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconHome }]}>
                  <MaterialCommunityIcons name="home" size={22} color={darkenColor(colors.sidebarIconHome)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.sidebarItemActiveText }]}>Home</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconPersonalInfo }]}>
                  <MaterialCommunityIcons name="card-account-details-outline" size={22} color={darkenColor(colors.sidebarIconPersonalInfo)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Personal info</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
                  <MaterialCommunityIcons name="lock-outline" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Security & sign-in</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconPassword }]}>
                  <MaterialCommunityIcons name="key-outline" size={22} color={darkenColor(colors.sidebarIconPassword)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Password Manager</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
                  <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Your devices</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
                  <MaterialCommunityIcons name="toggle-switch-outline" size={22} color={darkenColor(colors.sidebarIconData)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Data & privacy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSharing }]}>
                  <MaterialCommunityIcons name="account-group-outline" size={22} color={darkenColor(colors.sidebarIconSharing)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>People & sharing</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconFamily }]}>
                  <MaterialCommunityIcons name="home-group" size={22} color={darkenColor(colors.sidebarIconFamily)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Family Group</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconPayments }]}>
                  <MaterialCommunityIcons name="wallet-outline" size={22} color={darkenColor(colors.sidebarIconPayments)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Payments & subscriptions</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuItem}>
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconStorage }]}>
                  <MaterialCommunityIcons name="cloud-outline" size={22} color={darkenColor(colors.sidebarIconStorage)} />
                </View>
                <Text style={[styles.menuItemText, { color: colors.text }]}>Oxy storage</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={styles.desktopMain}
            contentContainerStyle={styles.desktopMainContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.desktopMainHeader}>
              <View style={styles.avatarSectionWrapper}>
                <View style={styles.avatarContainer}>
                  <LottieView
                    source={lottieAnimation}
                    autoPlay
                    loop
                    style={styles.lottieBackground}
                  />
                  <View style={styles.avatarWrapper}>
                    <UserAvatar name="Nate Isern Alvarez" size={100} />
                  </View>
                </View>
                <View style={styles.nameWrapper}>
                  <ThemedText style={styles.userName}>Nate Isern Alvarez</ThemedText>
                  <ThemedText style={styles.userUsername}>@NateIsern</ThemedText>
                </View>
              </View>
            </View>
            {content}
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
          <View style={styles.avatarSectionWrapper}>
            <View style={styles.avatarContainer}>
              <LottieView
                source={lottieAnimation}
                autoPlay
                loop
                style={styles.lottieBackground}
              />
              <View style={styles.avatarWrapper}>
                <UserAvatar name="Nate Isern Alvarez" size={100} />
              </View>
            </View>
            <View style={styles.nameWrapper}>
              <ThemedText style={styles.userName}>Nate Isern Alvarez</ThemedText>
              <ThemedText style={styles.userUsername}>@NateIsern</ThemedText>
            </View>
          </View>
        </View>
        {content}

        {/* Bottom action buttons */}
        <View style={styles.bottomActions}>
          <TouchableOpacity style={[styles.circleButton, { backgroundColor: colors.card }]}>
            <Ionicons name="reload-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.circleButton, { backgroundColor: colors.card }]}>
            <Ionicons name="desktop-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.circleButton, { backgroundColor: colors.card }]}>
            <Ionicons name="menu-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    width: 260,
    padding: 20,
    borderRightWidth: 0,
  } as const,
  desktopHeader: {
    marginBottom: 24,
  } as const,
  logoContainer: {
    marginBottom: 24,
  } as const,
  welcomeText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  } as const,
  welcomeSubtext: {
    fontSize: 13,
    opacity: 0.6,
  } as const,
  menuContainer: {
    gap: 4,
  } as const,
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 26,
    gap: 12,
  } as const,
  menuItemActive: {
    // backgroundColor is set dynamically
  } as const,
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  menuItemText: {
    fontSize: 14,
    fontWeight: '400',
  } as const,
  desktopMain: {
    flex: 1,
    maxWidth: 720,
  } as const,
  desktopMainContent: {
    padding: 32,
  } as const,
  desktopMainHeader: {
    alignItems: 'center',
    marginBottom: 32,
  } as const,
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  } as const,
  mobileHeaderSection: {
    marginBottom: 20,
  } as const,
  mobileTitle: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
  } as const,
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
  } as const,
  mobileHeader: {
    alignItems: 'center',
    marginBottom: 24,
  } as const,
  avatarContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 600,
    height: 100,
    overflow: 'hidden',
  } as const,
  lottieBackground: {
    position: 'absolute',
    width: 600,
    height: 100,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  } as const,
  avatarWrapper: {
    zIndex: 1,
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
    left: 250,
    top: 0,
  } as const,
  avatarSectionWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  nameWrapper: {
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  userName: {
    fontSize: 24,
    fontWeight: '600',
  } as const,
  userUsername: {
    fontSize: 16,
    fontWeight: '400',
    opacity: 0.6,
    marginTop: 4,
  } as const,
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
  } as const,
  accountCard: {
    marginBottom: 8,
  } as const,
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  } as const,
  buttonText: {
    fontSize: 13,
    fontWeight: '500',
  } as const,
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  } as const,
  methodButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  } as const,
  methodButtonText: {
    fontSize: 13,
    fontWeight: '500',
  } as const,
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    marginBottom: 24,
  } as const,
  circleButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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

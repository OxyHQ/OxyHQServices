import React, { useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import LottieView from 'lottie-react-native';
import { useRouter, usePathname } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { UserAvatar } from '@/components/user-avatar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import lottieAnimation from '@/assets/lottie/welcomeheader_background_op1.json';
import { darkenColor } from '@/utils/color-utils';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = useMemo(() => Platform.OS === 'web' && width >= 768, [width]);

  const accountItems = useMemo(() => [
    {
      id: 'name',
      icon: 'account-outline' as any,
      iconColor: colors.sidebarIconPersonalInfo,
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
      icon: 'email-outline' as any,
      iconColor: colors.sidebarIconSecurity,
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
      icon: 'credit-card-outline' as any,
      iconColor: colors.sidebarIconPayments,
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
      icon: 'calendar-outline' as any,
      iconColor: colors.sidebarIconData,
      title: 'Account created',
      subtitle: 'Feb 21, 2025',
    },
  ], [colors.text, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconPayments, colors.sidebarIconData]);

  const signInMethods = useMemo(() => [
    {
      id: 'email',
      customIcon: (
        <View style={[styles.methodIcon, { backgroundColor: colors.sidebarIconSecurity }]}>
          <MaterialCommunityIcons name="email-outline" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
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
        <View style={[styles.methodIcon, { backgroundColor: colors.sidebarIconSharing }]}>
          <MaterialCommunityIcons name="twitter" size={22} color={darkenColor(colors.sidebarIconSharing)} />
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
        <View style={[styles.methodIcon, { backgroundColor: colors.sidebarIconPersonalInfo }]}>
          <MaterialCommunityIcons name="google" size={22} color={darkenColor(colors.sidebarIconPersonalInfo)} />
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
  ], [colors.card, colors.text, colors.sidebarIconSecurity, colors.sidebarIconSharing, colors.sidebarIconPersonalInfo]);

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
            <Image 
              source={require('@/assets/images/OxyLogo.svg')} 
              style={styles.logo}
              contentFit="contain"
            />
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
          <TouchableOpacity style={styles.circleButton}>
            <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
              <MaterialCommunityIcons name="reload" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleButton}>
            <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
              <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleButton}>
            <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
              <MaterialCommunityIcons name="menu" size={22} color={darkenColor(colors.sidebarIconData)} />
            </View>
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
  logo: {
    width: 120,
    height: 28,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
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

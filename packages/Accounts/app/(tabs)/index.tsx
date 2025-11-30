import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
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
import { AccountCard } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { formatDate, getDisplayName, getShortDisplayName } from '@/utils/date-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const pathname = usePathname();
  const lottieRef = useRef<LottieView>(null);
  const hasPlayedRef = useRef(false);

  // OxyServices integration
  const { user, isAuthenticated, oxyServices, isLoading: oxyLoading, showBottomSheet, refreshSessions } = useOxy();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = useMemo(() => Platform.OS === 'web' && width >= 768, [width]);

  // Compute user data
  const displayName = useMemo(() => getDisplayName(user), [user]);
  const shortDisplayName = useMemo(() => getShortDisplayName(user), [user]);
  const userEmail = useMemo(() => user?.email || 'No email', [user?.email]);
  const accountCreatedDate = useMemo(() => formatDate(user?.createdAt), [user?.createdAt]);
  const avatarUrl = useMemo(() => {
    if (user?.avatar && oxyServices) {
      return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
    }
    return undefined;
  }, [user?.avatar, oxyServices]);

  const handlePressIn = useHapticPress();

  // Navigation handlers - defined before useMemo to avoid dependency issues
  const handleSignIn = useCallback(() => {
    showBottomSheet?.('SignIn');
  }, [showBottomSheet]);

  const handleAvatarPress = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfile',
      props: { initialSection: 'profilePicture', initialField: 'avatar' }
    });
  }, [showBottomSheet]);

  const handleEditName = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfile',
      props: { initialSection: 'basicInfo', initialField: 'displayName' }
    });
  }, [showBottomSheet]);

  const handleUpdateEmail = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfile',
      props: { initialSection: 'basicInfo', initialField: 'email' }
    });
  }, [showBottomSheet]);

  const handleManageSubscription = useCallback(() => {
    showBottomSheet?.('PremiumSubscription');
  }, [showBottomSheet]);

  const handleSignInMethod = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfile',
      props: { initialSection: 'security' }
    });
  }, [showBottomSheet]);

  const handleReload = useCallback(async () => {
    if (!refreshSessions) return;
    try {
      await refreshSessions();
    } catch (error) {
      console.error('Failed to refresh sessions', error);
    }
  }, [refreshSessions]);

  const handleDevices = useCallback(() => {
    showBottomSheet?.('SessionManagement');
  }, [showBottomSheet]);

  const handleMenu = useCallback(() => {
    showBottomSheet?.('AccountOverview');
  }, [showBottomSheet]);

  const accountItems = useMemo(() => [
    {
      id: 'name',
      icon: 'account-outline' as any,
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Full name',
      subtitle: displayName,
      customContent: (
        <TouchableOpacity style={styles.button} onPressIn={handlePressIn} onPress={handleEditName}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Edit name</Text>
        </TouchableOpacity>
      ),
    },
    {
      id: 'email',
      icon: 'email-outline' as any,
      iconColor: colors.sidebarIconSecurity,
      title: 'Email',
      subtitle: userEmail,
      customContent: (
        <TouchableOpacity style={styles.button} onPressIn={handlePressIn} onPress={handleUpdateEmail}>
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
        <TouchableOpacity style={styles.button} onPressIn={handlePressIn} onPress={handleManageSubscription}>
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
      subtitle: accountCreatedDate || 'Unknown',
    },
  ], [colors.text, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconPayments, colors.sidebarIconData, displayName, userEmail, accountCreatedDate, handleEditName, handleUpdateEmail, handleManageSubscription]);

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
        <TouchableOpacity style={[styles.methodButton, { backgroundColor: colors.card }]} onPressIn={handlePressIn} onPress={handleSignInMethod}>
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
        <TouchableOpacity style={[styles.methodButton, { backgroundColor: colors.card }]} onPressIn={handlePressIn} onPress={handleSignInMethod}>
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
        <TouchableOpacity style={[styles.methodButton, { backgroundColor: colors.card }]} onPressIn={handlePressIn} onPress={handleSignInMethod}>
          <Text style={[styles.methodButtonText, { color: colors.text }]}>Disable</Text>
        </TouchableOpacity>
      ),
    },
  ], [colors.card, colors.text, colors.sidebarIconSecurity, colors.sidebarIconSharing, colors.sidebarIconPersonalInfo, handleSignInMethod]);

  const content = useMemo(() => (
    <>
      <Section title={undefined} isFirst>
        <AccountCard>
          <GroupedSection items={accountItems} />
        </AccountCard>
      </Section>

      <Section title="Sign-in methods">
        <ThemedText style={styles.subtitle}>Manage your ways of logging into Oxy.</ThemedText>
        <AccountCard>
          <GroupedSection items={signInMethods} />
        </AccountCard>
      </Section>
    </>
  ), [accountItems, isDesktop, signInMethods]);

  const toggleColorScheme = useCallback(() => {
    // This would toggle between light and dark mode
    // You'd need to implement this based on your theme system
  }, []);

  useEffect(() => {
    // Play animation only once when component mounts
    if (hasPlayedRef.current) return;

    // Use a small timeout to ensure the ref is set after render
    const timer = setTimeout(() => {
      if (lottieRef.current && !hasPlayedRef.current) {
        lottieRef.current.play();
        hasPlayedRef.current = true;
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Show loading state while OxyServices is initializing
  if (oxyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {

    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.unauthenticatedContainer, { backgroundColor: colors.background }]}>
          <View style={styles.unauthenticatedContent}>
            <ThemedText style={[styles.unauthenticatedTitle, { color: colors.text }]}>
              Welcome to Oxy Accounts
            </ThemedText>
            <ThemedText style={[styles.unauthenticatedSubtitle, { color: colors.text, opacity: 0.7 }]}>
              Sign in to manage your account settings, view your sessions, and access your personal information.
            </ThemedText>
            <View style={styles.signInButtonContainer}>
              <OxySignInButton />
              {showBottomSheet && (
                <TouchableOpacity
                  style={[styles.alternativeSignInButton, { backgroundColor: colors.card, borderColor: colors.tint }]}
                  onPressIn={handlePressIn}
                  onPress={handleSignIn}
                >
                  <Text style={[styles.alternativeSignInText, { color: colors.tint }]}>
                    Or sign in with username
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (isDesktop) {
    return (
      <>
        <View style={styles.desktopMainHeader}>
          <View style={styles.avatarSectionWrapper}>
            <View style={styles.avatarContainer}>
              <LottieView
                ref={lottieRef}
                source={lottieAnimation}
                style={styles.lottieBackground}
              />
              <TouchableOpacity
                style={styles.avatarWrapper}
                onPressIn={handlePressIn}
                onPress={handleAvatarPress}
                activeOpacity={0.8}
              >
                <UserAvatar name={displayName} imageUrl={avatarUrl} size={100} />
              </TouchableOpacity>
            </View>
            <View style={styles.nameWrapper}>
              <ThemedText style={styles.welcomeText}>Welcome, {shortDisplayName}.</ThemedText>
              <ThemedText style={styles.welcomeSubtext}>Manage your Oxy account.</ThemedText>
            </View>
          </View>
        </View>
        {content}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <View style={styles.mobileHeader}>
            <View style={styles.avatarSectionWrapper}>
              <View style={styles.avatarContainer}>
                <LottieView
                  ref={lottieRef}
                  source={lottieAnimation}
                  loop
                  style={styles.lottieBackground}
                />
                <TouchableOpacity
                  style={styles.avatarWrapper}
                  onPressIn={handlePressIn}
                  onPress={handleAvatarPress}
                  activeOpacity={0.8}
                >
                  <UserAvatar name={displayName} imageUrl={avatarUrl} size={100} />
                </TouchableOpacity>
              </View>
              <View style={styles.nameWrapper}>
                <ThemedText style={styles.welcomeText}>Welcome, {shortDisplayName}.</ThemedText>
                <ThemedText style={styles.welcomeSubtext}>Manage your Oxy account.</ThemedText>
              </View>
            </View>
          </View>
          {content}

          {/* Bottom action buttons */}
          <View style={styles.bottomActions}>
            <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleReload}>
              <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
                <MaterialCommunityIcons name="reload" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleDevices}>
              <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
                <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleButton} onPressIn={handlePressIn} onPress={handleMenu}>
              <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconData }]}>
                <MaterialCommunityIcons name="menu" size={22} color={darkenColor(colors.sidebarIconData)} />
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
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
  welcomeText: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  } as const,
  welcomeSubtext: {
    fontSize: 16,
    fontWeight: '400',
    opacity: 0.6,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  } as const,
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  } as const,
  unauthenticatedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  } as const,
  unauthenticatedContent: {
    alignItems: 'center',
    maxWidth: 400,
    gap: 16,
  } as const,
  unauthenticatedTitle: {
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  } as const,
  unauthenticatedSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  } as const,
  signInButtonContainer: {
    width: '100%',
    gap: 12,
    marginTop: 8,
  } as const,
  alternativeSignInButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  alternativeSignInText: {
    fontSize: 14,
    fontWeight: '500',
  } as const,
});

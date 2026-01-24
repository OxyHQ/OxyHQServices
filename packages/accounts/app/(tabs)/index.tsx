import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import LottieView from 'lottie-react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { UserAvatar } from '@/components/user-avatar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import lottieAnimation from '@/assets/lottie/welcomeheader_background_op1.json';
import { darkenColor } from '@/utils/color-utils';
import { AccountCard, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, useUserDevices, useRecentSecurityActivity } from '@oxyhq/services';
import { formatDate, getDisplayName, getShortDisplayName } from '@/utils/date-utils';
import { useIdentity } from '@/hooks/useIdentity';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useBiometricSettings } from '@/hooks/useBiometricSettings';
import { formatEventDescription, getEventIcon, getSeverityColor } from '@/utils/security-utils';
import { QuickActionsSection, type QuickAction } from '@/components/quick-actions-section';
import { AccountInfoGrid, type AccountInfoCard } from '@/components/account-info-grid';
import { IdentityCardsSection, type IdentityCard } from '@/components/identity-cards-section';
import { RecentActivitySection, type RecentActivityItem } from '@/components/recent-activity-section';
import { UsernameRequiredModal } from '@/components/UsernameRequiredModal';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const router = useRouter();
  const lottieRef = useRef<LottieView>(null);
  const hasPlayedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  // OxyServices integration
  const { user, isAuthenticated, oxyServices, isLoading: oxyLoading, showBottomSheet, refreshSessions, openAvatarPicker, sessions } = useOxy();
  const { syncIdentity, isIdentitySynced, identitySyncState } = useIdentity();
  const alert = useAlert();

  // Fetch devices for stats
  const { data: devices = [] } = useUserDevices({ enabled: isAuthenticated });

  // Fetch security activity
  const { data: securityActivities = [] } = useRecentSecurityActivity(5);

  // Biometric settings
  const {
    enabled: biometricEnabled,
    canEnable: canEnableBiometric,
    hasHardware: hasBiometricHardware,
    isLoading: biometricLoading,
  } = useBiometricSettings();

  // Format relative time for dates
  const formatRelativeTime = useCallback((dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateString);
  }, []);

  // Use reactive state from identity store (with defaults)
  const { isSynced, isSyncing } = identitySyncState || { isSynced: true, isSyncing: false };

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);

  // Compute user data
  const displayName = useMemo(() => getDisplayName(user), [user]);
  const shortDisplayName = useMemo(() => getShortDisplayName(user), [user]);
  const accountCreatedDate = useMemo(() => formatDate(user?.createdAt), [user?.createdAt]);
  const avatarUrl = useMemo(() => {
    if (user?.avatar && oxyServices) {
      return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
    }
    return undefined;
  }, [user?.avatar, oxyServices]);

  const handlePressIn = useHapticPress();

  // Navigation handlers - defined before useMemo to avoid dependency issues
  const handleAvatarPress = useCallback(() => {
    openAvatarPicker();
  }, [openAvatarPicker]);

  const handleEditName = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfileField',
      props: { fieldType: 'displayName' }
    });
  }, [showBottomSheet]);

  const handleManageSubscription = useCallback(() => {
    showBottomSheet?.('PremiumSubscription');
  }, [showBottomSheet]);

  const [showUsernameModal, setShowUsernameModal] = useState(false);

  // Check sync status on mount and auto-sync if needed
  useEffect(() => {
    const checkAndSync = async () => {
      if (isIdentitySynced) {
        // This updates the identity store internally
        const synced = await isIdentitySynced();

        // Auto-sync if not synced (store will update isSyncing)
        if (!synced && syncIdentity) {
          try {
            await syncIdentity();
          } catch (err: any) {
            // Check if error is username required - show modal
            if (err?.code === 'USERNAME_REQUIRED' || err?.message === 'USERNAME_REQUIRED') {
              setShowUsernameModal(true);
            } else {
              // Silent fail for other errors - will try again later
              console.log('[Home] Auto-sync failed:', err);
            }
          }
        }
      }
    };
    checkAndSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIdentitySynced, syncIdentity]);

  const handleSyncNow = useCallback(async () => {
    if (!syncIdentity) return;
    try {
      // syncIdentity updates the Zustand store (isSyncing, isSynced)
      await syncIdentity();
    } catch (err: any) {
      // Check if error is username required
      if (err?.code === 'USERNAME_REQUIRED' || err?.message === 'USERNAME_REQUIRED') {
        setShowUsernameModal(true);
      } else {
        alert('Sync Failed', err.message || 'Could not sync with server. Please check your internet connection.');
      }
    }
  }, [syncIdentity, alert]);

  const handleUsernameModalComplete = useCallback(async () => {
    setShowUsernameModal(false);
    // Retry sync after username is set
    if (syncIdentity) {
      try {
        await syncIdentity();
      } catch (err: any) {
        alert('Sync Failed', err.message || 'Could not sync with server. Please check your internet connection.');
      }
    }
  }, [syncIdentity, alert]);

  const handleReload = useCallback(async () => {
    if (!refreshSessions) return;
    try {
      await refreshSessions();
    } catch (error) {
      console.error('Failed to refresh sessions', error);
    }
  }, [refreshSessions]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Refresh sessions and sync identity if needed
      if (refreshSessions) {
        await refreshSessions();
      }
      if (syncIdentity && !isSynced) {
        await syncIdentity();
      }
    } catch (error) {
      console.error('Failed to refresh', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSessions, syncIdentity, isSynced]);

  const handleDevices = useCallback(() => {
    router.push('/(tabs)/devices' as any);
  }, [router]);

  const handleMenu = useCallback(() => {
    showBottomSheet?.('AccountOverview');
  }, [showBottomSheet]);

  const handlePersonalInfo = useCallback(() => {
    router.push('/(tabs)/personal-info' as any);
  }, [router]);

  const handleDataPrivacy = useCallback(() => {
    router.push('/(tabs)/data' as any);
  }, [router]);

  const handleSharing = useCallback(() => {
    router.push('/(tabs)/sharing' as any);
  }, [router]);

  const handlePayments = useCallback(() => {
    router.push('/(tabs)/payments' as any);
  }, [router]);

  const handleStorage = useCallback(() => {
    router.push('/(tabs)/storage' as any);
  }, [router]);

  const handleFamily = useCallback(() => {
    router.push('/(tabs)/family' as any);
  }, [router]);

  const handleAboutIdentity = useCallback(() => {
    if (Platform.OS !== 'web') {
      router.push('/(tabs)/about-identity' as any);
    }
  }, [router]);

  const handleSetUsername = useCallback(() => {
    showBottomSheet?.({
      screen: 'EditProfileField',
      props: { fieldType: 'username' }
    });
  }, [showBottomSheet]);

  // Compute recommendations similar to security screen
  const recommendations = useMemo(() => {
    const recs: any[] = [];

    // Check if username is missing
    if (!user?.username) {
      recs.push({
        id: 'set-username',
        priority: 1,
        icon: 'account-outline',
        iconColor: colors.warning,
        title: 'Set your username',
        subtitle: 'A username is needed to use the Oxy ecosystem. Without it, you can only use Oxy Identity accounts app.',
        onPress: handleSetUsername,
        showChevron: true,
      });
    }

    // Sort by priority (lower number = higher priority)
    return recs.sort((a, b) => a.priority - b.priority);
  }, [user?.username, handleSetUsername]);

  // Quick action cards for horizontal scroll
  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: 'personal-info',
      icon: 'card-account-details-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Personal Info',
      onPress: handlePersonalInfo,
    },
    {
      id: 'security',
      icon: 'shield-check-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Security',
      onPress: () => router.push('/(tabs)/security' as any),
    },
    {
      id: 'devices',
      icon: 'desktop-classic',
      iconColor: colors.sidebarIconDevices,
      title: 'Devices',
      onPress: handleDevices,
    },
    {
      id: 'data',
      icon: 'toggle-switch-outline',
      iconColor: colors.sidebarIconData,
      title: 'Data & Privacy',
      onPress: handleDataPrivacy,
    },
    {
      id: 'sharing',
      icon: 'account-group-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Sharing',
      onPress: handleSharing,
    },
    {
      id: 'payments',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Payments',
      onPress: handlePayments,
    },
    {
      id: 'storage',
      icon: 'cloud-outline',
      iconColor: colors.sidebarIconStorage,
      title: 'Storage',
      onPress: handleStorage,
    },
    {
      id: 'family',
      icon: 'home-group',
      iconColor: colors.sidebarIconFamily,
      title: 'Family',
      onPress: handleFamily,
    },
  ], [
    colors.sidebarIconPersonalInfo,
    colors.sidebarIconSecurity,
    colors.sidebarIconDevices,
    colors.sidebarIconData,
    colors.sidebarIconSharing,
    colors.sidebarIconPayments,
    colors.sidebarIconStorage,
    colors.sidebarIconFamily,
    handlePersonalInfo,
    handleDevices,
    handleDataPrivacy,
    handleSharing,
    handlePayments,
    handleStorage,
    handleFamily,
    router,
  ]);

  // Account info cards for grid layout
  const accountCards = useMemo<AccountInfoCard[]>(() => [
    {
      id: 'name',
      icon: 'account-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Full name',
      value: displayName,
      onPress: handleEditName,
    },
    {
      id: 'created',
      icon: 'calendar-outline',
      iconColor: colors.sidebarIconData,
      title: 'Account created',
      value: accountCreatedDate || 'Unknown',
    },
  ], [colors.sidebarIconPersonalInfo, colors.sidebarIconData, displayName, accountCreatedDate, handleEditName]);

  const identityCards = useMemo<IdentityCard[]>(() => {
    // Only show identity items on native platforms
    if (Platform.OS === 'web') {
      return [];
    }
    return [
      {
        id: 'self-custody',
        customIcon: (
          <View style={[styles.methodIcon, { backgroundColor: colors.identityIconSelfCustody }]}>
            <MaterialCommunityIcons name="shield-key" size={22} color={darkenColor(colors.identityIconSelfCustody)} />
          </View>
        ),
        title: 'Self-Custody Identity',
        subtitle: 'You own your keys. No passwords needed.',
        onPress: handleAboutIdentity,
        showChevron: true,
      },
      {
        id: 'public-key',
        customIcon: (
          <View style={[styles.methodIcon, { backgroundColor: colors.identityIconPublicKey }]}>
            <MaterialCommunityIcons name="key-variant" size={22} color={darkenColor(colors.identityIconPublicKey)} />
          </View>
        ),
        title: 'Your Public Key',
        subtitle: 'View and share your unique identifier',
        onPress: handleAboutIdentity,
        showChevron: true,
      },
    ];
  }, [handleAboutIdentity, colors.identityIconSelfCustody, colors.identityIconPublicKey]);

  // Recent activity items - use real security activities
  const recentActivityItems = useMemo<RecentActivityItem[]>(() => {
    if (!securityActivities || securityActivities.length === 0) {
      // Show placeholder if no activities
      return [{
        id: 'no-activity',
        icon: 'shield-check-outline',
        iconColor: colors.sidebarIconSecurity,
        title: 'No recent activity',
        subtitle: 'Your security events will appear here',
        onPress: () => router.push('/(tabs)/security' as any),
      }];
    }

    return securityActivities.slice(0, 3).map((activity: any) => {
      const eventIcon = getEventIcon(activity.eventType);
      const eventColor = getSeverityColor(activity.severity || 'low', colorScheme);
      const description = formatEventDescription(activity);

      return {
        id: `activity-${activity.id}`,
        icon: eventIcon,
        iconColor: eventColor,
        title: description,
        subtitle: formatRelativeTime(activity.timestamp),
        onPress: () => router.push('/(tabs)/security' as any),
      };
    });
  }, [securityActivities, colors.sidebarIconSecurity, colorScheme, formatRelativeTime, router]);

  // Quick stats cards
  const quickStatsCards = useMemo<AccountInfoCard[]>(() => [
    {
      id: 'devices-count',
      icon: 'devices',
      iconColor: colors.sidebarIconDevices,
      title: 'Active Devices',
      value: `${devices.length || 0} device${devices.length !== 1 ? 's' : ''}`,
      onPress: handleDevices,
    },
    {
      id: 'sessions-count',
      icon: 'account-multiple-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Active Sessions',
      value: `${sessions?.filter((s: any) => s.isActive !== false).length || 0} session${(sessions?.filter((s: any) => s.isActive !== false).length || 0) !== 1 ? 's' : ''}`,
      onPress: () => router.push('/(tabs)/security' as any),
    },
    {
      id: 'username-status',
      icon: 'account-check-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Username',
      value: user?.username ? `@${user.username}` : 'Not set',
      onPress: user?.username ? handlePersonalInfo : handleSetUsername,
    },
  ], [devices.length, sessions, user?.username, colors.sidebarIconDevices, colors.sidebarIconSecurity, colors.sidebarIconPersonalInfo, handleDevices, router, handlePersonalInfo, handleSetUsername]);

  // Security overview items - use real data
  const securityOverviewItems = useMemo(() => {
    const items = [];

    // Biometric status
    if (Platform.OS !== 'web') {
      let biometricSubtitle = '';
      if (biometricLoading) {
        biometricSubtitle = 'Checking...';
      } else if (!hasBiometricHardware) {
        biometricSubtitle = 'Not available';
      } else if (biometricEnabled) {
        biometricSubtitle = 'Enabled';
      } else if (canEnableBiometric) {
        biometricSubtitle = 'Available';
      } else {
        biometricSubtitle = 'Not set up';
      }

      items.push({
        id: 'biometric',
        icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
        iconColor: biometricEnabled ? colors.success : colors.sidebarIconSecurity,
        title: Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'Biometric Auth',
        subtitle: biometricSubtitle,
        onPress: () => router.push('/(tabs)/security' as any),
      });
    }

    // Recovery email
    items.push({
      id: 'recovery-email',
      icon: 'email-check-outline',
      iconColor: user?.email ? colors.success : colors.sidebarIconSecurity,
      title: 'Recovery Email',
      subtitle: user?.email ? 'Set' : 'Not set',
      onPress: () => router.push('/(tabs)/security' as any),
    });

    // Security status based on recommendations
    const hasSecurityIssues = !user?.email || (Platform.OS !== 'web' && hasBiometricHardware && !biometricEnabled && canEnableBiometric);
    items.push({
      id: 'security-status',
      icon: 'shield-lock-outline',
      iconColor: hasSecurityIssues ? colors.sidebarIconPayments : colors.success,
      title: 'Security Status',
      subtitle: hasSecurityIssues ? 'Needs attention' : 'Protected',
      onPress: () => router.push('/(tabs)/security' as any),
    });

    return items;
  }, [biometricEnabled, canEnableBiometric, hasBiometricHardware, biometricLoading, colors.sidebarIconSecurity, colors.sidebarIconPayments, user?.email, router]);


  const content = useMemo(() => (
    <>
      {/* Sync Status Banner */}
      {!isSynced && (
        <View style={[styles.syncBanner, { backgroundColor: colors.bannerWarningBackground, borderColor: colors.bannerWarningBorder }]}>
          <View style={styles.syncBannerContent}>
            <MaterialCommunityIcons name="cloud-off-outline" size={24} color={colors.bannerWarningIcon} />
            <View style={styles.syncBannerText}>
              <Text style={[styles.syncBannerTitle, { color: colors.bannerWarningText }]}>Pending Sync</Text>
              <Text style={[styles.syncBannerSubtitle, { color: colors.bannerWarningSubtext }]}>
                Your identity is stored locally. Connect to sync with Oxy servers.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.syncButton, { backgroundColor: colors.bannerWarningButton }]}
            onPress={handleSyncNow}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.avatarText} />
            ) : (
              <Text style={[styles.syncButtonText, { color: colors.avatarText }]}>Sync Now</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Recommendations Section */}
      {recommendations.length > 0 && (
        <Section title="Recommendations" isFirst={isSynced}>
          <AccountCard>
            <GroupedSection items={recommendations} />
          </AccountCard>
        </Section>
      )}

      {/* Quick Actions - Horizontal Scroll */}
      <Section title="Quick Actions" isFirst={recommendations.length === 0 && isSynced}>
        <QuickActionsSection actions={quickActions} onPressIn={handlePressIn} />
      </Section>

      {/* Account Info - Grid Layout */}
      <Section title="Account Info">
        <AccountInfoGrid cards={accountCards} onPressIn={handlePressIn} />
      </Section>

      {/* Recent Activity - Horizontal Scroll */}
      {recentActivityItems.length > 0 && recentActivityItems[0].id !== 'no-activity' && (
        <Section title="Recent Activity">
          <RecentActivitySection items={recentActivityItems} onPressIn={handlePressIn} />
        </Section>
      )}

      {/* Quick Stats - Grid Layout */}
      <Section title="Overview">
        <AccountInfoGrid cards={quickStatsCards} onPressIn={handlePressIn} />
      </Section>

      {/* Security Overview - Card Layout */}
      {securityOverviewItems.length > 0 && (
        <Section title="Security">
          <AccountCard>
            <GroupedSection items={securityOverviewItems} />
          </AccountCard>
        </Section>
      )}

      {/* Self-Custody Identity Section */}
      <Section title="Your Identity">
        <ThemedText style={styles.subtitle}>Your identity is secured by cryptography. You control your keys.</ThemedText>
        {Platform.OS === 'web' ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.bannerInfoBackground, borderColor: colors.bannerInfoBorder }]}>
            <View style={styles.infoBannerContent}>
              <MaterialCommunityIcons name="cellphone-key" size={24} color={colors.bannerInfoIcon} />
              <View style={styles.infoBannerText}>
                <Text style={[styles.infoBannerTitle, { color: colors.bannerInfoText }]}>Identity Available on Mobile</Text>
                <Text style={[styles.infoBannerSubtitle, { color: colors.bannerInfoSubtext }]}>
                  Your self-custody identity and keys are stored on your mobile device. Access your identity settings from the Oxy app on your phone or tablet.
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <IdentityCardsSection cards={identityCards} onPressIn={handlePressIn} />
        )}
      </Section>
    </>
  ), [quickActions, accountCards, identityCards, recentActivityItems, quickStatsCards, securityOverviewItems, isSynced, isSyncing, handleSyncNow, colors, handlePressIn, recommendations]);


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

  // Redirect to auth flow if not authenticated (native only)
  // Accounts app uses its own auth flow (create/import identity), not the bottom sheet
  // IMPORTANT: This useEffect must be called before any early returns to maintain hook order
  // Note: Auth route is only available on native platforms, so we skip redirect on web
  useEffect(() => {
    if (!oxyLoading && !isAuthenticated && Platform.OS !== 'web') {
      router.replace('/(auth)');
    }
  }, [oxyLoading, isAuthenticated, router]);

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

  // Show loading while checking auth or redirecting
  if (!isAuthenticated) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <>
      <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.avatarSectionWrapper}>
                <View style={styles.avatarContainer}>
                  <LottieView
                    autoPlay
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
                  <ThemedText style={styles.welcomeText}>{displayName}</ThemedText>
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
      <UsernameRequiredModal
        visible={showUsernameModal}
        onComplete={handleUsernameModalComplete}
        onCancel={() => setShowUsernameModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  } as const,
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  content: {
    padding: 16,
  } as const,
  header: {
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
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-Bold',
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
  syncBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  } as const,
  syncBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  } as const,
  syncBannerText: {
    flex: 1,
    marginLeft: 12,
  } as const,
  syncBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  } as const,
  syncBannerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  } as const,
  syncButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  } as const,
  syncButtonText: {
    fontSize: 14,
    fontWeight: '600',
  } as const,
  infoBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  } as const,
  infoBannerContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  } as const,
  infoBannerText: {
    flex: 1,
    marginLeft: 12,
  } as const,
  infoBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  } as const,
  infoBannerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  } as const,
});

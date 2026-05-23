import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import LottieView from 'lottie-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { Avatar } from '@oxyhq/services';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import lottieAnimation from '@/assets/lottie/welcomeheader_background_op1.json';
import { darkenColor } from '@/utils/color-utils';
import { AccountCard, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, useUserDevices, useRecentSecurityActivity } from '@oxyhq/services';
import { formatDate, getDisplayName } from '@/utils/date-utils';
import { useIdentity } from '@/hooks/useIdentity';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useBiometricSettings } from '@/hooks/useBiometricSettings';
import { formatEventDescription, getEventIcon, getSeverityColor } from '@/utils/security-utils';
import { QuickActionsSection, type QuickAction } from '@/components/quick-actions-section';
import { AccountInfoGrid, type AccountInfoCard } from '@/components/account-info-grid';
import { IdentityCardsSection, type IdentityCard } from '@/components/identity-cards-section';
import { RecentActivitySection, type RecentActivityItem } from '@/components/recent-activity-section';
import { UsernameRequiredModal } from '@/components/UsernameRequiredModal';
import { useTranslation } from '@/lib/i18n';

export default function HomeScreen() {
  const { mode } = useTheme();
  const colors = useColors();
  const router = useRouter();
  const lottieRef = useRef<LottieView>(null);
  const hasPlayedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const { t } = useTranslation();

  // OxyServices integration
  const { user, isAuthenticated, oxyServices, isLoading: oxyLoading, showBottomSheet, refreshSessions, openAvatarPicker, sessions, managedAccounts, actingAs } = useOxy();
  const { syncIdentity, isIdentitySynced, identitySyncState } = useIdentity();
  const alert = useAlert();

  // Fetch devices for stats
  const { data: devicesData } = useUserDevices({ enabled: isAuthenticated });
  const devices = (devicesData ?? []) as { id: string }[];

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

    if (minutes < 1) return t('home.activity.justNow');
    if (minutes < 60) return t('home.activity.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('home.activity.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t('home.activity.daysAgo', { count: days });
    return formatDate(dateString);
  }, [t]);

  // Use reactive state from identity store (with defaults)
  const { isSynced } = identitySyncState || { isSynced: true };

  // colors already from useColors() above

  // Compute user data
  const displayName = useMemo(() => getDisplayName(user), [user]);
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
              // Auto-sync will retry on next mount/focus; surface for diagnostics.
              console.warn('[Home] Auto-sync failed:', err);
            }
          }
        }
      }
    };
    checkAndSync();
  }, [isIdentitySynced, syncIdentity]);

  const handleUsernameModalComplete = useCallback(async () => {
    setShowUsernameModal(false);
    // Retry sync after username is set
    if (syncIdentity) {
      try {
        await syncIdentity();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('home.syncFailedMessage');
        alert(t('home.syncFailed'), message);
      }
    }
  }, [syncIdentity, alert, t]);

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
    router.push('/(tabs)/devices');
  }, [router]);

  const handleMenu = useCallback(() => {
    showBottomSheet?.('AccountOverview');
  }, [showBottomSheet]);

  const handlePersonalInfo = useCallback(() => {
    router.push('/(tabs)/personal-info');
  }, [router]);

  const handleDataPrivacy = useCallback(() => {
    router.push('/(tabs)/data');
  }, [router]);

  const handleSharing = useCallback(() => {
    router.push('/(tabs)/sharing');
  }, [router]);

  const handleSearch = useCallback((query?: string) => {
    if (query) {
      router.push({ pathname: '/(tabs)/search', params: { q: query } });
    } else {
      router.push('/(tabs)/search');
    }
  }, [router]);

  const handlePayments = useCallback(() => {
    router.push('/(tabs)/payments');
  }, [router]);

  const handleStorage = useCallback(() => {
    router.push('/(tabs)/storage');
  }, [router]);

  const handleFamily = useCallback(() => {
    router.push('/(tabs)/family');
  }, [router]);

  const handleAboutIdentity = useCallback(() => {
    if (Platform.OS !== 'web') {
      router.push('/(tabs)/about-identity');
    }
  }, [router]);

  const handleManagedAccounts = useCallback(() => {
    router.push('/(tabs)/managed-accounts');
  }, [router]);

  const handleCreateManagedAccount = useCallback(() => {
    showBottomSheet?.('CreateManagedAccount');
  }, [showBottomSheet]);

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
        title: t('home.recommendations.setUsername'),
        subtitle: t('home.recommendations.setUsernameSubtitle'),
        onPress: handleSetUsername,
        showChevron: true,
      });
    }

    // Sort by priority (lower number = higher priority)
    return recs.sort((a, b) => a.priority - b.priority);
  }, [user?.username, colors.warning, handleSetUsername, t]);

  // Quick action cards for horizontal scroll
  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: 'personal-info',
      icon: 'card-account-details-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: t('home.quickActions.personalInfo'),
      onPress: handlePersonalInfo,
    },
    {
      id: 'security',
      icon: 'shield-check-outline',
      iconColor: colors.sidebarIconSecurity,
      title: t('home.quickActions.security'),
      onPress: () => router.push('/(tabs)/security'),
    },
    {
      id: 'devices',
      icon: 'desktop-classic',
      iconColor: colors.sidebarIconDevices,
      title: t('home.quickActions.devices'),
      onPress: handleDevices,
    },
    {
      id: 'data',
      icon: 'toggle-switch-outline',
      iconColor: colors.sidebarIconData,
      title: t('home.quickActions.data'),
      onPress: handleDataPrivacy,
    },
    {
      id: 'sharing',
      icon: 'account-group-outline',
      iconColor: colors.sidebarIconSharing,
      title: t('home.quickActions.sharing'),
      onPress: handleSharing,
    },
    {
      id: 'payments',
      icon: 'wallet-outline',
      iconColor: colors.sidebarIconPayments,
      title: t('home.quickActions.payments'),
      onPress: handlePayments,
    },
    {
      id: 'storage',
      icon: 'cloud-outline',
      iconColor: colors.sidebarIconStorage,
      title: t('home.quickActions.storage'),
      onPress: handleStorage,
    },
    {
      id: 'family',
      icon: 'home-group',
      iconColor: colors.sidebarIconFamily,
      title: t('home.quickActions.family'),
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
    t,
  ]);

  // Account info cards for grid layout
  const accountCards = useMemo<AccountInfoCard[]>(() => [
    {
      id: 'name',
      icon: 'account-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: t('home.accountInfo.fullName'),
      value: displayName,
      onPress: handleEditName,
    },
    {
      id: 'created',
      icon: 'calendar-outline',
      iconColor: colors.sidebarIconData,
      title: t('home.accountInfo.accountCreated'),
      value: accountCreatedDate || t('common.unknown'),
    },
  ], [colors.sidebarIconPersonalInfo, colors.sidebarIconData, displayName, accountCreatedDate, handleEditName, t]);

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
        title: t('home.identity.selfCustody'),
        subtitle: t('home.identity.selfCustodySubtitle'),
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
        title: t('home.identity.publicKey'),
        subtitle: t('home.identity.publicKeySubtitle'),
        onPress: handleAboutIdentity,
        showChevron: true,
      },
    ];
  }, [handleAboutIdentity, colors.identityIconSelfCustody, colors.identityIconPublicKey, t]);

  // Recent activity items - use real security activities
  const recentActivityItems = useMemo<RecentActivityItem[]>(() => {
    if (!securityActivities || securityActivities.length === 0) {
      // Show placeholder if no activities
      return [{
        id: 'no-activity',
        icon: 'shield-check-outline',
        iconColor: colors.sidebarIconSecurity,
        title: t('home.activity.noActivity'),
        subtitle: t('home.activity.noActivitySubtitle'),
        onPress: () => router.push('/(tabs)/security'),
      }];
    }

    return securityActivities.slice(0, 3).map((activity: any) => {
      const eventIcon = getEventIcon(activity.eventType);
      const eventColor = getSeverityColor(activity.severity || 'low', mode);
      const description = formatEventDescription(activity);

      return {
        id: `activity-${activity.id}`,
        icon: eventIcon,
        iconColor: eventColor,
        title: description,
        subtitle: formatRelativeTime(activity.timestamp),
        onPress: () => router.push('/(tabs)/security'),
      };
    });
  }, [securityActivities, colors.sidebarIconSecurity, mode, formatRelativeTime, router, t]);

  // Quick stats cards
  const quickStatsCards = useMemo<AccountInfoCard[]>(() => {
    const deviceCount = devices.length || 0;
    const sessionCount = sessions?.filter((s: any) => s.isActive !== false).length || 0;
    return [
      {
        id: 'devices-count',
        icon: 'devices',
        iconColor: colors.sidebarIconDevices,
        title: t('home.stats.activeDevices'),
        value: t('home.stats.activeDevicesValue', { count: deviceCount }),
        onPress: handleDevices,
      },
      {
        id: 'sessions-count',
        icon: 'account-multiple-outline',
        iconColor: colors.sidebarIconSecurity,
        title: t('home.stats.activeSessions'),
        value: t('home.stats.activeSessionsValue', { count: sessionCount }),
        onPress: () => router.push('/(tabs)/security'),
      },
      {
        id: 'username-status',
        icon: 'account-check-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: t('home.stats.username'),
        value: user?.username ? `@${user.username}` : t('common.notSet'),
        onPress: user?.username ? handlePersonalInfo : handleSetUsername,
      },
    ];
  }, [devices.length, sessions, user?.username, colors.sidebarIconDevices, colors.sidebarIconSecurity, colors.sidebarIconPersonalInfo, handleDevices, router, handlePersonalInfo, handleSetUsername, t]);

  // Security overview items - use real data
  const securityOverviewItems = useMemo(() => {
    const items = [];

    // Biometric status
    if (Platform.OS !== 'web') {
      let biometricSubtitle = '';
      if (biometricLoading) {
        biometricSubtitle = t('home.securityOverview.biometricChecking');
      } else if (!hasBiometricHardware) {
        biometricSubtitle = t('home.securityOverview.biometricNotAvailable');
      } else if (biometricEnabled) {
        biometricSubtitle = t('home.securityOverview.biometricEnabled');
      } else if (canEnableBiometric) {
        biometricSubtitle = t('home.securityOverview.biometricAvailable');
      } else {
        biometricSubtitle = t('home.securityOverview.biometricNotSetUp');
      }

      items.push({
        id: 'biometric',
        icon: Platform.OS === 'ios' ? 'face-recognition' : 'fingerprint',
        iconColor: biometricEnabled ? colors.success : colors.sidebarIconSecurity,
        title: Platform.OS === 'ios' ? t('home.securityOverview.faceTouchId') : t('home.securityOverview.biometricAuth'),
        subtitle: biometricSubtitle,
        onPress: () => router.push('/(tabs)/security'),
      });
    }

    // Recovery email
    items.push({
      id: 'recovery-email',
      icon: 'email-check-outline',
      iconColor: user?.email ? colors.success : colors.sidebarIconSecurity,
      title: t('home.securityOverview.recoveryEmail'),
      subtitle: user?.email ? t('common.set') : t('common.notSet'),
      onPress: () => router.push('/(tabs)/security'),
    });

    // Security status based on recommendations
    const hasSecurityIssues = !user?.email || (Platform.OS !== 'web' && hasBiometricHardware && !biometricEnabled && canEnableBiometric);
    items.push({
      id: 'security-status',
      icon: 'shield-lock-outline',
      iconColor: hasSecurityIssues ? colors.sidebarIconPayments : colors.success,
      title: t('home.securityOverview.securityStatus'),
      subtitle: hasSecurityIssues ? t('home.securityOverview.needsAttention') : t('home.securityOverview.protected'),
      onPress: () => router.push('/(tabs)/security'),
    });

    return items;
  }, [biometricEnabled, canEnableBiometric, hasBiometricHardware, biometricLoading, colors.sidebarIconSecurity, colors.sidebarIconPayments, colors.success, user?.email, router, t]);


  // Managed accounts items for the identities section
  const managedAccountItems = useMemo(() => {
    const items: Array<{
      id: string;
      icon: string;
      iconColor: string;
      title: string;
      subtitle?: string;
      onPress?: () => void;
      showChevron?: boolean;
    }> = [];
    if (managedAccounts.length > 0) {
      items.push({
        id: 'managed-count',
        icon: 'account-group',
        iconColor: colors.sidebarIconSharing,
        title: t('home.identities.managedCount', { count: managedAccounts.length }),
        subtitle: actingAs ? t('home.identities.managedActingAs') : t('home.identities.managedSubtitle'),
        onPress: handleManagedAccounts,
        showChevron: true,
      });
      items.push({
        id: 'create-identity',
        icon: 'account-plus-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: t('home.identities.createNew'),
        onPress: handleCreateManagedAccount,
        showChevron: true,
      });
      items.push({
        id: 'manage-all',
        icon: 'account-cog-outline',
        iconColor: colors.sidebarIconData,
        title: t('home.identities.manageAll'),
        onPress: handleManagedAccounts,
        showChevron: true,
      });
    } else {
      items.push({
        id: 'no-managed',
        icon: 'account-plus-outline',
        iconColor: colors.sidebarIconSharing,
        title: t('home.identities.noManaged'),
        subtitle: t('home.identities.noManagedSubtitle'),
        onPress: handleCreateManagedAccount,
        showChevron: true,
      });
    }
    return items;
  }, [managedAccounts, actingAs, colors.sidebarIconSharing, colors.sidebarIconPersonalInfo, colors.sidebarIconData, handleManagedAccounts, handleCreateManagedAccount, t]);

  const content = useMemo(() => (
    <>
      {/* Recommendations Section */}
      {recommendations.length > 0 && (
        <Section title={t('home.sections.recommendations')} isFirst>
          <AccountCard>
            <GroupedSection items={recommendations} />
          </AccountCard>
        </Section>
      )}

      {/* Quick Actions - Horizontal Scroll */}
      <Section title={t('home.sections.quickActions')} isFirst={recommendations.length === 0}>
        <QuickActionsSection actions={quickActions} onPressIn={handlePressIn} />
      </Section>

      {/* Account Info - Grid Layout */}
      <Section title={t('home.sections.accountInfo')}>
        <AccountInfoGrid cards={accountCards} onPressIn={handlePressIn} />
      </Section>

      {/* Recent Activity - Horizontal Scroll */}
      {recentActivityItems.length > 0 && recentActivityItems[0].id !== 'no-activity' && (
        <Section title={t('home.sections.recentActivity')}>
          <RecentActivitySection items={recentActivityItems} onPressIn={handlePressIn} />
        </Section>
      )}

      {/* Quick Stats - Grid Layout */}
      <Section title={t('home.sections.overview')}>
        <AccountInfoGrid cards={quickStatsCards} onPressIn={handlePressIn} />
      </Section>

      {/* Managed Accounts Section */}
      <Section title={t('home.sections.yourIdentities')}>
        <ThemedText style={styles.subtitle}>{t('home.sections.yourIdentitiesSubtitle')}</ThemedText>
        <AccountCard>
          <GroupedSection items={managedAccountItems} />
        </AccountCard>
      </Section>

      {/* Security Overview - Card Layout */}
      {securityOverviewItems.length > 0 && (
        <Section title={t('home.sections.security')}>
          <AccountCard>
            <GroupedSection items={securityOverviewItems} />
          </AccountCard>
        </Section>
      )}

      {/* Self-Custody Identity Section */}
      <Section title={t('home.sections.yourIdentity')}>
        <ThemedText style={styles.subtitle}>{t('home.sections.yourIdentitySubtitle')}</ThemedText>
        {Platform.OS === 'web' ? (
          <View style={[styles.infoBanner, { backgroundColor: colors.bannerInfoBackground, borderColor: colors.bannerInfoBorder }]}>
            <View style={styles.infoBannerContent}>
              <MaterialCommunityIcons name="cellphone-key" size={24} color={colors.bannerInfoIcon} />
              <View style={styles.infoBannerText}>
                <Text style={[styles.infoBannerTitle, { color: colors.bannerInfoText }]}>{t('home.identity.webBannerTitle')}</Text>
                <Text style={[styles.infoBannerSubtitle, { color: colors.bannerInfoSubtext }]}>
                  {t('home.identity.webBannerSubtitle')}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <IdentityCardsSection cards={identityCards} onPressIn={handlePressIn} />
        )}
      </Section>
    </>
  ), [quickActions, accountCards, identityCards, recentActivityItems, quickStatsCards, securityOverviewItems, managedAccountItems, colors, handlePressIn, recommendations, t]);


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
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('common.loadingShort')}</ThemedText>
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
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('common.loadingShort')}</ThemedText>
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
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y.avatar')}
                    accessibilityHint={t('a11y.avatarHint')}
                  >
                    <Avatar name={displayName} uri={avatarUrl} size={100} />
                  </TouchableOpacity>
                </View>
                <View style={styles.nameWrapper}>
                  <ThemedText style={styles.welcomeText}>{displayName}</ThemedText>
                  <ThemedText style={styles.welcomeSubtext}>{t('home.subtitle')}</ThemedText>
                </View>
                {/* Search Bar */}
                <TouchableOpacity
                  style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handleSearch()}
                  onPressIn={handlePressIn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.search')}
                  accessibilityHint={t('a11y.searchHint')}
                >
                  <Ionicons name="search" size={20} color={colors.icon} />
                  <Text style={[styles.searchPlaceholder, { color: colors.icon }]}>{t('home.search')}</Text>
                </TouchableOpacity>
                {/* Quick Search Chips */}
                <View style={styles.searchChipsContainer}>
                  {[
                    { label: t('home.searchChips.password'), query: 'password' },
                    { label: t('home.searchChips.devices'), query: 'devices' },
                    { label: t('home.searchChips.security'), query: 'security' },
                    { label: t('home.searchChips.activity'), query: 'activity' },
                    { label: t('home.searchChips.email'), query: 'email' },
                    { label: t('home.searchChips.alia'), query: 'alia' },
                  ].map((chip) => (
                    <TouchableOpacity
                      key={chip.query}
                      style={[styles.searchChip, { borderColor: colors.border }]}
                      onPress={() => handleSearch(chip.query)}
                      onPressIn={handlePressIn}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={t('a11y.suggestion', { title: chip.label })}
                    >
                      <Text style={[styles.searchChipText, { color: colors.text }]}>{chip.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            {content}

            {/* Bottom action buttons */}
            <View style={styles.bottomActions}>
              <TouchableOpacity
                style={styles.circleButton}
                onPressIn={handlePressIn}
                onPress={handleReload}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.refresh')}
              >
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconSecurity }]}>
                  <MaterialCommunityIcons name="reload" size={22} color={darkenColor(colors.sidebarIconSecurity)} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.circleButton}
                onPressIn={handlePressIn}
                onPress={handleDevices}
                accessibilityRole="button"
                accessibilityLabel={t('drawer.devices')}
              >
                <View style={[styles.menuIconContainer, { backgroundColor: colors.sidebarIconDevices }]}>
                  <MaterialCommunityIcons name="desktop-classic" size={22} color={darkenColor(colors.sidebarIconDevices)} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.circleButton}
                onPressIn={handlePressIn}
                onPress={handleMenu}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.menu')}
              >
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
    width: '100%',
    maxWidth: 600,
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 28,
    borderWidth: 1,
    width: '100%',
    maxWidth: 600,
    gap: 12,
  } as const,
  searchPlaceholder: {
    fontSize: 16,
    flex: 1,
  } as const,
  searchChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
    gap: 8,
    maxWidth: 600,
  } as const,
  searchChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  } as const,
  searchChipText: {
    fontSize: 14,
    fontWeight: '500',
  } as const,
});

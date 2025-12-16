import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader, Switch, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy, usePrivacySettings, useUpdatePrivacySettings } from '@oxyhq/services';

export default function DataScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const alert = useAlert();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  // OxyServices integration
  const { user, isAuthenticated, isLoading: oxyLoading } = useOxy();
  const { data: privacySettings, isLoading: privacyLoading } = usePrivacySettings(user?.id, {
    enabled: !!user?.id && isAuthenticated,
  });
  const updatePrivacyMutation = useUpdatePrivacySettings();

  // Get privacy settings values (use defaults if not loaded yet)
  const dataSharing = privacySettings?.dataSharing ?? true;
  const locationSharing = privacySettings?.locationSharing ?? false;
  const analyticsSharing = privacySettings?.analyticsSharing ?? true;
  const showActivity = privacySettings?.showActivity ?? true;

  // Handle privacy setting updates
  const handlePrivacyUpdate = useCallback(async (key: string, value: boolean) => {
    if (!user?.id) return;

    try {
      await updatePrivacyMutation.mutateAsync({
        settings: { [key]: value },
        userId: user.id,
      });
    } catch (error: any) {
      alert('Error', error?.message || 'Failed to update privacy setting');
    }
  }, [user?.id, updatePrivacyMutation, alert]);

  // Handle download data
  const handleDownloadData = useCallback(() => {
    alert(
      'Download Your Data',
      'This will prepare a copy of your account data including profile information, activity history, and settings. The download will be available shortly.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request Download',
          onPress: () => {
            // TODO: Implement data download API call
            alert('Request Submitted', 'Your data download request has been submitted. You will receive a notification when it\'s ready.');
          },
        },
      ]
    );
  }, [alert]);

  // Handle delete account
  const handleDeleteAccount = useCallback(() => {
    alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This action cannot be undone. Are you sure you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            alert(
              'Confirm Deletion',
              'Please type "DELETE" to confirm account deletion. This action is permanent and irreversible.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Account',
                  style: 'destructive',
                  onPress: () => {
                    // TODO: Implement account deletion API call
                    alert('Account Deletion', 'Account deletion has been requested. You will receive a confirmation email.');
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [alert]);

  // Data download section
  const dataDownloadItems = useMemo(() => [
    {
      id: 'download',
      icon: 'download-outline',
      iconColor: colors.sidebarIconData,
      title: 'Download your data',
      subtitle: 'Get a copy of your data in a portable format',
      onPress: handleDownloadData,
      showChevron: true,
    },
  ], [colors, handleDownloadData]);

  // Privacy controls section
  const privacyControlItems = useMemo(() => [
    {
      id: 'data-sharing',
      icon: 'share-variant-outline',
      iconColor: colors.sidebarIconData,
      title: 'Data sharing',
      subtitle: 'Allow data sharing for improved services',
      customContent: (
        <Switch
          value={dataSharing}
          onValueChange={(value) => handlePrivacyUpdate('dataSharing', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
    {
      id: 'location-sharing',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Location sharing',
      subtitle: 'Share your location for location-based features',
      customContent: (
        <Switch
          value={locationSharing}
          onValueChange={(value) => handlePrivacyUpdate('locationSharing', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
    {
      id: 'analytics-sharing',
      icon: 'chart-line-variant',
      iconColor: colors.sidebarIconData,
      title: 'Analytics & diagnostics',
      subtitle: 'Help improve our services by sharing usage data',
      customContent: (
        <Switch
          value={analyticsSharing}
          onValueChange={(value) => handlePrivacyUpdate('analyticsSharing', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
    {
      id: 'show-activity',
      icon: 'eye-outline',
      iconColor: colors.sidebarIconData,
      title: 'Show activity status',
      subtitle: 'Let others see when you\'re active',
      customContent: (
        <Switch
          value={showActivity}
          onValueChange={(value) => handlePrivacyUpdate('showActivity', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
  ], [colors, dataSharing, locationSharing, analyticsSharing, showActivity, handlePrivacyUpdate, updatePrivacyMutation.isPending]);

  // Activity management section
  const activityItems = useMemo(() => [
    {
      id: 'activity-history',
      icon: 'history',
      iconColor: colors.sidebarIconData,
      title: 'Activity history',
      subtitle: 'View and manage your activity history',
      onPress: () => {
        alert('Activity History', 'Your activity history shows your recent actions and interactions. This feature is coming soon.');
      },
      showChevron: true,
    },
    {
      id: 'location-history',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Location history',
      subtitle: 'View and manage your location data',
      onPress: () => {
        alert('Location History', 'Your location history shows places you\'ve been. This feature is coming soon.');
      },
      showChevron: true,
    },
  ], [colors, alert]);

  // Account management section
  const accountManagementItems = useMemo(() => [
    {
      id: 'delete-account',
      icon: 'delete-outline',
      iconColor: '#FF3B30',
      title: 'Delete account',
      subtitle: 'Permanently delete your account and all data',
      onPress: handleDeleteAccount,
      showChevron: false,
    },
  ], [handleDeleteAccount]);


  // Show loading state
  if (oxyLoading || privacyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading privacy settings...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show message if not authenticated
  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="Data & privacy"
        subtitle="Manage your data and privacy settings."
        message="Please sign in to view your privacy settings."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const renderContent = () => (
    <>
      <Section title="Download your data">
        <ThemedText style={styles.sectionSubtitle}>Get a copy of your account data</ThemedText>
        <AccountCard>
          <GroupedSection items={dataDownloadItems} />
        </AccountCard>
      </Section>

      <Section title="Privacy controls">
        <ThemedText style={styles.sectionSubtitle}>Control how your data is used and shared</ThemedText>
        <AccountCard>
          <GroupedSection items={privacyControlItems} />
        </AccountCard>
      </Section>

      <Section title="Activity management">
        <ThemedText style={styles.sectionSubtitle}>Manage your activity and location data</ThemedText>
        <AccountCard>
          <GroupedSection items={activityItems} />
        </AccountCard>
      </Section>

      <Section title="Account management">
        <ThemedText style={styles.sectionSubtitle}>Dangerous actions that affect your account</ThemedText>
        <AccountCard>
          <GroupedSection items={accountManagementItems} />
        </AccountCard>
      </Section>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Data & privacy" subtitle="Manage your data and privacy settings." />
        {renderContent()}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="Data & privacy" subtitle="Manage your data and privacy settings." />
          {renderContent()}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 12,
  },
});

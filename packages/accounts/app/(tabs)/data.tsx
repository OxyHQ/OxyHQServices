import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
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
  const router = useRouter();
  const [isDownloading, setIsDownloading] = useState(false);

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  // OxyServices integration
  const { user, isAuthenticated, isLoading: oxyLoading, oxyServices } = useOxy();
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
      'Choose a format for your data export:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'JSON',
          onPress: async () => {
            if (!oxyServices) return;
            setIsDownloading(true);
            try {
              const blob = await oxyServices.downloadAccountData('json');
              if (Platform.OS === 'web') {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `account-data-${Date.now()}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }
              alert('Download Complete', 'Your data has been downloaded successfully.');
            } catch (error: any) {
              alert('Download Failed', error?.message || 'Failed to download your data. Please try again.');
            } finally {
              setIsDownloading(false);
            }
          },
        },
        {
          text: 'CSV',
          onPress: async () => {
            if (!oxyServices) return;
            setIsDownloading(true);
            try {
              const blob = await oxyServices.downloadAccountData('csv');
              if (Platform.OS === 'web') {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `account-data-${Date.now()}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }
              alert('Download Complete', 'Your data has been downloaded successfully.');
            } catch (error: any) {
              alert('Download Failed', error?.message || 'Failed to download your data. Please try again.');
            } finally {
              setIsDownloading(false);
            }
          },
        },
      ]
    );
  }, [alert, oxyServices]);

  // Handle delete account
  const handleDeleteAccount = useCallback(() => {
    alert(
      'Delete Account',
      'This will permanently delete your account and all associated data. This action cannot be undone.\n\nTo proceed, you will need to enter your password for verification.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            // For proper account deletion, we need a dedicated screen with password input
            // Navigate to a delete account flow or show a modal
            alert(
              'Password Required',
              'Account deletion requires password verification. Please use the Oxy Services app or contact support to delete your account securely.',
              [{ text: 'OK' }]
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

  // Handle clear history
  const handleClearHistory = useCallback(async (type: 'activity' | 'location') => {
    const title = type === 'activity' ? 'Clear Activity History' : 'Clear Location History';
    const message = type === 'activity'
      ? 'This will permanently delete all your activity history. This action cannot be undone.'
      : 'This will permanently delete all your location history. This action cannot be undone.';

    alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          if (!oxyServices) return;
          try {
            await oxyServices.clearUserHistory();
            alert('History Cleared', `Your ${type} history has been cleared.`);
          } catch (error: any) {
            alert('Error', error?.message || `Failed to clear ${type} history.`);
          }
        },
      },
    ]);
  }, [alert, oxyServices]);

  // Activity management section
  const activityItems = useMemo(() => [
    {
      id: 'activity-history',
      icon: 'history',
      iconColor: colors.sidebarIconData,
      title: 'Activity history',
      subtitle: 'View and manage your activity history',
      onPress: () => handleClearHistory('activity'),
      showChevron: true,
    },
    {
      id: 'location-history',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Location history',
      subtitle: 'View and manage your location data',
      onPress: () => handleClearHistory('location'),
      showChevron: true,
    },
  ], [colors, handleClearHistory]);

  // Account management section
  const accountManagementItems = useMemo(() => [
    {
      id: 'delete-account',
      icon: 'delete-outline',
      iconColor: colors.danger,
      title: 'Delete account',
      subtitle: 'Permanently delete your account and all data',
      onPress: handleDeleteAccount,
      showChevron: false,
    },
  ], [colors.danger, handleDeleteAccount]);


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
  },
});

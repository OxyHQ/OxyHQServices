import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { GroupedSection } from '@/components/grouped-section';
import { Section } from '@/components/section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useHapticPress } from '@/hooks/use-haptic-press';

export default function ThirdPartyConnectionsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const { isAuthenticated, isLoading: authLoading, oxyServices } = useOxy();
  const alert = useAlert();
  const handlePressIn = useHapticPress();

  // Third-party apps that have access
  const connectedApps = useMemo(() => [
    {
      id: 'app1',
      icon: 'application-outline',
      iconColor: colors.sidebarIconFamily,
      title: 'No connected apps',
      subtitle: 'Apps you connect will appear here',
      showChevron: false,
    },
  ], [colors]);

  // Sign-in with Oxy sessions
  const signInSessions = useMemo(() => [
    {
      id: 'signin1',
      icon: 'login-variant',
      iconColor: colors.tint,
      title: 'No sign-in sessions',
      subtitle: 'Sites you sign in to with Oxy will appear here',
      showChevron: false,
    },
  ], [colors]);

  // Settings items
  const settingsItems = useMemo(() => [
    {
      id: 'manage-access',
      icon: 'shield-check-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Manage third-party access',
      subtitle: 'Review and revoke app permissions',
      onPress: () => {
        alert('Manage Access', 'Third-party access management coming soon');
      },
      showChevron: true,
    },
    {
      id: 'data-shared',
      icon: 'database-outline',
      iconColor: colors.sidebarIconData,
      title: 'Data shared with apps',
      subtitle: 'See what data apps can access',
      onPress: () => {
        alert('Data Shared', 'Data sharing details coming soon');
      },
      showChevron: true,
    },
  ], [colors, alert]);

  // Show loading state
  if (authLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.text }]}>Loading...</Text>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show unauthenticated screen
  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="Third-party connections"
        subtitle="Manage apps and services connected to your account."
        message="Please sign in to manage your third-party connections."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const renderContent = () => (
    <>
      <Section title="Connected apps">
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          Apps that have access to your Oxy account
        </Text>
        <AccountCard>
          <GroupedSection items={connectedApps} />
        </AccountCard>
      </Section>

      <Section title="Sign in with Oxy">
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          Sites and apps you've signed in to using Oxy
        </Text>
        <AccountCard>
          <GroupedSection items={signInSessions} />
        </AccountCard>
      </Section>

      <Section title="Settings">
        <AccountCard>
          <GroupedSection items={settingsItems} />
        </AccountCard>
      </Section>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Third-party connections" subtitle="Manage apps and services connected to your account." />
        {renderContent()}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="Third-party connections" subtitle="Manage apps and services connected to your account." />
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
  loadingContainer: {
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
    marginBottom: 8,
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
});

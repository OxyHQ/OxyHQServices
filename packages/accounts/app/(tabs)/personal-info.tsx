import React, { useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy } from '@oxyhq/services';
import { formatDate, getDisplayName } from '@/utils/date-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { AccountInfoGrid, type AccountInfoCard } from '@/components/account-info-grid';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';

export default function PersonalInfoScreen() {
  const colorScheme = useColorScheme() ?? 'light';

  // OxyServices integration
  const { user, isLoading: oxyLoading, isAuthenticated } = useOxy();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const handlePressIn = useHapticPress();

  // Compute user data
  const displayName = useMemo(() => getDisplayName(user), [user]);
  const userEmail = useMemo(() => user?.email || 'No email set', [user?.email]);
  const userPhone = useMemo(() => (user as any)?.phone || null, [user]);
  const userAddress = useMemo(() => user?.location || (user as any)?.address || null, [user]);
  const userBirthday = useMemo(() => {
    const birthday = (user as any)?.birthday || (user as any)?.dateOfBirth;
    return birthday ? formatDate(birthday) : null;
  }, [user]);

  const personalInfoCards = useMemo<AccountInfoCard[]>(() => [
    {
      id: 'name',
      icon: 'account-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Full name',
      value: displayName || 'Not set',
    },
    {
      id: 'email',
      icon: 'email-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Email',
      value: userEmail,
    },
    {
      id: 'phone',
      icon: 'phone-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Phone number',
      value: userPhone || 'Not set',
    },
    {
      id: 'address',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Address',
      value: userAddress || 'Not set',
    },
    {
      id: 'birthday',
      icon: 'cake-outline',
      iconColor: colors.sidebarIconFamily,
      title: 'Birthday',
      value: userBirthday || 'Not set',
    },
    {
      id: 'created',
      icon: 'calendar-outline',
      iconColor: colors.sidebarIconData,
      title: 'Account created',
      value: user?.createdAt ? formatDate(user.createdAt) : 'Unknown',
    },
  ], [colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconData, colors.sidebarIconFamily, displayName, userEmail, userPhone, userAddress, userBirthday, user?.createdAt]);

  const contactItems = useMemo(() => [
    {
      id: 'email',
      icon: 'email-outline' as any,
      iconColor: colors.sidebarIconSecurity,
      title: 'Email',
      subtitle: userEmail,
      showChevron: false,
    },
    {
      id: 'phone',
      icon: 'phone-outline' as any,
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Phone number',
      subtitle: userPhone || 'Not set',
      showChevron: false,
    },
    {
      id: 'address',
      icon: 'map-marker-outline' as any,
      iconColor: colors.sidebarIconData,
      title: 'Address',
      subtitle: userAddress || 'Not set',
      showChevron: false,
    },
    {
      id: 'birthday',
      icon: 'cake-outline' as any,
      iconColor: colors.sidebarIconFamily,
      title: 'Birthday',
      subtitle: userBirthday || 'Not set',
      showChevron: false,
    },
  ], [colors.sidebarIconSecurity, colors.sidebarIconPersonalInfo, colors.sidebarIconData, colors.sidebarIconFamily, userEmail, userPhone, userAddress, userBirthday]);

  // Show loading state while OxyServices is initializing
  if (oxyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show message if not authenticated
  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="Personal info"
        subtitle="Manage your personal information and profile details."
        message="Please sign in to view your personal information."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={styles.content}>
        <ScreenHeader title="Personal info" subtitle="Manage your personal information and profile details." />
        <Section title="Profile summary">
          <AccountInfoGrid cards={personalInfoCards} onPressIn={handlePressIn} />
        </Section>
        <Section title="Contact & details">
          <AccountCard>
            <GroupedSection items={contactItems} />
          </AccountCard>
        </Section>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 120,
    gap: 16,
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
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  placeholderText: {
    fontSize: 16,
    textAlign: 'center',
  },
});


import React, { useMemo, useCallback } from 'react';
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
  const { user, isLoading: oxyLoading, isAuthenticated, showBottomSheet } = useOxy();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const handlePressIn = useHapticPress();
  const handleEditField = useCallback((field: string) => {
    showBottomSheet?.({
      screen: 'EditProfile',
      props: { initialSection: 'basicInfo', initialField: field }
    });
  }, [showBottomSheet]);

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
      onPress: () => handleEditField('displayName'),
    },
    {
      id: 'email',
      icon: 'email-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Email',
      value: userEmail,
      onPress: () => handleEditField('email'),
    },
    {
      id: 'phone',
      icon: 'phone-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Phone number',
      value: userPhone || 'Not set',
      onPress: () => handleEditField('phone'),
    },
    {
      id: 'address',
      icon: 'map-marker-outline',
      iconColor: colors.sidebarIconData,
      title: 'Address',
      value: userAddress || 'Not set',
      onPress: () => handleEditField('address'),
    },
    {
      id: 'birthday',
      icon: 'calendar-star',
      iconColor: colors.sidebarIconFamily,
      title: 'Birthday',
      value: userBirthday || 'Not set',
      onPress: () => handleEditField('birthday'),
    },
    {
      id: 'created',
      icon: 'calendar-outline',
      iconColor: colors.sidebarIconData,
      title: 'Account created',
      value: user?.createdAt ? formatDate(user.createdAt) : 'Unknown',
    },
  ], [colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconData, colors.sidebarIconFamily, displayName, userEmail, userPhone, userAddress, userBirthday, user?.createdAt, handleEditField]);

  const contactItems = useMemo(() => [
    {
      id: 'email',
      icon: 'email-outline' as any,
      iconColor: colors.sidebarIconSecurity,
      title: 'Email',
      subtitle: userEmail,
      showChevron: false,
      onPress: () => handleEditField('email'),
    },
    {
      id: 'phone',
      icon: 'phone-outline' as any,
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Phone number',
      subtitle: userPhone || 'Not set',
      showChevron: false,
      onPress: () => handleEditField('phone'),
    },
    {
      id: 'address',
      icon: 'map-marker-outline' as any,
      iconColor: colors.sidebarIconData,
      title: 'Address',
      subtitle: userAddress || 'Not set',
      showChevron: false,
      onPress: () => handleEditField('address'),
    },
    {
      id: 'birthday',
      icon: 'calendar-star' as any,
      iconColor: colors.sidebarIconFamily,
      title: 'Birthday',
      subtitle: userBirthday || 'Not set',
      showChevron: false,
      onPress: () => handleEditField('birthday'),
    },
  ], [colors.sidebarIconSecurity, colors.sidebarIconPersonalInfo, colors.sidebarIconData, colors.sidebarIconFamily, userEmail, userPhone, userAddress, userBirthday, handleEditField]);

  const actionsItems = useMemo(() => [
    {
      id: 'manage-sessions',
      icon: 'monitor-lock' as any,
      iconColor: colors.sidebarIconSecurity,
      title: 'Manage devices & sessions',
      subtitle: 'Review active devices and sign out',
      onPress: () => showBottomSheet?.('SessionManagement'),
      showChevron: true,
    },
    {
      id: 'subscription',
      icon: 'credit-card-outline' as any,
      iconColor: colors.sidebarIconPayments,
      title: 'Payments & subscription',
      subtitle: 'Manage billing and plan',
      onPress: () => showBottomSheet?.('PremiumSubscription'),
      showChevron: true,
    },
    {
      id: 'account-overview',
      icon: 'shield-key' as any,
      iconColor: colors.sidebarIconSecurity,
      title: 'Identity & security',
      subtitle: 'Keys, recovery, and account status',
      onPress: () => showBottomSheet?.('AccountOverview'),
      showChevron: true,
    },
  ], [colors.sidebarIconSecurity, colors.sidebarIconPayments, showBottomSheet]);

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
      <View style={[styles.container, { backgroundColor: colors.background }]}>
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
          <Section title="Actions">
            <AccountCard>
              <GroupedSection items={actionsItems} />
            </AccountCard>
          </Section>
        </View>
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


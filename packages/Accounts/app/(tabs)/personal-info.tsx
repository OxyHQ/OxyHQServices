import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { formatDate, getDisplayName } from '@/utils/date-utils';
import * as Haptics from 'expo-haptics';

export default function PersonalInfoScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  // OxyServices integration
  const { user, isLoading: oxyLoading, isAuthenticated, showBottomSheet } = useOxy();

  // Handle sign in
  const handleSignIn = useCallback(() => {
    if (showBottomSheet) {
      showBottomSheet('SignIn');
    }
  }, [showBottomSheet]);

  const handlePressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  // Compute user data
  const displayName = useMemo(() => getDisplayName(user), [user]);
  const userEmail = useMemo(() => user?.email || 'No email set', [user?.email]);
  const userPhone = useMemo(() => (user as any)?.phone || null, [user]);
  const userAddress = useMemo(() => user?.location || (user as any)?.address || null, [user]);
  const userBirthday = useMemo(() => {
    const birthday = (user as any)?.birthday || (user as any)?.dateOfBirth;
    return birthday ? formatDate(birthday) : null;
  }, [user]);

  const personalInfoItems = useMemo(() => {
    const items = [
      {
        id: 'name',
        icon: 'account-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: 'Full name',
        subtitle: displayName || 'Not set',
        customContent: (
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        ),
      },
      {
        id: 'email',
        icon: 'email-outline',
        iconColor: colors.sidebarIconSecurity,
        title: 'Email',
        subtitle: userEmail,
        customContent: (
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Update</Text>
          </TouchableOpacity>
        ),
      },
    ];

    // Only show optional fields if they exist
    if (userPhone) {
      items.push({
        id: 'phone',
        icon: 'phone-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: 'Phone number',
        subtitle: userPhone,
        customContent: (
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        ),
      });
    }

    if (userAddress) {
      items.push({
        id: 'address',
        icon: 'map-marker-outline',
        iconColor: colors.sidebarIconData,
        title: 'Address',
        subtitle: userAddress,
        customContent: (
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        ),
      });
    }

    if (userBirthday) {
      items.push({
        id: 'birthday',
        icon: 'cake-outline',
        iconColor: colors.sidebarIconFamily,
        title: 'Birthday',
        subtitle: userBirthday,
        customContent: (
          <TouchableOpacity style={[styles.button, { backgroundColor: colors.card }]} onPressIn={handlePressIn}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        ),
      });
    }

    return items;
  }, [colors, displayName, userEmail, userPhone, userAddress, userBirthday, handlePressIn]);

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
      <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.content}>
            <ScreenHeader title="Personal info" subtitle="Manage your personal information and profile details." />
            <View style={styles.unauthenticatedPlaceholder}>
              <ThemedText style={[styles.placeholderText, { color: colors.text }]}>
                Please sign in to view your personal information.
              </ThemedText>
              <View style={styles.signInButtonWrapper}>
                <OxySignInButton />
                {showBottomSheet && (
                  <TouchableOpacity
                    style={[styles.alternativeSignInButton, { backgroundColor: colors.card, borderColor: colors.tint }]}
                    onPressIn={handlePressIn}
                    onPress={handleSignIn}
                  >
                    <Text style={[styles.alternativeSignInText, { color: colors.tint }]}>
                      Sign in with username
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Desktop: layout handles sidebar and ScrollView, we just return content
  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Personal info" subtitle="Manage your personal information and profile details." />
        <AccountCard>
          <GroupedSection items={personalInfoItems} />
        </AccountCard>
      </>
    );
  }

  // Mobile: use ScreenContentWrapper for consistent scrolling
  return (
    <ScreenContentWrapper>
      <View style={styles.mobileContent}>
      <ScreenHeader title="Personal info" subtitle="Manage your personal information and profile details." />
      <AccountCard>
        <GroupedSection items={personalInfoItems} />
      </AccountCard>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  headerSection: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  mobileHeaderSection: {
    marginBottom: 20,
  },
  mobileTitle: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
  },
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
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
  unauthenticatedPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 24,
  },
  signInButtonWrapper: {
    width: '100%',
    maxWidth: 300,
    gap: 12,
    marginTop: 16,
  },
  alternativeSignInButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alternativeSignInText: {
    fontSize: 14,
    fontWeight: '500',
  },
});


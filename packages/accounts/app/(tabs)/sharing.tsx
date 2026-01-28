import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { GroupedSection } from '@/components/grouped-section';
import { Section } from '@/components/section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader, useAlert, LinkButton } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useOxy, useFollow, useCurrentUser } from '@oxyhq/services';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';

export default function PeopleAndSharingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const handlePressIn = useHapticPress();
  const alert = useAlert();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, oxyServices } = useOxy();

  // Fetch follower/following counts
  const { followerCount, followingCount, fetchUserCounts } = useFollow(user?._id || '');

  // Blocked and restricted users state
  const [blockedCount, setBlockedCount] = useState(0);
  const [restrictedCount, setRestrictedCount] = useState(0);
  const [isLoadingPrivacy, setIsLoadingPrivacy] = useState(true);

  // Fetch blocked/restricted counts
  useEffect(() => {
    const fetchPrivacyCounts = async () => {
      if (!isAuthenticated || !oxyServices) return;

      try {
        setIsLoadingPrivacy(true);
        const [blockedUsers, restrictedUsers] = await Promise.all([
          oxyServices.getBlockedUsers?.() || Promise.resolve([]),
          oxyServices.getRestrictedUsers?.() || Promise.resolve([]),
        ]);
        setBlockedCount(Array.isArray(blockedUsers) ? blockedUsers.length : 0);
        setRestrictedCount(Array.isArray(restrictedUsers) ? restrictedUsers.length : 0);
      } catch (error) {
        console.error('Failed to fetch privacy counts:', error);
      } finally {
        setIsLoadingPrivacy(false);
      }
    };

    if (isAuthenticated && user?._id) {
      fetchPrivacyCounts();
      fetchUserCounts(user._id);
    }
  }, [isAuthenticated, user?._id, oxyServices, fetchUserCounts]);

  const isLoading = authLoading || isLoadingPrivacy;

  // Contacts section items
  const contactsItems = useMemo(() => {
    const items = [];

    // Followers
    items.push({
      id: 'followers',
      icon: 'account-group-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Followers',
      subtitle: followerCount !== undefined
        ? `${followerCount} ${followerCount === 1 ? 'person follows' : 'people follow'} you`
        : 'People who follow you',
      onPress: () => {
        // Navigate to followers list when implemented
        alert('Followers', 'Followers list coming soon');
      },
      showChevron: true,
    });

    // Following
    items.push({
      id: 'following',
      icon: 'account-heart-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Following',
      subtitle: followingCount !== undefined
        ? `You follow ${followingCount} ${followingCount === 1 ? 'person' : 'people'}`
        : 'People you follow',
      onPress: () => {
        // Navigate to following list when implemented
        alert('Following', 'Following list coming soon');
      },
      showChevron: true,
    });

    // Find people
    items.push({
      id: 'find-people',
      icon: 'account-search-outline',
      iconColor: colors.tint,
      title: 'Find people',
      subtitle: 'Search for people to connect with',
      onPress: () => router.push('/(tabs)/search'),
      showChevron: true,
    });

    return items;
  }, [colors, followerCount, followingCount, alert, router]);

  // Privacy & blocking items
  const privacyItems = useMemo(() => {
    const items = [];

    // Blocked users
    items.push({
      id: 'blocked',
      icon: 'account-cancel-outline',
      iconColor: colors.danger,
      title: 'Blocked users',
      subtitle: blockedCount > 0
        ? `${blockedCount} ${blockedCount === 1 ? 'user' : 'users'} blocked`
        : 'No users blocked',
      onPress: () => {
        // Navigate to blocked users list when implemented
        alert('Blocked Users', 'Blocked users management coming soon');
      },
      showChevron: true,
    });

    // Restricted users
    items.push({
      id: 'restricted',
      icon: 'account-lock-outline',
      iconColor: colors.warning,
      title: 'Restricted users',
      subtitle: restrictedCount > 0
        ? `${restrictedCount} ${restrictedCount === 1 ? 'user' : 'users'} restricted`
        : 'No users restricted',
      onPress: () => {
        // Navigate to restricted users list when implemented
        alert('Restricted Users', 'Restricted users management coming soon');
      },
      showChevron: true,
    });

    return items;
  }, [colors, blockedCount, restrictedCount, alert]);

  // Profile visibility items (About me section)
  const profileVisibilityItems = useMemo(() => {
    const items = [];

    // Profile visibility
    items.push({
      id: 'profile-visibility',
      icon: 'eye-outline',
      iconColor: colors.sidebarIconData,
      title: 'Profile visibility',
      subtitle: 'Control who can see your profile information',
      onPress: () => {
        // Navigate to profile visibility settings when implemented
        alert('Profile Visibility', 'Profile visibility settings coming soon');
      },
      showChevron: true,
    });

    // What others see
    items.push({
      id: 'about-me',
      icon: 'account-details-outline',
      iconColor: colors.sidebarIconData,
      title: 'About me',
      subtitle: 'Manage what information is visible on your profile',
      onPress: () => router.push('/(tabs)/personal-info'),
      showChevron: true,
    });

    return items;
  }, [colors, alert, router]);

  // Location & sharing items
  const locationItems = useMemo(() => {
    const items = [];

    // Location sharing
    items.push({
      id: 'location-sharing',
      icon: 'map-marker-outline',
      iconColor: colors.success,
      title: 'Location sharing',
      subtitle: 'Share your location with people you trust',
      onPress: () => {
        alert('Location Sharing', 'Location sharing coming soon');
      },
      showChevron: true,
    });

    return items;
  }, [colors, alert]);

  // Show loading state
  if (authLoading || (isLoading && isAuthenticated)) {
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
        title="People & sharing"
        subtitle="Manage your connections and sharing settings."
        message="Please sign in to manage your connections and sharing settings."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const renderContent = () => (
    <>
      <Section title="Contacts">
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          Manage your connections and find new people
        </Text>
        <AccountCard>
          <GroupedSection items={contactsItems} />
        </AccountCard>
      </Section>

      <Section title="About me">
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          Control what others can see about you
        </Text>
        <AccountCard>
          <GroupedSection items={profileVisibilityItems} />
        </AccountCard>
      </Section>

      <Section title="Blocking & restrictions">
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          Manage blocked and restricted users
        </Text>
        <AccountCard>
          <GroupedSection items={privacyItems} />
        </AccountCard>
      </Section>

      <Section title="Location">
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          Manage location sharing preferences
        </Text>
        <AccountCard>
          <GroupedSection items={locationItems} />
        </AccountCard>
      </Section>
    </>
  );

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="People & sharing" subtitle="Manage your connections and sharing settings." />
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
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
});

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { GroupedSection } from '@/components/grouped-section';
import { Section } from '@/components/section';
import { AccountCard, ScreenHeader, useAlert, Switch } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, useFollow, usePrivacySettings, useUpdatePrivacySettings } from '@oxyhq/services';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import * as Contacts from 'expo-contacts';

export default function PeopleAndSharingScreen() {
  const colors = useColors();
  const alert = useAlert();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, oxyServices, showBottomSheet } = useOxy();

  // Get user ID as string
  const userId = typeof user?._id === 'string' ? user._id : undefined;

  // Fetch follower/following counts
  const { followerCount, followingCount, fetchUserCounts } = useFollow(userId);

  // Privacy settings via react-query hooks (same pattern as data.tsx)
  const { data: privacySettings, isLoading: privacyLoading } = usePrivacySettings(userId, {
    enabled: !!userId && isAuthenticated,
  });
  const updatePrivacyMutation = useUpdatePrivacySettings();

  // Cast privacy settings to a record so we can access dynamic keys
  const settings = privacySettings as Record<string, unknown> | undefined;

  // Derive privacy values from settings
  const profileVisibility = (settings?.profileVisibility as boolean | undefined) ?? true;
  const locationSharing = (settings?.locationSharing as boolean | undefined) ?? false;

  // Blocked and restricted users state
  const [blockedCount, setBlockedCount] = useState(0);
  const [restrictedCount, setRestrictedCount] = useState(0);
  const [hasFetchedPrivacy, setHasFetchedPrivacy] = useState(false);

  // Contacts sync state (native only)
  const [contactsPermission, setContactsPermission] = useState<Contacts.PermissionStatus | null>(null);
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [deviceContactsCount, setDeviceContactsCount] = useState<number | null>(null);

  // Check contacts permission on mount (native only)
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const checkPermission = async () => {
      const { status } = await Contacts.getPermissionsAsync();
      setContactsPermission(status);
    };
    checkPermission();
  }, []);

  // Handle contacts sync -- reads device contacts and shows count.
  // Backend sync API does not exist yet, so we are transparent about it.
  const handleSyncContacts = useCallback(async () => {
    if (Platform.OS === 'web') return;

    try {
      // Request permission if not granted
      let { status } = await Contacts.getPermissionsAsync();
      if (status !== 'granted') {
        const permissionResult = await Contacts.requestPermissionsAsync();
        status = permissionResult.status;
        setContactsPermission(status);
      }

      if (status !== 'granted') {
        alert('Permission Required', 'Please allow access to your contacts to sync them with your Oxy account.');
        return;
      }

      setIsSyncingContacts(true);

      // Fetch contacts from device
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.Emails,
          Contacts.Fields.PhoneNumbers,
        ],
      });

      if (data.length === 0) {
        alert('No Contacts', 'No contacts found on your device.');
        setIsSyncingContacts(false);
        return;
      }

      setDeviceContactsCount(data.length);

      alert(
        'Contacts Found',
        `Found ${data.length} contacts on your device. Contact sync to find friends on Oxy is not yet available -- stay tuned.`
      );
    } catch (error) {
      console.error('Failed to read contacts:', error);
      alert('Error', 'Failed to read contacts from your device. Please try again.');
    } finally {
      setIsSyncingContacts(false);
    }
  }, [alert]);

  // Handle privacy setting updates
  const handlePrivacyUpdate = useCallback(async (key: string, value: boolean) => {
    if (!userId) return;

    try {
      await updatePrivacyMutation.mutateAsync({
        settings: { [key]: value },
        userId,
      });
    } catch (error: any) {
      alert('Error', error?.message || 'Failed to update privacy setting');
    }
  }, [userId, updatePrivacyMutation, alert]);

  // Fetch blocked/restricted counts
  useEffect(() => {
    const fetchPrivacyCounts = async () => {
      if (!isAuthenticated || !oxyServices || !userId) return;

      try {
        const [blockedUsers, restrictedUsers] = await Promise.all([
          oxyServices.getBlockedUsers(),
          oxyServices.getRestrictedUsers(),
        ]);
        setBlockedCount(Array.isArray(blockedUsers) ? blockedUsers.length : 0);
        setRestrictedCount(Array.isArray(restrictedUsers) ? restrictedUsers.length : 0);
      } catch (error) {
        console.error('Failed to fetch privacy counts:', error);
      } finally {
        setHasFetchedPrivacy(true);
      }
    };

    if (isAuthenticated && userId && !hasFetchedPrivacy) {
      fetchPrivacyCounts();
      fetchUserCounts?.();
    }
  }, [isAuthenticated, userId, oxyServices, fetchUserCounts, hasFetchedPrivacy]);

  // Contacts section items
  const contactsItems = useMemo(() => {
    const items = [];

    // Sync contacts from device (native only)
    if (Platform.OS !== 'web') {
      const getContactsSubtitle = () => {
        if (deviceContactsCount !== null) {
          return `${deviceContactsCount} contacts found on device`;
        }
        if (contactsPermission === 'denied') {
          return 'Permission denied -- tap to request access';
        }
        return 'Find friends from your contacts';
      };

      items.push({
        id: 'sync-contacts',
        icon: 'contacts-outline',
        iconColor: colors.tint,
        title: 'Sync device contacts',
        subtitle: getContactsSubtitle(),
        onPress: handleSyncContacts,
        showChevron: true,
        customContent: isSyncingContacts ? (
          <ActivityIndicator size="small" color={colors.tint} />
        ) : undefined,
      });
    }

    // Followers
    items.push({
      id: 'followers',
      icon: 'account-group-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Followers',
      subtitle: followerCount !== undefined && followerCount !== null
        ? `${followerCount} ${followerCount === 1 ? 'person follows' : 'people follow'} you`
        : 'People who follow you',
      onPress: () => {
        if (userId) {
          showBottomSheet?.({ screen: 'FollowersList', props: { userId, initialCount: followerCount } });
        }
      },
      showChevron: true,
    });

    // Following
    items.push({
      id: 'following',
      icon: 'account-heart-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Following',
      subtitle: followingCount !== undefined && followingCount !== null
        ? `You follow ${followingCount} ${followingCount === 1 ? 'person' : 'people'}`
        : 'People you follow',
      onPress: () => {
        if (userId) {
          showBottomSheet?.({ screen: 'FollowingList', props: { userId, initialCount: followingCount } });
        }
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
  }, [colors, followerCount, followingCount, router, handleSyncContacts, isSyncingContacts, deviceContactsCount, contactsPermission, userId, showBottomSheet]);

  // Privacy & blocking items -- opens the PrivacySettings bottom sheet
  // which already has full blocked/restricted user management UI
  const privacyItems = useMemo(() => {
    const items = [];

    // Blocked users
    items.push({
      id: 'blocked',
      icon: 'account-cancel-outline',
      iconColor: colors.error,
      title: 'Blocked users',
      subtitle: blockedCount > 0
        ? `${blockedCount} ${blockedCount === 1 ? 'user' : 'users'} blocked`
        : 'No users blocked',
      onPress: () => {
        showBottomSheet?.({ screen: 'PrivacySettings' });
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
        showBottomSheet?.({ screen: 'PrivacySettings' });
      },
      showChevron: true,
    });

    return items;
  }, [colors, blockedCount, restrictedCount, showBottomSheet]);

  // Profile visibility items (About me section)
  const profileVisibilityItems = useMemo(() => {
    const items = [];

    // Profile visibility toggle
    items.push({
      id: 'profile-visibility',
      icon: 'eye-outline',
      iconColor: colors.sidebarIconData,
      title: 'Profile visibility',
      subtitle: profileVisibility
        ? 'Your profile is visible to everyone'
        : 'Your profile is hidden from public view',
      customContent: (
        <Switch
          value={profileVisibility}
          onValueChange={(value) => handlePrivacyUpdate('profileVisibility', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
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

    // Full privacy settings via bottom sheet
    items.push({
      id: 'privacy-settings',
      icon: 'shield-lock-outline',
      iconColor: colors.sidebarIconData,
      title: 'All privacy settings',
      subtitle: 'Detailed privacy and interaction controls',
      onPress: () => {
        showBottomSheet?.({ screen: 'PrivacySettings' });
      },
      showChevron: true,
    });

    return items;
  }, [colors, profileVisibility, handlePrivacyUpdate, updatePrivacyMutation.isPending, router, showBottomSheet]);

  // Location sharing items -- uses the same privacy settings API toggle as data.tsx
  const locationItems = useMemo(() => {
    const items = [];

    items.push({
      id: 'location-sharing',
      icon: 'map-marker-outline',
      iconColor: colors.success,
      title: 'Location sharing',
      subtitle: locationSharing
        ? 'Your location is being shared'
        : 'Location sharing is off',
      customContent: (
        <Switch
          value={locationSharing}
          onValueChange={(value) => handlePrivacyUpdate('locationSharing', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    });

    return items;
  }, [colors, locationSharing, handlePrivacyUpdate, updatePrivacyMutation.isPending]);

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
});

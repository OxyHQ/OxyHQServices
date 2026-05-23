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
import { useTranslation } from '@/lib/i18n';
import type { User } from '@oxyhq/core';
import { hashContacts } from '@/lib/contacts/hash';
import { ContactMatchesList } from '@/components/contact-matches-list';

export default function PeopleAndSharingScreen() {
  const colors = useColors();
  const alert = useAlert();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, oxyServices, showBottomSheet } = useOxy();
  const { t } = useTranslation();

  // Get user ID as string
  const userId = typeof user?._id === 'string' ? user._id : undefined;

  // Fetch follower/following counts
  const { followerCount, followingCount, fetchUserCounts } = useFollow(userId);

  // Privacy settings via react-query hooks (same pattern as data.tsx)
  const {
    data: privacySettings,
    isLoading: privacyLoading,
    isFetching: privacyFetching,
    refetch: refetchPrivacy,
  } = usePrivacySettings(userId, {
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
  const [refreshing, setRefreshing] = useState(false);
  const [pendingPrivacyKey, setPendingPrivacyKey] = useState<string | null>(null);

  const fetchPrivacyCounts = useCallback(async () => {
    if (!isAuthenticated || !oxyServices || !userId) return;
    try {
      const [blockedUsers, restrictedUsers] = await Promise.all([
        oxyServices.getBlockedUsers(),
        oxyServices.getRestrictedUsers(),
      ]);
      setBlockedCount(Array.isArray(blockedUsers) ? blockedUsers.length : 0);
      setRestrictedCount(Array.isArray(restrictedUsers) ? restrictedUsers.length : 0);
    } finally {
      setHasFetchedPrivacy(true);
    }
  }, [isAuthenticated, oxyServices, userId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchPrivacy(),
        fetchPrivacyCounts(),
        fetchUserCounts ? Promise.resolve(fetchUserCounts()) : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchPrivacy, fetchPrivacyCounts, fetchUserCounts]);

  // Contacts sync state (native only)
  const [contactsPermission, setContactsPermission] = useState<Contacts.PermissionStatus | null>(null);
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [deviceContactsCount, setDeviceContactsCount] = useState<number | null>(null);
  /**
   * Resolved Oxy profiles for contacts that matched, with the local display
   * name from the device address book (so we can show "Jane (Mom)" when the
   * user's contact name differs from their Oxy display name).
   *
   * Stored in component state — discovery is a stateless API call, so we keep
   * the result entirely in memory and discard it when the user navigates away.
   */
  const [contactMatches, setContactMatches] = useState<Array<{ user: User; localDisplayName?: string }>>([]);

  // Check contacts permission on mount (native only)
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const checkPermission = async () => {
      const { status } = await Contacts.getPermissionsAsync();
      setContactsPermission(status);
    };
    checkPermission();
  }, []);

  /**
   * Run the full contact-sync flow:
   *   1. Request `expo-contacts` permission.
   *   2. Read the user's address book.
   *   3. Hash emails+phones locally with SHA-256 (see `lib/contacts/hash.ts`).
   *   4. POST hashes to `/contacts/discover` via the core SDK.
   *   5. For each match, fetch the Oxy profile (parallel) and store the list
   *      in component state for the UI to render.
   *
   * Privacy posture: raw email/phone NEVER leaves the device — only the
   * 64-char SHA-256 hex digests do. The server returns only Oxy user IDs.
   */
  const handleSyncContacts = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (!oxyServices) return;

    try {
      let { status } = await Contacts.getPermissionsAsync();
      if (status !== 'granted') {
        const permissionResult = await Contacts.requestPermissionsAsync();
        status = permissionResult.status;
        setContactsPermission(status);
      }

      if (status !== 'granted') {
        alert(t('sharing.contacts.permissionTitle'), t('sharing.contacts.permissionMessage'));
        return;
      }

      setIsSyncingContacts(true);
      setContactMatches([]);

      const { data: deviceContacts } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.Emails,
          Contacts.Fields.PhoneNumbers,
        ],
      });

      if (deviceContacts.length === 0) {
        alert(t('sharing.contacts.noContactsTitle'), t('sharing.contacts.noContactsMessage'));
        setIsSyncingContacts(false);
        return;
      }

      setDeviceContactsCount(deviceContacts.length);

      // Shape device contacts into the form the hash util expects.
      const hashInput = deviceContacts.map((c) => ({
        id: c.id ?? `${c.name ?? 'contact'}-${Math.random().toString(36).slice(2)}`,
        displayName: c.name ?? '',
        emails: (c.emails ?? []).map((e) => e.email),
        phones: (c.phoneNumbers ?? []).map((p) => p.number),
      }));

      const batch = await hashContacts(hashInput);

      if (batch.hashedEmails.length === 0 && batch.hashedPhones.length === 0) {
        // No usable identifiers — nothing to discover. Treat as empty result.
        setContactMatches([]);
        setIsSyncingContacts(false);
        return;
      }

      const { matches } = await oxyServices.discoverContacts(
        batch.hashedEmails,
        batch.hashedPhones,
      );

      // De-dupe by userId — a single user may match on both email AND phone,
      // but the UI should only show them once.
      const uniqueUserIds = Array.from(new Set(matches.map((m) => m.userId)));

      // Build a userId -> local display name lookup so the UI can show the
      // device contact name alongside the Oxy profile.
      const userIdToLocalName = new Map<string, string>();
      for (const match of matches) {
        const contactsForHash = batch.hashToContacts.get(match.hashedIdentifier);
        if (!contactsForHash || contactsForHash.length === 0) continue;
        const localName = contactsForHash[0].displayName;
        if (localName && !userIdToLocalName.has(match.userId)) {
          userIdToLocalName.set(match.userId, localName);
        }
      }

      const profiles = await Promise.all(
        uniqueUserIds.map(async (id) => {
          try {
            const user = await oxyServices.getUserById(id);
            const entry: { user: User; localDisplayName?: string } = { user };
            const localName = userIdToLocalName.get(id);
            if (localName) entry.localDisplayName = localName;
            return entry;
          } catch {
            return null;
          }
        }),
      );

      const resolved: Array<{ user: User; localDisplayName?: string }> = [];
      for (const profile of profiles) {
        if (profile !== null) resolved.push(profile);
      }

      setContactMatches(resolved);
    } catch {
      // Non-fatal — surface a friendly message and let the user retry.
      alert(t('common.error'), t('sharing.contacts.syncFailed'));
    } finally {
      setIsSyncingContacts(false);
    }
  }, [alert, oxyServices, t]);

  // Handle privacy setting updates
  const handlePrivacyUpdate = useCallback(async (key: string, value: boolean) => {
    if (!userId) return;

    setPendingPrivacyKey(key);
    try {
      await updatePrivacyMutation.mutateAsync({
        settings: { [key]: value },
        userId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('sharing.privacy.updateFailed');
      alert(t('common.error'), message);
    } finally {
      setPendingPrivacyKey((current) => (current === key ? null : current));
    }
  }, [userId, updatePrivacyMutation, alert, t]);

  // Fetch blocked/restricted counts
  useEffect(() => {
    if (isAuthenticated && userId && !hasFetchedPrivacy) {
      void fetchPrivacyCounts();
      fetchUserCounts?.();
    }
  }, [isAuthenticated, userId, hasFetchedPrivacy, fetchPrivacyCounts, fetchUserCounts]);

  // Contacts section items
  const contactsItems = useMemo(() => {
    const items = [];

    // Sync contacts from device (native only)
    if (Platform.OS !== 'web') {
      const getContactsSubtitle = () => {
        if (deviceContactsCount !== null) {
          // After a successful sync we show how many of them were found on
          // Oxy (zero is a meaningful result — encourages inviting friends).
          return t('sharing.contacts.syncResultsSummary', {
            matches: contactMatches.length,
            scanned: deviceContactsCount,
          });
        }
        if (contactsPermission === 'denied') {
          return t('sharing.contacts.syncPermissionDenied');
        }
        return t('sharing.contacts.syncDefault');
      };

      items.push({
        id: 'sync-contacts',
        icon: 'contacts-outline',
        iconColor: colors.tint,
        title:
          deviceContactsCount !== null
            ? t('sharing.contacts.syncRefresh')
            : t('sharing.contacts.syncTitle'),
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
      title: t('sharing.contacts.followers'),
      subtitle: followerCount !== undefined && followerCount !== null
        ? t('sharing.contacts.followersFollowing', { count: followerCount })
        : t('sharing.contacts.followersDefault'),
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
      title: t('sharing.contacts.following'),
      subtitle: followingCount !== undefined && followingCount !== null
        ? t('sharing.contacts.followingCount', { count: followingCount })
        : t('sharing.contacts.followingDefault'),
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
      title: t('sharing.contacts.findPeople'),
      subtitle: t('sharing.contacts.findPeopleSubtitle'),
      onPress: () => router.push('/(tabs)/search'),
      showChevron: true,
    });

    return items;
  }, [colors, followerCount, followingCount, router, handleSyncContacts, isSyncingContacts, deviceContactsCount, contactMatches.length, contactsPermission, userId, showBottomSheet, t]);

  // Privacy & blocking items -- opens the PrivacySettings bottom sheet
  // which already has full blocked/restricted user management UI
  const privacyItems = useMemo(() => {
    const items = [];

    // Blocked users
    items.push({
      id: 'blocked',
      icon: 'account-cancel-outline',
      iconColor: colors.error,
      title: t('sharing.privacy.blocked'),
      subtitle: blockedCount > 0
        ? t('sharing.privacy.blockedCount', { count: blockedCount })
        : t('sharing.privacy.blockedEmpty'),
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
      title: t('sharing.privacy.restricted'),
      subtitle: restrictedCount > 0
        ? t('sharing.privacy.restrictedCount', { count: restrictedCount })
        : t('sharing.privacy.restrictedEmpty'),
      onPress: () => {
        showBottomSheet?.({ screen: 'PrivacySettings' });
      },
      showChevron: true,
    });

    return items;
  }, [colors, blockedCount, restrictedCount, showBottomSheet, t]);

  // Profile visibility items (About me section)
  const profileVisibilityItems = useMemo(() => {
    const items = [];

    // Profile visibility toggle
    items.push({
      id: 'profile-visibility',
      icon: 'eye-outline',
      iconColor: colors.sidebarIconData,
      title: t('sharing.privacy.profileVisibility'),
      subtitle: profileVisibility
        ? t('sharing.privacy.profileVisibilityOn')
        : t('sharing.privacy.profileVisibilityOff'),
      customContent: (
        <Switch
          value={profileVisibility}
          onValueChange={(value) => handlePrivacyUpdate('profileVisibility', value)}
          disabled={pendingPrivacyKey === 'profileVisibility'}
        />
      ),
    });

    // What others see
    items.push({
      id: 'about-me',
      icon: 'account-details-outline',
      iconColor: colors.sidebarIconData,
      title: t('sharing.privacy.aboutMe'),
      subtitle: t('sharing.privacy.aboutMeSubtitle'),
      onPress: () => router.push('/(tabs)/personal-info'),
      showChevron: true,
    });

    // Full privacy settings via bottom sheet
    items.push({
      id: 'privacy-settings',
      icon: 'shield-lock-outline',
      iconColor: colors.sidebarIconData,
      title: t('sharing.privacy.allSettings'),
      subtitle: t('sharing.privacy.allSettingsSubtitle'),
      onPress: () => {
        showBottomSheet?.({ screen: 'PrivacySettings' });
      },
      showChevron: true,
    });

    return items;
  }, [colors, profileVisibility, handlePrivacyUpdate, pendingPrivacyKey, router, showBottomSheet, t]);

  // Location sharing items -- uses the same privacy settings API toggle as data.tsx
  const locationItems = useMemo(() => {
    const items = [];

    items.push({
      id: 'location-sharing',
      icon: 'map-marker-outline',
      iconColor: colors.success,
      title: t('sharing.privacy.locationSharing'),
      subtitle: locationSharing
        ? t('sharing.privacy.locationSharingOn')
        : t('sharing.privacy.locationSharingOff'),
      customContent: (
        <Switch
          value={locationSharing}
          onValueChange={(value) => handlePrivacyUpdate('locationSharing', value)}
          disabled={pendingPrivacyKey === 'locationSharing'}
        />
      ),
    });

    return items;
  }, [colors, locationSharing, handlePrivacyUpdate, pendingPrivacyKey, t]);

  // Show loading state
  if (authLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.text }]}>{t('common.loadingShort')}</Text>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show unauthenticated screen
  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title={t('sharing.title')}
        subtitle={t('sharing.subtitle')}
        message={t('sharing.signInRequired')}
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const renderContent = () => (
    <>
      <Section title={t('sharing.sections.contacts')}>
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          {t('sharing.sections.contactsSubtitle')}
        </Text>
        <AccountCard>
          <GroupedSection items={contactsItems} />
        </AccountCard>
        {Platform.OS !== 'web' && deviceContactsCount !== null && !isSyncingContacts ? (
          <View style={styles.matchesContainer}>
            <Text style={[styles.matchesTitle, { color: colors.text }]}>
              {t('sharing.contacts.syncMatchesTitle')}
            </Text>
            <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
              {contactMatches.length > 0
                ? t('sharing.contacts.syncMatchesSubtitle', { count: contactMatches.length })
                : t('sharing.contacts.syncNoMatchesSubtitle')}
            </Text>
            {contactMatches.length > 0 ? (
              <AccountCard>
                <ContactMatchesList matches={contactMatches} />
              </AccountCard>
            ) : null}
          </View>
        ) : null}
      </Section>

      <Section title={t('sharing.sections.aboutMe')}>
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          {t('sharing.sections.aboutMeSubtitle')}
        </Text>
        <AccountCard>
          <GroupedSection items={profileVisibilityItems} />
        </AccountCard>
      </Section>

      <Section title={t('sharing.sections.blocking')}>
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          {t('sharing.sections.blockingSubtitle')}
        </Text>
        <AccountCard>
          <GroupedSection items={privacyItems} />
        </AccountCard>
      </Section>

      <Section title={t('sharing.sections.location')}>
        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          {t('sharing.sections.locationSubtitle')}
        </Text>
        <AccountCard>
          <GroupedSection items={locationItems} />
        </AccountCard>
      </Section>
    </>
  );

  return (
    <ScreenContentWrapper refreshing={refreshing || (privacyFetching && !privacyLoading)} onRefresh={handleRefresh}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title={t('sharing.title')} subtitle={t('sharing.subtitle')} />
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
  matchesContainer: {
    marginTop: 12,
    gap: 4,
  },
  matchesTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
});

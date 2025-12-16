import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader, Switch, useAlert } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useOxy, usePrivacySettings, useUpdatePrivacySettings } from '@oxyhq/services';
import type { BlockedUser, RestrictedUser, User } from '@oxyhq/services';
import { UserAvatar } from '@/components/user-avatar';
import { AccountInfoGrid, type AccountInfoCard } from '@/components/account-info-grid';
import { QuickActionsSection, type QuickAction } from '@/components/quick-actions-section';

export default function SharingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const alert = useAlert();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const handlePressIn = useHapticPress();

  // OxyServices integration
  const { user, oxyServices, isAuthenticated, isLoading: oxyLoading } = useOxy();
  const { data: privacySettings, isLoading: privacyLoading } = usePrivacySettings(user?.id, {
    enabled: !!user?.id && isAuthenticated,
  });
  const updatePrivacyMutation = useUpdatePrivacySettings();

  // State for user lists
  const [following, setFollowing] = useState<User[]>([]);
  const [followers, setFollowers] = useState<User[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [restrictedUsers, setRestrictedUsers] = useState<RestrictedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followingTotal, setFollowingTotal] = useState(0);
  const [followersTotal, setFollowersTotal] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Get privacy settings values
  const isPrivateAccount = privacySettings?.isPrivateAccount ?? false;
  const allowDirectMessages = privacySettings?.allowDirectMessages ?? true;
  const allowMentions = privacySettings?.allowMentions ?? true;
  const allowTagging = privacySettings?.allowTagging ?? true;

  // Fetch all user data
  const loadUsers = useCallback(async (showRefreshing = false) => {
    if (!oxyServices || !user?.id || !isAuthenticated) {
      setIsLoading(false);
      return;
    }

    try {
      if (showRefreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      const [followingData, followersData, blocked, restricted] = await Promise.all([
        oxyServices.getUserFollowing(user.id),
        oxyServices.getUserFollowers(user.id),
        oxyServices.getBlockedUsers(),
        oxyServices.getRestrictedUsers(),
      ]);

      setFollowing(followingData.following || []);
      setFollowingTotal(followingData.total || 0);
      setFollowers(followersData.followers || []);
      setFollowersTotal(followersData.total || 0);
      setBlockedUsers(blocked || []);
      setRestrictedUsers(restricted || []);
    } catch (err: any) {
      console.error('Failed to load users:', err);
      setError(err?.message || 'Failed to load user data');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [oxyServices, user?.id, isAuthenticated]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Helper to safely extract and validate user ID
  const extractUserId = useCallback((user: User | any): string | null => {
    if (!user) return null;

    // Try id field first (standard User interface)
    if (user.id && typeof user.id === 'string' && user.id.trim().length > 0) {
      return user.id.trim();
    }

    // Try _id field (MongoDB format)
    if (user._id) {
      if (typeof user._id === 'string' && user._id.trim().length > 0) {
        return user._id.trim();
      }
      // If _id is an ObjectId instance, convert to string
      if (user._id.toString && typeof user._id.toString === 'function') {
        const idString = user._id.toString().trim();
        if (idString.length > 0) {
          return idString;
        }
      }
    }

    return null;
  }, []);

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

  // Helper to extract user info from blocked/restricted objects
  const extractUserInfo = useCallback((
    item: BlockedUser | RestrictedUser,
    idField: 'blockedId' | 'restrictedId'
  ) => {
    let userIdField: string | { _id: string; username?: string; avatar?: string };
    let username: string;
    let avatar: string | undefined;

    if (idField === 'blockedId' && 'blockedId' in item) {
      userIdField = item.blockedId;
      username = typeof item.blockedId === 'string'
        ? (item.username || 'Unknown')
        : (item.blockedId.username || 'Unknown');
      avatar = typeof item.blockedId === 'string' ? item.avatar : item.blockedId.avatar;
    } else if (idField === 'restrictedId' && 'restrictedId' in item) {
      userIdField = item.restrictedId;
      username = typeof item.restrictedId === 'string'
        ? (item.username || 'Unknown')
        : (item.restrictedId.username || 'Unknown');
      avatar = typeof item.restrictedId === 'string' ? item.avatar : item.restrictedId.avatar;
    } else {
      return { userId: null, username: 'Unknown', avatar: undefined };
    }

    let userId: string | null = null;
    if (typeof userIdField === 'string') {
      userId = userIdField.trim().length > 0 ? userIdField.trim() : null;
    } else if (userIdField && typeof userIdField === 'object' && '_id' in userIdField) {
      const idValue = (userIdField as { _id: unknown })._id;
      if (typeof idValue === 'string') {
        userId = idValue.trim().length > 0 ? idValue.trim() : null;
      } else if (idValue && typeof idValue === 'object' && idValue !== null) {
        try {
          const idString = String(idValue).trim();
          userId = idString.length > 0 ? idString : null;
        } catch {
          userId = null;
        }
      }
    }

    return { userId, username, avatar };
  }, []);

  // Handle unblock action
  const handleUnblock = useCallback(async (userId: string) => {
    if (!oxyServices || !userId || userId.trim().length === 0) return;
    try {
      setActionLoading(userId);
      await oxyServices.unblockUser(userId.trim());
      setBlockedUsers(prev => prev.filter(u => {
        const { userId: id } = extractUserInfo(u, 'blockedId');
        return id !== userId;
      }));
      alert('Success', 'User unblocked successfully');
    } catch (err: any) {
      console.error('Failed to unblock user:', err);
      alert('Error', err?.message || 'Failed to unblock user');
    } finally {
      setActionLoading(null);
    }
  }, [oxyServices, alert, extractUserInfo]);

  // Handle unrestrict action
  const handleUnrestrict = useCallback(async (userId: string) => {
    if (!oxyServices || !userId || userId.trim().length === 0) return;
    try {
      setActionLoading(userId);
      await oxyServices.unrestrictUser(userId.trim());
      setRestrictedUsers(prev => prev.filter(u => {
        const { userId: id } = extractUserInfo(u, 'restrictedId');
        return id !== userId;
      }));
      alert('Success', 'User unrestricted successfully');
    } catch (err: any) {
      console.error('Failed to unrestrict user:', err);
      alert('Error', err?.message || 'Failed to unrestrict user');
    } finally {
      setActionLoading(null);
    }
  }, [oxyServices, alert, extractUserInfo]);

  // Handle unfollow action
  const handleUnfollow = useCallback(async (userId: string) => {
    if (!oxyServices || !userId || userId.trim().length === 0) return;
    try {
      setActionLoading(userId);
      await oxyServices.unfollowUser(userId.trim());
      setFollowing(prev => prev.filter(u => {
        const id = extractUserId(u);
        return id !== userId;
      }));
      setFollowingTotal(prev => Math.max(0, prev - 1));
      alert('Success', 'User unfollowed successfully');
    } catch (err: any) {
      console.error('Failed to unfollow user:', err);
      alert('Error', err?.message || 'Failed to unfollow user');
    } finally {
      setActionLoading(null);
    }
  }, [oxyServices, alert, extractUserId]);

  // Statistics cards with different colors
  const statisticsCards = useMemo<AccountInfoCard[]>(() => [
    {
      id: 'following',
      icon: 'account-plus-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Following',
      value: followingTotal.toString(),
    },
    {
      id: 'followers',
      icon: 'account-group-outline',
      iconColor: colors.sidebarIconHome,
      title: 'Followers',
      value: followersTotal.toString(),
    },
    {
      id: 'blocked',
      icon: 'account-cancel-outline',
      iconColor: colors.sidebarIconSharing,
      title: 'Blocked',
      value: blockedUsers.length.toString(),
    },
    {
      id: 'restricted',
      icon: 'account-lock-outline',
      iconColor: colors.sidebarIconData,
      title: 'Restricted',
      value: restrictedUsers.length.toString(),
    },
  ], [followingTotal, followersTotal, blockedUsers.length, restrictedUsers.length, colors]);

  // Handle share/invite
  const handleInvite = useCallback(async () => {
    try {
      const message = `Join me on Oxy! A secure, decentralized platform for identity and social connections.`;
      const url = 'https://oxyhq.com'; // Replace with actual app URL

      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({
            title: 'Join Oxy',
            text: message,
            url: url,
          });
        } else {
          // Fallback: copy to clipboard
          await navigator.clipboard.writeText(`${message} ${url}`);
          alert('Success', 'Invite link copied to clipboard!');
        }
      } else {
        const result = await Share.share({
          message: `${message} ${url}`,
          title: 'Join Oxy',
        });

        if (result.action === Share.sharedAction) {
          alert('Success', 'Invite shared successfully!');
        }
      }
    } catch (error: any) {
      if (error.message !== 'User cancelled') {
        console.error('Error sharing:', error);
        alert('Error', 'Failed to share invite. Please try again.');
      }
    }
  }, [alert]);

  // Quick actions with different colors
  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: 'search',
      icon: 'magnify',
      iconColor: colors.sidebarIconSecurity,
      title: 'Search',
      onPress: () => {
        router.push('/(tabs)/search' as any);
      },
    },
    {
      id: 'find-people',
      icon: 'account-search-outline',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Find People',
      onPress: () => {
        router.push('/(tabs)/search' as any);
      },
    },
    {
      id: 'invite',
      icon: 'account-plus-outline',
      iconColor: colors.sidebarIconPayments,
      title: 'Invite',
      onPress: handleInvite,
    },
    {
      id: 'refresh',
      icon: 'refresh',
      iconColor: colors.sidebarIconStorage,
      title: 'Refresh',
      onPress: () => {
        loadUsers(true);
      },
    },
  ], [colors, router, handleInvite, loadUsers]);

  // Privacy controls for people interactions
  const peoplePrivacyItems = useMemo(() => [
    {
      id: 'private-account',
      icon: 'lock-outline',
      iconColor: colors.sidebarIconSecurity,
      title: 'Private account',
      subtitle: 'Only approved followers can see your content',
      customContent: (
        <Switch
          value={isPrivateAccount}
          onValueChange={(value) => handlePrivacyUpdate('isPrivateAccount', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
    {
      id: 'direct-messages',
      icon: 'message-outline',
      iconColor: colors.sidebarIconHome,
      title: 'Direct messages',
      subtitle: 'Allow others to send you direct messages',
      customContent: (
        <Switch
          value={allowDirectMessages}
          onValueChange={(value) => handlePrivacyUpdate('allowDirectMessages', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
    {
      id: 'mentions',
      icon: 'at',
      iconColor: colors.sidebarIconPersonalInfo,
      title: 'Mentions',
      subtitle: 'Allow others to mention you in posts',
      customContent: (
        <Switch
          value={allowMentions}
          onValueChange={(value) => handlePrivacyUpdate('allowMentions', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
    {
      id: 'tagging',
      icon: 'tag-outline',
      iconColor: colors.sidebarIconData,
      title: 'Photo tagging',
      subtitle: 'Allow others to tag you in photos',
      customContent: (
        <Switch
          value={allowTagging}
          onValueChange={(value) => handlePrivacyUpdate('allowTagging', value)}
          disabled={updatePrivacyMutation.isPending}
        />
      ),
    },
  ], [colors, isPrivateAccount, allowDirectMessages, allowMentions, allowTagging, handlePrivacyUpdate, updatePrivacyMutation.isPending]);

  // Transform following users to GroupedSection items
  const followingItems = useMemo(() => {
    return following
      .map((user) => {
        const userId = extractUserId(user);
        if (!userId) return null; // Skip invalid users

        const username = user.username || user.name?.full || user.name?.first || 'Unknown';
        const avatarUrl = user.avatar && oxyServices
          ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb')
          : undefined;
        const isLoading = actionLoading === userId;

        return {
          id: userId,
          title: username,
          subtitle: user.name?.full || username,
          customIcon: (
            <UserAvatar
              name={username}
              imageUrl={avatarUrl}
              size={40}
            />
          ),
          customContent: (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPress={() => handleUnfollow(userId)}
              onPressIn={handlePressIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.sidebarIconSharing} />
              ) : (
                <Text style={[styles.actionButtonText, { color: colors.sidebarIconSharing }]}>Unfollow</Text>
              )}
            </TouchableOpacity>
          ),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [following, oxyServices, colors, handleUnfollow, handlePressIn, actionLoading, extractUserId]);

  // Transform followers to GroupedSection items
  const followersItems = useMemo(() => {
    return followers
      .map((user) => {
        const userId = extractUserId(user);
        if (!userId) return null; // Skip invalid users

        const username = user.username || user.name?.full || user.name?.first || 'Unknown';
        const avatarUrl = user.avatar && oxyServices
          ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb')
          : undefined;

        return {
          id: userId,
          title: username,
          subtitle: user.name?.full || username,
          customIcon: (
            <UserAvatar
              name={username}
              imageUrl={avatarUrl}
              size={40}
            />
          ),
          onPress: () => {
            alert('View Profile', `View ${username}'s profile. This feature is coming soon.`);
          },
          showChevron: true,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [followers, oxyServices, alert, extractUserId]);

  // Transform blocked users to GroupedSection items
  const blockedUserItems = useMemo(() => {
    return blockedUsers
      .map((blocked) => {
        const { userId, username, avatar } = extractUserInfo(blocked, 'blockedId');
        if (!userId) return null; // Skip invalid users

        const avatarUrl = avatar && oxyServices
          ? oxyServices.getFileDownloadUrl(avatar, 'thumb')
          : undefined;
        const isLoading = actionLoading === userId;

        return {
          id: userId,
          title: username,
          subtitle: 'Blocked',
          customIcon: (
            <UserAvatar
              name={username}
              imageUrl={avatarUrl}
              size={40}
            />
          ),
          customContent: (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPress={() => handleUnblock(userId)}
              onPressIn={handlePressIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.sidebarIconSharing} />
              ) : (
                <Text style={[styles.actionButtonText, { color: colors.sidebarIconSharing }]}>Unblock</Text>
              )}
            </TouchableOpacity>
          ),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [blockedUsers, oxyServices, colors, handleUnblock, handlePressIn, extractUserInfo, actionLoading]);

  // Transform restricted users to GroupedSection items
  const restrictedUserItems = useMemo(() => {
    return restrictedUsers
      .map((restricted) => {
        const { userId, username, avatar } = extractUserInfo(restricted, 'restrictedId');
        if (!userId) return null; // Skip invalid users

        const avatarUrl = avatar && oxyServices
          ? oxyServices.getFileDownloadUrl(avatar, 'thumb')
          : undefined;
        const isLoading = actionLoading === userId;

        return {
          id: userId,
          title: username,
          subtitle: 'Restricted • Limited interactions',
          customIcon: (
            <UserAvatar
              name={username}
              imageUrl={avatarUrl}
              size={40}
            />
          ),
          customContent: (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPress={() => handleUnrestrict(userId)}
              onPressIn={handlePressIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.sidebarIconData} />
              ) : (
                <Text style={[styles.actionButtonText, { color: colors.sidebarIconData }]}>Unrestrict</Text>
              )}
            </TouchableOpacity>
          ),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [restrictedUsers, oxyServices, colors, handleUnrestrict, handlePressIn, extractUserInfo, actionLoading]);

  // Show loading state
  if (oxyLoading || isLoading || privacyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
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
        title="People & sharing"
        subtitle="Manage people you follow, block, and restrict."
        message="Please sign in to view your people & sharing settings."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  // Show error state
  if (error) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.errorContainer, { backgroundColor: colors.background }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={48} color={colors.sidebarIconSharing} />
          <ThemedText style={[styles.errorText, { color: colors.text }]}>{error}</ThemedText>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.tint }]}
            onPress={() => {
              setError(null);
              loadUsers();
            }}
            onPressIn={handlePressIn}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContentWrapper>
    );
  }

  const renderContent = () => (
    <>
      {/* Statistics Overview */}
      <Section title="Overview" isFirst>
        <ThemedText style={styles.sectionSubtitle}>Your social connections and privacy settings</ThemedText>
        <AccountInfoGrid cards={statisticsCards} onPressIn={handlePressIn} />
      </Section>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <ThemedText style={styles.sectionSubtitle}>Common actions for managing your connections</ThemedText>
        <QuickActionsSection actions={quickActions} onPressIn={handlePressIn} />
      </Section>

      {/* Privacy Controls */}
      <Section title="Privacy controls">
        <ThemedText style={styles.sectionSubtitle}>Control who can interact with you and your content</ThemedText>
        <AccountCard>
          <GroupedSection items={peoplePrivacyItems} />
        </AccountCard>
      </Section>

      {/* Following Section */}
      <Section title="Following">
        <ThemedText style={styles.sectionSubtitle}>People you follow</ThemedText>
        {followingItems.length === 0 ? (
          <AccountCard>
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="account-plus-outline"
                size={48}
                color={colors.sidebarIconPersonalInfo}
                style={styles.emptyIcon}
              />
              <ThemedText style={[styles.emptyText, { color: colors.text }]}>Not following anyone yet</ThemedText>
              <ThemedText style={[styles.emptySubtext, { color: colors.secondaryText }]}>
                Start following people to see their updates and connect with them.
              </ThemedText>
            </View>
          </AccountCard>
        ) : (
          <AccountCard>
            <GroupedSection items={followingItems} />
          </AccountCard>
        )}
      </Section>

      {/* Followers Section */}
      <Section title="Followers">
        <ThemedText style={styles.sectionSubtitle}>People following you</ThemedText>
        {followersItems.length === 0 ? (
          <AccountCard>
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="account-group-outline"
                size={48}
                color={colors.sidebarIconHome}
                style={styles.emptyIcon}
              />
              <ThemedText style={[styles.emptyText, { color: colors.text }]}>No followers yet</ThemedText>
              <ThemedText style={[styles.emptySubtext, { color: colors.secondaryText }]}>
                Share your profile to get more followers and grow your network.
              </ThemedText>
            </View>
          </AccountCard>
        ) : (
          <AccountCard>
            <GroupedSection items={followersItems} />
          </AccountCard>
        )}
      </Section>

      {/* Blocked Section */}
      <Section title="Blocked users">
        <ThemedText style={styles.sectionSubtitle}>Users you have blocked</ThemedText>
        {blockedUserItems.length === 0 ? (
          <AccountCard>
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="account-cancel-outline"
                size={48}
                color={colors.sidebarIconSharing}
                style={styles.emptyIcon}
              />
              <ThemedText style={[styles.emptyText, { color: colors.text }]}>No blocked users</ThemedText>
              <ThemedText style={[styles.emptySubtext, { color: colors.secondaryText }]}>
                Blocked users won&apos;t be able to see your content or interact with you.
              </ThemedText>
            </View>
          </AccountCard>
        ) : (
          <AccountCard>
            <GroupedSection items={blockedUserItems} />
          </AccountCard>
        )}
      </Section>

      {/* Restricted Section */}
      <Section title="Restricted users">
        <ThemedText style={styles.sectionSubtitle}>Users with limited interactions</ThemedText>
        {restrictedUserItems.length === 0 ? (
          <AccountCard>
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="account-lock-outline"
                size={48}
                color={colors.sidebarIconData}
                style={styles.emptyIcon}
              />
              <ThemedText style={[styles.emptyText, { color: colors.text }]}>No restricted users</ThemedText>
              <ThemedText style={[styles.emptySubtext, { color: colors.secondaryText }]}>
                Restricted users have limited interactions with your account without fully blocking them.
              </ThemedText>
            </View>
          </AccountCard>
        ) : (
          <AccountCard>
            <GroupedSection items={restrictedUserItems} />
          </AccountCard>
        )}
      </Section>
    </>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="People & sharing" subtitle="Manage your connections and privacy settings." />
        {renderContent()}
      </>
    );
  }

  return (
    <ScreenContentWrapper
      refreshing={isRefreshing}
      onRefresh={() => loadUsers(true)}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="People & sharing" subtitle="Manage your connections and privacy settings." />
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyIcon: {
    marginBottom: 8,
    opacity: 0.5,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});

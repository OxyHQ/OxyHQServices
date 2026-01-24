import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { menuItems, type MenuItem } from '@/components/ui/sidebar-content';
import { darkenColor } from '@/utils/color-utils';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
// @ts-expect-error - FollowButton has conditional export type issue
import { useOxy, FollowButton } from '@oxyhq/services';
import type { User, BlockedUser, RestrictedUser } from '@oxyhq/services';
import { UserAvatar } from '@/components/user-avatar';

export default function SearchScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const searchQuery = params.q || '';
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = useMemo(() => Platform.OS === 'web' && width >= 768, [width]);

  // OxyServices integration
  const { user, oxyServices, isAuthenticated, showBottomSheet } = useOxy();

  // User search state
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const userSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [restrictedUsers, setRestrictedUsers] = useState<RestrictedUser[]>([]);

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

  // Load blocked and restricted users for filtering
  useEffect(() => {
    if (!oxyServices || !isAuthenticated || !user?.id) return;

    const loadBlockedRestricted = async () => {
      try {
        const [blocked, restricted] = await Promise.all([
          oxyServices.getBlockedUsers(),
          oxyServices.getRestrictedUsers(),
        ]);
        setBlockedUsers(blocked || []);
        setRestrictedUsers(restricted || []);
      } catch (err) {
        console.error('Failed to load blocked/restricted users:', err);
      }
    };

    loadBlockedRestricted();
  }, [oxyServices, isAuthenticated, user?.id]);

  // Sync local state with route params
  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  // Search for users with debouncing
  const searchUsers = useCallback(async (query: string) => {
    if (!oxyServices || !query.trim() || query.length < 2 || !isAuthenticated) {
      setUserSearchResults([]);
      setIsSearchingUsers(false);
      return;
    }

    try {
      setIsSearchingUsers(true);
      const response = await oxyServices.searchProfiles(query, { limit: 10 });

      // Filter out current user, blocked users, and restricted users
      const filtered = (response.data || []).filter((u) => {
        const userId = extractUserId(u);
        if (!userId) return false; // Skip invalid users

        const currentUserId = extractUserId(user);
        if (!currentUserId) return false;

        // Filter out current user
        if (userId === currentUserId) {
          return false;
        }

        // Filter out blocked users
        const isBlocked = blockedUsers.some(blocked => {
          const blockedId = typeof blocked.blockedId === 'string'
            ? blocked.blockedId
            : (blocked.blockedId._id || '');
          return blockedId === userId;
        });
        if (isBlocked) {
          return false;
        }

        // Filter out restricted users
        const isRestricted = restrictedUsers.some(restricted => {
          const restrictedId = typeof restricted.restrictedId === 'string'
            ? restricted.restrictedId
            : (restricted.restrictedId._id || '');
          return restrictedId === userId;
        });
        if (isRestricted) {
          return false;
        }

        return true;
      });

      setUserSearchResults(filtered);
    } catch (err: any) {
      console.error('Failed to search users:', err);
      setUserSearchResults([]);
    } finally {
      setIsSearchingUsers(false);
    }
  }, [oxyServices, user, blockedUsers, restrictedUsers, extractUserId, isAuthenticated]);

  // Debounced user search effect
  useEffect(() => {
    if (userSearchTimeoutRef.current) {
      clearTimeout(userSearchTimeoutRef.current);
    }

    if (searchQuery.trim().length >= 2 && isAuthenticated) {
      userSearchTimeoutRef.current = setTimeout(() => {
        searchUsers(searchQuery);
      }, 500);
    } else {
      setUserSearchResults([]);
      setIsSearchingUsers(false);
    }

    return () => {
      if (userSearchTimeoutRef.current) {
        clearTimeout(userSearchTimeoutRef.current);
      }
    };
  }, [searchQuery, searchUsers, isAuthenticated]);

  const handleSearchChange = (text: string) => {
    setLocalSearchQuery(text);
    router.setParams({ q: text || '' });
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }
    const query = searchQuery.toLowerCase();
    return menuItems.filter(item =>
      item.label.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const groupedItems = useMemo(() => {
    return filteredItems.map((item) => {
      const iconColor = colors[item.iconColor as keyof typeof colors] as string;
      return {
        id: item.path,
        icon: item.icon,
        iconColor: iconColor,
        title: item.label,
        onPress: () => router.push(item.path as any),
        showChevron: true,
      };
    });
  }, [filteredItems, colors, router]);

  // Transform user search results to GroupedSection items with FollowButton
  const userSearchResultItems = useMemo(() => {
    return userSearchResults
      .map((user) => {
        const userId = extractUserId(user);
        if (!userId) return null; // Skip invalid users

        const username = user.username || user.name?.full || user.name?.first || 'Unknown';
        const userUsername = user.username || undefined;
        const avatarUrl = user.avatar && oxyServices
          ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb')
          : undefined;

        return {
          id: userId,
          title: username,
          subtitle: user.name?.full || user.bio || username,
          customIcon: (
            <UserAvatar
              name={username}
              imageUrl={avatarUrl}
              size={40}
            />
          ),
          customContent: (
            // @ts-expect-error - FollowButton has conditional export type issue
            <FollowButton
              userId={userId}
              initiallyFollowing={false}
              size="small"
              theme={colorScheme}
            />
          ),
          onPress: () => {
            if (showBottomSheet) {
              showBottomSheet({
                screen: 'Profile',
                props: {
                  userId: userId,
                  username: userUsername,
                },
              });
            }
          },
          showChevron: true,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [userSearchResults, oxyServices, colorScheme, extractUserId, showBottomSheet]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenContentWrapper>
        <View style={[styles.content, isDesktop && styles.desktopContent]}>
          {!searchQuery.trim() ? (
            <View style={styles.startSearchContainer}>
              <View style={styles.startSearchContent}>
                <MaterialCommunityIcons
                  name="magnify"
                  size={isDesktop ? 96 : 64}
                  color={colors.text}
                  style={styles.startSearchIcon}
                />
                <View style={styles.titleDescriptionWrapper}>
                  <ThemedText style={[styles.startSearchTitle, { color: colors.text }]}>Start searching</ThemedText>
                  <ThemedText style={[styles.startSearchSubtitle, { color: colors.text }]}>
                    Type in the search bar above to find screens and navigate to different sections of your account.
                  </ThemedText>
                </View>
                <View style={styles.suggestionsContainer}>
                  <ThemedText style={[styles.suggestionsTitle, { color: colors.text }]}>Try searching for:</ThemedText>
                  <View style={styles.suggestionsList}>
                    {menuItems.slice(0, 6).map((item) => {
                      const iconColor = colors[item.iconColor as keyof typeof colors] as string;
                      return (
                        <TouchableOpacity
                          key={item.path}
                          style={[styles.suggestionItem, { backgroundColor: colors.card }]}
                          onPress={() => router.push(item.path as any)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.suggestionIcon, { backgroundColor: iconColor }]}>
                            <MaterialCommunityIcons name={item.icon} size={20} color={darkenColor(iconColor)} />
                          </View>
                          <ThemedText style={[styles.suggestionText, { color: colors.text }]}>{item.label}</ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <ThemedText style={styles.subtitle}>
                  {filteredItems.length + userSearchResultItems.length} {(filteredItems.length + userSearchResultItems.length) === 1 ? 'result' : 'results'} for "{searchQuery}"
                </ThemedText>
              </View>
              {filteredItems.length === 0 && userSearchResultItems.length === 0 && !isSearchingUsers ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons
                    name="magnify"
                    size={48}
                    color={colors.icon}
                    style={styles.emptyIcon}
                  />
                  <ThemedText style={styles.emptyText}>No results found</ThemedText>
                  <ThemedText style={styles.emptySubtext}>
                    Try searching for something else
                  </ThemedText>
                </View>
              ) : (
                <>
                  {filteredItems.length > 0 && (
                    <Section isFirst>
                      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Screens</ThemedText>
                      <AccountCard>
                        <GroupedSection items={groupedItems} />
                      </AccountCard>
                    </Section>
                  )}
                  {isSearchingUsers && userSearchResultItems.length === 0 && (
                    <Section isFirst={filteredItems.length === 0}>
                      <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={colors.tint} />
                        <ThemedText style={[styles.loadingText, { color: colors.text }]}>Searching users...</ThemedText>
                      </View>
                    </Section>
                  )}
                  {userSearchResultItems.length > 0 && (
                    <Section isFirst={filteredItems.length === 0}>
                      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>People</ThemedText>
                      <AccountCard>
                        <GroupedSection items={userSearchResultItems} />
                      </AccountCard>
                    </Section>
                  )}
                </>
              )}
            </>
          )}
        </View>
      </ScreenContentWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingTop: 0,
  },
  desktopContent: {
    padding: 32,
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 8,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
    lineHeight: 22,
  },
  startSearchContainer: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'web' ? 40 : 20,
    paddingBottom: 40,
  },
  startSearchContent: {
    alignItems: 'flex-start',
    width: '100%',
  },
  startSearchIcon: {
    marginBottom: 24,
  },
  titleDescriptionWrapper: {
    maxWidth: 600,
    width: '100%',
    marginBottom: 32,
  },
  startSearchTitle: {
    fontSize: Platform.OS === 'web' ? 56 : 36,
    fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-Bold',
    marginBottom: 16,
    textAlign: 'left',
    lineHeight: Platform.OS === 'web' ? 64 : 44,
  },
  startSearchSubtitle: {
    fontSize: Platform.OS === 'web' ? 18 : 16,
    opacity: 0.7,
    textAlign: 'left',
    lineHeight: Platform.OS === 'web' ? 26 : 24,
  },
  suggestionsContainer: {
    width: '100%',
    alignItems: 'flex-start',
  },
  suggestionsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    opacity: 0.8,
  },
  suggestionsList: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 999,
    gap: 8,
  },
  suggestionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionText: {
    fontSize: 15,
    opacity: 0.8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    opacity: 0.5,
    marginBottom: 24,
  },
  emptyText: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 12,
    opacity: 0.9,
  },
  emptySubtext: {
    fontSize: 16,
    opacity: 0.7,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
});


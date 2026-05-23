import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { menuItems, type MenuItem } from '@/components/ui/sidebar-content';
import { darkenColor } from '@/utils/color-utils';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, FollowButton as ImportedFollowButton } from '@oxyhq/services';
import type { User, BlockedUser, RestrictedUser } from '@oxyhq/core';
import { getAccountDisplayName, getAccountFallbackHandle } from '@oxyhq/core';
import { Avatar } from '@oxyhq/services';
import { useTranslation } from '@/lib/i18n';

// Explicit type annotation to avoid implicit any when services source has transient TS errors
const FollowButton: React.FC<{
  userId: string;
  initiallyFollowing?: boolean;
  size?: 'small' | 'medium' | 'large';
  theme?: 'light' | 'dark';
}> = ImportedFollowButton;

export default function SearchScreen() {
  const { mode } = useTheme();
  const colors = useColors();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const searchQuery = params.q || '';
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const isDesktop = useMemo(() => Platform.OS === 'web' && width >= 768, [width]);
  const { t, locale } = useTranslation();

  // OxyServices integration
  const { user, oxyServices, isAuthenticated, showBottomSheet } = useOxy();

  // User search state
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
      const filtered = (response.data || []).filter((u: User) => {
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

  const handleRefresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setRefreshing(true);
    try {
      // Refresh blocked/restricted lists and re-run active search in parallel
      const refreshPromises: Array<Promise<unknown>> = [];
      if (oxyServices && user?.id) {
        refreshPromises.push(
          Promise.all([
            oxyServices.getBlockedUsers(),
            oxyServices.getRestrictedUsers(),
          ]).then(([blocked, restricted]) => {
            setBlockedUsers(blocked || []);
            setRestrictedUsers(restricted || []);
          }),
        );
      }
      if (searchQuery.trim().length >= 2) {
        refreshPromises.push(searchUsers(searchQuery));
      }
      await Promise.all(refreshPromises);
    } finally {
      setRefreshing(false);
    }
  }, [isAuthenticated, oxyServices, user?.id, searchQuery, searchUsers]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }
    const query = searchQuery.toLowerCase();
    return menuItems.filter(item =>
      t(item.labelKey).toLowerCase().includes(query)
    );
  }, [searchQuery, t]);

  const groupedItems = useMemo(() => {
    return filteredItems.map((item) => {
      const iconColor = colors[item.iconColor as keyof typeof colors] as string;
      return {
        id: item.path,
        icon: item.icon,
        iconColor: iconColor,
        title: t(item.labelKey),
        onPress: () => router.push(item.path),
        showChevron: true,
      };
    });
  }, [filteredItems, colors, router, t]);

  // Transform user search results to GroupedSection items with FollowButton
  const userSearchResultItems = useMemo(() => {
    return userSearchResults
      .map((user) => {
        const userId = extractUserId(user);
        if (!userId) return null; // Skip invalid users

        // Always derive a friendly display name from the canonical helper so
        // partially-onboarded accounts (publicKey only) read as
        // `Account 0x12345678…` rather than the harsh "Unknown".
        const username = getAccountDisplayName(user, locale);
        const userUsername = user.username || undefined;
        const fallbackHandle = getAccountFallbackHandle(user);
        const avatarUrl = user.avatar && oxyServices
          ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb')
          : undefined;

        return {
          id: userId,
          title: username,
          subtitle: user.bio
            || (fallbackHandle ? (user.username ? `@${fallbackHandle}` : fallbackHandle) : username),
          customIcon: (
            <Avatar
              name={username}
              uri={avatarUrl}
              size={40}
            />
          ),
          customContent: (
            <FollowButton
              userId={userId}
              initiallyFollowing={false}
              size="small"
              theme={mode}
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
  }, [userSearchResults, oxyServices, mode, extractUserId, showBottomSheet, locale]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
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
                  <ThemedText style={[styles.startSearchTitle, { color: colors.text }]}>{t('search.startTitle')}</ThemedText>
                  <ThemedText style={[styles.startSearchSubtitle, { color: colors.text }]}>
                    {t('search.startSubtitle')}
                  </ThemedText>
                </View>
                <View style={styles.suggestionsContainer}>
                  <ThemedText style={[styles.suggestionsTitle, { color: colors.text }]}>{t('search.suggestionsTitle')}</ThemedText>
                  <View style={styles.suggestionsList}>
                    {menuItems.slice(0, 6).map((item) => {
                      const iconColor = colors[item.iconColor as keyof typeof colors] as string;
                      return (
                        <TouchableOpacity
                          key={item.path}
                          style={[styles.suggestionItem, { backgroundColor: colors.card }]}
                          onPress={() => router.push(item.path)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={t('a11y.suggestion', { title: t(item.labelKey) })}
                        >
                          <View style={[styles.suggestionIcon, { backgroundColor: iconColor }]}>
                            <MaterialCommunityIcons name={item.icon} size={20} color={darkenColor(iconColor)} />
                          </View>
                          <ThemedText style={[styles.suggestionText, { color: colors.text }]}>{t(item.labelKey)}</ThemedText>
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
                  {t('search.resultsCount', { count: filteredItems.length + userSearchResultItems.length, query: searchQuery })}
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
                  <ThemedText style={styles.emptyText}>{t('search.noResults')}</ThemedText>
                  <ThemedText style={styles.emptySubtext}>
                    {t('search.noResultsSubtitle')}
                  </ThemedText>
                </View>
              ) : (
                <>
                  {filteredItems.length > 0 && (
                    <Section isFirst>
                      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>{t('search.screens')}</ThemedText>
                      <AccountCard>
                        <GroupedSection items={groupedItems} />
                      </AccountCard>
                    </Section>
                  )}
                  {isSearchingUsers && userSearchResultItems.length === 0 && (
                    <Section isFirst={filteredItems.length === 0}>
                      <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={colors.tint} />
                        <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('search.searchingUsers')}</ThemedText>
                      </View>
                    </Section>
                  )}
                  {userSearchResultItems.length > 0 && (
                    <Section isFirst={filteredItems.length === 0}>
                      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>{t('search.people')}</ThemedText>
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


import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeColors, type ThemeColors } from '../styles';
import Avatar from '../components/Avatar';
import { FollowButton } from '../components';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { logger } from '../../utils/loggerUtils';
import type { User } from '../../models/interfaces';

type ListMode = 'followers' | 'following';

interface UserListScreenProps extends BaseScreenProps {
  userId: string;
  mode: ListMode;
  initialCount?: number;
}

const PAGE_SIZE = 20;

const UserListScreen: React.FC<UserListScreenProps> = ({
  userId,
  mode,
  initialCount,
  theme,
  goBack,
  navigate,
}) => {
  const { oxyServices, user: currentUser } = useOxy();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(initialCount ?? 0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const colors = useThemeColors((theme as 'light' | 'dark') ?? 'light');
  const styles = createStyles(colors);
  const { t } = useI18n();

  const currentUserId = currentUser?.id || (currentUser?._id as string | undefined);

  const fetchUsers = useCallback(
    async (offset = 0, isRefresh = false) => {
      if (!userId) {
        setError('No user ID provided');
        setIsLoading(false);
        return;
      }

      try {
        if (isRefresh) {
          setIsRefreshing(true);
        } else if (offset === 0) {
          setIsLoading(true);
        } else {
          setIsLoadingMore(true);
        }
        setError(null);

        const response =
          mode === 'followers'
            ? await oxyServices.getUserFollowers(userId, { limit: PAGE_SIZE, offset })
            : await oxyServices.getUserFollowing(userId, { limit: PAGE_SIZE, offset });

        const newUsers = mode === 'followers' ? response.followers : response.following;

        if (offset === 0 || isRefresh) {
          setUsers(newUsers);
        } else {
          setUsers((prev) => [...prev, ...newUsers]);
        }

        setTotal(response.total);
        setHasMore(response.hasMore);
      } catch (err) {
        logger.error(`Failed to fetch ${mode}`, err instanceof Error ? err : new Error(String(err)), {
          component: 'UserListScreen',
        });
        setError(`Failed to load ${mode}. Please try again.`);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
        setIsRefreshing(false);
      }
    },
    [userId, mode, oxyServices]
  );

  useEffect(() => {
    fetchUsers(0);
  }, [fetchUsers]);

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore && !isLoading) {
      fetchUsers(users.length);
    }
  }, [isLoadingMore, hasMore, isLoading, users.length, fetchUsers]);

  const handleRefresh = useCallback(() => {
    fetchUsers(0, true);
  }, [fetchUsers]);

  const handleUserPress = useCallback(
    (user: User) => {
      const targetUserId = user.id || (user._id as string | undefined);
      if (targetUserId && navigate) {
        navigate('Profile', { userId: targetUserId });
      }
    },
    [navigate]
  );

  const renderUser = useCallback(
    ({ item }: { item: User }) => {
      const itemUserId = item.id || (item._id as string) || '';
      const isCurrentUser = itemUserId === currentUserId;
      const description = typeof item.description === 'string' ? item.description : '';

      return (
        <TouchableOpacity
          style={styles.userItem}
          onPress={() => handleUserPress(item)}
          activeOpacity={0.7}
        >
          <Avatar
            uri={
              item.avatar
                ? oxyServices.getFileDownloadUrl(item.avatar as string, 'thumb')
                : undefined
            }
            name={item.username || item.name?.full}
            size={48}
          />
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>
              {item.name?.full || item.username || 'Unknown User'}
            </Text>
            {item.username && (
              <Text style={styles.userHandle} numberOfLines={1}>
                @{item.username}
              </Text>
            )}
            {description ? (
              <Text style={styles.userBio} numberOfLines={2}>
                {description}
              </Text>
            ) : null}
          </View>
          {!isCurrentUser && itemUserId ? (
            <View style={styles.followButtonWrapper}>
              <FollowButton userId={itemUserId} size="small" />
            </View>
          ) : null}
        </TouchableOpacity>
      );
    },
    [colors, styles, handleUserPress, currentUserId, oxyServices]
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name={mode === 'followers' ? 'people-outline' : 'heart-outline'}
          size={64}
          color={colors.secondaryText}
        />
        <Text style={styles.emptyTitle}>
          {mode === 'followers'
            ? t('userList.noFollowers') || 'No followers yet'
            : t('userList.noFollowing') || 'Not following anyone'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {mode === 'followers'
            ? t('userList.noFollowersDesc') || 'When people follow this user, they will appear here.'
            : t('userList.noFollowingDesc') || 'When this user follows people, they will appear here.'}
        </Text>
      </View>
    );
  }, [isLoading, mode, colors, styles, t]);

  const renderFooter = useCallback(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isLoadingMore, colors, styles]);

  const title = mode === 'followers'
    ? (t('userList.followers') || 'Followers')
    : (t('userList.following') || 'Following');

  if (isLoading && users.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          {goBack && (
            <TouchableOpacity onPress={goBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          {goBack && (
            <TouchableOpacity onPress={goBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchUsers(0)}>
            <Text style={styles.retryButtonText}>{t('common.retry') || 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {goBack && (
          <TouchableOpacity onPress={goBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{title}</Text>
          {total > 0 && <Text style={styles.headerCount}>{total}</Text>}
        </View>
        <View style={styles.headerRight} />
      </View>
      <FlatList
        data={users}
        renderItem={renderUser}
        keyExtractor={(item, index) => item.id || (item._id as string) || `user-${index}`}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: {
      padding: 8,
      marginRight: 8,
    },
    headerTitleContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    headerCount: {
      fontSize: 16,
      color: colors.secondaryText,
      marginLeft: 8,
    },
    headerRight: {
      width: 40,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    errorText: {
      fontSize: 16,
      color: colors.error,
      textAlign: 'center',
      marginTop: 16,
      marginBottom: 24,
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    retryButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    listContent: {
      flexGrow: 1,
    },
    userItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    userInfo: {
      flex: 1,
      marginLeft: 12,
      marginRight: 8,
    },
    userName: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    userHandle: {
      fontSize: 14,
      color: colors.secondaryText,
      marginTop: 2,
    },
    userBio: {
      fontSize: 14,
      color: colors.text,
      marginTop: 4,
      opacity: 0.8,
    },
    followButtonWrapper: {
      marginLeft: 'auto',
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 76,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingTop: 80,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      marginTop: 16,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.secondaryText,
      marginTop: 8,
      textAlign: 'center',
    },
    footerLoader: {
      paddingVertical: 16,
      alignItems: 'center',
    },
  });

export default UserListScreen;

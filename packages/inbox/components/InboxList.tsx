/**
 * Inbox message list with search bar, FAB compose, and pull-to-refresh.
 * Used by the (inbox) layout on desktop (always visible) and by the index route on mobile.
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, OxySignInButton } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { MessageRow } from '@/components/MessageRow';
import { SearchHeader } from '@/components/SearchHeader';
import { EmptyIllustration } from '@/components/EmptyIllustration';
import type { Message } from '@/services/emailApi';

interface InboxListProps {
  /** When true, uses router.replace for message navigation (desktop split-view) */
  replaceNavigation?: boolean;
}

export function InboxList({ replaceNavigation }: InboxListProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { isAuthenticated } = useOxy();

  const {
    messages,
    loading,
    refreshing,
    loadingMore,
    currentMailbox,
    selectedMessageId,
    refreshMessages,
    loadMoreMessages,
    toggleStar,
  } = useEmailStore();

  const handleRefresh = useCallback(async () => {
    try {
      await refreshMessages();
    } catch {}
  }, [refreshMessages]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    try {
      await loadMoreMessages();
    } catch {}
  }, [loadMoreMessages, loadingMore]);

  const handleStar = useCallback(
    async (messageId: string) => {
      try {
        await toggleStar(messageId);
      } catch {}
    },
    [toggleStar],
  );

  const handleMessagePress = useCallback(
    (messageId: string) => {
      if (replaceNavigation) {
        router.replace(`/conversation/${messageId}`);
      } else {
        router.push(`/conversation/${messageId}`);
      }
    },
    [router, replaceNavigation],
  );

  const handleOpenDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const handleCompose = useCallback(() => {
    router.push('/compose');
  }, [router]);

  const handleSearch = useCallback(() => {
    router.push('/(drawer)/search');
  }, [router]);

  const mailboxTitle = currentMailbox?.specialUse || currentMailbox?.name || 'Inbox';

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageRow
        message={item}
        onStar={handleStar}
        onSelect={handleMessagePress}
        isSelected={item._id === selectedMessageId}
      />
    ),
    [handleStar, handleMessagePress, selectedMessageId],
  );

  const keyExtractor = useCallback((item: Message) => item._id, []);

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: colors.border }]} />,
    [colors.border],
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <EmptyIllustration size={180} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing here</Text>
        <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
          {isAuthenticated
            ? "You're all caught up."
            : 'Sign in to access your mail.'}
        </Text>
        {!isAuthenticated && (
          <OxySignInButton variant="contained" style={{ marginTop: 8 }} />
        )}
      </View>
    );
  }, [loading, colors, isAuthenticated]);

  const renderFooter = useCallback(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [loadingMore, colors.primary]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SearchHeader
        onLeftIcon={handleOpenDrawer}
        leftIcon="menu"
        placeholder={`Search in ${mailboxTitle.toLowerCase()}`}
        onPress={handleSearch}
      />

      {loading && messages.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <FlatList
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={renderSeparator}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={messages.length === 0 ? styles.emptyListContent : undefined}
        showsVerticalScrollIndicator={false}
      />

      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.composeFab,
            bottom: insets.bottom + 16,
          },
          Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.2,
              shadowRadius: 8,
            },
            android: { elevation: 6 },
            web: { boxShadow: '0 2px 10px rgba(0,0,0,0.2)' } as any,
          }),
        ]}
        onPress={handleCompose}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="pencil" size={24} color={colors.composeFabIcon} />
        {Platform.OS === 'web' && (
          <Text style={[styles.fabLabel, { color: colors.composeFabText }]}>Compose</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyListContent: {
    flexGrow: 1,
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 10,
  },
  fabLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});

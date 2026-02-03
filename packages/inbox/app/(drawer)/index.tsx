/**
 * Inbox screen — Gmail-style email list with search bar, FAB compose, and pull-to-refresh.
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
import type { Message } from '@/services/emailApi';

export default function InboxScreen() {
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
    ({ item }: { item: Message }) => <MessageRow message={item} onStar={handleStar} />,
    [handleStar],
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
        <MaterialCommunityIcons
          name="email-open-outline"
          size={64}
          color={colors.secondaryText}
        />
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
      {/* Search Bar / App Bar */}
      <View style={[styles.appBar, { paddingTop: insets.top + 8, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[styles.searchBar, { backgroundColor: colors.searchBackground }]}
          onPress={handleSearch}
          activeOpacity={0.8}
        >
          <TouchableOpacity onPress={handleOpenDrawer} activeOpacity={0.7}>
            <MaterialCommunityIcons name="menu" size={24} color={colors.icon} />
          </TouchableOpacity>
          <Text style={[styles.searchPlaceholder, { color: colors.searchPlaceholder, flex: 1 }]}>
            Search in {mailboxTitle.toLowerCase()}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {loading && messages.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {/* Message List */}
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

      {/* FAB Compose */}
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
  appBar: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  searchBar: {
    width: '100%',
    maxWidth: 720,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 28,
    paddingHorizontal: 16,
    gap: 12,
  },
  searchPlaceholder: {
    fontSize: 16,
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

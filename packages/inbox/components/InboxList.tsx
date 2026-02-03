/**
 * Inbox message list with search bar, FAB compose, and pull-to-refresh.
 * Used by the (inbox) layout on desktop (always visible) and by the index route on mobile.
 */

import React, { useCallback, useMemo, useEffect } from 'react';
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
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, OxySignInButton, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import {
  useToggleStar,
  useToggleRead,
  useArchiveMessage,
  useDeleteMessage,
} from '@/hooks/mutations/useMessageMutations';
import { MessageRow } from '@/components/MessageRow';
import { SearchHeader } from '@/components/SearchHeader';
import { SelectionToolbar } from '@/components/SelectionToolbar';
import { SwipeableRow } from '@/components/SwipeableRow';
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

  const currentMailbox = useEmailStore((s) => s.currentMailbox);
  const selectedMessageId = useEmailStore((s) => s.selectedMessageId);
  const isSelectionMode = useEmailStore((s) => s.isSelectionMode);
  const selectedMessageIds = useEmailStore((s) => s.selectedMessageIds);
  const toggleMessageSelection = useEmailStore((s) => s.toggleMessageSelection);
  const enterSelectionMode = useEmailStore((s) => s.enterSelectionMode);
  const clearSelection = useEmailStore((s) => s.clearSelection);

  const {
    data,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = useMessages(currentMailbox?._id);
  const { data: mailboxes = [] } = useMailboxes();
  const toggleStar = useToggleStar();
  const toggleRead = useToggleRead();
  const archiveMutation = useArchiveMessage();
  const deleteMutation = useDeleteMessage();

  const messages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  // Clear selection when mailbox changes
  useEffect(() => {
    clearSelection();
  }, [currentMailbox?._id, clearSelection]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (isFetchingNextPage || !hasNextPage) return;
    fetchNextPage();
  }, [fetchNextPage, isFetchingNextPage, hasNextPage]);

  const handleStar = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m._id === messageId);
      if (msg) toggleStar.mutate({ messageId, starred: !msg.flags.starred });
    },
    [messages, toggleStar],
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
    if (replaceNavigation) {
      router.replace('/compose');
    } else {
      router.push('/compose');
    }
  }, [router, replaceNavigation]);

  const handleSearch = useCallback(() => {
    router.push('/search');
  }, [router]);

  const handleLongPress = useCallback(
    (id: string) => {
      enterSelectionMode(id);
    },
    [enterSelectionMode],
  );

  // Bulk actions
  const handleBulkArchive = useCallback(() => {
    const archiveBox = mailboxes.find((m) => m.specialUse === 'Archive');
    if (!archiveBox) return;
    selectedMessageIds.forEach((id) => {
      archiveMutation.mutate({ messageId: id, archiveMailboxId: archiveBox._id });
    });
    clearSelection();
  }, [selectedMessageIds, mailboxes, archiveMutation, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    const trashBox = mailboxes.find((m) => m.specialUse === 'Trash');
    const isInTrash = currentMailbox?.specialUse === 'Trash';
    selectedMessageIds.forEach((id) => {
      deleteMutation.mutate({ messageId: id, trashMailboxId: trashBox?._id, isInTrash });
    });
    clearSelection();
  }, [selectedMessageIds, mailboxes, currentMailbox, deleteMutation, clearSelection]);

  const handleBulkStar = useCallback(() => {
    const selected = messages.filter((m) => selectedMessageIds.has(m._id));
    const shouldStar = selected.some((m) => !m.flags.starred);
    selected.forEach((msg) => {
      toggleStar.mutate({ messageId: msg._id, starred: shouldStar });
    });
    clearSelection();
  }, [selectedMessageIds, messages, toggleStar, clearSelection]);

  const handleBulkMarkRead = useCallback(() => {
    const selected = messages.filter((m) => selectedMessageIds.has(m._id));
    const shouldMarkRead = selected.some((m) => !m.flags.seen);
    selected.forEach((msg) => {
      toggleRead.mutate({ messageId: msg._id, seen: shouldMarkRead });
    });
    clearSelection();
  }, [selectedMessageIds, messages, toggleRead, clearSelection]);

  const mailboxTitle = currentMailbox?.specialUse || currentMailbox?.name || 'Inbox';

  const handleSwipeArchive = useCallback(
    (messageId: string) => {
      const archiveBox = mailboxes.find((m) => m.specialUse === 'Archive');
      if (archiveBox) archiveMutation.mutate({ messageId, archiveMailboxId: archiveBox._id });
    },
    [mailboxes, archiveMutation],
  );

  const handleSwipeDelete = useCallback(
    (messageId: string) => {
      const trashBox = mailboxes.find((m) => m.specialUse === 'Trash');
      const isInTrash = currentMailbox?.specialUse === 'Trash';
      deleteMutation.mutate({ messageId, trashMailboxId: trashBox?._id, isInTrash });
    },
    [mailboxes, currentMailbox, deleteMutation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <SwipeableRow
        onArchive={() => handleSwipeArchive(item._id)}
        onDelete={() => handleSwipeDelete(item._id)}
      >
        <MessageRow
          message={item}
          onStar={handleStar}
          onSelect={handleMessagePress}
          isSelected={item._id === selectedMessageId}
          isSelectionMode={isSelectionMode}
          isMultiSelected={selectedMessageIds.has(item._id)}
          onToggleSelect={toggleMessageSelection}
          onLongPress={handleLongPress}
        />
      </SwipeableRow>
    ),
    [handleStar, handleMessagePress, selectedMessageId, isSelectionMode, selectedMessageIds, toggleMessageSelection, handleLongPress, handleSwipeArchive, handleSwipeDelete],
  );

  const keyExtractor = useCallback((item: Message) => item._id, []);

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: colors.border }]} />,
    [colors.border],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
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
  }, [isLoading, colors, isAuthenticated]);

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }, [isFetchingNextPage, colors.primary]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isSelectionMode ? (
        <SelectionToolbar
          count={selectedMessageIds.size}
          onClose={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onStar={handleBulkStar}
          onMarkRead={handleBulkMarkRead}
        />
      ) : (
        <SearchHeader
          onLeftIcon={handleOpenDrawer}
          leftIcon="menu"
          placeholder={`Search in ${mailboxTitle.toLowerCase()}`}
          onPress={handleSearch}
        />
      )}

      {isLoading && messages.length === 0 && (
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
        extraData={selectedMessageIds}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isFetchingNextPage}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={messages.length === 0 ? styles.emptyListContent : undefined}
        showsVerticalScrollIndicator={false}
      />

      {!isSelectionMode && (
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
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={PencilEdit01Icon as unknown as IconSvgElement} size={24} color={colors.composeFabIcon} />
          ) : (
            <MaterialCommunityIcons name="pencil" size={24} color={colors.composeFabIcon} />
          )}
          {Platform.OS === 'web' && (
            <Text style={[styles.fabLabel, { color: colors.composeFabText }]}>Compose</Text>
          )}
        </TouchableOpacity>
      )}
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

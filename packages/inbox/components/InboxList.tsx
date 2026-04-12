/**
 * Inbox message list with search bar, FAB compose, and pull-to-refresh.
 * Used by the (inbox) layout on desktop (always visible) and by the index route on mobile.
 */

import React, { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Loading } from '@oxyhq/bloom/loading';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, OxySignInButton, toast } from '@oxyhq/services';

import { useColors } from '@/constants/theme';
import { SPECIAL_USE } from '@/constants/mailbox';
import { useEmailStore } from '@/hooks/useEmail';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useLabels } from '@/hooks/queries/useLabels';
import {
  useToggleStar,
  useToggleRead,
  useArchiveMessage,
  useDeleteMessage,
  useTogglePin,
  useSnoozeMessage,
  useBulkUpdateFlags,
  useBulkMoveMessages,
} from '@/hooks/mutations/useMessageMutations';
import { MessageRow } from '@/components/MessageRow';
import { SearchHeader } from '@/components/SearchHeader';
import { SelectionToolbar } from '@/components/SelectionToolbar';
import { SwipeableRow } from '@/components/SwipeableRow';
import { SnoozeSheet } from '@/components/SnoozeSheet';
import { BundleRow } from '@/components/BundleRow';
import { ReminderRow } from '@/components/ReminderRow';
import { CreateReminderSheet } from '@/components/CreateReminderSheet';
import { EmptyIllustration } from '@/components/EmptyIllustration';
import { AliaChatSheet, type AliaChatSheetRef } from '@alia.onl/sdk';
import { AliaFace } from '@/components/AliaFace';
import { useBatchSentimentAnalysis } from '@/hooks/queries/useSentimentAnalysis';
import { useBundles } from '@/hooks/queries/useBundles';
import { useReminders } from '@/hooks/queries/useReminders';
import { useCreateReminder, useUpdateReminder, useDeleteReminder } from '@/hooks/mutations/useReminderMutations';
import type { Message, Bundle, Reminder } from '@/services/emailApi';

type ListItem =
  | { type: 'header'; title: string; key: string }
  | { type: 'message'; data: Message }
  | { type: 'bundle'; bundle: Bundle; messages: Message[]; unreadCount: number }
  | { type: 'reminder'; data: Reminder };

function getDateCategory(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = today.getTime() - msgDay.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  if (diffDays < 30) return 'This Month';
  return 'Earlier';
}

interface InboxListProps {
  /** When true, uses router.replace for message navigation (desktop split-view) */
  replaceNavigation?: boolean;
}

export function InboxList({ replaceNavigation }: InboxListProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const aliaChatRef = useRef<AliaChatSheetRef>(null);
  const { isAuthenticated } = useOxy();

  const currentMailbox = useEmailStore((s) => s.currentMailbox);
  const viewMode = useEmailStore((s) => s.viewMode);
  const selectedMessageId = useEmailStore((s) => s.selectedMessageId);
  const isSelectionMode = useEmailStore((s) => s.isSelectionMode);
  const selectedMessageIds = useEmailStore((s) => s.selectedMessageIds);
  const toggleMessageSelection = useEmailStore((s) => s.toggleMessageSelection);
  const enterSelectionMode = useEmailStore((s) => s.enterSelectionMode);
  const clearSelection = useEmailStore((s) => s.clearSelection);

  const messagesOptions = useMemo(() => {
    if (!viewMode) return { mailboxId: currentMailbox?._id };
    switch (viewMode.type) {
      case 'mailbox':
        return { mailboxId: viewMode.mailbox._id };
      case 'starred':
        return { starred: true };
      case 'label':
        return { label: viewMode.labelName };
    }
  }, [viewMode, currentMailbox]);

  const {
    data,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = useMessages(messagesOptions);

  // Surface query errors for debugging
  useEffect(() => {
    if (error) console.error('[InboxList] Messages query error:', error);
  }, [error]);
  const { data: mailboxes = [] } = useMailboxes();
  const { data: labels = [] } = useLabels();
  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    labels.forEach((l) => map.set(l.name, l.color));
    return map;
  }, [labels]);
  const bundleView = useEmailStore((s) => s.bundleView);
  const expandedBundles = useEmailStore((s) => s.expandedBundles);
  const toggleBundle = useEmailStore((s) => s.toggleBundle);

  const toggleStar = useToggleStar();
  const toggleRead = useToggleRead();
  const togglePin = useTogglePin();
  const snoozeMutation = useSnoozeMessage();
  const archiveMutation = useArchiveMessage();
  const deleteMutation = useDeleteMessage();
  const bulkFlags = useBulkUpdateFlags();
  const bulkMove = useBulkMoveMessages();
  const { data: bundles = [] } = useBundles();

  const [snoozeTargetId, setSnoozeTargetId] = useState<string | null>(null);
  const [createReminderVisible, setCreateReminderVisible] = useState(false);

  const { data: remindersResult } = useReminders();
  const reminders = useMemo(() => remindersResult?.data ?? [], [remindersResult]);
  const createReminderMutation = useCreateReminder();
  const updateReminderMutation = useUpdateReminder();
  const deleteReminderMutation = useDeleteReminder();

  const messages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  // Batch sentiment analysis — computed once for all messages, passed as props to rows
  const sentimentMap = useBatchSentimentAnalysis(messages);

  const isInboxView = viewMode?.type === 'mailbox' && viewMode.mailbox.specialUse === SPECIAL_USE.INBOX;
  const isSnoozedView = viewMode?.type === 'mailbox' && viewMode.mailbox.specialUse === SPECIAL_USE.SNOOZED;
  const showBundles = bundleView && isInboxView && bundles.length > 0;

  const listItems = useMemo<ListItem[]>(() => {
    if (messages.length === 0 && reminders.length === 0) return [];
    const items: ListItem[] = [];

    // Due/active reminders at the top (only in inbox view)
    if (isInboxView && reminders.length > 0) {
      const dueReminders = reminders.filter(
        (r) => !r.completed && new Date(r.remindAt) <= new Date(),
      );
      const upcomingReminders = reminders.filter(
        (r) => !r.completed && new Date(r.remindAt) > new Date(),
      );

      if (dueReminders.length > 0) {
        items.push({ type: 'header', title: 'Reminders', key: 'header-Reminders' });
        for (const r of dueReminders) {
          items.push({ type: 'reminder', data: r });
        }
      }
      if (upcomingReminders.length > 0 && upcomingReminders.length <= 3) {
        if (dueReminders.length === 0) {
          items.push({ type: 'header', title: 'Reminders', key: 'header-Reminders' });
        }
        for (const r of upcomingReminders) {
          items.push({ type: 'reminder', data: r });
        }
      }
    }

    // Partition pinned messages to top (only in mailbox views, not snoozed)
    const pinned = !isSnoozedView ? messages.filter((m) => m.flags.pinned) : [];
    const unpinned = !isSnoozedView ? messages.filter((m) => !m.flags.pinned) : messages;

    if (pinned.length > 0) {
      items.push({ type: 'header', title: 'Pinned', key: 'header-Pinned' });
      for (const msg of pinned) {
        items.push({ type: 'message', data: msg });
      }
    }

    // Bundle view: group by bundle labels
    if (showBundles) {
      const enabledBundles = bundles.filter((b) => b.enabled);
      const bundledLabels = new Set<string>();
      for (const b of enabledBundles) {
        for (const l of b.matchLabels) bundledLabels.add(l);
      }

      const primaryMsgs: Message[] = [];
      const bundleMap = new Map<string, Message[]>();
      for (const b of enabledBundles) bundleMap.set(b._id, []);

      for (const msg of unpinned) {
        let matched = false;
        for (const b of enabledBundles) {
          if (b.matchLabels.some((l) => msg.labels.includes(l))) {
            bundleMap.get(b._id)!.push(msg);
            matched = true;
            break;
          }
        }
        if (!matched) primaryMsgs.push(msg);
      }

      // Primary messages with date headers
      let lastCategory = '';
      for (const msg of primaryMsgs) {
        const category = getDateCategory(msg.date);
        if (category !== lastCategory) {
          items.push({ type: 'header', title: category, key: `header-${category}` });
          lastCategory = category;
        }
        items.push({ type: 'message', data: msg });
      }

      // Bundle rows (collapsed or expanded)
      for (const b of enabledBundles) {
        const msgs = bundleMap.get(b._id) || [];
        if (msgs.length === 0) continue;
        const unreadCount = msgs.filter((m) => !m.flags.seen).length;
        items.push({ type: 'bundle', bundle: b, messages: msgs, unreadCount });

        if (expandedBundles.has(b._id)) {
          for (const msg of msgs) {
            items.push({ type: 'message', data: msg });
          }
        }
      }
    } else {
      // Normal flat view with date headers
      let lastCategory = '';
      for (const msg of unpinned) {
        const category = getDateCategory(msg.date);
        if (category !== lastCategory) {
          items.push({ type: 'header', title: category, key: `header-${category}` });
          lastCategory = category;
        }
        items.push({ type: 'message', data: msg });
      }
    }

    return items;
  }, [messages, isSnoozedView, isInboxView, showBundles, bundles, expandedBundles, reminders]);

  // Clear selection when view changes
  useEffect(() => {
    clearSelection();
  }, [viewMode, clearSelection]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (isFetchingNextPage || !hasNextPage) return;
    fetchNextPage();
  }, [fetchNextPage, isFetchingNextPage, hasNextPage]);

  const handleStar = useCallback(
    (messageId: string) => {
      if (toggleStar.isPending) return;
      const msg = messages.find((m) => m._id === messageId);
      if (msg) toggleStar.mutate({ messageId, starred: !msg.flags.starred });
    },
    [messages, toggleStar],
  );

  const handlePin = useCallback(
    (messageId: string) => {
      if (togglePin.isPending) return;
      const msg = messages.find((m) => m._id === messageId);
      if (msg) togglePin.mutate({ messageId, pinned: !msg.flags.pinned });
    },
    [messages, togglePin],
  );

  const handleSnooze = useCallback(
    (until: Date) => {
      if (!snoozeTargetId) return;
      snoozeMutation.mutate({ messageId: snoozeTargetId, until: until.toISOString() });
      setSnoozeTargetId(null);
    },
    [snoozeTargetId, snoozeMutation],
  );

  const handleCreateReminder = useCallback(
    (text: string, remindAt: Date) => {
      createReminderMutation.mutate({ text, remindAt: remindAt.toISOString() });
      setCreateReminderVisible(false);
    },
    [createReminderMutation],
  );

  const handleToggleReminderComplete = useCallback(
    (reminderId: string, completed: boolean) => {
      updateReminderMutation.mutate({ reminderId, completed });
    },
    [updateReminderMutation],
  );

  const handleDeleteReminder = useCallback(
    (reminderId: string) => {
      deleteReminderMutation.mutate(reminderId);
    },
    [deleteReminderMutation],
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

  // Bulk actions — single API call per operation
  const handleBulkArchive = useCallback(() => {
    const archiveBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.ARCHIVE);
    if (!archiveBox) {
      toast.error('Archive folder not available.');
      return;
    }
    bulkMove.mutate({ messageIds: [...selectedMessageIds], mailboxId: archiveBox._id });
    clearSelection();
  }, [selectedMessageIds, mailboxes, bulkMove, clearSelection]);

  const handleBulkDelete = useCallback(() => {
    const trashBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.TRASH);
    if (!trashBox) {
      toast.error('Trash folder not available.');
      return;
    }
    bulkMove.mutate({ messageIds: [...selectedMessageIds], mailboxId: trashBox._id });
    clearSelection();
  }, [selectedMessageIds, mailboxes, bulkMove, clearSelection]);

  const handleBulkStar = useCallback(() => {
    const selected = messages.filter((m) => selectedMessageIds.has(m._id));
    const shouldStar = selected.some((m) => !m.flags.starred);
    bulkFlags.mutate({ messageIds: [...selectedMessageIds], flags: { starred: shouldStar } });
    clearSelection();
  }, [selectedMessageIds, messages, bulkFlags, clearSelection]);

  const handleBulkMarkRead = useCallback(() => {
    const selected = messages.filter((m) => selectedMessageIds.has(m._id));
    const shouldMarkRead = selected.some((m) => !m.flags.seen);
    bulkFlags.mutate({ messageIds: [...selectedMessageIds], flags: { seen: shouldMarkRead } });
    clearSelection();
  }, [selectedMessageIds, messages, bulkFlags, clearSelection]);

  // Derive title from view mode
  const mailboxTitle = useMemo(() => {
    if (viewMode?.type === 'starred') return 'Starred';
    if (viewMode?.type === 'label') return viewMode.labelName;
    if (currentMailbox?.specialUse) return currentMailbox.specialUse.replace(/^\\+/, '');
    return currentMailbox?.name || 'Inbox';
  }, [viewMode, currentMailbox]);

  const handleSwipeArchive = useCallback(
    (messageId: string) => {
      const archiveBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.ARCHIVE);
      if (!archiveBox) {
        toast.error('Archive folder not available.');
        return;
      }
      archiveMutation.mutate({ messageId, archiveMailboxId: archiveBox._id });
    },
    [mailboxes, archiveMutation],
  );

  const handleSwipeDelete = useCallback(
    (messageId: string) => {
      const trashBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.TRASH);
      const isInTrash = currentMailbox?.specialUse === SPECIAL_USE.TRASH;
      deleteMutation.mutate({ messageId, trashMailboxId: trashBox?._id, isInTrash });
    },
    [mailboxes, currentMailbox, deleteMutation],
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return (
          <View style={[styles.sectionHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sectionHeaderText, { color: colors.secondaryText }]}>
              {item.title}
            </Text>
          </View>
        );
      }
      if (item.type === 'bundle') {
        return (
          <BundleRow
            bundle={item.bundle}
            messages={item.messages}
            unreadCount={item.unreadCount}
            isExpanded={expandedBundles.has(item.bundle._id)}
            onToggle={() => toggleBundle(item.bundle._id)}
          />
        );
      }
      if (item.type === 'reminder') {
        return (
          <ReminderRow
            reminder={item.data}
            onToggleComplete={handleToggleReminderComplete}
            onPress={() => {}}
            onDelete={handleDeleteReminder}
          />
        );
      }
      const msg = item.data;
      return (
        <SwipeableRow
          onArchive={() => handleSwipeArchive(msg._id)}
          onDelete={() => handleSwipeDelete(msg._id)}
        >
          <MessageRow
            message={msg}
            onStar={handleStar}
            onPin={handlePin}
            onSelect={handleMessagePress}
            isSelected={msg._id === selectedMessageId}
            isSelectionMode={isSelectionMode}
            isMultiSelected={selectedMessageIds.has(msg._id)}
            onToggleSelect={toggleMessageSelection}
            onLongPress={handleLongPress}
            isStarPending={toggleStar.isPending && toggleStar.variables?.messageId === msg._id}
            isPinPending={togglePin.isPending && togglePin.variables?.messageId === msg._id}
            showSnoozeTime={isSnoozedView}
            labelColorMap={labelColorMap}
            sentiment={sentimentMap.get(msg._id)}
          />
        </SwipeableRow>
      );
    },
    [handleStar, handlePin, handleMessagePress, selectedMessageId, isSelectionMode, selectedMessageIds, toggleMessageSelection, handleLongPress, handleSwipeArchive, handleSwipeDelete, toggleStar.isPending, toggleStar.variables?.messageId, togglePin.isPending, togglePin.variables?.messageId, isSnoozedView, expandedBundles, toggleBundle, labelColorMap, handleToggleReminderComplete, handleDeleteReminder, colors.border, colors.secondaryText, sentimentMap],
  );

  const getItemType = useCallback((item: ListItem) => item.type, []);

  const keyExtractor = useCallback((item: ListItem) => {
    if (item.type === 'header') return item.key;
    if (item.type === 'bundle') return `bundle-${item.bundle._id}`;
    if (item.type === 'reminder') return `reminder-${item.data._id}`;
    return item.data._id;
  }, []);

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
        <Loading variant="inline" size="small" />
      </View>
    );
  }, [isFetchingNextPage]);

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

      {/* Pagination info + bundle toggle */}
      {messages.length > 0 && data?.pages?.[0]?.pagination && (
        <View style={styles.paginationBar}>
          {isInboxView && (
            <TouchableOpacity
              style={[styles.bundleToggle, { borderColor: colors.border }]}
              onPress={() => setCreateReminderVisible(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="bell-plus-outline" size={14} color={colors.secondaryText} />
              <Text style={[styles.bundleToggleText, { color: colors.secondaryText }]}>Remind</Text>
            </TouchableOpacity>
          )}
          {isInboxView && bundles.length > 0 && (
            <TouchableOpacity
              style={[styles.bundleToggle, { borderColor: colors.border }]}
              onPress={useEmailStore.getState().toggleBundleView}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={bundleView ? 'view-list' : 'view-dashboard-outline'}
                size={14}
                color={colors.secondaryText}
              />
              <Text style={[styles.bundleToggleText, { color: colors.secondaryText }]}>
                {bundleView ? 'Flat' : 'Bundled'}
              </Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <Text style={[styles.paginationText, { color: colors.secondaryText }]}>
            1–{messages.length} of {data.pages[0].pagination.total}
          </Text>
        </View>
      )}

      {isLoading && messages.length === 0 && (
        <View style={styles.loadingContainer}>
          <Loading />
        </View>
      )}

      <FlashList
        data={listItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        estimatedItemSize={72}
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
        contentContainerStyle={listItems.length === 0 ? styles.emptyListContent : undefined}
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

      {/* Alia AI chat assistant */}
      {isAuthenticated && !isSelectionMode && (
        <>
          <View style={styles.aliaFab}>
            <TouchableOpacity
              style={styles.aliaFabTouchable}
              onPress={() => aliaChatRef.current?.present()}
              activeOpacity={0.8}
            >
              <AliaFace size={52} expression="Idle A" />
            </TouchableOpacity>
          </View>
          <AliaChatSheet
            ref={aliaChatRef}
            apiUrl="https://api.alia.onl"
            clientContext="User is in the Inbox app viewing their email. Use oxy_inbox tools to access their emails."
            suggestions={[
              { label: 'Unread emails', icon: 'mail', prompt: 'What emails need my attention?' },
              { label: "Today's summary", icon: 'text', prompt: 'Summarize my emails from today' },
              { label: 'With attachments', icon: 'paperclip', prompt: 'Find emails with attachments' },
            ]}
          />
        </>
      )}

      {/* Snooze sheet */}
      <SnoozeSheet
        visible={snoozeTargetId !== null}
        onClose={() => setSnoozeTargetId(null)}
        onSnooze={handleSnooze}
      />

      {/* Create reminder sheet */}
      <CreateReminderSheet
        visible={createReminderVisible}
        onClose={() => setCreateReminderVisible(false)}
        onCreate={handleCreateReminder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
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
  paginationBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 4,
    alignItems: 'center',
  },
  bundleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  bundleToggleText: {
    fontSize: 11,
    fontWeight: '500',
  },
  paginationText: {
    fontSize: 11,
    fontWeight: '500',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aliaFab: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.2)' } as any,
      default: { elevation: 8 },
    }),
    borderRadius: 28,
  },
  aliaFabTouchable: {
    borderRadius: 28,
  },
});

/**
 * Responsive inbox layout.
 *
 * Desktop (web ≥ 900px): two-column split — InboxList on left, Slot (child route) on right.
 * Mobile / narrow: Stack navigation — index shows list, conversation/[id] pushes on top.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Slot, Stack, useRouter } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { SPECIAL_USE } from '@/constants/mailbox';
import { InboxList } from '@/components/InboxList';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useEmailStore } from '@/hooks/useEmail';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useToggleStar, useToggleRead, useArchiveMessage, useDeleteMessage } from '@/hooks/mutations/useMessageMutations';

export default function InboxLayout() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const currentMailbox = useEmailStore((s) => s.currentMailbox);
  const selectedMessageId = useEmailStore((s) => s.selectedMessageId);

  const { data: mailboxes = [] } = useMailboxes();
  const { data: messagesData } = useMessages({
    mailboxId: currentMailbox?._id,
  });
  const messages = useMemo(() => messagesData?.pages.flatMap((p) => p.data) ?? [], [messagesData]);

  const toggleStar = useToggleStar();
  const toggleRead = useToggleRead();
  const archiveMutation = useArchiveMessage();
  const deleteMutation = useDeleteMessage();

  const currentIndex = useMemo(() => {
    if (!selectedMessageId) return -1;
    return messages.findIndex((m) => m._id === selectedMessageId);
  }, [selectedMessageId, messages]);

  const currentMessage = useMemo(() => {
    if (currentIndex === -1) return null;
    return messages[currentIndex] ?? null;
  }, [currentIndex, messages]);

  const handleCompose = useCallback(() => {
    if (isDesktop) {
      router.replace('/compose' as any);
    } else {
      router.push('/compose' as any);
    }
  }, [router, isDesktop]);

  const handleReply = useCallback(() => {
    if (selectedMessageId && currentMessage) {
      if (isDesktop) {
        router.replace({
          pathname: '/compose',
          params: {
            replyTo: currentMessage._id,
            to: currentMessage.from.address,
            subject: currentMessage.subject.startsWith('Re:')
              ? currentMessage.subject
              : `Re: ${currentMessage.subject}`,
          },
        } as any);
      }
    }
  }, [selectedMessageId, currentMessage, router, isDesktop]);

  const handleReplyAll = useCallback(() => {
    if (selectedMessageId && currentMessage) {
      const allTo = [currentMessage.from, ...(currentMessage.to || [])];
      const allCc = currentMessage.cc || [];
      if (isDesktop) {
        router.replace({
          pathname: '/compose',
          params: {
            replyTo: currentMessage._id,
            to: allTo.map((a) => a.address).join(','),
            cc: allCc.map((a) => a.address).join(','),
            subject: currentMessage.subject.startsWith('Re:')
              ? currentMessage.subject
              : `Re: ${currentMessage.subject}`,
          },
        } as any);
      }
    }
  }, [selectedMessageId, currentMessage, router, isDesktop]);

  const handleForward = useCallback(() => {
    if (selectedMessageId && currentMessage) {
      if (isDesktop) {
        router.replace({
          pathname: '/compose',
          params: {
            forward: currentMessage._id,
            subject: currentMessage.subject.startsWith('Fwd:')
              ? currentMessage.subject
              : `Fwd: ${currentMessage.subject}`,
          },
        } as any);
      }
    }
  }, [selectedMessageId, currentMessage, router, isDesktop]);

  const handleArchive = useCallback(() => {
    if (selectedMessageId) {
      const archiveBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.ARCHIVE);
      if (archiveBox) {
        archiveMutation.mutate({ messageId: selectedMessageId, archiveMailboxId: archiveBox._id });
      }
    }
  }, [selectedMessageId, mailboxes, archiveMutation]);

  const handleDelete = useCallback(() => {
    if (selectedMessageId) {
      const trashBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.TRASH);
      const isInTrash = currentMailbox?.specialUse === SPECIAL_USE.TRASH;
      deleteMutation.mutate({ messageId: selectedMessageId, trashMailboxId: trashBox?._id, isInTrash });
    }
  }, [selectedMessageId, mailboxes, currentMailbox, deleteMutation]);

  const handleNextMessage = useCallback(() => {
    if (currentIndex < messages.length - 1) {
      const nextMessage = messages[currentIndex + 1];
      useEmailStore.setState({ selectedMessageId: nextMessage._id });
      if (isDesktop) {
        router.replace(`/conversation/${nextMessage._id}` as any);
      }
    }
  }, [currentIndex, messages, router, isDesktop]);

  const handlePrevMessage = useCallback(() => {
    if (currentIndex > 0) {
      const prevMessage = messages[currentIndex - 1];
      useEmailStore.setState({ selectedMessageId: prevMessage._id });
      if (isDesktop) {
        router.replace(`/conversation/${prevMessage._id}` as any);
      }
    }
  }, [currentIndex, messages, router, isDesktop]);

  const handleToggleStar = useCallback(() => {
    if (selectedMessageId && currentMessage) {
      toggleStar.mutate({ messageId: selectedMessageId, starred: !currentMessage.flags.starred });
    }
  }, [selectedMessageId, currentMessage, toggleStar]);

  const handleMarkUnread = useCallback(() => {
    if (selectedMessageId) {
      toggleRead.mutate({ messageId: selectedMessageId, seen: false });
    }
  }, [selectedMessageId, toggleRead]);

  // Register keyboard shortcuts (web only)
  useKeyboardShortcuts({
    onCompose: handleCompose,
    onReply: handleReply,
    onReplyAll: handleReplyAll,
    onForward: handleForward,
    onArchive: handleArchive,
    onDelete: handleDelete,
    onNextMessage: handleNextMessage,
    onPrevMessage: handlePrevMessage,
    onToggleStar: handleToggleStar,
    onMarkUnread: handleMarkUnread,
    enabled: isDesktop,
  });

  if (isDesktop) {
    return (
      <View style={[styles.splitContainer, { backgroundColor: colors.background }]}>
        <View style={[styles.listPane, { borderRightColor: colors.border }]}>
          <InboxList replaceNavigation />
        </View>
        <View style={styles.detailPane}>
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[view]" />
      <Stack.Screen name="conversation/[id]" />
      <Stack.Screen name="compose" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  listPane: {
    width: 380,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  detailPane: {
    flex: 1,
  },
});

/**
 * Thin action facade over the message mutation hooks.
 *
 * Components (InboxList, MessageDetail, SwipeableRow) call these named actions
 * instead of wiring up individual mutations and resolving mailbox ids inline.
 * All cache logic lives in `utils/messageCache.ts` and the mutation hooks; this
 * layer only orchestrates.
 */

import { useCallback, useMemo } from 'react';
import { useOxy } from '@oxyhq/services';
import { toast } from '@oxyhq/bloom';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { SPECIAL_USE } from '@/constants/mailbox';
import { findCachedMessage } from '@/utils/messageCache';
import { useQueryClient } from '@tanstack/react-query';
import {
  useToggleRead,
  useToggleStar,
  useTogglePin,
  useArchiveMessage,
  useDeleteMessage,
  useSnoozeMessage,
  useUnsnoozeMessage,
} from '@/hooks/mutations/useMessageMutations';

export function useMessageActions() {
  const { user } = useOxy();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const { data: mailboxes = [] } = useMailboxes();

  const toggleRead = useToggleRead();
  const toggleStar = useToggleStar();
  const togglePin = useTogglePin();
  const archiveMutation = useArchiveMessage();
  const deleteMutation = useDeleteMessage();
  const snoozeMutation = useSnoozeMessage();
  const unsnoozeMutation = useUnsnoozeMessage();

  const markAsRead = useCallback(
    (messageId: string) => toggleRead.mutate({ messageId, seen: true }),
    [toggleRead],
  );

  const markAsUnread = useCallback(
    (messageId: string) => toggleRead.mutate({ messageId, seen: false }),
    [toggleRead],
  );

  /** Mark read only if the cached message is currently unread. */
  const markReadIfUnread = useCallback(
    (messageId: string) => {
      const cached = findCachedMessage(queryClient, messageId, userId);
      if (cached && !cached.flags.seen) {
        toggleRead.mutate({ messageId, seen: true });
      }
    },
    [queryClient, userId, toggleRead],
  );

  const star = useCallback(
    (messageId: string, starred: boolean) => toggleStar.mutate({ messageId, starred }),
    [toggleStar],
  );

  const pin = useCallback(
    (messageId: string, pinned: boolean) => togglePin.mutate({ messageId, pinned }),
    [togglePin],
  );

  const archive = useCallback(
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

  const deleteMessage = useCallback(
    (messageId: string) => {
      const trashBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.TRASH);
      const isInTrash = useEmailStore.getState().currentMailbox?.specialUse === SPECIAL_USE.TRASH;
      deleteMutation.mutate({ messageId, trashMailboxId: trashBox?._id, isInTrash });
    },
    [mailboxes, deleteMutation],
  );

  const snooze = useCallback(
    (messageId: string, until: string) => snoozeMutation.mutate({ messageId, until }),
    [snoozeMutation],
  );

  const unsnooze = useCallback(
    (messageId: string) => unsnoozeMutation.mutate({ messageId }),
    [unsnoozeMutation],
  );

  return useMemo(
    () => ({
      markAsRead,
      markAsUnread,
      markReadIfUnread,
      star,
      pin,
      archive,
      deleteMessage,
      snooze,
      unsnooze,
      // Expose underlying mutations for pending/variables introspection.
      mutations: {
        toggleRead,
        toggleStar,
        togglePin,
        archiveMutation,
        deleteMutation,
        snoozeMutation,
        unsnoozeMutation,
      },
    }),
    [
      markAsRead,
      markAsUnread,
      markReadIfUnread,
      star,
      pin,
      archive,
      deleteMessage,
      snooze,
      unsnooze,
      toggleRead,
      toggleStar,
      togglePin,
      archiveMutation,
      deleteMutation,
      snoozeMutation,
      unsnoozeMutation,
    ],
  );
}

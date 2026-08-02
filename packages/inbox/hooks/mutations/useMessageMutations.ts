import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@oxyhq/bloom';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { Message } from '@/services/emailApi';
import {
  cancelMessageQueries,
  findCachedMessage,
  flatMessages,
  mergeServerMessage,
  patchMailboxUnseen,
  patchMessageFlags,
  patchMessageInList,
  removeMessageFromList,
  restoreSnapshot,
  snapshotForRollback,
  type MessagesInfinite,
} from '@/utils/messageCache';

export function useToggleStar() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useMutation({
    // Offline-first: when the device is offline this mutation is queued
    // (status "paused") and auto-resumes when connectivity returns. The
    // mutationFn re-runs through the SDK `httpService`, so auth + CSRF are
    // preserved on replay (see utils/offlineQueue.ts for the full rationale).
    networkMode: 'offlineFirst',
    mutationFn: async ({ messageId, starred }: { messageId: string; starred: boolean }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.updateFlags(messageId, { starred });
    },
    onMutate: async ({ messageId, starred }) => {
      await cancelMessageQueries(queryClient, messageId);
      const snapshot = snapshotForRollback(queryClient, messageId, userId);

      // VIEW-AWARE UPDATE: in the starred view, unstarring removes the row.
      const viewMode = useEmailStore.getState().viewMode;
      if (viewMode?.type === 'starred' && !starred) {
        removeMessageFromList(queryClient, messageId);
        // Keep detail/thread flags in sync for any open panel.
        patchMessageFlags(queryClient, messageId, userId, { starred });
      } else {
        patchMessageFlags(queryClient, messageId, userId, { starred });
      }

      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshot(queryClient, context.snapshot);
      toast.error('Failed to update star.');
    },
    onSuccess: (updatedMessage, { messageId }) => {
      if (updatedMessage) {
        // Don't restore the row to the list if it was removed from starred view.
        const viewMode = useEmailStore.getState().viewMode;
        const skipList = viewMode?.type === 'starred' && !updatedMessage.flags.starred;
        mergeServerMessage(queryClient, messageId, userId, updatedMessage, { skipList });
      }
    },
    onSettled: () => {
      // Reconcile filtered caches (e.g. Starred) with the server.
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useToggleRead() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useMutation({
    // Offline-first — see useToggleStar for the queue/replay rationale.
    networkMode: 'offlineFirst',
    mutationFn: async ({ messageId, seen }: { messageId: string; seen: boolean }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.updateFlags(messageId, { seen });
    },
    onMutate: async ({ messageId, seen }) => {
      await cancelMessageQueries(queryClient, messageId);
      const snapshot = snapshotForRollback(queryClient, messageId, userId);

      // Only adjust the mailbox badge if the seen state actually changes.
      const cached = findCachedMessage(queryClient, messageId, userId);
      if (cached && cached.flags.seen !== seen) {
        // seen=true → one fewer unread; seen=false → one more unread.
        patchMailboxUnseen(queryClient, cached.mailboxId, seen ? -1 : 1);
      }

      patchMessageFlags(queryClient, messageId, userId, { seen });

      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshot(queryClient, context.snapshot);
      toast.error('Failed to update read status.');
    },
    onSuccess: (updatedMessage, { messageId }) => {
      if (updatedMessage) {
        mergeServerMessage(queryClient, messageId, userId, updatedMessage);
      }
    },
    onSettled: () => {
      // Reconcile unseen counts with the server. Message/thread caches are
      // already synced from the server response in onSuccess.
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useArchiveMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    // Offline-first — see useToggleStar for the queue/replay rationale.
    networkMode: 'offlineFirst',
    mutationFn: async ({ messageId, archiveMailboxId }: { messageId: string; archiveMailboxId: string }) => {
      if (!api) throw new Error('Email API not initialized');
      await api.moveMessage(messageId, archiveMailboxId);
    },
    onMutate: async ({ messageId }) => {
      await cancelMessageQueries(queryClient, messageId);
      const prevSelectedMessageId = useEmailStore.getState().selectedMessageId;
      const snapshot = snapshotForRollback(queryClient, messageId, null);
      advanceSelectionPastMessage(queryClient, messageId);
      removeMessageFromList(queryClient, messageId);
      return { snapshot, prevSelectedMessageId };
    },
    onSuccess: () => {
      toast.success('Conversation archived.');
    },
    onError: (_err, _vars, context) => {
      if (context) {
        restoreSnapshot(queryClient, context.snapshot);
        useEmailStore.setState({ selectedMessageId: context.prevSelectedMessageId });
      }
      toast.error('Failed to archive conversation.');
    },
    onSettled: () => {
      // Mark stale but don't trigger immediate refetch — optimistic update is already applied
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useDeleteMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    // Offline-first — see useToggleStar for the queue/replay rationale.
    networkMode: 'offlineFirst',
    mutationFn: async ({
      messageId,
      trashMailboxId,
      isInTrash,
    }: {
      messageId: string;
      trashMailboxId?: string;
      isInTrash: boolean;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      if (isInTrash) {
        await api.deleteMessage(messageId, true);
      } else if (trashMailboxId) {
        await api.moveMessage(messageId, trashMailboxId);
      } else {
        await api.deleteMessage(messageId);
      }
    },
    onMutate: async ({ messageId }) => {
      await cancelMessageQueries(queryClient, messageId);
      const prevSelectedMessageId = useEmailStore.getState().selectedMessageId;
      const snapshot = snapshotForRollback(queryClient, messageId, null);
      advanceSelectionPastMessage(queryClient, messageId);
      removeMessageFromList(queryClient, messageId);
      return { snapshot, prevSelectedMessageId };
    },
    onSuccess: (_data, { isInTrash }) => {
      toast.success(isInTrash ? 'Conversation permanently deleted.' : 'Conversation moved to Trash.');
    },
    onError: (_err, _vars, context) => {
      if (context) {
        restoreSnapshot(queryClient, context.snapshot);
        useEmailStore.setState({ selectedMessageId: context.prevSelectedMessageId });
      }
      toast.error('Failed to delete conversation.');
    },
    onSettled: () => {
      // Mark stale but don't trigger immediate refetch — optimistic update is already applied
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useSendMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: Parameters<NonNullable<typeof api>['sendMessage']>[0]) => {
      if (!api) throw new Error('Email API not initialized');
      await api.sendMessage(params);
    },
    onSuccess: () => {
      toast.success('Message sent.');
    },
    onError: () => {
      toast.error('Failed to send message.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

const UNDO_SEND_DELAY_MS = 5000;

export function useSendMessageWithUndo() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendWithUndo = useCallback(
    async (
      params: Parameters<NonNullable<typeof api>['sendMessage']>[0],
      options?: { onSuccess?: () => void; onError?: (err: unknown) => void },
    ) => {
      if (!api) {
        options?.onError?.(new Error('Email API not initialized'));
        return;
      }

      cancelledRef.current = false;
      setIsPending(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      toast('Sending message...', {
        duration: UNDO_SEND_DELAY_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            cancelledRef.current = true;
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            setIsPending(false);
            toast('Message cancelled.');
          },
        },
      } as Record<string, unknown>);

      timeoutRef.current = setTimeout(async () => {
        if (cancelledRef.current) {
          return;
        }

        try {
          await api.sendMessage(params);
          toast.success('Message sent.');
          queryClient.invalidateQueries({ queryKey: emailKeys.messages.root });
          queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
          options?.onSuccess?.();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to send message.';
          toast.error(message);
          options?.onError?.(err);
        } finally {
          setIsPending(false);
        }
      }, UNDO_SEND_DELAY_MS);
    },
    [api, queryClient],
  );

  return {
    sendWithUndo,
    isPending,
  };
}

export function useUpdateMessageLabels() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useMutation({
    mutationFn: async ({ messageId, add, remove }: { messageId: string; add: string[]; remove: string[] }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.updateLabels(messageId, add, remove);
    },
    onMutate: async ({ messageId, add, remove }) => {
      await cancelMessageQueries(queryClient, messageId);
      const snapshot = snapshotForRollback(queryClient, messageId, userId);
      const applyLabels = (labels: string[]): string[] => [
        ...labels.filter((l) => !remove.includes(l)),
        ...add.filter((l) => !labels.includes(l)),
      ];
      queryClient.setQueryData<Message | null>(emailKeys.message.detail(messageId, userId), (old) =>
        old ? { ...old, labels: applyLabels(old.labels) } : old,
      );
      patchMessageInList(queryClient, messageId, (m) => ({ ...m, labels: applyLabels(m.labels) }));
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshot(queryClient, context.snapshot);
      toast.error('Failed to update labels.');
    },
    onSettled: (_data, _err, { messageId }) => {
      // Only invalidate single message cache — list is already updated optimistically
      queryClient.invalidateQueries({ queryKey: emailKeys.message.byId(messageId) });
    },
  });
}

export function useTogglePin() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useMutation({
    mutationFn: async ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.updateFlags(messageId, { pinned });
    },
    onMutate: async ({ messageId, pinned }) => {
      await cancelMessageQueries(queryClient, messageId);
      const snapshot = snapshotForRollback(queryClient, messageId, userId);
      patchMessageFlags(queryClient, messageId, userId, { pinned });
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshot(queryClient, context.snapshot);
      toast.error('Failed to update pin.');
    },
    onSettled: () => {
      // Only invalidate mailboxes — pin flag is already synced optimistically
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useSnoozeMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useMutation({
    mutationFn: async ({ messageId, until }: { messageId: string; until: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.snoozeMessage(messageId, until);
    },
    onMutate: async ({ messageId }) => {
      await cancelMessageQueries(queryClient, messageId);
      const snapshot = snapshotForRollback(queryClient, messageId, userId);
      removeMessageFromList(queryClient, messageId);
      return { snapshot };
    },
    onSuccess: () => {
      toast.success('Message snoozed.');
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshot(queryClient, context.snapshot);
      toast.error('Failed to snooze message.');
    },
    onSettled: () => {
      // Mark stale but don't trigger immediate refetch — optimistic update is already applied
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useUnsnoozeMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.unsnoozeMessage(messageId);
    },
    onMutate: async ({ messageId }) => {
      // Same optimistic pattern as useSnoozeMessage: unsnoozing removes the row
      // from the current (Snoozed) view. Rollback via snapshot on error.
      await cancelMessageQueries(queryClient, messageId);
      const snapshot = snapshotForRollback(queryClient, messageId, userId);
      removeMessageFromList(queryClient, messageId);
      return { snapshot };
    },
    onSuccess: () => {
      toast.success('Snooze removed.');
    },
    onError: (_err, _vars, context) => {
      if (context) restoreSnapshot(queryClient, context.snapshot);
      toast.error('Failed to unsnooze message.');
    },
    onSettled: () => {
      // Mark stale but don't trigger immediate refetch — optimistic update is already applied
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

// ─── Bulk Operations ─────────────────────────────────────────────

export function useBulkUpdateFlags() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageIds, flags }: { messageIds: string[]; flags: Partial<Message['flags']> }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.bulkUpdateFlags(messageIds, flags);
    },
    onMutate: async ({ messageIds, flags }) => {
      await queryClient.cancelQueries({ queryKey: emailKeys.messages.root });

      const prevMessages = queryClient.getQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root });
      const prevMailboxes = queryClient.getQueriesData({ queryKey: emailKeys.mailboxes.root });

      if (flags.seen !== undefined) {
        const ids = new Set(messageIds);
        const unseenDeltas = new Map<string, number>();
        for (const [, data] of prevMessages) {
          for (const message of flatMessages(data)) {
            if (ids.has(message._id) && message.flags.seen !== flags.seen && message.mailboxId) {
              const delta = flags.seen ? -1 : 1;
              unseenDeltas.set(message.mailboxId, (unseenDeltas.get(message.mailboxId) ?? 0) + delta);
            }
          }
        }
        for (const [mailboxId, delta] of unseenDeltas) {
          patchMailboxUnseen(queryClient, mailboxId, delta);
        }
      }

      // Optimistically update all affected messages in a single pass
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }, (old) => {
        if (!old) return old;
        const ids = new Set(messageIds);
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.map((m) =>
              ids.has(m._id) ? { ...m, flags: { ...m.flags, ...flags } } : m,
            ),
          })),
        };
      });

      return { prevMessages, prevMailboxes };
    },
    onError: (_err, _vars, context) => {
      if (context) {
        context.prevMessages.forEach(([key, data]) => queryClient.setQueryData(key, data));
        context.prevMailboxes.forEach(([key, data]) => queryClient.setQueryData(key, data));
      }
      toast.error('Failed to update messages.');
    },
    onSuccess: () => {
      toast.success('Messages updated.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useBulkMoveMessages() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageIds, mailboxId }: { messageIds: string[]; mailboxId: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.bulkMoveMessages(messageIds, mailboxId);
    },
    onMutate: async ({ messageIds }) => {
      await queryClient.cancelQueries({ queryKey: emailKeys.messages.root });

      const prevMessages = queryClient.getQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root });

      // Optimistically remove all moved messages from current view
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }, (old) => {
        if (!old) return old;
        const ids = new Set(messageIds);
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.filter((m) => !ids.has(m._id)),
          })),
        };
      });

      return { prevMessages };
    },
    onError: (_err, _vars, context) => {
      if (context) {
        context.prevMessages.forEach(([key, data]) => queryClient.setQueryData(key, data));
      }
      toast.error('Failed to move messages.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root, refetchType: 'none' });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

export function useSaveDraft() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: Parameters<NonNullable<typeof api>['saveDraft']>[0]) => {
      if (!api) throw new Error('Email API not initialized');
      return api.saveDraft(params);
    },
    onSuccess: () => {
      toast('Draft saved.');
    },
    onSettled: () => {
      // Refetch the Drafts list (the saved draft appears) and mailbox badges
      // (the Drafts unseen count) so the sidebar reflects the new draft.
      queryClient.invalidateQueries({ queryKey: emailKeys.messages.root });
      queryClient.invalidateQueries({ queryKey: emailKeys.mailboxes.root });
    },
  });
}

// ─── Internal helpers ────────────────────────────────────────────

/**
 * When the currently-selected message is about to be removed from the list
 * (archive/delete), advance the selection to the neighbouring message so the
 * desktop split-view doesn't land on an empty pane.
 */
function advanceSelectionPastMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  messageId: string,
): void {
  const { selectedMessageId } = useEmailStore.getState();
  if (selectedMessageId !== messageId) return;

  // The messages cache is keyed by [mailboxId, starred, label, userId], so
  // match by the mailbox prefix and take the first populated variant.
  const data = queryClient
    .getQueriesData<MessagesInfinite>({
      queryKey: emailKeys.messages.mailboxScope(useEmailStore.getState().currentMailbox?._id),
    })
    .find(([, cached]) => !!cached)?.[1];
  const messages = flatMessages(data);
  const idx = messages.findIndex((m) => m._id === messageId);
  const nextId = idx < messages.length - 1 ? messages[idx + 1]._id : idx > 0 ? messages[idx - 1]._id : null;
  useEmailStore.setState({ selectedMessageId: nextId });
}

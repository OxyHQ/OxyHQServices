import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import type { Message, Pagination } from '@/services/emailApi';

interface MessagesPage {
  data: Message[];
  pagination: Pagination;
}

type MessagesInfinite = InfiniteData<MessagesPage>;

/** Helper to update a message in all cached message pages */
function updateMessageInPages(
  old: MessagesInfinite | undefined,
  messageId: string,
  updater: (msg: Message) => Message,
): MessagesInfinite | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      data: page.data.map((m) => (m._id === messageId ? updater(m) : m)),
    })),
  };
}

/** Helper to remove a message from all cached pages */
function removeMessageFromPages(
  old: MessagesInfinite | undefined,
  messageId: string,
): MessagesInfinite | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      data: page.data.filter((m) => m._id !== messageId),
    })),
  };
}

/** Get flat list of all messages from infinite query data */
function flatMessages(data: MessagesInfinite | undefined): Message[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.data);
}

export function useToggleStar() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, starred }: { messageId: string; starred: boolean }) => {
      if (!api) throw new Error('Email API not initialized');
      await api.updateFlags(messageId, { starred });
    },
    onMutate: async ({ messageId, starred }) => {
      await queryClient.cancelQueries({ queryKey: ['messages'] });
      await queryClient.cancelQueries({ queryKey: ['message', messageId] });
      await queryClient.cancelQueries({ queryKey: ['thread', messageId] });
      const prev = queryClient.getQueriesData<MessagesInfinite>({ queryKey: ['messages'] });
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        updateMessageInPages(old, messageId, (m) => ({ ...m, flags: { ...m.flags, starred } })),
      );
      // Also update single message cache
      queryClient.setQueryData<Message | null>(['message', messageId], (old) =>
        old ? { ...old, flags: { ...old.flags, starred } } : old,
      );
      // Update thread cache
      queryClient.setQueriesData<Message[]>({ queryKey: ['thread'] }, (old) =>
        old?.map((m) => (m._id === messageId ? { ...m, flags: { ...m.flags, starred } } : m)),
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error('Failed to update star.');
    },
    onSettled: (_data, _err, { messageId }) => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['message', messageId] });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

export function useToggleRead() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, seen }: { messageId: string; seen: boolean }) => {
      if (!api) throw new Error('Email API not initialized');
      await api.updateFlags(messageId, { seen });
    },
    onMutate: async ({ messageId, seen }) => {
      await queryClient.cancelQueries({ queryKey: ['messages'] });
      await queryClient.cancelQueries({ queryKey: ['message', messageId] });
      await queryClient.cancelQueries({ queryKey: ['thread', messageId] });
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        updateMessageInPages(old, messageId, (m) => ({ ...m, flags: { ...m.flags, seen } })),
      );
      queryClient.setQueryData<Message | null>(['message', messageId], (old) =>
        old ? { ...old, flags: { ...old.flags, seen } } : old,
      );
      queryClient.setQueriesData<Message[]>({ queryKey: ['thread'] }, (old) =>
        old?.map((m) => (m._id === messageId ? { ...m, flags: { ...m.flags, seen } } : m)),
      );
    },
    onError: () => {
      toast.error('Failed to update read status.');
    },
    onSettled: (_data, _err, { messageId }) => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['message', messageId] });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
    },
  });
}

export function useArchiveMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, archiveMailboxId }: { messageId: string; archiveMailboxId: string }) => {
      if (!api) throw new Error('Email API not initialized');
      await api.moveMessage(messageId, archiveMailboxId);
    },
    onMutate: async ({ messageId }) => {
      await queryClient.cancelQueries({ queryKey: ['messages'] });

      // Auto-advance selected message
      const { selectedMessageId } = useEmailStore.getState();
      if (selectedMessageId === messageId) {
        const data = queryClient.getQueryData<MessagesInfinite>(['messages', useEmailStore.getState().currentMailbox?._id]);
        const messages = flatMessages(data);
        const idx = messages.findIndex((m) => m._id === messageId);
        const nextId = idx < messages.length - 1 ? messages[idx + 1]._id : idx > 0 ? messages[idx - 1]._id : null;
        useEmailStore.setState({ selectedMessageId: nextId });
      }

      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        removeMessageFromPages(old, messageId),
      );
    },
    onSuccess: () => {
      toast.success('Conversation archived.');
    },
    onError: () => {
      toast.error('Failed to archive conversation.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });
}

export function useDeleteMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
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
      await queryClient.cancelQueries({ queryKey: ['messages'] });

      // Auto-advance selected message
      const { selectedMessageId } = useEmailStore.getState();
      if (selectedMessageId === messageId) {
        const data = queryClient.getQueryData<MessagesInfinite>(['messages', useEmailStore.getState().currentMailbox?._id]);
        const messages = flatMessages(data);
        const idx = messages.findIndex((m) => m._id === messageId);
        const nextId = idx < messages.length - 1 ? messages[idx + 1]._id : idx > 0 ? messages[idx - 1]._id : null;
        useEmailStore.setState({ selectedMessageId: nextId });
      }

      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        removeMessageFromPages(old, messageId),
      );
    },
    onSuccess: (_data, { isInTrash }) => {
      toast.success(isInTrash ? 'Conversation permanently deleted.' : 'Conversation moved to Trash.');
    },
    onError: () => {
      toast.error('Failed to delete conversation.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
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
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });
}

const UNDO_SEND_DELAY_MS = 5000;

interface UndoSendState {
  pending: boolean;
  cancelled: boolean;
}

export function useSendMessageWithUndo() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();
  const stateRef = { current: { pending: false, cancelled: false } as UndoSendState };
  const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

  const sendWithUndo = async (
    params: Parameters<NonNullable<typeof api>['sendMessage']>[0],
    options?: { onSuccess?: () => void; onError?: (err: any) => void },
  ) => {
    if (!api) {
      options?.onError?.(new Error('Email API not initialized'));
      return;
    }

    // Reset state
    stateRef.current = { pending: true, cancelled: false };

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Show toast with undo action
    toast('Sending message...', {
      duration: UNDO_SEND_DELAY_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          stateRef.current.cancelled = true;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }
          toast('Message cancelled.');
        },
      },
    } as Record<string, unknown>);

    // Set timeout to actually send
    timeoutRef.current = setTimeout(async () => {
      if (stateRef.current.cancelled) {
        return;
      }

      try {
        await api.sendMessage(params);
        toast.success('Message sent.');
        queryClient.invalidateQueries({ queryKey: ['messages'] });
        queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
        options?.onSuccess?.();
      } catch (err: any) {
        toast.error(err.message || 'Failed to send message.');
        options?.onError?.(err);
      } finally {
        stateRef.current.pending = false;
      }
    }, UNDO_SEND_DELAY_MS);
  };

  return {
    sendWithUndo,
    isPending: stateRef.current.pending,
  };
}

export function useUpdateMessageLabels() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, add, remove }: { messageId: string; add: string[]; remove: string[] }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.updateLabels(messageId, add, remove);
    },
    onMutate: async ({ messageId, add, remove }) => {
      await queryClient.cancelQueries({ queryKey: ['message', messageId] });
      queryClient.setQueryData<Message | null>(['message', messageId], (old) => {
        if (!old) return old;
        const labels = [...old.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !old.labels.includes(l))];
        return { ...old, labels };
      });
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        updateMessageInPages(old, messageId, (m) => {
          const labels = [...m.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !m.labels.includes(l))];
          return { ...m, labels };
        }),
      );
    },
    onError: () => {
      toast.error('Failed to update labels.');
    },
    onSettled: (_data, _err, { messageId }) => {
      queryClient.invalidateQueries({ queryKey: ['message', messageId] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
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
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

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
      if (api) await api.updateFlags(messageId, { starred });
    },
    onMutate: async ({ messageId, starred }) => {
      await queryClient.cancelQueries({ queryKey: ['messages'] });
      const prev = queryClient.getQueriesData<MessagesInfinite>({ queryKey: ['messages'] });
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        updateMessageInPages(old, messageId, (m) => ({ ...m, flags: { ...m.flags, starred } })),
      );
      // Also update single message cache
      queryClient.setQueryData<Message | null>(['message', messageId], (old) =>
        old ? { ...old, flags: { ...old.flags, starred } } : old,
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      context?.prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export function useToggleRead() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, seen }: { messageId: string; seen: boolean }) => {
      if (api) await api.updateFlags(messageId, { seen });
    },
    onMutate: async ({ messageId, seen }) => {
      await queryClient.cancelQueries({ queryKey: ['messages'] });
      queryClient.setQueriesData<MessagesInfinite>({ queryKey: ['messages'] }, (old) =>
        updateMessageInPages(old, messageId, (m) => ({ ...m, flags: { ...m.flags, seen } })),
      );
      queryClient.setQueryData<Message | null>(['message', messageId], (old) =>
        old ? { ...old, flags: { ...old.flags, seen } } : old,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });
}

export function useArchiveMessage() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, archiveMailboxId }: { messageId: string; archiveMailboxId: string }) => {
      if (api) await api.moveMessage(messageId, archiveMailboxId);
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
      if (!api) return;
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
      if (api) await api.sendMessage(params);
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

export function useSaveDraft() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: Parameters<NonNullable<typeof api>['saveDraft']>[0]) => {
      if (api) return api.saveDraft(params);
      return undefined;
    },
    onSuccess: () => {
      toast('Draft saved.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

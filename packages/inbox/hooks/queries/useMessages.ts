import { useInfiniteQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MESSAGES } from '@/constants/mockData';
import type { Message, Pagination } from '@/services/emailApi';

const PAGE_SIZE = 50;

interface MessagesPage {
  data: Message[];
  pagination: Pagination;
}

interface UseMessagesOptions {
  mailboxId?: string;
  starred?: boolean;
  label?: string;
}

export function useMessages(options: UseMessagesOptions = {}) {
  const { mailboxId, starred, label } = options;
  const api = useEmailStore((s) => s._api);

  const hasFilter = !!mailboxId || !!starred || !!label;

  return useInfiniteQuery<MessagesPage>({
    queryKey: ['messages', mailboxId ?? null, starred ?? false, label ?? null],
    queryFn: async ({ pageParam = 0 }) => {
      if (api) {
        return await api.listMessages({
          mailboxId,
          starred,
          label,
          limit: PAGE_SIZE,
          offset: pageParam as number,
        });
      }
      if (__DEV__) {
        const filtered = mailboxId
          ? MOCK_MESSAGES.filter((m) => m.mailboxId === mailboxId)
          : MOCK_MESSAGES;
        return {
          data: filtered,
          pagination: { offset: 0, limit: PAGE_SIZE, total: filtered.length, hasMore: false },
        };
      }
      throw new Error('Email API not initialized');
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
    enabled: hasFilter && (!!api || __DEV__),
  });
}

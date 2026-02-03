import { useInfiniteQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MESSAGES } from '@/constants/mockData';
import type { Message, Pagination } from '@/services/emailApi';

const PAGE_SIZE = 50;

interface MessagesPage {
  data: Message[];
  pagination: Pagination;
}

export function useMessages(mailboxId: string | undefined) {
  const api = useEmailStore((s) => s._api);

  return useInfiniteQuery<MessagesPage>({
    queryKey: ['messages', mailboxId],
    queryFn: async ({ pageParam = 0 }) => {
      if (api) return api.listMessages(mailboxId!, { limit: PAGE_SIZE, offset: pageParam as number });
      if (__DEV__) {
        const filtered = MOCK_MESSAGES.filter((m) => m.mailboxId === mailboxId);
        return {
          data: filtered,
          pagination: { offset: 0, limit: PAGE_SIZE, total: filtered.length, hasMore: false },
        };
      }
      return { data: [], pagination: { offset: 0, limit: PAGE_SIZE, total: 0, hasMore: false } };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.offset + lastPage.pagination.limit : undefined,
    enabled: !!mailboxId && (!!api || __DEV__),
  });
}

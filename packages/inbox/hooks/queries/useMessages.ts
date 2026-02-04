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

  console.log('[useMessages] Hook called:', {
    mailboxId,
    hasApi: !!api,
    isDev: __DEV__,
    enabled: !!mailboxId && (!!api || __DEV__),
  });

  return useInfiniteQuery<MessagesPage>({
    queryKey: ['messages', mailboxId],
    queryFn: async ({ pageParam = 0 }) => {
      console.log('[useMessages] queryFn called:', { mailboxId, pageParam, hasApi: !!api });
      if (api) {
        const result = await api.listMessages(mailboxId!, { limit: PAGE_SIZE, offset: pageParam as number });
        console.log('[useMessages] API result:', {
          messageCount: result.data.length,
          pagination: result.pagination,
        });
        return result;
      }
      if (__DEV__) {
        const filtered = MOCK_MESSAGES.filter((m) => m.mailboxId === mailboxId);
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
    enabled: !!mailboxId && (!!api || __DEV__),
  });
}

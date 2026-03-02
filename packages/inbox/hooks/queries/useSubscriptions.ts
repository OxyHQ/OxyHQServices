import { useInfiniteQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { Subscription, Pagination } from '@/services/emailApi';

const PAGE_SIZE = 30;

interface SubscriptionsPage {
  data: Subscription[];
  pagination: Pagination;
}

export function useSubscriptions() {
  const api = useEmailStore((s) => s._api);

  return useInfiniteQuery<SubscriptionsPage>({
    queryKey: ['subscriptions'],
    queryFn: async ({ pageParam = 0 }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.listSubscriptions({
        limit: PAGE_SIZE,
        offset: pageParam as number,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
    enabled: !!api,
    staleTime: 5 * 60 * 1000,
  });
}

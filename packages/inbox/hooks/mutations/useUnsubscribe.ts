import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import type { Subscription, Pagination } from '@/services/emailApi';

interface SubscriptionsPage {
  data: Subscription[];
  pagination: Pagination;
}

type SubscriptionsInfinite = InfiniteData<SubscriptionsPage>;

export function useUnsubscribe() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      senderAddress,
      method,
    }: {
      senderAddress: string;
      method?: 'list-unsubscribe' | 'block';
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.unsubscribe(senderAddress, method);
    },
    onMutate: async ({ senderAddress }) => {
      await queryClient.cancelQueries({ queryKey: ['subscriptions'] });

      const prev = queryClient.getQueryData<SubscriptionsInfinite>([
        'subscriptions',
      ]);

      // Optimistically remove the subscription row
      queryClient.setQueryData<SubscriptionsInfinite>(
        ['subscriptions'],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.filter((s) => s._id !== senderAddress),
            })),
          };
        },
      );

      return { prev };
    },
    onSuccess: (result) => {
      const label =
        result.method === 'one-click' || result.method === 'http'
          ? 'Unsubscribed'
          : result.method === 'mailto'
            ? 'Unsubscribe request sent'
            : 'Sender blocked';
      toast.success(label);
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        queryClient.setQueryData(['subscriptions'], context.prev);
      }
      toast.error('Failed to unsubscribe');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

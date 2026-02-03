import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MAILBOXES } from '@/constants/mockData';
import type { Mailbox } from '@/services/emailApi';

export function useMailboxes() {
  const api = useEmailStore((s) => s._api);

  return useQuery<Mailbox[]>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      if (api) return api.listMailboxes();
      if (__DEV__) return MOCK_MAILBOXES;
      return [];
    },
    enabled: !!api || __DEV__,
  });
}

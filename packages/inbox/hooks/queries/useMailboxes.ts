import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MAILBOXES } from '@/constants/mockData';
import type { Mailbox } from '@/services/emailApi';

export function useMailboxes() {
  const api = useEmailStore((s) => s._api);

  return useQuery<Mailbox[]>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      if (api) {
        return await api.listMailboxes();
      }
      if (__DEV__) {
        return MOCK_MAILBOXES;
      }
      throw new Error('Email API not initialized');
    },
    enabled: !!api || __DEV__,
  });
}

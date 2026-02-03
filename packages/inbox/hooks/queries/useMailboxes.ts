import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MAILBOXES } from '@/constants/mockData';
import type { Mailbox } from '@/services/emailApi';

export function useMailboxes() {
  const api = useEmailStore((s) => s._api);

  return useQuery<Mailbox[]>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      console.log('[useMailboxes] Query running, api exists:', !!api);
      if (api) {
        try {
          const result = await api.listMailboxes();
          console.log('[useMailboxes] Success! Got mailboxes:', result.length, result);
          return result;
        } catch (error) {
          console.error('[useMailboxes] API call failed:', error);
          throw error;
        }
      }
      if (__DEV__) {
        console.log('[useMailboxes] Using mock data');
        return MOCK_MAILBOXES;
      }
      throw new Error('Email API not initialized');
    },
    enabled: !!api || __DEV__,
  });
}

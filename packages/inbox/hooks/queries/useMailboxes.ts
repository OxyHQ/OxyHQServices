import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MAILBOXES } from '@/constants/mockData';
import type { Mailbox } from '@/services/emailApi';

export function useMailboxes() {
  const api = useEmailStore((s) => s._api);

  return useQuery<Mailbox[]>({
    queryKey: ['mailboxes'],
    queryFn: async () => {
      console.log('[useMailboxes] Running query, api:', !!api, '__DEV__:', __DEV__);
      if (api) {
        console.log('[useMailboxes] Calling real API...');
        const result = await api.listMailboxes();
        console.log('[useMailboxes] Got mailboxes:', result.length);
        return result;
      }
      if (__DEV__) {
        console.log('[useMailboxes] Using mock data');
        return MOCK_MAILBOXES;
      }
      console.error('[useMailboxes] No API and not dev mode - throwing');
      throw new Error('Email API not initialized');
    },
    enabled: !!api || __DEV__,
  });
}

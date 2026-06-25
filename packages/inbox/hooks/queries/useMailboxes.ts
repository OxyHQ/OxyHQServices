import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import type { Mailbox } from '@/services/emailApi';

export function useMailboxes() {
  const api = useEmailStore((s) => s._api);
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useQuery<Mailbox[]>({
    queryKey: ['mailboxes', userId],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.listMailboxes();
    },
    enabled: !!api && !!userId,
  });
}

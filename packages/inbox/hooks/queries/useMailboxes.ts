import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { Mailbox } from '@/services/emailApi';

export function useMailboxes() {
  const api = useEmailStore((s) => s._api);
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useQuery<Mailbox[]>({
    queryKey: emailKeys.mailboxes.list(userId),
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.listMailboxes();
    },
    enabled: !!api && !!userId,
  });
}

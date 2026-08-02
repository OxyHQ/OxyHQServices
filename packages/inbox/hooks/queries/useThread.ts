import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { Message } from '@/services/emailApi';

export function useThread(messageId: string | undefined) {
  const api = useEmailStore((s) => s._api);

  return useQuery<Message[]>({
    queryKey: emailKeys.thread.detail(messageId),
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.getThread(messageId!);
    },
    enabled: !!messageId && !!api,
  });
}

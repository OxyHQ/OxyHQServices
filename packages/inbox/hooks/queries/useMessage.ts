import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { Message } from '@/services/emailApi';

export function useMessage(messageId: string | undefined) {
  const api = useEmailStore((s) => s._api);

  return useQuery<Message | null>({
    queryKey: ['message', messageId],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.getMessage(messageId!);
    },
    enabled: !!messageId && !!api,
  });
}

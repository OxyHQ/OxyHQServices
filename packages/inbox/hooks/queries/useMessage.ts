import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { Message } from '@/services/emailApi';

export function useMessage(messageId: string | undefined) {
  const api = useEmailStore((s) => s._api);
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useQuery<Message | null>({
    queryKey: emailKeys.message.detail(messageId, userId),
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.getMessage(messageId!);
    },
    enabled: !!messageId && !!api && !!userId,
  });
}

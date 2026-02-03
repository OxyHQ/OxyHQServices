import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MESSAGES } from '@/constants/mockData';
import type { Message } from '@/services/emailApi';

export function useMessage(messageId: string | undefined) {
  const api = useEmailStore((s) => s._api);

  return useQuery<Message | null>({
    queryKey: ['message', messageId],
    queryFn: async () => {
      if (api) return api.getMessage(messageId!);
      if (__DEV__) return MOCK_MESSAGES.find((m) => m._id === messageId) ?? null;
      return null;
    },
    enabled: !!messageId && (!!api || __DEV__),
  });
}

import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MESSAGES } from '@/constants/mockData';
import type { Message } from '@/services/emailApi';

export function useSearchMessages(query: string) {
  const api = useEmailStore((s) => s._api);
  const trimmed = query.trim();

  return useQuery<Message[]>({
    queryKey: ['search', trimmed],
    queryFn: async () => {
      if (api) {
        const res = await api.search(trimmed);
        return res.data;
      }
      if (__DEV__) {
        const q = trimmed.toLowerCase();
        return MOCK_MESSAGES.filter(
          (m) =>
            m.subject.toLowerCase().includes(q) ||
            m.from.name?.toLowerCase().includes(q) ||
            m.from.address.toLowerCase().includes(q) ||
            m.text?.toLowerCase().includes(q),
        );
      }
      return [];
    },
    enabled: trimmed.length > 0 && (!!api || __DEV__),
  });
}

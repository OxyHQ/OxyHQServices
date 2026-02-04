import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { MOCK_MESSAGES } from '@/constants/mockData';
import type { Message, Pagination } from '@/services/emailApi';

interface SearchOptions {
  q?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  dateAfter?: string;
  dateBefore?: string;
  mailbox?: string;
}

interface SearchResult {
  data: Message[];
  pagination: Pagination;
}

export function useSearchMessages(options: SearchOptions) {
  const api = useEmailStore((s) => s._api);

  const hasFilter = !!(
    options.q?.trim() ||
    options.from?.trim() ||
    options.to?.trim() ||
    options.subject?.trim() ||
    options.hasAttachment ||
    options.dateAfter ||
    options.dateBefore
  );

  return useQuery<SearchResult>({
    queryKey: ['search', options],
    queryFn: async () => {
      if (api) {
        return await api.search(options);
      }
      if (__DEV__) {
        const q = (options.q || '').toLowerCase();
        const filtered = q
          ? MOCK_MESSAGES.filter(
              (m) =>
                m.subject.toLowerCase().includes(q) ||
                m.from.name?.toLowerCase().includes(q) ||
                m.from.address.toLowerCase().includes(q) ||
                m.text?.toLowerCase().includes(q),
            )
          : MOCK_MESSAGES;
        return {
          data: filtered,
          pagination: { total: filtered.length, limit: 50, offset: 0, hasMore: false },
        };
      }
      throw new Error('Email API not initialized');
    },
    enabled: hasFilter && (!!api || __DEV__),
  });
}

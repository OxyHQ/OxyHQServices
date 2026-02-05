import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
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
    options.dateBefore ||
    options.mailbox?.trim()
  );

  return useQuery<SearchResult>({
    queryKey: ['search', options],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.search(options);
    },
    enabled: hasFilter && !!api,
  });
}

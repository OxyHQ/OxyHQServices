import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { ContactSuggestion } from '@/services/emailApi';

export function useContactSuggestions(query: string) {
  const api = useEmailStore((s) => s._api);
  const trimmed = query.trim();

  return useQuery<ContactSuggestion[]>({
    queryKey: ['contactSuggestions', trimmed],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.suggestContacts(trimmed);
    },
    enabled: !!api && trimmed.length >= 2,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
}

import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { Contact, Pagination } from '@/services/emailApi';

export function useContacts(options?: { q?: string; starred?: boolean }) {
  const api = useEmailStore((s) => s._api);

  return useQuery<{ data: Contact[]; pagination: Pagination }>({
    queryKey: ['contacts', { q: options?.q, starred: options?.starred }],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.listContacts({ q: options?.q, starred: options?.starred });
    },
    enabled: !!api,
    staleTime: 30_000,
  });
}

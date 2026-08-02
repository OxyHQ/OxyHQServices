import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { Contact } from '@/services/emailApi';

const CONTACTS_LIMIT = 200;

/**
 * List the user's saved contacts, optionally filtered by a search query.
 * Non-paginated (first {@link CONTACTS_LIMIT}) — the settings CRUD screen
 * shows a flat, searchable list rather than an infinite feed.
 */
export function useContacts(query?: string) {
  const api = useEmailStore((s) => s._api);
  const q = query?.trim() || undefined;

  return useQuery<Contact[]>({
    queryKey: emailKeys.contacts.list(q),
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      const res = await api.listContacts({ q, limit: CONTACTS_LIMIT });
      return res.data;
    },
    enabled: !!api,
    placeholderData: (prev) => prev,
  });
}

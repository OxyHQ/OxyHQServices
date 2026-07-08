import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@oxyhq/bloom';
import { useEmailStore } from '@/hooks/useEmail';
import type { Contact } from '@/services/emailApi';

/**
 * Apply an optimistic updater across every cached `['contacts', …]` variant
 * (the list is keyed by search query) and return the snapshot for rollback.
 */
async function optimisticContacts(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (prev: Contact[]) => Contact[],
): Promise<{ prev: [readonly unknown[], Contact[] | undefined][] }> {
  await queryClient.cancelQueries({ queryKey: ['contacts'] });
  const prev = queryClient.getQueriesData<Contact[]>({ queryKey: ['contacts'] });
  queryClient.setQueriesData<Contact[]>({ queryKey: ['contacts'] }, (old) => updater(old ?? []));
  return { prev };
}

function restoreContacts(
  queryClient: ReturnType<typeof useQueryClient>,
  prev: [readonly unknown[], Contact[] | undefined][],
) {
  prev.forEach(([key, data]) => queryClient.setQueryData(key, data));
}

export function useCreateContact() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      email: string;
      company?: string;
      notes?: string;
      starred?: boolean;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.createContact(data);
    },
    onMutate: async (data) => {
      const now = new Date().toISOString();
      const optimistic: Contact = {
        _id: `optimistic:${Date.now()}`,
        userId: '',
        name: data.name,
        email: data.email,
        company: data.company,
        notes: data.notes,
        starred: data.starred ?? false,
        autoCollected: false,
        createdAt: now,
        updatedAt: now,
      };
      const { prev } = await optimisticContacts(queryClient, (contacts) => [optimistic, ...contacts]);
      return { prev };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.prev) restoreContacts(queryClient, context.prev);
      toast.error(err.message || 'Failed to create contact');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useUpdateContact() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      ...updates
    }: {
      contactId: string;
      name?: string;
      email?: string;
      company?: string;
      notes?: string;
      starred?: boolean;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.updateContact(contactId, updates);
    },
    onMutate: async ({ contactId, ...updates }) => {
      const { prev } = await optimisticContacts(queryClient, (contacts) =>
        contacts.map((c) => (c._id === contactId ? { ...c, ...updates } : c)),
      );
      return { prev };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.prev) restoreContacts(queryClient, context.prev);
      toast.error(err.message || 'Failed to update contact');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useDeleteContact() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contactId: string) => {
      if (!api) throw new Error('Email API not initialized');
      return api.deleteContact(contactId);
    },
    onMutate: async (contactId) => {
      const { prev } = await optimisticContacts(queryClient, (contacts) =>
        contacts.filter((c) => c._id !== contactId),
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) restoreContacts(queryClient, context.prev);
      toast.error('Failed to delete contact');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

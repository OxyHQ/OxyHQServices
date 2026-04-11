import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { toast } from '@oxyhq/services';

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to create contact');
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update contact');
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: () => {
      toast.error('Failed to delete contact');
    },
  });
}

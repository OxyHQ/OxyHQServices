import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { Label } from '@/services/emailApi';

export function useLabels() {
  const api = useEmailStore((s) => s._api);

  return useQuery<Label[]>({
    queryKey: ['labels'],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.listLabels();
    },
    enabled: !!api,
  });
}

export function useCreateLabel() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.createLabel(name, color);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
  });
}

export function useUpdateLabel() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ labelId, updates }: { labelId: string; updates: { name?: string; color?: string } }) => {
      if (!api) throw new Error('Email API not initialized');
      return await api.updateLabel(labelId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
  });
}

export function useDeleteLabel() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (labelId: string) => {
      if (!api) throw new Error('Email API not initialized');
      await api.deleteLabel(labelId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labels'] });
    },
  });
}

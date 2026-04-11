import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { toast } from '@oxyhq/services';

export function useCreateTemplate() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; subject?: string; body: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.createTemplate(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      toast.error('Failed to create template');
    },
  });
}

export function useUpdateTemplate() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      templateId,
      ...updates
    }: {
      templateId: string;
      name?: string;
      subject?: string;
      body?: string;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.updateTemplate(templateId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      toast.error('Failed to update template');
    },
  });
}

export function useDeleteTemplate() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!api) throw new Error('Email API not initialized');
      return api.deleteTemplate(templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      toast.error('Failed to delete template');
    },
  });
}

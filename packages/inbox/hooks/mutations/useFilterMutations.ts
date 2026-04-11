import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { toast } from '@oxyhq/services';
import type { EmailFilterCondition, EmailFilterAction } from '@/services/emailApi';

export function useCreateFilter() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      enabled?: boolean;
      conditions: EmailFilterCondition[];
      matchAll?: boolean;
      actions: EmailFilterAction[];
      order?: number;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.createFilter(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
    },
    onError: () => {
      toast.error('Failed to create filter');
    },
  });
}

export function useUpdateFilter() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      filterId,
      ...updates
    }: {
      filterId: string;
      name?: string;
      enabled?: boolean;
      conditions?: EmailFilterCondition[];
      matchAll?: boolean;
      actions?: EmailFilterAction[];
      order?: number;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.updateFilter(filterId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
    },
    onError: () => {
      toast.error('Failed to update filter');
    },
  });
}

export function useDeleteFilter() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filterId: string) => {
      if (!api) throw new Error('Email API not initialized');
      return api.deleteFilter(filterId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filters'] });
    },
    onError: () => {
      toast.error('Failed to delete filter');
    },
  });
}

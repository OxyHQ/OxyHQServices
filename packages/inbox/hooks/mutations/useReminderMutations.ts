import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { toast } from '@oxyhq/services';

export function useCreateReminder() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { text: string; remindAt: string; relatedMessageId?: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.createReminder(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: () => {
      toast.error('Failed to create reminder');
    },
  });
}

export function useUpdateReminder() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      reminderId,
      ...updates
    }: {
      reminderId: string;
      text?: string;
      remindAt?: string;
      completed?: boolean;
      pinned?: boolean;
      snoozedUntil?: string | null;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.updateReminder(reminderId, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: () => {
      toast.error('Failed to update reminder');
    },
  });
}

export function useDeleteReminder() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reminderId: string) => {
      if (!api) throw new Error('Email API not initialized');
      return api.deleteReminder(reminderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
    onError: () => {
      toast.error('Failed to delete reminder');
    },
  });
}

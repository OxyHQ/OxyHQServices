import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { Reminder, Pagination } from '@/services/emailApi';

export function useReminders(options?: { includeCompleted?: boolean }) {
  const api = useEmailStore((s) => s._api);

  return useQuery<{ data: Reminder[]; pagination: Pagination }>({
    queryKey: ['reminders', { includeCompleted: options?.includeCompleted }],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.listReminders({ includeCompleted: options?.includeCompleted });
    },
    enabled: !!api,
    staleTime: 30_000,
  });
}

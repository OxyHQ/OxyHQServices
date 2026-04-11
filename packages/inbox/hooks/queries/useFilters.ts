import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { EmailFilter } from '@/services/emailApi';

export function useFilters() {
  const api = useEmailStore((s) => s._api);

  return useQuery<EmailFilter[]>({
    queryKey: ['filters'],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.listFilters();
    },
    enabled: !!api,
  });
}

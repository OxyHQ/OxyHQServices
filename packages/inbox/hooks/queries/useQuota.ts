import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { QuotaUsage } from '@/services/emailApi';

export function useQuota() {
  const api = useEmailStore((s) => s._api);

  return useQuery<QuotaUsage>({
    queryKey: ['quota'],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.getQuota();
    },
    enabled: !!api,
    staleTime: 60_000,
  });
}

import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { useEmailStore } from '@/hooks/useEmail';
import type { QuotaUsage } from '@/services/emailApi';

export function useQuota() {
  const api = useEmailStore((s) => s._api);
  const { user } = useOxy();
  const userId = user?.id ?? null;

  return useQuery<QuotaUsage>({
    queryKey: ['quota', userId],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.getQuota();
    },
    enabled: !!api && !!userId,
    staleTime: 60_000,
  });
}

import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { QuotaUsage } from '@/services/emailApi';

const MOCK_QUOTA: QuotaUsage = {
  used: 524288000,
  limit: 1073741824,
  percentage: 49,
  dailySendCount: 12,
  dailySendLimit: 500,
};

export function useQuota() {
  const api = useEmailStore((s) => s._api);

  return useQuery<QuotaUsage>({
    queryKey: ['quota'],
    queryFn: async () => {
      if (api) return api.getQuota();
      if (__DEV__) return MOCK_QUOTA;
      return MOCK_QUOTA;
    },
    enabled: !!api || __DEV__,
    staleTime: 60_000,
  });
}

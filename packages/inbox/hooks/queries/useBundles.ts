import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { Bundle } from '@/services/emailApi';

export function useBundles() {
  const api = useEmailStore((s) => s._api);

  return useQuery<Bundle[]>({
    queryKey: ['bundles'],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.listBundles();
    },
    enabled: !!api,
    staleTime: 5 * 60 * 1000,
  });
}

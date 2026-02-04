import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { EmailSettings } from '@/services/emailApi';

export function useSettings() {
  const api = useEmailStore((s) => s._api);

  return useQuery<EmailSettings>({
    queryKey: ['settings'],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return api.getSettings();
    },
    enabled: !!api,
  });
}

export function useUpdateSettings() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<EmailSettings>) => {
      if (!api) throw new Error('Email API not initialized');
      await api.updateSettings(settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

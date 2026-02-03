import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import type { EmailSettings } from '@/services/emailApi';

const MOCK_SETTINGS: EmailSettings = {
  signature: 'Sent from Inbox by Oxy',
  autoReply: { enabled: false, subject: '', body: '', startDate: null, endDate: null },
};

export function useSettings() {
  const api = useEmailStore((s) => s._api);

  return useQuery<EmailSettings>({
    queryKey: ['settings'],
    queryFn: async () => {
      if (api) return api.getSettings();
      if (__DEV__) return MOCK_SETTINGS;
      throw new Error('Email API not initialized');
    },
    enabled: !!api || __DEV__,
  });
}

export function useUpdateSettings() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<EmailSettings>) => {
      if (api) await api.updateSettings(settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

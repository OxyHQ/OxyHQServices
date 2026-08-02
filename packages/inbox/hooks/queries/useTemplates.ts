import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { EmailTemplate } from '@/services/emailApi';

export function useTemplates() {
  const api = useEmailStore((s) => s._api);

  return useQuery<EmailTemplate[]>({
    queryKey: emailKeys.templates,
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.listTemplates();
    },
    enabled: !!api,
  });
}

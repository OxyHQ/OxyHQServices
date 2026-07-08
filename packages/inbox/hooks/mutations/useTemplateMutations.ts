import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@oxyhq/bloom';
import { useEmailStore } from '@/hooks/useEmail';
import type { EmailTemplate } from '@/services/emailApi';

const TEMPLATES_KEY = ['templates'] as const;

async function optimisticTemplates(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (prev: EmailTemplate[]) => EmailTemplate[],
): Promise<{ prev: EmailTemplate[] | undefined }> {
  await queryClient.cancelQueries({ queryKey: TEMPLATES_KEY });
  const prev = queryClient.getQueryData<EmailTemplate[]>(TEMPLATES_KEY);
  queryClient.setQueryData<EmailTemplate[]>(TEMPLATES_KEY, (old) => updater(old ?? []));
  return { prev };
}

export function useCreateTemplate() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; subject?: string; body: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.createTemplate(data);
    },
    onMutate: async (data) => {
      const now = new Date().toISOString();
      const optimistic: EmailTemplate = {
        _id: `optimistic:${Date.now()}`,
        userId: '',
        name: data.name,
        subject: data.subject ?? '',
        body: data.body,
        order: Number.MAX_SAFE_INTEGER,
        createdAt: now,
        updatedAt: now,
      };
      const { prev } = await optimisticTemplates(queryClient, (templates) => [...templates, optimistic]);
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(TEMPLATES_KEY, context.prev);
      toast.error('Failed to create template');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useUpdateTemplate() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      templateId,
      ...updates
    }: {
      templateId: string;
      name?: string;
      subject?: string;
      body?: string;
    }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.updateTemplate(templateId, updates);
    },
    onMutate: async ({ templateId, ...updates }) => {
      const { prev } = await optimisticTemplates(queryClient, (templates) =>
        templates.map((t) => (t._id === templateId ? { ...t, ...updates } : t)),
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(TEMPLATES_KEY, context.prev);
      toast.error('Failed to update template');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

export function useDeleteTemplate() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!api) throw new Error('Email API not initialized');
      return api.deleteTemplate(templateId);
    },
    onMutate: async (templateId) => {
      const { prev } = await optimisticTemplates(queryClient, (templates) =>
        templates.filter((t) => t._id !== templateId),
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(TEMPLATES_KEY, context.prev);
      toast.error('Failed to delete template');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
    },
  });
}

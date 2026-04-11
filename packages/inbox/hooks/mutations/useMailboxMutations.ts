import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';
import { toast } from '@oxyhq/services';

export function useCreateMailbox() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, parentPath }: { name: string; parentPath?: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.createMailbox(name, parentPath);
    },
    onSuccess: () => {
      toast.success('Folder created.');
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
    onError: () => {
      toast.error('Failed to create folder.');
    },
  });
}

export function useDeleteMailbox() {
  const api = useEmailStore((s) => s._api);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mailboxId }: { mailboxId: string }) => {
      if (!api) throw new Error('Email API not initialized');
      return api.deleteMailbox(mailboxId);
    },
    onSuccess: () => {
      toast.success('Folder deleted.');
      queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
    },
    onError: () => {
      toast.error('Failed to delete folder.');
    },
  });
}

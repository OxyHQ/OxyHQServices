import { useQuery } from '@tanstack/react-query';
import { useEmailStore } from '@/hooks/useEmail';

/**
 * Fetches and caches a presigned S3 URL for an attachment.
 * Presigned URLs expire in 60 min; staleTime is 45 min to refresh before expiry.
 */
export function useAttachmentUrl(s3Key: string, enabled = true) {
  const api = useEmailStore((s) => s._api);

  const { data: url = null, isLoading } = useQuery({
    queryKey: ['attachment-url', s3Key],
    queryFn: async () => {
      if (!api) throw new Error('Email API not initialized');
      return await api.getAttachmentUrl(s3Key);
    },
    enabled: enabled && !!api && !!s3Key,
    staleTime: 45 * 60 * 1000,
  });

  return { url, isLoading };
}

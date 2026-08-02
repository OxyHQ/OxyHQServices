import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { emailKeys } from '@/hooks/queries/queryKeys';

/**
 * Resolves a download/preview URL for an attachment, which is a file in the
 * Oxy File Manager. Uses the core SDK's `getFileDownloadUrlAsync` (signed CDN
 * URL with a fallback to the authenticated `/assets/:id/stream` endpoint).
 * Signed URLs expire in 60 min; staleTime is 45 min to refresh before expiry.
 */
export function useAttachmentUrl(fileId: string, enabled = true, variant?: string) {
  const { oxyServices } = useOxy();

  const { data: url = null, isLoading } = useQuery({
    queryKey: emailKeys.attachmentUrl(fileId, variant),
    queryFn: () => oxyServices.getFileDownloadUrlAsync(fileId, variant),
    enabled: enabled && !!fileId,
    staleTime: 45 * 60 * 1000,
  });

  return { url, isLoading };
}

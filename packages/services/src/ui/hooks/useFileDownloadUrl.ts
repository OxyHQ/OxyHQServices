import { useEffect, useState } from 'react';
import type { OxyServices } from '@oxyhq/core';

export interface UseFileDownloadUrlOptions {
  variant?: string;
  expiresIn?: number;
}

export interface UseFileDownloadUrlResult {
  url: string | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to resolve a file's download URL asynchronously.
 *
 * Uses `getFileDownloadUrlAsync` first, falling back to the synchronous
 * `getFileDownloadUrl` if the async call fails.
 */
export const useFileDownloadUrl = (
  oxyServices: OxyServices | null | undefined,
  fileId: string | null | undefined,
  options?: UseFileDownloadUrlOptions,
): UseFileDownloadUrlResult => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const variant = options?.variant;
  const expiresIn = options?.expiresIn;

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!oxyServices) {
      setUrl(null);
      setLoading(false);
      setError(new Error('OxyServices instance not configured for useFileDownloadUrl'));
      return;
    }

    let cancelled = false;
    const instance = oxyServices;
    const targetFileId = fileId;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        let resolvedUrl: string | null = null;

        if (typeof instance.getFileDownloadUrlAsync === 'function') {
          resolvedUrl = await instance.getFileDownloadUrlAsync(targetFileId, variant, expiresIn);
        }

        if (!resolvedUrl && typeof instance.getFileDownloadUrl === 'function') {
          resolvedUrl = instance.getFileDownloadUrl(targetFileId, variant, expiresIn);
        }

        if (!cancelled) {
          setUrl(resolvedUrl || null);
        }
      } catch (err: unknown) {
        // Fallback to sync URL on error where possible
        try {
          if (typeof instance.getFileDownloadUrl === 'function') {
            const fallbackUrl = instance.getFileDownloadUrl(targetFileId, variant, expiresIn);
            if (!cancelled) {
              setUrl(fallbackUrl || null);
              setError(err instanceof Error ? err : new Error(String(err)));
            }
            return;
          }
        } catch {
          // Secondary failure: surface the original error below.
        }

        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [fileId, oxyServices, variant, expiresIn]);

  return { url, loading, error };
};

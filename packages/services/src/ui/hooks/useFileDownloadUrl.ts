import { useEffect, useState } from 'react';
import { OxyServices } from '../../core/OxyServices';

let oxyInstance: OxyServices | null = null;

export const setOxyFileUrlInstance = (instance: OxyServices) => {
  oxyInstance = instance;
};

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
 * Prefers `getFileDownloadUrlAsync` and falls back to the synchronous
 * `getFileDownloadUrl` helper if the async call fails.
 */
export const useFileDownloadUrl = (
  fileId?: string | null,
  options?: UseFileDownloadUrlOptions
): UseFileDownloadUrlResult => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!oxyInstance) {
      // Fail silently but don't crash the UI – caller can decide what to do with null URL.
      setUrl(null);
      setLoading(false);
      setError(new Error('OxyServices instance not configured for useFileDownloadUrl'));
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      // Store instance in local variable for TypeScript null checking
      const instance = oxyInstance;
      if (!instance) {
        setLoading(false);
        setError(new Error('OxyServices instance not configured for useFileDownloadUrl'));
        return;
      }

      try {
        const { variant, expiresIn } = options || {};
        let resolvedUrl: string | null = null;

        if (typeof instance.getFileDownloadUrlAsync === 'function') {
          resolvedUrl = await instance.getFileDownloadUrlAsync(fileId, variant, expiresIn);
        }

        if (!resolvedUrl && typeof instance.getFileDownloadUrl === 'function') {
          resolvedUrl = instance.getFileDownloadUrl(fileId, variant, expiresIn);
        }

        if (!cancelled) {
          setUrl(resolvedUrl || null);
        }
      } catch (err: any) {
        // Fallback to sync URL on error where possible
        try {
          if (typeof instance.getFileDownloadUrl === 'function') {
            const { variant, expiresIn } = options || {};
            const fallbackUrl = instance.getFileDownloadUrl(fileId, variant, expiresIn);
            if (!cancelled) {
              setUrl(fallbackUrl || null);
              setError(err instanceof Error ? err : new Error(String(err)));
            }
            return;
          }
        } catch {
          // ignore secondary failure, we'll surface the original error below
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
  }, [fileId, options?.variant, options?.expiresIn]);

  return { url, loading, error };
};





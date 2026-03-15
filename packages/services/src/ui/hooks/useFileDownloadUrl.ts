import { useEffect, useState } from 'react';
import { OxyServices } from '@oxyhq/core';

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
 * Prefers the provided `oxyServices` instance, falls back to the module-level
 * singleton set via `setOxyFileUrlInstance`.
 *
 * Uses `getFileDownloadUrlAsync` first, falling back to the synchronous
 * `getFileDownloadUrl` if the async call fails.
 */
export const useFileDownloadUrl = (
  fileIdOrServices?: string | OxyServices | null,
  fileIdOrOptions?: string | UseFileDownloadUrlOptions | null,
  maybeOptions?: UseFileDownloadUrlOptions
): UseFileDownloadUrlResult => {
  // Support two call signatures:
  // 1. useFileDownloadUrl(oxyServices, fileId, options)  — preferred
  // 2. useFileDownloadUrl(fileId, options)               — legacy (uses singleton)
  let services: OxyServices | null;
  let fileId: string | null | undefined;
  let options: UseFileDownloadUrlOptions | undefined;

  if (fileIdOrServices instanceof OxyServices) {
    services = fileIdOrServices;
    fileId = typeof fileIdOrOptions === 'string' ? fileIdOrOptions : null;
    options = maybeOptions;
  } else {
    services = oxyInstance;
    fileId = typeof fileIdOrServices === 'string' ? fileIdOrServices : null;
    options = typeof fileIdOrOptions === 'object' && fileIdOrOptions !== null ? fileIdOrOptions as UseFileDownloadUrlOptions : undefined;
  }

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

    if (!services) {
      setUrl(null);
      setLoading(false);
      setError(new Error('OxyServices instance not configured for useFileDownloadUrl'));
      return;
    }

    let cancelled = false;
    const instance = services;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const { variant, expiresIn } = options || {};
        let resolvedUrl: string | null = null;

        if (typeof instance.getFileDownloadUrlAsync === 'function') {
          resolvedUrl = await instance.getFileDownloadUrlAsync(fileId!, variant, expiresIn);
        }

        if (!resolvedUrl && typeof instance.getFileDownloadUrl === 'function') {
          resolvedUrl = instance.getFileDownloadUrl(fileId!, variant, expiresIn);
        }

        if (!cancelled) {
          setUrl(resolvedUrl || null);
        }
      } catch (err: unknown) {
        // Fallback to sync URL on error where possible
        try {
          if (typeof instance.getFileDownloadUrl === 'function') {
            const { variant, expiresIn } = options || {};
            const fallbackUrl = instance.getFileDownloadUrl(fileId!, variant, expiresIn);
            if (!cancelled) {
              setUrl(fallbackUrl || null);
              setError(err instanceof Error ? err : new Error(String(err)));
            }
            return;
          }
        } catch {
          // ignore secondary failure
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
  }, [fileId, services, options?.variant, options?.expiresIn]);

  return { url, loading, error };
};

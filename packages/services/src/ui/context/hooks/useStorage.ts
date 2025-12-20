import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '../../../models/interfaces';
import { createPlatformStorage, type StorageInterface } from '../../utils/storageHelpers';
import { extractErrorMessage } from '../../utils/errorHandlers';

export interface UseStorageOptions {
  onError?: (error: ApiError) => void;
  logger?: (message: string, error?: unknown) => void;
  errorCode?: string;
}

export interface UseStorageResult {
  storage: StorageInterface | null;
  isReady: boolean;
  error: string | null;
  refresh: () => Promise<StorageInterface | null>;
  withStorage: <T>(callback: (storage: StorageInterface) => Promise<T>) => Promise<T | null>;
}

const DEFAULT_ERROR_CODE = 'STORAGE_INIT_ERROR';

/**
 * React hook that exposes a platform-agnostic storage reference.
 * Handles initialization, error propagation, and lazy re-initialization.
 *
 * @param options - Optional configuration for error reporting and logging
 */
export const useStorage = ({
  onError,
  logger,
  errorCode = DEFAULT_ERROR_CODE,
}: UseStorageOptions = {}): UseStorageResult => {
  const [storage, setStorage] = useState<StorageInterface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initializingRef = useRef<Promise<StorageInterface | null> | null>(null);

  const notifyError = useCallback(
    (err: unknown) => {
      const message = extractErrorMessage(err, 'Failed to initialize storage');
      setError(message);

      if (logger) {
        logger(message, err);
      }

      onError?.({
        message,
        code: errorCode,
        status: 500,
      });
    },
    [errorCode, logger, onError],
  );

  const createStorageInstance = useCallback(async (): Promise<StorageInterface | null> => {
    try {
      const platformStorage = await createPlatformStorage();
      setStorage(platformStorage);
      setError(null);
      return platformStorage;
    } catch (err) {
      notifyError(err);
      setStorage(null);
      return null;
    }
  }, [notifyError]);

  const refresh = useCallback(async (): Promise<StorageInterface | null> => {
    if (!initializingRef.current) {
      initializingRef.current = createStorageInstance().finally(() => {
        initializingRef.current = null;
      });
    }

    return initializingRef.current;
  }, [createStorageInstance]);

  useEffect(() => {
    refresh().catch((err) => {
      notifyError(err);
    });
  }, [refresh, notifyError]);

  const withStorage = useCallback(
    async <T,>(callback: (resolvedStorage: StorageInterface) => Promise<T>): Promise<T | null> => {
      const resolvedStorage = storage ?? (await refresh());
      if (!resolvedStorage) {
        return null;
      }
      return callback(resolvedStorage);
    },
    [refresh, storage],
  );

  return {
    storage,
    isReady: Boolean(storage) && !error,
    error,
    refresh,
    withStorage,
  };
};



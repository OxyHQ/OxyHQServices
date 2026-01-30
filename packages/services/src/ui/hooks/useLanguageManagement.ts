import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiError, User } from '@oxyhq/core';
import {
  getLanguageMetadata,
  getLanguageName,
  getNativeLanguageName,
  normalizeLanguageCode,
  type LanguageMetadata,
} from '@oxyhq/core';
import type { StorageInterface } from '../utils/storageHelpers';
import { extractErrorMessage } from '../utils/errorHandlers';

export interface UseLanguageManagementOptions {
  storage: StorageInterface | null;
  languageKey: string;
  onError?: (error: ApiError) => void;
  logger?: (message: string, error?: unknown) => void;
}

export interface UseLanguageManagementResult {
  currentLanguage: string;
  metadata: LanguageMetadata | null;
  languageName: string;
  nativeLanguageName: string;
  setLanguage: (languageId: string) => Promise<void>;
  applyLanguagePreference: (user: User | null) => Promise<void>;
  hydrateLanguage: () => Promise<void>;
}

const DEFAULT_LANGUAGE = 'en-US';

/**
 * Manage UI language state, persistence, and metadata derivation.
 *
 * @param options - Configuration for storage access and error reporting
 */
export const useLanguageManagement = ({
  storage,
  languageKey,
  onError,
  logger,
}: UseLanguageManagementOptions): UseLanguageManagementResult => {
  const [currentLanguage, setCurrentLanguage] = useState<string>(DEFAULT_LANGUAGE);

  const loadLanguageFromStorage = useCallback(async (): Promise<void> => {
    if (!storage) {
      return;
    }

    try {
      const savedLanguageRaw = await storage.getItem(languageKey);
      const normalized = normalizeLanguageCode(savedLanguageRaw) || savedLanguageRaw;
      if (normalized) {
        setCurrentLanguage(normalized);
      }
    } catch (error) {
      const message = extractErrorMessage(error, 'Failed to load language preference');
      onError?.({
        message,
        code: 'LANGUAGE_LOAD_ERROR',
        status: 500,
      });
      if (logger) {
        logger(message, error);
      } else if (__DEV__) {
        console.warn('Failed to load language preference:', error);
      }
    }
  }, [languageKey, logger, onError, storage]);

  useEffect(() => {
    loadLanguageFromStorage().catch((error) => {
      if (logger) {
        logger('Unexpected error loading language', error);
      }
    });
  }, [loadLanguageFromStorage, logger]);

  const setLanguage = useCallback(
    async (languageId: string): Promise<void> => {
      if (!storage) {
        throw new Error('Storage not initialized');
      }

      const normalized = normalizeLanguageCode(languageId) || languageId;

      try {
        await storage.setItem(languageKey, normalized);
        setCurrentLanguage(normalized);
      } catch (error) {
        const message = extractErrorMessage(error, 'Failed to save language preference');
        onError?.({
          message,
          code: 'LANGUAGE_SAVE_ERROR',
          status: 500,
        });
        if (logger) {
          logger(message, error);
        } else if (__DEV__) {
          console.warn('Failed to save language preference:', error);
        }
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [languageKey, logger, onError, storage],
  );

  const applyLanguagePreference = useCallback(
    async (user: User | null): Promise<void> => {
      if (!storage || !user) {
        return;
      }

      const userLanguage = (user as Record<string, unknown>)?.language as string | undefined;
      if (!userLanguage) {
        return;
      }

      try {
        const normalized = normalizeLanguageCode(userLanguage) || userLanguage;
        await storage.setItem(languageKey, normalized);
        setCurrentLanguage(normalized);
      } catch (error) {
        if (logger) {
          logger('Failed to apply server language preference', error);
        } else if (__DEV__) {
          console.warn('Failed to apply server language preference', error);
        }
      }
    },
    [languageKey, logger, storage],
  );

  const metadata = useMemo(() => getLanguageMetadata(currentLanguage), [currentLanguage]);
  const languageName = useMemo(() => getLanguageName(currentLanguage), [currentLanguage]);
  const nativeLanguageName = useMemo(
    () => getNativeLanguageName(currentLanguage),
    [currentLanguage],
  );

  return {
    currentLanguage,
    metadata,
    languageName,
    nativeLanguageName,
    setLanguage,
    applyLanguagePreference,
    hydrateLanguage: loadLanguageFromStorage,
  };
};



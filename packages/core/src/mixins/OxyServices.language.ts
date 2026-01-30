/**
 * Language Methods Mixin
 */
import { normalizeLanguageCode, getLanguageMetadata, getLanguageName, getNativeLanguageName } from '../utils/languageUtils';
import type { LanguageMetadata } from '../utils/languageUtils';
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesLanguageMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    /**
     * Get appropriate storage for the platform (similar to DeviceManager)
     */
    public async getStorage(): Promise<{
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<void>;
      removeItem: (key: string) => Promise<void>;
    }> {
      const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
      
      if (isReactNative) {
        try {
          const asyncStorageModule = await import('@react-native-async-storage/async-storage');
          const storage = (asyncStorageModule.default as unknown) as import('@react-native-async-storage/async-storage').AsyncStorageStatic;
          return {
            getItem: storage.getItem.bind(storage),
            setItem: storage.setItem.bind(storage),
            removeItem: storage.removeItem.bind(storage),
          };
        } catch (error) {
          console.error('AsyncStorage not available in React Native:', error);
          throw new Error('AsyncStorage is required in React Native environment');
        }
      } else {
        // Use localStorage for web
        return {
          getItem: async (key: string) => {
            if (typeof window !== 'undefined' && window.localStorage) {
              return localStorage.getItem(key);
            }
            return null;
          },
          setItem: async (key: string, value: string) => {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem(key, value);
            }
          },
          removeItem: async (key: string) => {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.removeItem(key);
            }
          }
        };
      }
    }

    /**
     * Get the current language from storage or user profile
     * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
     * @returns The current language code (e.g., 'en-US') or null if not set
     */
    async getCurrentLanguage(storageKeyPrefix: string = 'oxy_session'): Promise<string | null> {
      try {
        // First try to get from user profile if authenticated
        try {
          const user = await (this as any).getCurrentUser();
          const userLanguage = (user as Record<string, unknown>)?.language as string | undefined;
          if (userLanguage) {
            return normalizeLanguageCode(userLanguage) || userLanguage;
          }
        } catch (e) {
          // User not authenticated or error, continue to storage
        }

        // Fall back to storage
        const storage = await this.getStorage();
        const storageKey = `${storageKeyPrefix}_language`;
        const storedLanguage = await storage.getItem(storageKey);
        if (storedLanguage) {
          return normalizeLanguageCode(storedLanguage) || storedLanguage;
        }

        return null;
      } catch (error) {
        if (__DEV__) {
          console.warn('Failed to get current language:', error);
        }
        return null;
      }
    }

    /**
     * Get the current language with metadata (name, nativeName, etc.)
     * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
     * @returns Language metadata object or null if not set
     */
    async getCurrentLanguageMetadata(storageKeyPrefix: string = 'oxy_session'): Promise<LanguageMetadata | null> {
      const languageCode = await this.getCurrentLanguage(storageKeyPrefix);
      return getLanguageMetadata(languageCode);
    }

    /**
     * Get the current language name (e.g., 'English')
     * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
     * @returns Language name or null if not set
     */
    async getCurrentLanguageName(storageKeyPrefix: string = 'oxy_session'): Promise<string | null> {
      const languageCode = await this.getCurrentLanguage(storageKeyPrefix);
      if (!languageCode) return null;
      return getLanguageName(languageCode);
    }

    /**
     * Get the current native language name (e.g., 'Español')
     * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
     * @returns Native language name or null if not set
     */
    async getCurrentNativeLanguageName(storageKeyPrefix: string = 'oxy_session'): Promise<string | null> {
      const languageCode = await this.getCurrentLanguage(storageKeyPrefix);
      if (!languageCode) return null;
      return getNativeLanguageName(languageCode);
    }
  };
}


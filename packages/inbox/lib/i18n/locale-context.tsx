import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOxy } from '@oxyhq/services';
import { isRTLLocale, normalizeLanguageCode } from '@oxyhq/core';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from './types';

// Allow RTL flipping system-wide once on module init. `allowRTL` is idempotent
// and gates whether `forceRTL` and device-locale RTL detection take effect.
I18nManager.allowRTL(true);

const STORAGE_KEY = 'oxy_inbox_locale';

/** Coerce any candidate language tag to a supported `Locale`, or `null`. */
function coerceLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const normalized = normalizeLanguageCode(value);
  if (SUPPORTED_LOCALES.includes(normalized as Locale)) {
    return normalized as Locale;
  }
  // Try the bare language portion (e.g. 'es-419' -> 'es' -> 'es-ES').
  const base = value.split('-')[0];
  if (base) {
    const fromBase = normalizeLanguageCode(base);
    if (SUPPORTED_LOCALES.includes(fromBase as Locale)) {
      return fromBase as Locale;
    }
  }
  return null;
}

/**
 * Read the device's primary locale via the Intl API. Hermes ships Intl by
 * default on RN 0.85+, so this works without an extra native module. The
 * resolved locale is a BCP-47 tag like `'es-ES'` that `coerceLocale` can
 * normalize against `SUPPORTED_LOCALES`.
 */
function getDeviceLocale(): Locale | null {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    return coerceLocale(tag);
  } catch {
    return null;
  }
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  isReady: boolean;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  children: React.ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const { user, oxyServices, isAuthenticated } = useOxy();

  // Initial locale is derived synchronously so we never flash English to a
  // Spanish-first user when AsyncStorage is empty.
  const initialLocale = useMemo<Locale>(() => {
    const fromUser = coerceLocale(
      (user as { language?: string } | null)?.language,
    );
    if (fromUser) return fromUser;
    const fromDevice = getDeviceLocale();
    if (fromDevice) return fromDevice;
    return DEFAULT_LOCALE;
  }, [user]);

  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  // Hydrate from AsyncStorage exactly once. The persisted value is the user's
  // explicit override and takes precedence over the auto-detected default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const stored = coerceLocale(raw);
        if (!cancelled && stored && stored !== locale) {
          setLocaleState(stored);
        }
      } catch {
        // Storage unavailable; keep the derived initial locale.
      } finally {
        if (!cancelled) setHasLoadedStorage(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Storage is read once on mount; further changes flow through `setLocale`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback(
    async (next: Locale) => {
      if (!SUPPORTED_LOCALES.includes(next)) return;
      setLocaleState(next);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage write failed; in-memory state still updated.
      }
      if (isAuthenticated && oxyServices) {
        try {
          await oxyServices.updateProfile({ language: next });
        } catch {
          // Profile sync failed (offline?); the local preference stands.
        }
      }
    },
    [isAuthenticated, oxyServices],
  );

  // Keep RN layout direction in sync with the active locale. `forceRTL`
  // only takes effect after a JS bundle reload, so we set it eagerly here.
  useEffect(() => {
    const wantRTL = isRTLLocale(locale);
    if (I18nManager.isRTL !== wantRTL) {
      I18nManager.forceRTL(wantRTL);
    }
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, isReady: hasLoadedStorage }),
    [locale, setLocale, hasLoadedStorage],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error(
      'useLocale must be used inside <LocaleProvider>. Check app/_layout.tsx.',
    );
  }
  return ctx;
}

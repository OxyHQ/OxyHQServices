import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import { I18nManager } from 'react-native';
import { useOxy, useUpdateProfile } from '@oxyhq/services';
import { getBaseLanguage, isRTLLocale, normalizeLocale } from '@oxyhq/core';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from './types';

// Allow RTL flipping system-wide once on module init. `allowRTL` is idempotent
// and gates whether `forceRTL` takes effect.
I18nManager.allowRTL(true);

/**
 * Coerce a canonical BCP-47 locale from the SDK down to a locale this app
 * actually ships a dictionary for. An exact catalog match wins; otherwise the
 * closest supported locale sharing the same base language (`es-MX` -> `es-ES`);
 * otherwise the app default.
 */
function coerceLocale(value: string | null | undefined): Locale {
  if (value) {
    const canonical = normalizeLocale(value);
    if (canonical && SUPPORTED_LOCALES.includes(canonical as Locale)) {
      return canonical as Locale;
    }
    const base = getBaseLanguage(value);
    if (base) {
      const byBase = SUPPORTED_LOCALES.find(
        (locale) => getBaseLanguage(locale) === base,
      );
      if (byBase) return byBase;
    }
  }
  return DEFAULT_LOCALE;
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
  const { currentLanguage, currentLanguages, isAuthenticated, setLanguage } = useOxy();
  const updateProfile = useUpdateProfile();

  // The active locale is DERIVED from the SDK's centralized `currentLanguage`
  // — the account's primary locale when signed in, else the guest/device
  // locale — coerced to a locale this app has a dictionary for. The SDK owns
  // account-vs-device resolution and hydration, so there is nothing local to
  // store or await here.
  const locale = useMemo<Locale>(
    () => coerceLocale(currentLanguage),
    [currentLanguage],
  );

  const setLocale = useCallback(
    async (next: Locale) => {
      if (!SUPPORTED_LOCALES.includes(next)) return;
      if (isAuthenticated) {
        // Write the account's ordered locales, primary first, preserving any
        // additional locales the user has chosen.
        const rest = currentLanguages.filter((entry) => entry !== next);
        await updateProfile.mutateAsync({ languages: [next, ...rest] });
      } else {
        // Guests hold a single locally-stored locale, owned by the SDK.
        await setLanguage(next);
      }
    },
    [isAuthenticated, currentLanguages, updateProfile, setLanguage],
  );

  // Keep RN layout direction in sync with the active locale. `forceRTL` only
  // takes effect after a JS bundle reload, so we set it eagerly here.
  useEffect(() => {
    I18nManager.forceRTL(isRTLLocale(locale));
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    // Hydration is owned by the SDK; the derived locale is always immediately
    // available, so the context is ready from first paint.
    () => ({ locale, setLocale, isReady: true }),
    [locale, setLocale],
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

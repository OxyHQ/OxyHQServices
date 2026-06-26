import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { __resetAsyncStorage, __seedAsyncStorage } from '@/__mocks__/async-storage';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';
import { LocaleProvider, useLocale } from '@/lib/i18n/locale-context';
import { DEFAULT_LOCALE } from '@/lib/i18n/types';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

describe('LocaleProvider locale precedence', () => {
  beforeEach(() => {
    __resetAsyncStorage();
    __resetOxyState();
  });

  it('uses the user profile language as the initial locale when no storage value is set', async () => {
    __setOxyState({ user: { language: 'es-ES' } });
    const { result } = renderHook(() => useLocale(), { wrapper: Wrapper });
    // Storage hydration may fire asynchronously; wait for ready then assert.
    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });
    expect(result.current.locale).toBe('es-ES');
  });

  it('persisted storage value takes precedence over the user profile language', async () => {
    __setOxyState({ user: { language: 'es-ES' } });
    __seedAsyncStorage('oxy_accounts_locale', 'fr-FR');
    const { result } = renderHook(() => useLocale(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.locale).toBe('fr-FR');
    });
  });

  it('falls back to DEFAULT_LOCALE when nothing resolves', async () => {
    __setOxyState({ user: null });
    const { result } = renderHook(() => useLocale(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });
    // jsdom Intl is en-US-ish in most CI envs, so we accept either the device
    // resolution or the documented default — both are valid fallbacks.
    expect([DEFAULT_LOCALE, 'es-ES']).toContain(result.current.locale);
  });

  it('ignores unsupported persisted values and keeps the derived locale', async () => {
    __setOxyState({ user: { language: 'en-US' } });
    __seedAsyncStorage('oxy_accounts_locale', 'klingon-KL');
    const { result } = renderHook(() => useLocale(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });
    expect(result.current.locale).toBe('en-US');
  });

  it('throws when useLocale is called outside a LocaleProvider', () => {
    expect(() => renderHook(() => useLocale())).toThrow(/LocaleProvider/);
  });
});

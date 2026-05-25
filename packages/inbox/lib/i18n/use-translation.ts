import { useCallback, useMemo } from 'react';
import { translate as coreTranslate } from '@oxyhq/core';
import { useLocale } from './locale-context';
import enInbox from './locales/en';
import esInbox from './locales/es';
import caInbox from './locales/ca';
import frInbox from './locales/fr';
import deInbox from './locales/de';
import itInbox from './locales/it';
import ptInbox from './locales/pt';
import jaInbox from './locales/ja';
import koInbox from './locales/ko';
import zhInbox from './locales/zh';
import arInbox from './locales/ar';
import type {
  Locale,
  LocaleDict,
  LocaleNode,
  TranslateFn,
  TranslationVars,
} from './types';

/**
 * Inbox-namespaced dictionaries loaded at module init. All 11 supported
 * locales are fully populated; missing keys fall back to core's dictionary
 * and then to the raw key for visibility.
 */
const INBOX_DICTS: Partial<Record<Locale, LocaleDict>> = {
  'en-US': enInbox as LocaleDict,
  'es-ES': esInbox as LocaleDict,
  'ca-ES': caInbox as LocaleDict,
  'fr-FR': frInbox as LocaleDict,
  'de-DE': deInbox as LocaleDict,
  'it-IT': itInbox as LocaleDict,
  'pt-PT': ptInbox as LocaleDict,
  'ja-JP': jaInbox as LocaleDict,
  'ko-KR': koInbox as LocaleDict,
  'zh-CN': zhInbox as LocaleDict,
  'ar-SA': arInbox as LocaleDict,
};

function lookup(dict: LocaleDict | undefined, key: string): string | undefined {
  if (!dict) return undefined;
  const parts = key.split('.');
  let node: LocaleNode | LocaleNode[] | undefined = dict;
  for (const part of parts) {
    if (Array.isArray(node)) {
      const idx = Number.parseInt(part, 10);
      if (!Number.isInteger(idx)) return undefined;
      node = node[idx];
    } else if (node && typeof node === 'object') {
      node = (node as Record<string, LocaleNode | LocaleNode[]>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  let out = template;
  for (const k of Object.keys(vars)) {
    out = out.replaceAll(`{{${k}}}`, String(vars[k]));
  }
  return out;
}

/**
 * Pick the right pluralization variant by appending `_zero` / `_one` /
 * `_other` suffixes based on the `count` interpolation variable. Returns
 * the original key if no plural variant exists.
 */
function pluralizeKey(
  key: string,
  vars: TranslationVars | undefined,
  dict: LocaleDict | undefined,
): string {
  if (!vars || typeof vars.count !== 'number') return key;
  const count = vars.count;
  const variant = count === 0 ? 'zero' : count === 1 ? 'one' : 'other';
  const candidate = `${key}_${variant}`;
  if (lookup(dict, candidate) != null) return candidate;
  return key;
}

interface UseTranslationResult {
  t: TranslateFn;
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
}

/**
 * Returns the translation function plus the current locale and a setter.
 *
 * Resolution order:
 *   1. Inbox-namespaced dict for the active locale (all 11 locales).
 *   2. Core's `translate(locale, key, vars)` for shared strings such as
 *      `signin.*`, `signup.*`, etc. that live in `@oxyhq/core` dictionaries.
 *   3. The raw key string, so missing translations surface visibly without
 *      breaking the UI.
 */
export function useTranslation(): UseTranslationResult {
  const { locale, setLocale } = useLocale();

  const dict = useMemo(() => INBOX_DICTS[locale], [locale]);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const resolvedKey = pluralizeKey(key, vars, dict);

      const local = lookup(dict, resolvedKey);
      if (local != null) return interpolate(local, vars);

      const fromCore = coreTranslate(locale, resolvedKey, vars);
      if (fromCore !== resolvedKey) return fromCore;

      // Both layers missed — return the original key for visibility.
      return key;
    },
    [dict, locale],
  );

  return { t, locale, setLocale };
}

/**
 * Language utilities for OxyServices
 * Provides access to supported languages and language metadata
 */

export interface LanguageMetadata {
  id: string;
  name: string;
  nativeName: string;
  flag: string;
  icon: string;
  color: string;
}

// Supported languages with their metadata
export const SUPPORTED_LANGUAGES: LanguageMetadata[] = [
  {
    id: 'en-US',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    icon: 'translate',
    color: '#007AFF',
  },
  {
    id: 'es-ES',
    name: 'Spanish',
    nativeName: 'Español',
    flag: '🇪🇸',
    icon: 'translate',
    color: '#FF3B30',
  },
  {
    id: 'ca-ES',
    name: 'Catalan',
    nativeName: 'Català',
    flag: '🇪🇸',
    icon: 'translate',
    color: '#0CA678',
  },
  {
    id: 'fr-FR',
    name: 'French',
    nativeName: 'Français',
    flag: '🇫🇷',
    icon: 'translate',
    color: '#5856D6',
  },
  {
    id: 'de-DE',
    name: 'German',
    nativeName: 'Deutsch',
    flag: '🇩🇪',
    icon: 'translate',
    color: '#FF9500',
  },
  {
    id: 'it-IT',
    name: 'Italian',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    icon: 'translate',
    color: '#34C759',
  },
  {
    id: 'pt-PT',
    name: 'Portuguese',
    nativeName: 'Português',
    flag: '🇵🇹',
    icon: 'translate',
    color: '#AF52DE',
  },
  {
    id: 'ja-JP',
    name: 'Japanese',
    nativeName: '日本語',
    flag: '🇯🇵',
    icon: 'translate',
    color: '#FF2D92',
  },
  {
    id: 'ko-KR',
    name: 'Korean',
    nativeName: '한국어',
    flag: '🇰🇷',
    icon: 'translate',
    color: '#32D74B',
  },
  {
    id: 'zh-CN',
    name: 'Chinese',
    nativeName: '中文',
    flag: '🇨🇳',
    icon: 'translate',
    color: '#FF9F0A',
  },
  {
    id: 'ar-SA',
    name: 'Arabic',
    nativeName: 'العربية',
    flag: '🇸🇦',
    icon: 'translate',
    color: '#30B0C7',
  },
];

const FALLBACK_LANGUAGE = 'en-US';

/**
 * Get language metadata by language code
 * @param languageCode - BCP-47 language code (e.g., 'en-US', 'es-ES')
 * @returns Language metadata or null if not found
 */
export function getLanguageMetadata(languageCode: string | null | undefined): LanguageMetadata | null {
  if (!languageCode) return null;
  
  // Direct match
  const exactMatch = SUPPORTED_LANGUAGES.find(lang => lang.id === languageCode);
  if (exactMatch) return exactMatch;
  
  // Try to match base language code (e.g., 'en' matches 'en-US')
  const baseCode = languageCode.split('-')[0];
  const baseMatch = SUPPORTED_LANGUAGES.find(lang => lang.id.startsWith(baseCode + '-'));
  if (baseMatch) return baseMatch;
  
  return null;
}

/**
 * Get language name by language code
 * @param languageCode - BCP-47 language code (e.g., 'en-US', 'es-ES')
 * @returns Language name (e.g., 'English') or the code if not found
 */
export function getLanguageName(languageCode: string | null | undefined): string {
  const metadata = getLanguageMetadata(languageCode);
  return metadata?.name || languageCode || FALLBACK_LANGUAGE;
}

/**
 * Get native language name by language code
 * @param languageCode - BCP-47 language code (e.g., 'en-US', 'es-ES')
 * @returns Native language name (e.g., 'Español') or the code if not found
 */
export function getNativeLanguageName(languageCode: string | null | undefined): string {
  const metadata = getLanguageMetadata(languageCode);
  return metadata?.nativeName || languageCode || FALLBACK_LANGUAGE;
}

/**
 * Normalize language code to BCP-47 format
 * @param lang - Language code (may be short like 'en' or full like 'en-US')
 * @returns Normalized BCP-47 language code
 */
export function normalizeLanguageCode(lang?: string | null): string {
  if (!lang) return FALLBACK_LANGUAGE;
  if (lang.includes('-')) return lang;

  const map: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    ca: 'ca-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-PT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    zh: 'zh-CN',
    ar: 'ar-SA',
  };

  return map[lang] || lang;
}

/**
 * RTL language detection.
 *
 * Returns `true` when the given BCP-47 tag or bare language code is one
 * of the right-to-left scripts we ship UI for. Apps use this to drive
 * `I18nManager.allowRTL(true)` / `forceRTL(...)` on React Native and the
 * `<html dir="rtl">` attribute on web.
 *
 * Includes Arabic (`ar`), Hebrew (`he` / legacy `iw`), Persian (`fa`),
 * Urdu (`ur`) plus their common region variants. Unknown tags are
 * treated as LTR.
 */
const RTL_LANGUAGE_BASES = new Set(['ar', 'he', 'iw', 'fa', 'ur']);

export function isRTLLocale(locale?: string | null): boolean {
  if (!locale) return false;
  const base = locale.toLowerCase().split('-')[0];
  if (!base) return false;
  return RTL_LANGUAGE_BASES.has(base);
}


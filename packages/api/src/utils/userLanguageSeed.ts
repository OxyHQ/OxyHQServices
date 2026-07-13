/**
 * Pure resolution logic for the `seed-user-languages` one-shot migration.
 *
 * Extracted from the script so it can be unit-tested without executing the
 * script's `main()` (which opens a DB connection on import) — the same split
 * used by `reputationMigrationMapping` for the karma migration.
 */

import { SUPPORTED_LANGUAGES, FALLBACK_LOCALE, normalizeLocale, getBaseLanguage } from '@oxyhq/core';

/**
 * Default locale per base language subtag: the FIRST catalog entry for each
 * base (e.g. `en` → `en-US`, `es` → `es-ES`). Used to upgrade a legacy bare
 * code to a full locale.
 */
const DEFAULT_LOCALE_BY_BASE: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const entry of SUPPORTED_LANGUAGES) {
    if (!map.has(entry.language)) {
      map.set(entry.language, entry.code);
    }
  }
  return map;
})();

/**
 * Resolve the canonical BCP-47 locale to seed into `User.languages` from a
 * legacy singular `language` value.
 *
 * Resolution order:
 *   1. a valid locale (`normalizeLocale`)            → that canonical locale
 *   2. a bare / non-locale code (e.g. `es`)          → the default locale of
 *      its base language (e.g. `es-ES`)
 *   3. missing / empty / unresolvable                → {@link FALLBACK_LOCALE}
 *
 * Pure and total — never throws.
 */
export function resolveSeedLocale(legacyLanguage: unknown): string {
  if (typeof legacyLanguage !== 'string' || legacyLanguage.trim() === '') {
    return FALLBACK_LOCALE;
  }
  const canonical = normalizeLocale(legacyLanguage);
  if (canonical) return canonical;
  const base = getBaseLanguage(legacyLanguage);
  return DEFAULT_LOCALE_BY_BASE.get(base) ?? FALLBACK_LOCALE;
}

/**
 * Validation utilities for common data validation patterns
 */

import {
  DISPLAY_NAME_ALLOWED_SCRIPTS_RANGES,
  DISPLAY_NAME_COMBINING_MARKS_RANGES,
  DISPLAY_NAME_SPACE_SEPARATORS_RANGES,
  DISPLAY_NAME_LETTERS_RANGES,
} from './displayNamePolicyRanges.generated';

/**
 * Email validation regex
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Username validation regex (alphanumeric, underscores, and hyphens, 3-30 chars)
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;

/**
 * Password validation regex (at least 8 chars, 1 uppercase, 1 lowercase, 1 number)
 */
// At least 8 characters (tests expect len>=8 without complexity requirements)
export const PASSWORD_REGEX = /^.{8,}$/;

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Validate username format
 */
export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Validate password strength
 */
export function isValidPassword(password: string): boolean {
  return PASSWORD_REGEX.test(password);
}

/**
 * Display-name character policy.
 *
 * A clean display name is composed ONLY of:
 *   - letters from a curated ALLOWLIST of scripts that real names use
 *     ({@link DISPLAY_NAME_ALLOWED_SCRIPTS}) — NOT every letter (General_Category
 *     L of ANY script), which admits decorative / historic / limited-use scripts
 *     whose characters are letters yet never appear in a real name (e.g. `ᯅ`
 *     U+1BC5 Batak, Runic, Deseret, dingbat letters),
 *   - combining marks / accents (General_Category M, e.g. the acute accent in a
 *     decomposed "é"),
 *   - Unicode space separators (General_Category Zs: the ASCII space, NBSP,
 *     ideographic space, …) — but NOT control whitespace such as tab, newline,
 *     or carriage return, which would break layout or enable multi-line
 *     spoofing,
 *   - the straight apostrophe (`'`, e.g. "O'Brien").
 *
 * Everything else is rejected: emoji (🐧), symbols (⁂ ⏚), `:emoji:` shortcodes,
 * digits, hyphens, dots, control whitespace (tab/newline/CR), letters from
 * non-allowlisted scripts, and any other punctuation. The allowed set never
 * includes `<`, `>`, `&`, or `"`, so a value that passes this predicate can
 * never contain an HTML/XSS vector.
 *
 * The allowlist is expressed with Unicode Script_Extensions (scx=…) so a letter
 * shared by several scripts (e.g. a Han ideograph used in both Chinese and
 * Japanese) still matches. It is the set of scripts Unicode UTS #39 marks
 * "Recommended" for general interchange / identifiers, plus Cherokee and
 * Mongolian (both in real modern name use). "Common" script is deliberately
 * EXCLUDED — that is where ASCII digits and general punctuation live, and this
 * policy excludes those; the space separators, combining marks, and apostrophe a
 * name needs are added back explicitly. Limited-use / excluded / historic
 * scripts (Batak, Runic, Deseret, Adlam, …) are simply absent.
 *
 * HERMES / RANGES: the class bodies below are built from explicit Unicode
 * code-point RANGES ({@link DISPLAY_NAME_ALLOWED_SCRIPTS_RANGES} et al. from
 * `./displayNamePolicyRanges.generated`), NOT from `scx`/General_Category
 * property escapes. React Native's Hermes engine ships with Unicode property
 * escapes compiled OUT and throws "Invalid RegExp: Invalid property name" for
 * any such escape at module load, crashing every Oxy RN/Expo app at boot. The
 * ranges are the compressed union of exactly those properties (generated on
 * Node/V8, which supports them — see `scripts/generateDisplayNamePolicyRanges.mjs`),
 * so behavior is IDENTICAL on V8 (web) and Hermes (native) with the same `u`
 * flag and lookbehind, but with zero property escapes in the shipped regex.
 *
 * This is the SINGLE definition of the policy: the character-class sources below
 * are the ONE source of truth, shared between the API strip/gate
 * (`@oxyhq/api` `displayNameSanitize.ts` builds its global-flag patterns from
 * them) and client-side inline validation (the RN profile editor via
 * {@link isValidDisplayName}) so the two can never drift. It is platform-agnostic
 * (no react/react-native/expo).
 */

/**
 * The curated allowlist of Unicode scripts permitted in a display name, as a
 * character-class body of explicit code-point ranges (the compressed union of
 * the 30 allowlisted Script_Extensions, generated on V8). Interpolated into the
 * negated class below.
 */
export const DISPLAY_NAME_ALLOWED_SCRIPTS = DISPLAY_NAME_ALLOWED_SCRIPTS_RANGES;

/**
 * Source of the disallowed-character pattern: the negation of the full allowed
 * set (allowlisted scripts + combining marks + space separators + the straight
 * apostrophe). Consumers compile this with the `u` flag (and `g` for a global
 * strip). The whitespace class is space separators only (General_Category Zs),
 * NOT `\s` — the latter would admit tab/newline/carriage return, which break
 * layout and enable multi-line spoofing.
 */
export const DISPLAY_NAME_DISALLOWED_SOURCE = `[^${DISPLAY_NAME_ALLOWED_SCRIPTS}${DISPLAY_NAME_COMBINING_MARKS_RANGES}${DISPLAY_NAME_SPACE_SEPARATORS_RANGES}']`;

/**
 * Source of the orphaned combining-mark pattern: a run of combining marks NOT
 * attached to a base letter (preceded by string start, whitespace, the
 * apostrophe, or a position vacated by a stripped character). A mark preceded by
 * a base letter (e.g. the decomposed accent in "Renée") or by another combining
 * mark (a multi-mark cluster) is NOT matched because the negative lookbehind
 * fails at its position. Used both as a non-global probe (`.test`) and, with the
 * `g` flag, to strip whole orphaned runs. The lookbehind intentionally uses the
 * BROAD letters set (General_Category L of any script) so that a mark riding on
 * an allowlisted base letter is preserved.
 */
export const DISPLAY_NAME_ORPHANED_MARK_SOURCE = `(?<![${DISPLAY_NAME_LETTERS_RANGES}${DISPLAY_NAME_COMBINING_MARKS_RANGES}])[${DISPLAY_NAME_COMBINING_MARKS_RANGES}]+`;

/** Non-global probe for the presence of a disallowed character. */
const DISALLOWED_PROBE = new RegExp(DISPLAY_NAME_DISALLOWED_SOURCE, 'u');

/** Non-global probe for the presence of an orphaned combining mark. */
const ORPHANED_MARK_PROBE = new RegExp(DISPLAY_NAME_ORPHANED_MARK_SOURCE, 'u');

/**
 * Whether `raw` already satisfies the display-name policy, i.e. it contains no
 * disallowed characters AND no orphaned combining marks. Used to REJECT native
 * (signup / profile edit) names with a 400 rather than silently stripping them,
 * and to validate inline in the client editor.
 *
 * The orphaned-mark probe runs on the NFC-normalized form so a legitimate
 * decomposed accent (`e`+◌́) — which normalization recomposes into `é` — is NOT
 * rejected, while a lone, base-less mark (e.g. `"༘"`) IS.
 *
 * The function only checks the character set; an empty or whitespace-only string
 * is considered valid (`true`). Call sites that require a non-empty name enforce
 * that separately.
 */
export function isValidDisplayName(raw: string): boolean {
  return (
    !DISALLOWED_PROBE.test(raw) && !ORPHANED_MARK_PROBE.test(raw.normalize('NFC'))
  );
}

/**
 * Validate required string
 */
export function isRequiredString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate required number
 */
export function isRequiredNumber(value: unknown): boolean {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Validate required boolean
 */
export function isRequiredBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

/**
 * Validate array
 */
export function isValidArray(value: unknown): boolean {
  return Array.isArray(value);
}

/**
 * Validate object
 */
export function isValidObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(uuid);
}

/**
 * Validate URL format
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate date string
 */
export function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return !Number.isNaN(date.getTime());
}

/**
 * Validate file size (in bytes)
 */
export function isValidFileSize(size: number, maxSize: number): boolean {
  return size > 0 && size <= maxSize;
}

/**
 * Validate file type
 */
export function isValidFileType(filename: string, allowedTypes: string[]): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension ? allowedTypes.includes(extension) : false;
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: string): string {
  // Remove HTML tags entirely and trim whitespace
  return input.trim().replace(/<[^>]*>/g, '');
}

/**
 * Sanitize HTML input
 */
export function sanitizeHTML(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate MongoDB ObjectId format
 * Note: This is a basic format check. For full validation, use mongoose.Types.ObjectId.isValid()
 * This function works in environments where mongoose may not be available (e.g., client-side)
 */
export function isValidObjectId(id: string): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  // MongoDB ObjectId is 24 hex characters
  const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
  return OBJECT_ID_REGEX.test(id);
}

/**
 * Validate and sanitize user input
 */
export function validateAndSanitizeUserInput(input: unknown, type: 'string' | 'email' | 'username'): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const sanitized = sanitizeString(input);
  
  switch (type) {
    case 'email':
      return isValidEmail(sanitized) ? sanitized : null;
    case 'username':
      return isValidUsername(sanitized) ? sanitized : null;
    case 'string':
      return isRequiredString(sanitized) ? sanitized : null;
    default:
      return null;
  }
} 

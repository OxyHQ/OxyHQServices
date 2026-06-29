/**
 * Display-name character policy.
 *
 * A clean display name is composed ONLY of:
 *   - letters of any script (`\p{L}`),
 *   - combining marks / accents (`\p{M}`, e.g. the acute accent in a decomposed
 *     "é"),
 *   - whitespace (`\s`),
 *   - the straight apostrophe (`'`, e.g. "O'Brien").
 *
 * Everything else is removed: emoji (🐧), symbols (⁂ ⏚), `:emoji:` shortcodes,
 * digits, hyphens, dots, and any other punctuation.
 *
 * XSS reasoning
 * -------------
 * The allowed set `\p{L}\p{M}\s'` explicitly EXCLUDES `<`, `>`, `&`, and `"`,
 * so the output of {@link cleanDisplayName} can never contain an HTML/XSS
 * vector — there is simply no character in the output that can open a tag, an
 * entity, or an attribute. The only special character that survives is the
 * straight apostrophe `'`, which is inert in text and JSON and is escaped by
 * React / React Native at render time. That is why federated write sites
 * replace `sanitizeHtml(...)` with `cleanDisplayName(...)` for the NAME field:
 * `sanitizeHtml` would turn `O'Brien` into `O&#x27;Brien` (which then renders
 * literally), whereas `cleanDisplayName` yields a clean, already-safe `O'Brien`.
 */

/** Maximum stored length of a display name, in code units after cleaning. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Matches a `:shortcode:` emoji token (e.g. `:bongoCat:`, `:+1:`). */
const SHORTCODE_PATTERN = /:[A-Za-z0-9_+-]+:/g;

/** Matches any character NOT allowed in a display name (global, Unicode). */
const DISALLOWED_PATTERN = /[^\p{L}\p{M}\s']/gu;

/** Single test for the presence of a disallowed character (non-global). */
const DISALLOWED_PROBE = /[^\p{L}\p{M}\s']/u;

/**
 * Produce a clean display name from arbitrary (possibly federated/untrusted)
 * input. The transformation order is significant:
 *
 *   1. NFC-normalize so visually-identical strings compare/store identically.
 *   2. Strip `:shortcode:` tokens FIRST — otherwise step 3 would only remove
 *      the surrounding colons and leave the bare word (`:bongoCat:` → `bongoCat`).
 *   3. Replace every disallowed character with a space.
 *   4. Collapse runs of whitespace to a single space and trim the ends.
 *   5. Cap the length to {@link MAX_DISPLAY_NAME_LENGTH}, trimming again in case
 *      the slice landed on a boundary space.
 */
export function cleanDisplayName(raw: string): string {
  const collapsed = String(raw)
    .normalize('NFC')
    .replace(SHORTCODE_PATTERN, ' ')
    .replace(DISALLOWED_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (collapsed.length <= MAX_DISPLAY_NAME_LENGTH) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
}

/**
 * Whether `raw` already satisfies the display-name character policy, i.e. it
 * contains no disallowed characters. Used to REJECT native (signup / profile
 * edit) names with a 400 rather than silently stripping them.
 *
 * The function only checks for disallowed characters; an empty or
 * whitespace-only string is considered valid (`true`). Call sites that require
 * a non-empty name enforce that separately — this check is purely about the
 * character set.
 */
export function isValidDisplayName(raw: string): boolean {
  return !DISALLOWED_PROBE.test(raw);
}

/**
 * Display-name character policy.
 *
 * A clean display name is composed ONLY of:
 *   - letters of any script (`\p{L}`),
 *   - combining marks / accents (`\p{M}`, e.g. the acute accent in a decomposed
 *     "é"),
 *   - Unicode space separators (`\p{Zs}`: the ASCII space, NBSP, ideographic
 *     space, …) — but NOT control whitespace such as tab, newline, or carriage
 *     return, which would break layout or enable multi-line spoofing,
 *   - the straight apostrophe (`'`, e.g. "O'Brien").
 *
 * Everything else is removed: emoji (🐧), symbols (⁂ ⏚), `:emoji:` shortcodes,
 * digits, hyphens, dots, control whitespace (tab/newline/CR), and any other
 * punctuation.
 *
 * XSS reasoning
 * -------------
 * The allowed set `\p{L}\p{M}\p{Zs}'` explicitly EXCLUDES `<`, `>`, `&`, and `"`,
 * so the output of {@link cleanDisplayName} can never contain an HTML/XSS
 * vector — there is simply no character in the output that can open a tag, an
 * entity, or an attribute. The only special character that survives is the
 * straight apostrophe `'`, which is inert in text and JSON and is escaped by
 * React / React Native at render time. That is why federated write sites
 * replace `sanitizeHtml(...)` with `cleanDisplayName(...)` for the NAME field:
 * `sanitizeHtml` would turn `O'Brien` into `O&#x27;Brien` (which then renders
 * literally), whereas `cleanDisplayName` yields a clean, already-safe `O'Brien`.
 *
 * Whitespace/Unicode normalization is NOT implemented here: it is delegated to
 * the canonical `normalizeInlineText` from `@oxyhq/core`. This module owns only
 * the display-name PRODUCT rules (character policy, shortcode stripping, length
 * cap).
 */

import { normalizeInlineText } from '@oxyhq/core';

/** Maximum stored length of a display name, in code units after cleaning. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Matches a `:shortcode:` emoji token (e.g. `:bongoCat:`, `:+1:`). */
const SHORTCODE_PATTERN = /:[A-Za-z0-9_+-]+:/g;

/**
 * Matches any character NOT allowed in a display name (global, Unicode). The
 * whitespace class is `\p{Zs}` (space separators only), NOT `\s` — the latter
 * would admit tab/newline/carriage return, which break layout and enable
 * multi-line spoofing.
 */
const DISALLOWED_PATTERN = /[^\p{L}\p{M}\p{Zs}']/gu;

/** Single test for the presence of a disallowed character (non-global). */
const DISALLOWED_PROBE = /[^\p{L}\p{M}\p{Zs}']/u;

/**
 * Matches a run of combining marks (`\p{M}`) that is NOT attached to a base
 * letter — i.e. the first mark of the run is preceded by something that is
 * neither a letter nor another mark (string start, whitespace, the apostrophe,
 * or a position vacated by a stripped character). The whole orphaned run is
 * removed. A mark preceded by `\p{L}` (a base letter, e.g. the decomposed
 * accent in "Renée") or by another `\p{M}` (a multi-mark cluster) is KEPT
 * because the negative lookbehind fails at its position.
 *
 * This catches lone Tibetan/diacritic marks (e.g. U+0F18 in `"༘⋆"`) and the
 * trailing variation selector (U+FE0F) left behind after an emoji base such as
 * U+2764 (❤) is stripped, both of which would otherwise survive the
 * `\p{M}`-friendly policy as meaningless garbage.
 */
const ORPHANED_MARK_PATTERN = /(?<![\p{L}\p{M}])\p{M}+/gu;

/** Single test for the presence of an orphaned combining mark (non-global). */
const ORPHANED_MARK_PROBE = /(?<![\p{L}\p{M}])\p{M}/u;

/**
 * Produce a clean display name from arbitrary (possibly federated/untrusted)
 * input. The transformation order is significant:
 *
 *   1. NFC-normalize so visually-identical strings compare/store identically
 *      (this also recomposes e.g. `e`+◌́ into a precomposed `é`, so legitimate
 *      decomposed accents never reach step 4 as standalone marks).
 *   2. Strip `:shortcode:` tokens FIRST — otherwise step 3 would only remove
 *      the surrounding colons and leave the bare word (`:bongoCat:` → `bongoCat`).
 *   3. Replace every disallowed character with a space.
 *   4. Remove orphaned combining marks — any `\p{M}` run not attached to a base
 *      letter (e.g. a lone Tibetan mark `U+0F18`, or a `U+FE0F` variation
 *      selector left after its emoji base was stripped in step 3). Marks that
 *      are still attached to a base letter are kept.
 *   5. Collapse whitespace and trim — delegated to {@link normalizeInlineText}, the
 *      ecosystem's canonical single-line normalizer. A display name is a
 *      one-line value, so every whitespace run (including a `\n` smuggled in by
 *      a federated actor) becomes a single space. The explicit NFC pass in step 1
 *      is kept because the character policy in steps 3–4 must see the composed
 *      form; `normalizeInlineText` re-normalizing an already-NFC string is a no-op.
 *   6. Cap the length to {@link MAX_DISPLAY_NAME_LENGTH}, trimming again in case
 *      the slice landed on a boundary space.
 */
export function cleanDisplayName(raw: string): string {
  const collapsed = normalizeInlineText(
    String(raw)
      .normalize('NFC')
      .replace(SHORTCODE_PATTERN, ' ')
      .replace(DISALLOWED_PATTERN, ' ')
      .replace(ORPHANED_MARK_PATTERN, '')
  );

  if (collapsed.length <= MAX_DISPLAY_NAME_LENGTH) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
}

/**
 * Whether `raw` already satisfies the display-name policy, i.e. it contains no
 * disallowed characters AND no orphaned combining marks. Used to REJECT native
 * (signup / profile edit) names with a 400 rather than silently stripping them.
 *
 * This mirrors {@link cleanDisplayName}: a value that the cleaner would alter
 * (beyond whitespace collapsing) is invalid here. The orphaned-mark probe runs
 * on the NFC-normalized form so a legitimate decomposed accent (`e`+◌́) — which
 * the cleaner recomposes into `é` — is NOT rejected, while a lone, base-less
 * mark (e.g. `"༘"`) IS.
 *
 * The function only checks the character set; an empty or whitespace-only
 * string is considered valid (`true`). Call sites that require a non-empty name
 * enforce that separately.
 */
export function isValidDisplayName(raw: string): boolean {
  return (
    !DISALLOWED_PROBE.test(raw) && !ORPHANED_MARK_PROBE.test(raw.normalize('NFC'))
  );
}

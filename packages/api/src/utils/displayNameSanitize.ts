/**
 * Display-name character policy.
 *
 * A clean display name is composed ONLY of:
 *   - letters from the curated ALLOWLIST of scripts real names use — NOT `\p{L}`
 *     (letters of ANY script), which admits decorative / historic / limited-use
 *     scripts whose characters are `\p{L}` yet never appear in a real name (e.g.
 *     `ᯅ` U+1BC5 Batak, Runic, Deseret, dingbat letters),
 *   - combining marks / accents (`\p{M}`, e.g. the acute accent in a decomposed
 *     "é"),
 *   - Unicode space separators (`\p{Zs}`: the ASCII space, NBSP, ideographic
 *     space, …) — but NOT control whitespace such as tab, newline, or carriage
 *     return, which would break layout or enable multi-line spoofing,
 *   - the straight apostrophe (`'`, e.g. "O'Brien").
 *
 * Everything else is removed: emoji (🐧), symbols (⁂ ⏚), `:emoji:` shortcodes,
 * digits, hyphens, dots, control whitespace (tab/newline/CR), letters from
 * non-allowlisted scripts, and any other punctuation.
 *
 * The character policy is NOT re-derived here: the allowlist and its patterns
 * are the ONE source of truth in `@oxyhq/core` `validationUtils.ts`
 * (`DISPLAY_NAME_DISALLOWED_SOURCE`, `DISPLAY_NAME_ORPHANED_MARK_SOURCE`). This
 * module imports those sources and compiles the global-flag variants it needs to
 * STRIP, so the strip path here and the core reject path (`isValidDisplayName`)
 * can never drift.
 *
 * XSS reasoning
 * -------------
 * The allowed set never includes `<`, `>`, `&`, or `"`, so the output of
 * {@link cleanDisplayName} can never contain an HTML/XSS vector — there is
 * simply no character in the output that can open a tag, an entity, or an
 * attribute. The only special character that survives is the straight
 * apostrophe `'`, which is inert in text and JSON and is escaped by
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

import {
  DISPLAY_NAME_DISALLOWED_SOURCE,
  DISPLAY_NAME_ORPHANED_MARK_SOURCE,
  normalizeInlineText,
} from '@oxyhq/core';

/** Maximum stored length of a display name, in code units after cleaning. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/** Matches a `:shortcode:` emoji token (e.g. `:bongoCat:`, `:+1:`). */
const SHORTCODE_PATTERN = /:[A-Za-z0-9_+-]+:/g;

/**
 * Matches any character NOT allowed in a display name (global, Unicode),
 * compiled from the core allowlist source so it can never drift from the reject
 * gate. The whitespace class is `\p{Zs}` (space separators only), NOT `\s` — the
 * latter would admit tab/newline/carriage return, which break layout and enable
 * multi-line spoofing.
 */
const DISALLOWED_PATTERN = new RegExp(DISPLAY_NAME_DISALLOWED_SOURCE, 'gu');

/**
 * Matches a run of combining marks (`\p{M}`) that is NOT attached to a base
 * letter — i.e. the first mark of the run is preceded by something that is
 * neither a letter nor another mark (string start, whitespace, the apostrophe,
 * or a position vacated by a stripped character). The whole orphaned run is
 * removed. A mark preceded by `\p{L}` (a base letter, e.g. the decomposed
 * accent in "Renée") or by another `\p{M}` (a multi-mark cluster) is KEPT
 * because the negative lookbehind fails at its position. Compiled (global) from
 * the same core source as the reject gate.
 *
 * This catches lone Tibetan/diacritic marks (e.g. U+0F18 in `"༘⋆"`) and the
 * trailing variation selector (U+FE0F) left behind after an emoji base such as
 * U+2764 (❤) is stripped, both of which would otherwise survive the
 * `\p{M}`-friendly policy as meaningless garbage.
 */
const ORPHANED_MARK_PATTERN = new RegExp(DISPLAY_NAME_ORPHANED_MARK_SOURCE, 'gu');

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

/**
 * Canonical text normalization for the Oxy ecosystem.
 *
 * WHY THIS EXISTS
 * ---------------
 * Third-party text (federated actor display names, spoiler/CW text, image alt
 * text, bios, `<title>` / `og:site_name` of scraped remote pages, …) arrives
 * with the whitespace the remote author's markup happened to contain. A real
 * bug: a remote page served
 *
 *     <title>
 *       Mi título
 *     </title>
 *
 * and the extracted string — newlines and indentation included — was stored
 * verbatim. Clients render text with React Native Web `Text`, which maps to
 * CSS `white-space: pre-wrap`: unlike HTML, newlines and repeated spaces are
 * NOT collapsed at render time, so the user saw a blank line and a six-space
 * indent inside the link preview.
 *
 * Storage-time normalization is therefore the ONLY place this can be fixed:
 * every renderer downstream is faithful by design.
 *
 * WHICH HELPER DO I USE?
 * ----------------------
 *  - {@link normalizeInlineText} — the value is conceptually ONE LINE, and a
 *    line break in it is always an accident of the source markup: page titles,
 *    `siteName`, display names, image `alt`, handles, profile field labels.
 *    Every line break becomes a space.
 *
 *  - {@link normalizeMultilineText} — the value is a BODY whose line breaks are
 *    the author's own paragraphs and must survive: post text, bios/summaries.
 *    Line breaks are preserved (capped at one blank line); only the surrounding
 *    whitespace noise is cleaned.
 *
 * Using the multiline helper on a title would keep the newlines and reproduce
 * the original bug; using the inline helper on a post body would flatten the
 * author's paragraphs into a single run-on line. Pick deliberately.
 *
 * Neither helper truncates, strips markup, or enforces a character policy —
 * those are separate, product-specific concerns (see `isValidDisplayName` for
 * the display-name character policy). These functions do exactly one thing:
 * normalize whitespace and Unicode form.
 */

/**
 * Characters that make a value ineligible for the zero-work fast path, and the
 * whitespace shapes that a normalized INLINE value can never contain.
 *
 * A value that matches nothing here is, by construction, already normalized:
 * it holds only printable ASCII (which is NFC-stable, so `normalize('NFC')`
 * would be a no-op), its only whitespace is the plain space, it has no leading
 * or trailing space, and no run of two spaces. Returning it untouched skips
 * three string allocations — worth it because the common case in the feed
 * hydration hot path is text that is already clean.
 *
 * Non-global (safe for repeated `.test()`; a global regex is stateful).
 */
const INLINE_NEEDS_NORMALIZATION = /[^\x20-\x7E]|^ | $| {2}/;

/**
 * Same idea as {@link INLINE_NEEDS_NORMALIZATION}, for MULTILINE values: `\n`
 * joins the printable-ASCII fast-path alphabet, and the additional shapes a
 * normalized body can never contain are a space before a line break (trailing
 * horizontal whitespace) and a run of three line breaks (more than one blank
 * line). A single space AFTER a line break is legal — a one-space indent is
 * the author's, and normalization deliberately preserves it.
 */
const MULTILINE_NEEDS_NORMALIZATION = /[^\x20-\x7E\n]|^[ \n]|[ \n]$| {2}| \n|\n{3}/;

/** Any run of whitespace, including tabs, line breaks and Unicode spaces. */
const ANY_WHITESPACE_RUN = /\s+/g;

/**
 * Every line-break form, unified to `\n` before the multiline passes run:
 * CRLF (Windows), a lone CR (classic Mac / stray `\r`), and the Unicode LINE
 * SEPARATOR (U+2028) / PARAGRAPH SEPARATOR (U+2029), which are mandatory breaks
 * in Unicode and a well-known hazard in JSON/JS payloads. CRLF must be matched
 * before the lone `\r` alternative or it would yield two breaks. The separators
 * are matched by Unicode property (`\p{Zl}` = U+2028, `\p{Zp}` = U+2029) rather
 * than as literals: a literal U+2028/U+2029 is a LineTerminator and cannot appear
 * inside a regex literal at all.
 */
const LINE_BREAK_FORMS = /\r\n|\r|\p{Zl}|\p{Zp}/gu;

/**
 * A run of HORIZONTAL whitespace: any whitespace that is not a line break.
 * `[^\S\n]` is "whitespace, minus `\n`" — it covers the tab, the vertical tab,
 * the form feed and every Unicode space separator (NBSP U+00A0, the U+2000
 * block, the ideographic space U+3000, the zero-width no-break space U+FEFF).
 * Applied AFTER {@link LINE_BREAK_FORMS}, so no line break can hide in it.
 */
const HORIZONTAL_WHITESPACE_RUN = /[^\S\n]+/g;

/** Horizontal whitespace at the end of a line — the blank-line spoiler. */
const TRAILING_HORIZONTAL_WHITESPACE = / +\n/g;

/** Three or more line breaks: more than one blank line between paragraphs. */
const EXCESS_BLANK_LINES = /\n{3,}/g;

/**
 * Normalize a SINGLE-LINE text value: page/link-preview titles, `siteName`,
 * display names, image alt text, handles, profile field labels.
 *
 * A line break in such a value is never meaningful — it is an artifact of the
 * markup the value was extracted from (`<title>\n  Título\n</title>`) — and it
 * survives into the UI because RN Web renders `Text` with `white-space:
 * pre-wrap`. So ALL whitespace, line breaks included, collapses to one space.
 *
 *   1. NFC-normalize, so visually identical strings store and compare
 *      identically (a decomposed `e`+◌́ recomposes into `é`).
 *   2. Collapse every run of whitespace — spaces, tabs, `\n`, `\r`, and Unicode
 *      spaces such as NBSP — to a single plain space.
 *   3. Trim both ends.
 *
 * Length is NOT capped: a maximum length is a product rule of the specific
 * field (see `MAX_DISPLAY_NAME_LENGTH`), not a property of text normalization.
 * Markup is NOT stripped: run the caller's sanitizer first if the source can
 * contain HTML.
 *
 * A value that is empty or whitespace-only returns `''`. Callers decide whether
 * that means "omit the field" (`|| undefined`) or "store an empty string".
 *
 * Idempotent: `f(f(x)) === f(x)`.
 */
export function normalizeInlineText(value: string): string {
  if (!INLINE_NEEDS_NORMALIZATION.test(value)) {
    return value;
  }
  return value.normalize('NFC').replace(ANY_WHITESPACE_RUN, ' ').trim();
}

/**
 * Normalize a MULTILINE text BODY: post text, bios, summaries — anywhere the
 * line breaks are the author's paragraphs and must be preserved.
 *
 * Cleans the whitespace noise around those paragraphs without destroying them:
 *
 *   1. NFC-normalize (same rationale as {@link normalizeInlineText}).
 *   2. Unify every line-break form (CRLF, lone CR, U+2028, U+2029) to `\n`.
 *   3. Collapse runs of HORIZONTAL whitespace (spaces, tabs, NBSP and friends)
 *      to a single space. Line breaks are untouched.
 *   4. Strip the horizontal whitespace at the END of each line.
 *   5. Collapse three or more line breaks to exactly one blank line (`\n\n`).
 *   6. Trim both ends.
 *
 * STEP 4 MUST PRECEDE STEP 5 — this is the whole point of the function. A
 * "blank" line that actually contains spaces (`"a\n   \n   \nb"`) breaks the
 * run of `\n` characters, so a bare `\n{3,}` collapse (step 5 alone) never sees
 * it and the extra blank lines survive into the UI. That is exactly the bug in
 * federated post bodies. Removing the trailing horizontal whitespace first
 * turns those lines into real, empty lines, which step 5 then collapses.
 *
 * A single space at the START of a line is preserved: only RUNS of horizontal
 * whitespace collapse, and an indent is not trailing whitespace, so a one-space
 * indent is treated as the author's and left alone.
 *
 * A value that is empty or whitespace-only returns `''`.
 *
 * Idempotent: `f(f(x)) === f(x)`.
 */
export function normalizeMultilineText(value: string): string {
  if (!MULTILINE_NEEDS_NORMALIZATION.test(value)) {
    return value;
  }
  return value
    .normalize('NFC')
    .replace(LINE_BREAK_FORMS, '\n')
    .replace(HORIZONTAL_WHITESPACE_RUN, ' ')
    .replace(TRAILING_HORIZONTAL_WHITESPACE, '\n')
    .replace(EXCESS_BLANK_LINES, '\n\n')
    .trim();
}

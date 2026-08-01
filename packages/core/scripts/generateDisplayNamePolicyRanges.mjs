// @ts-check
/**
 * Codegen for the display-name character policy ranges (via regexpu-core).
 *
 * WHY THIS EXISTS
 * ---------------
 * The display-name policy is authored with readable Unicode property escapes
 * (Script_Extensions "scx=Latin" … "scx=Han", plus General_Category M / Zs / L —
 * see READABLE SOURCE below). Those are perfect on V8 (web) but throw
 * `SyntaxError: Invalid RegExp: Invalid property name` at RUNTIME on React
 * Native's Hermes engine, which ships with `HERMES_ENABLE_UNICODE_REGEXP_-
 * PROPERTY_ESCAPES` OFF — Hermes has NO support for property escapes in a
 * `u`-flag regex at all. A single such literal at module load crashes every Oxy
 * RN/Expo app at boot.
 *
 * The fix keeps the SOURCE readable and semantic and transpiles ONLY the
 * property-escape atoms to explicit code-point RANGES with `regexpu-core` — the
 * exact library Babel's `@babel/plugin-transform-unicode-property-regex` uses to
 * lower property escapes for Hermes targets. We pass `unicodePropertyEscapes:
 * 'transform'` and KEEP the `u` flag (no `unicodeFlag` transform), so only the
 * `\p{…}`/`\P{…}` atoms are rewritten; the `u` flag, the negated class, and the
 * lookbehind are preserved verbatim. Output is the exact same match set as the
 * property-escape original → behavior identical on V8 and Hermes, zero runtime
 * cost, zero runtime dependency, and zero property escapes in `dist/`.
 *
 * regexpu-core bundles its own pinned Unicode tables, so the emitted ranges are
 * deterministic per regexpu-core version (NOT tied to the running Node/V8
 * Unicode version). The generated file is committed; the build does NOT run this
 * script.
 *
 * REGENERATE with:
 *   cd packages/core && bun run generate:display-name-policy
 * (or `node scripts/generateDisplayNamePolicyRanges.mjs`)
 * Only re-run when the allowlisted script set, the code-point denylist
 * ({@link SYMBOL_LETTER_DENYLIST}), or the regexpu-core version changes.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import rewritePattern from 'regexpu-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(
  __dirname,
  '..',
  'src',
  'utils',
  'displayNamePolicyRanges.generated.ts'
);

/* ------------------------------------------------------------------ *
 * READABLE SOURCE — the ONE human-authored definition of the policy. *
 * ------------------------------------------------------------------ */

/**
 * The curated allowlist of Unicode scripts permitted in a display name, as a
 * character-class body of Script_Extensions (`scx`) property escapes so a letter
 * shared by several scripts (e.g. a Han ideograph used in both Chinese and
 * Japanese) still matches. It is the set of scripts Unicode UTS #39 marks
 * "Recommended" for general interchange / identifiers, plus Cherokee and
 * Mongolian (both in real modern name use). "Common" script is deliberately
 * EXCLUDED — that is where ASCII digits and general punctuation live; the space
 * separators, combining marks, and apostrophe a name needs are added back
 * explicitly (see below). Limited-use / excluded / historic scripts (Batak,
 * Runic, Deseret, Adlam, …) are simply absent. Ordered by rough script family
 * for readability; order has no semantic effect.
 *
 * A script is NOT only its letters: `scx=X` also carries that script's own
 * digits, punctuation and symbols. This allowlist is therefore INTERSECTED with
 * General_Category L before emission ({@link LETTERS}) — see
 * {@link transpileClassBody}. Without that intersection the emitted class
 * admitted 1831 non-letter code points that the policy claims to reject: 559
 * script-specific digits (`٠١٢`, `०१२`, `০১২`), 1082 symbols (`֍ ۞ ৳ ㍿ 〷`),
 * 180 punctuation marks (`։ ־ ، ؛ ؟ । ॥ ๏`) and — the dangerous ones — 9
 * invisible format/control characters, including U+061C ARABIC LETTER MARK (a
 * bidi control usable to visually reorder a name) and U+180E MONGOLIAN VOWEL
 * SEPARATOR. Excluding non-letters here is what makes the documented policy
 * ("digits, hyphens, dots, symbols are removed") true for NON-ASCII input too,
 * not just ASCII.
 */
const SCRIPT_EXTENSIONS_ALLOWLIST =
  '\\p{scx=Latin}\\p{scx=Greek}\\p{scx=Cyrillic}\\p{scx=Armenian}' +
  '\\p{scx=Hebrew}\\p{scx=Arabic}\\p{scx=Thaana}\\p{scx=Devanagari}' +
  '\\p{scx=Bengali}\\p{scx=Gurmukhi}\\p{scx=Gujarati}\\p{scx=Oriya}' +
  '\\p{scx=Tamil}\\p{scx=Telugu}\\p{scx=Kannada}\\p{scx=Malayalam}' +
  '\\p{scx=Sinhala}\\p{scx=Thai}\\p{scx=Lao}\\p{scx=Tibetan}' +
  '\\p{scx=Myanmar}\\p{scx=Georgian}\\p{scx=Hangul}\\p{scx=Ethiopic}' +
  '\\p{scx=Cherokee}\\p{scx=Khmer}\\p{scx=Mongolian}\\p{scx=Hiragana}' +
  '\\p{scx=Katakana}\\p{scx=Bopomofo}\\p{scx=Han}';

/** Combining marks / accents (General_Category M, e.g. the acute in "é"). */
const COMBINING_MARKS = '\\p{M}';

/**
 * Unicode space separators (General_Category Zs: ASCII space, NBSP, ideographic
 * space, …) — but NOT control whitespace (tab/newline/CR), which breaks layout
 * or enables multi-line spoofing.
 */
const SPACE_SEPARATORS = '\\p{Zs}';

/**
 * Letters of ANY script (General_Category L). Used for TWO purposes: as the
 * intersection operand that reduces {@link SCRIPT_EXTENSIONS_ALLOWLIST} to just
 * its letters, and — emitted on its own — in the orphaned-mark lookbehind, where
 * it is intentionally broad so a combining mark riding on an allowlisted base
 * letter is preserved.
 */
const LETTERS = '\\p{L}';

/**
 * Code points that Unicode classifies as LETTERS of an allowlisted script, but
 * that function as standalone hate SYMBOLS in real use. They are subtracted from
 * the allowlist after the {@link LETTERS} intersection.
 *
 * WHY A DENYLIST IS NEEDED AT ALL
 * -------------------------------
 * Every other lever in this policy is a CLASS of characters — a script, a
 * General_Category. Those levers cannot reach these code points, because a
 * character policy classifies FORM, never MEANING: to Unicode, `卐` U+5350 is
 * General_Category Lo with Script_Extensions Han, i.e. byte-for-byte the same
 * kind of thing as `山` in `山田太郎`. No script-level or category-level rule can
 * separate them. The only rules that would exclude these two would also exclude
 * Han itself — rejecting every real Chinese, Japanese and Korean name — so the
 * exclusion has to be enumerated per code point. That is the entire reason this
 * list exists, and the reason it must stay SHORT: each entry is a hand-made
 * judgement that a specific character is not a name character, and nothing about
 * it generalizes.
 *
 * WHAT DOES NOT BELONG HERE
 * -------------------------
 * Anything an existing lever already rejects. The Tibetan svasti signs U+0FD5–
 * U+0FD8 are the instructive case: they LOOK like the entries below, but they
 * are General_Category So (symbols), so the `scripts ∩ General_Category L`
 * intersection already excludes them and adding them here would be dead weight
 * that reads as load-bearing. The generator ENFORCES this: it fails if any entry
 * below is already excluded by the intersection (see the assertions after
 * transpilation), so a redundant entry cannot be added silently.
 *
 * REMAINING LIMIT — this closes exactly one of the two gaps a character policy
 * has. A slur spelled in ordinary allowlisted letters (`Glowniggers`) is
 * composed entirely of characters every real name needs, so NO character-level
 * rule — allowlist, intersection, or denylist — can reject it. That requires a
 * word-level moderation layer, which is deliberately NOT attempted here.
 *
 * Entries are emitted sorted by code point, so authoring order here cannot
 * change the generated file.
 */
const SYMBOL_LETTER_DENYLIST = [
  {
    codePoint: 0x5350,
    char: '卐',
    name: 'CJK UNIFIED IDEOGRAPH-5350',
    why:
      'Right-facing swastika. General_Category Lo, Script_Extensions Han, so it ' +
      'is admitted by the Han allowlist exactly like any ordinary ideograph. ' +
      'Observed in production as decoration flanking a racial slur.',
  },
  {
    codePoint: 0x534d,
    char: '卍',
    name: 'CJK UNIFIED IDEOGRAPH-534D',
    why:
      'Left-facing swastika, the mirrored counterpart of U+5350 and the same ' +
      'category/script situation. Denied together with it so the pair cannot be ' +
      'trivially substituted for one another.',
  },
];

/**
 * The denylist as a character-class body of explicit `\u{…}` code-point escapes
 * (never property escapes), sorted ascending so the emitted output is
 * independent of the authoring order above.
 */
const SYMBOL_LETTER_DENYLIST_BODY = [...SYMBOL_LETTER_DENYLIST]
  .sort((a, b) => a.codePoint - b.codePoint)
  .map(({ codePoint }) => `\\u{${codePoint.toString(16).toUpperCase()}}`)
  .join('');

/* ------------------------------------------------------------------ *
 * Transpile with regexpu-core (property escapes only; keep `u`).     *
 * ------------------------------------------------------------------ */

/**
 * `unicodeSetsFlag: 'transform'` lowers `v`-mode set operations (used for the
 * `&&` intersection and the `--` difference) back to a plain `u`-mode class. It
 * is inert for the `u`-mode calls, so one options object serves both.
 */
const REGEXPU_OPTS = {
  unicodePropertyEscapes: 'transform',
  unicodeSetsFlag: 'transform',
};

/**
 * Transpile a character-class BODY of property escapes into an equivalent body
 * of explicit ranges, via regexpu-core, keeping `u`-mode. We wrap the body in a
 * positive class, transpile, and strip the outer `[]`. The result contains only
 * `\x…`/`\u…`/`\u{…}` escapes and range hyphens — zero property escapes — and is
 * interpolated straight into the larger classes in `validationUtils.ts`.
 *
 * With `intersectWith` and/or `subtract`, the body is emitted as the `v`-mode
 * set expression `[[[body]&&[intersectWith]]--[subtract]]` instead. `v` is used
 * ONLY as the authoring notation for the set algebra: regexpu lowers it to the
 * same single `u`-mode class of explicit ranges, so nothing `v`-specific reaches
 * the shipped regex (Hermes never sees a `v` flag, and neither does V8). The
 * result is asserted below to compile both as a positive class and — the shape
 * `DISPLAY_NAME_DISALLOWED_SOURCE` actually uses — as a NEGATED one.
 *
 * Applying the difference HERE, at generation time, rather than as a second
 * runtime probe, is what makes the denylist unforgeable downstream: the denied
 * code points are absent from the one emitted allowlist, so every consumer of
 * the policy — the core reject gate AND the `@oxyhq/api` strip path, which both
 * build from `DISPLAY_NAME_DISALLOWED_SOURCE` — enforces it without knowing it
 * exists. There is no second pattern for a caller to forget.
 *
 * @param {string} body character-class body containing property escapes
 * @param {{ intersectWith?: string, subtract?: string }} [operands] set-algebra operands
 * @returns {string}
 */
function transpileClassBody(body, operands = {}) {
  const { intersectWith, subtract } = operands;
  let pattern = `[${body}]`;
  if (intersectWith) {
    pattern = `[${pattern}&&[${intersectWith}]]`;
  }
  if (subtract) {
    pattern = `[${pattern}--[${subtract}]]`;
  }
  const useSets = Boolean(intersectWith || subtract);
  const out = rewritePattern(pattern, useSets ? 'v' : 'u', REGEXPU_OPTS);
  if (!out.startsWith('[') || !out.endsWith(']')) {
    throw new Error(
      `regexpu-core did not return a single class for [${body.slice(0, 24)}…]: ${out.slice(0, 48)}`
    );
  }
  const inner = out.slice(1, -1);
  if (/\\[pP]\{/.test(inner)) {
    throw new Error('transpiled class body still contains a Unicode property escape');
  }
  // Must recompile in BOTH shapes the policy builds: a positive `u`-mode class,
  // and the negated class `DISPLAY_NAME_DISALLOWED_SOURCE` interpolates it into.
  new RegExp(`[${inner}]`, 'u');
  new RegExp(`[^${inner}]`, 'u');
  return inner;
}

const allowedScripts = transpileClassBody(SCRIPT_EXTENSIONS_ALLOWLIST, {
  intersectWith: LETTERS,
  subtract: SYMBOL_LETTER_DENYLIST_BODY,
});
const combiningMarks = transpileClassBody(COMBINING_MARKS);
const spaceSeparators = transpileClassBody(SPACE_SEPARATORS);
const letters = transpileClassBody(LETTERS);
const deniedSymbolLetters = transpileClassBody(SYMBOL_LETTER_DENYLIST_BODY);

/**
 * The allowlist WITHOUT the denylist subtracted. Never emitted — it exists only
 * so the assertions below can prove each denylist entry is load-bearing.
 */
const allowedScriptsBeforeDenylist = transpileClassBody(SCRIPT_EXTENSIONS_ALLOWLIST, {
  intersectWith: LETTERS,
});

/*
 * The whole point of the intersection: every code point the allowlist admits
 * must be a letter. Verified across the FULL code-point space rather than on a
 * sample, because a single leaked bidi control (U+061C) is a spoofing vector.
 * The floor guards against the opposite failure — an intersection that silently
 * produced an empty or near-empty set would otherwise "pass" this check.
 */
const allowedProbe = new RegExp(`[${allowedScripts}]`, 'u');
const letterProbe = new RegExp(`[${letters}]`, 'u');
let allowedCount = 0;
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp);
  if (!allowedProbe.test(ch)) continue;
  allowedCount++;
  if (!letterProbe.test(ch)) {
    throw new Error(
      `allowlist admits non-letter U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
    );
  }
}
if (allowedCount < 100_000) {
  throw new Error(`allowlist collapsed to ${allowedCount} code points — expected >100k`);
}

/*
 * Denylist assertions. Two directions, because each catches a different mistake:
 *
 *   1. Every denied code point must be GONE from the emitted allowlist — the
 *      subtraction actually happened.
 *   2. Every denied code point must have been PRESENT before the subtraction —
 *      the entry is load-bearing. This is what keeps the list honest: a
 *      character an existing lever already rejects (the Tibetan svasti signs
 *      U+0FD5–U+0FD8, General_Category So, already dropped by the
 *      `scripts ∩ General_Category L` intersection) fails here instead of
 *      silently joining a list that readers will assume is all load-bearing.
 */
const beforeDenylistProbe = new RegExp(`[${allowedScriptsBeforeDenylist}]`, 'u');
const deniedProbe = new RegExp(`[${deniedSymbolLetters}]`, 'u');
for (const { codePoint, char, name } of SYMBOL_LETTER_DENYLIST) {
  const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ${char} (${name})`;
  const ch = String.fromCodePoint(codePoint);
  if (allowedProbe.test(ch)) {
    throw new Error(`denylist entry ${label} is still admitted by the emitted allowlist`);
  }
  if (!beforeDenylistProbe.test(ch)) {
    throw new Error(
      `denylist entry ${label} is redundant: the scripts ∩ General_Category L ` +
        'intersection already excludes it, so denying it adds nothing. Remove it.'
    );
  }
  if (!deniedProbe.test(ch)) {
    throw new Error(`denylist entry ${label} is missing from the emitted denylist class`);
  }
}

/**
 * Emit a class-body string as a single-quoted TS string literal, escaping
 * backslashes (the bodies are ASCII escape sequences like `\xA0`, `\u{20000}`)
 * so the literal reproduces them verbatim.
 *
 * @param {string} body
 */
function toStringLiteral(body) {
  return `'${body.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const header = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Explicit Unicode code-point ranges for the display-name character policy,
 * transpiled from the readable Script_Extensions / General_Category allowlist in
 * \`scripts/generateDisplayNamePolicyRanges.mjs\` with regexpu-core (the same
 * transform Babel uses to lower Unicode property escapes for Hermes targets).
 *
 * Each export is a character-class BODY (no surrounding \`[]\`) using only
 * \`\\x…\`/\`\\u…\`/\`\\u{…}\` code-point escapes — and ZERO Unicode property
 * escapes — so the regexes built from them in \`validationUtils.ts\` run
 * identically on V8 (web) and Hermes (React Native), whose engine has Unicode
 * property escapes compiled OUT. A bare property escape at module load throws
 * "Invalid RegExp: Invalid property name" and crashes every Oxy RN/Expo app at
 * boot. The transpiled ranges are the exact same match set as the property
 * escapes, verified across the full code-point space.
 *
 * Classes captured (regexpu-core, u-mode):
 *   - DISPLAY_NAME_ALLOWED_SCRIPTS_RANGES: the 30-script Script_Extensions
 *     allowlist (scx=Latin, scx=Greek, … scx=Han) INTERSECTED with
 *     General_Category L, MINUS an explicit code-point denylist. The
 *     intersection is load-bearing: \`scx=X\` also carries script X's digits,
 *     punctuation and symbols, so without it the class admitted 1831 non-letter
 *     code points — script digits, 1082 symbols, and 9 invisible format/control
 *     characters including the U+061C bidi control. The generator fails if any
 *     non-letter survives. The denylist covers the opposite case: code points
 *     that ARE letters of an allowlisted script yet function as hate symbols
 *     (${SYMBOL_LETTER_DENYLIST.map((e) => e.char).join(' ')}) — no script-level or category-level rule can exclude
 *     them without also rejecting every real Chinese, Japanese and Korean name.
 *   - DISPLAY_NAME_DENIED_SYMBOL_LETTERS_RANGES: that denylist on its own. NOT
 *     used to build any runtime regex — the code points are already subtracted
 *     from the allowlist above, so the policy enforces them with no extra probe.
 *     It is emitted so tests can enumerate what is denied and assert each entry
 *     is actually rejected.
 *   - DISPLAY_NAME_COMBINING_MARKS_RANGES: General_Category M (combining marks).
 *   - DISPLAY_NAME_SPACE_SEPARATORS_RANGES: General_Category Zs (space
 *     separators).
 *   - DISPLAY_NAME_LETTERS_RANGES: General_Category L (letters of any script;
 *     used only in the orphaned-combining-mark lookbehind).
 *
 * REGENERATE: cd packages/core && bun run generate:display-name-policy
 */
`;

const contents = `${header}
export const DISPLAY_NAME_ALLOWED_SCRIPTS_RANGES =
  ${toStringLiteral(allowedScripts)};

export const DISPLAY_NAME_COMBINING_MARKS_RANGES =
  ${toStringLiteral(combiningMarks)};

export const DISPLAY_NAME_SPACE_SEPARATORS_RANGES =
  ${toStringLiteral(spaceSeparators)};

export const DISPLAY_NAME_LETTERS_RANGES =
  ${toStringLiteral(letters)};

export const DISPLAY_NAME_DENIED_SYMBOL_LETTERS_RANGES =
  ${toStringLiteral(deniedSymbolLetters)};
`;

// Defensive: the whole point is a property-escape-free output.
if (/\\[pP]\{/.test(contents)) {
  throw new Error('Generated file still contains a Unicode property escape');
}

writeFileSync(OUT_PATH, contents);

console.log(`Wrote ${OUT_PATH}`);
console.log(
  `  allowed scripts: ${allowedScripts.length} chars / ${allowedCount} code points ` +
    `(all letters), marks: ${combiningMarks.length}, ` +
    `spaces: ${spaceSeparators.length}, letters: ${letters.length} (regexpu-core)`
);
console.log(
  `  denied symbol letters: ${SYMBOL_LETTER_DENYLIST.map(
    ({ codePoint, char }) => `U+${codePoint.toString(16).toUpperCase()} ${char}`
  ).join(', ')}`
);

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
 * Only re-run when the allowlisted script set or the regexpu-core version bumps.
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
 * Letters of ANY script (General_Category L). Used ONLY in the orphaned-mark
 * lookbehind — intentionally broad so a combining mark riding on an allowlisted
 * base letter is preserved.
 */
const LETTERS = '\\p{L}';

/* ------------------------------------------------------------------ *
 * Transpile with regexpu-core (property escapes only; keep `u`).     *
 * ------------------------------------------------------------------ */

const REGEXPU_OPTS = { unicodePropertyEscapes: 'transform' };

/**
 * Transpile a character-class BODY of property escapes into an equivalent body
 * of explicit ranges, via regexpu-core, keeping `u`-mode. We wrap the body in a
 * positive class, transpile, and strip the outer `[]`. The result contains only
 * `\x…`/`\u…`/`\u{…}` escapes and range hyphens — zero property escapes — and is
 * interpolated straight into the larger classes in `validationUtils.ts`.
 *
 * @param {string} body character-class body containing property escapes
 * @returns {string}
 */
function transpileClassBody(body) {
  const out = rewritePattern(`[${body}]`, 'u', REGEXPU_OPTS);
  if (!out.startsWith('[') || !out.endsWith(']')) {
    throw new Error(
      `regexpu-core did not return a single class for [${body.slice(0, 24)}…]: ${out.slice(0, 48)}`
    );
  }
  const inner = out.slice(1, -1);
  if (/\\[pP]\{/.test(inner)) {
    throw new Error('transpiled class body still contains a Unicode property escape');
  }
  // Must recompile as a `u`-mode class (the shape production uses).
  new RegExp(`[${inner}]`, 'u');
  return inner;
}

const allowedScripts = transpileClassBody(SCRIPT_EXTENSIONS_ALLOWLIST);
const combiningMarks = transpileClassBody(COMBINING_MARKS);
const spaceSeparators = transpileClassBody(SPACE_SEPARATORS);
const letters = transpileClassBody(LETTERS);

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
 *     allowlist (scx=Latin, scx=Greek, … scx=Han).
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
`;

// Defensive: the whole point is a property-escape-free output.
if (/\\[pP]\{/.test(contents)) {
  throw new Error('Generated file still contains a Unicode property escape');
}

writeFileSync(OUT_PATH, contents);

console.log(`Wrote ${OUT_PATH}`);
console.log(
  `  allowed scripts: ${allowedScripts.length} chars, ` +
    `marks: ${combiningMarks.length}, spaces: ${spaceSeparators.length}, ` +
    `letters: ${letters.length} (regexpu-core)`
);

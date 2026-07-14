/**
 * Username policy — THE ENFORCED ONE, for the API's write paths.
 *
 * A username is a HANDLE, not prose: it is the routing key of a profile URL
 * (`/@alice`), a webfinger `acct:` local part, and a login identifier. It
 * therefore cannot contain whitespace of any kind — a name like `"al ice"` would
 * break URL routing, and a trailing NBSP would produce two accounts that look
 * identical to a human.
 *
 * The pattern (3–30 ASCII alphanumerics) was already enforced by the signup and
 * public-key registration controllers, each with its own copy of the regex. It
 * now lives here so every write path — signup, registration, the availability
 * check, and `PUT /users/me` — validates against the SAME rule.
 *
 * WHERE THE OTHER TWO LIVE (this file is NOT the ecosystem-wide source of truth,
 * it is the SERVER-SIDE one — the only one that decides what gets stored):
 *
 *   - `@oxyhq/core` `utils/validationUtils.ts` — `/^[a-zA-Z0-9_-]{3,30}$/`. Also
 *     admits `_` and `-`. It is the SDK's client-side pre-check; a value it
 *     accepts can still be rejected here, and this rule is the one that wins.
 *   - `@oxyhq/commons` `utils/auth/usernameUtils.ts` — `/^[a-z0-9]+$/i` plus a
 *     `USERNAME_MIN_LENGTH` bound, used by the signup UI's suggestion/validation
 *     helpers.
 *
 * Loosening any of the three without the others produces a username that a client
 * accepts and the server 400s (or worse, the reverse). Change this one first.
 */

import { normalizeInlineText } from '@oxyhq/core';

/** 3–30 ASCII letters/digits. No whitespace, no punctuation, no separators. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9]{3,30}$/;

/** The 400 message returned by every path that rejects a malformed username. */
export const INVALID_USERNAME_MESSAGE =
  'Username must be 3-30 characters and contain only letters and numbers';

/**
 * Canonicalize a submitted username before it is validated, compared, or stored.
 *
 * Uses the canonical single-line normalizer: NFC + whitespace collapse + trim.
 * Interior whitespace is NOT silently removed — it collapses to a space, which
 * {@link USERNAME_PATTERN} then rejects. Silently squashing `"al ice"` into
 * `"alice"` would hand the user an account under a name they never chose.
 */
export function normalizeUsername(raw: string): string {
  return normalizeInlineText(raw);
}

/**
 * AuthManager — public types for the multi-account cookie path.
 *
 * Lives in its own module (rather than the 670-line `models/interfaces.ts`)
 * so consumers can `import type` exactly the multi-account surface without
 * pulling in the full interfaces graph, and so `AuthManager.ts` stays
 * decoupled from the wire shapes — these types re-state the wire as the
 * AuthManager's in-memory representation.
 *
 * @module core/AuthManagerTypes
 */

import type { RefreshAllAccountUser } from './models/interfaces';

/**
 * One device-local account known to `AuthManager` in the cookie path.
 *
 * Built from a `POST /auth/refresh-all` entry, OR from a single
 * `POST /auth/refresh?authuser=N` rotation after a switch, OR from a
 * `handleAuthSuccess` call after a fresh login. The `accessToken` is held in
 * memory only — the refresh token never enters JS (it lives in the httpOnly
 * `oxy_rt_${authuser}` cookie).
 */
export interface AuthManagerAccount {
  /** Device-local cookie slot index (0..N-1). */
  authuser: number;
  /** Server-side session id this slot is bound to. */
  sessionId: string;
  /**
   * Projected user shape from the wire (username/avatar/color/email).
   *
   * `null` when a refresh-via-cookie planted a fresh access token for a slot
   * that the AuthManager has no prior in-memory user metadata for — e.g. the
   * legacy `/auth/refresh` 404 fallback path inside `refreshAllSessions`, or
   * a `switchAuthuser` against a slot that wasn't present in the previous
   * `restoreFromCookies` snapshot. Callers (or the AuthManager itself) are
   * expected to hydrate the user shape via `getCurrentUser()` after the token
   * is planted; the chooser UI must render the public-key fallback handle
   * until the hydration completes.
   */
  user: RefreshAllAccountUser | null;
  /** Currently-valid access token for this slot (in-memory only). */
  accessToken: string;
  /** ISO-8601 expiry of the access token. */
  expiresAt: string;
}

/**
 * Outcome of `AuthManager.restoreFromCookies()`.
 *
 * `accounts` is sorted by `authuser` ascending (matching the server's
 * canonical ordering). `activeAuthuser` is whichever slot the AuthManager
 * picked as active — usually the persisted `oxy_active_authuser` if it
 * matched a returned slot, otherwise the lowest returned `authuser`, or
 * `null` if no accounts were restored.
 */
export interface RestoreFromCookiesResult {
  accounts: AuthManagerAccount[];
  activeAuthuser: number | null;
}

/**
 * Options for `AuthManager.restoreFromCookies()` / `AuthManager.initialize()`.
 */
export interface RestoreFromCookiesOptions {
  /**
   * Abort the underlying `POST /auth/refresh-all` after this many milliseconds
   * and treat it as "no signed-in accounts" instead of hanging. Forwarded
   * verbatim to `OxyServices.refreshAllSessions({ timeout })`.
   *
   * Intended for the cold-boot cookie-restore step on a cross-domain RP, where
   * the `Domain=oxy.so` refresh cookie never reaches `api.<apex>` and the
   * request can stall with no useful answer. Omit (the default) to wait
   * indefinitely — the warm cross-tab cascade path passes nothing, preserving
   * its existing behaviour.
   */
  timeout?: number;
}

/**
 * Outcome of `AuthManager.switchAuthuser()`.
 *
 * Mirrors the wire `RefreshCookieResponse` but with `authuser` narrowed to
 * `number` (the SDK boundary normalises the legacy `null` slot to `0`).
 */
export interface SwitchAuthuserResult {
  accessToken: string;
  expiresAt: string;
  authuser: number;
}

/**
 * Silent, no-reload session-restore PRIMITIVES — the single shared
 * implementation used by BOTH cold boot (`OxyContext.restoreSessionsFromStorage`)
 * and in-session token refresh (`createInSessionRefreshHandler`). Neither caller
 * re-implements these; they compose them. Keeping one home avoids the two paths
 * drifting on "how do we mint a first-party token without a page reload".
 *
 * Each function is platform-agnostic at the type level and returns plain data;
 * the callers own the side effects that differ between them (cold boot COMMITS
 * the recovered session into provider state; refresh only reads the freshly
 * planted bearer).
 */
import type { OxyServices, SessionLoginResponse } from '@oxyhq/core';
import { autoDetectAuthWebUrl } from '@oxyhq/core';

/**
 * Mint a fresh first-party session via the PER-APEX `/auth/silent` iframe — the
 * durable cross-domain restore path that works WITHOUT a top-level navigation
 * (so it succeeds under Safari ITP / Firefox TCP and in a backgrounded tab).
 *
 * The instance is configured with the CENTRAL auth URL, so we explicitly point
 * the iframe at the per-apex host (`auth.<rp-apex>`) via `autoDetectAuthWebUrl()`
 * + `silentSignIn`'s `authWebUrlOverride`. On a `*.oxy.so` app the per-apex host
 * IS the central host, so this also covers same-apex. When auto-detection bails
 * (localhost / IP / single-label / off-browser) there is no per-apex IdP and we
 * return `null`. `silentSignIn` plants the access token internally on success.
 *
 * @returns the recovered session (token already planted) when complete, else
 * `null` (no per-apex IdP, no session, or an incomplete iframe response).
 */
export async function mintSessionViaPerApexIframe(
  oxyServices: OxyServices,
  timeoutMs: number,
): Promise<SessionLoginResponse | null> {
  const perApexAuthUrl = autoDetectAuthWebUrl();
  if (!perApexAuthUrl) {
    return null;
  }
  const session = await oxyServices.silentSignIn?.({
    authWebUrlOverride: perApexAuthUrl,
    timeout: timeoutMs,
  });
  if (!session?.user || !session.sessionId) {
    return null;
  }
  return session;
}

/**
 * Pick the active account from a `refreshAllSessions` snapshot: the persisted
 * `authuser` slot when it still matches a returned account, otherwise the lowest
 * `authuser` (the server sorts ascending, so `[0]`). Callers guarantee a
 * non-empty list, so the result is always defined.
 *
 * Shared by cold-boot cookie restore and the in-session refresh cookie arm so
 * the active-slot selection can never diverge between them.
 */
export function selectActiveRefreshAccount<T extends { authuser: number }>(
  accounts: T[],
  persistedAuthuser: number | null,
): T {
  const matched =
    persistedAuthuser !== null
      ? accounts.find((account) => account.authuser === persistedAuthuser)
      : undefined;
  return matched ?? accounts[0];
}

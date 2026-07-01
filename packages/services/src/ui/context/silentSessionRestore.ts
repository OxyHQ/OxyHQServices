/**
 * Silent, no-reload session-restore PRIMITIVE — the single shared
 * implementation used by BOTH cold boot (`OxyContext.restoreSessionsFromStorage`)
 * and in-session token refresh (`createInSessionRefreshHandler`). Neither caller
 * re-implements it; they compose it. Keeping one home avoids the two paths
 * drifting on "how do we mint a first-party token without a page reload".
 *
 * Platform-agnostic at the type level and returns plain data; the callers own
 * the side effects that differ between them (cold boot COMMITS the recovered
 * session into provider state; refresh only reads the freshly planted bearer).
 *
 * NOTE (session-sync cutover, Task 5): this file used to also export
 * `selectActiveRefreshAccount`, which picked the active account out of a
 * `refreshAllSessions` (`oxy_rt` refresh-cookie) snapshot. Deleted — its only
 * caller was the in-session refresh handler's now-deleted `refresh-cookie`
 * arm. The device account SET is server-authoritative via `SessionClient`
 * (`@oxyhq/core`) now.
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

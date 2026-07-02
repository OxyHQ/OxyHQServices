import type { DeviceSessionState } from '@oxyhq/contracts';
import type { OxyServices, TokenTransport } from '@oxyhq/core';
import { logger } from '@oxyhq/core';

/**
 * Web-only `TokenTransport` for `SessionClient` (`@oxyhq/auth`'s
 * `WebOxyProvider`).
 *
 * Mints an access token when none is currently held, reusing the SAME
 * primitive the provider's cold boot already relies on for silent restore:
 * `oxyServices.silentSignIn()` (first-party `/auth/silent` per-apex iframe).
 * There is deliberately NO native branch here — `@oxyhq/auth`
 * must never import `react-native`/`expo-*`, and `WebOxyProvider` is web-only
 * by construction. This mirrors
 * `packages/services/src/ui/session/tokenTransport.ts`'s `createTokenTransport`
 * minus its native `signInWithSharedIdentity()` branch.
 *
 * `silentSignIn()` plants the token internally on success (the "Sign-In Token
 * Planting" rule) — `ensureActiveToken` never calls `setTokens` itself.
 *
 * A failed mint is logged and swallowed: it must never throw out of
 * `ensureActiveToken`, since that would crash the caller (`SessionClient`'s
 * state-apply / socket handler).
 */
export function createWebTokenTransport(oxyServices: OxyServices): TokenTransport {
  // Coalesces concurrent mints: `SessionClient.applyState` can fire
  // `ensureActiveToken` on rapid successive state pushes; a second call while a
  // mint is already in flight must reuse it, not spawn a second silent-sign-in
  // round-trip.
  let inFlightMint: Promise<void> | null = null;

  return {
    async ensureActiveToken(state: DeviceSessionState): Promise<void> {
      // Read the current token defensively: it is an in-memory getter that
      // should never throw, but the documented contract is that this method
      // never throws out — so a surprising throw is logged and treated as "no
      // token" (fall through to mint) rather than rejecting the promise.
      try {
        if (oxyServices.getAccessToken()) {
          return;
        }
      } catch (error) {
        logger.warn('ensureActiveToken: getAccessToken threw', { component: 'WebTokenTransport' }, error);
      }

      if (inFlightMint) {
        return inFlightMint;
      }

      inFlightMint = (async () => {
        try {
          const session = await oxyServices.silentSignIn();
          if (!session) {
            logger.debug('ensureActiveToken: silent sign-in returned no session', {
              component: 'WebTokenTransport',
              deviceId: state.deviceId,
            });
          }
        } catch (error) {
          logger.warn('ensureActiveToken: silent sign-in failed', { component: 'WebTokenTransport' }, error);
        }
      })();

      try {
        await inFlightMint;
      } finally {
        inFlightMint = null;
      }
    },
  };
}

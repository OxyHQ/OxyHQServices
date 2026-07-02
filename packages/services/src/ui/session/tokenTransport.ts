import type { DeviceSessionState } from '@oxyhq/contracts';
import type { OxyServices, TokenTransport } from '@oxyhq/core';
import { logger } from '@oxyhq/core';
import { isWebBrowser } from '../hooks/useWebSSO';

/**
 * Platform `TokenTransport` for `SessionClient`: mints an access token when
 * none is currently held, reusing the SAME primitives `OxyContext`'s cold
 * boot already relies on (never re-implemented here):
 *
 * - web: `oxyServices.silentSignIn()` (per-apex iframe / FedCM silent).
 * - native: `oxyServices.signInWithSharedIdentity()` (app-group keychain).
 *
 * Both primitives plant the token internally on success (the "Sign-In Token
 * Planting" rule) — `ensureActiveToken` never calls `setTokens` itself.
 *
 * `ensureActiveToken` treats a PRESENT token as sufficient in this phase; it
 * does not decode/match the token's subject against `state.activeAccountId`
 * (that refinement is Fase 3-B). Account switching itself is server-driven
 * via the `activeToken` carried in the sync envelope — this transport is
 * only the fallback used when the envelope carried no token.
 *
 * A failed mint is logged and swallowed: it must never throw out of
 * `ensureActiveToken`, since that would crash the caller (the SessionClient
 * socket handler in Fase 3-B).
 */
export function createTokenTransport(oxyServices: OxyServices): TokenTransport {
  // Coalesces concurrent mints: `SessionClient.applyState` can fire
  // `ensureActiveToken` on rapid successive state pushes; a second call while a
  // mint is already in flight must reuse it, not spawn a second silent iframe /
  // shared-key challenge round-trip.
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
        logger.warn('ensureActiveToken: getAccessToken threw', { component: 'TokenTransport' }, error);
      }

      if (inFlightMint) {
        return inFlightMint;
      }

      inFlightMint = (async () => {
        try {
          const session = isWebBrowser()
            ? await oxyServices.silentSignIn()
            : await oxyServices.signInWithSharedIdentity();

          if (!session) {
            logger.debug('ensureActiveToken: platform mint returned no session', {
              component: 'TokenTransport',
              deviceId: state.deviceId,
            });
          }
        } catch (error) {
          logger.warn('ensureActiveToken: mint failed', { component: 'TokenTransport' }, error);
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

import {
  refreshPersistedSession,
  logger,
  type AuthStateStore,
  type OxyServices,
  type TokenTransport,
} from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

/**
 * Platform `TokenTransport` for `SessionClient` (device-first model).
 *
 * `ensureActiveToken` is the fallback the client uses when a `session_state`
 * push arrived WITHOUT an embedded `activeToken` and the app currently holds no
 * bearer. It mints one through the ONE unified refresh path
 * (`refreshPersistedSession`): rotate the persisted refresh-token family
 * (`POST /auth/refresh-token`) and, on native, fall back to the shared-keychain
 * re-mint. There is no FedCM/silent-iframe arm anymore — the per-origin
 * persisted refresh token is the durable web credential.
 *
 * Concurrent pushes coalesce onto one in-flight mint. A failure is logged and
 * swallowed: this method must never throw out (it runs inside the socket state
 * handler).
 */
export function createTokenTransport(
  oxyServices: OxyServices,
  store: AuthStateStore,
): TokenTransport {
  let inFlightMint: Promise<void> | null = null;

  return {
    async ensureActiveToken(state: DeviceSessionState): Promise<void> {
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
          const token = await refreshPersistedSession({ oxy: oxyServices, store });
          if (!token) {
            logger.debug('ensureActiveToken: refresh produced no session', {
              component: 'TokenTransport',
              deviceId: state.deviceId,
            });
          }
        } catch (error) {
          logger.warn('ensureActiveToken: refresh failed', { component: 'TokenTransport' }, error);
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

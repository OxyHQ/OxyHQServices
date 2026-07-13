import { logger, type OxyServices, type TokenTransport } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

/**
 * Platform `TokenTransport` for `SessionClient` (device-first model).
 *
 * `ensureActiveToken` is the fallback the client uses when a `session_state`
 * push arrived WITHOUT an embedded `activeToken` and the app currently holds no
 * bearer. It mints one through the ONE unified single-flight the scheduler, the
 * request-time preflight, and the 401 retry all use —
 * `oxyServices.httpService.refreshAccessToken(...)` — which runs the installed
 * refresh handler (present the persisted zero-cookie `deviceId` + `deviceSecret`
 * at `POST /session/device/token`). Routing through the SAME entry point means
 * this lane can never double-rotate the device secret against the others: it has
 * NO private single-flight of its own.
 *
 * A failure is logged and swallowed: this method must never throw out (it runs
 * inside the socket state handler).
 */
export function createTokenTransport(oxyServices: OxyServices): TokenTransport {
  return {
    async ensureActiveToken(state: DeviceSessionState): Promise<void> {
      try {
        if (oxyServices.getAccessToken()) {
          return;
        }
      } catch (error) {
        logger.warn('ensureActiveToken: getAccessToken threw', { component: 'TokenTransport' }, error);
      }

      try {
        // The shared HttpService single-flight coalesces concurrent callers onto
        // one in-flight mint; no local `inFlightMint` guard is needed.
        const token = await oxyServices.httpService.refreshAccessToken('preflight');
        if (!token) {
          logger.debug('ensureActiveToken: refresh produced no session', {
            component: 'TokenTransport',
            deviceId: state.deviceId,
          });
        }
      } catch (error) {
        logger.warn('ensureActiveToken: refresh failed', { component: 'TokenTransport' }, error);
      }
    },
  };
}

/**
 * Device-first token mint mixin.
 *
 * The client half of the zero-cookie device transport: the single network call
 * the cold boot (`sessionColdBoot`) and the unified re-mint handler (`refresh.ts`)
 * make to turn a first-party `deviceId` + `deviceSecret` into a fresh access
 * token. The response is validated against the `@oxyhq/contracts`
 * `deviceTokenMintResponseSchema`, so producer (oxy-api) and consumer cannot
 * drift — an unexpected shape throws here rather than silently corrupting the
 * persisted store.
 *
 * This method carries NO persistence or token-planting side effects of its own;
 * the cold boot / re-mint handler own persistence and `setTokens`, so the same
 * primitive can be reused from either without double-planting.
 */
import {
  deviceTokenMintResponseSchema,
  deviceHubTicketIssueResponseSchema,
  deviceHubTicketRedeemResponseSchema,
  safeParseContract,
  type DeviceTokenMintResponse,
  type DeviceHubTicketIssueResponse,
  type DeviceHubTicketRedeemResponse,
} from '@oxyhq/contracts';
import type { OxyServicesBase } from '../OxyServices.base';

export function OxyServicesDeviceBootMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    /**
     * Zero-cookie mint. Present the first-party `deviceId` + `deviceSecret` to
     * `POST /session/device/token` — NO bearer, NO cookies: possession of the
     * secret IS the device-ownership proof. Returns a fresh short access token
     * for the device's active account plus `nextDeviceSecret` (rotation-in-use)
     * and the projected device-session `state`.
     *
     * `skipAuth`: this call carries no bearer, so a 401 must surface DIRECTLY —
     * never trigger `HttpService`'s 401→refresh→retry dance. The cold boot / re-
     * mint handler read the 401 body (`invalid_device_secret` vs
     * `no_active_session`) to decide whether to drop the secret and fall back or
     * resolve signed-out.
     *
     * `retry: false`: the mint is a single logical attempt. The proactive
     * token-refresh scheduler and the reactive 401 lane already own backoff and
     * re-arm, so `HttpService`'s inner retry loop here would only multiply the
     * mint's latency on a slow/black-hole network (3 retries × 5s timeout ≈ 20s
     * per lane) with no correctness benefit — it is the dominant term in the cold
     * boot's worst-case time-to-route. A transient failure surfaces once and the
     * scheduler/401 path retries it later.
     *
     * @throws if the response does not match {@link deviceTokenMintResponseSchema}.
     */
    async mintFromDeviceSecret(
      deviceId: string,
      deviceSecret: string,
    ): Promise<DeviceTokenMintResponse> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/session/device/token',
          { deviceId, deviceSecret },
          // `bypassQueue`: this mint is the control-plane call the auth lane
          // depends on — it must run even when every RequestQueue slot is parked
          // awaiting it, or the whole client deadlocks. See RequestOptions.bypassQueue.
          { cache: false, skipAuth: true, retry: false, bypassQueue: true },
        );
        const parsed = safeParseContract(deviceTokenMintResponseSchema, res);
        if (!parsed) {
          throw new Error('session/device/token returned an unexpected response shape');
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /** Mint a one-time hub sync ticket (bearer required). */
    async issueHubTicket(returnOrigin: string): Promise<DeviceHubTicketIssueResponse> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/session/device/hub-ticket',
          { returnOrigin },
          { cache: false },
        );
        const parsed = safeParseContract(deviceHubTicketIssueResponseSchema, res);
        if (!parsed) {
          throw new Error('session/device/hub-ticket returned an unexpected response shape');
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /** Redeem a hub sync ticket for a fresh device secret (public). */
    async redeemHubTicket(
      ticket: string,
      returnOrigin: string,
    ): Promise<DeviceHubTicketRedeemResponse> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/session/device/redeem-ticket',
          { ticket, returnOrigin },
          // Public device-hub sync mint (bearer-less). Same control-plane class as
          // the device-secret mint — bypassQueue so it never waits for a slot.
          { cache: false, skipAuth: true, bypassQueue: true },
        );
        const parsed = safeParseContract(deviceHubTicketRedeemResponseSchema, res);
        if (!parsed) {
          throw new Error('session/device/redeem-ticket returned an unexpected response shape');
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

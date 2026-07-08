/**
 * Device-first token mint mixin.
 *
 * The client half of the zero-cookie device transport: the single network call
 * the cold boot (`coldBootV2`) and the unified re-mint handler (`refresh.ts`)
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
  safeParseContract,
  type DeviceTokenMintResponse,
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
          { cache: false, skipAuth: true },
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

    /** Mint the initial device secret for a new device (hub join provisioning). */
    async provisionDevice(deviceId?: string): Promise<{ deviceId: string; deviceSecret: string }> {
      try {
        const res = await this.makeRequest<{ deviceId: string; deviceSecret: string }>(
          'POST',
          '/session/device/provision',
          deviceId ? { deviceId } : {},
          { cache: false, skipAuth: true },
        );
        if (!res?.deviceId || !res?.deviceSecret) {
          throw new Error('session/device/provision returned an unexpected response shape');
        }
        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

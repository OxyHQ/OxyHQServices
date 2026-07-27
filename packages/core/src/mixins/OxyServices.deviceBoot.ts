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

/**
 * The server's `401 account_not_on_device` for a PINNED mint: the requested
 * `accountId` is not (or is no longer) a live account of this device session.
 *
 * Distinguished from every other mint 401 because the remedy is different: the
 * device secret is FINE — it is the identity binding that went stale (the
 * account was signed out on this device, or revoked). An identity-bound caller
 * must re-establish its session from the local key rather than drop/clear the
 * device credential.
 */
export class AccountNotOnDeviceError extends Error {
  override readonly name = 'AccountNotOnDeviceError';
  /** HTTP status of the originating response; mirrors the ApiError shape. */
  readonly status = 401;
  constructor(readonly accountId: string, readonly cause?: unknown) {
    super(
      `account_not_on_device: ${accountId} is not a live account of this device session`,
    );
  }
}

/**
 * Structural (never `instanceof`) read of a normalized mint error: the thrown
 * value may be a plain ApiError-shaped object or come from another realm.
 */
function isAccountNotOnDevice(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const { status, message } = error as { status?: unknown; message?: unknown };
  if (status !== 401) {
    return false;
  }
  return typeof message === 'string' && message.includes('account_not_on_device');
}

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
     * `options.accountId` PINS the mint to one account of the device instead of
     * whichever account is currently active. It exists for identity-bound
     * clients (Commons), whose authenticated user is fixed by a local
     * cryptographic key and must never follow an account switch made by another
     * app on the same device. The server never mutates `activeAccountId` for a
     * pinned mint — the returned `state` still reports the device's true active
     * account — and rejects a non-member/dead account with
     * `401 account_not_on_device`, surfaced here as {@link AccountNotOnDeviceError}.
     *
     * @throws {AccountNotOnDeviceError} when a pinned mint's account is not on the device.
     * @throws if the response does not match {@link deviceTokenMintResponseSchema}.
     */
    async mintFromDeviceSecret(
      deviceId: string,
      deviceSecret: string,
      options?: { accountId?: string },
    ): Promise<DeviceTokenMintResponse> {
      const accountId = options?.accountId;
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/session/device/token',
          { deviceId, deviceSecret, ...(accountId ? { accountId } : {}) },
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
        const normalized = this.handleError(error);
        if (accountId && isAccountNotOnDevice(normalized)) {
          throw new AccountNotOnDeviceError(accountId, normalized);
        }
        throw normalized;
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

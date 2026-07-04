/**
 * Device-first bootstrap mixin (auth centralization, wave 1).
 *
 * The client half of the new device-first session bootstrap: the four network
 * calls the cold boot (`coldBootV2`) and the unified refresh handler
 * (`refresh.ts`) make, plus the URL builder for the cross-apex bootstrap hop.
 * Every response is validated against the `@oxyhq/contracts` `deviceBoot`
 * schemas via `safeParseContract`, so producer (oxy-api) and consumer cannot
 * drift — an unexpected shape throws here rather than silently corrupting the
 * persisted store.
 *
 * These methods are ADDITIVE and carry NO persistence or token-planting side
 * effects of their own (except the bearer-authenticated calls that naturally
 * flow through `HttpService`). The cold boot / refresh handler own persistence
 * and `setTokens`, so the same network primitive can be reused from either
 * without double-planting.
 */
import { z } from 'zod';
import {
  authTokenBundleSchema,
  tokenRefreshResponseSchema,
  deviceTokenIssueResponseSchema,
  safeParseContract,
  type AuthTokenBundle,
  type TokenRefreshResponse,
} from '@oxyhq/contracts';
import type { OxyServicesBase } from '../OxyServices.base';

/**
 * The "known device, no active session" arm of `POST /auth/device/web-session`
 * — the fast-path returns EITHER a full {@link AuthTokenBundle} (a session was
 * resolved from the same-site device cookie) OR this shape (the device is known
 * / just planted but signed out). It carries the rotated `deviceToken` to
 * persist, never any session tokens.
 */
export interface WebSessionNoSession {
  reason: 'no_session' | 'new_device';
  deviceToken: string;
}

/** The discriminated outcome of `POST /auth/device/web-session`. */
export type WebSessionResult = AuthTokenBundle | WebSessionNoSession;

const webSessionNoSessionSchema: z.ZodType<WebSessionNoSession> = z.object({
  reason: z.enum(['no_session', 'new_device']),
  deviceToken: z.string().min(1),
});

const webSessionResultSchema: z.ZodType<WebSessionResult> = z.union([
  authTokenBundleSchema,
  webSessionNoSessionSchema,
]);

/** Type guard: did the web-session fast-path resolve a full token bundle? */
export function isAuthTokenBundle(result: WebSessionResult): result is AuthTokenBundle {
  return 'accessToken' in result;
}

export function OxyServicesDeviceBootMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    /**
     * Exchange a single-use boot `code` (from the `#oxy_boot` return fragment)
     * for a token bundle. Origin-bound + GETDEL-burned server-side.
     *
     * @throws if the response does not match {@link authTokenBundleSchema}.
     */
    async exchangeBootCode(code: string): Promise<AuthTokenBundle> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/auth/device/exchange',
          { code },
          { cache: false },
        );
        const parsed = safeParseContract(authTokenBundleSchema, res);
        if (!parsed) {
          throw new Error('device/exchange returned an unexpected response shape');
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Same-site fast path (`*.oxy.so` apps). Reads the first-party `oxy_device`
     * cookie via a credentialed same-origin fetch and either resolves a full
     * session bundle or reports the device is known-but-signed-out. Never
     * redirects.
     *
     * @throws if the response matches neither arm of {@link webSessionResultSchema}.
     */
    async requestWebSession(): Promise<WebSessionResult> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/auth/device/web-session',
          undefined,
          { cache: false },
        );
        const parsed = safeParseContract(webSessionResultSchema, res);
        if (!parsed) {
          throw new Error('device/web-session returned an unexpected response shape');
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Rotate the persisted refresh-token family (web + native, one call). The
     * caller (refresh handler / cold boot) plants + persists the rotated pair.
     *
     * @throws if the response does not match {@link tokenRefreshResponseSchema}.
     */
    async refreshWithToken(refreshToken: string): Promise<TokenRefreshResponse> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/auth/refresh-token',
          { refreshToken },
          // `skipAuth`: refresh-token is body-authenticated and is called from
          // inside the refresh handler — sending the near-expired bearer through
          // the preflight would deadlock. See RequestOptions.skipAuth.
          { cache: false, skipAuth: true },
        );
        const parsed = safeParseContract(tokenRefreshResponseSchema, res);
        if (!parsed) {
          throw new Error('auth/refresh-token returned an unexpected response shape');
        }
        return parsed;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Issue (or rotate) the native channel's opaque device token. Bearer-gated —
     * the server derives the deviceId from the JWT. Native apps mirror the
     * returned token into the shared keychain via
     * `KeyManager.setSharedDeviceToken`.
     *
     * @throws if the response does not match {@link deviceTokenIssueResponseSchema}.
     */
    async issueNativeDeviceToken(): Promise<string> {
      try {
        const res = await this.makeRequest<unknown>(
          'POST',
          '/auth/device/token',
          undefined,
          { cache: false },
        );
        const parsed = safeParseContract(deviceTokenIssueResponseSchema, res);
        if (!parsed) {
          throw new Error('auth/device/token returned an unexpected response shape');
        }
        return parsed.deviceToken;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Build the top-level `GET /auth/device/bootstrap` URL for the cross-apex
     * hop. The server validates `return_to` against the trusted-origin lane and
     * echoes `state` back in the return fragment for CSRF verification.
     */
    buildBootstrapUrl(returnTo: string, state: string): string {
      const base = this.getBaseURL().replace(/\/+$/, '');
      const params = new URLSearchParams({ return_to: returnTo, state });
      return `${base}/auth/device/bootstrap?${params.toString()}`;
    }
  };
}

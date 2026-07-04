/**
 * Device-first bootstrap & token contracts (auth centralization, wave 1).
 *
 * SINGLE SOURCE OF TRUTH for the wire shape of the new device-first session
 * bootstrap: the top-level `#oxy_boot=…` fragment the API hands back from
 * `GET /auth/device/bootstrap`, the token bundle a boot code / web-session
 * fast-path exchanges into, the persisted-refresh rotation, the native
 * device-token issuance, the IdP chooser's device-resolve, and the first-party
 * password login result (2FA arm vs. session arm). The API validates its OUTPUT
 * against these schemas; every consumer (`@oxyhq/core`'s device-boot mixin, the
 * SDK cold boot, the IdP chooser) validates its INPUT against the same
 * definitions, so producer and consumers cannot drift.
 *
 * Design anchors (from the auth-centralization plan):
 *  - The bootstrap fragment carries NO tokens and NO deviceId — only a
 *    `state` echo (CSRF), a `reason`, a short-lived single-use `code`, and an
 *    opaque `deviceToken`. Tokens are obtained by exchanging the `code` at
 *    `POST /auth/device/exchange` (origin-bound GETDEL burn).
 *  - Refresh is ONE rotating, single-use family shared by web and native.
 *  - `loginResult` mirrors what `POST /auth/login` returns today
 *    (`buildSessionAuthResponse` in the API's `session.controller.ts`): either a
 *    2FA challenge (`{ twoFactorRequired: true, loginToken }`) or a session
 *    payload. The session arm matches `SessionAuthResponse` EXACTLY, plus an
 *    optional `refreshToken` the new server adds for the persisted-refresh lane.
 *
 * Nested-object response shapes are declared as explicit `interface`s with the
 * runtime schema annotated `z.ZodType<Interface>` — the same rationale as
 * `identity.ts` / `userResponse.ts`: a `z.infer<>` of a nested object schema can
 * degrade to `{}` under a consumer's `moduleResolution: "node"` (node10), so the
 * load-bearing shapes are pinned by literal interfaces. Flat request/response
 * shapes (no nested-object hazard) are inferred via `z.infer<>`.
 *
 * Platform-agnostic — zod only, no react/react-native/expo. ESM-safe (no
 * `require()`).
 */

import { z } from 'zod';
import { userResponseSchema, type UserResponse } from './userResponse';

/* -------------------------------------------------------------------------- */
/*  Bootstrap fragment                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Why the bootstrap hop resolved the way it did.
 *  - `session` — the device cookie resolved an active session; a `code` is
 *    present to exchange for tokens.
 *  - `no_session` — the device is known but has no active session; no `code`.
 *  - `new_device` — first contact; the cookie was just planted, no session yet.
 */
export const deviceBootReasonSchema = z.enum(['session', 'no_session', 'new_device']);

export type DeviceBootReason = z.infer<typeof deviceBootReasonSchema>;

/**
 * The `#oxy_boot=<json>` fragment `GET /auth/device/bootstrap` appends to the
 * `return_to` URL. Carries the CSRF `state` echo, the resolution `reason`, an
 * optional single-use exchange `code` (present iff `reason === 'session'`), and
 * the opaque `deviceToken`. NEVER carries tokens or a deviceId.
 */
export const deviceBootFragmentSchema = z.object({
    v: z.literal(1),
    state: z.string().min(1).max(256),
    reason: deviceBootReasonSchema,
    code: z.string().min(20).max(128).optional(),
    deviceToken: z.string().min(20).max(512),
});

export type DeviceBootFragment = z.infer<typeof deviceBootFragmentSchema>;

/* -------------------------------------------------------------------------- */
/*  Boot-code exchange                                                        */
/* -------------------------------------------------------------------------- */

/** Request body for `POST /auth/device/exchange` — the single-use boot code. */
export const deviceExchangeRequestSchema = z.object({
    code: z.string().min(20).max(128),
});

export type DeviceExchangeRequest = z.infer<typeof deviceExchangeRequestSchema>;

/**
 * The token bundle returned by `POST /auth/device/exchange` and
 * `POST /auth/device/web-session` — the freshly-minted access token, its
 * rotating refresh-family head, the owning `sessionId`, and the full canonical
 * user object. `expiresAt` is an ISO string.
 */
export interface AuthTokenBundle {
    sessionId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    user: UserResponse;
}

export const authTokenBundleSchema: z.ZodType<AuthTokenBundle> = z.object({
    sessionId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.string(),
    user: userResponseSchema,
});

/* -------------------------------------------------------------------------- */
/*  Refresh-token rotation (web + native, one implementation)                 */
/* -------------------------------------------------------------------------- */

/** Request body for `POST /auth/refresh-token` — the current refresh token. */
export const tokenRefreshRequestSchema = z.object({
    refreshToken: z.string().min(20),
});

export type TokenRefreshRequest = z.infer<typeof tokenRefreshRequestSchema>;

/**
 * Wire shape of `POST /auth/refresh-token`: the rotated (single-use) family —
 * a new access token, the next refresh token, the new access-token expiry, and
 * the owning session id. `expiresAt` is an ISO string.
 */
export const tokenRefreshResponseSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.string(),
    sessionId: z.string(),
});

export type TokenRefreshResponse = z.infer<typeof tokenRefreshResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Native device-token issuance                                              */
/* -------------------------------------------------------------------------- */

/**
 * Wire shape of `POST /auth/device/token` — issues (or rotates) the opaque
 * device token for the native channel. The deviceId is taken from the bearer
 * JWT claims server-side; only the token comes back.
 */
export const deviceTokenIssueResponseSchema = z.object({
    deviceToken: z.string(),
});

export type DeviceTokenIssueResponse = z.infer<typeof deviceTokenIssueResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  First-party password login result (2FA arm | session arm)                 */
/* -------------------------------------------------------------------------- */

/**
 * `POST /auth/login` when the account has 2FA enabled: a short-lived login
 * token to be presented at the 2FA challenge, and no session yet.
 */
export interface LoginTwoFactorRequired {
    twoFactorRequired: true;
    loginToken: string;
}

/**
 * `POST /auth/login` when authentication completed in one step. Matches the
 * API's `SessionAuthResponse` EXACTLY (`buildSessionAuthResponse`), plus the
 * optional `refreshToken` the persisted-refresh lane adds. `user` is the
 * truncated session-user shape the login endpoint emits (NOT the full
 * `userResponseSchema`).
 */
export interface LoginSessionResult {
    sessionId: string;
    deviceId: string;
    expiresAt: string;
    accessToken?: string;
    refreshToken?: string;
    user: {
        id: string;
        username?: string;
        avatar?: string;
    };
}

/** The discriminated outcome of `POST /auth/login`. */
export type LoginResult = LoginTwoFactorRequired | LoginSessionResult;

const loginTwoFactorRequiredSchema = z.object({
    twoFactorRequired: z.literal(true),
    loginToken: z.string(),
});

const loginSessionResultSchema = z.object({
    sessionId: z.string(),
    deviceId: z.string(),
    expiresAt: z.string(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    user: z.object({
        id: z.string(),
        username: z.string().optional(),
        avatar: z.string().optional(),
    }),
});

export const loginResultSchema: z.ZodType<LoginResult> = z.union([
    loginTwoFactorRequiredSchema,
    loginSessionResultSchema,
]);

/* -------------------------------------------------------------------------- */
/*  IdP chooser device-resolve                                                */
/* -------------------------------------------------------------------------- */

/**
 * Request body for `POST /auth/device/resolve` (X-Oxy-Internal, called by the
 * IdP chooser) — the device key the chooser read from the first-party
 * `oxy_device` cookie.
 */
export const deviceResolveRequestSchema = z.object({
    deviceKey: z.string().min(20),
});

export type DeviceResolveRequest = z.infer<typeof deviceResolveRequestSchema>;

/** One account resolved for the IdP chooser from a device's session set. */
export interface DeviceResolveAccount {
    user: UserResponse;
    sessionId: string;
    accessToken: string;
    expiresAt: string;
}

/**
 * Wire shape of `POST /auth/device/resolve` — the device's active account id
 * (or `null` when signed out of all) plus every account signed in on the
 * device. Replaces the IdP's `/auth/refresh-all` chooser feed.
 */
export interface DeviceResolveResponse {
    activeAccountId: string | null;
    accounts: DeviceResolveAccount[];
}

const deviceResolveAccountSchema: z.ZodType<DeviceResolveAccount> = z.object({
    user: userResponseSchema,
    sessionId: z.string(),
    accessToken: z.string(),
    expiresAt: z.string(),
});

export const deviceResolveResponseSchema: z.ZodType<DeviceResolveResponse> = z.object({
    activeAccountId: z.string().nullable(),
    accounts: z.array(deviceResolveAccountSchema),
});

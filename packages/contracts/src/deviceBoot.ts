/**
 * First-party login result contract.
 *
 * SINGLE SOURCE OF TRUTH for the first-party password login result (2FA arm vs.
 * session arm). The API validates its OUTPUT against this schema; every consumer
 * (`@oxyhq/core`'s auth mixin) validates its INPUT against the same definition,
 * so producer and consumers cannot drift.
 *
 * The device transport is `deviceId` + `deviceSecret` + `POST /session/device/token`
 * (see `deviceSession.ts`). The legacy cookie/bootstrap/refresh-family lanes were
 * removed in the zero-cookie cutover — nothing here carries a refresh token or a
 * boot fragment.
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
 * API's `SessionAuthResponse` EXACTLY (`buildSessionAuthResponse`). `user` is the
 * truncated session-user shape the login endpoint emits (NOT the full
 * `userResponseSchema`).
 */
export interface LoginSessionResult {
    sessionId: string;
    deviceId: string;
    expiresAt: string;
    accessToken?: string;
    /**
     * The device secret (zero-cookie transport). Emitted on every successful
     * sign-in; the client persists it first-party alongside `deviceId` and later
     * mints access tokens via `POST /session/device/token`. Optional only because
     * a best-effort mint can fail — it is the sole restore credential.
     */
    deviceSecret?: string;
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
    deviceSecret: z.string().optional(),
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

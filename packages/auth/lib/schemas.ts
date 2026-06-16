/**
 * Zod schemas for validating API responses in the auth app.
 *
 * The user / account / session RESPONSE contracts (`refreshAllResponseSchema`,
 * `currentUserResponseSchema`, `deviceSessionsResponseSchema`) are NOT defined
 * here — they are owned by `@oxyhq/contracts` as the single source of truth
 * shared between the API (producer) and every consumer. Importing them straight
 * from the contracts package (not via the client SDK) keeps the wire shape from
 * drifting (a local `name: z.string()` previously rejected every structured-name
 * account and broke session restore). Re-exporting them keeps the existing
 * `@/lib/schemas` import sites working. Only the auth-app-specific schemas
 * (login, signup, lookup, session-status, token, refresh, OAuth state) live
 * locally.
 */
import { z } from "zod"
import {
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
    safeParseContract,
} from "@oxyhq/contracts"

// Canonical, contracts-owned schemas re-exported for local import sites.
export {
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
}

export const loginResponseSchema = z.object({
    sessionId: z.string().optional(),
    accessToken: z.string().optional(),
    expiresAt: z.string().optional(),
    twoFactorRequired: z.boolean().optional(),
    loginToken: z.string().optional(),
    message: z.string().optional(),
})

export const signupResponseSchema = z.object({
    sessionId: z.string().optional(),
    message: z.string().optional(),
    errors: z.array(z.string()).optional(),
})

export const lookupResponseSchema = z.object({
    exists: z.boolean(),
    username: z.string(),
    color: z.string().nullable(),
    avatar: z.string().nullable(),
    displayName: z.string(),
})

/**
 * The display-safe public identity of a requesting application, as returned by
 * the API inside `/auth/session/status/:sessionToken` (device flow) and
 * `/auth/oauth/client/:clientId` (OAuth code flow). Mirrors the
 * `PublicApplication` interface owned by `@oxyhq/core` — kept LOCAL here because,
 * per this file's doctrine, session-status is an auth-app-specific contract
 * (login/signup/lookup/session-status all live locally; only the shared
 * user/account/session response contracts come from `@oxyhq/contracts`).
 */
export const publicApplicationSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    websiteUrl: z.string().optional(),
    type: z.enum(["first_party", "third_party", "internal", "system"]),
    isOfficial: z.boolean(),
    isInternal: z.boolean(),
    scopes: z.array(z.string()),
    developerName: z.string().optional(),
})

/**
 * `GET /auth/session/status/:sessionToken` payload (the inner object of the
 * API's `{ data: ... }` envelope). `application` is the resolved identity of the
 * requesting application (a real registered `Application`), or `null` when no
 * application could be resolved.
 */
export const sessionStatusSchema = z.object({
    status: z.string(),
    authorized: z.boolean().optional(),
    sessionToken: z.string().optional(),
    application: publicApplicationSchema.nullable().optional(),
    expiresAt: z.string().optional(),
    sessionId: z.string().optional(),
    publicKey: z.string().nullable().optional(),
    userId: z.string().nullable().optional(),
})

export const tokenResponseSchema = z.object({
    accessToken: z.string(),
    expiresAt: z.string().optional(),
})

/**
 * `POST /auth/refresh` reads the durable httpOnly `oxy_rt` cookie, rotates it,
 * and mints a fresh access token. It returns ONLY `{ accessToken, expiresAt }`
 * (no `sessionId` — that is decoded from the access token's JWT claims).
 */
export const refreshResponseSchema = z.object({
    accessToken: z.string(),
    expiresAt: z.string().optional(),
})

export const oauthStateSchema = z.object({
    provider: z.string(),
    sessionToken: z.string().optional(),
    redirectUri: z.string().optional(),
    state: z.string().optional(),
})

/**
 * Safely parse a JSON response with a Zod schema. Returns the parsed data or
 * `null` if validation fails. Delegates to the contracts package's
 * `safeParseContract` so there is exactly one parse helper across the ecosystem.
 */
export const safeParse = safeParseContract

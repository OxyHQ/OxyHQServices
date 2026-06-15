/**
 * Zod schemas for validating API responses in the auth app.
 *
 * The user / account / session RESPONSE contracts (`refreshAllResponseSchema`,
 * `currentUserResponseSchema`, `deviceSessionsResponseSchema`) are NOT defined
 * here — they are owned by `@oxyhq/core` as the single source of truth shared
 * between the API (producer) and every consumer. Re-exporting them keeps the
 * existing `@/lib/schemas` import sites working while eliminating the drift that
 * previously broke session restore (a local `name: z.string()` rejected every
 * structured-name account). Only the auth-app-specific schemas (login, signup,
 * lookup, session-status, token, refresh, OAuth state) live locally.
 */
import { z } from "zod"
import {
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
    safeParseContract,
} from "@oxyhq/core"

// Canonical, core-owned contracts re-exported for local import sites.
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

export const sessionStatusSchema = z.object({
    status: z.string(),
    sessionId: z.string().optional(),
    appId: z.string().optional(),
    expiresAt: z.string().optional(),
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
 * `null` if validation fails. Delegates to core's `safeParseContract` so there
 * is exactly one parse helper across the ecosystem.
 */
export const safeParse = safeParseContract

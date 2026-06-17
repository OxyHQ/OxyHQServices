/**
 * Zod schemas for validating API responses in the auth app.
 *
 * The user / account / session RESPONSE contracts (`refreshAllResponseSchema`,
 * `currentUserResponseSchema`, `deviceSessionsResponseSchema`) plus the
 * device-flow `publicApplicationSchema` / `sessionStatusSchema` are NOT defined
 * here — they are owned by `@oxyhq/contracts` as the single source of truth
 * shared between the API (producer) and every consumer. Importing them straight
 * from the contracts package (not via the client SDK) keeps the wire shape from
 * drifting (a local `name: z.string()` previously rejected every structured-name
 * account and broke session restore; a local `sessionId: z.string().optional()`
 * rejected the producer's PENDING `null` and broke device-flow consent).
 * Re-exporting them keeps the existing `@/lib/schemas` import sites working. Only
 * the auth-app-specific schemas (login, signup, lookup, token, refresh, OAuth
 * state) live locally.
 */
import { z } from "zod"
import {
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
    publicApplicationSchema,
    sessionStatusSchema,
    safeParseContract,
} from "@oxyhq/contracts"
import type {
    PublicApplicationResponse,
    SessionStatusResponse,
    ApplicationTypeContract,
} from "@oxyhq/contracts"

// Canonical, contracts-owned schemas re-exported for local import sites.
export {
    refreshAllResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
    publicApplicationSchema,
    sessionStatusSchema,
}
export type {
    PublicApplicationResponse,
    SessionStatusResponse,
    ApplicationTypeContract,
}

export const loginResponseSchema = z.object({
    sessionId: z.string().optional(),
    accessToken: z.string().optional(),
    expiresAt: z.string().optional(),
    authuser: z.number().int().nonnegative().optional(),
    twoFactorRequired: z.boolean().optional(),
    loginToken: z.string().optional(),
    message: z.string().optional(),
})

export const signupResponseSchema = z.object({
    sessionId: z.string().optional(),
    authuser: z.number().int().nonnegative().optional(),
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

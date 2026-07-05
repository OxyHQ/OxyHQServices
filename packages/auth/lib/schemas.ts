/**
 * Zod schemas for validating API responses in the auth app.
 *
 * The user / account / session RESPONSE contracts (`currentUserResponseSchema`,
 * `deviceLinkedSessionsResponseSchema`) plus the
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
    currentUserResponseSchema,
    deviceLinkedSessionsResponseSchema,
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
    currentUserResponseSchema,
    deviceLinkedSessionsResponseSchema,
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
    displayName: z.string().optional(),
})

export const tokenResponseSchema = z.object({
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
 * Response contract for `GET /auth/oauth/consent` — the server-authoritative
 * decision on whether the OAuth consent screen must be shown for this
 * `(user, application, scope)` tuple. The API wraps it as `{ data: { ... } }`.
 *
 *   - `trusted`       — official/first-party app: never asks for consent.
 *   - `granted`       — a stored grant already covers the requested scopes.
 *   - `new`           — no grant yet; show the ConsentCard.
 *   - `scope_changed` — grant exists but the request adds scopes; re-consent.
 *
 * SECURITY: any response the schema rejects MUST fail safe to
 * `consentRequired: true` (see `consentRequiredFromBody`) — a parse/transport
 * failure must never silently auto-approve.
 */
export const consentDecisionSchema = z.object({
    consentRequired: z.boolean(),
    reason: z.enum(["trusted", "granted", "new", "scope_changed"]),
})

export type ConsentDecisionResponse = z.infer<typeof consentDecisionSchema>

/**
 * Decide whether the OAuth consent screen must be shown, from the raw
 * `GET /auth/oauth/consent` response body. Accepts either the API's wrapped
 * `{ data: { ... } }` envelope or a bare decision object. Fails safe: any body
 * the schema cannot validate (malformed, missing fields, unknown `reason`,
 * `null`) returns `true` so the caller renders the ConsentCard rather than
 * auto-approving on a parse error.
 */
export function consentRequiredFromBody(body: unknown): boolean {
    const inner =
        body && typeof body === "object" && "data" in body
            ? (body as { data: unknown }).data
            : body
    const parsed = safeParse(consentDecisionSchema, inner)
    return parsed ? parsed.consentRequired : true
}

/**
 * Safely parse a JSON response with a Zod schema. Returns the parsed data or
 * `null` if validation fails. Delegates to the contracts package's
 * `safeParseContract` so there is exactly one parse helper across the ecosystem.
 */
export const safeParse = safeParseContract

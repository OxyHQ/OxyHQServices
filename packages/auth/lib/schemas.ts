/**
 * Zod schemas for validating API responses in the auth app.
 */
import { z } from "zod"

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

/**
 * `POST /auth/refresh-all` reads EVERY device-local `oxy_rt_${authuser}` cookie
 * present on this device, rotates each in parallel, and returns one entry per
 * VALID account sorted by `authuser` ascending. Empty array means "no signed-in
 * accounts on this device" (the IdP must show the sign-in form).
 *
 * Slot-level errors are silently omitted; the response is always 200 with a
 * (possibly empty) `accounts` array — a 404 from the server means the endpoint
 * is not yet deployed and the caller MUST fall back to the legacy
 * single-account `/auth/refresh` path.
 */
export const refreshAllResponseSchema = z.object({
    accounts: z.array(
        z.object({
            authuser: z.number().int().nonnegative(),
            accessToken: z.string(),
            expiresAt: z.string(),
            sessionId: z.string(),
            user: z.object({
                id: z.string(),
                username: z.string(),
                name: z.string().optional(),
                avatar: z.string().nullable().optional(),
                email: z.string().optional(),
                color: z.string().nullable().optional(),
            }),
        })
    ),
})

/**
 * `GET /users/me` returns the RAW Mongo user document wrapped in the API success
 * envelope (`{ data: <user> }` via `sendSuccess`). It does NOT go through
 * `formatUserResponse`, so the id field is `_id` (NOT `id`), and `name` / `avatar`
 * may be absent. We accept either id form (and keep every other field optional)
 * and resolve the id at the call site. There is NO `sessionId` here — the session
 * id comes from the refreshed access token's claims.
 */
export const currentUserResponseSchema = z.object({
    data: z.object({
        _id: z.string().optional(),
        id: z.string().optional(),
        username: z.string().optional(),
        email: z.string().optional(),
        avatar: z.string().optional(),
        displayName: z.string().optional(),
        color: z.string().nullable().optional(),
        name: z
            .object({
                first: z.string().optional(),
                last: z.string().optional(),
                full: z.string().optional(),
            })
            .optional(),
    }),
})

export const oauthStateSchema = z.object({
    provider: z.string(),
    sessionToken: z.string().optional(),
    redirectUri: z.string().optional(),
    state: z.string().optional(),
})

/**
 * `GET /session/device/sessions/:sessionId` returns the deduplicated list of
 * accounts signed in on this physical device (one entry per user, most recent
 * session). Backs the multi-account chooser. The user object mirrors
 * `formatUserResponse` (id is `id`, never `_id`); `name` may be an object.
 */
export const deviceSessionsResponseSchema = z.array(
    z.object({
        sessionId: z.string(),
        isCurrent: z.boolean().optional(),
        user: z
            .object({
                id: z.string(),
                username: z.string().optional(),
                email: z.string().optional(),
                avatar: z.string().optional(),
                displayName: z.string().optional(),
                color: z.string().nullable().optional(),
                name: z
                    .object({
                        first: z.string().optional(),
                        last: z.string().optional(),
                        full: z.string().optional(),
                    })
                    .optional(),
            })
            .nullable()
            .optional(),
    })
)

/**
 * Safely parse a JSON response with a Zod schema.
 * Returns the parsed data or null if validation fails.
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T | null {
    const result = schema.safeParse(data)
    return result.success ? result.data : null
}

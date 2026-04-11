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

export const oauthStateSchema = z.object({
    provider: z.string(),
    sessionToken: z.string().optional(),
    redirectUri: z.string().optional(),
    state: z.string().optional(),
})

export const meResponseSchema = z.object({
    user: z.object({
        id: z.string(),
        username: z.string().optional(),
        email: z.string().optional(),
        avatar: z.string().optional(),
        displayName: z.string().optional(),
    }).optional(),
    sessionId: z.string().optional(),
})

/**
 * Safely parse a JSON response with a Zod schema.
 * Returns the parsed data or null if validation fails.
 */
export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T | null {
    const result = schema.safeParse(data)
    return result.success ? result.data : null
}

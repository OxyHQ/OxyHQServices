/**
 * Canonical API user-response contracts.
 *
 * SINGLE SOURCE OF TRUTH for the wire shape of every user object the API emits
 * and every consumer (the auth app, services, accounts) parses. The API
 * validates its OUTPUT against these schemas; web/RN consumers validate their
 * INPUT against the same schemas. Because there is exactly one definition, the
 * producer and the consumers cannot drift — the class of bugs that motivated
 * this module (the auth app's local Zod schema requiring `name` to be a plain
 * string, dropping every account that had a structured name) is impossible.
 *
 * This package (`@oxyhq/contracts`) is the dedicated, zero-dependency home for
 * these contracts so the backend (`@oxyhq/api`) and the client SDKs
 * (`@oxyhq/core`, `@oxyhq/auth`, `@oxyhq/services`) can all depend on it without
 * the backend having to depend on a client SDK to obtain its schemas.
 *
 * Faithful to the producers:
 *  - `packages/api/src/utils/userTransform.ts` `formatUserResponse` — the
 *    canonical serialization used by `/auth/refresh-all`, device sessions, etc.
 *    Emits `id` (NOT `_id`), forwards `username` verbatim (may be absent), and
 *    emits `name` as the structured `{ first, last, full, displayName }`
 *    subdocument.
 *  - `packages/api/src/models/User.ts` — `NameSchema` (`first`/`last` default
 *    `''`; `full` and `displayName` are Mongoose VIRTUALS. Formatted API
 *    responses compose both fields, while raw-document responses may omit the
 *    virtuals if the query did not materialise them.
 *  - The `/auth/refresh-all` handler in `packages/api/src/routes/auth.ts`, whose
 *    per-slot `authuser` is the numeric `oxy_rt_${authuser}` cookie slot.
 *
 * Platform-agnostic — zod only, no react/react-native/expo. ESM-safe (no
 * `require()`).
 */

import { z } from 'zod';

/**
 * Structured human name subdocument. Mirrors `User.name` (`NameSchema`).
 *
 * - `first` / `last` default to `''` in Mongo, so they are optional on the wire.
 * - `full` is a Mongoose virtual — absent unless the query materialised
 *   virtuals or the serializer composed it.
 * - `displayName` is the required canonical app-facing display string.
 *
 * `.passthrough()` is intentional: it tolerates additive name fields without a
 * coordinated contract bump, while the three known keys stay strongly typed.
 */
export const userNameSchema = z
    .object({
        first: z.string().optional(),
        last: z.string().optional(),
        full: z.string().optional(),
        displayName: z.string(),
    })
    .passthrough();

export type UserNameResponse = z.infer<typeof userNameSchema>;

/**
 * The canonical user object emitted by `formatUserResponse`.
 *
 * `id` and `name.displayName` are guaranteed on formatted user DTOs. The rest
 * is forwarded from the user document and may be absent depending on the query's
 * `.select(...)`/`.lean()` projection. Both `id` and `_id` are accepted because
 * some raw-document responses carry `_id` instead of `id`; resolve the
 * identifier with {@link resolveUserId}.
 *
 * `.passthrough()` keeps the large tail of profile fields
 * (`privacySettings`, `locations`, `links`, `linksMetadata`, `bio`,
 * `description`, `language`, `verified`, timestamps, …) available to callers
 * that need them without enumerating every nested shape here — the load-bearing
 * identity/display fields are the ones we pin precisely.
 */
export const userResponseSchema = z
    .object({
        /** MongoDB ObjectId as a string. Present on `formatUserResponse` output. */
        id: z.string().optional(),
        /** Raw-document id (e.g. `GET /users/me`). Present when `id` is not. */
        _id: z.string().optional(),
        publicKey: z.string().optional(),
        username: z.string().optional(),
        email: z.string().optional(),
        /** Avatar file id (string) or null. */
        avatar: z.string().nullable().optional(),
        /** Named Bloom color preset (e.g. `"blue"`) or null. */
        color: z.string().nullable().optional(),
        name: userNameSchema,
        verified: z.boolean().optional(),
        language: z.string().optional(),
    })
    .passthrough();

export type UserResponse = z.infer<typeof userResponseSchema>;

export const userProfileUpdateSchema = z
    .object({
        name: z
            .object({
                first: z.string().optional(),
                last: z.string().optional(),
            })
            .optional(),
        username: z.string().optional(),
        email: z.string().optional(),
        avatar: z.string().optional(),
        color: z.string().nullable().optional(),
        bio: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        locations: z.array(z.unknown()).optional(),
        links: z.array(z.string()).optional(),
        linksMetadata: z
            .array(
                z.object({
                    url: z.string(),
                    title: z.string().optional(),
                    description: z.string().optional(),
                    image: z.string().optional(),
                    id: z.string().optional(),
                }),
            )
            .optional(),
        language: z.string().optional(),
        accountExpiresAfterInactivityDays: z.number().nullable().optional(),
        notificationPreferences: z.record(z.unknown()).optional(),
        userPreferences: z.record(z.unknown()).optional(),
        privacySettings: z.record(z.unknown()).optional(),
    })
    .passthrough();

export type UserProfileUpdate = z.infer<typeof userProfileUpdateSchema>;

/**
 * Resolve the canonical user id from a {@link UserResponse}, accepting either
 * the `formatUserResponse` `id` field or the raw-document `_id` field.
 */
export function resolveUserId(user: UserResponse): string | undefined {
    return user.id ?? user._id;
}

/**
 * One rotated account entry from `POST /auth/refresh-all`.
 *
 * `authuser` is the device-local slot index (`0..N-1`). `user` is the canonical
 * {@link userResponseSchema} shape (the handler projects a whitelist and runs it
 * through `formatUserResponse`).
 */
export const refreshAllAccountSchema = z.object({
    authuser: z.number().int().nonnegative(),
    accessToken: z.string(),
    expiresAt: z.string(),
    sessionId: z.string(),
    user: userResponseSchema,
});

export type RefreshAllAccountResponse = z.infer<typeof refreshAllAccountSchema>;

/**
 * Wire shape of `POST /auth/refresh-all`: every valid device-local account,
 * sorted by `authuser` ascending. An empty `accounts` array means "no signed-in
 * accounts on this device" — the IdP must show the sign-in form.
 */
export const refreshAllResponseSchema = z.object({
    accounts: z.array(refreshAllAccountSchema),
});

export type RefreshAllResponseContract = z.infer<typeof refreshAllResponseSchema>;

/**
 * Wire shape of `GET /users/me` — the API success envelope (`{ data: <user> }`)
 * wrapping the current-user DTO. Some older producers use `_id` instead of
 * `id`; resolve via {@link resolveUserId}. The display name still lives under
 * `name.displayName`.
 */
export const currentUserResponseSchema = z.object({
    data: userResponseSchema,
});

export type CurrentUserResponseContract = z.infer<typeof currentUserResponseSchema>;

/**
 * One entry of `GET /session/device/sessions/:sessionId` — the deduplicated
 * accounts signed in on this physical device (one per user, most recent
 * session). Backs the multi-account chooser. The embedded user mirrors
 * `formatUserResponse`; it is nullable on slots that lost their user document.
 */
export const deviceSessionAccountSchema = z.object({
    sessionId: z.string(),
    isCurrent: z.boolean().optional(),
    user: userResponseSchema.nullable().optional(),
});

export type DeviceSessionAccountResponse = z.infer<typeof deviceSessionAccountSchema>;

/** Wire shape of `GET /session/device/sessions/:sessionId` (an array). */
export const deviceSessionsResponseSchema = z.array(deviceSessionAccountSchema);

export type DeviceSessionsResponseContract = z.infer<typeof deviceSessionsResponseSchema>;

/**
 * Safely parse a value against a contract schema. Returns the parsed (typed)
 * value, or `null` when validation fails — the same ergonomics the auth app's
 * local `safeParse` provided, now sourced from the contracts package so the
 * parse helper and the schemas live together.
 */
export function safeParseContract<T>(schema: z.ZodType<T>, data: unknown): T | null {
    const result = schema.safeParse(data);
    return result.success ? result.data : null;
}

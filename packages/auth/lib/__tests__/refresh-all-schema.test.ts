/**
 * Regression tests for `refreshAllResponseSchema` — the schema that gates the
 * Google-style account chooser on a cold visit to auth.oxy.so.
 *
 * `useDeviceAccounts` runs `POST /auth/refresh-all` and `safeParse`s the body
 * with this schema. A single field-shape mismatch collapses the WHOLE parse to
 * `null`, which `detectAccountsViaRefreshAll` reads as "logged out" → the
 * chooser is suppressed and the bare sign-in form is shown instead.
 *
 * The schema MUST therefore mirror the API's real contract exactly:
 *   - `user.name` is the structured `{ first, last, full }` subdocument that
 *     `formatUserResponse` returns (NOT a plain string).
 *   - `user.username` is OPTIONAL (publicKey-only accounts have none).
 *   - `authuser` is `null` for the legacy un-suffixed `oxy_rt` cookie slot.
 *
 * A previous `name: z.string()` (plus required `username` and non-nullable
 * `authuser`) silently rejected every real account and broke session restore.
 *
 * The schema + parse helper now come from `@oxyhq/core` (the single source of
 * truth shared with the API). Importing them through `@/lib/schemas` — which
 * re-exports the core versions — also proves the auth app is wired onto the
 * canonical contract, not a local copy that could drift again.
 */
import { describe, expect, test } from "bun:test"
import { refreshAllResponseSchema as coreRefreshAllResponseSchema } from "@oxyhq/core"
import { refreshAllResponseSchema, safeParse } from "@/lib/schemas"

describe("refreshAllResponseSchema", () => {
    test("accepts the structured name subdocument the API actually returns", () => {
        const payload = {
            accounts: [
                {
                    authuser: 0,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s1",
                    user: {
                        id: "u1",
                        username: "alice",
                        name: { first: "Alice", last: "Doe", full: "Alice Doe" },
                        avatar: "file123",
                        email: "alice@example.com",
                        color: "blue",
                    },
                },
            ],
        }
        const parsed = safeParse(refreshAllResponseSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.accounts).toHaveLength(1)
    })

    test("accepts a publicKey-only account with no username", () => {
        const payload = {
            accounts: [
                {
                    authuser: 1,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s2",
                    user: {
                        id: "u2",
                        name: { first: "", last: "" },
                        color: null,
                    },
                },
            ],
        }
        const parsed = safeParse(refreshAllResponseSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.accounts[0].user.username).toBeUndefined()
    })

    test("accepts authuser: null for the legacy un-suffixed cookie slot", () => {
        const payload = {
            accounts: [
                {
                    authuser: null,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s3",
                    user: { id: "u3", username: "bob" },
                },
            ],
        }
        const parsed = safeParse(refreshAllResponseSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.accounts[0].authuser).toBeNull()
    })

    test("rejects a name sent as a plain string (the old wrong contract)", () => {
        const payload = {
            accounts: [
                {
                    authuser: 0,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s4",
                    user: { id: "u4", username: "carol", name: "Carol" },
                },
            ],
        }
        expect(safeParse(refreshAllResponseSchema, payload)).toBeNull()
    })

    test("the @/lib/schemas re-export IS the @oxyhq/core schema (no local copy)", () => {
        // Identity check: if a local copy ever crept back in, this fails — the
        // whole point of phase 3 is ONE contract owned by core.
        expect(refreshAllResponseSchema).toBe(coreRefreshAllResponseSchema)
    })
})

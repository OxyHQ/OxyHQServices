/**
 * Regression tests for `deviceResolveResponseSchema` — the contract that gates
 * the Google-style account chooser on a cold visit to auth.oxy.so.
 *
 * `useDeviceAccounts` fetches the IdP's `/api/device-accounts` feed and
 * `safeParse`s the body with this schema. A single field-shape mismatch
 * collapses the WHOLE parse to `null`, which `detectAccounts` reads as "logged
 * out" → the chooser is suppressed and the bare sign-in form is shown instead.
 *
 * The schema (owned by `@oxyhq/contracts`, shared with the API) MUST therefore
 * mirror the API's real `POST /auth/device/resolve` output exactly:
 *   - `activeAccountId` is `string | null`;
 *   - each account carries a `user` (the structured `userResponseSchema`),
 *     `sessionId`, `accessToken`, and `expiresAt`;
 *   - `user.name` is the structured `{ first, last, full, displayName }`
 *     subdocument (NOT a plain string);
 *   - `user.username` is OPTIONAL (publicKey-only accounts have none).
 */
import { describe, expect, test } from "bun:test"
import { deviceResolveResponseSchema } from "@oxyhq/contracts"
import { safeParse } from "@/lib/schemas"

const validAccount = {
    user: {
        id: "u1",
        username: "alice",
        name: { first: "Alice", last: "Doe", full: "Alice Doe", displayName: "Alice Doe" },
        avatar: "file123",
        email: "alice@example.com",
        color: "blue",
    },
    sessionId: "s1",
    accessToken: "at1",
    expiresAt: new Date().toISOString(),
}

describe("deviceResolveResponseSchema", () => {
    test("accepts the resolved device account set the API returns", () => {
        const payload = { activeAccountId: "u1", accounts: [validAccount] }
        const parsed = safeParse(deviceResolveResponseSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.accounts).toHaveLength(1)
        expect(parsed?.activeAccountId).toBe("u1")
    })

    test("accepts activeAccountId: null (device known, no active account)", () => {
        const payload = { activeAccountId: null, accounts: [validAccount] }
        const parsed = safeParse(deviceResolveResponseSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.activeAccountId).toBeNull()
    })

    test("accepts a publicKey-only account with no username", () => {
        const payload = {
            activeAccountId: null,
            accounts: [
                {
                    user: {
                        id: "u2",
                        name: { first: "", last: "", displayName: "u2" },
                        color: null,
                    },
                    sessionId: "s2",
                    accessToken: "at2",
                    expiresAt: new Date().toISOString(),
                },
            ],
        }
        const parsed = safeParse(deviceResolveResponseSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.accounts[0].user.username).toBeUndefined()
    })

    test("rejects an account missing its accessToken", () => {
        const payload = {
            activeAccountId: "u1",
            accounts: [{ user: validAccount.user, sessionId: "s1", expiresAt: new Date().toISOString() }],
        }
        expect(safeParse(deviceResolveResponseSchema, payload)).toBeNull()
    })

    test("rejects a name sent as a plain string (the old wrong contract)", () => {
        const payload = {
            activeAccountId: "u1",
            accounts: [
                {
                    user: { id: "u4", username: "carol", name: "Carol" },
                    sessionId: "s4",
                    accessToken: "at4",
                    expiresAt: new Date().toISOString(),
                },
            ],
        }
        expect(safeParse(deviceResolveResponseSchema, payload)).toBeNull()
    })
})

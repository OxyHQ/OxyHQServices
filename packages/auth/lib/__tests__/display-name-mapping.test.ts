/**
 * Regression test for the auth app's account display-name resolution.
 *
 * `useDeviceAccounts` parses `POST /auth/refresh-all` with the canonical
 * `refreshAllResponseSchema` (contracts) and maps each entry's `user` into an
 * `Account` via `getAccountDisplayName(user)`. This exercises that exact path:
 * parse the wire payload through the schema the hook uses, then resolve the
 * display name the way the hook's `toAccount` mapper does.
 *
 * The bug this guards against: a FIRST-NAME-ONLY account (no `last`, no
 * `name.full`) used to collapse to the lowercase `username` because the local
 * resolver required BOTH `name.first && name.last`. The canonical helper now
 * composes the available parts, so a first-only account renders its first name
 * (capitalized as stored), never the lowercase handle.
 */
import { describe, expect, test } from "bun:test"
import { getAccountDisplayName } from "@oxyhq/core"
import { refreshAllResponseSchema, safeParse } from "@/lib/schemas"

describe("auth app account display-name mapping", () => {
    test("first-name-only account renders the first name, NOT the lowercase username", () => {
        const payload = {
            accounts: [
                {
                    authuser: 0,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s1",
                    user: {
                        id: "u1",
                        username: "nateisern",
                        // First name only — no `last`, no `full`.
                        name: { first: "Nate" },
                        color: "blue",
                    },
                },
            ],
        }

        const parsed = safeParse(refreshAllResponseSchema, payload)
        expect(parsed).not.toBeNull()
        const user = parsed?.accounts[0].user
        expect(user).toBeDefined()
        if (!user) throw new Error("unreachable: parse guaranteed a user")

        const displayName = getAccountDisplayName(user)
        expect(displayName).toBe("Nate")
        expect(displayName).not.toBe("nateisern")
    })

    test("composes first + last when both are present", () => {
        const payload = {
            accounts: [
                {
                    authuser: 0,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s2",
                    user: {
                        id: "u2",
                        username: "alice",
                        name: { first: "Alice", last: "Doe" },
                    },
                },
            ],
        }
        const parsed = safeParse(refreshAllResponseSchema, payload)
        const user = parsed?.accounts[0].user
        if (!user) throw new Error("parse failed")
        expect(getAccountDisplayName(user)).toBe("Alice Doe")
    })

    test("falls back to username when there is no structured name", () => {
        const payload = {
            accounts: [
                {
                    authuser: 0,
                    accessToken: "at",
                    expiresAt: new Date().toISOString(),
                    sessionId: "s3",
                    user: { id: "u3", username: "bob" },
                },
            ],
        }
        const parsed = safeParse(refreshAllResponseSchema, payload)
        const user = parsed?.accounts[0].user
        if (!user) throw new Error("parse failed")
        expect(getAccountDisplayName(user)).toBe("bob")
    })
})

/**
 * Regression test for the auth app's account display-name resolution.
 *
 * `useDeviceAccounts` parses the `/api/device-accounts` feed with the canonical
 * `deviceResolveResponseSchema` (contracts) and maps each entry's `user` into an
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
import { deviceResolveResponseSchema } from "@oxyhq/contracts"
import { safeParse } from "@/lib/schemas"

/** Build a `/auth/device/resolve` payload wrapping a single account `user`. */
function payloadFor(user: Record<string, unknown>) {
    return {
        activeAccountId: typeof user.id === "string" ? user.id : null,
        accounts: [
            {
                user,
                sessionId: "s1",
                accessToken: "at",
                expiresAt: new Date().toISOString(),
            },
        ],
    }
}

describe("auth app account display-name mapping", () => {
    test("first-name-only account renders the first name, NOT the lowercase username", () => {
        // First name only — no `last`, no `full`. `displayName` is the canonical
        // required field `formatUserResponse` always composes (here from the
        // first name).
        const payload = payloadFor({
            id: "u1",
            username: "nateisern",
            name: { first: "Nate", displayName: "Nate" },
            color: "blue",
        })

        const parsed = safeParse(deviceResolveResponseSchema, payload)
        expect(parsed).not.toBeNull()
        const user = parsed?.accounts[0].user
        expect(user).toBeDefined()
        if (!user) throw new Error("unreachable: parse guaranteed a user")

        const displayName = getAccountDisplayName(user)
        expect(displayName).toBe("Nate")
        expect(displayName).not.toBe("nateisern")
    })

    test("composes first + last when both are present", () => {
        const payload = payloadFor({
            id: "u2",
            username: "alice",
            name: { first: "Alice", last: "Doe", displayName: "Alice Doe" },
        })
        const parsed = safeParse(deviceResolveResponseSchema, payload)
        const user = parsed?.accounts[0].user
        if (!user) throw new Error("parse failed")
        expect(getAccountDisplayName(user)).toBe("Alice Doe")
    })

    test("renders the username when there are no human name parts (displayName composed from the handle)", () => {
        // A username-only account: `formatUserResponse` still emits the required
        // `name.displayName`, composed from the username when no first/last/full
        // exist. The chooser therefore renders the handle, not "Unnamed".
        const payload = payloadFor({ id: "u3", username: "bob", name: { displayName: "bob" } })
        const parsed = safeParse(deviceResolveResponseSchema, payload)
        const user = parsed?.accounts[0].user
        if (!user) throw new Error("parse failed")
        expect(getAccountDisplayName(user)).toBe("bob")
    })
})

/**
 * `mapDeviceResolveToState` — the pure projection from a `/auth/device/resolve`
 * response to the chooser's account state.
 *
 * The key invariant under test: `authuser` is a CONTIGUOUS per-account index
 * assigned AFTER dropping any entry whose user fails to resolve. A skipped entry
 * must NOT leave a gap — `authorize.tsx` selects an account by
 * `entry.authuser === ?authuser=N`, so a gap would shift selections across page
 * loads.
 */
import { describe, expect, test } from "bun:test"
import type { DeviceResolveResponse } from "@oxyhq/contracts"
import { mapDeviceResolveToState } from "@/lib/use-device-accounts"

function account(id: string, sessionId: string) {
    return {
        user: { id, username: id, name: { first: id, displayName: id } },
        sessionId,
        accessToken: `at-${id}`,
        expiresAt: "2999-01-01T00:00:00.000Z",
    }
}

describe("mapDeviceResolveToState", () => {
    test("assigns contiguous authuser indices, skipping an unresolvable-user entry (no gap)", () => {
        // Middle entry's user has no id → `toAccount` returns null → skipped. The
        // two valid accounts must get authuser 0 and 1 (contiguous), NOT 0 and 2.
        const parsed = {
            activeAccountId: null,
            accounts: [
                account("aaa", "s-a"),
                { ...account("aaa", "s-x"), user: { id: "", name: { first: "", displayName: "" } } },
                account("ccc", "s-c"),
            ],
        } as unknown as DeviceResolveResponse

        const state = mapDeviceResolveToState(parsed)

        expect(state.accounts).toHaveLength(2)
        expect(state.accounts.map((a) => a.authuser)).toEqual([0, 1])
        // Sorted by user id, so `aaa` (0) then `ccc` (1).
        expect(state.accounts.map((a) => a.account.id)).toEqual(["aaa", "ccc"])
    })

    test("marks the active account isCurrent and surfaces it as the current row", () => {
        const parsed = {
            activeAccountId: "ccc",
            accounts: [account("aaa", "s-a"), account("ccc", "s-c")],
        } as unknown as DeviceResolveResponse

        const state = mapDeviceResolveToState(parsed)

        expect(state.currentAccount?.id).toBe("ccc")
        expect(state.currentSessionId).toBe("s-c")
        expect(state.currentAccessToken).toBe("at-ccc")
        expect(state.accounts.find((a) => a.account.id === "ccc")?.isCurrent).toBe(true)
        expect(state.accounts.find((a) => a.account.id === "aaa")?.isCurrent).toBe(false)
    })

    test("elects the first account as current when the server reports no active one", () => {
        const parsed = {
            activeAccountId: null,
            accounts: [account("aaa", "s-a"), account("ccc", "s-c")],
        } as unknown as DeviceResolveResponse

        const state = mapDeviceResolveToState(parsed)

        expect(state.currentSessionId).toBe("s-a")
        expect(state.accounts[0].isCurrent).toBe(true)
    })

    test("returns the logged-out state when every entry is unresolvable", () => {
        const parsed = {
            activeAccountId: null,
            accounts: [
                { ...account("x", "s-x"), user: { id: "", name: { first: "", displayName: "" } } },
            ],
        } as unknown as DeviceResolveResponse

        const state = mapDeviceResolveToState(parsed)
        expect(state.accounts).toHaveLength(0)
        expect(state.currentSessionId).toBeNull()
        expect(state.isLoading).toBe(false)
    })
})

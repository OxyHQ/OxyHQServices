import { useRef, useState } from "react"
import { getAccountDisplayName } from "@oxyhq/core"
import { resolveUserId, deviceResolveResponseSchema } from "@oxyhq/contracts"
import type { UserResponse, DeviceResolveResponse } from "@oxyhq/contracts"
import { safeParse } from "@/lib/schemas"
import type { Account, DeviceAccount } from "@/lib/types"

type DeviceAccountsState = {
    /** True until the session probe settles. */
    isLoading: boolean
    /** The device's active account (resolved from the device session's `activeAccountId`). */
    currentAccount: Account | null
    /** The chooser's active account session id. */
    currentSessionId: string | null
    /** Fresh in-memory bearer for the active account. */
    currentAccessToken: string | null
    /**
     * Every account signed in on this device (1..N). Empty when logged out. The
     * active account carries `isCurrent: true`.
     *
     * Each entry is resolved from the central `DeviceSession` (via the IdP's
     * same-origin `/api/device-accounts` feed → API `POST /auth/device/resolve`)
     * and carries a fresh in-memory bearer minted server-side for the consent
     * action. Tokens are not persisted in Web Storage.
     */
    accounts: DeviceAccount[]
}

const INITIAL_STATE: DeviceAccountsState = {
    isLoading: true,
    currentAccount: null,
    currentSessionId: null,
    currentAccessToken: null,
    accounts: [],
}

const LOGGED_OUT_STATE: DeviceAccountsState = {
    isLoading: false,
    currentAccount: null,
    currentSessionId: null,
    currentAccessToken: null,
    accounts: [],
}

/**
 * Map a parsed `UserResponse` contract into the auth app's `Account` shape, resolving
 * the display name via the canonical `getAccountDisplayName` helper (first-name
 * -only safe: a user with only a first name renders that first name, NOT the
 * lowercase username). `getAccountDisplayName` always returns a non-empty string
 * (falling back to a public-key handle or the translated "Unnamed" sentinel), so
 * the chooser never shows a blank row.
 */
function toAccount(user: UserResponse): Account | null {
    const id = resolveUserId(user)
    if (!id) return null
    return {
        id,
        username: user.username,
        email: user.email,
        avatar: user.avatar ?? undefined,
        displayName: getAccountDisplayName(user),
        color: user.color ?? null,
    }
}

/**
 * Detect the accounts available on this device for the Google-style chooser.
 *
 * The IdP's same-origin `/api/device-accounts` feed reads the first-party
 * `oxy_device` cookie and resolves the central `DeviceSession` into the set of
 * accounts signed in on this device. The hook keeps the returned bearers in
 * memory for the current page only.
 */
export function useDeviceAccounts(): DeviceAccountsState {
    const [state, setState] = useState<DeviceAccountsState>(INITIAL_STATE)
    const startedRef = useRef(false)

    if (!startedRef.current) {
        startedRef.current = true
        void detectAccounts().then((next) => setState(next))
    }

    return state
}

/**
 * Project a parsed `POST /auth/device/resolve` response onto the chooser's
 * `DeviceAccountsState`. Pure (no I/O) so the index/selection logic is unit
 * testable.
 *
 * `authuser` is a DETERMINISTIC per-account index assigned over the FILTERED,
 * user-id-sorted set — device-session accounts have no persistent
 * refresh-cookie slot. It is a client-side `/login → /authorize?authuser=N`
 * selection hint only (matched in `authorize.tsx`), never sent to the API.
 * CRITICAL: the index is assigned AFTER dropping any entry whose user fails to
 * resolve, so a skipped entry never leaves a gap that would shift `authuser`
 * relative to another page load's projection.
 */
export function mapDeviceResolveToState(parsed: DeviceResolveResponse): DeviceAccountsState {
    // Resolve to valid accounts FIRST (drop any unresolvable user), user-id
    // sorted for a stable order, THEN assign the contiguous per-account index.
    const resolved = parsed.accounts
        .map((entry) => {
            const account = toAccount(entry.user)
            return account ? { entry, account } : null
        })
        .filter((r): r is { entry: DeviceResolveResponse["accounts"][number]; account: Account } => r !== null)
        .sort((a, b) => (a.account.id < b.account.id ? -1 : a.account.id > b.account.id ? 1 : 0))

    if (resolved.length === 0) {
        return LOGGED_OUT_STATE
    }

    const activeId = parsed.activeAccountId
    const accounts: DeviceAccount[] = []
    let currentAccount: Account | null = null
    let currentSessionId: string | null = null
    let currentAccessToken: string | null = null

    resolved.forEach(({ entry, account }, index) => {
        const isCurrent = activeId !== null && account.id === activeId
        accounts.push({
            sessionId: entry.sessionId,
            isCurrent,
            accessToken: entry.accessToken,
            expiresAt: entry.expiresAt,
            authuser: index,
            account,
        })
        if (isCurrent) {
            currentAccount = account
            currentSessionId = entry.sessionId
            currentAccessToken = entry.accessToken
        }
    })

    // The device has accounts but the server reported no active one (or an id
    // that resolved to no live token): elect the first as the chooser's current
    // row so it still renders (the chooser gates on `currentSessionId`).
    if (!currentSessionId) {
        const first = accounts[0]
        first.isCurrent = true
        currentAccount = first.account
        currentSessionId = first.sessionId
        currentAccessToken = first.accessToken
    }

    return {
        isLoading: false,
        currentAccount,
        currentSessionId,
        currentAccessToken,
        accounts,
    }
}

/**
 * Resolve the device's account set from the IdP's same-origin
 * `/api/device-accounts` feed. A non-2xx response or an empty set is
 * authoritative "no signed-in accounts".
 */
async function detectAccounts(): Promise<DeviceAccountsState> {
    let response: Response
    try {
        response = await fetch("/api/device-accounts", {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
        })
    } catch {
        return LOGGED_OUT_STATE
    }

    if (!response.ok) {
        return LOGGED_OUT_STATE
    }

    let payload: unknown
    try {
        payload = await response.json()
    } catch {
        return LOGGED_OUT_STATE
    }

    const parsed = safeParse(deviceResolveResponseSchema, payload)
    if (!parsed || parsed.accounts.length === 0) {
        return LOGGED_OUT_STATE
    }

    return mapDeviceResolveToState(parsed)
}

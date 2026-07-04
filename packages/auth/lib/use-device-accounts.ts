import { useRef, useState } from "react"
import { getAccountDisplayName } from "@oxyhq/core"
import { resolveUserId, deviceResolveResponseSchema } from "@oxyhq/contracts"
import type { UserResponse } from "@oxyhq/contracts"
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

    // Device-session accounts have no persistent `oxy_rt_${n}` slot. Assign a
    // DETERMINISTIC per-account index (`authuser`) by sorting on the stable user
    // id, so the client-side `/login → /authorize?authuser=N` selection hint
    // (matched in `authorize.tsx`) resolves to the SAME account across page
    // loads. `authuser` is never sent to the API — it is a UI selection hint.
    const sorted = [...parsed.accounts].sort((a, b) => {
        const ai = resolveUserId(a.user) ?? ""
        const bi = resolveUserId(b.user) ?? ""
        return ai < bi ? -1 : ai > bi ? 1 : 0
    })

    const activeId = parsed.activeAccountId
    const accounts: DeviceAccount[] = []
    let currentAccount: Account | null = null
    let currentSessionId: string | null = null
    let currentAccessToken: string | null = null

    sorted.forEach((entry, index) => {
        const account = toAccount(entry.user)
        if (!account) return
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

    if (accounts.length === 0) {
        return LOGGED_OUT_STATE
    }

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

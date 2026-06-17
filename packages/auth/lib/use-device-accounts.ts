import { useRef, useState } from "react"
import { getAccountDisplayName } from "@oxyhq/core"
import { resolveUserId } from "@oxyhq/contracts"
import type { UserResponse } from "@oxyhq/contracts"
import { buildApiUrl } from "@/lib/oxy-api-client"
import {
    refreshAllResponseSchema,
    safeParse,
} from "@/lib/schemas"
import type { Account, DeviceAccount } from "@/lib/types"

type DeviceAccountsState = {
    /** True until the session probe settles. */
    isLoading: boolean
    /** The account whose persistent IdP session is active (resolved via refresh). */
    currentAccount: Account | null
    /** The chooser's active account session id. */
    currentSessionId: string | null
    /** Fresh in-memory bearer for the active account. */
    currentAccessToken: string | null
    /**
     * Every account signed in on this device (1..N), current one first. Empty
     * when logged out. The current account always carries `isCurrent: true`.
     *
     * Each entry is returned by `POST /auth/refresh-all` and carries a fresh
     * in-memory bearer. Tokens are not persisted in Web Storage.
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
 * `POST /auth/refresh-all` rotates every device-local `oxy_rt_${authuser}`
 * cookie in parallel and returns one valid account per slot. The hook keeps the
 * returned bearers in memory for the current page only.
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

async function detectAccounts(): Promise<DeviceAccountsState> {
    return detectAccountsViaRefreshAll()
}

/**
 * Try `POST /auth/refresh-all`. A non-2xx response is authoritative "no signed
 * in accounts" in the clean session model.
 */
async function detectAccountsViaRefreshAll(): Promise<DeviceAccountsState> {
    let response: Response
    try {
        response = await fetch(buildApiUrl("/auth/refresh-all"), {
            method: "POST",
            credentials: "include",
            headers: { Accept: "application/json" },
        })
    } catch {
        // Network failure — treat as "no signed-in session" rather than
        // cascading into the legacy path, which would just fail the same way.
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

    const parsed = safeParse(refreshAllResponseSchema, payload)
    if (!parsed || parsed.accounts.length === 0) {
        return LOGGED_OUT_STATE
    }

    // Sort ascending by authuser (the server already does this, but defensive
    // in case of older deployments). The lowest authuser is the "current" slot
    // when no UI hint says otherwise; the active-account hint persisted in
    // localStorage by the SDK is consulted by callers that need it.
    const slotRank = (authuser: number): number => authuser
    const sorted = [...parsed.accounts].sort(
        (a, b) => slotRank(a.authuser) - slotRank(b.authuser)
    )
    const current = sorted[0]
    const currentSessionId = current.sessionId

    const currentAccount = toAccount(current.user)
    if (!currentAccount) {
        // The active slot's user document is missing its id — treat as logged out
        // rather than render a chooser with an unselectable current row.
        return LOGGED_OUT_STATE
    }

    const accounts: DeviceAccount[] = []
    for (const entry of sorted) {
        const account = toAccount(entry.user)
        if (!account) continue
        accounts.push({
            sessionId: entry.sessionId,
            isCurrent: entry.sessionId === currentSessionId,
            accessToken: entry.accessToken,
            expiresAt: entry.expiresAt,
            authuser: entry.authuser,
            account,
        })
    }

    return {
        isLoading: false,
        currentAccount,
        currentSessionId,
        currentAccessToken: current.accessToken,
        accounts,
    }
}

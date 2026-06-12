import { useRef, useState } from "react"
import { buildApiUrl, buildAuthUrl } from "@/lib/oxy-api-client"
import {
    refreshResponseSchema,
    currentUserResponseSchema,
    deviceSessionsResponseSchema,
    safeParse,
} from "@/lib/schemas"
import type { Account, DeviceAccount } from "@/lib/types"

type DeviceAccountsState = {
    /** True until the session probe settles. */
    isLoading: boolean
    /** The account whose persistent IdP session is active (resolved via refresh). */
    currentAccount: Account | null
    /** The current account's session id (used to mint its token on "Continue"). */
    currentSessionId: string | null
    /**
     * Every account signed in on this device (1..N), current one first. Empty
     * when logged out. The current account always carries `isCurrent: true`.
     */
    accounts: DeviceAccount[]
}

const INITIAL_STATE: DeviceAccountsState = {
    isLoading: true,
    currentAccount: null,
    currentSessionId: null,
    accounts: [],
}

const LOGGED_OUT_STATE: DeviceAccountsState = {
    isLoading: false,
    currentAccount: null,
    currentSessionId: null,
    accounts: [],
}

function resolveDisplayName(user: {
    displayName?: string
    username?: string
    email?: string
    name?: { first?: string; last?: string; full?: string }
}): string | undefined {
    if (user.displayName) return user.displayName
    if (user.name?.full) return user.name.full
    if (user.name?.first && user.name?.last) {
        return `${user.name.first} ${user.name.last}`
    }
    return user.username || user.email
}

/**
 * Decode a JWT payload WITHOUT verifying its signature, returning the `sessionId`
 * claim. Reading a claim for client-side routing is safe: the server re-verifies
 * the token's signature on every protected request, so a forged claim here would
 * simply fail the subsequent `/users/me` / `/session/*` calls. The Oxy access
 * token embeds `{ userId, sessionId, deviceId }`.
 */
function readSessionIdFromToken(accessToken: string): string | null {
    try {
        const segments = accessToken.split(".")
        if (segments.length !== 3) return null
        const payloadSegment = segments[1].replace(/-/g, "+").replace(/_/g, "/")
        const padded = payloadSegment.padEnd(
            payloadSegment.length + ((4 - (payloadSegment.length % 4)) % 4),
            "="
        )
        const json = JSON.parse(atob(padded)) as { sessionId?: unknown }
        return typeof json.sessionId === "string" && json.sessionId.length > 0
            ? json.sessionId
            : null
    } catch {
        return null
    }
}

/**
 * Detect the accounts available on this device for the Google-style chooser.
 *
 * The persistent session on a cold-boot page load lives ONLY in the durable
 * httpOnly `oxy_rt` cookie (Path=/auth/refresh). There is no in-memory access
 * token yet, so the bearer-protected `/users/me` would 401 on its own. We
 * therefore bootstrap exactly like the reload-persistence path:
 *   1. `POST /auth/refresh` (credentials included, NO Authorization header)
 *      rotates the single-use cookie and mints a fresh access token. A
 *      401/non-2xx/network failure means no persistent session → sign-in form.
 *   2. The access token's JWT carries the `sessionId`; we decode it and plant
 *      both token + sessionId in `sessionStorage` so the chooser's continue /
 *      OAuth-consent handlers (which read those keys) work seamlessly.
 *   3. `GET /users/me` WITH the bearer → the current account.
 *   4. `GET /session/device/sessions/:sessionId` WITH the bearer → sibling
 *      accounts (1..N), best-effort.
 *
 * `/auth/refresh` is single-use and rotates the cookie on each call — the
 * detection IS a legitimate refresh, so it MUST run at most once per page load
 * (guarded by the ref in `useDeviceAccounts`).
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
    // 1. Bootstrap an access token from the durable refresh cookie.
    let accessToken: string
    try {
        const refreshRes = await fetch(buildApiUrl("/auth/refresh"), {
            method: "POST",
            credentials: "include",
        })
        if (!refreshRes.ok) return LOGGED_OUT_STATE
        const refreshed = safeParse(
            refreshResponseSchema,
            await refreshRes.json()
        )
        if (!refreshed?.accessToken) return LOGGED_OUT_STATE
        accessToken = refreshed.accessToken
    } catch {
        // No persistent session / network failure → sign-in form.
        return LOGGED_OUT_STATE
    }

    // 2. Recover the session id from the token and plant credentials so the
    //    chooser's continue / consent handlers can reuse them.
    const currentSessionId = readSessionIdFromToken(accessToken)
    if (!currentSessionId) return LOGGED_OUT_STATE
    sessionStorage.setItem("oxy_access_token", accessToken)
    sessionStorage.setItem("oxy_session_id", currentSessionId)

    const authHeaders = { Authorization: `Bearer ${accessToken}` }

    // 3. Resolve the current account (bearer-authenticated).
    let currentAccount: Account | null = null
    try {
        const meRes = await fetch(buildApiUrl("/users/me"), {
            credentials: "include",
            headers: authHeaders,
        })
        if (meRes.ok) {
            const parsed = safeParse(
                currentUserResponseSchema,
                await meRes.json()
            )
            // `/users/me` returns the raw doc — the id field is `_id`, not `id`.
            const userId = parsed?.data?._id ?? parsed?.data?.id
            if (parsed && userId) {
                currentAccount = {
                    id: userId,
                    username: parsed.data.username,
                    email: parsed.data.email,
                    avatar: parsed.data.avatar,
                    displayName: resolveDisplayName(parsed.data),
                }
            }
        }
    } catch {
        // Fall through — handled by the guard below.
    }

    if (!currentAccount) return LOGGED_OUT_STATE

    const accounts: DeviceAccount[] = [
        { sessionId: currentSessionId, account: currentAccount, isCurrent: true },
    ]

    // 4. Enrich with sibling accounts on the same device (best-effort).
    try {
        const devRes = await fetch(
            buildAuthUrl(`/device/sessions/${currentSessionId}`),
            { credentials: "include", headers: authHeaders }
        )
        if (devRes.ok) {
            const list = safeParse(
                deviceSessionsResponseSchema,
                await devRes.json()
            )
            if (list) {
                for (const entry of list) {
                    if (!entry.user?.id) continue
                    if (entry.sessionId === currentSessionId) continue
                    if (entry.user.id === currentAccount.id) continue
                    accounts.push({
                        sessionId: entry.sessionId,
                        isCurrent: false,
                        account: {
                            id: entry.user.id,
                            username: entry.user.username,
                            email: entry.user.email,
                            avatar: entry.user.avatar,
                            displayName: resolveDisplayName(entry.user),
                        },
                    })
                }
            }
        }
    } catch {
        // Best-effort device-session enrichment — keep the current account.
    }

    return {
        isLoading: false,
        currentAccount,
        currentSessionId,
        accounts,
    }
}

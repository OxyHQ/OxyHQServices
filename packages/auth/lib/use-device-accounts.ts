import { useRef, useState } from "react"
import { buildApiUrl, buildAuthUrl } from "@/lib/oxy-api-client"
import {
    refreshAllResponseSchema,
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
     *
     * When the modern `POST /auth/refresh-all` path succeeded, each entry's
     * `authuser` field is populated so downstream chooser handlers can pass
     * it to `?authuser=N` on OAuth redirects or `refreshTokenViaCookie`
     * calls. On the legacy fallback path `authuser` is omitted.
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
    name?: { first?: string; last?: string; full?: string } | string
}): string | undefined {
    if (user.displayName) return user.displayName
    if (typeof user.name === "string") return user.name
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
 * Modern path (preferred):
 *   1. `POST /auth/refresh-all` with `credentials: "include"` and NO bearer.
 *      Server rotates every device-local `oxy_rt_${authuser}` cookie in
 *      parallel and returns one entry per VALID account (with `authuser`,
 *      `sessionId`, `accessToken`, and a minimal `user` projection
 *      containing `color` so we can theme the chooser without a follow-up
 *      `/users/me`). The active session's access token + sessionId are
 *      planted into `sessionStorage` so the chooser's continue / consent
 *      handlers can reuse them.
 *
 * Legacy fallback path (only when the server returns 404 — the modern
 * endpoint isn't deployed yet):
 *   1. `POST /auth/refresh` rotates the single `oxy_rt` cookie.
 *   2. `GET /users/me` resolves the current account.
 *   3. `GET /session/device/sessions/:sessionId` enriches with siblings.
 *
 * Both paths run AT MOST ONCE per page load (guarded by the ref in
 * `useDeviceAccounts`) because `/auth/refresh` and `/auth/refresh-all` are
 * single-use and rotate the cookies on each call.
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
    // 1. Modern multi-account path — single round-trip for every signed-in slot.
    const modern = await detectAccountsViaRefreshAll()
    if (modern !== "fallback") {
        return modern
    }
    // 2. Legacy single-account fallback (server doesn't expose /auth/refresh-all).
    return detectAccountsLegacy()
}

/**
 * Try `POST /auth/refresh-all`. Returns:
 *   - `DeviceAccountsState` when the modern endpoint resolved (success OR
 *     authoritative "no accounts"). The caller uses the result as-is.
 *   - `"fallback"` when the endpoint is unavailable (404) — the caller must
 *     fall through to the legacy path.
 */
async function detectAccountsViaRefreshAll(): Promise<DeviceAccountsState | "fallback"> {
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

    if (response.status === 404) {
        // Server hasn't shipped /auth/refresh-all yet → try legacy.
        return "fallback"
    }

    if (!response.ok) {
        // 401 / 5xx / etc. → authoritative "no signed-in session".
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
    const sorted = [...parsed.accounts].sort((a, b) => a.authuser - b.authuser)
    const current = sorted[0]
    const currentSessionId = current.sessionId

    // Plant the active slot's credentials so the chooser's continue / consent
    // handlers (which read these keys) work without a second round-trip.
    sessionStorage.setItem("oxy_access_token", current.accessToken)
    sessionStorage.setItem("oxy_session_id", currentSessionId)

    const currentAccount: Account = {
        id: current.user.id,
        username: current.user.username,
        email: current.user.email,
        avatar: current.user.avatar ?? undefined,
        displayName: resolveDisplayName(current.user),
        color: current.user.color ?? null,
    }

    const accounts: DeviceAccount[] = sorted.map((entry) => ({
        sessionId: entry.sessionId,
        isCurrent: entry.sessionId === currentSessionId,
        authuser: entry.authuser,
        account: {
            id: entry.user.id,
            username: entry.user.username,
            email: entry.user.email,
            avatar: entry.user.avatar ?? undefined,
            displayName: resolveDisplayName(entry.user),
            color: entry.user.color ?? null,
        },
    }))

    return {
        isLoading: false,
        currentAccount,
        currentSessionId,
        accounts,
    }
}

/**
 * Legacy single-account fallback. Only invoked when the modern
 * `/auth/refresh-all` endpoint is missing (404) on the server. Mirrors the
 * pre-multi-account behaviour: refresh the single `oxy_rt` cookie, decode the
 * session id, then `/users/me` + `/session/device/sessions/:sessionId`.
 */
async function detectAccountsLegacy(): Promise<DeviceAccountsState> {
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
        return LOGGED_OUT_STATE
    }

    const currentSessionId = readSessionIdFromToken(accessToken)
    if (!currentSessionId) return LOGGED_OUT_STATE
    sessionStorage.setItem("oxy_access_token", accessToken)
    sessionStorage.setItem("oxy_session_id", currentSessionId)

    const authHeaders = { Authorization: `Bearer ${accessToken}` }

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
            const userId = parsed?.data?._id ?? parsed?.data?.id
            if (parsed && userId) {
                currentAccount = {
                    id: userId,
                    username: parsed.data.username,
                    email: parsed.data.email,
                    avatar: parsed.data.avatar,
                    displayName: resolveDisplayName(parsed.data),
                    color: parsed.data.color ?? null,
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
                            color: entry.user.color ?? null,
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

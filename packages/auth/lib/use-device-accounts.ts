import { useRef, useState } from "react"
import { buildApiUrl, buildAuthUrl } from "@/lib/oxy-api-client"
import {
    meResponseSchema,
    deviceSessionsResponseSchema,
    safeParse,
} from "@/lib/schemas"
import type { Account, DeviceAccount } from "@/lib/types"

type DeviceAccountsState = {
    /** True until the session probe settles. */
    isLoading: boolean
    /** The account whose IdP session cookie is currently active (`/users/me`). */
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
 * Detect the accounts available on this device for the Google-style chooser.
 *
 * Strategy (lightest existing, cookie-authenticated calls — no FedCM browser
 * APIs, which the `Sec-Fetch-Dest: webidentity` CSRF guard makes uncallable
 * from page JS):
 *   1. `GET /users/me` resolves the CURRENT account + its `sessionId` from the
 *      IdP session cookie. A 401 / empty result means logged out → show the
 *      sign-in form.
 *   2. With that `sessionId`, `GET /session/device/sessions/:sessionId` lists
 *      every account signed in on this physical device (deduplicated per user).
 *      This is what lets the chooser show "other signed-in accounts" once
 *      multi-session lands. Best-effort: if it fails we still show the single
 *      current account.
 *
 * The fetch is kicked off once during render via a ref guard (matching the
 * existing login-form pattern) — no `useEffect` for the prop→state sync the
 * app's conventions forbid.
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
    let currentAccount: Account | null = null
    let currentSessionId: string | null = null

    try {
        const meRes = await fetch(buildApiUrl("/users/me"), {
            credentials: "include",
        })
        if (meRes.ok) {
            const parsed = safeParse(meResponseSchema, await meRes.json())
            if (parsed?.user && parsed.sessionId) {
                currentAccount = parsed.user as Account
                currentSessionId = parsed.sessionId
            }
        }
    } catch {
        // Network/parse failure — treated as logged out (sign-in form shown).
    }

    if (!currentAccount || !currentSessionId) {
        return {
            isLoading: false,
            currentAccount: null,
            currentSessionId: null,
            accounts: [],
        }
    }

    const accounts: DeviceAccount[] = [
        { sessionId: currentSessionId, account: currentAccount, isCurrent: true },
    ]

    // Enrich with any sibling accounts signed in on the same device. Failures
    // are non-fatal: the chooser still renders the current account alone.
    try {
        const devRes = await fetch(
            buildAuthUrl(`/device/sessions/${currentSessionId}`),
            { credentials: "include" }
        )
        if (devRes.ok) {
            const list = safeParse(
                deviceSessionsResponseSchema,
                await devRes.json()
            )
            if (list) {
                for (const entry of list) {
                    if (!entry.user?.id) continue
                    // Skip the current account — already added above.
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

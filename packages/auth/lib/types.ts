/**
 * Shared types for the auth app.
 */

export type Account = {
    id: string
    username?: string
    email?: string
    avatar?: string
    displayName?: string
    /**
     * The account's Bloom color preset name (e.g. `"blue"`, `"oxy"`). Used to
     * re-theme the chooser on hover/focus. `null` / `undefined` means no
     * preference — leave the base preset alone.
     */
    color?: string | null
}

/**
 * An account signed in on this device, paired with the session it belongs to.
 *
 * `isCurrent` marks the account whose session cookie is currently active at the
 * IdP (the one `/users/me` resolves to). Only the current account can be
 * continued without re-authenticating; selecting any other account funnels into
 * the sign-in form pre-filled with its username (Google-style re-auth prompt).
 *
 * `authuser` is the device-local cookie slot index (0..N-1) returned by
 * `POST /auth/refresh-all`. The chooser passes it through to the next step
 * (e.g. `?authuser=N` on OAuth redirects, or `refreshTokenViaCookie({ authuser })`
 * to mint a fresh bearer for the chosen account). Optional because the
 * legacy fallback path (single-account `/auth/refresh`) doesn't expose it —
 * in that case the chooser shows the bearer-resolved current account only.
 */
export type DeviceAccount = {
    sessionId: string
    account: Account
    isCurrent: boolean
    authuser?: number
}

export type UserInfo = {
    id: string
    username?: string
    email?: string
    avatar?: string
    displayName?: string
    name?: {
        first?: string
        last?: string
    }
}

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
 * `isCurrent` marks the account elected as the chooser's active row from the
 * refresh-all response. Every row carries a freshly minted in-memory bearer for
 * the consent action; tokens are never written to Web Storage.
 *
 * `authuser` is the device-local cookie slot index (0..N-1) returned by
 * `POST /auth/refresh-all`. The chooser can use it to re-mint a short-lived
 * bearer when the row's token has expired before the user submits consent.
 */
export type DeviceAccount = {
    sessionId: string
    account: Account
    isCurrent: boolean
    accessToken: string
    expiresAt?: string
    authuser?: number
}

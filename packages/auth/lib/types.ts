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
 * Resolved from the central `DeviceSession` (via the IdP's same-origin
 * `/api/device-accounts` feed → API `POST /auth/device/resolve`). `isCurrent`
 * marks the device's active account. Every row carries a freshly minted
 * in-memory bearer for the consent action; tokens are never written to Web
 * Storage.
 *
 * `authuser` is a DETERMINISTIC per-account index (0..N-1) the hook assigns from
 * the sorted device-account set — NOT a persistent per-slot refresh cookie
 * (those are gone). It is a client-side `/login → /authorize` selection hint
 * only, never sent to the API.
 */
export type DeviceAccount = {
    sessionId: string
    account: Account
    isCurrent: boolean
    accessToken: string
    expiresAt?: string
    authuser?: number
}

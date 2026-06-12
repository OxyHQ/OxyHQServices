/**
 * Shared types for the auth app.
 */

export type Account = {
    id: string
    username?: string
    email?: string
    avatar?: string
    displayName?: string
}

/**
 * An account signed in on this device, paired with the session it belongs to.
 *
 * `isCurrent` marks the account whose session cookie is currently active at the
 * IdP (the one `/users/me` resolves to). Only the current account can be
 * continued without re-authenticating; selecting any other account funnels into
 * the sign-in form pre-filled with its username (Google-style re-auth prompt).
 */
export type DeviceAccount = {
    sessionId: string
    account: Account
    isCurrent: boolean
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

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

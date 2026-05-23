/**
 * Shared account types and pure helper functions.
 * Used by both @oxyhq/services (React Native) and @oxyhq/auth (Web) account stores.
 */

import { translate } from '../i18n';

export interface QuickAccount {
    sessionId: string;
    userId?: string;
    username: string;
    displayName: string;
    avatar?: string;
    avatarUrl?: string;
}

/** Minimal user shape accepted by display-name helpers. Avoids importing the full User type. */
export interface DisplayNameUserShape {
    name?: string | { first?: string; last?: string; full?: string; [key: string]: unknown };
    username?: string;
    publicKey?: string;
}

/**
 * Truncate a long public key for display, e.g. `0x12345678…`.
 * Falls back to the raw key if it's too short to truncate.
 */
export const formatPublicKeyHandle = (publicKey: string): string => {
    const cleaned = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    if (cleaned.length <= 8) return `0x${cleaned}`;
    return `0x${cleaned.slice(0, 8)}…`;
};

/**
 * Resolve a friendly display name for a user.
 *
 * Order of preference:
 *  1. `name.full`, or composed `name.first name.last`
 *  2. `name` (when stored as a plain string)
 *  3. `username`
 *  4. `Account 0x12345678…` (derived from publicKey, when present)
 *  5. Translated fallback (e.g. "Unnamed")
 *
 * The translation key `common.unnamed` is used for the final fallback. If the
 * caller does not pass a locale, the default English translation is used.
 */
export const getAccountDisplayName = (
    user: DisplayNameUserShape | null | undefined,
    locale?: string,
): string => {
    if (!user) return translate(locale, 'common.unnamed');

    const { name, username, publicKey } = user;

    if (name && typeof name === 'object') {
        if (typeof name.full === 'string' && name.full.trim()) return name.full.trim();
        const first = typeof name.first === 'string' ? name.first.trim() : '';
        const last = typeof name.last === 'string' ? name.last.trim() : '';
        const composed = [first, last].filter(Boolean).join(' ').trim();
        if (composed) return composed;
    } else if (typeof name === 'string' && name.trim()) {
        return name.trim();
    }

    if (typeof username === 'string' && username.trim()) return username.trim();

    if (typeof publicKey === 'string' && publicKey.length > 0) {
        return translate(locale, 'common.accountFallback', {
            handle: formatPublicKeyHandle(publicKey),
        });
    }

    return translate(locale, 'common.unnamed');
};

/**
 * Resolve a `@handle` style identifier for a user.
 *
 * Returns the bare username when present (without the `@`), otherwise a
 * truncated public-key handle (`0x12345678…`), or `undefined` when neither is
 * available — callers can decide whether to hide the line entirely.
 */
export const getAccountFallbackHandle = (
    user: DisplayNameUserShape | null | undefined,
): string | undefined => {
    if (!user) return undefined;
    if (typeof user.username === 'string' && user.username.trim()) return user.username.trim();
    if (typeof user.publicKey === 'string' && user.publicKey.length > 0) {
        return formatPublicKeyHandle(user.publicKey);
    }
    return undefined;
};

/**
 * Build an ordered array of QuickAccounts from a map and order list.
 */
export const buildAccountsArray = (
    accounts: Record<string, QuickAccount>,
    order: string[]
): QuickAccount[] => {
    const result: QuickAccount[] = [];
    for (const id of order) {
        const account = accounts[id];
        if (account) result.push(account);
    }
    return result;
};

/**
 * Create a QuickAccount from user data returned by the API.
 *
 * @param sessionId - Session identifier
 * @param userData - Raw user object from the API
 * @param existingAccount - Previously cached account (to preserve avatarUrl if unchanged)
 * @param getFileDownloadUrl - Function to generate avatar download URL from file ID
 */
export const createQuickAccount = (
    sessionId: string,
    userData: {
        name?: string | { full?: string; first?: string; last?: string };
        username?: string;
        publicKey?: string;
        id?: string;
        _id?: { toString(): string } | string;
        avatar?: string;
    },
    existingAccount?: QuickAccount,
    getFileDownloadUrl?: (fileId: string, variant: string) => string
): QuickAccount => {
    const displayName = getAccountDisplayName(userData);
    const userId = userData.id || (typeof userData._id === 'string' ? userData._id : userData._id?.toString());

    // Preserve existing avatarUrl if avatar hasn't changed (prevents image reload)
    let avatarUrl: string | undefined;
    if (existingAccount && existingAccount.avatar === userData.avatar && existingAccount.avatarUrl) {
        avatarUrl = existingAccount.avatarUrl;
    } else if (userData.avatar && getFileDownloadUrl) {
        avatarUrl = getFileDownloadUrl(userData.avatar, 'thumb');
    }

    return {
        sessionId,
        userId,
        username: userData.username || '',
        displayName,
        avatar: userData.avatar,
        avatarUrl,
    };
};

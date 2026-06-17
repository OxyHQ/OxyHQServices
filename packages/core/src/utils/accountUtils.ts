/**
 * Shared account types and pure helper functions.
 * Used by both @oxyhq/services (React Native) and @oxyhq/auth (Web) account stores.
 */

import { translate } from '../i18n';
import type { RefreshAllAccount } from '../models/interfaces';

export interface QuickAccount {
    sessionId: string;
    userId?: string;
    username: string;
    displayName: string;
    avatar?: string;
    avatarUrl?: string;
    /**
     * Device-local account slot index, 0..N-1 (Google-style multi-account).
     * Mirrors the server's `oxy_rt_${authuser}` cookie slot. Optional so that
     * pre-multi-account QuickAccounts (sessionId-only, non-cookie auth on RN)
     * remain valid; web flows always populate it after `refreshAllSessions`.
     */
    authuser?: number;
    /**
     * Account's preferred Bloom color preset (e.g. `"blue"`, `"oxy"`). Drives
     * per-account theming in the account chooser. `null` / `undefined` means
     * the account has no preference and the base theme should be used.
     */
    color?: string | null;
}

/** Minimal user shape accepted by display-name helpers. Avoids importing the full User type. */
export interface DisplayNameUserShape {
    name?: string | { first?: string; last?: string; full?: string; [key: string]: unknown };
    /**
     * Pre-resolved display name as emitted by the server's `displayName` virtual
     * (raw `/users/me` responses). NOTE: the server virtual resolves to
     * `username || truncatedPublicKey || 'Anonymous'` — it does NOT compose the
     * structured `name`. It is therefore preferred only AFTER a real structured
     * name, so a first-name-only account never collapses to its username/key.
     */
    displayName?: string;
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
 *  1. `name.full`, or composed `name.first name.last` (FIRST-NAME-ONLY SAFE —
 *     a user with only a first name resolves to that first name, never to the
 *     lowercase username; this is the exact drift bug the auth app hit).
 *  2. `name` (when stored as a plain string)
 *  3. `displayName` (server `displayName` virtual — `username || truncatedKey`).
 *     Placed AFTER the structured name on purpose: the server virtual ignores
 *     `name`, so preferring it first would re-introduce the first-only bug.
 *  4. `username`
 *  5. `Account 0x12345678…` (derived from publicKey, when present)
 *  6. Translated fallback (e.g. "Unnamed")
 *
 * The translation key `common.unnamed` is used for the final fallback. If the
 * caller does not pass a locale, the default English translation is used.
 */
export const getAccountDisplayName = (
    user: DisplayNameUserShape | null | undefined,
    locale?: string,
): string => {
    if (!user) return translate(locale, 'common.unnamed');

    const { name, displayName, username, publicKey } = user;

    if (name && typeof name === 'object') {
        if (typeof name.full === 'string' && name.full.trim()) return name.full.trim();
        const first = typeof name.first === 'string' ? name.first.trim() : '';
        const last = typeof name.last === 'string' ? name.last.trim() : '';
        const composed = [first, last].filter(Boolean).join(' ').trim();
        if (composed) return composed;
    } else if (typeof name === 'string' && name.trim()) {
        return name.trim();
    }

    if (typeof displayName === 'string' && displayName.trim()) return displayName.trim();

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

/**
 * Merge a fresh `/auth/refresh-all` snapshot into an existing QuickAccount
 * list, preserving any cached fields (`avatarUrl`) for slots that didn't
 * change. The fresh response is canonical: the resulting list contains EXACTLY
 * the slots present in `fresh`, sorted by `authuser` ascending. Stale stored
 * accounts that no longer appear in `fresh` are dropped (the server already
 * authoritatively cleared the corresponding cookie).
 *
 * @param stored Previously persisted QuickAccount list (any order).
 * @param fresh Server's authoritative refresh-all response.
 * @returns Canonical merged list, sorted by `authuser` asc.
 */
export const mergeAccountsFromRefreshAll = (
    stored: QuickAccount[] | undefined,
    fresh: RefreshAllAccount[],
): QuickAccount[] => {
    const storedByAuthuser = new Map<number, QuickAccount>();
    if (stored) {
        for (const account of stored) {
            if (typeof account.authuser === 'number') {
                storedByAuthuser.set(account.authuser, account);
            }
        }
    }

    const merged: QuickAccount[] = fresh.map((entry) => {
        const previous = storedByAuthuser.get(entry.authuser);
        // Preserve any previously cached identity for a slot that arrives
        // without a user shape rather than overwriting it with blanks, and let
        // AuthManager's getCurrentUser() hydration refresh it on the next
        // snapshot.
        const wireUser = entry.user;
        const username = wireUser?.username ?? previous?.username ?? '';
        const displayName = getAccountDisplayName({
            name: wireUser?.name,
            username,
        });
        const avatar = wireUser?.avatar ?? previous?.avatar ?? undefined;
        const avatarUrl =
            previous && previous.avatar === avatar ? previous.avatarUrl : undefined;
        return {
            sessionId: entry.sessionId,
            userId: wireUser?.id ?? previous?.userId,
            username,
            displayName,
            avatar,
            avatarUrl,
            authuser: entry.authuser,
            color: wireUser?.color ?? previous?.color ?? null,
        };
    });

    merged.sort((a, b) => {
        const aIdx = a.authuser ?? Number.POSITIVE_INFINITY;
        const bIdx = b.authuser ?? Number.POSITIVE_INFINITY;
        return aIdx - bIdx;
    });

    return merged;
};

/**
 * Return the account's preferred Bloom color preset, or `null` if it has no
 * preference. Centralises the `color ?? null` normalisation so consumers can
 * drive per-account theming without duplicating the nullish-handling.
 */
export const getAccountColor = (account: QuickAccount): string | null => {
    return account.color ?? null;
};

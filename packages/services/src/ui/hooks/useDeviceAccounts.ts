import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getAccountDisplayName,
    getAccountFallbackHandle,
} from '@oxyhq/core';
import type { User } from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from './useI18n';
import { queryKeys } from './queries/queryKeys';

/**
 * The per-account user shape carried by a {@link DeviceAccount}. The SDK's
 * canonical {@link User} document — either the freshest `useOxy().user` (the
 * active row) or a profile resolved via `oxyServices.getUsersByIds()` (every
 * other row).
 */
export type DeviceAccountUser = User;

/**
 * One signed-in account on this device, fully hydrated for the account
 * chooser. Every entry carries real per-account `displayName` / `email` /
 * `avatarUrl` / `color` — not just the active session's user.
 */
export interface DeviceAccount {
    /** Session id used to switch to this account. */
    sessionId: string;
    /**
     * Device-local refresh-cookie slot index (0..N-1), when the underlying
     * `ClientSession` carries one (web silent-switch via
     * `refreshTokenViaCookie({ authuser })`). Absent on native.
     */
    authuser?: number;
    /** Whether this account is the currently-active session. */
    isCurrent: boolean;
    /** Friendly display name (never blank — falls back to a handle/sentinel). */
    displayName: string;
    /**
     * Real account email, or `null` when the account genuinely has none.
     * NEVER a synthesized `username@oxy.so` — a missing email stays `null` and
     * the UI falls back to the `@handle` secondary line.
     */
    email: string | null;
    /** Resolved avatar thumbnail URL, or `undefined` when the account has no avatar. */
    avatarUrl?: string;
    /** Account's preferred Bloom color preset, or `null` when unset. */
    color: string | null;
    /** The underlying per-account user payload. */
    user: DeviceAccountUser;
}

export interface UseDeviceAccountsResult {
    /** Every account signed in on this device, current one flagged `isCurrent`. */
    accounts: DeviceAccount[];
    /** True until the per-account profile fetch settles. */
    isLoading: boolean;
    /** The currently-active session id (mirrors `useOxy().activeSessionId`). */
    currentSessionId: string | null;
}

/**
 * Resolve which entries are the current account, robustly.
 *
 * Primary signal: `entry.sessionId === activeSessionId` — both are projected
 * from the same `SessionClient` state (`deviceStateToClientSessions` +
 * `activeSessionIdOf`), so this normally matches exactly. Fallbacks exist only
 * to bridge the brief window between the two sequential `updateSessions` /
 * `setActiveSessionId` calls in `OxyContext.syncFromClient`, applied only when
 * the `sessionId` match found nothing AND the user is authenticated:
 *  1. Match the live `user.id` against each entry's per-account user id.
 *  2. If still nothing and there is exactly one account, mark that one current.
 *
 * At most ONE entry is ever marked current.
 *
 * Pure & side-effect free so it is unit-testable without rendering React.
 */
export function markCurrentAccount(
    accounts: DeviceAccount[],
    activeSessionId: string | null | undefined,
    liveUserId: string | null | undefined,
    isAuthenticated: boolean,
): DeviceAccount[] {
    const bySession = accounts.map((account): DeviceAccount => ({
        ...account,
        isCurrent: Boolean(activeSessionId) && account.sessionId === activeSessionId,
    }));

    if (bySession.some((account) => account.isCurrent) || !isAuthenticated) {
        return bySession;
    }

    // No row matched by session id: fall back to the live user's id, marking at
    // most the FIRST matching entry current (never more than one).
    if (liveUserId) {
        let matched = false;
        const byUser = bySession.map((account): DeviceAccount => {
            if (!matched && account.user.id === liveUserId) {
                matched = true;
                return { ...account, isCurrent: true };
            }
            return account;
        });
        if (matched) {
            return byUser;
        }
    }

    // Authenticated, nothing matched, but there is exactly one account → it must
    // be the current one.
    if (bySession.length === 1) {
        return [{ ...bySession[0], isCurrent: true }];
    }

    return bySession;
}

/**
 * Resolve every account signed in on this device for the unified account
 * switcher, with real per-account name / email / avatar / color.
 *
 * ## Data source (server-authoritative via `SessionClient`)
 *
 * The device account SET is `useOxy().sessions` — a `ClientSession[]`
 * projected by `OxyContext.syncFromClient` from the server-authoritative
 * `SessionClient` device state (see `deviceStateToClientSessions` in
 * `@oxyhq/core`). Each `ClientSession` carries only `sessionId` + `userId` (no
 * profile fields), so this hook additionally fetches every account's profile
 * via `oxyServices.getUsersByIds()` and hydrates each row from the result.
 *
 * The ACTIVE session's row always uses `useOxy().user` directly rather than
 * the fetched map — it is already loaded and is the freshest copy (kept live
 * by every profile-mutating flow), so there is no reason to wait on the batch
 * fetch for it. Every OTHER row is hydrated once its profile resolves.
 *
 * This supersedes the retired `oxyServices.refreshAllSessions()` cross-domain
 * `oxy_rt` cookie path — the device account set is now sourced from the
 * `SessionClient` alone, on every platform, with no host-sniffing or
 * shared-apex/local-fallback dichotomy.
 *
 * ## Error handling
 *
 * `getUsersByIds()` already resolves to `[]` on a failed chunk (logged
 * internally) rather than throwing — see its doc comment in
 * `OxyServices.user.ts`. Accounts whose profile could not be resolved are
 * simply omitted from the list (except the active one, which never depends on
 * this fetch) until a subsequent fetch succeeds.
 */
export function useDeviceAccounts(): UseDeviceAccountsResult {
    const {
        oxyServices,
        sessions,
        activeSessionId,
        user,
        isAuthenticated,
    } = useOxy();
    const { locale } = useI18n();

    // Every distinct account id carried by the device's session set, sorted for
    // a stable query key regardless of session ordering.
    const accountIds = useMemo<string[]>(() => {
        const ids = new Set<string>();
        for (const session of sessions ?? []) {
            if (session.userId) {
                ids.add(session.userId);
            }
        }
        return Array.from(ids).sort();
    }, [sessions]);

    const profilesQuery = useQuery({
        queryKey: queryKeys.users.list(accountIds),
        queryFn: () => oxyServices.getUsersByIds(accountIds),
        enabled: isAuthenticated && accountIds.length > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes — matches useUserProfile's convention
        gcTime: 30 * 60 * 1000, // 30 minutes
    });

    const profilesById = useMemo<Map<string, User>>(() => {
        const map = new Map<string, User>();
        for (const profile of profilesQuery.data ?? []) {
            map.set(profile.id, profile);
        }
        return map;
    }, [profilesQuery.data]);

    const accounts = useMemo<DeviceAccount[]>(() => {
        const resolveAvatarUrl = (avatar: string | null | undefined): string | undefined =>
            avatar ? oxyServices.getFileDownloadUrl(avatar, 'thumb') : undefined;

        const toDeviceAccount = (
            sessionId: string,
            authuser: number | undefined,
            accountUser: User,
        ): DeviceAccount => {
            const displayName = getAccountDisplayName(accountUser, locale);
            const handle = getAccountFallbackHandle(accountUser);
            const secondaryHandle = handle ? `@${handle}` : null;
            return {
                sessionId,
                authuser,
                isCurrent: sessionId === activeSessionId,
                displayName,
                // Real email, or null (NEVER synthesized). The UI uses the
                // `@handle` line only when email is genuinely absent.
                email: accountUser.email ?? secondaryHandle,
                avatarUrl: resolveAvatarUrl(accountUser.avatar),
                color: accountUser.color ?? null,
                user: accountUser,
            };
        };

        // The signed-in user must ALWAYS be represented, even before the device
        // session set has synced (e.g. immediately after cold boot). Synthesize
        // a single current row from the live `useOxy().user` in that case.
        const liveUserRow = (): DeviceAccount[] => {
            if (!isAuthenticated || !user || !activeSessionId) {
                return [];
            }
            return [toDeviceAccount(activeSessionId, undefined, user)];
        };

        const built = (sessions ?? []).flatMap((session): DeviceAccount[] => {
            const isCurrent = session.sessionId === activeSessionId;
            // The active row always uses the live `user` — freshest available —
            // regardless of whether the batch profile fetch has resolved yet.
            const accountUser: User | undefined = isCurrent && user
                ? user
                : (session.userId ? profilesById.get(session.userId) : undefined);
            if (!accountUser) {
                return [];
            }
            return [toDeviceAccount(session.sessionId, session.authuser, accountUser)];
        });

        const flagged = markCurrentAccount(
            built,
            activeSessionId,
            user?.id ?? null,
            isAuthenticated,
        );

        if (flagged.length === 0) {
            return liveUserRow();
        }
        return flagged;
    }, [sessions, activeSessionId, user, isAuthenticated, profilesById, locale, oxyServices]);

    return {
        accounts,
        isLoading: isAuthenticated && accountIds.length > 0 && profilesQuery.isLoading,
        currentSessionId: activeSessionId ?? null,
    };
}

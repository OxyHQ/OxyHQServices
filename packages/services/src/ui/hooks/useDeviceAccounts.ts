import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getAccountDisplayName,
    getAccountFallbackHandle,
} from '@oxyhq/core';
import type {
    RefreshAllAccountUser,
    User,
    ClientSession,
} from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from './useI18n';
import { queryKeys } from './queries/queryKeys';

/**
 * The per-account user shape carried by a {@link DeviceAccount}. Either:
 *  - the minimal projection returned by `POST /auth/refresh-all`
 *    ({@link RefreshAllAccountUser}, the shared apex path), or
 *  - the SDK's canonical {@link User} document (the active row on the local
 *    fallback path, which already has the full user loaded in `useOxy()`).
 *
 * Both satisfy `getAccountDisplayName`'s `DisplayNameUserShape`, so display
 * resolution is uniform across paths.
 */
export type DeviceAccountUser = RefreshAllAccountUser | User;

/**
 * One signed-in account on this device, fully hydrated for the account
 * chooser. Unlike the earlier device-only switcher behaviour (which only
 * carried the ACTIVE session's user), EVERY entry here carries real per-account
 * `displayName` / `email` / `avatarUrl` / `color`.
 */
export interface DeviceAccount {
    /** Session id used to switch to this account on native. */
    sessionId: string;
    /**
     * Device-local refresh-cookie slot index (0..N-1), present only on the
     * shared apex path. Web silent-switch (`refreshTokenViaCookie({ authuser }`)
     * keys off this; absent on the local fallback and on native.
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
    /** The underlying per-account user payload (shared projection or full User). */
    user: DeviceAccountUser;
}

export interface UseDeviceAccountsResult {
    /** Every account signed in on this device, current one(s) flagged `isCurrent`. */
    accounts: DeviceAccount[];
    /** True until the first detection settles. */
    isLoading: boolean;
    /** The currently-active session id (mirrors `useOxy().activeSessionId`). */
    currentSessionId: string | null;
    /**
     * `true` when the list came from the shared apex path
     * (`refreshAllSessions()` returned >0 accounts — the cross-domain SSO cookie
     * set on `*.oxy.so`). `false` when it came from the local `useOxy()`
     * fallback (native, or cross-domain web where the apex cookie is absent).
     */
    fromSharedApex: boolean;
}

/**
 * Resolve which entries are the current account, robustly.
 *
 * Primary signal: `entry.sessionId === activeSessionId`. On the web shared-apex
 * path, `refreshAllSessions()` returns SERVER-side session ids that may not
 * equal the locally-stored `activeSessionId` (a different storage namespace /
 * server perspective), so a pure `sessionId` match can flag NO row as current —
 * the bug that surfaced as "Not signed in" even while authenticated.
 *
 * Fallbacks, applied only when the `sessionId` match found nothing AND the user
 * is authenticated:
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
    // be the current one (single-account shared-apex / cross-domain case).
    if (bySession.length === 1) {
        return [{ ...bySession[0], isCurrent: true }];
    }

    return bySession;
}

/**
 * Resolve every account signed in on this device for the unified account
 * switcher, with real per-account name / email / avatar / color.
 *
 * ## Data sources (web vs native)
 *
 * - **Web on a `*.oxy.so` host** → `oxyServices.refreshAllSessions()` returns
 *   the full apex device-account list (identical to what `auth.oxy.so` sees,
 *   because the `Domain=oxy.so` refresh cookies reach `api.oxy.so`). Used
 *   directly — this is the `fromSharedApex: true` path.
 * - **Cross-domain web (non-`oxy.so` apex)** OR **native (no browser cookies)**
 *   → `refreshAllSessions()` yields `{ accounts: [] }` (the apex cookies never
 *   reach the request: cross-domain by `Domain`, native by having no cookie
 *   jar at all; a 401 is also normalised to `{ accounts: [] }` inside the
 *   core mixin). In that case we FALL BACK to the SDK's local multi-account
 *   list from `useOxy()` (`sessions` + `activeSessionId` + the active `user`).
 *   This is the `fromSharedApex: false` path.
 *
 * The fallback decision is purely data-driven: **if `refreshAllSessions()`
 * returns >0 accounts, use the shared path; otherwise fall back to local
 * `useOxy()` sessions.** No host sniffing is needed — the cookie scoping does
 * the discrimination for us, and the same code path works on native (where the
 * fetch returns `{ accounts: [] }`).
 *
 * ## Why React Query (not a `useRef`/`useState` start-once like the auth app)
 *
 * The auth app's `use-device-accounts.ts` hand-rolls a `startedRef` because it
 * has no React Query. The SDK does. `refreshAllSessions()` ROTATES single-use
 * refresh cookies on every call, so it must run AT MOST ONCE per page load:
 * we model that with `staleTime: Infinity` + `gcTime: Infinity` +
 * `refetchOnWindowFocus/Reconnect/Mount: false` + `retry: false`. React Query
 * dedupes concurrent mounts and caches the single result for the page's
 * lifetime — the exact "run once" guarantee the auth app documents, but
 * without the manual ref/state machinery.
 *
 * ## Validation note (intentionally NO zod re-parse)
 *
 * The auth app's hook calls `fetch` directly, so IT must `safeParse` the wire
 * response with `@oxyhq/contracts`. This hook calls
 * `oxyServices.refreshAllSessions()`, whose core mixin ALREADY validates and
 * normalises the wire response (skips entries missing required fields,
 * normalises `authuser` null→0, builds the `RefreshAllAccountUser` shape) — the
 * mixin is the single source of truth. Re-validating the SDK's own already-typed
 * output here would be redundant double-validation, so we do not re-parse.
 *
 * ## Error handling
 *
 * `refreshAllSessions()` already maps 401/404/abort to `{ accounts: [] }`
 * internally. Any OTHER failure (network, 5xx) propagates as a thrown error and
 * is surfaced by React Query (`query.isError`) — never swallowed. Callers that
 * don't care can ignore it; the hook still returns the local fallback list so
 * the chooser stays usable.
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

    // Stable, per-API-origin query key. `refreshAllSessions` resolves against
    // the session base url derived from `getBaseURL()`, so keying on it scopes
    // the cached result to the API the provider is pointed at.
    const baseURL = oxyServices.getBaseURL();

    const query = useQuery({
        queryKey: [...queryKeys.accounts.all, 'deviceAccounts', baseURL] as const,
        queryFn: () => oxyServices.refreshAllSessions(),
        // Only attempt the shared apex path while signed in. When logged out
        // there is nothing to enumerate and the fallback (also empty) is used.
        enabled: isAuthenticated,
        // Single-use cookie rotation → run at most once per page load.
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        retry: false,
    });

    const sharedAccounts = query.data?.accounts ?? [];
    const fromSharedApex = sharedAccounts.length > 0;

    const accounts = useMemo<DeviceAccount[]>(() => {
        const resolveAvatarUrl = (avatar: string | null | undefined): string | undefined =>
            avatar ? oxyServices.getFileDownloadUrl(avatar, 'thumb') : undefined;

        // Build a single current-account row from the live `useOxy().user`. Used
        // as a last-resort fallback when neither the shared-apex probe nor the
        // local session store yielded a row but the user IS authenticated (e.g.
        // a cross-domain host where the apex probe returned empty before the
        // local session store hydrated). The signed-in user must ALWAYS be
        // represented. Email is the REAL email or the `@handle` line — never a
        // synthesized `username@oxy.so`.
        const liveUserRow = (): DeviceAccount[] => {
            if (!isAuthenticated || !user || !activeSessionId) {
                return [];
            }
            const displayName = getAccountDisplayName(user, locale);
            const handle = getAccountFallbackHandle(user);
            const secondaryHandle = handle ? `@${handle}` : null;
            return [{
                sessionId: activeSessionId,
                authuser: undefined,
                isCurrent: true,
                displayName,
                email: user.email ?? secondaryHandle,
                avatarUrl: resolveAvatarUrl(user.avatar),
                color: user.color ?? null,
                user,
            }];
        };

        let built: DeviceAccount[];

        if (fromSharedApex) {
            // Shared apex path: every entry carries a real per-account user.
            built = sharedAccounts.flatMap((entry): DeviceAccount[] => {
                if (!entry.user) {
                    return [];
                }
                const accountUser: DeviceAccountUser = entry.user;
                const displayName = getAccountDisplayName(accountUser, locale);
                const handle = getAccountFallbackHandle(accountUser);
                const email = entry.user.email ?? null;
                const secondaryHandle = handle ? `@${handle}` : null;
                return [{
                    sessionId: entry.sessionId,
                    authuser: entry.authuser,
                    // Provisional; finalised by `markCurrentAccount` below so the
                    // shared-apex path is robust to server/local session-id skew.
                    isCurrent: false,
                    displayName,
                    // Real email, or null (NEVER synthesized). The UI uses the
                    // `@handle` line only when email is genuinely absent.
                    email: email ?? secondaryHandle,
                    avatarUrl: resolveAvatarUrl(entry.user.avatar),
                    color: entry.user.color ?? null,
                    user: accountUser,
                }];
            });
        } else {
            // Local fallback path: build from the SDK's multi-session store. The
            // active session row gets the full loaded `user`; inactive fallback
            // rows carry only what the `ClientSession` exposes (no synthesized
            // identity — they show the active user's data only when active).
            built = (sessions ?? []).flatMap((session: ClientSession): DeviceAccount[] => {
                const isCurrent = session.sessionId === activeSessionId;
                if (!isCurrent || !user) {
                    return [];
                }
                const accountUser: DeviceAccountUser = user;
                const displayName = getAccountDisplayName(accountUser, locale);
                const handle = getAccountFallbackHandle(accountUser);
                const email = user.email ?? null;
                const secondaryHandle = handle ? `@${handle}` : null;
                return [{
                    sessionId: session.sessionId,
                    authuser: session.authuser,
                    isCurrent,
                    displayName,
                    email: email ?? secondaryHandle,
                    avatarUrl: resolveAvatarUrl(user.avatar),
                    color: user.color ?? null,
                    user: accountUser,
                }];
            });
        }

        // Robust current-account detection: tolerate server/local session-id
        // skew on the shared-apex path by falling back to the live user's id and
        // the single-account heuristic.
        const flagged = markCurrentAccount(
            built,
            activeSessionId,
            user?.id ?? null,
            isAuthenticated,
        );

        // The signed-in user must ALWAYS be represented. If detection produced
        // an empty list yet the user is authenticated, synthesize a single
        // current row from the live `useOxy().user`.
        if (flagged.length === 0) {
            return liveUserRow();
        }
        return flagged;
    }, [
        fromSharedApex,
        sharedAccounts,
        sessions,
        activeSessionId,
        user,
        isAuthenticated,
        locale,
        oxyServices,
    ]);

    return {
        accounts,
        // `isLoading` only reflects the shared probe while it's the relevant
        // source. Once we know we're on the fallback (probe settled with 0
        // accounts) the local list is synchronously available.
        isLoading: isAuthenticated && query.isLoading,
        currentSessionId: activeSessionId ?? null,
        fromSharedApex,
    };
}

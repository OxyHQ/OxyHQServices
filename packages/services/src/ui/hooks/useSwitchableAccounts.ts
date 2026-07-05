import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    getAccountDisplayName,
    getAccountFallbackHandle,
} from '@oxyhq/core';
import type {
    User,
    AccountNode,
    AccountRelationship,
    AccountKind,
    AccountMember,
} from '@oxyhq/core';
import { useOxy } from '../context/OxyContext';
import { useI18n } from './useI18n';
import { queryKeys } from './queries/queryKeys';

/**
 * The per-account user shape carried by a {@link SwitchableAccount}. The SDK's
 * canonical {@link User} document — either the freshest `useOxy().user` (the
 * active row), a profile resolved via `oxyServices.getUsersByIds()` (every other
 * device row), or the `account` document embedded in an account-graph node.
 */
export type SwitchableAccountUser = User;

/**
 * One account the signed-in user can switch INTO, in the uniform switch model.
 *
 * A switchable account is either a device sign-in, an account-graph node (owned
 * org / shared-with-you), or BOTH (an account that has been switched into
 * becomes a device session while still being a graph node — the two are deduped
 * into a single row). Every row carries a canonical `accountId` (the uniform
 * switch key passed to `switchToAccount`); `sessionId` is present IFF the
 * account is currently signed in on THIS device.
 */
export interface SwitchableAccount {
    /**
     * Canonical account id (the underlying `User._id`). The single key EVERY
     * switch uses — `switchToAccount(accountId)`. Always present.
     */
    accountId: string;
    /**
     * Device session id, present IFF this account is signed in on THIS device.
     * Absent for a graph account not yet switched into. Used only for
     * device-scoped actions (per-account sign-out via `removeSession`); switching
     * ALWAYS goes through `switchToAccount(accountId)`.
     */
    sessionId?: string;
    /**
     * Device-local refresh-cookie slot index (0..N-1), when the underlying
     * `ClientSession` carries one (web silent-switch). Absent on native and for
     * graph-only rows.
     */
    authuser?: number;
    /** Whether this account is the currently-active one. */
    isCurrent: boolean;
    /** Whether this account is signed in on THIS device (has a `sessionId`). */
    onDevice: boolean;
    /**
     * The caller's relationship to this account when it appears in the account
     * graph: `self` (the caller's own personal account), `owner` (an org/project/
     * bot the caller owns), or `member` (shared with the caller). Absent for an
     * independent device sign-in that is NOT in the active account's graph.
     */
    relationship?: AccountRelationship;
    /** Account classification (personal/organization/…). Cosmetic badge only. */
    kind?: AccountKind;
    /** Parent account id for 2-level tree grouping, or `null` for a root. */
    parentAccountId?: string | null;
    /**
     * The caller's effective membership (role + permissions) in this account when
     * it appears in the graph, or `null`/absent otherwise. Use `permissions` to
     * gate per-account settings UI.
     */
    callerMembership?: AccountMember | null;
    /** Friendly display name (never blank — falls back to a handle/sentinel). */
    displayName: string;
    /**
     * Real account email, or `null` when the account genuinely has none. NEVER a
     * synthesized `username@oxy.so` — a missing email falls back to the `@handle`
     * secondary line.
     */
    email: string | null;
    /** Resolved avatar thumbnail URL, or `undefined` when the account has no avatar. */
    avatarUrl?: string;
    /** Account's preferred Bloom color preset, or `null` when unset. */
    color: string | null;
    /** The underlying per-account user payload. */
    user: SwitchableAccountUser;
}

export interface UseSwitchableAccountsResult {
    /** Every switchable account (device sign-ins + linked graph accounts). */
    accounts: SwitchableAccount[];
    /** True until the per-device-account profile fetch settles. */
    isLoading: boolean;
    /** The currently-active session id (mirrors `useOxy().activeSessionId`). */
    currentSessionId: string | null;
}

/** The minimal device-session shape {@link buildSwitchableAccounts} reads. */
export interface SwitchableSessionInput {
    sessionId: string;
    userId?: string;
    authuser?: number;
}

export interface BuildSwitchableAccountsInput {
    /** Device sessions projected from the server-authoritative `SessionClient`. */
    sessions: SwitchableSessionInput[];
    /** The currently-active session id. */
    activeSessionId: string | null;
    /** The freshest copy of the active account's user (`useOxy().user`). */
    liveUser: User | null;
    isAuthenticated: boolean;
    /** The account graph under the active account (`useOxy().accounts`). */
    graph: AccountNode[];
    /** Per-device-account profiles resolved via `getUsersByIds()`, keyed by id. */
    profilesById: Map<string, User>;
    locale: string;
    /** Resolves a file id to a thumbnail URL (bound to `getFileDownloadUrl`). */
    resolveAvatarUrl: (avatar: string | null | undefined) => string | undefined;
}

/**
 * Resolve which entries are the current account, robustly.
 *
 * Primary signal: `entry.sessionId === activeSessionId` — both are projected
 * from the same `SessionClient` state, so this normally matches exactly.
 * Fallbacks exist only to bridge the brief window between the two sequential
 * `updateSessions` / `setActiveSessionId` calls in `OxyContext.syncFromClient`,
 * applied only when the `sessionId` match found nothing AND the user is
 * authenticated:
 *  1. Match the live `user.id` against each entry's per-account user id.
 *  2. If still nothing and there is exactly one account, mark that one current.
 *
 * At most ONE entry is ever marked current. Runs over DEVICE rows only (graph
 * rows are never active — the active account is always a device session), so the
 * single-account fallback counts device rows.
 *
 * Pure & side-effect free so it is unit-testable without rendering React.
 */
export function markCurrentAccount(
    accounts: SwitchableAccount[],
    activeSessionId: string | null | undefined,
    liveUserId: string | null | undefined,
    isAuthenticated: boolean,
): SwitchableAccount[] {
    const bySession = accounts.map((account): SwitchableAccount => ({
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
        const byUser = bySession.map((account): SwitchableAccount => {
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
 * Pure union of device sign-ins and account-graph nodes into the flat
 * {@link SwitchableAccount}[] the switchers render. Extracted so the merge /
 * dedup semantics are unit-testable without rendering React.
 *
 * Order: device rows first (in session order, current flagged), then graph-only
 * rows (in graph order). An account present as BOTH a device session and a graph
 * node is deduped into ONE device row enriched with the graph metadata
 * (relationship / kind / parent / membership).
 */
export function buildSwitchableAccounts(input: BuildSwitchableAccountsInput): SwitchableAccount[] {
    const {
        sessions,
        activeSessionId,
        liveUser,
        isAuthenticated,
        graph,
        profilesById,
        locale,
        resolveAvatarUrl,
    } = input;

    // Nothing is switchable when signed out — never surface a lingering device
    // session or graph node once the user is unauthenticated.
    if (!isAuthenticated) {
        return [];
    }

    const toRow = (
        accountUser: User,
        opts: {
            sessionId?: string;
            authuser?: number;
            relationship?: AccountRelationship;
            kind?: AccountKind;
            parentAccountId?: string | null;
            callerMembership?: AccountMember | null;
        },
    ): SwitchableAccount => {
        const displayName = getAccountDisplayName(accountUser, locale);
        const handle = getAccountFallbackHandle(accountUser);
        const secondaryHandle = handle ? `@${handle}` : null;
        return {
            accountId: accountUser.id?.toString() ?? '',
            sessionId: opts.sessionId,
            authuser: opts.authuser,
            isCurrent: Boolean(opts.sessionId) && opts.sessionId === activeSessionId,
            onDevice: Boolean(opts.sessionId),
            relationship: opts.relationship,
            kind: opts.kind,
            parentAccountId: opts.parentAccountId,
            callerMembership: opts.callerMembership,
            displayName,
            // Real email, or the `@handle` fallback (NEVER synthesized).
            email: accountUser.email ?? secondaryHandle,
            avatarUrl: resolveAvatarUrl(accountUser.avatar),
            color: accountUser.color ?? null,
            user: accountUser,
        };
    };

    // --- Device rows ---
    const built = sessions.flatMap((session): SwitchableAccount[] => {
        const isCurrent = session.sessionId === activeSessionId;
        // The active row always uses the live `user` — freshest available —
        // regardless of whether the batch profile fetch has resolved yet.
        const accountUser: User | undefined = isCurrent && liveUser
            ? liveUser
            : (session.userId ? profilesById.get(session.userId) : undefined);
        if (!accountUser) {
            return [];
        }
        return [toRow(accountUser, { sessionId: session.sessionId, authuser: session.authuser })];
    });

    const flagged = markCurrentAccount(built, activeSessionId, liveUser?.id ?? null, isAuthenticated);

    // The signed-in user must ALWAYS be represented, even before the device
    // session set has synced (e.g. immediately after cold boot). Synthesize a
    // single current row from the live `useOxy().user` in that case.
    const deviceRows = flagged.length === 0 && isAuthenticated && liveUser && activeSessionId
        ? [toRow(liveUser, { sessionId: activeSessionId })]
        : flagged;

    // --- Merge graph nodes, deduping by account id ---
    const byAccountId = new Map<string, SwitchableAccount>();
    const order: string[] = [];
    const remember = (row: SwitchableAccount): void => {
        if (!row.accountId || byAccountId.has(row.accountId)) {
            return;
        }
        byAccountId.set(row.accountId, row);
        order.push(row.accountId);
    };

    for (const row of deviceRows) {
        remember(row);
    }

    for (const node of graph) {
        const existing = byAccountId.get(node.accountId);
        if (existing) {
            // On-device account that is ALSO in the graph: enrich the device row
            // with graph metadata; keep its (freshest) profile + sessionId.
            byAccountId.set(node.accountId, {
                ...existing,
                relationship: node.relationship,
                kind: node.kind,
                parentAccountId: node.parentAccountId,
                callerMembership: node.callerMembership,
            });
            continue;
        }
        // Graph-only account (owned org / shared, not yet a device session).
        remember(toRow(node.account, {
            relationship: node.relationship,
            kind: node.kind,
            parentAccountId: node.parentAccountId,
            callerMembership: node.callerMembership,
        }));
    }

    return order.flatMap((id) => {
        const row = byAccountId.get(id);
        return row ? [row] : [];
    });
}

/**
 * Resolve every account the signed-in user can switch into — device sign-ins
 * AND linked graph accounts (owned orgs + shared-with-you) — as one flat list
 * with real per-account name / email / avatar / color, deduped by account id.
 *
 * ## Data sources
 *
 * - Device sign-ins: `useOxy().sessions` — a `ClientSession[]` projected by
 *   `OxyContext.syncFromClient` from the server-authoritative `SessionClient`.
 *   Each session carries only `sessionId` + `userId`, so this hook additionally
 *   fetches every device account's profile via `oxyServices.getUsersByIds()`.
 *   The ACTIVE row always uses `useOxy().user` directly (the freshest copy).
 * - Linked accounts: `useOxy().accounts` — the `AccountNode[]` graph the context
 *   loads from `GET /accounts`. Each node already embeds its `account` `User`
 *   document, so graph-only rows need no extra fetch.
 *
 * An account present as BOTH a device session and a graph node is deduped into
 * ONE row (see {@link buildSwitchableAccounts}). EVERY row switches the same
 * way — through `useOxy().switchToAccount(row.accountId)`.
 *
 * ## Error handling
 *
 * `getUsersByIds()` resolves to `[]` on a failed chunk (logged internally)
 * rather than throwing. Device accounts whose profile could not be resolved are
 * omitted until a subsequent fetch succeeds (except the active one, which never
 * depends on this fetch); graph accounts are unaffected.
 */
export function useSwitchableAccounts(): UseSwitchableAccountsResult {
    const {
        oxyServices,
        sessions,
        activeSessionId,
        user,
        isAuthenticated,
        accounts: graph,
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

    const accounts = useMemo<SwitchableAccount[]>(
        () => buildSwitchableAccounts({
            sessions: sessions ?? [],
            activeSessionId: activeSessionId ?? null,
            liveUser: user ?? null,
            isAuthenticated,
            graph: graph ?? [],
            profilesById,
            locale,
            resolveAvatarUrl: (avatar) =>
                (avatar ? oxyServices.getFileDownloadUrl(avatar, 'thumb') : undefined),
        }),
        [sessions, activeSessionId, user, isAuthenticated, graph, profilesById, locale, oxyServices],
    );

    return {
        accounts,
        isLoading: isAuthenticated && accountIds.length > 0 && profilesQuery.isLoading,
        currentSessionId: activeSessionId ?? null,
    };
}

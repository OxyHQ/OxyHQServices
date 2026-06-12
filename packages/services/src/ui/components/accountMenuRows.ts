import type { User, ClientSession } from '@oxyhq/core';
import { getAccountDisplayName, getAccountFallbackHandle } from '@oxyhq/core';

export interface AccountRow {
    sessionId: string;
    isActive: boolean;
    displayName: string;
    secondary: string | null;
    avatarUri?: string;
    user: User | null;
}

export interface BuildAccountRowsInput {
    sessions: ClientSession[] | null | undefined;
    activeSessionId: string | null | undefined;
    user: User | null | undefined;
    locale: string;
    getAvatarUrl: (avatarId: string) => string;
}

/**
 * Pure builder for `AccountMenu` rows. Extracted so the multi-account display
 * logic can be unit-tested without rendering React Native.
 *
 * Each `sessions[i]` becomes one row. Only the row matching `activeSessionId`
 * carries the loaded `user` payload — the others are placeholders shown by
 * fallback handle. This mirrors how `OxyContext` only hydrates one user at a
 * time.
 */
export function buildAccountRows({
    sessions,
    activeSessionId,
    user,
    locale,
    getAvatarUrl,
}: BuildAccountRowsInput): AccountRow[] {
    return (sessions ?? []).map((session: ClientSession) => {
        const isActive = session.sessionId === activeSessionId;
        const candidate: Partial<User> | null = isActive ? user ?? null : null;
        const displayName = getAccountDisplayName(
            candidate ?? { username: undefined },
            locale,
        );
        const handle = getAccountFallbackHandle(candidate ?? { username: undefined });
        const secondary = (candidate?.email)
            ?? (handle && candidate?.username ? `@${handle}` : handle)
            ?? null;
        const avatarUri = candidate?.avatar
            ? getAvatarUrl(candidate.avatar)
            : undefined;
        return {
            sessionId: session.sessionId,
            isActive,
            displayName,
            secondary,
            avatarUri,
            user: isActive ? user ?? null : null,
        };
    });
}

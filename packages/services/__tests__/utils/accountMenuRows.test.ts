/**
 * Tests for `buildAccountRows` — the pure builder consumed by `AccountMenu`
 * to render the multi-account list.
 *
 * `AccountMenu` is the unified surface that replaced the separate
 * `AccountSwitcher`/`AccountOverview`/`AccountCenter`/`AccountSettings`
 * screens. A regression here would either:
 *   - hide an account that should be switchable, or
 *   - show stale name/email for an inactive session that shouldn't render
 *     user data (we only hydrate one `user` at a time in `OxyContext`).
 */

import type { ClientSession, User } from '@oxyhq/core';
import { buildAccountRows } from '../../src/ui/components/accountMenuRows';

const mockGetAvatarUrl = (avatarId: string) => `https://cdn.example.com/${avatarId}/thumb`;

const session = (sessionId: string, overrides: Partial<ClientSession> = {}): ClientSession => ({
    sessionId,
    deviceId: `dev-${sessionId}`,
    expiresAt: '2099-01-01T00:00:00.000Z',
    lastActive: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const fullUser = (overrides: Partial<User> = {}): User => ({
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    avatar: 'avatar-1',
    displayName: 'Alice',
    ...overrides,
} as User);

describe('buildAccountRows', () => {
    it('returns an empty list for zero sessions', () => {
        const rows = buildAccountRows({
            sessions: [],
            activeSessionId: null,
            user: null,
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });
        expect(rows).toEqual([]);
    });

    it('returns an empty list when sessions is null', () => {
        const rows = buildAccountRows({
            sessions: null,
            activeSessionId: 'sess-1',
            user: fullUser(),
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });
        expect(rows).toEqual([]);
    });

    it('hydrates only the active row with the loaded user, leaves others as placeholders', () => {
        const rows = buildAccountRows({
            sessions: [session('sess-1'), session('sess-2'), session('sess-3')],
            activeSessionId: 'sess-2',
            user: fullUser(),
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });

        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.sessionId)).toEqual(['sess-1', 'sess-2', 'sess-3']);
        expect(rows.map((r) => r.isActive)).toEqual([false, true, false]);

        // Active row carries the loaded user payload + email + avatar URL.
        const active = rows[1];
        expect(active.user).not.toBeNull();
        // `getAccountDisplayName` prefers `username` over `displayName`.
        expect(active.displayName).toBe('alice');
        expect(active.secondary).toBe('alice@example.com');
        expect(active.avatarUri).toBe('https://cdn.example.com/avatar-1/thumb');

        // Inactive rows have no user payload and no avatar URL.
        for (const inactive of [rows[0], rows[2]]) {
            expect(inactive.user).toBeNull();
            expect(inactive.avatarUri).toBeUndefined();
        }
    });

    it('falls back to handle when the active user has no email', () => {
        const rows = buildAccountRows({
            sessions: [session('sess-1')],
            activeSessionId: 'sess-1',
            user: fullUser({ email: undefined, username: 'bob' }),
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });

        const active = rows[0];
        expect(active.isActive).toBe(true);
        // No email → secondary derives from username handle "@bob".
        expect(active.secondary).toBe('@bob');
    });

    it('produces no avatar URL when the active user has no avatar', () => {
        const rows = buildAccountRows({
            sessions: [session('sess-1')],
            activeSessionId: 'sess-1',
            user: fullUser({ avatar: undefined }),
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });

        expect(rows[0].avatarUri).toBeUndefined();
    });

    it('marks no row as active when activeSessionId does not match any session', () => {
        const rows = buildAccountRows({
            sessions: [session('sess-1'), session('sess-2')],
            activeSessionId: 'sess-missing',
            user: fullUser(),
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });

        expect(rows.every((r) => !r.isActive)).toBe(true);
        expect(rows.every((r) => r.user === null)).toBe(true);
    });

    it('preserves session order from the input array', () => {
        const rows = buildAccountRows({
            sessions: [session('c'), session('a'), session('b')],
            activeSessionId: 'a',
            user: fullUser(),
            locale: 'en',
            getAvatarUrl: mockGetAvatarUrl,
        });
        expect(rows.map((r) => r.sessionId)).toEqual(['c', 'a', 'b']);
    });
});

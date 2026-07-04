/**
 * Tests for `buildAccountRows` — the pure builder consumed by `AccountSwitcher`
 * to render the multi-account list.
 *
 * `AccountSwitcher` is the single unified account-switching surface. The unified
 * account switcher hydrates EVERY row (not just the active one) with real
 * name/email/avatar/color via `useDeviceAccounts()`.
 *
 * `buildAccountRows` is now a thin, pure projection of the already-hydrated
 * `DeviceAccount[]` the hook produces. A regression here would either:
 *   - drop an account that should be switchable, or
 *   - show a stale/fake secondary line (e.g. a synthesized `username@oxy.so`
 *     instead of the real email or the `@handle` fallback).
 */

import type { DeviceAccount, DeviceAccountUser } from '../../src/ui/hooks/useDeviceAccounts';
import { buildAccountRows } from '../../src/ui/components/accountMenuRows';

const deviceAccount = (
    overrides: Partial<DeviceAccount> & Pick<DeviceAccount, 'sessionId'>,
): DeviceAccount => {
    const user: DeviceAccountUser = overrides.user ?? { id: 'u', username: 'u' };
    return {
        authuser: undefined,
        isCurrent: false,
        displayName: 'Unnamed',
        email: null,
        avatarUrl: undefined,
        color: null,
        user,
        ...overrides,
    };
};

describe('buildAccountRows', () => {
    it('returns an empty list for zero accounts', () => {
        expect(buildAccountRows({ accounts: [] })).toEqual([]);
    });

    it('hydrates EVERY row (active and inactive) with real name/email/avatar', () => {
        const rows = buildAccountRows({
            accounts: [
                deviceAccount({
                    sessionId: 'sess-1',
                    authuser: 0,
                    isCurrent: false,
                    displayName: 'Alice',
                    email: 'alice@example.com',
                    avatarUrl: 'https://cdn.example.com/avatar-1/thumb',
                    color: 'blue',
                    user: { id: 'user-1', username: 'alice', email: 'alice@example.com' },
                }),
                deviceAccount({
                    sessionId: 'sess-2',
                    authuser: 1,
                    isCurrent: true,
                    displayName: 'Bob Builder',
                    email: 'bob@example.com',
                    avatarUrl: 'https://cdn.example.com/avatar-2/thumb',
                    color: 'oxy',
                    user: { id: 'user-2', username: 'bob', email: 'bob@example.com' },
                }),
            ],
        });

        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.sessionId)).toEqual(['sess-1', 'sess-2']);
        expect(rows.map((r) => r.isActive)).toEqual([false, true]);

        // The INACTIVE row now carries full identity — the bug this phase fixes.
        const inactive = rows[0];
        expect(inactive.displayName).toBe('Alice');
        expect(inactive.secondary).toBe('alice@example.com');
        expect(inactive.avatarUri).toBe('https://cdn.example.com/avatar-1/thumb');
        expect(inactive.authuser).toBe(0);
        expect(inactive.user).not.toBeNull();

        const active = rows[1];
        expect(active.displayName).toBe('Bob Builder');
        expect(active.secondary).toBe('bob@example.com');
        expect(active.avatarUri).toBe('https://cdn.example.com/avatar-2/thumb');
        expect(active.authuser).toBe(1);
    });

    it('uses the @handle fallback (NOT a synthesized email) when an account has no email', () => {
        const rows = buildAccountRows({
            accounts: [
                deviceAccount({
                    sessionId: 'sess-1',
                    isCurrent: true,
                    displayName: 'carol',
                    // `useDeviceAccounts` resolves a missing email to the
                    // `@handle` line — NEVER a fake `carol@oxy.so`.
                    email: '@carol',
                    user: { id: 'user-3', username: 'carol' },
                }),
            ],
        });

        expect(rows[0].secondary).toBe('@carol');
        // Critically: it is the real handle, not a synthesized `@oxy.so` address.
        expect(rows[0].secondary).not.toMatch(/@oxy\.so$/);
    });

    it('yields a null secondary when an account has neither email nor handle', () => {
        const rows = buildAccountRows({
            accounts: [
                deviceAccount({
                    sessionId: 'sess-1',
                    isCurrent: true,
                    displayName: 'Unnamed',
                    email: null,
                    user: { id: 'user-4', username: '' },
                }),
            ],
        });

        // A genuinely email-less, handle-less account renders a blank secondary
        // line — NOT a fabricated address.
        expect(rows[0].secondary).toBeNull();
    });

    it('produces no avatar URL when the account has no avatar', () => {
        const rows = buildAccountRows({
            accounts: [
                deviceAccount({
                    sessionId: 'sess-1',
                    isCurrent: true,
                    displayName: 'Dan',
                    email: 'dan@example.com',
                    avatarUrl: undefined,
                    user: { id: 'user-5', username: 'dan', email: 'dan@example.com' },
                }),
            ],
        });

        expect(rows[0].avatarUri).toBeUndefined();
    });

    it('marks no row active when none is current', () => {
        const rows = buildAccountRows({
            accounts: [
                deviceAccount({ sessionId: 'sess-1', isCurrent: false }),
                deviceAccount({ sessionId: 'sess-2', isCurrent: false }),
            ],
        });

        expect(rows.every((r) => !r.isActive)).toBe(true);
    });

    it('preserves account order from the input array', () => {
        const rows = buildAccountRows({
            accounts: [
                deviceAccount({ sessionId: 'c' }),
                deviceAccount({ sessionId: 'a' }),
                deviceAccount({ sessionId: 'b' }),
            ],
        });
        expect(rows.map((r) => r.sessionId)).toEqual(['c', 'a', 'b']);
    });
});

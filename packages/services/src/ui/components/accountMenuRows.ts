import type { DeviceAccount, DeviceAccountUser } from '../hooks/useDeviceAccounts';

export interface AccountRow {
    sessionId: string;
    /** Device-local refresh-cookie slot index (web silent-switch). */
    authuser?: number;
    isActive: boolean;
    displayName: string;
    secondary: string | null;
    avatarUri?: string;
    user: DeviceAccountUser | null;
}

export interface BuildAccountRowsInput {
    /**
     * Per-device account entries from {@link useDeviceAccounts}. Each entry
     * already carries real per-account `displayName` / `email` / `avatarUrl` /
     * `color`, so EVERY row (not just the active one) renders full identity.
     */
    accounts: DeviceAccount[];
}

/**
 * Pure builder for `AccountMenu` rows. Extracted so the multi-account display
 * logic can be unit-tested without rendering React Native.
 *
 * Maps each {@link DeviceAccount} (sourced from `useDeviceAccounts()`, which
 * hydrates EVERY account with real name/email/avatar/color from the shared
 * apex `refresh-all` path or the local fallback) into an `AccountRow`.
 *
 * `secondary` is the account's real email when present; otherwise it falls
 * back to the `@handle` line. A missing email is NEVER synthesized into a fake
 * `username@oxy.so` — the device-account layer already resolved `email` to the
 * real value or the `@handle` fallback.
 */
export function buildAccountRows({
    accounts,
}: BuildAccountRowsInput): AccountRow[] {
    return accounts.map((account: DeviceAccount): AccountRow => ({
        sessionId: account.sessionId,
        authuser: account.authuser,
        isActive: account.isCurrent,
        displayName: account.displayName,
        secondary: account.email,
        avatarUri: account.avatarUrl,
        user: account.user,
    }));
}

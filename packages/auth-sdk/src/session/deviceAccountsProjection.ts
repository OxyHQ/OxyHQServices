import type { DeviceSessionState } from '@oxyhq/contracts';
import type { AuthManagerAccount, User } from '@oxyhq/core';

/**
 * Project a `DeviceSessionState` (the `SessionClient`-owned, server-
 * authoritative device account set) onto the LEGACY `AuthManagerAccount[]`
 * shape `WebOxyContextValue.accounts` still exposes publicly (Fase 4 cutover
 * — Task 5.1: `AuthManager` is retired; `SessionClient` is now the SOLE
 * authority for this projection — there is no longer a separate cookie-slot
 * registry to fall back to or go stale against).
 *
 * Every NON-active account's `accessToken` is the empty string. Unlike the
 * legacy `oxy_rt_${n}` cookie-slot model — which held an independent,
 * immediately-usable access token per device account simultaneously — the
 * `SessionClient` design holds only the currently-ACTIVE account's token in
 * memory (planted by `SessionClient.applySync` from the server's
 * `activeToken`). Switching accounts (`sessionClient.switchAccount`) is what
 * mints a token for a different account, on demand. `expiresAt` falls back
 * to the provisional `state.updatedAt` timestamp for every non-active
 * account, mirroring `deviceStateToClientSessions`'s documented
 * provisional-timestamp convention — `DeviceSessionState` carries no
 * per-account `expiresAt`.
 *
 * `usersById` is the SAME profile map the caller already built (via
 * `oxyServices.getUsersByIds(accountIdsOf(state))`) for
 * `deviceStateToClientSessions` / `activeUserOf` — no extra fetch.
 */
export function projectAuthManagerAccounts(
  state: DeviceSessionState,
  usersById: Map<string, User>,
  active: { accessToken: string | null; expiresAt: string | null },
): AuthManagerAccount[] {
  const provisionalTimestamp = new Date(state.updatedAt).toISOString();
  return state.accounts
    .map((account): AuthManagerAccount => {
      const isActive = account.accountId === state.activeAccountId;
      const user = usersById.get(account.accountId) ?? null;
      return {
        authuser: account.authuser,
        sessionId: account.sessionId,
        user: user
          ? {
              id: user.id,
              username: user.username,
              name: user.name,
              avatar: user.avatar ?? null,
              email: user.email,
              color: user.color ?? null,
            }
          : null,
        accessToken: isActive ? (active.accessToken ?? '') : '',
        expiresAt: isActive ? (active.expiresAt ?? provisionalTimestamp) : provisionalTimestamp,
      };
    })
    .sort((a, b) => a.authuser - b.authuser);
}

/**
 * The active account's legacy `authuser` slot index, or `null` when there is
 * no state or no active account is set.
 */
export function activeAuthuserOf(state: DeviceSessionState | null): number | null {
  if (state === null || state.activeAccountId === null) {
    return null;
  }
  const activeAccountId = state.activeAccountId;
  const active = state.accounts.find((account) => account.accountId === activeAccountId);
  return active?.authuser ?? null;
}

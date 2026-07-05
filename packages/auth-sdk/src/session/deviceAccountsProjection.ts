import type { DeviceSessionState, UserNameResponse } from '@oxyhq/contracts';
import type { User } from '@oxyhq/core';

/**
 * One device-local account, projected from the server-authoritative
 * `DeviceSessionState` onto the shape `WebOxyContextValue.accounts` exposes.
 *
 * Self-contained (no dependency on the legacy `AuthManager` types): the
 * device-first model has no per-slot `oxy_rt_${n}` cookie registry — the
 * `SessionClient` device account set is the SOLE authority. Only the
 * currently-ACTIVE account holds a usable in-memory access token; every
 * non-active account's `accessToken` is the empty string (switching accounts,
 * `sessionClient.switchAccount`, is what mints a token for a different account
 * on demand).
 */
export interface DeviceAccountView {
  /** Device-local account slot index (0..N-1), assigned by the server. */
  authuser: number;
  /** Server-side session id this account is bound to. */
  sessionId: string;
  /**
   * Projected public user shape, or `null` when the account's profile is not
   * present in the caller-supplied `usersById` map (the caller renders a
   * handle fallback until the profile resolves).
   */
  user: {
    id: string;
    username?: string;
    name: UserNameResponse;
    avatar?: string | null;
    email?: string;
    color?: string | null;
  } | null;
  /** Currently-valid access token (in-memory only), or `''` for non-active accounts. */
  accessToken: string;
  /** ISO-8601 access-token expiry (provisional `updatedAt` for non-active accounts). */
  expiresAt: string;
}

/**
 * Project a `DeviceSessionState` onto the `DeviceAccountView[]` the context
 * exposes, sorted by `authuser` ascending.
 *
 * Every NON-active account's `accessToken` is the empty string: unlike the
 * retired `oxy_rt_${n}` cookie-slot model (which held an independent access
 * token per account), the device-first design holds only the ACTIVE account's
 * token in memory (planted by `SessionClient.applySync` from the server's
 * `activeToken`). `expiresAt` falls back to the provisional `state.updatedAt`
 * timestamp for every non-active account — `DeviceSessionState` carries no
 * per-account expiry.
 *
 * `usersById` is the SAME profile map the caller already built (via
 * `oxyServices.getUsersByIds(accountIdsOf(state))`) for
 * `deviceStateToClientSessions` / `activeUserOf` — no extra fetch.
 */
export function projectDeviceAccounts(
  state: DeviceSessionState,
  usersById: Map<string, User>,
  active: { accessToken: string | null; expiresAt: string | null },
): DeviceAccountView[] {
  const provisionalTimestamp = new Date(state.updatedAt).toISOString();
  return state.accounts
    .map((account): DeviceAccountView => {
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
 * The active account's `authuser` slot index, or `null` when there is no state
 * or no active account is set.
 */
export function activeAuthuserOf(state: DeviceSessionState | null): number | null {
  if (state === null || state.activeAccountId === null) {
    return null;
  }
  const activeAccountId = state.activeAccountId;
  const active = state.accounts.find((account) => account.accountId === activeAccountId);
  return active?.authuser ?? null;
}

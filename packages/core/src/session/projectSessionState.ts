import type { DeviceSessionState } from '@oxyhq/contracts';
import type { ClientSession } from '../models/session';
import type { User } from '../models/interfaces';

/**
 * Pure projection helpers: `DeviceSessionState` (the device-scoped
 * multi-account session-sync state produced by `SessionClient`) -> the
 * shapes consumers (`@oxyhq/services`, `@oxyhq/auth`) render today
 * (`ClientSession[]`, an active session id, an active `User`).
 *
 * No I/O. The caller fetches profiles via
 * `oxyServices.getUsersByIds(accountIdsOf(state))` and builds `usersById`
 * from the result before calling `deviceStateToClientSessions` /
 * `activeUserOf`.
 */

/**
 * Maps every `SessionAccount` in `state.accounts` to a `ClientSession`.
 *
 * `DeviceSessionState` carries no per-account `expiresAt` / `lastActive` —
 * both are set to `state.updatedAt` (converted to an ISO-8601 string; the
 * wire value is an epoch-ms number) as a provisional value.
 *
 * `usersById` is accepted for signature symmetry with `activeUserOf` even
 * though `ClientSession` only stores `userId` — a session is still
 * projected for an account whose id is absent from `usersById` (no
 * placeholder user is fabricated).
 */
export function deviceStateToClientSessions(
  state: DeviceSessionState,
  usersById: Map<string, User>,
): ClientSession[] {
  const provisionalTimestamp = new Date(state.updatedAt).toISOString();
  return state.accounts.map((account) => ({
    sessionId: account.sessionId,
    deviceId: state.deviceId,
    // provisional: expiresAt/lastActive are not carried on DeviceSessionState
    expiresAt: provisionalTimestamp,
    lastActive: provisionalTimestamp,
    userId: account.accountId,
    isCurrent: account.accountId === state.activeAccountId,
    authuser: account.authuser,
  }));
}

/**
 * The active account's `sessionId`, or `null` when there is no state or no
 * active account is set.
 */
export function activeSessionIdOf(state: DeviceSessionState | null): string | null {
  if (state === null || state.activeAccountId === null) {
    return null;
  }
  const activeAccountId = state.activeAccountId;
  const activeAccount = state.accounts.find((account) => account.accountId === activeAccountId);
  return activeAccount?.sessionId ?? null;
}

/**
 * The active account's `User`, resolved from `usersById`. `null` when there
 * is no state, no active account is set, or the active account id is absent
 * from `usersById`.
 */
export function activeUserOf(
  state: DeviceSessionState | null,
  usersById: Map<string, User>,
): User | null {
  if (state === null || state.activeAccountId === null) {
    return null;
  }
  return usersById.get(state.activeAccountId) ?? null;
}

/**
 * All account ids in `state`, suitable for an `oxyServices.getUsersByIds(...)`
 * fetch. `[]` for `null` state.
 */
export function accountIdsOf(state: DeviceSessionState | null): string[] {
  if (state === null) {
    return [];
  }
  return state.accounts.map((account) => account.accountId);
}

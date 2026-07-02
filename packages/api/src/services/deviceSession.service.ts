import type { DeviceSessionState, SessionAccount } from '@oxyhq/contracts';
import DeviceSession, { IDeviceSession, IDeviceSessionAccount } from '../models/DeviceSession';
import sessionService from './session.service';
import { logger } from '../utils/logger';

function idToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'toString' in (value as object)) return (value as { toString(): string }).toString();
  return String(value);
}

export function projectState(doc: IDeviceSession): DeviceSessionState {
  const accounts: SessionAccount[] = (doc.accounts ?? []).map((a: IDeviceSessionAccount) => {
    const operatedBy = idToString(a.operatedByUserId ?? null);
    const account: SessionAccount = { accountId: idToString(a.accountId) ?? '', sessionId: a.sessionId, authuser: a.authuser };
    if (operatedBy) account.operatedByUserId = operatedBy;
    return account;
  });
  return {
    deviceId: doc.deviceId,
    accounts,
    activeAccountId: idToString(doc.activeAccountId),
    revision: doc.revision ?? 0,
    updatedAt: (doc.updatedAt ?? new Date()).getTime(),
  };
}

function lowestFreeAuthuser(accounts: IDeviceSessionAccount[]): number {
  const used = new Set(accounts.map((a) => a.authuser));
  let i = 0;
  while (used.has(i)) i += 1;
  return i;
}

export type SwitchActiveResult =
  | { ok: true; state: DeviceSessionState }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unauthorized'; state: DeviceSessionState };

// `changed` is false only for an idempotent re-register (same account, same
// session) — the cold-boot reload handoff. The route uses it to skip the
// device-state broadcast when nothing actually changed.
export type AddAccountResult = { state: DeviceSessionState; changed: boolean };

class DeviceSessionService {
  private async load(deviceId: string): Promise<IDeviceSession | null> {
    return DeviceSession.findOne({ deviceId }).lean<IDeviceSession>();
  }

  async getState(deviceId: string): Promise<DeviceSessionState> {
    const existing = await this.load(deviceId);
    if (existing) return this.healActiveAccount(existing);
    const created = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $setOnInsert: { deviceId, accounts: [], activeAccountId: null, revision: 0 } },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(created as IDeviceSession);
  }

  // Self-heals a device's active account when it is a managed (act_as)
  // account whose operator membership has since been revoked.
  // `resolveActiveToken` already refuses to mint a token for such an account,
  // but without this the dead account keeps sitting in `accounts`/
  // `activeAccountId` forever — the client would durably render "logged in
  // as <org>" while holding the previous account's bearer. One pass only:
  // drop the revoked account via the existing signout cascade and return the
  // healed state; a newly-elected active account is left for the *next*
  // getState call to re-validate rather than re-checked recursively here.
  // Non-managed (personal) active accounts are never touched by this path —
  // a personal account with a transiently-unresolvable access token must not
  // be dropped, only a managed account whose act_as membership check failed.
  private async healActiveAccount(doc: IDeviceSession): Promise<DeviceSessionState> {
    const activeId = idToString(doc.activeAccountId);
    if (!activeId) return projectState(doc);
    const active = (doc.accounts ?? []).find((a) => idToString(a.accountId) === activeId);
    const operatedBy = active ? idToString(active.operatedByUserId ?? null) : null;
    if (!active || !operatedBy) return projectState(doc);
    const validated = await sessionService.validateSessionById(active.sessionId, false);
    if (validated) return projectState(doc);
    logger.info('deviceSession.getState: dropping revoked managed active account', {
      deviceId: doc.deviceId,
      accountId: activeId,
    });
    return this.signout(doc.deviceId, { accountId: activeId });
  }

  // Registering a session into the device set. Reload ≠ sign-in: the client
  // cold-boot handoff calls this on EVERY reload with the RESTORED session to
  // re-register it, so this must be idempotent and must NOT steal the device's
  // active account. Three cases:
  //   1. Same account + SAME session already present  → pure no-op: return the
  //      current state untouched (no active flip, no revision bump, no write).
  //      This is the reload handoff; flipping active here silently reverted a
  //      prior account switch on the next reload.
  //   2. Same account + DIFFERENT session (deliberate re-auth of that account)
  //      → replace the session (deactivating the displaced one), set active,
  //      bump revision.
  //   3. New account (fresh sign-in / first-entry mint) → add, set active, bump.
  async addAccount(
    deviceId: string,
    input: { accountId: string; sessionId: string; operatedByUserId?: string },
  ): Promise<AddAccountResult> {
    const current = await this.load(deviceId);
    const existing = (current?.accounts ?? []).find((a) => idToString(a.accountId) === input.accountId);

    // Case 1 — idempotent re-register (the cold-boot reload handoff).
    if (current && existing && existing.sessionId === input.sessionId) {
      return { state: projectState(current), changed: false };
    }

    const others = (current?.accounts ?? []).filter((a) => idToString(a.accountId) !== input.accountId);
    // Case 2 — replacing an account's session (re-add with a new sessionId) must
    // deactivate the session it displaces — otherwise a live, server-side session
    // is left dangling with no device-session entry referencing it.
    if (existing && existing.sessionId !== input.sessionId) {
      try {
        await sessionService.deactivateSession(existing.sessionId);
      } catch (error) {
        logger.warn('deviceSession.addAccount: deactivate replaced session failed', { sessionId: existing.sessionId, error });
      }
    }
    const authuser = lowestFreeAuthuser(others);
    const account = {
      accountId: input.accountId,
      sessionId: input.sessionId,
      authuser,
      addedAt: new Date(),
      operatedByUserId: input.operatedByUserId ?? null,
    };
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      {
        $set: { accounts: [...others, account], activeAccountId: input.accountId },
        $inc: { revision: 1 },
      },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return { state: projectState(updated as IDeviceSession), changed: true };
  }

  async switchActive(deviceId: string, accountId: string): Promise<SwitchActiveResult> {
    const current = await this.load(deviceId);
    const target = (current?.accounts ?? []).find((a) => idToString(a.accountId) === accountId);
    if (!current || !target) return { ok: false, reason: 'not_found' };

    // Re-validate the target account's session BEFORE committing the switch.
    // For a managed account this re-checks the operator's act_as membership
    // (ensureManagedSessionAuthorized) and rejects the switch instead of
    // durably pointing the device at an account the caller no longer has
    // authority over (see resolveActiveToken, which does the same check on
    // read but can't undo an already-committed activeAccountId).
    const validated = await sessionService.validateSessionById(target.sessionId, false);
    if (!validated) {
      // The target session is revoked (e.g. the operator's act_as membership
      // was pulled). Leaving it in the device set strands a dead account the
      // device can never switch into. Heal by removing it through the SAME
      // signout cascade a normal removal uses, and return the healed state so
      // the route can broadcast it to the device's other tabs/connections.
      const state = await this.signout(deviceId, { accountId });
      return { ok: false, reason: 'unauthorized', state };
    }

    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $set: { activeAccountId: accountId }, $inc: { revision: 1 } },
      { new: true },
    ).lean<IDeviceSession>();
    if (!updated) return { ok: false, reason: 'not_found' };
    return { ok: true, state: projectState(updated) };
  }

  async resolveActiveToken(state: DeviceSessionState): Promise<{ accessToken: string; expiresAt: string } | null> {
    if (!state.activeAccountId) return null;
    const account = state.accounts.find((a) => a.accountId === state.activeAccountId);
    if (!account) return null;
    // Re-validate before minting a token: for a managed-account session this
    // re-checks the operator's act_as membership (ensureManagedSessionAuthorized)
    // and deactivates+rejects a revoked session instead of handing out a token
    // for an account the caller no longer has authority over.
    const validated = await sessionService.validateSessionById(account.sessionId, false);
    if (!validated) return null;
    const token = await sessionService.getAccessToken(account.sessionId);
    if (!token) return null;
    return { accessToken: token.accessToken, expiresAt: token.expiresAt.toISOString() };
  }

  async signout(deviceId: string, target: { accountId: string } | { all: true }): Promise<DeviceSessionState> {
    const current = await this.load(deviceId);
    if (!current) return this.getState(deviceId);
    const allAccounts = current.accounts ?? [];

    let removingIds: Set<string>;
    if ('all' in target) {
      removingIds = new Set(allAccounts.map((a) => idToString(a.accountId) ?? ''));
    } else {
      const targetPresent = allAccounts.some((a) => idToString(a.accountId) === target.accountId);
      if (!targetPresent) return projectState(current);
      removingIds = new Set([target.accountId]);
      // Cascade: signing out an operator's own account must also remove every
      // managed/org account that operator switched into on this device (one
      // level deep — operated accounts can't themselves operate others).
      for (const a of allAccounts) {
        if (idToString(a.operatedByUserId) === target.accountId) {
          removingIds.add(idToString(a.accountId) ?? '');
        }
      }
    }

    const removing = allAccounts.filter((a) => removingIds.has(idToString(a.accountId) ?? ''));
    for (const a of removing) {
      try {
        await sessionService.deactivateSession(a.sessionId);
      } catch (error) {
        logger.warn('deviceSession.signout: deactivate failed', { sessionId: a.sessionId, error });
      }
    }
    const remaining = allAccounts.filter((a) => !removingIds.has(idToString(a.accountId) ?? ''));
    const activeStillPresent = remaining.some((a) => idToString(a.accountId) === idToString(current.activeAccountId));
    const nextActive = activeStillPresent ? idToString(current.activeAccountId) : (remaining[0] ? idToString(remaining[0].accountId) : null);
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $set: { accounts: remaining, activeAccountId: nextActive }, $inc: { revision: 1 } },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(updated as IDeviceSession);
  }
}

const deviceSessionService = new DeviceSessionService();
export default deviceSessionService;

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

class DeviceSessionService {
  private async load(deviceId: string): Promise<IDeviceSession | null> {
    return DeviceSession.findOne({ deviceId }).lean<IDeviceSession>();
  }

  async getState(deviceId: string): Promise<DeviceSessionState> {
    const existing = await this.load(deviceId);
    if (existing) return projectState(existing);
    const created = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $setOnInsert: { deviceId, accounts: [], activeAccountId: null, revision: 0 } },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(created as IDeviceSession);
  }

  async addAccount(
    deviceId: string,
    input: { accountId: string; sessionId: string; operatedByUserId?: string },
  ): Promise<DeviceSessionState> {
    const current = await this.load(deviceId);
    const existing = (current?.accounts ?? []).find((a) => idToString(a.accountId) === input.accountId);
    const others = (current?.accounts ?? []).filter((a) => idToString(a.accountId) !== input.accountId);
    // Replacing an account's session (re-add with a new sessionId) must deactivate
    // the session it displaces — otherwise a live, server-side session is left
    // dangling with no device-session entry referencing it.
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
    return projectState(updated as IDeviceSession);
  }

  async switchActive(deviceId: string, accountId: string): Promise<DeviceSessionState | null> {
    const current = await this.load(deviceId);
    if (!current || !(current.accounts ?? []).some((a) => idToString(a.accountId) === accountId)) return null;
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $set: { activeAccountId: accountId }, $inc: { revision: 1 } },
      { new: true },
    ).lean<IDeviceSession>();
    if (!updated) return null;
    return projectState(updated);
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

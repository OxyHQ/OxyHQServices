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
    const others = (current?.accounts ?? []).filter((a) => idToString(a.accountId) !== input.accountId);
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
    const token = await sessionService.getAccessToken(account.sessionId);
    if (!token) return null;
    return { accessToken: token.accessToken, expiresAt: token.expiresAt.toISOString() };
  }

  async signout(deviceId: string, target: { accountId: string } | { all: true }): Promise<DeviceSessionState> {
    const current = await this.load(deviceId);
    if (!current) return this.getState(deviceId);
    const removing = 'all' in target ? current.accounts ?? [] : (current.accounts ?? []).filter((a) => idToString(a.accountId) === target.accountId);
    if (!('all' in target) && removing.length === 0) return projectState(current);
    for (const a of removing) {
      try {
        await sessionService.deactivateSession(a.sessionId);
      } catch (error) {
        logger.warn('deviceSession.signout: deactivate failed', { sessionId: a.sessionId, error });
      }
    }
    const remaining = 'all' in target ? [] : (current.accounts ?? []).filter((a) => idToString(a.accountId) !== target.accountId);
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

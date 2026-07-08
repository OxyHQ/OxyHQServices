/**
 * IdP handoff code service tests
 */

import * as crypto from 'crypto';

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  default: {},
  AuthCode: {},
}));

interface StoredHandoff {
  _id: string;
  codeHash: string;
  deviceId: string;
  sessionId: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
}

const store = new Map<string, StoredHandoff>();
let nextId = 1;

jest.mock('../../models/IdpHandoffCode', () => ({
  __esModule: true,
  default: {
    create: jest.fn(async (data: Partial<StoredHandoff>) => {
      const id = `handoff-${nextId++}`;
      const record: StoredHandoff = {
        _id: id,
        codeHash: data.codeHash ?? '',
        deviceId: data.deviceId ?? '',
        sessionId: data.sessionId ?? '',
        userId: data.userId ?? '',
        usedAt: data.usedAt ?? null,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 30_000),
      };
      store.set(record.codeHash, record);
      return record;
    }),
    findOne: jest.fn(async (query: { codeHash: string }) => store.get(query.codeHash) ?? null),
    findOneAndUpdate: jest.fn(
      async (
        filter: { _id: string; usedAt: null | Date },
        update: { $set: { usedAt: Date } },
      ) => {
        for (const record of store.values()) {
          if (record._id !== filter._id) continue;
          if (record.usedAt !== null) return null;
          record.usedAt = update.$set.usedAt;
          return record;
        }
        return null;
      },
    ),
  },
  IdpHandoffCode: {},
}));

import {
  createIdpHandoffCode,
  exchangeIdpHandoffCode,
} from '../idpHandoff.service';
import { base64UrlEncode, sha256Hex } from '../oauthCode.service';

describe('idpHandoff.service', () => {
  beforeEach(() => {
    store.clear();
    nextId = 1;
  });

  it('issues and exchanges a handoff code once', async () => {
    const { handoffCode } = await createIdpHandoffCode({
      deviceId: 'device-a',
      sessionId: 'session-a',
      userId: 'user-a',
    });

    const first = await exchangeIdpHandoffCode(handoffCode);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.record.deviceId).toBe('device-a');
      expect(first.record.sessionId).toBe('session-a');
    }

    const replay = await exchangeIdpHandoffCode(handoffCode);
    expect(replay.ok).toBe(false);
  });

  it('rejects unknown codes', async () => {
    const raw = base64UrlEncode(crypto.randomBytes(32));
    const result = await exchangeIdpHandoffCode(raw);
    expect(result.ok).toBe(false);
  });

  it('hashes codes consistently', () => {
    expect(sha256Hex('test')).toHaveLength(64);
  });
});

/**
 * deviceToken.service unit tests.
 *
 * Covers the opaque add-only device-attribution token:
 *  - issue: revokes the previous live token for the same (deviceId, origin),
 *    stores sha256(raw), returns the raw token.
 *  - resolve: channel policy — `web` requires an EXACT Origin match; `native`
 *    requires the Origin header to be ABSENT. Expired/revoked/unknown → null.
 *  - revoke: revokes every live token for a device.
 *
 * The DeviceToken model is mocked; hashing uses the real crypto helpers from
 * `oauthCode.service` (loaded under the global mongoose mock).
 */

import * as crypto from 'crypto';
import type { Request } from 'express';

const mockUpdateMany = jest.fn();
const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock('../../models/DeviceToken', () => ({
  __esModule: true,
  default: {
    updateMany: (...a: unknown[]) => mockUpdateMany(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    // resolveDeviceToken reads via `.lean()`; the query returns a lean-shaped
    // object whose `.lean()` yields whatever `mockFindOne` was staged with.
    findOne: (...a: unknown[]) => ({ lean: () => mockFindOne(...a) }),
    updateOne: (...a: unknown[]) => mockUpdateOne(...a),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// Hashing helpers come from oauthCode.service; mock it so the AuthCode model
// (Schema.Types.ObjectId) is not evaluated under the global mongoose mock.
jest.mock('../oauthCode.service', () => {
  const nodeCrypto = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    sha256Hex: (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex'),
    base64UrlEncode: (buf: Buffer) => buf.toString('base64url'),
  };
});

import {
  issueDeviceToken,
  resolveDeviceToken,
  revokeDeviceTokens,
  NATIVE_ORIGIN,
} from '../deviceToken.service';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function reqWithOrigin(origin?: string): Request {
  return { headers: origin ? { origin } : {} } as unknown as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({});
  mockCreate.mockResolvedValue({});
  mockUpdateOne.mockResolvedValue({});
});

describe('issueDeviceToken', () => {
  it('revokes the previous live token for the same (deviceId, origin) then stores sha256(raw)', async () => {
    const raw = await issueDeviceToken({ deviceId: 'd1', origin: 'https://accounts.oxy.so', channel: 'web' });

    expect(typeof raw).toBe('string');
    expect(raw.length).toBeGreaterThan(20);

    expect(mockUpdateMany).toHaveBeenCalledWith(
      { deviceId: 'd1', origin: 'https://accounts.oxy.so', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } },
    );

    const created = mockCreate.mock.calls[0][0];
    expect(created.deviceId).toBe('d1');
    expect(created.origin).toBe('https://accounts.oxy.so');
    expect(created.channel).toBe('web');
    // Only the hash is persisted, never the raw token.
    expect(created.tokenHash).toBe(sha256Hex(raw));
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('stores the literal native origin for the native channel', async () => {
    await issueDeviceToken({ deviceId: 'd2', origin: 'ignored', channel: 'native' });
    const created = mockCreate.mock.calls[0][0];
    expect(created.origin).toBe(NATIVE_ORIGIN);
    expect(created.channel).toBe('native');
  });
});

describe('resolveDeviceToken — web channel', () => {
  const stored = {
    _id: 'row1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    channel: 'web',
    origin: 'https://accounts.oxy.so',
    deviceId: 'd1',
  };

  it('resolves + bumps when the Origin matches exactly', async () => {
    mockFindOne.mockResolvedValueOnce(stored);
    const result = await resolveDeviceToken('raw', reqWithOrigin('https://accounts.oxy.so'));
    expect(result).toEqual({ deviceId: 'd1' });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: 'row1' },
      { $set: { lastUsedAt: expect.any(Date), expiresAt: expect.any(Date) } },
    );
  });

  it('returns null when the Origin does not match', async () => {
    mockFindOne.mockResolvedValueOnce(stored);
    expect(await resolveDeviceToken('raw', reqWithOrigin('https://evil.com'))).toBeNull();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it('returns null when the Origin header is absent (web token)', async () => {
    mockFindOne.mockResolvedValueOnce(stored);
    expect(await resolveDeviceToken('raw', reqWithOrigin(undefined))).toBeNull();
  });
});

describe('resolveDeviceToken — native channel', () => {
  const stored = {
    _id: 'row2',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    channel: 'native',
    origin: NATIVE_ORIGIN,
    deviceId: 'd9',
  };

  it('resolves when the Origin header is ABSENT', async () => {
    mockFindOne.mockResolvedValueOnce(stored);
    expect(await resolveDeviceToken('raw', reqWithOrigin(undefined))).toEqual({ deviceId: 'd9' });
  });

  it('returns null when a browser Origin is present (native token replayed from a browser)', async () => {
    mockFindOne.mockResolvedValueOnce(stored);
    expect(await resolveDeviceToken('raw', reqWithOrigin('https://accounts.oxy.so'))).toBeNull();
  });
});

describe('resolveDeviceToken — lifecycle guards', () => {
  it('returns null for an unknown token', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    expect(await resolveDeviceToken('raw', reqWithOrigin(undefined))).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'r', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), channel: 'native', origin: NATIVE_ORIGIN, deviceId: 'd',
    });
    expect(await resolveDeviceToken('raw', reqWithOrigin(undefined))).toBeNull();
  });

  it('returns null for an expired token', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'r', revokedAt: null, expiresAt: new Date(Date.now() - 1000), channel: 'native', origin: NATIVE_ORIGIN, deviceId: 'd',
    });
    expect(await resolveDeviceToken('raw', reqWithOrigin(undefined))).toBeNull();
  });

  it('never throws — returns null on a DB error', async () => {
    mockFindOne.mockRejectedValueOnce(new Error('db down'));
    expect(await resolveDeviceToken('raw', reqWithOrigin(undefined))).toBeNull();
  });
});

describe('revokeDeviceTokens', () => {
  it('revokes every live token for a device', async () => {
    await revokeDeviceTokens('d1');
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { deviceId: 'd1', revokedAt: null },
      { $set: { revokedAt: expect.any(Date) } },
    );
  });
});

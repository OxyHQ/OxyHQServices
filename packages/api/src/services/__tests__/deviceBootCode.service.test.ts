/**
 * deviceBootCode.service unit tests.
 *
 * Mirrors the ssoCode.service test shape: an in-memory Valkey double honouring
 * atomic GETDEL exercises the real single-use burn logic.
 *
 * Covers:
 *  - mint stores sha256(code) (never the raw code) with a 60s TTL; returns raw.
 *  - redeem happy path returns the payload.
 *  - double redeem (single-use burn) → null.
 *  - malformed stored record → null.
 *  - fail-closed: mint throws / redeem returns null when Redis is absent.
 */

import * as crypto from 'crypto';

const store = new Map<string, string>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number) => {
    store.set(key, value);
    return 'OK';
  }),
  getdel: jest.fn(async (key: string) => {
    const value = store.get(key);
    if (value === undefined) return null;
    store.delete(key);
    return value;
  }),
};

let redisClient: unknown = mockRedis;
jest.mock('../../config/redis', () => ({
  getRedisClient: () => redisClient,
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  mintBootCode,
  redeemBootCode,
  DEVICE_BOOT_CODE_TTL_SECONDS,
} from '../deviceBootCode.service';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  redisClient = mockRedis;
});

describe('mintBootCode', () => {
  it('stores sha256(code) with a 60s TTL and returns the raw code (no token in the record)', async () => {
    const { code, expiresInSeconds } = await mintBootCode({
      sessionId: 's1',
      userId: 'u1',
      clientOrigin: 'https://mention.earth',
    });

    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(20);
    expect(expiresInSeconds).toBe(DEVICE_BOOT_CODE_TTL_SECONDS);

    // Key is the HASH of the code, under the device:boot: namespace.
    expect(mockRedis.set).toHaveBeenCalledWith(
      `device:boot:${sha256Hex(code)}`,
      expect.any(String),
      'EX',
      DEVICE_BOOT_CODE_TTL_SECONDS,
    );

    const record = JSON.parse(mockRedis.set.mock.calls[0][1] as string);
    expect(record).toMatchObject({ sessionId: 's1', userId: 'u1', clientOrigin: 'https://mention.earth' });
    // The record NEVER carries a token.
    expect(record.accessToken).toBeUndefined();
    expect(record.refreshToken).toBeUndefined();
  });

  it('fails closed: throws when Redis is unavailable', async () => {
    redisClient = null;
    await expect(
      mintBootCode({ sessionId: 's', userId: 'u', clientOrigin: 'https://mention.earth' }),
    ).rejects.toThrow(/unavailable/i);
  });
});

describe('redeemBootCode', () => {
  it('redeems once and returns the payload', async () => {
    const { code } = await mintBootCode({ sessionId: 's1', userId: 'u1', clientOrigin: 'https://mention.earth' });
    const record = await redeemBootCode(code);
    expect(record).toMatchObject({ sessionId: 's1', userId: 'u1', clientOrigin: 'https://mention.earth' });
  });

  it('is single-use: a second redeem of the same code returns null (atomic GETDEL burn)', async () => {
    const { code } = await mintBootCode({ sessionId: 's1', userId: 'u1', clientOrigin: 'https://mention.earth' });
    expect(await redeemBootCode(code)).not.toBeNull();
    expect(await redeemBootCode(code)).toBeNull();
  });

  it('returns null for an unknown / expired code', async () => {
    expect(await redeemBootCode('never-minted')).toBeNull();
  });

  it('returns null for a malformed stored record', async () => {
    // Plant a record missing the required fields under a known code hash.
    const code = 'deadbeefdeadbeefdeadbeef';
    store.set(`device:boot:${sha256Hex(code)}`, JSON.stringify({ nope: true }));
    expect(await redeemBootCode(code)).toBeNull();
  });

  it('fails closed: returns null when Redis is unavailable', async () => {
    redisClient = null;
    expect(await redeemBootCode('x')).toBeNull();
  });
});

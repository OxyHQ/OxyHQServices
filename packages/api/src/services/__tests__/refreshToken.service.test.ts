/**
 * refreshToken.service — rotating single-use refresh-family core.
 *
 * Covers the security-critical rotation + reuse-detection that backs
 * `POST /auth/refresh-token` (the legacy `oxy_rt` cookie helpers were deleted
 * with the `/auth/refresh*` endpoints):
 *   - issueRefreshToken stores ONLY the sha256 of the raw token.
 *   - rotateRefreshToken: happy rotation, not_found, revoked, reuse_detected
 *     (used token replay + claim-race), expired.
 *   - revokeFamilyByRawToken / revokeAllFamiliesBySession.
 */

import * as crypto from 'crypto';

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    updateMany: (...a: unknown[]) => mockUpdateMany(...a),
  },
}));

const mockDeactivateSession = jest.fn();
jest.mock('../session.service', () => ({
  __esModule: true,
  default: { deactivateSession: (...a: unknown[]) => mockDeactivateSession(...a) },
}));

jest.mock('../oauthCode.service', () => {
  const nodeCrypto = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    sha256Hex: (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex'),
    base64UrlEncode: (buf: Buffer) => buf.toString('base64url'),
  };
});

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamilyByRawToken,
  revokeAllFamiliesBySession,
} from '../refreshToken.service';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({});
  mockDeactivateSession.mockResolvedValue(true);
});

describe('issueRefreshToken', () => {
  it('stores ONLY the sha256 of the raw token and returns the raw token + family', async () => {
    const result = await issueRefreshToken({ sessionId: 's1', userId: 'u1' });

    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(20);
    expect(result.family.length).toBeGreaterThan(0);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const created = mockCreate.mock.calls[0][0];
    expect(created.tokenHash).toBe(sha256Hex(result.token));
    expect(created.sessionId).toBe('s1');
    expect(created.userId).toBe('u1');
    // The raw token is never persisted.
    expect(JSON.stringify(created)).not.toContain(result.token);
  });

  it('reuses an existing family when supplied (rotation)', async () => {
    const result = await issueRefreshToken({ sessionId: 's1', userId: 'u1', family: 'fam-existing' });
    expect(result.family).toBe('fam-existing');
    expect(mockCreate.mock.calls[0][0].family).toBe('fam-existing');
  });
});

describe('rotateRefreshToken', () => {
  it('rotates a valid token: claims it single-use and issues the next in the same family', async () => {
    const stored = {
      _id: 'row1', family: 'fam1', sessionId: 's1', userId: { toString: () => 'u1' },
      usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    };
    mockFindOne.mockResolvedValueOnce(stored);
    mockFindOneAndUpdate.mockResolvedValueOnce({ ...stored, usedAt: new Date() });

    const outcome = await rotateRefreshToken('raw');

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.sessionId).toBe('s1');
      expect(outcome.userId).toBe('u1');
      expect(typeof outcome.token).toBe('string');
      expect(outcome.family).toBe('fam1');
    }
    // Atomic single-use claim was attempted.
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'row1', usedAt: null, revokedAt: null },
      { $set: { usedAt: expect.any(Date) } },
      { new: true },
    );
  });

  it('returns not_found for an unknown token', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    const outcome = await rotateRefreshToken('raw');
    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('REUSE DETECTED: a replayed (already-used) token revokes the whole family', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'row1', family: 'fam1', sessionId: 's1', userId: { toString: () => 'u1' },
      usedAt: new Date(), revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    const outcome = await rotateRefreshToken('raw');
    expect(outcome).toEqual({ ok: false, reason: 'reuse_detected' });
    // Family revoked + session deactivated (theft containment).
    expect(mockUpdateMany).toHaveBeenCalledWith({ family: 'fam1', revokedAt: null }, { $set: { revokedAt: expect.any(Date) } });
    expect(mockDeactivateSession).toHaveBeenCalledWith('s1');
  });

  it('re-asserts the revoke for an already-revoked token', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'row1', family: 'fam1', sessionId: 's1', userId: { toString: () => 'u1' },
      usedAt: null, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    const outcome = await rotateRefreshToken('raw');
    expect(outcome).toEqual({ ok: false, reason: 'revoked' });
    expect(mockUpdateMany).toHaveBeenCalled();
  });

  it('returns expired for a past-expiry token (no family revoke)', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'row1', family: 'fam1', sessionId: 's1', userId: { toString: () => 'u1' },
      usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() - 1000),
    });
    const outcome = await rotateRefreshToken('raw');
    expect(outcome).toEqual({ ok: false, reason: 'expired' });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('treats a lost claim race as reuse (revokes the family)', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'row1', family: 'fam1', sessionId: 's1', userId: { toString: () => 'u1' },
      usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    mockFindOneAndUpdate.mockResolvedValueOnce(null); // another caller claimed it first
    const outcome = await rotateRefreshToken('raw');
    expect(outcome).toEqual({ ok: false, reason: 'reuse_detected' });
    expect(mockUpdateMany).toHaveBeenCalledWith({ family: 'fam1', revokedAt: null }, { $set: { revokedAt: expect.any(Date) } });
  });
});

describe('revokeFamilyByRawToken', () => {
  it('revokes the family + deactivates the session for a known token', async () => {
    mockFindOne.mockResolvedValueOnce({ family: 'fam1', sessionId: 's1' });
    await revokeFamilyByRawToken('raw');
    expect(mockUpdateMany).toHaveBeenCalledWith({ family: 'fam1', revokedAt: null }, { $set: { revokedAt: expect.any(Date) } });
    expect(mockDeactivateSession).toHaveBeenCalledWith('s1');
  });

  it('is a no-op for an unknown token', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    await revokeFamilyByRawToken('raw');
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeactivateSession).not.toHaveBeenCalled();
  });
});

describe('revokeAllFamiliesBySession', () => {
  it('revokes every un-revoked token for the session', async () => {
    await revokeAllFamiliesBySession('s1');
    expect(mockUpdateMany).toHaveBeenCalledWith({ sessionId: 's1', revokedAt: null }, { $set: { revokedAt: expect.any(Date) } });
  });
});

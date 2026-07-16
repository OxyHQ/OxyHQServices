/**
 * Encrypted off-device identity backup route tests (b3 Feature 1).
 *
 * Proves the server-side security + storage invariants of `/identity/backup`:
 *  - the server hashes the client's raw `lookupId` and stores ONLY the hash
 *    (never the raw locator, mirroring `DeviceSession.secretHash`);
 *  - POST is an UPSERT by userId — a re-upload REPLACES the prior backup rather
 *    than accumulating duplicates;
 *  - `GET /status` reports existence without leaking ciphertext or locator;
 *  - the PUBLIC `GET /:lookupId` restore endpoint hashes-and-looks-up in BOTH
 *    the found and not-found paths (no existence-timing short-circuit) and
 *    returns a constant-shape 404 for an unknown locator.
 *
 * The IdentityBackup model + auth middleware are mocked (the global mongoose
 * mock cannot load the real schema); the real router + errorHandler run.
 */
import express from 'express';
import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const USER_ID = '507f1f77bcf86cd799439011';

interface StoredDoc {
  userId: string;
  lookupIdHash: string;
  publicKeyHint: string;
  ciphertext: string;
  nonce: string;
  algorithm: string;
  kdfInfo: string;
  version: number;
  createdAt: string;
}

const mockByUser = new Map<string, StoredDoc>();
const mockFindOneAndUpdate = jest.fn();
const mockFindOne = jest.fn();
const mockDeleteOne = jest.fn();

const mockIdentityBackup = {
  findOneAndUpdate: async (
    filter: { userId: string },
    update: { $set: Omit<StoredDoc, 'userId'> },
    _opts: unknown,
  ): Promise<StoredDoc> => {
    mockFindOneAndUpdate(filter, update, _opts);
    const set = update.$set;
    // Enforce the global lookupIdHash uniqueness (E11000 on a cross-user collision).
    for (const [uid, d] of mockByUser) {
      if (uid !== filter.userId && d.lookupIdHash === set.lookupIdHash) {
        const err = new Error('E11000 duplicate key error') as Error & { code?: number };
        err.code = 11000;
        throw err;
      }
    }
    const doc: StoredDoc = { userId: filter.userId, ...set };
    mockByUser.set(filter.userId, doc);
    return doc;
  },
  findOne: (filter: { userId?: string; lookupIdHash?: string }) => {
    mockFindOne(filter);
    return {
      lean: async (): Promise<StoredDoc | null> => {
        if (filter.userId) return mockByUser.get(filter.userId) ?? null;
        if (filter.lookupIdHash) {
          for (const d of mockByUser.values()) {
            if (d.lookupIdHash === filter.lookupIdHash) return d;
          }
          return null;
        }
        return null;
      },
    };
  },
  deleteOne: async (filter: { userId: string }): Promise<{ deletedCount: number }> => {
    mockDeleteOne(filter);
    const existed = mockByUser.delete(filter.userId);
    return { deletedCount: existed ? 1 : 0 };
  },
};

jest.mock('../../models/IdentityBackup', () => ({ __esModule: true, default: mockIdentityBackup }));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { _id: USER_ID };
    next();
  },
}));

import identityBackupRouter from '../identityBackup';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers:
          body !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
            : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

let server: http.Server;

const sha256Hex = (v: string): string => crypto.createHash('sha256').update(v).digest('hex');

function uploadBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    version: 1,
    algorithm: 'xchacha20poly1305',
    kdfInfo: 'oxy-backup-encryption-key',
    nonce: '00'.repeat(24),
    ciphertext: 'deadbeefcafe',
    publicKeyHint: '04abcdef01234567',
    createdAt: '2026-07-16T00:00:00.000Z',
    lookupId: 'a'.repeat(64),
    ...overrides,
  };
}

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/identity/backup', identityBackupRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockByUser.clear();
});

describe('POST /identity/backup', () => {
  it('stores sha256(lookupId) and NEVER the raw lookupId', async () => {
    const rawLookupId = 'a'.repeat(64);
    const res = await request('POST', '/identity/backup', uploadBody({ lookupId: rawLookupId }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: true, publicKeyHint: '04abcdef01234567' });

    // The $set carries the HASH, not the raw locator.
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set.lookupIdHash).toBe(sha256Hex(rawLookupId));
    expect(set.lookupIdHash).not.toBe(rawLookupId);
    expect('lookupId' in set).toBe(false);

    // Persisted doc holds only the hash.
    const stored = mockByUser.get(USER_ID);
    expect(stored?.lookupIdHash).toBe(sha256Hex(rawLookupId));
  });

  it('upserts by userId — a re-upload REPLACES, never duplicates', async () => {
    await request('POST', '/identity/backup', uploadBody({ lookupId: 'a'.repeat(64) }));
    await request('POST', '/identity/backup', uploadBody({ lookupId: 'b'.repeat(64), ciphertext: 'feed' }));

    // Exactly one logical backup for the user, holding the SECOND upload.
    expect(mockByUser.size).toBe(1);
    const stored = mockByUser.get(USER_ID);
    expect(stored?.lookupIdHash).toBe(sha256Hex('b'.repeat(64)));
    expect(stored?.ciphertext).toBe('feed');

    // Both writes targeted the SAME userId with upsert:true.
    for (const [filter, , opts] of mockFindOneAndUpdate.mock.calls) {
      expect(filter).toEqual({ userId: USER_ID });
      expect(opts).toMatchObject({ upsert: true });
    }
  });

  it('rejects a malformed body (Zod validation → 400)', async () => {
    const res = await request('POST', '/identity/backup', uploadBody({ algorithm: 'aes-gcm' }));
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a malformed lookupId (not 64 hex chars → 400)', async () => {
    const res = await request('POST', '/identity/backup', uploadBody({ lookupId: 'not-hex' }));
    expect(res.status).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 when the lookup hash collides with a different user', async () => {
    // Seed a DIFFERENT user's backup with the same locator hash.
    mockByUser.set('other-user', {
      userId: 'other-user',
      lookupIdHash: sha256Hex('a'.repeat(64)),
      publicKeyHint: 'x',
      ciphertext: 'x',
      nonce: 'x',
      algorithm: 'xchacha20poly1305',
      kdfInfo: 'x',
      version: 1,
      createdAt: 'x',
    });
    const res = await request('POST', '/identity/backup', uploadBody({ lookupId: 'a'.repeat(64) }));
    expect(res.status).toBe(409);
  });
});

describe('GET /identity/backup/status', () => {
  it('reports absence with a constant shape', async () => {
    const res = await request('GET', '/identity/backup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
  });

  it('reports presence with the hint + timestamp, no ciphertext/locator', async () => {
    await request('POST', '/identity/backup', uploadBody());
    const res = await request('GET', '/identity/backup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      exists: true,
      publicKeyHint: '04abcdef01234567',
      createdAt: '2026-07-16T00:00:00.000Z',
    });
    expect(res.body.ciphertext).toBeUndefined();
    expect(res.body.lookupIdHash).toBeUndefined();
  });
});

describe('DELETE /identity/backup', () => {
  it('is idempotent (succeeds even with no backup)', async () => {
    const res = await request('DELETE', '/identity/backup');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDeleteOne).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('removes an existing backup', async () => {
    await request('POST', '/identity/backup', uploadBody());
    expect(mockByUser.size).toBe(1);
    const res = await request('DELETE', '/identity/backup');
    expect(res.status).toBe(200);
    expect(mockByUser.size).toBe(0);
  });
});

describe('GET /identity/backup/:lookupId (public restore)', () => {
  it('returns the envelope for a known locator — hashing the supplied value', async () => {
    const rawLookupId = 'c'.repeat(64);
    await request('POST', '/identity/backup', uploadBody({ lookupId: rawLookupId }));

    const res = await request('GET', `/identity/backup/${rawLookupId}`);
    expect(res.status).toBe(200);
    // Full envelope, no locator/hash leaked.
    expect(res.body).toEqual({
      version: 1,
      algorithm: 'xchacha20poly1305',
      kdfInfo: 'oxy-backup-encryption-key',
      nonce: '00'.repeat(24),
      ciphertext: 'deadbeefcafe',
      publicKeyHint: '04abcdef01234567',
      createdAt: '2026-07-16T00:00:00.000Z',
    });
    expect(res.body.lookupIdHash).toBeUndefined();

    // The lookup was BY the hash of the supplied raw locator.
    const lastFindOne = mockFindOne.mock.calls.at(-1)?.[0] as { lookupIdHash?: string };
    expect(lastFindOne.lookupIdHash).toBe(sha256Hex(rawLookupId));
  });

  it('returns a constant-shape 404 for an unknown locator (no existence short-circuit)', async () => {
    const res = await request('GET', `/identity/backup/${'d'.repeat(64)}`);
    expect(res.status).toBe(404);
    // The not-found path STILL performed the hash-and-lookup — proof there is no
    // pre-query short-circuit that could leak existence via timing.
    const lastFindOne = mockFindOne.mock.calls.at(-1)?.[0] as { lookupIdHash?: string };
    expect(lastFindOne.lookupIdHash).toBe(sha256Hex('d'.repeat(64)));
  });

  it('returns 400 for a malformed locator (wrong length / non-hex)', async () => {
    const res = await request('GET', '/identity/backup/not-a-valid-locator');
    expect(res.status).toBe(400);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('does not leak whether a DIFFERENT user has a backup (only the exact locator matches)', async () => {
    // A backup exists (some user), but a lookup with the WRONG locator 404s.
    await request('POST', '/identity/backup', uploadBody({ lookupId: 'e'.repeat(64) }));
    const res = await request('GET', `/identity/backup/${'f'.repeat(64)}`);
    expect(res.status).toBe(404);
  });
});

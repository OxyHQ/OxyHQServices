/**
 * Key-rotation route tests (b3 Feature 3 — atomic key rotation + last-credential
 * replacement).
 *
 * Proves the security invariants of `POST /auth/rotate/challenge` +
 * `POST /auth/rotate/complete`:
 *  - `oldPublicKey` is ALWAYS derived from the user doc, never the request (a
 *    client-supplied `oldPublicKey` is ignored; a signature from the wrong key
 *    is rejected);
 *  - the `rotate_key` challenge is purpose-scoped (a signin challenge can NEVER
 *    complete a rotation) and single-use (burn is atomic);
 *  - rotation is an atomic REPLACE — the `authMethods` array length is unchanged
 *    (never a `countAuthMethods() === 0` window);
 *  - `newPublicKey` already registered elsewhere is rejected (409);
 *  - `userCache.invalidate` fires and the derived DID reflects the new key
 *    immediately;
 *  - `signOutEverywhere` revokes other sessions.
 *
 * The real `SignatureService` and `did.service` run; only the models + cache +
 * session service are mocked (the global mongoose mock cannot load the real
 * schema).
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { ec as EC } from 'elliptic';

const USER_ID = '507f1f77bcf86cd799439011';

interface MockUserDoc {
  _id: string;
  email?: string;
  publicKey?: string;
  createdAt: Date;
  authMethods: Array<{ type: string; linkedAt: Date; metadata?: Record<string, unknown> }>;
  save: jest.Mock;
}

interface ChallengeEntry {
  publicKey: string;
  purpose: string;
  used: boolean;
  expiresAt: Date;
}

let mockUserDoc: MockUserDoc;
let mockConflictUser: { _id: string } | null;
let mockOtherSessions: Array<{ sessionId: string }>;
const mockInvalidate = jest.fn();
const mockDeactivateAll = jest.fn();
const mockEmitSessionUpdate = jest.fn();
const mockChallengeStore = new Map<string, ChallengeEntry>();

function selectable(doc: unknown) {
  return {
    select: () => selectable(doc),
    lean: () => Promise.resolve(doc),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(doc).then(resolve, reject),
  };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = mockUserDoc;
    next();
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findById: () => selectable(mockUserDoc),
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockConflictUser) }) }),
  },
  buildAuthMethod: (type: string, metadata?: Record<string, unknown>) => ({ type, linkedAt: new Date(), metadata }),
}));

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: {
    create: async (doc: { publicKey: string; challenge: string; purpose?: string; expiresAt: Date; used?: boolean }) => {
      mockChallengeStore.set(doc.challenge, {
        publicKey: doc.publicKey,
        purpose: doc.purpose ?? 'signin',
        used: doc.used ?? false,
        expiresAt: doc.expiresAt,
      });
      return doc;
    },
    // Atomic single-use burn: matches the same {challenge, publicKey, used:false,
    // purpose, expiresAt:$gt} filter the route uses, marks it used, returns the
    // prior (truthy) doc or null.
    findOneAndUpdate: async (filter: {
      challenge: string;
      publicKey?: string;
      used?: boolean;
      purpose?: string;
      expiresAt?: { $gt: Date };
    }) => {
      const entry = mockChallengeStore.get(filter.challenge);
      if (!entry || entry.used) return null;
      if (filter.publicKey !== undefined && entry.publicKey !== filter.publicKey) return null;
      if (filter.purpose !== undefined && entry.purpose !== filter.purpose) return null;
      if (filter.expiresAt?.$gt && !(entry.expiresAt > filter.expiresAt.$gt)) return null;
      entry.used = true;
      return { _id: 'challenge-id', challenge: filter.challenge };
    },
  },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: {
    find: () => ({ select: () => ({ lean: () => Promise.resolve(mockOtherSessions) }) }),
  },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { deactivateAllUserSessions: (...args: unknown[]) => mockDeactivateAll(...args) },
}));

jest.mock('../../server', () => ({
  __esModule: true,
  emitSessionUpdate: (...args: unknown[]) => mockEmitSessionUpdate(...args),
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) },
}));

import authLinkingRouter from '../authLinking';
import SignatureService from '../../services/signature.service';
import { buildDidDocument } from '../../services/did.service';

const ec = new EC('secp256k1');

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(server: http.Server, method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: body !== undefined
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

let server: http.Server;
let oldKeyPair: EC.KeyPair;
let oldPublicKey: string;
let oldPrivateKey: string;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authLinkingRouter);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockChallengeStore.clear();
  mockConflictUser = null;
  mockOtherSessions = [];

  oldKeyPair = ec.genKeyPair();
  oldPublicKey = oldKeyPair.getPublic('hex');
  oldPrivateKey = oldKeyPair.getPrivate('hex');

  mockUserDoc = {
    _id: USER_ID,
    email: 'nate@oxy.so',
    publicKey: oldPublicKey,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    authMethods: [
      { type: 'identity', linkedAt: new Date('2026-01-01T00:00:00.000Z'), metadata: { publicKey: oldPublicKey } },
    ],
    save: jest.fn().mockResolvedValue(undefined),
  };
});

/** Mint a rotate_key challenge for the current user via the real endpoint. */
async function mintRotateChallenge(): Promise<string> {
  const res = await request(server, 'POST', '/auth/rotate/challenge');
  expect(res.status).toBe(200);
  return res.body.challenge as string;
}

/** Sign the canonical rotation payload with the given private key. */
function signRotation(params: {
  privateKey: string;
  oldPublicKey: string;
  newPublicKey: string;
  challenge: string;
  timestamp: number;
}): string {
  const message = JSON.stringify({
    action: 'rotate_key',
    userId: USER_ID,
    oldPublicKey: params.oldPublicKey,
    newPublicKey: params.newPublicKey,
    challenge: params.challenge,
    timestamp: params.timestamp,
  });
  return SignatureService.signMessage(message, params.privateKey);
}

describe('POST /auth/rotate/complete — happy path', () => {
  it('atomically replaces the identity key, keeping authMethods length constant', async () => {
    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    const lengthBefore = mockUserDoc.authMethods.length;

    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey, challenge, signature, timestamp });

    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(newPublicKey);
    // Swapped in place.
    expect(mockUserDoc.publicKey).toBe(newPublicKey);
    // Atomic replace: array length is NEVER changed (no countAuthMethods()===0 window).
    expect(mockUserDoc.authMethods).toHaveLength(lengthBefore);
    expect(mockUserDoc.authMethods).toHaveLength(1);
    const identity = mockUserDoc.authMethods.find((m) => m.type === 'identity');
    expect(identity?.metadata?.publicKey).toBe(newPublicKey);
    expect(mockUserDoc.save).toHaveBeenCalledTimes(1);
    // Cache invalidated.
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
    // The derived DID reflects the new key IMMEDIATELY.
    const vms = buildDidDocument(mockUserDoc).verificationMethod as Array<{ publicKeyHex?: string }>;
    expect(vms.some((vm) => vm.publicKeyHex === newPublicKey)).toBe(true);
    expect(vms.some((vm) => vm.publicKeyHex === oldPublicKey)).toBe(false);
  });
});

describe('security invariant — oldPublicKey is server-derived', () => {
  it('ignores a client-supplied oldPublicKey and validates against the user doc key', async () => {
    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    const attacker = ec.genKeyPair();

    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    // Sign correctly with the REAL old key; also smuggle a bogus oldPublicKey field.
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', {
      newPublicKey,
      challenge,
      signature,
      timestamp,
      oldPublicKey: attacker.getPublic('hex'), // ignored by the server
    });

    expect(res.status).toBe(200);
    expect(mockUserDoc.publicKey).toBe(newPublicKey);
  });

  it('rejects a signature made with a key other than the account key (proving control of X but rotating Y)', async () => {
    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    const attacker = ec.genKeyPair();

    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    // Attacker signs with THEIR key; the server reconstructs with the doc's oldPublicKey.
    const signature = signRotation({ privateKey: attacker.getPrivate('hex'), oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey, challenge, signature, timestamp });

    expect(res.status).toBe(400);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(mockUserDoc.publicKey).toBe(oldPublicKey);
  });
});

describe('security invariant — purpose scoping', () => {
  it('a signin challenge (default purpose) can NOT complete a rotation', async () => {
    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    // Seed a SIGNIN-purpose challenge directly (as the signin flow would).
    const challenge = 'signin-challenge-value';
    mockChallengeStore.set(challenge, {
      publicKey: oldPublicKey,
      purpose: 'signin',
      used: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey, challenge, signature, timestamp });

    expect(res.status).toBe(401);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
    // The signin challenge must remain UNUSED (rotation never touched it).
    expect(mockChallengeStore.get(challenge)?.used).toBe(false);
  });
});

describe('security invariant — single-use challenge', () => {
  it('rejects a second rotation with an already-burned challenge', async () => {
    const first = ec.genKeyPair().getPublic('hex');
    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const sig1 = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey: first, challenge, timestamp });

    const res1 = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey: first, challenge, signature: sig1, timestamp });
    expect(res1.status).toBe(200);

    // Replay with the same (now burned) challenge — the account key is now `first`.
    const second = ec.genKeyPair().getPublic('hex');
    const sig2 = signRotation({ privateKey: oldPrivateKey, oldPublicKey: first, newPublicKey: second, challenge, timestamp });
    const res2 = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey: second, challenge, signature: sig2, timestamp });
    expect(res2.status).toBe(401);
  });
});

describe('conflict + validation guards', () => {
  it('rejects a newPublicKey already registered to another account (409)', async () => {
    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    mockConflictUser = { _id: 'a-different-user' };

    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey, challenge, signature, timestamp });

    expect(res.status).toBe(409);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
    expect(mockUserDoc.publicKey).toBe(oldPublicKey);
  });

  it('rejects rotating to the SAME key (400)', async () => {
    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey: oldPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey: oldPublicKey, challenge, signature, timestamp });

    expect(res.status).toBe(400);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid newPublicKey (400)', async () => {
    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey: 'not-a-key', challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey: 'not-a-key', challenge, signature, timestamp });

    expect(res.status).toBe(400);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
  });

  it('the challenge endpoint rejects an account with no identity key (400)', async () => {
    mockUserDoc.publicKey = undefined;
    const res = await request(server, 'POST', '/auth/rotate/challenge');
    expect(res.status).toBe(400);
  });
});

describe('signOutEverywhere', () => {
  it('revokes other sessions and pushes a sessions_removed event on success', async () => {
    mockOtherSessions = [{ sessionId: 's2' }, { sessionId: 's3' }];
    mockDeactivateAll.mockResolvedValue(2);

    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', {
      newPublicKey,
      challenge,
      signature,
      timestamp,
      signOutEverywhere: true,
    });

    expect(res.status).toBe(200);
    expect(mockDeactivateAll).toHaveBeenCalledWith(USER_ID, undefined);
    expect(mockEmitSessionUpdate).toHaveBeenCalledWith(USER_ID, { type: 'sessions_removed', sessionIds: ['s2', 's3'] });
  });

  it('does NOT revoke other sessions when the flag is absent', async () => {
    const newKeyPair = ec.genKeyPair();
    const newPublicKey = newKeyPair.getPublic('hex');
    const challenge = await mintRotateChallenge();
    const timestamp = Date.now();
    const signature = signRotation({ privateKey: oldPrivateKey, oldPublicKey, newPublicKey, challenge, timestamp });

    const res = await request(server, 'POST', '/auth/rotate/complete', { newPublicKey, challenge, signature, timestamp });

    expect(res.status).toBe(200);
    expect(mockDeactivateAll).not.toHaveBeenCalled();
    expect(mockEmitSessionUpdate).not.toHaveBeenCalled();
  });
});

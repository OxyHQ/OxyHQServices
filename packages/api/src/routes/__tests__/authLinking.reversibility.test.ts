/**
 * Reversibility + cache-invalidation tests for auth-method linking (B4).
 *
 * Proves the self-sovereign ↔ custodial round trip the DID layer depends on:
 * linking an `identity` key flips the account to self-sovereign (DID controlled
 * by `[userDid, OXY_DID]`); unlinking it reverts to custodial (`[OXY_DID]`); and
 * `userCache.invalidate` fires after BOTH writes (without it the DID document
 * would serve stale state). Also locks the `GET /auth/methods` contract shape.
 *
 * The real `SignatureService` and `did.service` run; only the model + cache are
 * mocked (the global mongoose mock cannot load the real schema).
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

let mockUserDoc: MockUserDoc;
const mockInvalidate = jest.fn();
const mockWacFindOne = jest.fn();
const mockWacDeleteOne = jest.fn();

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
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
  },
  buildAuthMethod: (type: string, metadata?: Record<string, unknown>) => ({ type, linkedAt: new Date(), metadata }),
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) },
}));

jest.mock('../../models/WebauthnCredential', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockWacFindOne(...args),
    deleteOne: (...args: unknown[]) => mockWacDeleteOne(...args),
  },
}));

// authLinking imports the session service + Session model (for the key-rotation
// `signOutEverywhere` path); stub them so the real modules — which crash at load
// under the global mongoose mock (`SessionSchema.methods` is undefined) — are
// never evaluated. These reversibility tests never exercise rotation.
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { deactivateAllUserSessions: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

import authLinkingRouter from '../authLinking';
import SignatureService from '../../services/signature.service';
import { buildDidDocument, buildUserDid, OXY_DID } from '../../services/did.service';

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
  mockUserDoc = {
    _id: USER_ID,
    email: 'nate@oxy.so',
    publicKey: undefined,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    // Custodial baseline: a passkey-only account (no identity key). Keeping one
    // passkey here means the identity link/unlink round trip is not blocked by
    // the "keep ≥1 auth method" guard when the identity is later removed.
    authMethods: [{ type: 'webauthn', linkedAt: new Date('2026-01-01T00:00:00.000Z'), metadata: { credentialID: 'baseline-passkey' } }],
    save: jest.fn().mockResolvedValue(undefined),
  };
  mockWacFindOne.mockResolvedValue({ _id: 'wac-1', credentialID: 'passkey-1', userId: USER_ID });
  mockWacDeleteOne.mockResolvedValue({ acknowledged: true, deletedCount: 1 });
});

describe('identity link/unlink reversibility', () => {
  it('links → self-sovereign DID, unlinks → custodial DID, invalidating cache each step', async () => {
    const keyPair = ec.genKeyPair();
    const publicKey = keyPair.getPublic('hex');
    const privateKey = keyPair.getPrivate('hex');
    const timestamp = Date.now();
    const signature = SignatureService.signMessage(
      JSON.stringify({ action: 'link_identity', userId: USER_ID, timestamp }),
      privateKey,
    );

    // Before: custodial — controlled solely by Oxy.
    expect(buildDidDocument(mockUserDoc).controller).toEqual([OXY_DID]);

    const linkRes = await request(server, 'POST', '/auth/link', { type: 'identity', publicKey, signature, timestamp });
    expect(linkRes.status).toBe(200);
    expect(mockUserDoc.publicKey).toBe(publicKey);
    expect(mockUserDoc.save).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);

    // After link: self-sovereign — controlled by [userDid, OXY_DID].
    const did = buildUserDid(USER_ID);
    expect(buildDidDocument(mockUserDoc).controller).toEqual([did, OXY_DID]);

    mockInvalidate.mockClear();

    const unlinkRes = await request(server, 'DELETE', '/auth/link/identity');
    expect(unlinkRes.status).toBe(200);
    expect(mockUserDoc.publicKey).toBeUndefined();
    expect(mockUserDoc.authMethods.some((m) => m.type === 'identity')).toBe(false);
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);

    // Back to custodial.
    expect(buildDidDocument(mockUserDoc).controller).toEqual([OXY_DID]);
  });

  it('rejects an identity link with an invalid signature (no write, no invalidate)', async () => {
    const publicKey = ec.genKeyPair().getPublic('hex');
    const res = await request(server, 'POST', '/auth/link', {
      type: 'identity',
      publicKey,
      signature: 'deadbeef',
      timestamp: Date.now(),
    });
    expect(res.status).toBe(400);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

describe('DELETE /auth/link/webauthn/:credentialID (keep ≥1 auth method)', () => {
  it('unlinks a passkey when other auth methods remain (removes row + credential + invalidates cache)', async () => {
    // identity + one passkey → two methods; unlinking the passkey is allowed.
    mockUserDoc.publicKey = ec.genKeyPair().getPublic('hex');
    mockUserDoc.authMethods = [
      { type: 'identity', linkedAt: new Date('2026-01-01T00:00:00.000Z'), metadata: { publicKey: mockUserDoc.publicKey } },
      { type: 'webauthn', linkedAt: new Date('2026-02-01T00:00:00.000Z'), metadata: { credentialID: 'passkey-1', name: 'Laptop' } },
    ];

    const res = await request(server, 'DELETE', '/auth/link/webauthn/passkey-1');

    expect(res.status).toBe(200);
    expect(mockUserDoc.authMethods.some((m) => m.type === 'webauthn')).toBe(false);
    expect(mockUserDoc.save).toHaveBeenCalledTimes(1);
    expect(mockWacDeleteOne).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });

  it('refuses to unlink the LAST auth method — a passkey-only account (no write, no delete)', async () => {
    // The passkey is the ONLY auth method: no publicKey.
    mockUserDoc.publicKey = undefined;
    mockUserDoc.authMethods = [
      { type: 'webauthn', linkedAt: new Date('2026-02-01T00:00:00.000Z'), metadata: { credentialID: 'passkey-1', name: 'Laptop' } },
    ];

    const res = await request(server, 'DELETE', '/auth/link/webauthn/passkey-1');

    expect(res.status).toBe(400);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
    expect(mockWacDeleteOne).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('rejects unlinking a passkey the account does not own (404-style 400)', async () => {
    mockUserDoc.publicKey = ec.genKeyPair().getPublic('hex');
    mockUserDoc.authMethods = [
      { type: 'identity', linkedAt: new Date('2026-01-01T00:00:00.000Z'), metadata: { publicKey: mockUserDoc.publicKey } },
      { type: 'webauthn', linkedAt: new Date('2026-02-01T00:00:00.000Z'), metadata: { credentialID: 'passkey-1' } },
    ];
    mockWacFindOne.mockResolvedValue(null);

    const res = await request(server, 'DELETE', '/auth/link/webauthn/passkey-1');

    expect(res.status).toBe(400);
    expect(mockUserDoc.save).not.toHaveBeenCalled();
  });
});

describe('GET /auth/methods contract (B4)', () => {
  it('returns the account DID plus contract-shaped methods', async () => {
    mockUserDoc.publicKey = ec.genKeyPair().getPublic('hex');
    mockUserDoc.authMethods = [
      { type: 'identity', linkedAt: new Date('2026-02-01T00:00:00.000Z'), metadata: { publicKey: mockUserDoc.publicKey } },
      { type: 'webauthn', linkedAt: new Date('2026-01-01T00:00:00.000Z'), metadata: { credentialID: 'passkey-1', name: 'Laptop' } },
    ];

    const res = await request(server, 'GET', '/auth/methods');

    expect(res.status).toBe(200);
    expect(res.body.did).toBe(buildUserDid(USER_ID));
    const methods = res.body.methods as Array<{ type: string; verificationMethodId?: string }>;
    const identity = methods.find((m) => m.type === 'identity');
    const passkey = methods.find((m) => m.type === 'webauthn');
    expect(identity?.verificationMethodId).toBe('#key-1');
    expect(passkey).toBeDefined();
    expect(passkey?.verificationMethodId).toBeUndefined();
    // The legacy free-form `identifier` field is gone — the response is exactly
    // the `authMethodsResponseSchema` shape.
    expect((methods[0] as Record<string, unknown>).identifier).toBeUndefined();
  });
});

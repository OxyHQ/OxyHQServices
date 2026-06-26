/**
 * Route + service tests for the signed identity export (B6).
 *
 * Mounts the real `usersRouter` and runs the REAL `buildExportBundle` against
 * mocked models, so the test exercises the whole producer path: contents,
 * secret-stripping (`formatUserResponse`), the Oxy provenance attestation
 * (verifies when the signing key is present, null when absent), and the NDJSON
 * stream. Only the data layer (User / SignedRecord / UserAppData) and the heavy
 * unrelated user-service deps are stubbed.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { ec as EC } from 'elliptic';
import { canonicalize } from '@oxyhq/core';
import { exportBundleSchema } from '@oxyhq/contracts';
import SignatureService from '../../services/signature.service';

const ec = new EC('secp256k1');
const oxyKey = ec.genKeyPair();
const OXY_PUBLIC_KEY = oxyKey.getPublic('hex');
const OXY_PRIVATE_KEY = oxyKey.getPrivate('hex');
const userKey = ec.genKeyPair();
const USER_PUBLIC_KEY = userKey.getPublic('hex');

const USER_ID = '507f1f77bcf86cd799439011';
let currentUserId = USER_ID;

const mockUserFindById = jest.fn();
const mockSignedRecordFind = jest.fn();
const mockAppDataFind = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
    req.user = { id: currentUserId };
    next();
  },
  serviceAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: { find: (...args: unknown[]) => mockSignedRecordFind(...args) },
}));

// RepoHead is mocked so signedRecord.service's real model import does not load
// under the global mongoose mock; the export path doesn't touch the chain head.
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/UserAppData', () => ({
  __esModule: true,
  default: { find: (...args: unknown[]) => mockAppDataFind(...args) },
  UserAppData: { find: (...args: unknown[]) => mockAppDataFind(...args) },
}));

// Unrelated user-route deps — stubbed only so the router module loads.
jest.mock('../../services/email.service', () => ({ emailService: { deleteAllUserData: jest.fn() } }));
jest.mock('../../services/federation.service', () => ({ federationService: { scheduleAvatarRefresh: jest.fn() } }));
jest.mock('../../services/assetServiceSingleton', () => ({ assetService: {}, s3Service: {} }));
jest.mock('../../services/user.service', () => ({ userService: {} }));
jest.mock('../../controllers/users.controller', () => ({
  UsersController: class { searchUsers = jest.fn(); },
}));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: jest.fn() } }));
jest.mock('../../utils/validation', () => ({ resolveUserIdToObjectId: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import usersRouter from '../users';
import { errorHandler } from '../../middleware/errorHandler';

function leanUser(doc: unknown) {
  return { select: () => ({ lean: () => Promise.resolve(doc) }) };
}
function sortLean(rows: unknown[]) {
  return { sort: () => ({ lean: () => Promise.resolve(rows) }) };
}
function leanCursor(rows: unknown[]) {
  return {
    lean: () => ({
      cursor: () => (async function* gen() {
        for (const row of rows) yield row;
      })(),
    }),
  };
}

/** A representative user doc — INCLUDING secrets, to prove they are stripped. */
function makeUserDoc(id: string = USER_ID) {
  return {
    _id: id,
    publicKey: USER_PUBLIC_KEY,
    username: 'nate',
    email: 'nate@oxy.so',
    name: { first: 'Nate', last: 'Isern' },
    avatar: 'file-1',
    color: 'purple',
    privacySettings: { isPrivateAccount: false },
    verifiedDomains: [{ domain: 'nate.com', verifiedAt: '2026-06-01T00:00:00.000Z', method: 'dns-txt' }],
    authMethods: [{ type: 'identity', metadata: { publicKey: USER_PUBLIC_KEY }, linkedAt: '2026-05-01T00:00:00.000Z' }],
    following: ['507f1f77bcf86cd799439012'],
    followers: ['507f1f77bcf86cd799439013'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    // Secrets that MUST NOT appear in the export.
    password: 'hashed-secret',
    refreshToken: 'refresh-secret',
    twoFactorAuth: { enabled: true, secret: 'totp-secret', backupCodes: ['x'] },
  };
}

let server: http.Server;
const ORIGINAL_PRIV = process.env.OXY_PRIVATE_KEY;
const ORIGINAL_PUB = process.env.OXY_PUBLIC_KEY;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  currentUserId = `${USER_ID}`;
});

afterEach(() => {
  if (ORIGINAL_PRIV === undefined) delete process.env.OXY_PRIVATE_KEY; else process.env.OXY_PRIVATE_KEY = ORIGINAL_PRIV;
  if (ORIGINAL_PUB === undefined) delete process.env.OXY_PUBLIC_KEY; else process.env.OXY_PUBLIC_KEY = ORIGINAL_PUB;
});

function getRaw(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; raw: string }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, raw }));
    }).on('error', reject);
  });
}

describe('GET /users/me/export (JSON)', () => {
  it('returns a contract-valid bundle, strips secrets, and seals an attestation that verifies', async () => {
    process.env.OXY_PRIVATE_KEY = OXY_PRIVATE_KEY;
    process.env.OXY_PUBLIC_KEY = OXY_PUBLIC_KEY;
    currentUserId = '507f1f77bcf86cd799439021';

    mockUserFindById.mockReturnValueOnce(leanUser(makeUserDoc(currentUserId)));
    mockSignedRecordFind.mockReturnValueOnce(sortLean([]));
    mockAppDataFind.mockReturnValueOnce(leanCursor([{ namespace: 'academy', key: 'progress', value: { done: 3 } }]));

    const res = await getRaw('/users/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const bundle = JSON.parse(res.raw);
    expect(bundle.did).toBe(`did:web:oxy.so:u:${currentUserId}`);
    expect(bundle.didDocument.id).toBe(bundle.did);
    expect(bundle.verifiedDomains).toEqual([{ domain: 'nate.com', verifiedAt: '2026-06-01T00:00:00.000Z', method: 'dns-txt' }]);
    expect(bundle.authMethods[0]).toMatchObject({ type: 'identity', verificationMethodId: '#key-1' });
    expect(bundle.appData).toEqual([{ namespace: 'academy', key: 'progress', value: { done: 3 } }]);
    expect(bundle.social.following).toEqual(['did:web:oxy.so:u:507f1f77bcf86cd799439012']);
    expect(bundle.social.followers).toEqual(['did:web:oxy.so:u:507f1f77bcf86cd799439013']);

    // Secrets must be absent everywhere in the profile section.
    const profileJson = JSON.stringify(bundle.profile);
    expect(profileJson).not.toContain('hashed-secret');
    expect(profileJson).not.toContain('refresh-secret');
    expect(profileJson).not.toContain('totp-secret');
    expect(bundle.profile.password).toBeUndefined();
    expect(bundle.profile.refreshToken).toBeUndefined();
    expect(bundle.profile.twoFactorAuth).toBeUndefined();

    // The Oxy attestation verifies over canonicalize(bundle minus attestation).
    expect(bundle.attestation).not.toBeNull();
    expect(bundle.attestation.publicKey).toBe(OXY_PUBLIC_KEY);
    const { attestation, proof, ...signed } = bundle;
    expect(proof).toBeUndefined();
    expect(SignatureService.verifySignature(canonicalize(signed), attestation.signature, OXY_PUBLIC_KEY)).toBe(true);
    // The signed bundle conforms to the published contract.
    expect(exportBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it('serves the bundle with attestation: null when no Oxy signing key is configured', async () => {
    delete process.env.OXY_PRIVATE_KEY;
    delete process.env.OXY_PUBLIC_KEY;
    currentUserId = '507f1f77bcf86cd799439022';

    mockUserFindById.mockReturnValueOnce(leanUser(makeUserDoc(currentUserId)));
    mockSignedRecordFind.mockReturnValueOnce(sortLean([]));
    mockAppDataFind.mockReturnValueOnce(leanCursor([]));

    const res = await getRaw('/users/me/export');
    expect(res.status).toBe(200);
    const bundle = JSON.parse(res.raw);
    expect(bundle.attestation).toBeNull();
    // The no-key bundle (attestation: null) MUST still conform to the contract
    // now that exportBundleSchema.attestation is nullable.
    expect(exportBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it('returns 404 when the user does not exist', async () => {
    currentUserId = '507f1f77bcf86cd799439023';
    mockUserFindById.mockReturnValueOnce(leanUser(null));

    const res = await getRaw('/users/me/export');
    expect(res.status).toBe(404);
  });
});

describe('GET /users/me/export?format=ndjson', () => {
  it('streams the sections as newline-delimited JSON', async () => {
    process.env.OXY_PRIVATE_KEY = OXY_PRIVATE_KEY;
    process.env.OXY_PUBLIC_KEY = OXY_PUBLIC_KEY;
    currentUserId = '507f1f77bcf86cd799439024';

    mockUserFindById.mockReturnValueOnce(leanUser(makeUserDoc(currentUserId)));
    mockSignedRecordFind.mockReturnValueOnce(sortLean([]));
    mockAppDataFind.mockReturnValueOnce(leanCursor([{ namespace: 'academy', key: 'progress', value: { done: 1 } }]));

    const res = await getRaw('/users/me/export?format=ndjson');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');

    const lines = res.raw.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].kind).toBe('meta');
    expect(lines[0].did).toBe(`did:web:oxy.so:u:${currentUserId}`);
    expect(lines.some((l) => l.kind === 'appData')).toBe(true);
    expect(lines.some((l) => l.kind === 'following')).toBe(true);
    expect(lines[lines.length - 1].kind).toBe('attestation');
    expect(lines[lines.length - 1].attestation.publicKey).toBe(OXY_PUBLIC_KEY);
  });
});

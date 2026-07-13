/**
 * /applications routes — account-derived RBAC, credentials, redirect URIs.
 *
 * After the unified-Account cutover, application access is DERIVED from the
 * caller's effective `AccountMember` role over `app.ownerAccountId` (via
 * `appPermissionsForAccountRole`). There is no per-app member table. These tests
 * mock `account.service` to grant roles and drive the route's permission gates
 * end-to-end over real HTTP without a database.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Types } from 'mongoose';

// Restore the real mongoose (the global setup stubs it) so ObjectId works.
jest.mock('mongoose', () => jest.requireActual('mongoose'));

import type { AccountRole } from '../../utils/accountRoles';
import { permissionsForAccountRole } from '../../utils/accountRoles';

const OWNER_ID = '6a0000000000000000000001';
const OTHER_ID = '6a0000000000000000000002';
const ORG_ID = '6a0000000000000000000010';
const APP_ID = '6a00000000000000000000a1';

// ---------------------------------------------------------------------------
// In-memory Application + ApplicationCredential fakes
// ---------------------------------------------------------------------------

interface FakeApp {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  termsUrl?: string;
  icon?: string;
  type: string;
  status: string;
  isOfficial: boolean;
  isInternal: boolean;
  capabilities: string[];
  redirectUris: string[];
  scopes: string[];
  webhookUrl?: string;
  webhookSecret?: string;
  devWebhookUrl?: string;
  ownerAccountId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
}

interface FakeCredential {
  _id: Types.ObjectId;
  applicationId: Types.ObjectId;
  name: string;
  publicKey: string;
  secretHash?: string;
  type: string;
  environment: string;
  scopes: string[];
  status: string;
  expiresAt?: Date;
  rotatedFromCredentialId?: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
}

const apps: FakeApp[] = [];
const credentials: FakeCredential[] = [];

const idEq = (a: unknown, b: unknown): boolean => String(a) === String(b);

function matchField(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Types.ObjectId) {
    return Array.isArray(actual) ? actual.some((a) => idEq(a, expected)) : idEq(actual, expected);
  }
  if (expected !== null && typeof expected === 'object') {
    const op = expected as Record<string, unknown>;
    if ('$in' in op) {
      const list = op.$in as unknown[];
      return Array.isArray(actual)
        ? actual.some((a) => list.some((v) => idEq(a, v)))
        : list.some((v) => idEq(v, actual));
    }
    if ('$ne' in op) return !idEq(actual, op.$ne);
    return false;
  }
  return idEq(actual, expected);
}

function matchesQuery(doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => matchField(doc[key], expected));
}

function listQuery<T extends Record<string, unknown>>(results: T[]) {
  const chain = {
    sort: () => chain,
    select: () => chain,
    lean: async () => results[0] ?? null,
    then: (resolve: (v: T[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(results).then(resolve, reject),
  };
  return chain;
}

const ApplicationMock = {
  async findOne(query: Record<string, unknown> = {}) {
    return apps.find((a) => matchesQuery(a, query)) ?? null;
  },
  find(query: Record<string, unknown> = {}) {
    return listQuery(apps.filter((a) => matchesQuery(a, query)));
  },
  async create(data: Record<string, unknown>) {
    const now = new Date();
    const doc: FakeApp = {
      _id: new Types.ObjectId(),
      name: '',
      type: 'third_party',
      status: 'active',
      isOfficial: false,
      isInternal: false,
      capabilities: [],
      redirectUris: [],
      scopes: [],
      createdAt: now,
      updatedAt: now,
      save: jest.fn().mockResolvedValue(undefined),
      ...(data as Partial<FakeApp>),
    } as FakeApp;
    doc.save = jest.fn().mockResolvedValue(doc);
    apps.push(doc);
    return doc;
  },
};

const ApplicationCredentialMock = {
  find(query: Record<string, unknown> = {}) {
    return listQuery(credentials.filter((c) => matchesQuery(c, query)));
  },
  async findOne(query: Record<string, unknown> = {}) {
    return credentials.find((c) => matchesQuery(c, query)) ?? null;
  },
  async create(data: Record<string, unknown>) {
    const now = new Date();
    const doc: FakeCredential = {
      _id: new Types.ObjectId(),
      scopes: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
      save: jest.fn().mockResolvedValue(undefined),
      ...(data as Partial<FakeCredential>),
    } as FakeCredential;
    doc.save = jest.fn().mockResolvedValue(doc);
    credentials.push(doc);
    return doc;
  },
};

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: ApplicationMock,
  default: ApplicationMock,
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: ApplicationCredentialMock,
  default: ApplicationCredentialMock,
  APPLICATION_CREDENTIAL_TYPES: ['public', 'confidential', 'service'],
  APPLICATION_CREDENTIAL_ENVIRONMENTS: ['development', 'staging', 'production'],
}));

jest.mock('../../models/ApiKeyUsage', () => ({
  __esModule: true,
  default: { aggregate: jest.fn().mockResolvedValue([]) },
}));

// --- account.service mock ---------------------------------------------------
// Grant the caller an effective account role per (userId, accountId). A caller
// over their own account is an implicit owner (mirrors the real service).

const accessGrants = new Map<string, AccountRole>();
function grantAccess(userId: string, accountId: string, role: AccountRole): void {
  accessGrants.set(`${userId}:${accountId}`, role);
}

function resolveRole(userId: string, accountId: string): AccountRole | undefined {
  if (userId === accountId) return 'owner';
  return accessGrants.get(`${userId}:${accountId}`);
}

const accountServiceMock = {
  resolveEffectiveAccess: jest.fn(async (userId: string, accountId: string) => {
    const role = resolveRole(userId, accountId);
    if (!role) return null;
    return {
      role,
      permissions: permissionsForAccountRole(role),
      source: userId === accountId ? 'self' : 'direct',
      membership: null,
    };
  }),
  listAccessibleAccounts: jest.fn(async (userId: string) => {
    const nodes: Array<Record<string, unknown>> = [
      { accountId: userId, relationship: 'self', callerMembership: null },
    ];
    for (const [key, role] of accessGrants) {
      const [u, accountId] = key.split(':');
      if (u === userId) {
        nodes.push({
          accountId,
          relationship: role === 'owner' ? 'owner' : 'member',
          callerMembership: { role, permissions: [], source: 'direct', inherit: true },
        });
      }
    }
    return nodes;
  }),
};

jest.mock('../../services/account.service', () => ({
  __esModule: true,
  accountService: accountServiceMock,
}));

const mockAuthMiddleware = jest.fn();
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import applicationsRouter from '../applications';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown> & {
    application?: Record<string, unknown>;
    applications?: Array<Record<string, unknown>>;
    credential?: Record<string, unknown>;
    credentials?: Array<Record<string, unknown>>;
    secret?: string | null;
    rotatedFrom?: string;
    success?: boolean;
    error?: string;
    message?: string;
  };
}

async function requestJson(
  srv: http.Server,
  method: string,
  path: string,
  payload?: unknown
): Promise<JsonResponse> {
  const address = srv.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          Authorization: 'Bearer t',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let server: http.Server;
let currentUserId = OWNER_ID;
let currentIsStaff = false;

function actAs(userId: string, isStaff = false): void {
  currentUserId = userId;
  currentIsStaff = isStaff;
}

function seedApp(overrides: Partial<FakeApp> = {}): FakeApp {
  const now = new Date();
  const app: FakeApp = {
    _id: new Types.ObjectId(APP_ID),
    name: 'Seed App',
    type: 'third_party',
    status: 'active',
    isOfficial: false,
    isInternal: false,
    capabilities: [],
    redirectUris: [],
    scopes: [],
    ownerAccountId: new Types.ObjectId(OWNER_ID),
    createdByUserId: new Types.ObjectId(OWNER_ID),
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  apps.push(app);
  return app;
}

function seedCredential(overrides: Partial<FakeCredential> = {}): FakeCredential {
  const now = new Date();
  const credential: FakeCredential = {
    _id: new Types.ObjectId(),
    applicationId: new Types.ObjectId(APP_ID),
    name: 'Cred',
    publicKey: `oxy_dk_${new Types.ObjectId().toString()}`,
    secretHash: 'hash',
    type: 'confidential',
    environment: 'production',
    scopes: [],
    status: 'active',
    createdByUserId: new Types.ObjectId(OWNER_ID),
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  credentials.push(credential);
  return credential;
}

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/applications', applicationsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  apps.length = 0;
  credentials.length = 0;
  accessGrants.clear();
  actAs(OWNER_ID, false);
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: { toString: () => currentUserId }, isStaff: currentIsStaff };
      next();
    }
  );
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('POST /applications — create', () => {
  it('defaults ownerAccountId to the caller and embeds callerMembership', async () => {
    const res = await requestJson(server, 'POST', '/applications', { name: 'My App' });
    expect(res.status).toBe(201);
    expect(res.body.application?.ownerAccountId).toBe(OWNER_ID);
    expect((res.body.application?.callerMembership as Record<string, unknown>)?.role).toBe('owner');
  });

  it('binds to an explicit ownerAccountId the caller can create apps in', async () => {
    grantAccess(OWNER_ID, ORG_ID, 'admin');
    const res = await requestJson(server, 'POST', '/applications', {
      ownerAccountId: ORG_ID,
      name: 'Org App',
    });
    expect(res.status).toBe(201);
    expect(res.body.application?.ownerAccountId).toBe(ORG_ID);
  });

  it('403 when the caller has no access to the owning account', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      ownerAccountId: ORG_ID,
      name: 'Nope',
    });
    expect(res.status).toBe(403);
  });

  it('403 when the caller lacks apps:create (viewer)', async () => {
    grantAccess(OWNER_ID, ORG_ID, 'viewer');
    const res = await requestJson(server, 'POST', '/applications', {
      ownerAccountId: ORG_ID,
      name: 'Nope',
    });
    expect(res.status).toBe(403);
  });

  it('400 when ownerAccountId is malformed', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      ownerAccountId: 'not-an-id',
      name: 'Bad',
    });
    expect(res.status).toBe(400);
  });

  it('de-duplicates redirectUris preserving order and exact strings', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'R',
      redirectUris: ['https://a.com/cb', 'https://a.com/cb', 'https://b.com/cb'],
    });
    expect(res.status).toBe(201);
    expect(res.body.application?.redirectUris).toEqual(['https://a.com/cb', 'https://b.com/cb']);
  });

  it('403 when a non-staff creator self-grants a privileged scope', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'Priv',
      scopes: ['federation:write'],
    });
    expect(res.status).toBe(403);
  });

  it('allows a STAFF creator to grant a privileged scope', async () => {
    actAs(OWNER_ID, true);
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'Priv',
      scopes: ['federation:write'],
    });
    expect(res.status).toBe(201);
    expect(res.body.application?.scopes).toContain('federation:write');
  });
});

// ---------------------------------------------------------------------------
// Legal URLs (privacyPolicyUrl / termsUrl) — OAuth consent links
// ---------------------------------------------------------------------------

describe('privacyPolicyUrl / termsUrl — legal consent links', () => {
  it('create persists and serializes both legal URLs', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'Legal App',
      privacyPolicyUrl: 'https://example.com/privacy',
      termsUrl: 'https://example.com/terms',
    });
    expect(res.status).toBe(201);
    expect(res.body.application?.privacyPolicyUrl).toBe('https://example.com/privacy');
    expect(res.body.application?.termsUrl).toBe('https://example.com/terms');

    const stored = apps.find((a) => a.name === 'Legal App');
    expect(stored?.privacyPolicyUrl).toBe('https://example.com/privacy');
    expect(stored?.termsUrl).toBe('https://example.com/terms');
  });

  it('PATCH updates both legal URLs and serializes them', async () => {
    const app = seedApp();
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      privacyPolicyUrl: 'https://acme.example/privacy',
      termsUrl: 'https://acme.example/terms',
    });
    expect(res.status).toBe(200);
    expect(app.privacyPolicyUrl).toBe('https://acme.example/privacy');
    expect(app.termsUrl).toBe('https://acme.example/terms');
    expect(res.body.application?.privacyPolicyUrl).toBe('https://acme.example/privacy');
    expect(res.body.application?.termsUrl).toBe('https://acme.example/terms');
  });

  it('PATCH clears a legal URL with an empty string', async () => {
    const app = seedApp({ privacyPolicyUrl: 'https://example.com/privacy' });
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      privacyPolicyUrl: '',
    });
    expect(res.status).toBe(200);
    expect(app.privacyPolicyUrl).toBeUndefined();
  });

  it('400 when a legal URL is not a valid URL', async () => {
    seedApp();
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      privacyPolicyUrl: 'not-a-url',
    });
    expect(res.status).toBe(400);
  });

  it('400 when a legal URL is not https (http rejected on create)', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'Insecure',
      termsUrl: 'http://example.com/terms',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Read / update / delete RBAC
// ---------------------------------------------------------------------------

describe('GET/PATCH/DELETE /applications/:appId — account-derived RBAC', () => {
  it('owner can read its own app', async () => {
    seedApp();
    const res = await requestJson(server, 'GET', `/applications/${APP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.application?._id).toBe(APP_ID);
  });

  it('404 for a non-existent application', async () => {
    const res = await requestJson(server, 'GET', `/applications/${new Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });

  it('403 when the caller has no access to the owning account', async () => {
    seedApp({ ownerAccountId: new Types.ObjectId(ORG_ID) });
    actAs(OTHER_ID);
    const res = await requestJson(server, 'GET', `/applications/${APP_ID}`);
    expect(res.status).toBe(403);
  });

  it('a viewer cannot update (no app:update)', async () => {
    seedApp({ ownerAccountId: new Types.ObjectId(ORG_ID) });
    actAs(OTHER_ID);
    grantAccess(OTHER_ID, ORG_ID, 'viewer');
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, { name: 'X' });
    expect(res.status).toBe(403);
  });

  it('an editor can update but cannot delete', async () => {
    const app = seedApp({ ownerAccountId: new Types.ObjectId(ORG_ID) });
    actAs(OTHER_ID);
    grantAccess(OTHER_ID, ORG_ID, 'editor');

    const patch = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, { name: 'Renamed' });
    expect(patch.status).toBe(200);
    expect(app.name).toBe('Renamed');

    const del = await requestJson(server, 'DELETE', `/applications/${APP_ID}`);
    expect(del.status).toBe(403);
  });

  it('an admin can delete (soft-delete)', async () => {
    const app = seedApp({ ownerAccountId: new Types.ObjectId(ORG_ID) });
    actAs(OTHER_ID);
    grantAccess(OTHER_ID, ORG_ID, 'admin');
    const res = await requestJson(server, 'DELETE', `/applications/${APP_ID}`);
    expect(res.status).toBe(200);
    expect(app.status).toBe('deleted');
  });
});

// ---------------------------------------------------------------------------
// PATCH scopes — privileged-scope reconciliation
//
// Regression coverage for the root cause of Mention losing its granted, in-use
// `signals:write` scope: `PATCH /:appId` replaces `application.scopes` with the
// submitted array, so a non-staff caller submitting a stale/partial scope list
// (e.g. a console scope-picker whose canonical options omit a newly-added
// privileged scope) MUST NOT silently revoke an already-granted privileged
// scope. Non-staff callers can neither add nor drop privileged scopes.
// ---------------------------------------------------------------------------

describe('PATCH /applications/:appId — privileged scope reconciliation', () => {
  it('preserves an already-granted privileged scope a non-staff owner omits', async () => {
    const app = seedApp({ scopes: ['user:read', 'files:write', 'signals:write'] });

    // Simulates the console form re-submitting a canonical list that includes a
    // newly-added non-privileged scope (files:read) but drops signals:write.
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      scopes: ['user:read', 'files:write', 'files:read'],
    });

    expect(res.status).toBe(200);
    expect(app.scopes).toContain('signals:write');
    expect(app.scopes).toEqual(
      expect.arrayContaining(['user:read', 'files:write', 'files:read', 'signals:write'])
    );
    expect(res.body.application?.scopes).toContain('signals:write');
  });

  it('preserves multiple already-granted privileged scopes on a scope edit', async () => {
    const app = seedApp({ scopes: ['user:read', 'signals:write', 'federation:write'] });

    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      scopes: ['user:read'],
    });

    expect(res.status).toBe(200);
    expect(app.scopes).toEqual(
      expect.arrayContaining(['user:read', 'signals:write', 'federation:write'])
    );
  });

  it('still rejects a non-staff caller adding a new privileged scope', async () => {
    seedApp({ scopes: ['user:read'] });

    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      scopes: ['user:read', 'signals:write'],
    });

    expect(res.status).toBe(403);
  });

  it('lets a STAFF caller intentionally revoke a privileged scope', async () => {
    actAs(OWNER_ID, true);
    const app = seedApp({ scopes: ['user:read', 'signals:write'] });

    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      scopes: ['user:read'],
    });

    expect(res.status).toBe(200);
    expect(app.scopes).not.toContain('signals:write');
    expect(app.scopes).toEqual(['user:read']);
  });

  it('does not duplicate a privileged scope the non-staff caller kept', async () => {
    const app = seedApp({ scopes: ['user:read', 'signals:write'] });

    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      scopes: ['user:read', 'signals:write'],
    });

    expect(res.status).toBe(200);
    expect(app.scopes.filter((s: string) => s === 'signals:write')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('GET /applications — list', () => {
  it('lists apps across the accessible account forest', async () => {
    seedApp({ _id: new Types.ObjectId(), ownerAccountId: new Types.ObjectId(OWNER_ID) });
    seedApp({ _id: new Types.ObjectId(), ownerAccountId: new Types.ObjectId(ORG_ID) });
    grantAccess(OWNER_ID, ORG_ID, 'developer');

    const res = await requestJson(server, 'GET', '/applications');
    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(2);
  });

  it('?ownerAccountId= scopes to one account the caller can access', async () => {
    seedApp({ _id: new Types.ObjectId(), ownerAccountId: new Types.ObjectId(ORG_ID) });
    grantAccess(OWNER_ID, ORG_ID, 'admin');
    const res = await requestJson(server, 'GET', `/applications?ownerAccountId=${ORG_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications?.[0].ownerAccountId).toBe(ORG_ID);
  });

  it('403 when ?ownerAccountId= names an account the caller cannot access', async () => {
    const res = await requestJson(server, 'GET', `/applications?ownerAccountId=${ORG_ID}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

describe('credentials', () => {
  it('create returns the secret exactly once; read never exposes it', async () => {
    seedApp({ scopes: ['user:read'] });
    const created = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'CI',
      type: 'confidential',
      environment: 'production',
    });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^[a-f0-9]{64}$/);

    const list = await requestJson(server, 'GET', `/applications/${APP_ID}/credentials`);
    expect(list.status).toBe(200);
    expect(list.body.credentials?.[0]).not.toHaveProperty('secretHash');
    expect(list.body.credentials?.[0]).not.toHaveProperty('secret');
  });

  it('a public credential carries no secret', async () => {
    seedApp();
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'pub',
      type: 'public',
      environment: 'production',
    });
    expect(res.status).toBe(201);
    expect(res.body.secret).toBeNull();
  });

  it('rejects a service credential on a non-trusted application', async () => {
    seedApp({ type: 'third_party', isOfficial: false, isInternal: false });
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'svc',
      type: 'service',
      environment: 'production',
    });
    expect(res.status).toBe(403);
  });

  it('rejects credential scopes that exceed the application grant', async () => {
    seedApp({ scopes: ['user:read'] });
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'over',
      type: 'confidential',
      environment: 'production',
      scopes: ['federation:write'],
    });
    expect(res.status).toBe(400);
  });

  it('rotate mints a new credential and deprecates the previous one', async () => {
    seedApp();
    const previous = seedCredential({ type: 'confidential' });
    const res = await requestJson(
      server,
      'POST',
      `/applications/${APP_ID}/credentials/${previous._id.toString()}/rotate`
    );
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.rotatedFrom).toBe(previous._id.toString());
    expect(previous.status).toBe('deprecated');
    expect(previous.expiresAt).toBeInstanceOf(Date);
  });

  it('revoke marks the credential revoked', async () => {
    seedApp();
    const credential = seedCredential();
    const res = await requestJson(
      server,
      'DELETE',
      `/applications/${APP_ID}/credentials/${credential._id.toString()}`
    );
    expect(res.status).toBe(200);
    expect(credential.status).toBe('revoked');
  });

  it('a developer can manage credentials but a viewer cannot', async () => {
    seedApp({ ownerAccountId: new Types.ObjectId(ORG_ID) });
    actAs(OTHER_ID);
    grantAccess(OTHER_ID, ORG_ID, 'viewer');
    const viewerRes = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'x',
      type: 'confidential',
      environment: 'production',
    });
    expect(viewerRes.status).toBe(403);

    grantAccess(OTHER_ID, ORG_ID, 'developer');
    const devRes = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'ok',
      type: 'confidential',
      environment: 'production',
    });
    expect(devRes.status).toBe(201);
  });
});

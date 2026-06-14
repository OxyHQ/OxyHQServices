/**
 * /applications routes — membership RBAC, credentials, ownership, redirect URIs
 * (issue #213; folds in the ported #216 redirect-URI canonicalisation cases).
 *
 * Covers per issue #213 acceptance criteria:
 *  - membership permission enforcement (each role can/can't do gated actions);
 *  - credential access (secret returned once, never on read, revoke blocks);
 *  - ownership transfer + owner management (can't remove last owner, can't
 *    demote an owner except via transfer);
 *  - application lookup by `_id`;
 *  - staff-only field gating;
 *  - redirectUris persist + dedupe on create/update (ported from #216).
 *
 * The three Application models are mocked with small in-memory fakes so the
 * route logic (RBAC resolution, permission checks, serialisation) is exercised
 * end-to-end over real HTTP without a database.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Types } from 'mongoose';
import { permissionsForRole, type ApplicationRole } from '../../utils/applicationRoles';

// The global jest.setup.cjs replaces `mongoose` with a stub that lacks `Types`
// and `isValidObjectId`. This suite exercises real ObjectId validation /
// equality through the route, so restore the genuine module here. The static
// `import { Types }` above then resolves to the real mongoose export.
jest.mock('mongoose', () => jest.requireActual('mongoose'));

const mockAuthMiddleware = jest.fn();

interface FakeApp {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  websiteUrl?: string;
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
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
}

interface FakeMember {
  _id: Types.ObjectId;
  applicationId: Types.ObjectId;
  userId: Types.ObjectId;
  role: ApplicationRole;
  permissions: string[];
  invitedByUserId?: Types.ObjectId;
  joinedAt?: Date;
  status: string;
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
  lastUsedAt?: Date;
  expiresAt?: Date;
  rotatedFromCredentialId?: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
}

const apps: FakeApp[] = [];
const members: FakeMember[] = [];
const credentials: FakeCredential[] = [];

function resetStore(): void {
  apps.length = 0;
  members.length = 0;
  credentials.length = 0;
}

/** Test object-id strings (24 hex chars). */
const APP_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ADMIN_ID = 'cccccccccccccccccccccccc';
const DEVELOPER_ID = 'dddddddddddddddddddddddd';
const VIEWER_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';
const BILLING_ID = 'ffffffffffffffffffffffff';
const OUTSIDER_ID = '111111111111111111111111';

function matchesId(value: Types.ObjectId, candidate: unknown): boolean {
  return value.toString() === String(candidate);
}

function applyStatusFilter(record: { status: string }, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return record.status === filter;
  if (filter && typeof filter === 'object') {
    const ne = (filter as { $ne?: string }).$ne;
    if (ne !== undefined) return record.status !== ne;
  }
  return true;
}

// --- Application model fake -------------------------------------------------

const ApplicationMock = {
  findOne: jest.fn((query: Record<string, unknown>) =>
    Promise.resolve(
      apps.find(
        (a) =>
          (query._id === undefined || matchesId(a._id, query._id)) &&
          applyStatusFilter(a, query.status)
      ) ?? null
    )
  ),
  find: jest.fn((query: Record<string, unknown>) => {
    const idIn = (query._id as { $in?: unknown[] } | undefined)?.$in;
    const result = apps.filter(
      (a) =>
        (idIn === undefined || idIn.some((id) => matchesId(a._id, id))) &&
        applyStatusFilter(a, query.status)
    );
    return { sort: () => Promise.resolve(result) };
  }),
  create: jest.fn((doc: Record<string, unknown>) => {
    const now = new Date();
    const app: FakeApp = {
      _id: new Types.ObjectId(),
      name: doc.name as string,
      description: doc.description as string | undefined,
      websiteUrl: doc.websiteUrl as string | undefined,
      icon: doc.icon as string | undefined,
      type: (doc.type as string) ?? 'third_party',
      status: (doc.status as string) ?? 'active',
      isOfficial: (doc.isOfficial as boolean) ?? false,
      isInternal: (doc.isInternal as boolean) ?? false,
      capabilities: (doc.capabilities as string[]) ?? [],
      redirectUris: (doc.redirectUris as string[]) ?? [],
      scopes: (doc.scopes as string[]) ?? [],
      createdByUserId: doc.createdByUserId as Types.ObjectId,
      createdAt: now,
      updatedAt: now,
      save: jest.fn().mockResolvedValue(undefined),
    };
    apps.push(app);
    return Promise.resolve(app);
  }),
};

// --- ApplicationMember model fake ------------------------------------------

const ApplicationMemberMock = {
  findOne: jest.fn((query: Record<string, unknown>) =>
    Promise.resolve(
      members.find(
        (m) =>
          (query._id === undefined || matchesId(m._id, query._id)) &&
          (query.applicationId === undefined || matchesId(m.applicationId, query.applicationId)) &&
          (query.userId === undefined || matchesId(m.userId, query.userId)) &&
          (query.role === undefined || m.role === query.role) &&
          applyStatusFilter(m, query.status)
      ) ?? null
    )
  ),
  find: jest.fn((query: Record<string, unknown>) => {
    const result = members.filter(
      (m) =>
        (query.userId === undefined || matchesId(m.userId, query.userId)) &&
        (query.applicationId === undefined || matchesId(m.applicationId, query.applicationId)) &&
        applyStatusFilter(m, query.status)
    );
    // Mirror a mongoose Query: thenable (resolves to the array) AND chainable
    // via `.sort()` / `.select()`.
    return {
      sort: () => Promise.resolve(result),
      select: () => Promise.resolve(result),
      then: (resolve: (value: FakeMember[]) => unknown) => resolve(result),
    };
  }),
  countDocuments: jest.fn((query: Record<string, unknown>) =>
    Promise.resolve(
      members.filter(
        (m) =>
          (query.applicationId === undefined || matchesId(m.applicationId, query.applicationId)) &&
          (query.role === undefined || m.role === query.role) &&
          applyStatusFilter(m, query.status)
      ).length
    )
  ),
  create: jest.fn((doc: Record<string, unknown>) => {
    const now = new Date();
    const member: FakeMember = {
      _id: new Types.ObjectId(),
      applicationId: doc.applicationId as Types.ObjectId,
      userId: doc.userId as Types.ObjectId,
      role: doc.role as ApplicationRole,
      permissions: (doc.permissions as string[]) ?? [],
      invitedByUserId: doc.invitedByUserId as Types.ObjectId | undefined,
      joinedAt: doc.joinedAt as Date | undefined,
      status: (doc.status as string) ?? 'active',
      createdAt: now,
      updatedAt: now,
      save: jest.fn().mockResolvedValue(undefined),
    };
    member.save = jest.fn().mockResolvedValue(member);
    members.push(member);
    return Promise.resolve(member);
  }),
};

// --- ApplicationCredential model fake --------------------------------------

const ApplicationCredentialMock = {
  findOne: jest.fn((query: Record<string, unknown>) =>
    Promise.resolve(
      credentials.find(
        (c) =>
          (query._id === undefined || matchesId(c._id, query._id)) &&
          (query.applicationId === undefined || matchesId(c.applicationId, query.applicationId)) &&
          applyStatusFilter(c, query.status)
      ) ?? null
    )
  ),
  find: jest.fn((query: Record<string, unknown>) => {
    const result = credentials.filter(
      (c) => query.applicationId === undefined || matchesId(c.applicationId, query.applicationId)
    );
    return {
      select: () => ({ sort: () => Promise.resolve(result) }),
    };
  }),
  create: jest.fn((doc: Record<string, unknown>) => {
    const now = new Date();
    const credential: FakeCredential = {
      _id: new Types.ObjectId(),
      applicationId: doc.applicationId as Types.ObjectId,
      name: doc.name as string,
      publicKey: doc.publicKey as string,
      secretHash: doc.secretHash as string | undefined,
      type: doc.type as string,
      environment: doc.environment as string,
      scopes: (doc.scopes as string[]) ?? [],
      status: (doc.status as string) ?? 'active',
      rotatedFromCredentialId: doc.rotatedFromCredentialId as Types.ObjectId | undefined,
      createdByUserId: doc.createdByUserId as Types.ObjectId,
      createdAt: now,
      updatedAt: now,
      save: jest.fn().mockResolvedValue(undefined),
    };
    credentials.push(credential);
    return Promise.resolve(credential);
  }),
};

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: ApplicationMock,
  default: ApplicationMock,
  APPLICATION_SCOPES: [
    'files:read',
    'files:write',
    'files:delete',
    'user:read',
    'webhooks:receive',
    'chat:completions',
    'models:read',
    'federation:write',
  ],
}));

jest.mock('../../models/ApplicationMember', () => ({
  __esModule: true,
  ApplicationMember: ApplicationMemberMock,
  default: ApplicationMemberMock,
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
    member?: Record<string, unknown>;
    members?: Array<Record<string, unknown>>;
    credential?: Record<string, unknown>;
    credentials?: Array<Record<string, unknown>>;
    secret?: string | null;
    rotatedFrom?: string;
    graceExpiresAt?: string;
    success?: boolean;
    error?: string;
    message?: string;
  };
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload?: unknown
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
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
    createdByUserId: new Types.ObjectId(OWNER_ID),
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  apps.push(app);
  return app;
}

function seedMember(userId: string, role: ApplicationRole, status = 'active'): FakeMember {
  const now = new Date();
  const member: FakeMember = {
    _id: new Types.ObjectId(),
    applicationId: new Types.ObjectId(APP_ID),
    userId: new Types.ObjectId(userId),
    role,
    permissions: permissionsForRole(role),
    status,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
  };
  member.save = jest.fn().mockResolvedValue(member);
  members.push(member);
  return member;
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
  resetStore();
  actAs(OWNER_ID, false);
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = {
        _id: { toString: () => currentUserId },
        isStaff: currentIsStaff,
      };
      next();
    }
  );
});

// ---------------------------------------------------------------------------
// Create + lookup by _id
// ---------------------------------------------------------------------------

describe('POST /applications — create', () => {
  it('creates the application and an owner membership for the creator', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'My App',
      redirectUris: ['https://app.example.com/callback'],
    });

    expect(res.status).toBe(201);
    expect(res.body.application?.name).toBe('My App');
    expect(res.body.application?.type).toBe('third_party');
    expect(res.body.application?.redirectUris).toEqual(['https://app.example.com/callback']);
    expect(ApplicationMemberMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner', status: 'active' })
    );
  });

  it('de-duplicates redirectUris on create, preserving order and exact strings', async () => {
    const res = await requestJson(server, 'POST', '/applications', {
      name: 'Dupes',
      redirectUris: [
        'https://a.example.com/cb',
        'https://b.example.com/cb',
        'https://a.example.com/cb',
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.application?.redirectUris).toEqual([
      'https://a.example.com/cb',
      'https://b.example.com/cb',
    ]);
  });

  it('defaults to an empty redirectUris list when not supplied', async () => {
    const res = await requestJson(server, 'POST', '/applications', { name: 'No Redirects' });
    expect(res.status).toBe(201);
    expect(res.body.application?.redirectUris).toEqual([]);
  });
});

describe('GET /applications/:appId — lookup by _id', () => {
  it('returns the application with the embedded callerMembership', async () => {
    seedApp();
    seedMember(OWNER_ID, 'owner');

    const res = await requestJson(server, 'GET', `/applications/${APP_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.application?._id).toBe(APP_ID);
    const callerMembership = res.body.application?.callerMembership as
      | { role?: string; permissions?: string[] }
      | undefined;
    expect(callerMembership?.role).toBe('owner');
    expect(callerMembership?.permissions).toEqual(permissionsForRole('owner'));
  });

  it('404 for a non-existent application id', async () => {
    const res = await requestJson(server, 'GET', `/applications/${new Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });

  it('403 when the caller is not a member', async () => {
    seedApp();
    seedMember(OWNER_ID, 'owner');
    actAs(OUTSIDER_ID);

    const res = await requestJson(server, 'GET', `/applications/${APP_ID}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /applications — list embeds callerMembership for low-permission roles', () => {
  it('a developer (no members:read) still receives its own permission set', async () => {
    seedApp();
    seedMember(DEVELOPER_ID, 'developer');
    actAs(DEVELOPER_ID);

    const res = await requestJson(server, 'GET', '/applications');

    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(1);
    const callerMembership = res.body.applications?.[0].callerMembership as
      | { role?: string; permissions?: string[] }
      | undefined;
    expect(callerMembership?.role).toBe('developer');
    expect(callerMembership?.permissions).toEqual(permissionsForRole('developer'));
  });
});

// ---------------------------------------------------------------------------
// Membership permission enforcement per role
// ---------------------------------------------------------------------------

describe('membership permission enforcement', () => {
  beforeEach(() => {
    seedApp();
    seedMember(OWNER_ID, 'owner');
    seedMember(ADMIN_ID, 'admin');
    seedMember(DEVELOPER_ID, 'developer');
    seedMember(VIEWER_ID, 'viewer');
    seedMember(BILLING_ID, 'billing');
  });

  it('owner can delete the application', async () => {
    actAs(OWNER_ID);
    const res = await requestJson(server, 'DELETE', `/applications/${APP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('admin cannot delete the application (no app:delete)', async () => {
    actAs(ADMIN_ID);
    const res = await requestJson(server, 'DELETE', `/applications/${APP_ID}`);
    expect(res.status).toBe(403);
  });

  it('admin can update the application (app:update)', async () => {
    actAs(ADMIN_ID);
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, { name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.application?.name).toBe('Renamed');
  });

  it('viewer cannot update the application (no app:update)', async () => {
    actAs(VIEWER_ID);
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, { name: 'Nope' });
    expect(res.status).toBe(403);
  });

  it('developer can read credentials (credentials:read)', async () => {
    actAs(DEVELOPER_ID);
    const res = await requestJson(server, 'GET', `/applications/${APP_ID}/credentials`);
    expect(res.status).toBe(200);
  });

  it('viewer cannot read credentials (no credentials:read)', async () => {
    actAs(VIEWER_ID);
    const res = await requestJson(server, 'GET', `/applications/${APP_ID}/credentials`);
    expect(res.status).toBe(403);
  });

  it('developer cannot invite members (no members:invite)', async () => {
    actAs(DEVELOPER_ID);
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/members`, {
      userId: OUTSIDER_ID,
      role: 'viewer',
    });
    expect(res.status).toBe(403);
  });

  it('billing can read but not modify the app', async () => {
    actAs(BILLING_ID);
    const readRes = await requestJson(server, 'GET', `/applications/${APP_ID}`);
    expect(readRes.status).toBe(200);
    const updateRes = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      name: 'No',
    });
    expect(updateRes.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH redirectUris + staff-only field gating
// ---------------------------------------------------------------------------

describe('PATCH /applications/:appId', () => {
  beforeEach(() => {
    seedApp({ redirectUris: ['https://old.example.com/cb'] });
    seedMember(OWNER_ID, 'owner');
  });

  it('updates and de-duplicates redirectUris, preserving order', async () => {
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      redirectUris: [
        'https://x.example.com/cb',
        'https://y.example.com/cb',
        'https://x.example.com/cb',
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.application?.redirectUris).toEqual([
      'https://x.example.com/cb',
      'https://y.example.com/cb',
    ]);
  });

  it('leaves redirectUris untouched when the field is omitted', async () => {
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, { name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.application?.redirectUris).toEqual(['https://old.example.com/cb']);
  });

  it('silently ignores staff-only fields for a non-staff owner', async () => {
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      isInternal: true,
      isOfficial: true,
      type: 'system',
      capabilities: ['x'],
    });
    expect(res.status).toBe(200);
    expect(res.body.application?.isInternal).toBe(false);
    expect(res.body.application?.isOfficial).toBe(false);
    expect(res.body.application?.type).toBe('third_party');
    expect(res.body.application?.capabilities).toEqual([]);
  });

  it('applies staff-only fields for a staff caller', async () => {
    actAs(OWNER_ID, true);
    const res = await requestJson(server, 'PATCH', `/applications/${APP_ID}`, {
      isInternal: true,
      type: 'internal',
    });
    expect(res.status).toBe(200);
    expect(res.body.application?.isInternal).toBe(true);
    expect(res.body.application?.type).toBe('internal');
  });
});

// ---------------------------------------------------------------------------
// Credentials — secret once, never on read, revoke blocks
// ---------------------------------------------------------------------------

describe('credentials lifecycle', () => {
  beforeEach(() => {
    seedApp();
    seedMember(OWNER_ID, 'owner');
  });

  it('returns the secret exactly once on creation and never the hash', async () => {
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'Server key',
      type: 'confidential',
      environment: 'production',
    });

    expect(res.status).toBe(201);
    expect(typeof res.body.secret).toBe('string');
    expect((res.body.secret as string).length).toBeGreaterThan(0);
    expect(res.body.credential).not.toHaveProperty('secretHash');
    expect(res.body.credential).not.toHaveProperty('secret');
    // The stored hash must not equal the plaintext secret.
    const stored = credentials[0];
    expect(stored.secretHash).toBeDefined();
    expect(stored.secretHash).not.toBe(res.body.secret);
  });

  it('public credentials carry no secret', async () => {
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/credentials`, {
      name: 'SPA',
      type: 'public',
      environment: 'production',
    });
    expect(res.status).toBe(201);
    expect(res.body.secret).toBeNull();
    expect(credentials[0].secretHash).toBeUndefined();
  });

  it('GET credentials never exposes the secret hash', async () => {
    seedCredential({ name: 'Existing' });
    const res = await requestJson(server, 'GET', `/applications/${APP_ID}/credentials`);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(1);
    expect(res.body.credentials?.[0]).not.toHaveProperty('secretHash');
    expect(res.body.credentials?.[0].publicKey).toBeDefined();
  });

  it('rotate issues a NEW credential + new secret once, deprecates the old one with a future grace expiry', async () => {
    const cred = seedCredential({ secretHash: 'old-hash' });
    const res = await requestJson(
      server,
      'POST',
      `/applications/${APP_ID}/credentials/${cred._id.toString()}/rotate`
    );

    expect(res.status).toBe(200);
    // A NEW credential is returned (different _id + publicKey from the source).
    const returned = res.body.credential as {
      _id?: string;
      publicKey?: string;
      status?: string;
      rotatedFromCredentialId?: string;
    };
    expect(returned._id).not.toBe(cred._id.toString());
    expect(returned.publicKey).not.toBe(cred.publicKey);
    expect(returned.status).toBe('active');
    expect(returned.rotatedFromCredentialId).toBe(cred._id.toString());

    // New plaintext secret returned exactly once; never the hash.
    expect(typeof res.body.secret).toBe('string');
    expect((res.body.secret as string).length).toBeGreaterThan(0);
    expect(res.body.credential).not.toHaveProperty('secretHash');

    // rotatedFrom + graceExpiresAt are surfaced for the caller.
    expect(res.body.rotatedFrom).toBe(cred._id.toString());
    expect(typeof res.body.graceExpiresAt).toBe('string');

    // The previous credential is now deprecated with a future expiry; its
    // secret hash is UNCHANGED (it must keep authenticating during grace).
    const previous = credentials.find((c) => c._id.equals(cred._id));
    expect(previous?.status).toBe('deprecated');
    expect(previous?.secretHash).toBe('old-hash');
    expect(previous?.expiresAt).toBeInstanceOf(Date);
    expect((previous?.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());

    // The new credential carries a fresh hash distinct from the plaintext.
    const fresh = credentials.find((c) => c._id.toString() === returned._id);
    expect(fresh?.secretHash).toBeDefined();
    expect(fresh?.secretHash).not.toBe(res.body.secret);
    expect(fresh?.rotatedFromCredentialId?.toString()).toBe(cred._id.toString());
  });

  it('rotate inherits name/type/environment/scopes from the source credential', async () => {
    const cred = seedCredential({
      name: 'Inherit me',
      type: 'service',
      environment: 'staging',
      scopes: ['user:read', 'files:read'],
    });
    const res = await requestJson(
      server,
      'POST',
      `/applications/${APP_ID}/credentials/${cred._id.toString()}/rotate`
    );

    expect(res.status).toBe(200);
    const returned = res.body.credential as {
      name?: string;
      type?: string;
      environment?: string;
      scopes?: string[];
    };
    expect(returned.name).toBe('Inherit me');
    expect(returned.type).toBe('service');
    expect(returned.environment).toBe('staging');
    expect(returned.scopes).toEqual(['user:read', 'files:read']);
  });

  it('public credentials cannot be rotated', async () => {
    const cred = seedCredential({ type: 'public', secretHash: undefined });
    const res = await requestJson(
      server,
      'POST',
      `/applications/${APP_ID}/credentials/${cred._id.toString()}/rotate`
    );
    expect(res.status).toBe(400);
  });

  it('revoke sets status=revoked and a revoked credential cannot be rotated', async () => {
    const cred = seedCredential();
    const revokeRes = await requestJson(
      server,
      'DELETE',
      `/applications/${APP_ID}/credentials/${cred._id.toString()}`
    );
    expect(revokeRes.status).toBe(200);
    expect(cred.status).toBe('revoked');

    const rotateRes = await requestJson(
      server,
      'POST',
      `/applications/${APP_ID}/credentials/${cred._id.toString()}/rotate`
    );
    expect(rotateRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Ownership transfer + owner-management guards
// ---------------------------------------------------------------------------

describe('ownership + owner management guards', () => {
  beforeEach(() => {
    seedApp();
    seedMember(OWNER_ID, 'owner');
    seedMember(ADMIN_ID, 'admin');
  });

  it('owner can transfer ownership: target becomes owner, caller demoted to admin', async () => {
    actAs(OWNER_ID);
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/transfer-ownership`, {
      userId: ADMIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const newOwner = members.find((m) => matchesId(m.userId, ADMIN_ID));
    const formerOwner = members.find((m) => matchesId(m.userId, OWNER_ID));
    expect(newOwner?.role).toBe('owner');
    expect(formerOwner?.role).toBe('admin');
  });

  it('admin cannot transfer ownership (no ownership:transfer)', async () => {
    actAs(ADMIN_ID);
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/transfer-ownership`, {
      userId: ADMIN_ID,
    });
    expect(res.status).toBe(403);
  });

  it("cannot change an owner's role via the members endpoint", async () => {
    actAs(OWNER_ID);
    const ownerMember = members.find((m) => m.role === 'owner');
    const res = await requestJson(
      server,
      'PATCH',
      `/applications/${APP_ID}/members/${ownerMember?._id.toString()}`,
      { role: 'admin' }
    );
    expect(res.status).toBe(403);
  });

  it('cannot remove the last owner', async () => {
    actAs(OWNER_ID);
    const ownerMember = members.find((m) => m.role === 'owner');
    const res = await requestJson(
      server,
      'DELETE',
      `/applications/${APP_ID}/members/${ownerMember?._id.toString()}`
    );
    expect(res.status).toBe(400);
  });

  it('admin cannot remove an owner (only an owner may)', async () => {
    actAs(ADMIN_ID);
    const ownerMember = members.find((m) => m.role === 'owner');
    const res = await requestJson(
      server,
      'DELETE',
      `/applications/${APP_ID}/members/${ownerMember?._id.toString()}`
    );
    expect(res.status).toBe(403);
  });

  it('owner can remove a non-owner member', async () => {
    actAs(OWNER_ID);
    const adminMember = members.find((m) => m.role === 'admin');
    const res = await requestJson(
      server,
      'DELETE',
      `/applications/${APP_ID}/members/${adminMember?._id.toString()}`
    );
    expect(res.status).toBe(200);
    expect(adminMember?.status).toBe('removed');
  });
});

// ---------------------------------------------------------------------------
// Members — add + role derivation
// ---------------------------------------------------------------------------

describe('POST /applications/:appId/members', () => {
  beforeEach(() => {
    seedApp();
    seedMember(OWNER_ID, 'owner');
  });

  it('adds an active member with permissions derived from role', async () => {
    actAs(OWNER_ID);
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/members`, {
      userId: DEVELOPER_ID,
      role: 'developer',
    });
    expect(res.status).toBe(201);
    expect(res.body.member?.role).toBe('developer');
    expect(res.body.member?.permissions).toEqual(permissionsForRole('developer'));
    expect(res.body.member?.status).toBe('active');
  });

  it('rejects adding a user who is already an active member', async () => {
    seedMember(DEVELOPER_ID, 'developer');
    actAs(OWNER_ID);
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/members`, {
      userId: DEVELOPER_ID,
      role: 'viewer',
    });
    expect(res.status).toBe(400);
  });

  it('rejects role=owner on the invite path (owner only via transfer)', async () => {
    actAs(OWNER_ID);
    const res = await requestJson(server, 'POST', `/applications/${APP_ID}/members`, {
      userId: DEVELOPER_ID,
      role: 'owner',
    });
    expect(res.status).toBe(400);
  });
});

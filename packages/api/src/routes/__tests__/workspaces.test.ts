/**
 * /workspaces routes — workspace (organization/tenant) CRUD + membership RBAC.
 *
 * Covers:
 *  - create team workspace (creator → owner), list (auto-provision personal),
 *    detail (+callerMembership), update;
 *  - delete guards: owner-only, personal-undeletable, 409 when apps remain;
 *  - members CRUD: invite/update/remove, last-owner guard, owner-removal guard,
 *    transfer-ownership (re-points workspace.ownerId).
 *
 * The Workspace / WorkspaceMember / Application models are mocked with small
 * in-memory fakes so the route logic (RBAC resolution, permission checks,
 * serialisation, provisioning) is exercised end-to-end over real HTTP without a
 * database.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Types } from 'mongoose';
import { permissionsForRole, type WorkspaceRole } from '../../utils/workspaceRoles';

// Restore the genuine mongoose module (the global jest.setup.cjs stubs it).
jest.mock('mongoose', () => jest.requireActual('mongoose'));

const mockAuthMiddleware = jest.fn();

interface FakeWorkspace {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  type: 'personal' | 'team';
  description?: string;
  icon?: string;
  ownerId: Types.ObjectId;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
  isNew?: boolean;
}

interface FakeMember {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  permissions: string[];
  invitedByUserId?: Types.ObjectId;
  joinedAt?: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
}

const workspaces: FakeWorkspace[] = [];
const members: FakeMember[] = [];
/** Application count keyed by workspaceId — drives the delete-with-apps 409. */
const appCountByWorkspace = new Map<string, number>();

function resetStore(): void {
  workspaces.length = 0;
  members.length = 0;
  appCountByWorkspace.clear();
  userDirectory.length = 0;
}

/** Test object-id strings (24 hex chars). */
const WORKSPACE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ADMIN_ID = 'cccccccccccccccccccccccc';
const MEMBER_ID = 'dddddddddddddddddddddddd';
const VIEWER_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';
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

// --- Workspace model fake ---------------------------------------------------

const WorkspaceMock = {
  findOne: jest.fn((query: Record<string, unknown>) => {
    const found =
      workspaces.find(
        (w) =>
          (query._id === undefined || matchesId(w._id, query._id)) &&
          (query.slug === undefined || w.slug === query.slug) &&
          (query.ownerId === undefined || matchesId(w.ownerId, query.ownerId)) &&
          (query.type === undefined || w.type === query.type) &&
          applyStatusFilter(w, query.status)
      ) ?? null;
    // Support `.select('_id').lean()` used by slug generation.
    const thenable = {
      then: (resolve: (value: FakeWorkspace | null) => unknown) => resolve(found),
      select: () => ({ lean: () => Promise.resolve(found) }),
    };
    return thenable;
  }),
  find: jest.fn((query: Record<string, unknown>) => {
    const idIn = (query._id as { $in?: unknown[] } | undefined)?.$in;
    const result = workspaces.filter(
      (w) =>
        (idIn === undefined || idIn.some((id) => matchesId(w._id, id))) &&
        applyStatusFilter(w, query.status)
    );
    return { sort: () => Promise.resolve(result) };
  }),
  create: jest.fn((doc: Record<string, unknown>) => {
    const now = new Date();
    const workspace: FakeWorkspace = {
      _id: new Types.ObjectId(),
      name: doc.name as string,
      slug: doc.slug as string,
      type: (doc.type as 'personal' | 'team') ?? 'team',
      description: doc.description as string | undefined,
      icon: doc.icon as string | undefined,
      ownerId: doc.ownerId as Types.ObjectId,
      status: (doc.status as string) ?? 'active',
      createdAt: now,
      updatedAt: now,
      isNew: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    workspaces.push(workspace);
    return Promise.resolve(workspace);
  }),
};

// --- WorkspaceMember model fake --------------------------------------------

const WorkspaceMemberMock = {
  findOne: jest.fn((query: Record<string, unknown>) =>
    Promise.resolve(
      members.find(
        (m) =>
          (query._id === undefined || matchesId(m._id, query._id)) &&
          (query.workspaceId === undefined || matchesId(m.workspaceId, query.workspaceId)) &&
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
        (query.workspaceId === undefined || matchesId(m.workspaceId, query.workspaceId)) &&
        applyStatusFilter(m, query.status)
    );
    return {
      sort: () => Promise.resolve(result),
      then: (resolve: (value: FakeMember[]) => unknown) => resolve(result),
    };
  }),
  countDocuments: jest.fn((query: Record<string, unknown>) =>
    Promise.resolve(
      members.filter(
        (m) =>
          (query.workspaceId === undefined || matchesId(m.workspaceId, query.workspaceId)) &&
          (query.role === undefined || m.role === query.role) &&
          applyStatusFilter(m, query.status)
      ).length
    )
  ),
  create: jest.fn((doc: Record<string, unknown>) => {
    const now = new Date();
    const member: FakeMember = {
      _id: new Types.ObjectId(),
      workspaceId: doc.workspaceId as Types.ObjectId,
      userId: doc.userId as Types.ObjectId,
      role: doc.role as WorkspaceRole,
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

// --- Application model fake (only countDocuments is used by /workspaces) ----

const ApplicationMock = {
  countDocuments: jest.fn((query: Record<string, unknown>) => {
    const wsId = query.workspaceId;
    if (wsId === undefined) return Promise.resolve(0);
    return Promise.resolve(appCountByWorkspace.get(String(wsId)) ?? 0);
  }),
};

jest.mock('../../models/Workspace', () => ({
  __esModule: true,
  Workspace: WorkspaceMock,
  default: WorkspaceMock,
  WORKSPACE_TYPES: ['personal', 'team'],
  WORKSPACE_STATUSES: ['active', 'deleted'],
  WORKSPACE_ROLES: ['owner', 'admin', 'member', 'viewer'],
}));

jest.mock('../../models/WorkspaceMember', () => ({
  __esModule: true,
  WorkspaceMember: WorkspaceMemberMock,
  default: WorkspaceMemberMock,
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: ApplicationMock,
  default: ApplicationMock,
}));

// --- resolveUserByIdentifier fake ------------------------------------------
// The invite path resolves a username/email to a User. Mock the resolver with a
// small in-memory directory keyed by username (case-insensitive) and email
// (lowercase). Tests register users via `seedUser`.

interface FakeUser {
  _id: Types.ObjectId;
  username?: string;
  email?: string;
}

const userDirectory: FakeUser[] = [];

const resolveUserByIdentifierMock = jest.fn((identifier: string) => {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) return Promise.resolve(null);
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return Promise.resolve(userDirectory.find((u) => u.email === email) ?? null);
  }
  const username = trimmed.toLowerCase();
  return Promise.resolve(
    userDirectory.find((u) => u.username?.toLowerCase() === username) ?? null
  );
});

jest.mock('../../utils/resolveUserIdentifier', () => ({
  __esModule: true,
  resolveUserByIdentifier: (identifier: string) => resolveUserByIdentifierMock(identifier),
}));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import workspacesRouter from '../workspaces';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown> & {
    workspace?: Record<string, unknown>;
    workspaces?: Array<Record<string, unknown>>;
    member?: Record<string, unknown>;
    members?: Array<Record<string, unknown>>;
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

function actAs(userId: string): void {
  currentUserId = userId;
}

function seedWorkspace(overrides: Partial<FakeWorkspace> = {}): FakeWorkspace {
  const now = new Date();
  const workspace: FakeWorkspace = {
    _id: new Types.ObjectId(WORKSPACE_ID),
    name: 'Seed Workspace',
    slug: 'seed-workspace',
    type: 'team',
    ownerId: new Types.ObjectId(OWNER_ID),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  workspaces.push(workspace);
  return workspace;
}

function seedUser(userId: string, fields: { username?: string; email?: string }): FakeUser {
  const user: FakeUser = {
    _id: new Types.ObjectId(userId),
    username: fields.username,
    email: fields.email,
  };
  userDirectory.push(user);
  return user;
}

function seedMember(userId: string, role: WorkspaceRole, status = 'active'): FakeMember {
  const now = new Date();
  const member: FakeMember = {
    _id: new Types.ObjectId(),
    workspaceId: new Types.ObjectId(WORKSPACE_ID),
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

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/workspaces', workspacesRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  actAs(OWNER_ID);
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: { toString: () => currentUserId } };
      next();
    }
  );
});

// ---------------------------------------------------------------------------
// Create + list + detail
// ---------------------------------------------------------------------------

describe('POST /workspaces — create', () => {
  it('creates a team workspace with an owner membership and a generated slug', async () => {
    const res = await requestJson(server, 'POST', '/workspaces', { name: 'My Team' });

    expect(res.status).toBe(201);
    expect(res.body.workspace?.name).toBe('My Team');
    expect(res.body.workspace?.type).toBe('team');
    expect(res.body.workspace?.slug).toBe('my-team');
    const callerMembership = res.body.workspace?.callerMembership as
      | { role?: string; permissions?: string[] }
      | undefined;
    expect(callerMembership?.role).toBe('owner');
    expect(callerMembership?.permissions).toEqual(permissionsForRole('owner'));
    expect(WorkspaceMemberMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner', status: 'active' })
    );
  });

  it('appends a suffix when the base slug is already taken', async () => {
    seedWorkspace({ slug: 'my-team' });
    const res = await requestJson(server, 'POST', '/workspaces', { name: 'My Team' });
    expect(res.status).toBe(201);
    expect(res.body.workspace?.slug).not.toBe('my-team');
    expect(String(res.body.workspace?.slug).startsWith('my-team-')).toBe(true);
  });
});

describe('GET /workspaces — list', () => {
  it('returns the workspaces the caller is an active member of (incl. the always-present personal one)', async () => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');

    const res = await requestJson(server, 'GET', '/workspaces');

    expect(res.status).toBe(200);
    // The seeded team workspace plus the unconditionally-provisioned personal one.
    expect(res.body.workspaces).toHaveLength(2);
    const team = (res.body.workspaces ?? []).find((w) => w._id === WORKSPACE_ID);
    expect(team).toBeDefined();
    const callerMembership = team?.callerMembership as { role?: string } | undefined;
    expect(callerMembership?.role).toBe('owner');
    expect((res.body.workspaces ?? []).some((w) => w.type === 'personal')).toBe(true);
  });

  it('auto-provisions a personal workspace when the caller has none', async () => {
    actAs(MEMBER_ID);
    const res = await requestJson(server, 'GET', '/workspaces');

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces?.[0].type).toBe('personal');
    expect(WorkspaceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'personal' })
    );
  });

  it('always provisions a personal workspace even when the caller is only in a team workspace', async () => {
    // Caller belongs to a team workspace but has NO personal workspace yet.
    seedWorkspace();
    seedMember(MEMBER_ID, 'member');
    actAs(MEMBER_ID);

    const res = await requestJson(server, 'GET', '/workspaces');

    expect(res.status).toBe(200);
    // Personal workspace is provisioned unconditionally and appears in the list
    // alongside the team workspace.
    expect(WorkspaceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'personal' })
    );
    const types = (res.body.workspaces ?? []).map((w) => w.type);
    expect(types).toContain('personal');
    expect(types).toContain('team');
    expect(res.body.workspaces).toHaveLength(2);
  });

  it('does not create a duplicate personal workspace when one already exists', async () => {
    // Caller already owns an active personal workspace (at WORKSPACE_ID, which
    // `seedMember` also points its membership at).
    seedWorkspace({
      type: 'personal',
      ownerId: new Types.ObjectId(MEMBER_ID),
      slug: 'personal-member',
    });
    seedMember(MEMBER_ID, 'owner');
    actAs(MEMBER_ID);

    const res = await requestJson(server, 'GET', '/workspaces');

    expect(res.status).toBe(200);
    // Idempotent: the existing personal workspace is reused, none created.
    expect(WorkspaceMock.create).not.toHaveBeenCalled();
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces?.[0].type).toBe('personal');
  });
});

describe('GET /workspaces/:id — detail', () => {
  it('returns the workspace with the embedded callerMembership', async () => {
    seedWorkspace();
    seedMember(VIEWER_ID, 'viewer');
    actAs(VIEWER_ID);

    const res = await requestJson(server, 'GET', `/workspaces/${WORKSPACE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.workspace?._id).toBe(WORKSPACE_ID);
    const callerMembership = res.body.workspace?.callerMembership as { role?: string } | undefined;
    expect(callerMembership?.role).toBe('viewer');
  });

  it('404 for a non-existent workspace id', async () => {
    const res = await requestJson(server, 'GET', `/workspaces/${new Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
  });

  it('403 when the caller is not a member', async () => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');
    actAs(OUTSIDER_ID);

    const res = await requestJson(server, 'GET', `/workspaces/${WORKSPACE_ID}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe('PATCH /workspaces/:id', () => {
  beforeEach(() => {
    seedWorkspace({ description: 'old' });
  });

  it('admin can update name/description (workspace:update)', async () => {
    seedMember(ADMIN_ID, 'admin');
    actAs(ADMIN_ID);

    const res = await requestJson(server, 'PATCH', `/workspaces/${WORKSPACE_ID}`, {
      name: 'Renamed',
      description: 'new',
    });
    expect(res.status).toBe(200);
    expect(res.body.workspace?.name).toBe('Renamed');
    expect(res.body.workspace?.description).toBe('new');
  });

  it('member cannot update (no workspace:update)', async () => {
    seedMember(MEMBER_ID, 'member');
    actAs(MEMBER_ID);

    const res = await requestJson(server, 'PATCH', `/workspaces/${WORKSPACE_ID}`, { name: 'No' });
    expect(res.status).toBe(403);
  });

  it('clears description when null is sent', async () => {
    seedMember(OWNER_ID, 'owner');
    const res = await requestJson(server, 'PATCH', `/workspaces/${WORKSPACE_ID}`, {
      description: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.workspace?.description).toBeUndefined();
  });
});

describe('PATCH /workspaces/:id — personal workspace guards', () => {
  beforeEach(() => {
    // A personal workspace owned by the caller.
    seedWorkspace({ type: 'personal', name: 'Personal' });
    seedMember(OWNER_ID, 'owner');
  });

  it('rejects renaming the personal workspace (400)', async () => {
    const res = await requestJson(server, 'PATCH', `/workspaces/${WORKSPACE_ID}`, {
      name: 'My Stuff',
    });
    expect(res.status).toBe(400);
  });

  it('allows a no-op name equal to the current name', async () => {
    const res = await requestJson(server, 'PATCH', `/workspaces/${WORKSPACE_ID}`, {
      name: 'Personal',
    });
    expect(res.status).toBe(200);
    expect(res.body.workspace?.name).toBe('Personal');
  });

  it('allows description/icon updates on the personal workspace', async () => {
    const res = await requestJson(server, 'PATCH', `/workspaces/${WORKSPACE_ID}`, {
      description: 'just me',
      icon: 'avatar-file-id',
    });
    expect(res.status).toBe(200);
    expect(res.body.workspace?.description).toBe('just me');
    expect(res.body.workspace?.icon).toBe('avatar-file-id');
  });
});

// ---------------------------------------------------------------------------
// Delete guards
// ---------------------------------------------------------------------------

describe('DELETE /workspaces/:id', () => {
  it('owner can delete an empty team workspace', async () => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');

    const res = await requestJson(server, 'DELETE', `/workspaces/${WORKSPACE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('admin cannot delete (no workspace:delete)', async () => {
    seedWorkspace();
    seedMember(ADMIN_ID, 'admin');
    actAs(ADMIN_ID);

    const res = await requestJson(server, 'DELETE', `/workspaces/${WORKSPACE_ID}`);
    expect(res.status).toBe(403);
  });

  it('rejects deleting a personal workspace', async () => {
    seedWorkspace({ type: 'personal' });
    seedMember(OWNER_ID, 'owner');

    const res = await requestJson(server, 'DELETE', `/workspaces/${WORKSPACE_ID}`);
    expect(res.status).toBe(400);
  });

  it('409 when the workspace still owns applications', async () => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');
    appCountByWorkspace.set(WORKSPACE_ID, 3);

    const res = await requestJson(server, 'DELETE', `/workspaces/${WORKSPACE_ID}`);
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Members CRUD
// ---------------------------------------------------------------------------

describe('members', () => {
  beforeEach(() => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');
  });

  it('lists members (members:read)', async () => {
    seedMember(MEMBER_ID, 'member');
    const res = await requestJson(server, 'GET', `/workspaces/${WORKSPACE_ID}/members`);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(2);
  });

  it('owner can invite a member by username with permissions derived from role', async () => {
    seedUser(MEMBER_ID, { username: 'Member' });
    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/members`, {
      usernameOrEmail: 'member',
      role: 'member',
    });
    expect(res.status).toBe(201);
    expect(res.body.member?.role).toBe('member');
    expect(res.body.member?.userId).toBe(MEMBER_ID);
    expect(res.body.member?.permissions).toEqual(permissionsForRole('member'));
  });

  it('owner can invite a member by email (case-insensitive)', async () => {
    seedUser(MEMBER_ID, { email: 'member@example.com' });
    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/members`, {
      usernameOrEmail: 'Member@Example.com',
      role: 'admin',
    });
    expect(res.status).toBe(201);
    expect(res.body.member?.role).toBe('admin');
    expect(res.body.member?.userId).toBe(MEMBER_ID);
  });

  it('404 when the username/email does not resolve to a user', async () => {
    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/members`, {
      usernameOrEmail: 'ghost@example.com',
      role: 'member',
    });
    expect(res.status).toBe(404);
  });

  it('rejects inviting an already-active member', async () => {
    seedUser(MEMBER_ID, { username: 'member' });
    seedMember(MEMBER_ID, 'member');
    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/members`, {
      usernameOrEmail: 'member',
      role: 'viewer',
    });
    expect(res.status).toBe(400);
  });

  it('rejects role=owner on the invite path (owner only via transfer)', async () => {
    seedUser(MEMBER_ID, { username: 'member' });
    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/members`, {
      usernameOrEmail: 'member',
      role: 'owner',
    });
    expect(res.status).toBe(400);
  });

  it('viewer cannot invite (no members:invite)', async () => {
    seedUser(MEMBER_ID, { username: 'member' });
    seedMember(VIEWER_ID, 'viewer');
    actAs(VIEWER_ID);
    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/members`, {
      usernameOrEmail: 'member',
      role: 'member',
    });
    expect(res.status).toBe(403);
  });

  it('owner can change a member role (members:update)', async () => {
    const member = seedMember(MEMBER_ID, 'member');
    const res = await requestJson(
      server,
      'PATCH',
      `/workspaces/${WORKSPACE_ID}/members/${member._id.toString()}`,
      { role: 'admin' }
    );
    expect(res.status).toBe(200);
    expect(res.body.member?.role).toBe('admin');
    expect(member.role).toBe('admin');
  });

  it("cannot change an owner's role via the members endpoint", async () => {
    const ownerMember = members.find((m) => m.role === 'owner');
    const res = await requestJson(
      server,
      'PATCH',
      `/workspaces/${WORKSPACE_ID}/members/${ownerMember?._id.toString()}`,
      { role: 'admin' }
    );
    expect(res.status).toBe(403);
  });

  it('cannot remove the last owner', async () => {
    const ownerMember = members.find((m) => m.role === 'owner');
    const res = await requestJson(
      server,
      'DELETE',
      `/workspaces/${WORKSPACE_ID}/members/${ownerMember?._id.toString()}`
    );
    expect(res.status).toBe(400);
  });

  it('owner can remove a non-owner member', async () => {
    const member = seedMember(MEMBER_ID, 'member');
    const res = await requestJson(
      server,
      'DELETE',
      `/workspaces/${WORKSPACE_ID}/members/${member._id.toString()}`
    );
    expect(res.status).toBe(200);
    expect(member.status).toBe('removed');
  });

  it('admin cannot remove an owner (only an owner may)', async () => {
    seedMember(ADMIN_ID, 'admin');
    actAs(ADMIN_ID);
    const ownerMember = members.find((m) => m.role === 'owner');
    const res = await requestJson(
      server,
      'DELETE',
      `/workspaces/${WORKSPACE_ID}/members/${ownerMember?._id.toString()}`
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Transfer ownership
// ---------------------------------------------------------------------------

describe('POST /workspaces/:id/transfer-ownership', () => {
  it('owner transfers ownership: target → owner, caller → admin, workspace.ownerId repointed', async () => {
    const workspace = seedWorkspace();
    seedMember(OWNER_ID, 'owner');
    seedMember(ADMIN_ID, 'admin');

    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/transfer-ownership`, {
      userId: ADMIN_ID,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const newOwner = members.find((m) => matchesId(m.userId, ADMIN_ID));
    const formerOwner = members.find((m) => matchesId(m.userId, OWNER_ID));
    expect(newOwner?.role).toBe('owner');
    expect(formerOwner?.role).toBe('admin');
    expect(matchesId(workspace.ownerId, ADMIN_ID)).toBe(true);
  });

  it('admin cannot transfer ownership (no ownership:transfer)', async () => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');
    seedMember(ADMIN_ID, 'admin');
    actAs(ADMIN_ID);

    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/transfer-ownership`, {
      userId: ADMIN_ID,
    });
    expect(res.status).toBe(403);
  });

  it('404 when the target is not an active member', async () => {
    seedWorkspace();
    seedMember(OWNER_ID, 'owner');

    const res = await requestJson(server, 'POST', `/workspaces/${WORKSPACE_ID}/transfer-ownership`, {
      userId: OUTSIDER_ID,
    });
    expect(res.status).toBe(404);
  });
});

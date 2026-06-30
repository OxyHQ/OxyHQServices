/**
 * account.service tests — unified Account graph.
 *
 * Pure tree/inheritance helpers are tested directly. The DB-bound service is
 * exercised against a tiny in-memory store (one per collection) supporting the
 * Mongoose subset the service uses, including ARRAY-FIELD matching for the
 * materialised `ancestors` path (`{ancestors: id}`, `{ancestors: {$in}}`) and
 * top-level `$or`. `mongoose.startSession` is stubbed so the transactional
 * `moveAccount` path runs inline.
 */

import { Types } from 'mongoose';

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

function makeStore() {
  return { docs: [] as AnyDoc[] };
}

const userStore = makeStore();
const memberStore = makeStore();
const credentialStore = makeStore();

function clearStores(): void {
  userStore.docs = [];
  memberStore.docs = [];
  credentialStore.docs = [];
}

const idEq = (a: unknown, b: unknown): boolean => String(a) === String(b);

/** Match a single field value against a query expectation (handles arrays). */
function matchField(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Types.ObjectId) {
    return Array.isArray(actual)
      ? actual.some((a) => idEq(a, expected))
      : idEq(actual, expected);
  }
  if (expected !== null && typeof expected === 'object') {
    const op = expected as Record<string, unknown>;
    if ('$in' in op) {
      const list = op.$in as unknown[];
      return Array.isArray(actual)
        ? actual.some((a) => list.some((v) => idEq(a, v)))
        : list.some((v) => idEq(v, actual));
    }
    if ('$ne' in op) {
      return Array.isArray(actual)
        ? !actual.some((a) => idEq(a, op.$ne))
        : !idEq(actual, op.$ne);
    }
    if ('$exists' in op) {
      return (actual !== undefined) === op.$exists;
    }
    return false;
  }
  if (Array.isArray(actual)) {
    return actual.some((a) => idEq(a, expected));
  }
  return idEq(actual, expected);
}

function matchesQuery(doc: AnyDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as Record<string, unknown>[]).some((sub) => matchesQuery(doc, sub));
    }
    return matchField(doc[key], expected);
  });
}

function makeQuery(results: AnyDoc[]) {
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    session: () => chain,
    select: () => chain,
    populate: () => chain,
    lean: async (): Promise<AnyDoc | null> => results[0] ?? null,
    then: (
      onFulfilled: (value: AnyDoc[]) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(results).then(onFulfilled, onRejected),
  };
  return chain;
}

function makeDocQuery(doc: AnyDoc | null) {
  const chain = {
    select: () => chain,
    lean: async (): Promise<AnyDoc | null> => doc,
    then: (
      onFulfilled: (value: AnyDoc | null) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(doc).then(onFulfilled, onRejected),
  };
  return chain;
}

function attachSave(doc: AnyDoc, store: ReturnType<typeof makeStore>): AnyDoc {
  if (typeof doc.save === 'function') {
    return doc;
  }
  Object.defineProperty(doc, 'save', {
    enumerable: false,
    configurable: true,
    value: async () => {
      const idx = store.docs.findIndex((d) => d._id.equals(doc._id));
      if (idx === -1) store.docs.push(doc);
      else store.docs[idx] = doc;
      return doc;
    },
  });
  return doc;
}

function makeModel(store: ReturnType<typeof makeStore>) {
  return {
    async create(payload: Record<string, unknown> | Record<string, unknown>[]) {
      const arr = Array.isArray(payload) ? payload : [payload];
      const created = arr.map((data) => {
        const doc = attachSave(
          {
            _id: (data._id as Types.ObjectId) ?? new Types.ObjectId(),
            createdAt: (data.createdAt as Date) ?? new Date(),
            updatedAt: new Date(),
            ...data,
          },
          store
        );
        store.docs.push(doc);
        return doc;
      });
      return Array.isArray(payload) ? created : created[0];
    },
    async findOne(query: Record<string, unknown> = {}) {
      const found = store.docs.find((d) => matchesQuery(d, query));
      return found ? attachSave(found, store) : null;
    },
    findById(id: string | Types.ObjectId) {
      const target = id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
      const found = store.docs.find((d) => d._id.equals(target));
      return makeDocQuery(found ? attachSave(found, store) : null);
    },
    find(query: Record<string, unknown> = {}) {
      const results = store.docs
        .filter((d) => matchesQuery(d, query))
        .map((d) => attachSave(d, store));
      return makeQuery(results);
    },
    async countDocuments(query: Record<string, unknown> = {}) {
      return store.docs.filter((d) => matchesQuery(d, query)).length;
    },
    // Minimal aggregate supporting the `$match` + group-by-parentAccountId count
    // pipeline used by annotateAccounts (childCount of accounts not in the set).
    async aggregate(pipeline: Array<Record<string, unknown>>) {
      const matchStage = pipeline.find((s) => '$match' in s)?.$match as
        | Record<string, unknown>
        | undefined;
      const matched = store.docs.filter((d) => matchesQuery(d, matchStage ?? {}));
      const groupStage = pipeline.find((s) => '$group' in s)?.$group as
        | Record<string, unknown>
        | undefined;
      if (groupStage?._id === '$parentAccountId') {
        const counts = new Map<string, number>();
        for (const d of matched) {
          const key = d.parentAccountId ? String(d.parentAccountId) : null;
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].map(([k, n]) => ({ _id: new Types.ObjectId(k), n }));
      }
      return [];
    },
  };
}

// Preserve the real non-model exports (MAX_ACCOUNT_DEPTH, ACCOUNT_KINDS, …)
// while replacing the Mongoose model with the in-memory fake.
jest.mock('../../models/User', () => ({
  __esModule: true,
  ...jest.requireActual('../../models/User'),
  User: makeModel(userStore),
  default: makeModel(userStore),
}));
jest.mock('../../models/AccountMember', () => ({
  __esModule: true,
  AccountMember: makeModel(memberStore),
  default: makeModel(memberStore),
}));
jest.mock('../../models/AccountCredential', () => ({
  __esModule: true,
  AccountCredential: makeModel(credentialStore),
  default: makeModel(credentialStore),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const startSession = jest.fn(async () => ({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  }));
  const patched = { ...actual, startSession };
  return { __esModule: true, ...patched, default: patched };
});

import accountService, {
  childAncestorsOf,
  childRootOf,
  wouldCreateCycle,
  rewriteDescendantAncestors,
  resolveEffectiveMembership,
  type MembershipLike,
} from '../account.service';
import { permissionsForAccountRole, type AccountRole } from '../../utils/accountRoles';

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

function seedAccount(fields: Partial<AnyDoc> & { kind?: string }): AnyDoc {
  const _id = (fields._id as Types.ObjectId) ?? new Types.ObjectId();
  const doc: AnyDoc = {
    _id,
    username: `acct_${_id.toString().slice(-6)}`,
    kind: fields.kind ?? 'personal',
    parentAccountId: fields.parentAccountId ?? null,
    ancestors: fields.ancestors ?? [],
    rootAccountId: fields.rootAccountId ?? _id,
    accountStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  };
  userStore.docs.push(doc);
  return doc;
}

function seedMember(
  accountId: Types.ObjectId,
  memberUserId: Types.ObjectId,
  role: AccountRole,
  opts: { inherit?: boolean; status?: string } = {}
): AnyDoc {
  const doc: AnyDoc = {
    _id: new Types.ObjectId(),
    accountId,
    memberUserId,
    role,
    permissions: permissionsForAccountRole(role),
    inherit: opts.inherit ?? true,
    status: opts.status ?? 'active',
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memberStore.docs.push(doc);
  return doc;
}

beforeEach(() => {
  clearStores();
});

// ===========================================================================
// Pure helpers
// ===========================================================================

describe('account tree pure helpers', () => {
  test('childAncestorsOf appends parent to its ancestors (root → parent order)', () => {
    const root = new Types.ObjectId();
    const parent = { _id: new Types.ObjectId(), ancestors: [root] } as never;
    expect(childAncestorsOf(parent).map(String)).toEqual([
      root.toString(),
      (parent as { _id: Types.ObjectId })._id.toString(),
    ]);
  });

  test('childRootOf inherits the parent root, or the parent itself for a root', () => {
    const parentRootId = new Types.ObjectId();
    const child = { _id: new Types.ObjectId(), rootAccountId: parentRootId } as never;
    expect(String(childRootOf(child))).toBe(parentRootId.toString());

    const rootParent = { _id: new Types.ObjectId(), rootAccountId: undefined } as never;
    expect(String(childRootOf(rootParent))).toBe(
      (rootParent as { _id: Types.ObjectId })._id.toString()
    );
  });

  test('wouldCreateCycle detects self-parenting and descendant-parenting', () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    // self
    expect(wouldCreateCycle(a, { _id: a, ancestors: [] } as never)).toBe(true);
    // b is a descendant of a (a ∈ b.ancestors) → moving a under b is a cycle
    expect(wouldCreateCycle(a, { _id: b, ancestors: [a] } as never)).toBe(true);
    // unrelated
    expect(wouldCreateCycle(a, { _id: b, ancestors: [] } as never)).toBe(false);
  });

  test('rewriteDescendantAncestors swaps the moved-node prefix, keeps the suffix', () => {
    const root = new Types.ObjectId();
    const self = new Types.ObjectId();
    const child = new Types.ObjectId();
    const newRoot = new Types.ObjectId();
    // descendant currently: [root, self, child-of-self...] → ancestors of grandchild = [root, self, child]
    const grandchildAncestors = [root, self, child];
    const result = rewriteDescendantAncestors([root], [newRoot], grandchildAncestors);
    expect(result.map(String)).toEqual([
      newRoot.toString(),
      self.toString(),
      child.toString(),
    ]);
  });

  test('resolveEffectiveMembership: a direct row on the account always wins', () => {
    const account = new Types.ObjectId();
    const parent = new Types.ObjectId();
    const rows: MembershipLike[] = [
      { accountId: account, role: 'viewer', permissions: [], inherit: true, status: 'active' },
      { accountId: parent, role: 'owner', permissions: [], inherit: true, status: 'active' },
    ];
    const resolved = resolveEffectiveMembership(rows, account, [parent]);
    expect(resolved?.row.role).toBe('viewer');
    expect(resolved?.source).toBe('direct');
  });

  test('resolveEffectiveMembership: an inheriting ancestor row applies', () => {
    const account = new Types.ObjectId();
    const parent = new Types.ObjectId();
    const rows: MembershipLike[] = [
      { accountId: parent, role: 'admin', permissions: [], inherit: true, status: 'active' },
    ];
    const resolved = resolveEffectiveMembership(rows, account, [parent]);
    expect(resolved?.row.role).toBe('admin');
    expect(resolved?.source).toBe('inherited');
  });

  test('resolveEffectiveMembership: inherit:false ancestor row does NOT cascade', () => {
    const account = new Types.ObjectId();
    const parent = new Types.ObjectId();
    const rows: MembershipLike[] = [
      { accountId: parent, role: 'admin', permissions: [], inherit: false, status: 'active' },
    ];
    expect(resolveEffectiveMembership(rows, account, [parent])).toBeNull();
  });

  test('resolveEffectiveMembership: nearest ancestor wins over a farther one', () => {
    const account = new Types.ObjectId();
    const parent = new Types.ObjectId();
    const grandparent = new Types.ObjectId();
    const rows: MembershipLike[] = [
      { accountId: grandparent, role: 'owner', permissions: [], inherit: true, status: 'active' },
      { accountId: parent, role: 'editor', permissions: [], inherit: true, status: 'active' },
    ];
    // ancestors are root → parent, so [grandparent, parent]
    const resolved = resolveEffectiveMembership(rows, account, [grandparent, parent]);
    expect(resolved?.row.role).toBe('editor');
  });
});

// ===========================================================================
// createChildAccount
// ===========================================================================

describe('createChildAccount', () => {
  test('builds ancestors/root, mints the account, records creator as owner', async () => {
    const root = seedAccount({ kind: 'personal' });

    const { account, membership } = await accountService.createChildAccount(
      root._id.toString(),
      root._id.toString(),
      { kind: 'organization', username: 'oxy' }
    );

    expect(account.kind).toBe('organization');
    expect((account.ancestors as Types.ObjectId[]).map(String)).toEqual([root._id.toString()]);
    expect(String(account.rootAccountId)).toBe(root._id.toString());
    expect(String(account.parentAccountId)).toBe(root._id.toString());
    expect(account.authMethods).toEqual([]);

    expect(membership.role).toBe('owner');
    expect(String(membership.memberUserId)).toBe(root._id.toString());
    expect(String(membership.accountId)).toBe(account._id.toString());
  });

  test('rejects a personal child kind', async () => {
    const root = seedAccount({ kind: 'personal' });
    await expect(
      accountService.createChildAccount(root._id.toString(), root._id.toString(), {
        // deliberately invalid kind to exercise the guard
        kind: 'personal' as never,
        username: 'nope',
      })
    ).rejects.toThrow(/child account kind/i);
  });

  test('suffixes the username on collision', async () => {
    const root = seedAccount({ kind: 'personal' });
    seedAccount({ kind: 'organization', username: 'oxy' });

    const { account } = await accountService.createChildAccount(
      root._id.toString(),
      root._id.toString(),
      { kind: 'organization', username: 'oxy' }
    );
    expect(account.username).toBe('oxy1');
  });

  test('enforces MAX_ACCOUNT_DEPTH', async () => {
    // A parent already at the maximum depth (ancestors.length === 8).
    const deepAncestors = Array.from({ length: 8 }, () => new Types.ObjectId());
    const parent = seedAccount({ kind: 'project', ancestors: deepAncestors });

    await expect(
      accountService.createChildAccount(parent._id.toString(), parent._id.toString(), {
        kind: 'project',
        username: 'too-deep',
      })
    ).rejects.toThrow(/depth/i);
  });
});

// ===========================================================================
// moveAccount
// ===========================================================================

describe('moveAccount', () => {
  test('rewrites the whole subtree ancestors + root', async () => {
    const root = seedAccount({ kind: 'personal' });
    const a = seedAccount({
      kind: 'organization',
      parentAccountId: root._id,
      ancestors: [root._id],
      rootAccountId: root._id,
    });
    const b = seedAccount({
      kind: 'project',
      parentAccountId: a._id,
      ancestors: [root._id, a._id],
      rootAccountId: root._id,
    });
    const c = seedAccount({
      kind: 'project',
      parentAccountId: b._id,
      ancestors: [root._id, a._id, b._id],
      rootAccountId: root._id,
    });
    const dest = seedAccount({ kind: 'personal' });

    await accountService.moveAccount(a._id.toString(), dest._id.toString());

    expect((a.ancestors as Types.ObjectId[]).map(String)).toEqual([dest._id.toString()]);
    expect(String(a.rootAccountId)).toBe(dest._id.toString());
    expect((b.ancestors as Types.ObjectId[]).map(String)).toEqual([
      dest._id.toString(),
      a._id.toString(),
    ]);
    expect((c.ancestors as Types.ObjectId[]).map(String)).toEqual([
      dest._id.toString(),
      a._id.toString(),
      b._id.toString(),
    ]);
    expect(String(c.rootAccountId)).toBe(dest._id.toString());
  });

  test('rejects self-parenting', async () => {
    const a = seedAccount({ kind: 'organization' });
    await expect(accountService.moveAccount(a._id.toString(), a._id.toString())).rejects.toThrow(
      /own parent/i
    );
  });

  test('rejects moving an account beneath its own descendant (cycle)', async () => {
    const a = seedAccount({ kind: 'organization', ancestors: [] });
    const b = seedAccount({ kind: 'project', parentAccountId: a._id, ancestors: [a._id] });
    await expect(accountService.moveAccount(a._id.toString(), b._id.toString())).rejects.toThrow(
      /beneath itself/i
    );
  });

  test('rejects moving a personal account', async () => {
    const root = seedAccount({ kind: 'personal' });
    const dest = seedAccount({ kind: 'organization' });
    await expect(
      accountService.moveAccount(root._id.toString(), dest._id.toString())
    ).rejects.toThrow(/personal account is always a root/i);
  });

  test('enforces depth over the whole subtree', async () => {
    // self at depth 1 with a descendant 6 levels below (relative depth 6 → max abs 7).
    const root = seedAccount({ kind: 'personal' });
    const self = seedAccount({
      kind: 'organization',
      parentAccountId: root._id,
      ancestors: [root._id],
      rootAccountId: root._id,
    });
    // Descendant whose ancestors length is 7 (self at index 1, plus 5 intermediates).
    const intermediates = Array.from({ length: 5 }, () => new Types.ObjectId());
    seedAccount({
      kind: 'project',
      ancestors: [root._id, self._id, ...intermediates],
    });
    // A destination already at depth 3 (ancestors length 3) → new self depth 4,
    // + subtree relative 6 = 10 > 8.
    const dest = seedAccount({
      kind: 'organization',
      ancestors: [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()],
    });

    await expect(
      accountService.moveAccount(self._id.toString(), dest._id.toString())
    ).rejects.toThrow(/depth/i);
  });
});

// ===========================================================================
// Inheritance + verifyActingAs
// ===========================================================================

describe('membership inheritance + verifyActingAs', () => {
  function seedOrgTree() {
    const root = seedAccount({ kind: 'personal' });
    const org = seedAccount({
      kind: 'organization',
      parentAccountId: root._id,
      ancestors: [root._id],
      rootAccountId: root._id,
    });
    const project = seedAccount({
      kind: 'project',
      parentAccountId: org._id,
      ancestors: [root._id, org._id],
      rootAccountId: root._id,
    });
    return { root, org, project };
  }

  test('a member of the parent reaches the child via inheritance', async () => {
    const { org, project } = seedOrgTree();
    const bob = seedAccount({ kind: 'personal' });
    seedMember(org._id, bob._id, 'editor', { inherit: true });

    const access = await accountService.resolveEffectiveAccess(
      bob._id.toString(),
      project._id.toString()
    );
    expect(access?.role).toBe('editor');
    expect(access?.source).toBe('inherited');
  });

  test('a direct row on the child overrides the inherited ancestor row', async () => {
    const { org, project } = seedOrgTree();
    const bob = seedAccount({ kind: 'personal' });
    seedMember(org._id, bob._id, 'owner', { inherit: true });
    seedMember(project._id, bob._id, 'viewer', { inherit: true });

    const access = await accountService.resolveEffectiveAccess(
      bob._id.toString(),
      project._id.toString()
    );
    expect(access?.role).toBe('viewer');
    expect(access?.source).toBe('direct');
  });

  test('inherit:false on the ancestor row opts the child subtree out', async () => {
    const { org, project } = seedOrgTree();
    const bob = seedAccount({ kind: 'personal' });
    seedMember(org._id, bob._id, 'admin', { inherit: false });

    const access = await accountService.resolveEffectiveAccess(
      bob._id.toString(),
      project._id.toString()
    );
    expect(access).toBeNull();
  });

  test('verifyActingAs authorises act_as roles via an ancestor, denies others', async () => {
    const { org, project } = seedOrgTree();
    const editor = seedAccount({ kind: 'personal' });
    const billing = seedAccount({ kind: 'personal' });
    seedMember(org._id, editor._id, 'editor', { inherit: true });
    seedMember(org._id, billing._id, 'billing', { inherit: true });

    await expect(
      accountService.verifyActingAs(editor._id.toString(), project._id.toString())
    ).resolves.toBe('editor');
    await expect(
      accountService.verifyActingAs(billing._id.toString(), project._id.toString())
    ).resolves.toBeNull();
  });

  test('a user is the implicit owner of their own account (self)', async () => {
    const bob = seedAccount({ kind: 'personal' });
    await expect(
      accountService.verifyActingAs(bob._id.toString(), bob._id.toString())
    ).resolves.toBe('owner');
  });
});

// ===========================================================================
// listAccessibleAccounts
// ===========================================================================

describe('listAccessibleAccounts', () => {
  test('returns self + direct memberships + their subtree, annotated', async () => {
    const root = seedAccount({ kind: 'personal' });
    const org = seedAccount({
      kind: 'organization',
      parentAccountId: root._id,
      ancestors: [root._id],
      rootAccountId: root._id,
    });
    const project = seedAccount({
      kind: 'project',
      parentAccountId: org._id,
      ancestors: [root._id, org._id],
      rootAccountId: root._id,
    });
    const bob = seedAccount({ kind: 'personal' });
    seedMember(org._id, bob._id, 'editor', { inherit: true });

    const nodes = await accountService.listAccessibleAccounts(bob._id.toString());
    const byId = new Map(nodes.map((n) => [n.accountId, n]));

    // bob's own account, org, and the inherited project — NOT root.
    expect(byId.has(bob._id.toString())).toBe(true);
    expect(byId.has(org._id.toString())).toBe(true);
    expect(byId.has(project._id.toString())).toBe(true);
    expect(byId.has(root._id.toString())).toBe(false);

    expect(byId.get(bob._id.toString())?.relationship).toBe('self');
    expect(byId.get(org._id.toString())?.relationship).toBe('member');
    expect(byId.get(project._id.toString())?.relationship).toBe('member');
    expect(byId.get(org._id.toString())?.childCount).toBe(1);
  });

  test('an owner membership is reported as relationship owner', async () => {
    const owner = seedAccount({ kind: 'personal' });
    const org = seedAccount({
      kind: 'organization',
      parentAccountId: owner._id,
      ancestors: [owner._id],
      rootAccountId: owner._id,
    });
    seedMember(org._id, owner._id, 'owner', { inherit: true });

    const nodes = await accountService.listAccessibleAccounts(owner._id.toString());
    const orgNode = nodes.find((n) => n.accountId === org._id.toString());
    expect(orgNode?.relationship).toBe('owner');
    expect(orgNode?.callerMembership?.role).toBe('owner');
  });
});

// ===========================================================================
// Members CRUD + last-owner protection + transfer
// ===========================================================================

describe('members CRUD', () => {
  test('addMember creates then rejects a duplicate active member', async () => {
    const org = seedAccount({ kind: 'organization' });
    const owner = seedAccount({ kind: 'personal' });
    const charlie = seedAccount({ kind: 'personal' });

    const member = await accountService.addMember(
      org._id.toString(),
      owner._id.toString(),
      charlie._id.toString(),
      'developer'
    );
    expect(member.role).toBe('developer');
    expect(member.status).toBe('active');

    await expect(
      accountService.addMember(
        org._id.toString(),
        owner._id.toString(),
        charlie._id.toString(),
        'viewer'
      )
    ).rejects.toThrow(/already a member/i);
  });

  test('addMember re-activates a previously removed membership', async () => {
    const org = seedAccount({ kind: 'organization' });
    const owner = seedAccount({ kind: 'personal' });
    const charlie = seedAccount({ kind: 'personal' });
    seedMember(org._id, charlie._id, 'viewer', { status: 'removed' });

    const member = await accountService.addMember(
      org._id.toString(),
      owner._id.toString(),
      charlie._id.toString(),
      'developer'
    );
    expect(member.status).toBe('active');
    expect(member.role).toBe('developer');
    // No duplicate row was created.
    expect(memberStore.docs.filter((d) => idEq(d.memberUserId, charlie._id)).length).toBe(1);
  });

  test('updateMemberRole rejects changing an owner row', async () => {
    const org = seedAccount({ kind: 'organization' });
    const owner = seedAccount({ kind: 'personal' });
    const ownerMember = seedMember(org._id, owner._id, 'owner');

    await expect(
      accountService.updateMemberRole(org._id.toString(), ownerMember._id.toString(), 'admin')
    ).rejects.toThrow(/transfer-ownership/i);
  });

  test('removeMember refuses to remove the last owner', async () => {
    const org = seedAccount({ kind: 'organization' });
    const owner = seedAccount({ kind: 'personal' });
    const ownerMember = seedMember(org._id, owner._id, 'owner');

    await expect(
      accountService.removeMember(org._id.toString(), ownerMember._id.toString(), true)
    ).rejects.toThrow(/last owner/i);
  });

  test('removeMember soft-removes a non-owner', async () => {
    const org = seedAccount({ kind: 'organization' });
    const member = seedMember(org._id, new Types.ObjectId(), 'developer');

    await accountService.removeMember(org._id.toString(), member._id.toString(), true);
    expect(member.status).toBe('removed');
  });

  test('transferOwnership promotes the target and demotes the caller', async () => {
    const org = seedAccount({ kind: 'organization' });
    const alice = seedAccount({ kind: 'personal' });
    const bob = seedAccount({ kind: 'personal' });
    const aliceMember = seedMember(org._id, alice._id, 'owner');
    const bobMember = seedMember(org._id, bob._id, 'admin');

    await accountService.transferOwnership(
      org._id.toString(),
      alice._id.toString(),
      bob._id.toString()
    );

    expect(bobMember.role).toBe('owner');
    expect(aliceMember.role).toBe('admin');
  });

  test('transferOwnership rejects a personal account', async () => {
    const alice = seedAccount({ kind: 'personal' });
    const bob = seedAccount({ kind: 'personal' });
    seedMember(alice._id, bob._id, 'admin');
    await expect(
      accountService.transferOwnership(alice._id.toString(), alice._id.toString(), bob._id.toString())
    ).rejects.toThrow(/personal account cannot be transferred/i);
  });
});

// ===========================================================================
// Credentials (bot accounts)
// ===========================================================================

describe('bot account credentials', () => {
  test('createCredential returns a secret once for a bot account', async () => {
    const bot = seedAccount({ kind: 'bot' });
    const creator = seedAccount({ kind: 'personal' });

    const { credential, secret } = await accountService.createCredential(
      bot._id.toString(),
      creator._id.toString(),
      { name: 'ci', environment: 'production' }
    );
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(credential.publicKey).toMatch(/^oxy_dk_/);
    expect(credential.type).toBe('service');
    // The plaintext secret is never persisted.
    expect((credential as { secret?: string }).secret).toBeUndefined();
  });

  test('createCredential refuses a non-bot account', async () => {
    const org = seedAccount({ kind: 'organization' });
    const creator = seedAccount({ kind: 'personal' });
    await expect(
      accountService.createCredential(org._id.toString(), creator._id.toString(), {
        name: 'x',
        environment: 'production',
      })
    ).rejects.toThrow(/bot accounts/i);
  });

  test('rotateCredential deprecates the previous credential with a grace expiry', async () => {
    const bot = seedAccount({ kind: 'bot' });
    const creator = seedAccount({ kind: 'personal' });
    const { credential } = await accountService.createCredential(
      bot._id.toString(),
      creator._id.toString(),
      { name: 'ci', environment: 'production' }
    );

    const result = await accountService.rotateCredential(
      bot._id.toString(),
      credential._id.toString(),
      creator._id.toString()
    );

    expect(result.rotatedFrom).toBe(credential._id.toString());
    expect(result.credential.publicKey).not.toBe(credential.publicKey);
    const previous = credentialStore.docs.find((d) => d._id.equals(credential._id));
    expect(previous?.status).toBe('deprecated');
    expect(previous?.expiresAt).toBeInstanceOf(Date);
  });

  test('revokeCredential marks the credential revoked', async () => {
    const bot = seedAccount({ kind: 'bot' });
    const creator = seedAccount({ kind: 'personal' });
    const { credential } = await accountService.createCredential(
      bot._id.toString(),
      creator._id.toString(),
      { name: 'ci', environment: 'production' }
    );

    await accountService.revokeCredential(bot._id.toString(), credential._id.toString());
    const stored = credentialStore.docs.find((d) => d._id.equals(credential._id));
    expect(stored?.status).toBe('revoked');
  });
});

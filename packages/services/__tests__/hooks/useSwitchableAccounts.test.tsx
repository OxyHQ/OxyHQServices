/**
 * Tests for `useSwitchableAccounts` — the single source of switchable accounts.
 *
 * A "switchable account" is anything the user can become in one uniform switch:
 *  - a device sign-in (a `ClientSession` projected from the server-authoritative
 *    `SessionClient`, hydrated with a real profile via `getUsersByIds()`), and
 *  - an account-graph node (`useOxy().accounts` — owned orgs + shared-with-you)
 *    that is NOT already a device session.
 *
 * Both are unioned into one flat `SwitchableAccount[]`. Every row carries a
 * canonical `accountId` (the uniform switch key); `sessionId` is present IFF the
 * account is signed in on THIS device. An account that is BOTH a device session
 * AND a graph node is deduped into ONE row (device sessionId + graph metadata).
 */

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  markCurrentAccount,
  buildSwitchableAccounts,
  type SwitchableAccount,
} from '../../src/ui/hooks/useSwitchableAccounts';

interface MockUser {
  id: string;
  username: string;
  name: { displayName?: string };
  email?: string;
  avatar?: string | null;
  color?: string | null;
}

interface MockClientSession {
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  lastActive: string;
  userId?: string;
  authuser?: number;
}

interface MockAccountNode {
  accountId: string;
  kind: 'personal' | 'organization' | 'project' | 'bot';
  parentAccountId: string | null;
  account: MockUser;
  relationship: 'self' | 'owner' | 'member';
  callerMembership: unknown | null;
}

const USER_1: MockUser = {
  id: 'u1',
  username: 'alice',
  name: { displayName: 'Alice A' },
  email: 'alice@test.com',
  avatar: null,
  color: 'blue',
};

const USER_2: MockUser = {
  id: 'u2',
  username: 'bob',
  name: { displayName: 'Bob B' },
  email: 'bob@test.com',
  avatar: null,
  color: 'teal',
};

const ORG_1: MockUser = {
  id: 'org1',
  username: 'acme',
  name: { displayName: 'Acme Inc' },
  email: undefined,
  avatar: 'org-avatar',
  color: 'oxy',
};

const SHARED_1: MockUser = {
  id: 'shared1',
  username: 'shared-co',
  name: { displayName: 'Shared Co' },
  avatar: null,
  color: null,
};

const SESSION_1: MockClientSession = {
  sessionId: 's1',
  deviceId: 'd1',
  expiresAt: '2026-12-31T00:00:00.000Z',
  lastActive: '2026-07-01T00:00:00.000Z',
  userId: 'u1',
  authuser: 0,
};

const SESSION_2: MockClientSession = {
  sessionId: 's2',
  deviceId: 'd1',
  expiresAt: '2026-12-31T00:00:00.000Z',
  lastActive: '2026-07-01T00:00:00.000Z',
  userId: 'u2',
  authuser: 1,
};

const selfNode = (): MockAccountNode => ({
  accountId: 'u1',
  kind: 'personal',
  parentAccountId: null,
  account: USER_1,
  relationship: 'self',
  callerMembership: null,
});

const ownedOrgNode = (): MockAccountNode => ({
  accountId: 'org1',
  kind: 'organization',
  parentAccountId: null,
  account: ORG_1,
  relationship: 'owner',
  callerMembership: { role: 'owner', permissions: ['account:update'] },
});

const sharedNode = (): MockAccountNode => ({
  accountId: 'shared1',
  kind: 'organization',
  parentAccountId: null,
  account: SHARED_1,
  relationship: 'member',
  callerMembership: { role: 'viewer', permissions: ['members:read'] },
});

const resolveAvatarUrl = (avatar: string | null | undefined): string | undefined =>
  avatar ? `https://cdn.test/${avatar}` : undefined;

// The pure builder accepts plain shapes; cast the mock fixtures to the real
// input types at the boundary so the test does not duplicate the full `User` /
// `AccountNode` surface.
type BuildArgs = Parameters<typeof buildSwitchableAccounts>[0];
const build = (over: Partial<BuildArgs>): SwitchableAccount[] =>
  buildSwitchableAccounts({
    sessions: [],
    activeSessionId: null,
    liveUser: null,
    isAuthenticated: true,
    graph: [],
    profilesById: new Map(),
    locale: 'en',
    resolveAvatarUrl,
    ...over,
  } as BuildArgs);

const profiles = (...users: MockUser[]): Map<string, unknown> =>
  new Map(users.map((u) => [u.id, u]));

describe('buildSwitchableAccounts', () => {
  it('unions device sessions and account-graph nodes', () => {
    const rows = build({
      sessions: [SESSION_1, SESSION_2] as unknown as BuildArgs['sessions'],
      activeSessionId: 's1',
      liveUser: USER_1 as unknown as BuildArgs['liveUser'],
      graph: [selfNode(), ownedOrgNode(), sharedNode()] as unknown as BuildArgs['graph'],
      profilesById: profiles(USER_1, USER_2) as BuildArgs['profilesById'],
    });

    // u1 (device+self, deduped), u2 (device), org1 (graph-only), shared1 (graph-only)
    expect(rows.map((r) => r.accountId)).toEqual(['u1', 'u2', 'org1', 'shared1']);
  });

  it('dedups an account that is BOTH a device session and a graph node into one row', () => {
    const rows = build({
      sessions: [SESSION_1] as unknown as BuildArgs['sessions'],
      activeSessionId: 's1',
      liveUser: USER_1 as unknown as BuildArgs['liveUser'],
      graph: [selfNode()] as unknown as BuildArgs['graph'],
      profilesById: profiles(USER_1) as BuildArgs['profilesById'],
    });

    expect(rows).toHaveLength(1);
    const u1 = rows[0];
    // ONE row carrying BOTH the device sessionId AND the graph relationship.
    expect(u1.accountId).toBe('u1');
    expect(u1.sessionId).toBe('s1');
    expect(u1.onDevice).toBe(true);
    expect(u1.relationship).toBe('self');
    expect(u1.isCurrent).toBe(true);
  });

  it('marks on-device rows with a sessionId and graph-only rows without one', () => {
    const rows = build({
      sessions: [SESSION_1] as unknown as BuildArgs['sessions'],
      activeSessionId: 's1',
      liveUser: USER_1 as unknown as BuildArgs['liveUser'],
      graph: [selfNode(), ownedOrgNode()] as unknown as BuildArgs['graph'],
      profilesById: profiles(USER_1) as BuildArgs['profilesById'],
    });

    const device = rows.find((r) => r.accountId === 'u1');
    const graphOnly = rows.find((r) => r.accountId === 'org1');

    expect(device?.sessionId).toBe('s1');
    expect(device?.onDevice).toBe(true);

    expect(graphOnly?.sessionId).toBeUndefined();
    expect(graphOnly?.onDevice).toBe(false);
    expect(graphOnly?.relationship).toBe('owner');
    expect(graphOnly?.kind).toBe('organization');
    expect(graphOnly?.isCurrent).toBe(false);
  });

  it('resolves the graph-only row identity/avatar from the node account', () => {
    const rows = build({
      graph: [ownedOrgNode()] as unknown as BuildArgs['graph'],
    });
    const org = rows[0];
    expect(org.displayName).toBe('Acme Inc');
    expect(org.avatarUrl).toBe('https://cdn.test/org-avatar');
    // No email → falls back to the @handle, never a synthesized address.
    expect(org.email).toBe('@acme');
    expect(org.email).not.toMatch(/@oxy\.so$/);
  });

  it('uses the live user for the active row rather than the (possibly stale) profile map', () => {
    const rows = build({
      sessions: [SESSION_1] as unknown as BuildArgs['sessions'],
      activeSessionId: 's1',
      liveUser: { ...USER_1, name: { displayName: 'Alice (fresh)' } } as unknown as BuildArgs['liveUser'],
      profilesById: profiles({ ...USER_1, name: { displayName: 'Alice (stale)' } }) as BuildArgs['profilesById'],
    });
    expect(rows[0].displayName).toBe('Alice (fresh)');
  });

  it('always represents the signed-in user before the device session set has synced', () => {
    const rows = build({
      sessions: [] as unknown as BuildArgs['sessions'],
      activeSessionId: 's1',
      liveUser: USER_1 as unknown as BuildArgs['liveUser'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe('u1');
    expect(rows[0].sessionId).toBe('s1');
    expect(rows[0].isCurrent).toBe(true);
  });

  it('returns no rows when signed out', () => {
    const rows = build({
      sessions: [] as unknown as BuildArgs['sessions'],
      activeSessionId: null,
      liveUser: null,
      isAuthenticated: false,
      graph: [ownedOrgNode()] as unknown as BuildArgs['graph'],
    });
    expect(rows).toHaveLength(0);
  });
});

describe('markCurrentAccount', () => {
  const account = (sessionId: string, userId: string): SwitchableAccount => ({
    accountId: userId,
    sessionId,
    onDevice: true,
    isCurrent: false,
    displayName: userId,
    email: null,
    color: null,
    user: { id: userId, username: userId, name: {} } as SwitchableAccount['user'],
  });

  it('flags the row matching activeSessionId', () => {
    const accounts = [account('s1', 'u1'), account('s2', 'u2')];
    const flagged = markCurrentAccount(accounts, 's2', 'u2', true);
    expect(flagged.find((a) => a.sessionId === 's2')?.isCurrent).toBe(true);
    expect(flagged.filter((a) => a.isCurrent)).toHaveLength(1);
  });

  it('falls back to matching the live user id when no sessionId matches', () => {
    const accounts = [account('s1', 'u1'), account('s2', 'u2')];
    const flagged = markCurrentAccount(accounts, 'unknown-session', 'u2', true);
    expect(flagged.find((a) => a.sessionId === 's2')?.isCurrent).toBe(true);
  });

  it('falls back to the single account when nothing else matches', () => {
    const accounts = [account('s1', 'u1')];
    const flagged = markCurrentAccount(accounts, null, null, true);
    expect(flagged[0].isCurrent).toBe(true);
  });

  it('marks nothing current when unauthenticated', () => {
    const accounts = [account('s1', 'u1')];
    const flagged = markCurrentAccount(accounts, null, null, false);
    expect(flagged[0].isCurrent).toBe(false);
  });
});

interface MockOxyState {
  oxyServices: {
    getUsersByIds: jest.Mock;
    getFileDownloadUrl: jest.Mock;
    refreshAllSessions: jest.Mock;
  };
  sessions: MockClientSession[];
  activeSessionId: string | null;
  user: MockUser | null;
  isAuthenticated: boolean;
  accounts: MockAccountNode[];
  currentLanguage: string;
}

const makeServices = () => ({
  getUsersByIds: jest.fn(async (ids: string[]) =>
    [USER_1, USER_2].filter((candidate) => ids.includes(candidate.id)),
  ),
  getFileDownloadUrl: jest.fn((avatar: string) => `https://cdn.test/${avatar}`),
  refreshAllSessions: jest.fn(async () => ({ accounts: [] as unknown[] })),
});

const defaultMockState = (): MockOxyState => ({
  oxyServices: makeServices(),
  sessions: [SESSION_1, SESSION_2],
  activeSessionId: 's1',
  user: USER_1,
  isAuthenticated: true,
  accounts: [selfNode(), ownedOrgNode(), sharedNode()],
  currentLanguage: 'en',
});

let mockState: MockOxyState = defaultMockState();

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => mockState,
}));

// eslint-disable-next-line import/first
import { useSwitchableAccounts } from '../../src/ui/hooks/useSwitchableAccounts';

const makeWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useSwitchableAccounts', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockState = defaultMockState();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('unions device sessions and graph nodes, deduping the shared user, never calling refreshAllSessions', async () => {
    const { result } = renderHook(() => useSwitchableAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.accounts).toHaveLength(4));

    const byId = new Map(result.current.accounts.map((a) => [a.accountId, a]));

    // u1 is BOTH the active device session AND the graph `self` node → one row.
    expect(byId.get('u1')?.sessionId).toBe('s1');
    expect(byId.get('u1')?.relationship).toBe('self');
    expect(byId.get('u1')?.isCurrent).toBe(true);

    // u2 is a device-only sign-in (not in the graph).
    expect(byId.get('u2')?.sessionId).toBe('s2');
    expect(byId.get('u2')?.relationship).toBeUndefined();

    // org1 + shared1 are graph-only (owned org / shared) — no device session.
    expect(byId.get('org1')?.sessionId).toBeUndefined();
    expect(byId.get('org1')?.relationship).toBe('owner');
    expect(byId.get('shared1')?.sessionId).toBeUndefined();
    expect(byId.get('shared1')?.relationship).toBe('member');

    expect(mockState.oxyServices.refreshAllSessions).not.toHaveBeenCalled();
  });

  it('lists graph accounts even before the device profile fetch resolves', () => {
    let resolveProfiles: (users: MockUser[]) => void = () => undefined;
    mockState.oxyServices.getUsersByIds = jest.fn(
      () => new Promise<MockUser[]>((resolve) => { resolveProfiles = resolve; }),
    );

    const { result } = renderHook(() => useSwitchableAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    // Active device row (from live user) + the two graph-only rows show
    // immediately; the not-yet-resolved inactive device row is omitted.
    const ids = result.current.accounts.map((a) => a.accountId).sort();
    expect(ids).toEqual(['org1', 'shared1', 'u1']);

    resolveProfiles([USER_1, USER_2]);
  });
});

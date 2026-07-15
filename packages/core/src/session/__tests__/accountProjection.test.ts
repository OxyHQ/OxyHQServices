import type { DeviceSessionState } from '@oxyhq/contracts';
import type { User } from '../../models/interfaces';
import type { AccountNode } from '../../mixins/OxyServices.accounts';
import {
  projectSwitchableAccounts,
  switchableAccountIds,
} from '../accountProjection';

function user(id: string, over: Partial<User> = {}): User {
  return {
    id,
    publicKey: `pk_${id}`,
    username: `user_${id}`,
    name: { displayName: `User ${id}` },
    ...over,
  } as User;
}

function state(
  accounts: Array<{ accountId: string; sessionId: string; authuser?: number }>,
  activeAccountId: string | null,
): DeviceSessionState {
  return {
    deviceId: 'device-1',
    accounts: accounts.map((a) => ({ accountId: a.accountId, sessionId: a.sessionId, authuser: a.authuser ?? 0 })),
    activeAccountId,
    revision: 1,
    updatedAt: 1_720_000_000_000,
  };
}

function graphNode(id: string, over: Partial<AccountNode> = {}): AccountNode {
  return {
    accountId: id,
    kind: 'organization',
    parentAccountId: null,
    account: user(id),
    relationship: 'owner',
    callerMembership: null,
    ...over,
  };
}

const mapOf = (...users: User[]): Map<string, User> => {
  const map = new Map<string, User>();
  for (const u of users) map.set(u.id, u);
  return map;
};

const noAvatar = (): undefined => undefined;

describe('projectSwitchableAccounts', () => {
  it('returns [] for null state and empty graph', () => {
    expect(
      projectSwitchableAccounts({ state: null, graph: [], profilesById: new Map(), resolveAvatarUrl: noAvatar }),
    ).toEqual([]);
  });

  it('projects device rows and flags the active account current', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1', authuser: 0 }, { accountId: 'a2', sessionId: 's2', authuser: 1 }], 'a2'),
      graph: [],
      profilesById: mapOf(user('a1'), user('a2')),
      resolveAvatarUrl: noAvatar,
    });

    expect(rows.map((r) => r.accountId)).toEqual(['a1', 'a2']);
    expect(rows.map((r) => r.isCurrent)).toEqual([false, true]);
    expect(rows.every((r) => r.onDevice)).toBe(true);
    expect(rows[1].sessionId).toBe('s2');
    expect(rows[1].authuser).toBe(1);
  });

  it('omits device accounts whose profile is not resolved (except the active one via activeUser)', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1' }, { accountId: 'a2', sessionId: 's2' }], 'a1'),
      graph: [],
      // a2 has no resolved profile; a1 is active and provided via activeUser.
      profilesById: new Map(),
      activeUser: user('a1', { name: { displayName: 'Fresh A1' } }),
      resolveAvatarUrl: noAvatar,
    });

    expect(rows.map((r) => r.accountId)).toEqual(['a1']);
    expect(rows[0].displayName).toBe('Fresh A1');
    expect(rows[0].isCurrent).toBe(true);
  });

  it('prefers activeUser over profilesById for the active row (freshness)', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1' }], 'a1'),
      graph: [],
      profilesById: mapOf(user('a1', { name: { displayName: 'Stale' } })),
      activeUser: user('a1', { name: { displayName: 'Fresh' } }),
      resolveAvatarUrl: noAvatar,
    });
    expect(rows[0].displayName).toBe('Fresh');
  });

  it('merges graph-only accounts after device rows, carrying graph metadata', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1' }], 'a1'),
      graph: [graphNode('org1', { kind: 'organization', relationship: 'owner', parentAccountId: 'a1' })],
      profilesById: mapOf(user('a1')),
      resolveAvatarUrl: noAvatar,
    });

    expect(rows.map((r) => r.accountId)).toEqual(['a1', 'org1']);
    const org = rows[1];
    expect(org.onDevice).toBe(false);
    expect(org.isCurrent).toBe(false);
    expect(org.sessionId).toBeUndefined();
    expect(org.kind).toBe('organization');
    expect(org.relationship).toBe('owner');
    expect(org.parentAccountId).toBe('a1');
  });

  it('dedups an account present as BOTH device session and graph node into ONE enriched row', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1', authuser: 0 }], 'a1'),
      graph: [graphNode('a1', { kind: 'personal', relationship: 'self', callerMembership: null })],
      profilesById: mapOf(user('a1')),
      resolveAvatarUrl: noAvatar,
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Keeps the device sessionId + active flag, gains the graph metadata.
    expect(row.sessionId).toBe('s1');
    expect(row.onDevice).toBe(true);
    expect(row.isCurrent).toBe(true);
    expect(row.kind).toBe('personal');
    expect(row.relationship).toBe('self');
  });

  it('resolves avatar url via the injected resolver and falls back email to @handle', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1' }], 'a1'),
      graph: [],
      profilesById: mapOf(user('a1', { avatar: 'file123', email: undefined, username: 'nate' })),
      resolveAvatarUrl: (avatar) => (avatar ? `https://cdn/${avatar}` : undefined),
    });
    expect(rows[0].avatarUrl).toBe('https://cdn/file123');
    // No real email → `@handle` secondary line, never synthesized.
    expect(rows[0].email).toBe('@nate');
  });

  it('uses a real email when present', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1' }], 'a1'),
      graph: [],
      profilesById: mapOf(user('a1', { email: 'real@oxy.so' })),
      resolveAvatarUrl: noAvatar,
    });
    expect(rows[0].email).toBe('real@oxy.so');
  });

  it('marks no row current when activeAccountId is null', () => {
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'a1', sessionId: 's1' }], null),
      graph: [],
      profilesById: mapOf(user('a1')),
      resolveAvatarUrl: noAvatar,
    });
    expect(rows.every((r) => !r.isCurrent)).toBe(true);
  });

  it('keeps the OPERATOR full set when acting-as a sub-account (no collapse to the active account)', () => {
    // nate operates albert: albert is the active on-device account, nate is also
    // on-device, and the graph is OPERATOR-anchored (the server returns nate's
    // full forest regardless of which account is active). The projection must
    // faithfully union — switching in only changes which row is `isCurrent`,
    // never which accounts are listed. This is the switcher-collapse regression.
    const rows = projectSwitchableAccounts({
      state: state([{ accountId: 'nate', sessionId: 's-nate' }, { accountId: 'albert', sessionId: 's-albert' }], 'albert'),
      graph: [
        graphNode('nate', { kind: 'personal', relationship: 'self' }),
        graphNode('albert', { relationship: 'owner' }),
        graphNode('oxy', { relationship: 'owner' }),
        graphNode('faircoin', { relationship: 'owner' }),
      ],
      profilesById: mapOf(user('nate'), user('albert'), user('oxy'), user('faircoin')),
      resolveAvatarUrl: noAvatar,
    });

    // The full operable set is present even though a leaf sub-account is active.
    expect(rows.map((r) => r.accountId).sort()).toEqual(['albert', 'faircoin', 'nate', 'oxy']);
    // Exactly the active sub-account is flagged current; operator + siblings stay.
    expect(rows.find((r) => r.accountId === 'albert')?.isCurrent).toBe(true);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    // The operator's own personal account is not dropped by acting-as.
    expect(rows.find((r) => r.accountId === 'nate')).toBeDefined();
    // Graph-only siblings (operable but not yet on this device) still appear.
    expect(rows.find((r) => r.accountId === 'oxy')?.onDevice).toBe(false);
    expect(rows.find((r) => r.accountId === 'faircoin')?.onDevice).toBe(false);
  });
});

describe('switchableAccountIds', () => {
  it('unions device + graph ids, deduped and sorted', () => {
    const ids = switchableAccountIds(
      state([{ accountId: 'b', sessionId: 's1' }, { accountId: 'a', sessionId: 's2' }], 'a'),
      [graphNode('c'), graphNode('a')],
    );
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for null state and empty graph', () => {
    expect(switchableAccountIds(null, [])).toEqual([]);
  });
});

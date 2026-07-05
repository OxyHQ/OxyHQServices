/**
 * `useSwitchableAccounts` — the thin binding over the shared `AccountDialogController`
 * in `@oxyhq/core`. The projection itself (device sign-ins ∪ graph accounts) is
 * unit-tested in core; here we only assert the RN hook faithfully surfaces the
 * controller's snapshot (accounts + loading) and derives the active session id.
 */

import { renderHook } from '@testing-library/react';
import type { AccountDialogSnapshot, SwitchableAccount, User } from '@oxyhq/core';

const makeUser = (id: string): User => ({ id, username: id, name: { displayName: id } } as unknown as User);

const makeAccount = (over: Partial<SwitchableAccount> & Pick<SwitchableAccount, 'accountId'>): SwitchableAccount => ({
  isCurrent: false,
  onDevice: true,
  displayName: over.accountId,
  email: null,
  color: null,
  user: makeUser(over.accountId),
  ...over,
});

const makeSnapshot = (over?: Partial<AccountDialogSnapshot>): AccountDialogSnapshot => ({
  view: 'accounts',
  accounts: [],
  activeAccountId: null,
  loading: false,
  error: null,
  switchingAccountId: null,
  signIn: { phase: 'idle', authorizeCode: null, qrPayload: null, expiresAt: null, error: null },
  ...over,
});

let snapshot = makeSnapshot();
const controller = {
  subscribe: (_listener: () => void) => () => undefined,
  getSnapshot: () => snapshot,
};
let mockController: typeof controller | null = controller;

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({ accountDialogController: mockController }),
}));

import { useSwitchableAccounts } from '../../src/ui/hooks/useSwitchableAccounts';

describe('useSwitchableAccounts', () => {
  beforeEach(() => {
    snapshot = makeSnapshot();
    mockController = controller;
  });

  it('surfaces the controller snapshot accounts + loading flag', () => {
    snapshot = makeSnapshot({
      accounts: [makeAccount({ accountId: 'a' }), makeAccount({ accountId: 'b' })],
      loading: true,
    });

    const { result } = renderHook(() => useSwitchableAccounts());

    expect(result.current.accounts.map((a) => a.accountId)).toEqual(['a', 'b']);
    expect(result.current.isLoading).toBe(true);
  });

  it('derives currentSessionId from the active account row', () => {
    snapshot = makeSnapshot({
      activeAccountId: 'b',
      accounts: [
        makeAccount({ accountId: 'a', sessionId: 'sess-a' }),
        makeAccount({ accountId: 'b', sessionId: 'sess-b', isCurrent: true }),
      ],
    });

    const { result } = renderHook(() => useSwitchableAccounts());

    expect(result.current.currentSessionId).toBe('sess-b');
  });

  it('is inert (empty) before the provider mounts', () => {
    mockController = null;

    const { result } = renderHook(() => useSwitchableAccounts());

    expect(result.current.accounts).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentSessionId).toBeNull();
  });
});

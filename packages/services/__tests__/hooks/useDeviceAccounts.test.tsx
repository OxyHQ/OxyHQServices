/**
 * Tests for `useDeviceAccounts`.
 *
 * Post session-sync cutover, the device account list is sourced ENTIRELY from
 * `useOxy().sessions` — the `ClientSession[]` `OxyContext` projects from the
 * server-authoritative `SessionClient` device state — hydrated with real
 * per-account profiles via `oxyServices.getUsersByIds()`. The retired
 * `oxyServices.refreshAllSessions()` (`oxy_rt` cross-domain cookie) path must
 * never be called.
 */

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { markCurrentAccount, type DeviceAccount } from '../../src/ui/hooks/useDeviceAccounts';

interface MockUser {
  id: string;
  username: string;
  name: { displayName: string };
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

interface MockOxyServices {
  getUsersByIds: jest.Mock;
  getFileDownloadUrl: jest.Mock;
  refreshAllSessions: jest.Mock;
}

interface MockOxyState {
  oxyServices: MockOxyServices;
  sessions: MockClientSession[];
  activeSessionId: string | null;
  user: MockUser | null;
  isAuthenticated: boolean;
  currentLanguage: string;
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

const makeServices = (): MockOxyServices => ({
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
  currentLanguage: 'en',
});

let mockState: MockOxyState = defaultMockState();

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => mockState,
}));

import { useDeviceAccounts } from '../../src/ui/hooks/useDeviceAccounts';

const makeWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useDeviceAccounts', () => {
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

  it('lists every device session, hydrated with its real profile, and never calls refreshAllSessions', async () => {
    const { result } = renderHook(() => useDeviceAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.accounts).toHaveLength(2));

    const [a1, a2] = [...result.current.accounts].sort(
      (a, b) => a.sessionId.localeCompare(b.sessionId),
    );

    expect(a1.sessionId).toBe('s1');
    expect(a1.isCurrent).toBe(true);
    expect(a1.displayName).toBe('Alice A');
    expect(a1.email).toBe('alice@test.com');
    expect(a1.color).toBe('blue');

    expect(a2.sessionId).toBe('s2');
    expect(a2.isCurrent).toBe(false);
    expect(a2.displayName).toBe('Bob B');
    expect(a2.email).toBe('bob@test.com');
    expect(a2.color).toBe('teal');

    expect(result.current.currentSessionId).toBe('s1');
    expect(mockState.oxyServices.refreshAllSessions).not.toHaveBeenCalled();
  });

  it('resolves the active row from the live useOxy().user, not the profile fetch', async () => {
    // The active session's profile fetch would resolve to a STALE name; the
    // live `user` from `useOxy()` must win for the active row regardless.
    mockState.user = { ...USER_1, name: { displayName: 'Alice (fresh)' } };
    mockState.oxyServices.getUsersByIds = jest.fn(async () => [
      { ...USER_1, name: { displayName: 'Alice (stale)' } },
      USER_2,
    ]);

    const { result } = renderHook(() => useDeviceAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.accounts).toHaveLength(2));

    const active = result.current.accounts.find((account) => account.sessionId === 's1');
    expect(active?.displayName).toBe('Alice (fresh)');
  });

  it('always represents the signed-in user even before the session set has synced', () => {
    mockState.sessions = [];

    const { result } = renderHook(() => useDeviceAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.accounts[0].sessionId).toBe('s1');
    expect(result.current.accounts[0].isCurrent).toBe(true);
    expect(result.current.accounts[0].displayName).toBe('Alice A');
    expect(mockState.oxyServices.getUsersByIds).not.toHaveBeenCalled();
  });

  it('returns no accounts and never fetches profiles when signed out', () => {
    mockState.isAuthenticated = false;
    mockState.user = null;
    mockState.activeSessionId = null;
    mockState.sessions = [];

    const { result } = renderHook(() => useDeviceAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.accounts).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(mockState.oxyServices.getUsersByIds).not.toHaveBeenCalled();
    expect(mockState.oxyServices.refreshAllSessions).not.toHaveBeenCalled();
  });

  it('omits a non-active row whose profile has not resolved yet, without dropping the active row', async () => {
    let resolveProfiles: (users: MockUser[]) => void = () => undefined;
    mockState.oxyServices.getUsersByIds = jest.fn(
      () => new Promise<MockUser[]>((resolve) => { resolveProfiles = resolve; }),
    );

    const { result } = renderHook(() => useDeviceAccounts(), {
      wrapper: makeWrapper(queryClient),
    });

    // Before the profile fetch resolves: only the active row (from the live
    // `user`) is present — the inactive row is never fabricated.
    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.accounts[0].sessionId).toBe('s1');

    resolveProfiles([USER_1, USER_2]);

    await waitFor(() => expect(result.current.accounts).toHaveLength(2));
  });
});

describe('markCurrentAccount', () => {
  const account = (sessionId: string, userId: string): DeviceAccount => ({
    sessionId,
    isCurrent: false,
    displayName: userId,
    email: null,
    color: null,
    user: { id: userId, username: userId, name: {} } as DeviceAccount['user'],
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

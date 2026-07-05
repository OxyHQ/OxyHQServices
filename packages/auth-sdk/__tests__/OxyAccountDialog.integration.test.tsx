/**
 * OxyAccountDialog — end-to-end through the REAL WebOxyProvider + the REAL
 * `AccountDialogController`.
 *
 * Proves the provider builds the shared core controller and that it projects the
 * device's `SessionClient` state (∪ the account graph) via the REAL
 * `projectSwitchableAccounts` into the dialog's account list. `createSessionClient`
 * is the one mocked seam (a controllable fake client); the controller, the
 * projection, and the provider are the real implementations.
 */

import { render, act, waitFor, screen } from '@testing-library/react';
import type { User } from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';

const stubs = {
  getUsersByIds: jest.fn(async (_ids: string[]) => [] as User[]),
  getUserById: jest.fn(async (id: string): Promise<User> => ({ id, username: `user-${id}` } as User)),
  baseURL: 'https://api.oxy.so',
};

jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    ...actual,
    runSessionColdBoot: jest.fn(async (opts: { onSignedOut?: (r: string) => void }) => {
      await opts.onSignedOut?.('no_session');
      return { kind: 'unauthenticated' };
    }),
    installAuthRefreshHandler: jest.fn(() => () => undefined),
    startTokenRefreshScheduler: jest.fn(() => ({ dispose: () => undefined })),
    refreshPersistedSession: jest.fn(async () => null),
    createSessionClient: jest.fn(),
    OxyServices: class {
      private token: string | null = null;
      getBaseURL(): string { return stubs.baseURL; }
      getAccessToken(): string | null { return this.token; }
      setTokens(t: string): void { this.token = t; }
      getAccessTokenExpiry(): number | null { return null; }
      onTokensChanged(): () => void { return () => undefined; }
      getUsersByIds(ids: string[]): Promise<User[]> { return stubs.getUsersByIds(ids); }
      getUserById(id: string): Promise<User> { return stubs.getUserById(id); }
      getFileDownloadUrl(id: string): string { return `https://cdn.test/${id}`; }
      listAccounts(): Promise<never[]> { return Promise.resolve([]); }
    },
  };
});

import { WebOxyProvider, useAuth, type WebOxyContextValue } from '../src/WebOxyProvider';
import { createSessionClient } from '@oxyhq/core';

const mockedCreateSessionClient = createSessionClient as jest.MockedFunction<typeof createSessionClient>;

type StateListener = (state: DeviceSessionState | null) => void;

function buildFakeClient(state: DeviceSessionState) {
  const listeners = new Set<StateListener>();
  return {
    fakeClient: {
      getState: () => state,
      subscribe: (l: StateListener) => { listeners.add(l); return () => listeners.delete(l); },
      switchAccount: jest.fn(async () => undefined),
      signOut: jest.fn(async () => undefined),
      stop: jest.fn(),
    },
    fire() { for (const l of listeners) l(state); },
  };
}

function deviceState(): DeviceSessionState {
  return {
    deviceId: 'dev-1',
    accounts: [
      { accountId: 'u1', sessionId: 'sess-u1', authuser: 0 },
      { accountId: 'u2', sessionId: 'sess-u2', authuser: 1 },
    ],
    activeAccountId: 'u1',
    revision: 1,
    updatedAt: Date.now(),
  };
}

function user(id: string, displayName: string, username: string): User {
  return { id, username, name: { first: displayName, displayName } } as User;
}

let ctxRef: WebOxyContextValue | null = null;
function Capture() {
  ctxRef = useAuth() as unknown as WebOxyContextValue;
  return null;
}

describe('OxyAccountDialog — real provider + controller feed the dialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    ctxRef = null;
    mockedCreateSessionClient.mockReset();
    stubs.getUsersByIds = jest.fn(async () => [user('u1', 'Nate Isern', 'nate'), user('u2', 'Bob Doe', 'bob')]);
  });

  it('projects SessionClient accounts via the controller and renders them in the dialog', async () => {
    const fake = buildFakeClient(deviceState());
    mockedCreateSessionClient.mockReturnValue({
      client: fake.fakeClient as never,
      host: { setCurrentAccountId: jest.fn() } as never,
    });

    render(
      <WebOxyProvider baseURL={stubs.baseURL}>
        <Capture />
      </WebOxyProvider>,
    );

    await waitFor(() => expect(ctxRef).not.toBeNull());
    // The provider-built controller loads the switchable account list on start().
    await waitFor(() => expect(ctxRef?.accountDialog.getSnapshot().accounts.length).toBe(2));

    // Opening the dialog on the accounts view lists the real device accounts.
    act(() => { ctxRef?.signIn(); });
    await waitFor(() => expect(screen.getByText('Your accounts')).toBeTruthy());
    expect(screen.getByText('Nate Isern')).toBeTruthy();
    expect(screen.getByText('Bob Doe')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });
});

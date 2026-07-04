/**
 * OxySignInModal v2 — the account-chooser first view.
 *
 * The provider context (`accounts` / `activeAuthuser` / `switchAccount`) is the
 * one mocked seam; the modal reads it via `useWebOxyOptional`. Asserts:
 *   - with device accounts, the chooser lists them (displayName ?? handle) and
 *     marks the active one;
 *   - a one-tap on a non-active row calls `switchAccount(authuser)`;
 *   - tapping the active row just closes (no switch);
 *   - "Use another account" reveals the sign-in view;
 *   - with NO accounts, the sign-in view is shown directly.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DeviceAccountView } from '../src/session/deviceAccountsProjection';

const ctx = {
  accounts: [] as DeviceAccountView[],
  activeAuthuser: null as number | null,
  switchAccount: jest.fn(async (_authuser: number) => undefined),
  oxyServices: { getFileDownloadUrl: (id: string) => `https://cdn.test/${id}` },
};

jest.mock('../src/WebOxyProvider', () => ({
  __esModule: true,
  useWebOxyOptional: () => ctx,
}));

import { OxySignInModal } from '../src/components/OxySignInModal';

function makeAccount(authuser: number, id: string, displayName: string, username: string): DeviceAccountView {
  return {
    authuser,
    sessionId: `sess-${id}`,
    user: {
      id,
      username,
      name: { first: displayName, displayName },
      avatar: null,
      email: `${username}@example.com`,
      color: null,
    },
    accessToken: authuser === 0 ? 'at' : '',
    expiresAt: '2999-01-01T00:00:00.000Z',
  };
}

describe('OxySignInModal — account chooser', () => {
  beforeEach(() => {
    ctx.accounts = [];
    ctx.activeAuthuser = null;
    ctx.switchAccount = jest.fn(async () => undefined);
  });

  it('lists device accounts and marks the active one', () => {
    ctx.accounts = [makeAccount(0, 'u1', 'Nate Isern', 'nate'), makeAccount(1, 'u2', 'Bob Doe', 'bob')];
    ctx.activeAuthuser = 0;

    render(<OxySignInModal open onClose={() => undefined} />);

    expect(screen.getByText('Choose an account')).toBeTruthy();
    expect(screen.getByText('Nate Isern')).toBeTruthy();
    expect(screen.getByText('Bob Doe')).toBeTruthy();
    // The active account row shows the "Active" marker exactly once.
    expect(screen.getAllByText('Active')).toHaveLength(1);
    expect(screen.getByText('Use another account')).toBeTruthy();
  });

  it('one-tap on a non-active account calls switchAccount(authuser)', async () => {
    ctx.accounts = [makeAccount(0, 'u1', 'Nate Isern', 'nate'), makeAccount(1, 'u2', 'Bob Doe', 'bob')];
    ctx.activeAuthuser = 0;
    const onClose = jest.fn();

    render(<OxySignInModal open onClose={onClose} />);
    fireEvent.click(screen.getByText('Bob Doe'));

    await waitFor(() => expect(ctx.switchAccount).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('tapping the already-active account closes without switching', () => {
    ctx.accounts = [makeAccount(0, 'u1', 'Nate Isern', 'nate')];
    ctx.activeAuthuser = 0;
    const onClose = jest.fn();

    render(<OxySignInModal open onClose={onClose} />);
    fireEvent.click(screen.getByText('Nate Isern'));

    expect(ctx.switchAccount).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('"Use another account" reveals the sign-in view', () => {
    ctx.accounts = [makeAccount(0, 'u1', 'Nate Isern', 'nate')];
    ctx.activeAuthuser = 0;

    render(<OxySignInModal open onClose={() => undefined} />);
    fireEvent.click(screen.getByText('Use another account'));

    expect(screen.getByText('Sign in with Oxy')).toBeTruthy();
    expect(screen.getByLabelText('Username or email')).toBeTruthy();
  });

  it('shows the sign-in view directly when there are no device accounts', () => {
    ctx.accounts = [];
    render(<OxySignInModal open onClose={() => undefined} />);
    expect(screen.getByText('Sign in with Oxy')).toBeTruthy();
    expect(screen.queryByText('Choose an account')).toBeNull();
  });
});

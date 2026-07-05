/**
 * OxyAccountDialog — the unified account dialog, bound to a fake
 * {@link AccountDialogController} via the `controller` prop.
 *
 * The controller (headless core state machine) is the one mocked seam; the
 * dialog reads it through `useSyncExternalStore`. `useWebOxyOptional` is stubbed
 * only for the provider-level `signOutAll` affordance. Asserts:
 *   - the `accounts` view lists switchable accounts (displayName + handle) and
 *     marks the active one;
 *   - a one-tap on a non-active row is the UNIFORM switch `switchTo(accountId)`
 *     and then closes;
 *   - tapping the active row just closes (no switch);
 *   - "Add account" drives the controller to the sign-in view;
 *   - the sign-in entry wires "Sign in with Oxy" / "Scan a QR" / password handoff;
 *   - the `qr` view renders the handoff payload.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { User } from '@oxyhq/core';
import type {
  AccountDialogController,
  AccountDialogSnapshot,
  SwitchableAccount,
} from '@oxyhq/core';

const mockSignOutAll = jest.fn(async () => undefined);
jest.mock('../src/WebOxyProvider', () => ({
  __esModule: true,
  useWebOxyOptional: () => ({ signOutAll: mockSignOutAll }),
}));

import { OxyAccountDialog } from '../src/components/OxyAccountDialog';

const IDLE_SIGN_IN = {
  phase: 'idle' as const,
  authorizeCode: null,
  qrPayload: null,
  expiresAt: null,
  error: null,
};

function baseSnapshot(overrides: Partial<AccountDialogSnapshot> = {}): AccountDialogSnapshot {
  return {
    view: 'accounts',
    accounts: [],
    activeAccountId: null,
    loading: false,
    error: null,
    switchingAccountId: null,
    signIn: IDLE_SIGN_IN,
    ...overrides,
  };
}

function makeController(initial: Partial<AccountDialogSnapshot> = {}) {
  let snapshot = baseSnapshot(initial);
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const api = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setView: jest.fn((view: AccountDialogSnapshot['view']) => { snapshot = { ...snapshot, view }; emit(); }),
    close: jest.fn(),
    add: jest.fn(() => { snapshot = { ...snapshot, view: 'add' }; emit(); }),
    refresh: jest.fn(async () => undefined),
    switchTo: jest.fn(async () => undefined),
    signInWithOxy: jest.fn(async () => undefined),
    showQr: jest.fn(async () => undefined),
    cancelSignIn: jest.fn(),
    openPasswordAtOxyAuth: jest.fn(() => 'https://auth.oxy.so/login'),
    start: jest.fn(),
    destroy: jest.fn(),
  };
  return {
    controller: api as unknown as AccountDialogController,
    api,
    set(next: Partial<AccountDialogSnapshot>) { snapshot = { ...snapshot, ...next }; emit(); },
  };
}

function account(
  id: string,
  displayName: string,
  username: string,
  isCurrent: boolean,
  color: string | null = null,
): SwitchableAccount {
  return {
    accountId: id,
    sessionId: `sess-${id}`,
    authuser: 0,
    isCurrent,
    onDevice: true,
    displayName,
    email: `@${username}`,
    color,
    user: { id, username, name: { first: displayName, displayName } } as User,
  };
}

describe('OxyAccountDialog', () => {
  beforeEach(() => {
    mockSignOutAll.mockClear();
  });

  it('renders nothing when closed', () => {
    const { controller } = makeController();
    const { container } = render(<OxyAccountDialog open={false} onClose={() => undefined} controller={controller} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists switchable accounts, marks the active one, and offers Add account', () => {
    const { controller } = makeController({
      accounts: [account('u1', 'Nate Isern', 'nate', true), account('u2', 'Bob Doe', 'bob', false)],
      activeAccountId: 'u1',
    });
    render(<OxyAccountDialog open onClose={() => undefined} controller={controller} />);

    expect(screen.getByText('Your accounts')).toBeTruthy();
    expect(screen.getByText('Nate Isern')).toBeTruthy();
    expect(screen.getByText('Bob Doe')).toBeTruthy();
    expect(screen.getAllByText('Active')).toHaveLength(1);
    expect(screen.getByText('Add account')).toBeTruthy();
    expect(screen.getByText('Sign out everywhere')).toBeTruthy();
  });

  it('one-tap on a non-active account calls switchTo(accountId) and closes', async () => {
    const { controller, api } = makeController({
      accounts: [account('u1', 'Nate Isern', 'nate', true), account('u2', 'Bob Doe', 'bob', false)],
      activeAccountId: 'u1',
    });
    const onClose = jest.fn();
    render(<OxyAccountDialog open onClose={onClose} controller={controller} />);

    fireEvent.click(screen.getByText('Bob Doe'));
    await waitFor(() => expect(api.switchTo).toHaveBeenCalledWith('u2'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('tapping the already-active account closes without switching', () => {
    const { controller, api } = makeController({
      accounts: [account('u1', 'Nate Isern', 'nate', true)],
      activeAccountId: 'u1',
    });
    const onClose = jest.fn();
    render(<OxyAccountDialog open onClose={onClose} controller={controller} />);

    fireEvent.click(screen.getByText('Nate Isern'));
    expect(api.switchTo).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('"Add account" drives the controller to the sign-in view', () => {
    const { controller, api } = makeController({
      accounts: [account('u1', 'Nate Isern', 'nate', true)],
      activeAccountId: 'u1',
    });
    render(<OxyAccountDialog open onClose={() => undefined} controller={controller} />);

    fireEvent.click(screen.getByText('Add account'));
    expect(api.setView).toHaveBeenCalledWith('signin');
    // The store update re-renders into the sign-in entry.
    expect(screen.getByRole('button', { name: 'Sign in with Oxy' })).toBeTruthy();
  });

  it('shows the sign-in entry directly when there are no accounts', () => {
    const { controller } = makeController({ accounts: [] });
    render(<OxyAccountDialog open onClose={() => undefined} controller={controller} />);

    expect(screen.getByRole('button', { name: 'Sign in with Oxy' })).toBeTruthy();
    expect(screen.queryByText('Your accounts')).toBeNull();
    expect(screen.getByText('Open auth.oxy.so')).toBeTruthy();
  });

  it('wires the sign-in entry actions to the controller', () => {
    const { controller, api } = makeController({ view: 'signin', accounts: [] });
    render(<OxyAccountDialog open onClose={() => undefined} controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Oxy' }));
    expect(api.signInWithOxy).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Scan a QR code from another device'));
    expect(api.showQr).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Open auth.oxy.so'));
    expect(api.openPasswordAtOxyAuth).toHaveBeenCalled();
  });

  it('renders the QR handoff view for the qr view', () => {
    const { controller } = makeController({
      view: 'qr',
      signIn: { ...IDLE_SIGN_IN, phase: 'waiting', qrPayload: 'oxycommons://approve?v=1&code=abc' },
    });
    render(<OxyAccountDialog open onClose={() => undefined} controller={controller} />);

    expect(screen.getByText('Scan with Oxy')).toBeTruthy();
    expect(screen.getByText(/Open Commons/)).toBeTruthy();
  });

  it('closes on the × button and on Escape', () => {
    const { controller } = makeController({ accounts: [account('u1', 'Nate', 'nate', true)], activeAccountId: 'u1' });
    const onClose = jest.fn();
    render(<OxyAccountDialog open onClose={onClose} controller={controller} />);

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('focuses the first account row on open (not the header × button)', () => {
    const { controller } = makeController({
      accounts: [account('u1', 'Nate Isern', 'nate', true), account('u2', 'Bob Doe', 'bob', false)],
      activeAccountId: 'u1',
    });
    render(<OxyAccountDialog open onClose={() => undefined} controller={controller} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Continue as Nate Isern'));
  });
});

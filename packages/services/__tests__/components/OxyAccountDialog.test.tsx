/**
 * `OxyAccountDialog` — the unified account switcher + sign-in surface.
 *
 * These tests isolate the RN binding over the headless `AccountDialogController`
 * (mocked): the dialog renders the correct view from `snapshot.view`, taps a row
 * through `controller.switchTo`, and drives the sign-in actions. The controller's
 * own state machine + projection are unit-tested in `@oxyhq/core`.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AccountDialogSnapshot, SwitchableAccount, User } from '@oxyhq/core';

const makeUser = (id: string): User => ({ id, username: id, name: { displayName: id } } as unknown as User);

const makeAccount = (
  over: Partial<SwitchableAccount> & Pick<SwitchableAccount, 'accountId' | 'displayName'>,
): SwitchableAccount => ({
  isCurrent: false,
  onDevice: true,
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
  subscribe: (_l: () => void) => () => undefined,
  getSnapshot: () => snapshot,
  switchTo: jest.fn(async () => undefined),
  add: jest.fn(),
  showQr: jest.fn(),
  signInWithOxy: jest.fn(),
  setView: jest.fn(),
  cancelSignIn: jest.fn(),
  openPasswordAtOxyAuth: jest.fn(() => 'https://auth.oxy.so/login'),
};

const closeAccountDialog = jest.fn();
const showBottomSheet = jest.fn();
const invalidateQueries = jest.fn();

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    accountDialogController: controller,
    isAccountDialogOpen: true,
    closeAccountDialog,
    showBottomSheet,
    logoutAll: jest.fn(async () => undefined),
    refreshAccounts: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({ t: () => '', locale: 'en' }),
}));

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries }),
}));

jest.mock('react-native-gesture-handler', () => ({
  __esModule: true,
  GestureHandlerRootView: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) =>
    require('react').createElement('span', { 'data-testid': 'qrcode' }, value),
}));

jest.mock('@expo/vector-icons', () => ({ __esModule: true, MaterialCommunityIcons: () => null }));
jest.mock('../../src/ui/components/OxyLogo', () => ({ __esModule: true, default: () => null }));

// eslint-disable-next-line import/first
import OxyAccountDialog from '../../src/ui/components/OxyAccountDialog';

describe('OxyAccountDialog', () => {
  beforeEach(() => {
    snapshot = makeSnapshot();
    jest.clearAllMocks();
  });

  it('renders the account rows + add row in the accounts view', () => {
    snapshot = makeSnapshot({
      activeAccountId: 'a',
      accounts: [
        makeAccount({ accountId: 'a', displayName: 'Alice', isCurrent: true, sessionId: 's-a' }),
        makeAccount({ accountId: 'b', displayName: 'Bob', sessionId: 's-b' }),
      ],
    });

    render(<OxyAccountDialog />);

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    // The add-account affordance renders its fallback label.
    expect(screen.getByText('Add another account')).toBeTruthy();
  });

  it('switches through controller.switchTo when a non-active row is tapped', async () => {
    snapshot = makeSnapshot({
      activeAccountId: 'a',
      accounts: [
        makeAccount({ accountId: 'a', displayName: 'Alice', isCurrent: true, sessionId: 's-a' }),
        makeAccount({ accountId: 'b', displayName: 'Bob', sessionId: 's-b' }),
      ],
    });

    render(<OxyAccountDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    await waitFor(() => expect(controller.switchTo).toHaveBeenCalledWith('b'));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('starts the device flow from the sign-in view', () => {
    snapshot = makeSnapshot({ view: 'signin' });

    render(<OxyAccountDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Oxy' }));

    expect(controller.signInWithOxy).toHaveBeenCalledTimes(1);
  });

  it('renders the QR payload while awaiting approval', () => {
    snapshot = makeSnapshot({
      view: 'qr',
      signIn: {
        phase: 'waiting',
        authorizeCode: 'CODE',
        qrPayload: 'oxycommons://approve?code=CODE',
        expiresAt: Date.now() + 60_000,
        error: null,
      },
    });

    render(<OxyAccountDialog />);

    expect(screen.getByTestId('qrcode')).toBeTruthy();
  });
});

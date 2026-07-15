/**
 * `OxyAuthChooser` — the account switcher + sign-in/sign-up chooser
 * (extracted from `OxyAccountDialog`, no Dialog chrome).
 *
 * These tests isolate the RN binding over the headless `AccountDialogController`
 * (mocked): the chooser renders the correct view from `snapshot.view`, taps a row
 * through `controller.switchTo`, auto-starts "Sign in with Oxy" on web when the
 * sign-in entry is reached, and offers the passkey link only alongside the QR
 * view on a first-party Oxy origin. The controller's own state machine +
 * projection are unit-tested in `@oxyhq/core`.
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
  commonsAvailability: 'unknown',
  ...over,
});

let snapshot = makeSnapshot();
const controller = {
  subscribe: (_l: () => void) => () => undefined,
  getSnapshot: () => snapshot,
  switchTo: jest.fn(async () => undefined),
  add: jest.fn(),
  startSignup: jest.fn(),
  showQr: jest.fn(),
  signInWithOxy: jest.fn(),
  setView: jest.fn(),
  cancelSignIn: jest.fn(),
};

const signInWithPasskey = jest.fn(async () => undefined);
const registerWithPasskey = jest.fn(async () => undefined);
const closeAccountDialog = jest.fn();
const showBottomSheet = jest.fn();
const invalidateQueries = jest.fn();
const checkUsernameAvailability = jest.fn(async () => ({ available: true, message: '' }));

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    accountDialogController: controller,
    isAccountDialogOpen: true,
    closeAccountDialog,
    showBottomSheet,
    logoutAll: jest.fn(async () => undefined),
    refreshAccounts: jest.fn(async () => undefined),
    signInWithPasskey,
    registerWithPasskey,
    oxyServices: { checkUsernameAvailability },
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

jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) =>
    require('react').createElement('span', { 'data-testid': 'qrcode' }, value),
}));

jest.mock('@expo/vector-icons', () => ({ __esModule: true, MaterialCommunityIcons: () => null }));

// The two environment gate probes, toggled per test.
const isWebBrowserMock = jest.fn(() => true);
jest.mock('../../src/ui/utils/isWebBrowser', () => ({
  __esModule: true,
  isWebBrowser: () => isWebBrowserMock(),
}));

const isOxyRpOriginMock = jest.fn(() => true);
jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return { __esModule: true, ...actual, isOxyRpOrigin: () => isOxyRpOriginMock() };
});

// eslint-disable-next-line import/first
import OxyAuthChooser from '../../src/ui/components/OxyAuthChooser';

describe('OxyAuthChooser', () => {
  beforeEach(() => {
    snapshot = makeSnapshot();
    jest.clearAllMocks();
    isWebBrowserMock.mockReturnValue(true);
    isOxyRpOriginMock.mockReturnValue(true);
  });

  it('renders the account rows + add row in the accounts view', () => {
    snapshot = makeSnapshot({
      activeAccountId: 'a',
      accounts: [
        makeAccount({ accountId: 'a', displayName: 'Alice', isCurrent: true, sessionId: 's-a' }),
        makeAccount({ accountId: 'b', displayName: 'Bob', sessionId: 's-b' }),
      ],
    });

    render(<OxyAuthChooser />);

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
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

    render(<OxyAuthChooser />);
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    await waitFor(() => expect(controller.switchTo).toHaveBeenCalledWith('b'));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('auto-starts the device flow on web the instant the sign-in entry is reached — no click needed', () => {
    snapshot = makeSnapshot({ view: 'signin' });

    render(<OxyAuthChooser />);

    expect(controller.signInWithOxy).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-start on native — stays button-driven', () => {
    isWebBrowserMock.mockReturnValue(false);
    snapshot = makeSnapshot({ view: 'signin' });

    render(<OxyAuthChooser />);
    expect(controller.signInWithOxy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Oxy' }));
    expect(controller.signInWithOxy).toHaveBeenCalledTimes(1);
  });

  it('does not re-trigger the auto-start once a flow is already in flight', () => {
    snapshot = makeSnapshot({
      view: 'signin',
      signIn: { phase: 'waiting', authorizeCode: 'C', qrPayload: 'oxycommons://approve?code=C', expiresAt: null, error: null },
    });

    render(<OxyAuthChooser />);

    expect(controller.signInWithOxy).not.toHaveBeenCalled();
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

    render(<OxyAuthChooser />);

    expect(screen.getByTestId('qrcode')).toBeTruthy();
  });

  describe('passkey link on the QR view', () => {
    const qrSnapshot = (): AccountDialogSnapshot =>
      makeSnapshot({
        view: 'qr',
        signIn: {
          phase: 'waiting',
          authorizeCode: 'CODE',
          qrPayload: 'oxycommons://approve?code=CODE',
          expiresAt: Date.now() + 60_000,
          error: null,
        },
      });

    it('offers "use the identity on this device" on a first-party Oxy origin, alongside the QR', () => {
      snapshot = qrSnapshot();
      render(<OxyAuthChooser />);

      expect(screen.getByTestId('qrcode')).toBeTruthy();
      expect(screen.getByTestId('passkey-signin-link')).toBeTruthy();
    });

    it('drives signInWithPasskey and completes on a successful press', async () => {
      snapshot = qrSnapshot();
      render(<OxyAuthChooser />);

      fireEvent.click(screen.getByTestId('passkey-signin-link'));

      await waitFor(() => expect(signInWithPasskey).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(closeAccountDialog).not.toHaveBeenCalled()); // onComplete is not wired without a host
    });

    it('hides the passkey link on a non-Oxy origin (b2 hub relay not shipped yet)', () => {
      isOxyRpOriginMock.mockReturnValue(false);
      snapshot = qrSnapshot();
      render(<OxyAuthChooser />);

      expect(screen.queryByTestId('passkey-signin-link')).toBeNull();
      expect(screen.getByTestId('qrcode')).toBeTruthy();
    });
  });

  describe('signup view', () => {
    it('offers passkey account creation on a first-party Oxy origin, gated on username availability', async () => {
      snapshot = makeSnapshot({ view: 'signup' });
      render(<OxyAuthChooser />);

      const button = screen.getByTestId('signup-create-button') as HTMLButtonElement;
      expect(button.disabled).toBe(true);

      fireEvent.change(screen.getByTestId('signup-username-input'), { target: { value: 'newuser' } });
      await waitFor(() => expect(checkUsernameAvailability).toHaveBeenCalledWith('newuser'), { timeout: 1000 });

      await waitFor(() => expect((screen.getByTestId('signup-create-button') as HTMLButtonElement).disabled).toBe(false));

      fireEvent.click(screen.getByTestId('signup-create-button'));
      await waitFor(() => expect(registerWithPasskey).toHaveBeenCalledWith({ username: 'newuser' }));
    });

    it('shows an honest unavailable message on a non-Oxy web origin (no hub relay yet)', () => {
      isOxyRpOriginMock.mockReturnValue(false);
      snapshot = makeSnapshot({ view: 'signup' });
      render(<OxyAuthChooser />);

      expect(screen.queryByTestId('signup-username-input')).toBeNull();
    });

    it('offers Commons identity creation on native', () => {
      isWebBrowserMock.mockReturnValue(false);
      isOxyRpOriginMock.mockReturnValue(false);
      snapshot = makeSnapshot({ view: 'signup' });
      render(<OxyAuthChooser />);

      expect(screen.getByRole('button', { name: /Create your identity in Commons|Get Commons/ })).toBeTruthy();
    });
  });
});

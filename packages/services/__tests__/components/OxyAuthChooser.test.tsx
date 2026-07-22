/**
 * `OxyAuthChooser` — the account switcher + sign-in/sign-up chooser
 * (extracted from `OxyAccountDialog`, no Dialog chrome).
 *
 * These tests isolate the RN binding over the headless `AccountDialogController`
 * (mocked): the chooser renders the correct view from `snapshot.view`, taps a row
 * through `controller.switchTo`, auto-starts "Sign in with Oxy" on web when the
 * sign-in entry is reached, and offers the passkey link/CTA alongside the QR and
 * signup views on EVERY web origin — direct on a first-party Oxy origin
 * (`signInWithPasskey`/`registerWithPasskey`), routed through the auth.oxy.so
 * hub popup elsewhere (`controller.startPasskeyHubSignIn`, b2). The
 * controller's own state machine + projection are unit-tested in `@oxyhq/core`.
 *
 * Error-surfacing contract (owner mandate: NO error renders inline inside the
 * dialog): every failure — account-switch, passkey sign-in ceremony, passkey
 * account creation, username-availability check — fires a Bloom `toast.error(...)`
 * at the point of failure and paints NO inline banner/text. The `toast` here is
 * the shared `@oxyhq/bloom` jest.fn mock; the removed inline `ErrorBanner` is
 * asserted absent.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from '@oxyhq/bloom';
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
  startPasskeyHubSignIn: jest.fn(),
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
// eslint-disable-next-line import/first
import { registerAccountDialogConsumerHooks } from '../../src/ui/navigation/accountDialogManager';

describe('OxyAuthChooser', () => {
  afterEach(() => {
    registerAccountDialogConsumerHooks(null);
  });
  beforeEach(() => {
    snapshot = makeSnapshot();
    jest.clearAllMocks();
    isWebBrowserMock.mockReturnValue(true);
    isOxyRpOriginMock.mockReturnValue(true);
  });

  it('collapses to the current account by default and expands to reveal the rest', () => {
    snapshot = makeSnapshot({
      activeAccountId: 'a',
      accounts: [
        makeAccount({ accountId: 'a', displayName: 'Alice', isCurrent: true, sessionId: 's-a' }),
        makeAccount({ accountId: 'b', displayName: 'Bob', sessionId: 's-b' }),
      ],
    });

    render(<OxyAuthChooser />);

    // Collapsed by default (Google account-menu pattern): only the current
    // account + the "Manage your Oxy account" button are shown; the rest of the
    // list is hidden behind the expand chevron.
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage your Oxy account' })).toBeTruthy();
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.queryByText('Add another account')).toBeNull();

    // Tapping the current-account row expands the full list.
    fireEvent.click(screen.getByRole('button', { name: 'Alice' }));

    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Add another account')).toBeTruthy();
    // The current account is repeated first in the expanded list (checked row).
    expect(screen.getAllByText('Alice')).toHaveLength(2);
  });

  it('routes manage and add-account to registered consumer hooks', () => {
    const onNavigateManage = jest.fn();
    const onAddAccount = jest.fn();
    registerAccountDialogConsumerHooks({ onNavigateManage, onAddAccount });

    snapshot = makeSnapshot({
      activeAccountId: 'a',
      accounts: [
        makeAccount({ accountId: 'a', displayName: 'Alice', isCurrent: true, sessionId: 's-a' }),
        makeAccount({ accountId: 'b', displayName: 'Bob', sessionId: 's-b' }),
      ],
    });

    render(<OxyAuthChooser />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage your Oxy account' }));
    expect(onNavigateManage).toHaveBeenCalledTimes(1);
    expect(showBottomSheet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Alice' }));
    fireEvent.click(screen.getByText('Add another account'));
    expect(onAddAccount).toHaveBeenCalledTimes(1);
    expect(controller.add).not.toHaveBeenCalled();
  });

  it('toasts a failed account switch instead of rendering an inline banner', async () => {
    snapshot = makeSnapshot({
      activeAccountId: 'a',
      accounts: [
        makeAccount({ accountId: 'a', displayName: 'Alice', isCurrent: true, sessionId: 's-a' }),
        makeAccount({ accountId: 'b', displayName: 'Bob', sessionId: 's-b' }),
      ],
    });
    // `switchTo` never throws — it records the failure on the controller's
    // snapshot, which the chooser reads back at the point the switch settles.
    controller.switchTo.mockImplementationOnce(async () => {
      snapshot = makeSnapshot({ ...snapshot, error: 'Account switch did not return a valid session' });
    });

    render(<OxyAuthChooser />);
    // Expand the switcher first — the other accounts are collapsed by default.
    fireEvent.click(screen.getByRole('button', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'There was a problem switching accounts. Please try again.',
      ),
    );
    // The failure is a toast — never inline text (neither the friendly copy nor
    // the raw controller error string is painted in the dialog body), and the
    // success side effects never run.
    expect(screen.queryByText('There was a problem switching accounts. Please try again.')).toBeNull();
    expect(screen.queryByText('Account switch did not return a valid session')).toBeNull();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('does not render an inline error banner in the accounts or sign-in views (errors go to toasts)', () => {
    isWebBrowserMock.mockReturnValue(false); // stay on signin, no auto-start to qr
    snapshot = makeSnapshot({ view: 'signin', error: 'Something went wrong.' });

    render(<OxyAuthChooser />);

    // A `snapshot.error` no longer paints an inline banner anywhere — the
    // account-switch failure it represents is surfaced as a toast at the call site.
    expect(screen.queryByText('Something went wrong.')).toBeNull();
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
    // Expand the switcher first — the other accounts are collapsed by default.
    fireEvent.click(screen.getByRole('button', { name: 'Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }));

    await waitFor(() => expect(controller.switchTo).toHaveBeenCalledWith('b'));
    expect(invalidateQueries).toHaveBeenCalled();
    // A successful switch fires no error toast.
    expect(toast.error).not.toHaveBeenCalled();
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

    it('toasts a sign-in device-flow failure instead of rendering inline error copy', async () => {
      snapshot = makeSnapshot({
        view: 'qr',
        signIn: {
          phase: 'error',
          authorizeCode: null,
          qrPayload: null,
          expiresAt: null,
          error: 'Sign-in was cancelled.',
        },
      });

      render(<OxyAuthChooser />);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Sign-in was cancelled.'),
      );
      expect(screen.queryByText('Sign-in was cancelled.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
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

    it('toasts the ceremony error (never inline) when the direct passkey sign-in fails', async () => {
      signInWithPasskey.mockRejectedValueOnce(new Error('The passkey request was cancelled.'));
      snapshot = qrSnapshot();
      render(<OxyAuthChooser />);

      fireEvent.click(screen.getByTestId('passkey-signin-link'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('The passkey request was cancelled.'),
      );
      // The QR view keeps its own state; the failure never renders inline.
      expect(screen.queryByText('The passkey request was cancelled.')).toBeNull();
    });

    it('still offers the link on a non-Oxy origin, alongside the QR (b2 hub popup)', () => {
      isOxyRpOriginMock.mockReturnValue(false);
      snapshot = qrSnapshot();
      render(<OxyAuthChooser />);

      expect(screen.getByTestId('qrcode')).toBeTruthy();
      expect(screen.getByTestId('passkey-signin-link')).toBeTruthy();
    });

    it('drives controller.startPasskeyHubSignIn (not the direct ceremony) on a non-Oxy origin', () => {
      isOxyRpOriginMock.mockReturnValue(false);
      snapshot = qrSnapshot();
      render(<OxyAuthChooser />);

      fireEvent.click(screen.getByTestId('passkey-signin-link'));

      expect(controller.startPasskeyHubSignIn).toHaveBeenCalledTimes(1);
      expect(signInWithPasskey).not.toHaveBeenCalled();
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

    it('toasts (never inline) when the username-availability check fails', async () => {
      checkUsernameAvailability.mockRejectedValueOnce(new Error('network'));
      snapshot = makeSnapshot({ view: 'signup' });
      render(<OxyAuthChooser />);

      fireEvent.change(screen.getByTestId('signup-username-input'), { target: { value: 'newuser' } });

      await waitFor(
        () => expect(toast.error).toHaveBeenCalledWith('Could not check availability'),
        { timeout: 1000 },
      );
      // The availability indicator (checking/available/taken) stays inline; only
      // the network ERROR moves to a toast — no inline error text is painted.
      expect(screen.queryByText('Could not check availability')).toBeNull();
    });

    it('toasts when passkey account creation fails (after the username resolves available)', async () => {
      registerWithPasskey.mockRejectedValueOnce(new Error('Passkey attestation rejected.'));
      snapshot = makeSnapshot({ view: 'signup' });
      render(<OxyAuthChooser />);

      fireEvent.change(screen.getByTestId('signup-username-input'), { target: { value: 'newuser' } });
      await waitFor(
        () => expect((screen.getByTestId('signup-create-button') as HTMLButtonElement).disabled).toBe(false),
        { timeout: 1000 },
      );

      fireEvent.click(screen.getByTestId('signup-create-button'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Passkey attestation rejected.'));
    });

    it('offers the auth.oxy.so hub popup (b2) on a non-Oxy web origin, instead of the direct passkey form', () => {
      isOxyRpOriginMock.mockReturnValue(false);
      snapshot = makeSnapshot({ view: 'signup' });
      render(<OxyAuthChooser />);

      expect(screen.queryByTestId('signup-username-input')).toBeNull();
      const button = screen.getByRole('button', { name: 'Continue in a new window' });
      fireEvent.click(button);
      expect(controller.startPasskeyHubSignIn).toHaveBeenCalledTimes(1);
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

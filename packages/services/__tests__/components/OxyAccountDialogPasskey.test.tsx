/**
 * `OxyAccountDialog` — the "Sign in with a passkey" button gating.
 *
 * The button is offered ONLY on a first-party Oxy web origin
 * (`isWebBrowser() && isOxyRpOrigin()`); on a non-Oxy web origin or on native it
 * is hidden entirely. When shown, a press drives `useOxy().signInWithPasskey()`
 * and — on success — closes the dialog. These tests toggle the two gate probes
 * directly rather than depending on the jsdom URL.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AccountDialogSnapshot } from '@oxyhq/core';

const signInWithPasskey = jest.fn(async () => undefined);
const closeAccountDialog = jest.fn();

const signInSnapshot: AccountDialogSnapshot = {
  view: 'signin',
  accounts: [],
  activeAccountId: null,
  loading: false,
  error: null,
  switchingAccountId: null,
  signIn: { phase: 'idle', authorizeCode: null, qrPayload: null, expiresAt: null, error: null },
};

const controller = {
  subscribe: (_l: () => void) => () => undefined,
  getSnapshot: () => signInSnapshot,
  switchTo: jest.fn(async () => undefined),
  add: jest.fn(),
  showQr: jest.fn(),
  signInWithOxy: jest.fn(),
  setView: jest.fn(),
  cancelSignIn: jest.fn(),
  openPasswordAtOxyAuth: jest.fn(() => 'https://auth.oxy.so/login'),
};

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    accountDialogController: controller,
    isAccountDialogOpen: true,
    closeAccountDialog,
    showBottomSheet: jest.fn(),
    logoutAll: jest.fn(async () => undefined),
    refreshAccounts: jest.fn(async () => undefined),
    signInWithPasskey,
  }),
}));

jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({ t: () => '', locale: 'en' }),
}));

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
jest.mock('@expo/vector-icons', () => ({ __esModule: true, MaterialCommunityIcons: () => null }));
jest.mock('../../src/ui/components/logo/LogoIcon', () => ({ LogoIcon: () => null }));

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
import OxyAccountDialog from '../../src/ui/components/OxyAccountDialog';

describe('OxyAccountDialog — passkey button gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isWebBrowserMock.mockReturnValue(true);
    isOxyRpOriginMock.mockReturnValue(true);
  });

  it('renders the passkey button on a first-party Oxy web origin', () => {
    render(<OxyAccountDialog />);

    const button = screen.getByTestId('passkey-signin-button');
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('Sign in with a passkey');
    // The primary device flow is still present.
    expect(screen.getByRole('button', { name: 'Sign in with Oxy' })).toBeTruthy();
  });

  it('drives signInWithPasskey and closes the dialog on a successful press', async () => {
    render(<OxyAccountDialog />);

    fireEvent.click(screen.getByTestId('passkey-signin-button'));

    await waitFor(() => expect(signInWithPasskey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(closeAccountDialog).toHaveBeenCalledTimes(1));
  });

  it('hides the passkey button on a non-Oxy web origin', () => {
    isOxyRpOriginMock.mockReturnValue(false);

    render(<OxyAccountDialog />);

    expect(screen.queryByTestId('passkey-signin-button')).toBeNull();
    // Sign-in itself is unaffected — only the passkey affordance is gated.
    expect(screen.getByRole('button', { name: 'Sign in with Oxy' })).toBeTruthy();
  });

  it('hides the passkey button on native (not a web browser)', () => {
    isWebBrowserMock.mockReturnValue(false);

    render(<OxyAccountDialog />);

    expect(screen.queryByTestId('passkey-signin-button')).toBeNull();
  });
});

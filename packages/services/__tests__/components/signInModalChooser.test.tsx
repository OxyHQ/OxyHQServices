/**
 * `SignInModal` v2 — the account-chooser phase.
 *
 * When the device/user already has accounts the modal opens on the Google-style
 * chooser (pick an account → `switchToAccount`); with no accounts it opens
 * straight on the sign-in options (password form). The heavy device-flow /
 * password hooks are stubbed so these tests isolate the phase decision + the
 * chooser→`switchToAccount` wiring.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { SwitchableAccount } from '../../src/ui/hooks/useSwitchableAccounts';

const switchToAccount = jest.fn(async () => undefined);

let mockAccounts: SwitchableAccount[] = [];

jest.mock('../../src/ui/hooks/useSwitchableAccounts', () => ({
  __esModule: true,
  useSwitchableAccounts: () => ({ accounts: mockAccounts, isLoading: false, currentSessionId: 's1' }),
}));

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    oxyServices: {},
    handleWebSession: jest.fn(),
    clientId: 'oxy_dk_test',
    switchToAccount,
  }),
}));

jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({ t: (key: string) => key, locale: 'en' }),
}));

jest.mock('../../src/ui/hooks/useOxyAuthSession', () => ({
  __esModule: true,
  OXY_ACCOUNTS_WEB_URL: 'https://accounts.oxy.so',
  useOxyAuthSession: () => ({
    qrData: '',
    qrPayload: null,
    isLoading: false,
    error: null,
    isWaiting: false,
    openSameDeviceApproval: jest.fn(),
    retry: jest.fn(),
  }),
}));

const passwordState = {
  step: 'identifier' as const,
  identifier: '',
  setIdentifier: jest.fn(),
  password: '',
  setPassword: jest.fn(),
  code: '',
  setCode: jest.fn(),
  useBackupCode: false,
  setUseBackupCode: jest.fn(),
  error: null,
  isSubmitting: false,
  submitIdentifier: jest.fn(),
  submitPassword: jest.fn(),
  submitTwoFactor: jest.fn(),
  back: jest.fn(),
  reset: jest.fn(),
};

jest.mock('../../src/ui/hooks/usePasswordSignIn', () => ({
  __esModule: true,
  usePasswordSignIn: () => passwordState,
}));

jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({ __esModule: true, Ionicons: () => null }));
jest.mock('../../src/ui/components/Avatar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/ui/components/OxyLogo', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/ui/components/AnotherDeviceQR', () => ({ __esModule: true, default: () => null }));

jest.mock('@oxyhq/core', () => ({
  __esModule: true,
  isDev: () => false,
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line import/first
import SignInModal, { showSignInModal, hideSignInModal } from '../../src/ui/components/SignInModal';

const account = (over: Partial<SwitchableAccount> & Pick<SwitchableAccount, 'accountId'>): SwitchableAccount => ({
  isCurrent: false,
  onDevice: true,
  displayName: over.accountId,
  email: null,
  color: null,
  user: { id: over.accountId, username: over.accountId, name: {} } as SwitchableAccount['user'],
  ...over,
});

describe('SignInModal — account chooser phase', () => {
  beforeEach(() => {
    switchToAccount.mockClear();
    mockAccounts = [];
    hideSignInModal();
  });

  it('renders the account chooser when accounts exist (not the sign-in form)', () => {
    mockAccounts = [
      account({ accountId: 'u1', displayName: 'Alice', isCurrent: true }),
      account({ accountId: 'u2', displayName: 'Bob' }),
    ];
    render(<SignInModal />);
    act(() => showSignInModal());

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Use another account')).toBeTruthy();
    // The password form is NOT shown while the chooser is up.
    expect(screen.queryByPlaceholderText('Username or email')).toBeNull();
  });

  it('switches into a non-current account via switchToAccount when its row is tapped', async () => {
    mockAccounts = [
      account({ accountId: 'u1', displayName: 'Alice', isCurrent: true }),
      account({ accountId: 'u2', displayName: 'Bob' }),
    ];
    render(<SignInModal />);
    act(() => showSignInModal());

    fireEvent.click(screen.getByText('Bob'));
    await waitFor(() => expect(switchToAccount).toHaveBeenCalledWith('u2'));
  });

  it('falls through to the sign-in options when there are no accounts', () => {
    mockAccounts = [];
    render(<SignInModal />);
    act(() => showSignInModal());

    // The password identifier field is the entry point of the options phase.
    expect(screen.getByPlaceholderText('Username or email')).toBeTruthy();
    expect(screen.queryByText('Use another account')).toBeNull();
  });

  it('reveals the sign-in options when "Use another account" is tapped', () => {
    mockAccounts = [account({ accountId: 'u1', displayName: 'Alice', isCurrent: true })];
    render(<SignInModal />);
    act(() => showSignInModal());

    expect(screen.queryByPlaceholderText('Username or email')).toBeNull();
    fireEvent.click(screen.getByText('Use another account'));
    expect(screen.getByPlaceholderText('Username or email')).toBeTruthy();
  });
});

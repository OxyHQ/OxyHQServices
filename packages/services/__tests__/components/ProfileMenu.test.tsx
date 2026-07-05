/**
 * Tests for `ProfileMenu` — the sidebar-footer account switcher.
 *
 * Post-unification `ProfileMenu` lists EVERY switchable account from
 * `useSwitchableAccounts()` — device sign-ins AND linked graph accounts (owned
 * orgs + shared-with-you) — and routes EVERY switch through the context's
 * single `switchToAccount(accountId)` dispatcher. There is no separate
 * device-only (`switchSession`) path: an on-device row and a linked-not-on-device
 * row both switch the same way.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SwitchableAccount } from '../../src/ui/hooks/useSwitchableAccounts';

const switchToAccount = jest.fn(async () => undefined);
const removeSession = jest.fn(async () => undefined);
const logoutAll = jest.fn(async () => undefined);

let mockAccounts: SwitchableAccount[] = [];

jest.mock('../../src/ui/hooks/useSwitchableAccounts', () => ({
  __esModule: true,
  useSwitchableAccounts: () => ({
    accounts: mockAccounts,
    isLoading: false,
    currentSessionId: 's1',
  }),
}));

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    activeSessionId: 's1',
    switchToAccount,
    logoutAll,
    removeSession,
  }),
}));

jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({ t: (key: string) => key, locale: 'en' }),
}));

jest.mock('@oxyhq/core', () => ({
  __esModule: true,
  isDev: () => false,
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  __esModule: true,
  MaterialCommunityIcons: () => null,
}));

// eslint-disable-next-line import/first
import ProfileMenu from '../../src/ui/components/ProfileMenu';

const row = (over: Partial<SwitchableAccount> & Pick<SwitchableAccount, 'accountId'>): SwitchableAccount => ({
  isCurrent: false,
  onDevice: false,
  displayName: over.accountId,
  email: null,
  color: null,
  user: { id: over.accountId, username: over.accountId, name: {} } as SwitchableAccount['user'],
  ...over,
});

const ALICE = row({
  accountId: 'u1',
  sessionId: 's1',
  onDevice: true,
  isCurrent: true,
  relationship: 'self',
  displayName: 'Alice A',
  email: 'alice@test.com',
});

const BOB = row({
  accountId: 'u2',
  sessionId: 's2',
  onDevice: true,
  isCurrent: false,
  displayName: 'Bob B',
  email: 'bob@test.com',
});

const ACME = row({
  accountId: 'org1',
  onDevice: false,
  isCurrent: false,
  relationship: 'owner',
  kind: 'organization',
  displayName: 'Acme Inc',
  email: '@acme',
});

const noop = () => undefined;

const renderMenu = () =>
  render(
    <ProfileMenu
      open
      onClose={noop}
      onNavigateManage={noop}
      onAddAccount={noop}
    />,
  );

describe('ProfileMenu — unified switchable accounts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [ALICE, BOB, ACME];
  });

  it('renders BOTH device sign-ins and a linked-not-on-device account', () => {
    renderMenu();
    expect(screen.getByText('Alice A')).toBeTruthy();
    expect(screen.getByText('Bob B')).toBeTruthy();
    // The owned-org account is NOT a device session — it must still appear.
    expect(screen.getByText('Acme Inc')).toBeTruthy();
  });

  it('switches a LINKED (not-on-device) account through switchToAccount(accountId)', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Acme Inc'));
    await waitFor(() => expect(switchToAccount).toHaveBeenCalledWith('org1'));
  });

  it('switches an ON-DEVICE account through the SAME switchToAccount path', async () => {
    renderMenu();
    fireEvent.click(screen.getByText('Bob B'));
    await waitFor(() => expect(switchToAccount).toHaveBeenCalledWith('u2'));
  });

  it('does not switch when the active account row is pressed', () => {
    renderMenu();
    fireEvent.click(screen.getByText('Alice A'));
    expect(switchToAccount).not.toHaveBeenCalled();
  });
});

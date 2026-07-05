/**
 * `SignInAccountChooser` — the Google-style account chooser rendered as the
 * front screen of the sign-in surfaces. Presentational: given the switchable
 * accounts it lists a row per account (current one flagged "Signed in") plus a
 * "Use another account" affordance, and reports selections to its callbacks.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import type { SwitchableAccount } from '../../src/ui/hooks/useSwitchableAccounts';

jest.mock('@expo/vector-icons', () => ({
  __esModule: true,
  Ionicons: () => null,
}));

jest.mock('../../src/ui/components/Avatar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const map: Record<string, string> = {
        'signin.chooser.signedIn': 'Signed in',
        'signin.chooser.useAnother': 'Use another account',
        'signin.chooser.continueAs': `Continue as ${vars?.name ?? ''}`,
      };
      return map[key] ?? key;
    },
    locale: 'en',
  }),
}));

// eslint-disable-next-line import/first
import SignInAccountChooser from '../../src/ui/components/SignInAccountChooser';

const row = (over: Partial<SwitchableAccount> & Pick<SwitchableAccount, 'accountId'>): SwitchableAccount => ({
  isCurrent: false,
  onDevice: true,
  displayName: over.accountId,
  email: null,
  color: null,
  user: { id: over.accountId, username: over.accountId, name: {} } as SwitchableAccount['user'],
  ...over,
});

const ALICE = row({ accountId: 'u1', displayName: 'Alice', email: 'alice@oxy.so', isCurrent: true });
const BOB = row({ accountId: 'u2', displayName: 'Bob', email: 'bob@oxy.so' });

describe('SignInAccountChooser', () => {
  it('renders a row per account with the current one flagged, plus "Use another account"', () => {
    render(
      <SignInAccountChooser
        accounts={[ALICE, BOB]}
        onSelectAccount={jest.fn()}
        onUseAnother={jest.fn()}
      />,
    );

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('alice@oxy.so')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    // The active account carries the "Signed in" indicator; a non-current one does not.
    expect(screen.getByText('Signed in')).toBeTruthy();
    expect(screen.getByText('Use another account')).toBeTruthy();
  });

  it('calls onSelectAccount with the tapped account', () => {
    const onSelectAccount = jest.fn();
    render(
      <SignInAccountChooser
        accounts={[ALICE, BOB]}
        onSelectAccount={onSelectAccount}
        onUseAnother={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Bob'));
    expect(onSelectAccount).toHaveBeenCalledTimes(1);
    expect(onSelectAccount).toHaveBeenCalledWith(BOB);
  });

  it('calls onUseAnother when "Use another account" is tapped', () => {
    const onUseAnother = jest.fn();
    render(
      <SignInAccountChooser
        accounts={[ALICE]}
        onSelectAccount={jest.fn()}
        onUseAnother={onUseAnother}
      />,
    );

    fireEvent.click(screen.getByText('Use another account'));
    expect(onUseAnother).toHaveBeenCalledTimes(1);
  });
});

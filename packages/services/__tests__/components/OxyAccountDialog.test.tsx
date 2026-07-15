/**
 * `OxyAccountDialog` — the Bloom `<Dialog>` chrome around `OxyAuthChooser`.
 *
 * `OxyAuthChooser` (mocked here — its own behavior is unit-tested in
 * `OxyAuthChooser.test.tsx`) owns every view's actual content; this file only
 * covers what `OxyAccountDialog` itself is responsible for: the header
 * title/subtitle per `snapshot.view`, and the back-button visibility.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import type { AccountDialogSnapshot } from '@oxyhq/core';

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
const setView = jest.fn();
const controller = {
  subscribe: (_l: () => void) => () => undefined,
  getSnapshot: () => snapshot,
  setView,
};

const closeAccountDialog = jest.fn();

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    accountDialogController: controller,
    isAccountDialogOpen: true,
    closeAccountDialog,
  }),
}));

jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({ t: () => '', locale: 'en' }),
}));

jest.mock('@expo/vector-icons', () => ({ __esModule: true, MaterialCommunityIcons: () => null }));
jest.mock('../../src/ui/components/logo/LogoIcon', () => ({ LogoIcon: () => null }));
jest.mock('../../src/ui/components/OxyAuthChooser', () => ({
  __esModule: true,
  default: () => null,
}));

// eslint-disable-next-line import/first
import OxyAccountDialog from '../../src/ui/components/OxyAccountDialog';

describe('OxyAccountDialog — chrome', () => {
  beforeEach(() => {
    snapshot = makeSnapshot();
    jest.clearAllMocks();
  });

  it('shows the accounts title with no back button in the accounts view', () => {
    render(<OxyAccountDialog />);

    expect(screen.getByText('Your accounts')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('shows the create-account title in the signup view', () => {
    snapshot = makeSnapshot({ view: 'signup' });
    render(<OxyAccountDialog />);

    expect(screen.getByText('Create your account')).toBeTruthy();
  });

  it('shows a back button in the qr view', () => {
    snapshot = makeSnapshot({ view: 'qr' });
    render(<OxyAccountDialog />);

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('shows a back button in the signup view', () => {
    snapshot = makeSnapshot({ view: 'signup' });
    render(<OxyAccountDialog />);

    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('returns to the accounts view on back', () => {
    snapshot = makeSnapshot({ view: 'qr' });
    render(<OxyAccountDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(setView).toHaveBeenCalledWith('accounts');
  });

  it('hides the back button in the sign-in entry with no accounts yet', () => {
    snapshot = makeSnapshot({ view: 'add', accounts: [] });
    render(<OxyAccountDialog />);

    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

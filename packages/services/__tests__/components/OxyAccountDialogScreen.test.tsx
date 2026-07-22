/**
 * `OxyAccountDialogScreen` — the account dialog body around `OxyAuthChooser`.
 *
 * `OxyAuthChooser` (mocked here — its own behavior is unit-tested in
 * `OxyAuthChooser.test.tsx`) owns every view's actual content. This screen no
 * longer renders its own header: it declares the per-view title/subtitle + a
 * per-view back through the SHARED Dialog nav header via `useSurfaceHeader`. So
 * these tests assert the header CONFIG the screen contributes per `snapshot.view`
 * (not rendered DOM — the nav bar is the Dialog's, covered by Bloom).
 */

import { render } from '@testing-library/react';
import type { AccountDialogSnapshot } from '@oxyhq/core';
import type { SurfaceHeaderContent } from '../../src/ui/hooks/useSurfaceHeader';

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

// Capture the header config the screen contributes to the Dialog nav header.
const mockUseSurfaceHeader = jest.fn();
jest.mock('../../src/ui/hooks/useSurfaceHeader', () => ({
  __esModule: true,
  useSurfaceHeader: (content: SurfaceHeaderContent | null | undefined) =>
    mockUseSurfaceHeader(content),
}));

jest.mock('../../src/ui/components/OxyAuthChooser', () => ({
  __esModule: true,
  default: () => null,
}));

// eslint-disable-next-line import/first
import OxyAccountDialogScreen from '../../src/ui/components/OxyAccountDialogScreen';

/** The most recent header config the screen contributed. */
const lastHeader = (): SurfaceHeaderContent | null | undefined =>
  mockUseSurfaceHeader.mock.calls.at(-1)?.[0];

describe('OxyAccountDialogScreen — shared nav header', () => {
  beforeEach(() => {
    snapshot = makeSnapshot();
    jest.clearAllMocks();
  });

  it('contributes the accounts title with no back in the accounts view', () => {
    render(<OxyAccountDialogScreen />);

    expect(lastHeader()?.title).toBe('Your accounts');
    expect(lastHeader()?.onBack).toBeUndefined();
  });

  it('contributes the create-account title in the signup view', () => {
    snapshot = makeSnapshot({ view: 'signup' });
    render(<OxyAccountDialogScreen />);

    expect(lastHeader()?.title).toBe('Create your account');
  });

  it('contributes a back handler in the qr view', () => {
    snapshot = makeSnapshot({ view: 'qr' });
    render(<OxyAccountDialogScreen />);

    expect(typeof lastHeader()?.onBack).toBe('function');
  });

  it('contributes a back handler in the signup view', () => {
    snapshot = makeSnapshot({ view: 'signup' });
    render(<OxyAccountDialogScreen />);

    expect(typeof lastHeader()?.onBack).toBe('function');
  });

  it('the back handler returns to the accounts view', () => {
    snapshot = makeSnapshot({ view: 'qr' });
    render(<OxyAccountDialogScreen />);

    lastHeader()?.onBack?.();
    expect(setView).toHaveBeenCalledWith('accounts');
  });

  it('contributes no back handler in the sign-in entry with no accounts yet', () => {
    snapshot = makeSnapshot({ view: 'add', accounts: [] });
    render(<OxyAccountDialogScreen />);

    expect(lastHeader()?.onBack).toBeUndefined();
  });
});

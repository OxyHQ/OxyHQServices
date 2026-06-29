/**
 * SignInModal cross-apex gating.
 *
 * On a cross-apex web RP only the "Continue with Oxy" IdP popup establishes a
 * durable `fedcm_session`. The Commons-app handoffs — the "Sign in with the Oxy
 * app" same-device deep-link and the "sign in on another device" QR — are
 * approved outside the browser and plant no `fedcm_session`, so they would be
 * lost on reload. The modal must hide both on a cross-apex RP while keeping the
 * primary "Continue with Oxy" action, and must keep all three on same-apex.
 *
 * The host primitives, theme, reanimated, safe-area, the data hook, and the
 * cross-apex predicate are mocked locally so the test asserts only the modal's
 * conditional wiring (the predicate's host→boolean logic is covered by
 * `utils/crossApex.test.ts`).
 */

import { createElement, type ReactNode } from 'react';
import { render, screen, act } from '@testing-library/react';

// --- Local host + platform mocks (style/RN-only props stripped for jsdom) ----
jest.mock('react-native', () => {
  const React = require('react');
  const host =
    (tag: string) =>
    ({ children, onPress, testID, accessibilityLabel }: Record<string, unknown>) =>
      React.createElement(
        tag,
        {
          onClick: onPress as (() => void) | undefined,
          'data-testid': testID as string | undefined,
          'aria-label': accessibilityLabel as string | undefined,
        },
        children as ReactNode,
      );
  return {
    __esModule: true,
    View: host('div'),
    Text: host('span'),
    TouchableOpacity: host('button'),
    Modal: ({ children, visible }: { children?: ReactNode; visible?: boolean }) =>
      visible === false ? null : React.createElement('div', { 'data-testid': 'modal' }, children),
    StyleSheet: { create: <T,>(s: T): T => s, absoluteFill: {} },
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
  };
});

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: { View: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children) },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../src/ui/components/OxyLogo', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../src/ui/components/AnotherDeviceQR', () => ({
  __esModule: true,
  default: () => {
    const React = require('react');
    return React.createElement('span', { 'data-testid': 'another-device-qr' }, 'QR');
  },
}));

jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({ oxyServices: {}, switchSession: jest.fn(), clientId: 'oxy_dk_test' }),
}));

const authSession = {
  qrData: 'oxyauth://token',
  qrPayload: 'oxycommons://approve?v=1&code=abc',
  authorizeCode: 'abc',
  isLoading: false,
  error: null,
  isWaiting: false,
  openAuthApproval: jest.fn(),
  openSameDeviceApproval: jest.fn(),
  retry: jest.fn(),
  cleanup: jest.fn(),
};
jest.mock('../../src/ui/hooks/useOxyAuthSession', () => ({
  __esModule: true,
  OXY_ACCOUNTS_WEB_URL: 'https://accounts.oxy.so',
  useOxyAuthSession: () => authSession,
}));

const isCrossApexWebMock = jest.fn();
jest.mock('../../src/utils/crossApex', () => ({
  __esModule: true,
  isCrossApexWeb: () => isCrossApexWebMock(),
}));

import SignInModal, { showSignInModal, hideSignInModal } from '../../src/ui/components/SignInModal';

function renderModal() {
  const result = render(createElement(SignInModal));
  act(() => {
    showSignInModal();
  });
  return result;
}

describe('SignInModal cross-apex gating', () => {
  afterEach(() => {
    act(() => {
      hideSignInModal();
    });
    jest.clearAllMocks();
  });

  it('on a cross-apex RP shows only "Continue with Oxy" and hides the Commons handoffs', () => {
    isCrossApexWebMock.mockReturnValue(true);
    renderModal();

    expect(screen.getByText('Continue with Oxy')).toBeTruthy();
    expect(screen.queryByText('Sign in with the Oxy app')).toBeNull();
    expect(screen.queryByTestId('another-device-qr')).toBeNull();
  });

  it('on a same-apex RP keeps the same-device deep-link and the QR disclosure', () => {
    isCrossApexWebMock.mockReturnValue(false);
    renderModal();

    expect(screen.getByText('Continue with Oxy')).toBeTruthy();
    expect(screen.getByText('Sign in with the Oxy app')).toBeTruthy();
    expect(screen.getByTestId('another-device-qr')).toBeTruthy();
  });
});

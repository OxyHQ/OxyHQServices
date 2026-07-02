import React from 'react';

/**
 * Lightweight React Native stub for the services jest environment (jsdom).
 *
 * Mirrors the shape used at runtime closely enough that hooks under test
 * which only touch `Platform.OS`, `Platform.select`, `Dimensions`, and
 * `StyleSheet.create` keep working without dragging the full RN runtime
 * into the test bundle.
 */

type PlatformOS = 'ios' | 'android' | 'web' | 'windows' | 'macos';

export const Platform: {
  OS: PlatformOS;
  select: <T>(obj: Partial<Record<PlatformOS | 'default' | 'native', T>>) => T | undefined;
  Version: number;
} = {
  OS: 'web',
  select: (obj) => {
    const os = Platform.OS;
    if (os in obj) return obj[os];
    if (os !== 'web' && 'native' in obj) return obj.native;
    return obj.default;
  },
  Version: 17,
};

export const Dimensions = {
  get: () => ({ width: 375, height: 667, scale: 1, fontScale: 1 }),
  addEventListener: () => ({ remove: () => undefined }),
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: <T>(style: T): T => style,
  hairlineWidth: 1,
  absoluteFillObject: {},
};

export const Appearance = {
  getColorScheme: () => 'light',
  addChangeListener: () => ({ remove: () => undefined }),
};

/**
 * Minimal `AppState` stub. The in-session token-refresh scheduler subscribes to
 * `AppState.addEventListener('change', …)` on the NATIVE branch to refresh on
 * app-foreground; tests that force the native branch (mocking `isWebBrowser` →
 * false) need this present so the subscription + `.remove()` cleanup work.
 */
export const AppState: {
  currentState: string;
  addEventListener: (
    type: string,
    handler: (state: string) => void,
  ) => { remove: () => void };
} = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => undefined }),
};

/**
 * Minimal `Linking` stub. `openURL` resolves so deep-link paths
 * (`useOxyAuthSession`'s same-device approval / native redirect handling) can be
 * spied on without a native module. The listener/initial-URL methods are inert
 * (the native deep-link effect is gated off on `Platform.OS === 'web'`, the mock
 * default, so they are rarely reached).
 */
export const Linking = {
  openURL: async (_url: string): Promise<void> => undefined,
  addEventListener: (_event: string, _handler: (event: { url: string }) => void) => ({
    remove: () => undefined,
  }),
  getInitialURL: async (): Promise<string | null> => null,
};

export const TouchableOpacity = ({
  children,
  onPress,
  disabled,
  ...props
}: {
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  [key: string]: unknown;
}) => React.createElement('button', { ...props, disabled, onClick: onPress }, children);

export const Text = ({
  children,
  ...props
}: {
  children?: React.ReactNode;
  [key: string]: unknown;
}) => React.createElement('span', props, children);

export const ActivityIndicator = (props: Record<string, unknown>) =>
  React.createElement('span', { ...props, role: 'status' });

/**
 * Keep only DOM-safe props for the layout-primitive stubs below. RN passes
 * `style` arrays, `hitSlop`/`accessibilityState` objects, `className`, etc. that
 * would warn or throw when spread onto a jsdom host node — forward just the
 * accessibility label (as `aria-label`) and test id.
 */
const domSafeProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (typeof props.accessibilityLabel === 'string') {
    out['aria-label'] = props.accessibilityLabel;
  }
  if (typeof props.testID === 'string') {
    out['data-testid'] = props.testID;
  }
  return out;
};

export const View = ({
  children,
  ...props
}: {
  children?: React.ReactNode;
  [key: string]: unknown;
}) => React.createElement('div', domSafeProps(props), children);

export const ScrollView = ({
  children,
  ...props
}: {
  children?: React.ReactNode;
  [key: string]: unknown;
}) => React.createElement('div', domSafeProps(props), children);

export const Modal = ({
  children,
  visible = true,
  ...props
}: {
  children?: React.ReactNode;
  visible?: boolean;
  [key: string]: unknown;
}) => (visible ? React.createElement('div', domSafeProps(props), children) : null);

export const Pressable = ({
  children,
  onPress,
  disabled,
  ...props
}: {
  children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  onPress?: () => void;
  disabled?: boolean;
  [key: string]: unknown;
}) =>
  React.createElement(
    'button',
    { type: 'button', disabled, onClick: onPress, ...domSafeProps(props) },
    typeof children === 'function' ? children({ pressed: false }) : children,
  );

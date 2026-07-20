/**
 * Lightweight stub for `@oxyhq/bloom` and its subpath exports.
 *
 * Only the symbols actually touched by code under test in the services
 * package are stubbed. Tests that need to assert on toast invocations
 * can spy on the exported `toast` object directly.
 */

import { createElement, Fragment, type ReactNode } from 'react';

type ToastFn = (message: string, options?: Record<string, unknown>) => void;

/**
 * Minimal `@oxyhq/bloom/button` + `@oxyhq/bloom/loading` stubs. All bloom
 * subpaths map to this single file (see `jest.config.js` moduleNameMapper), so
 * components under test that render `<Button>` / `<Loading>` resolve here. The
 * Button forwards `children` (so queries by label work), `onPress` (mapped to
 * `onClick`), `disabled` (a disabled jsdom `<button>` never fires click — so a
 * `disabled` Button is un-pressable in tests), and `testID` (as `data-testid`);
 * other RN-only props are dropped so they do not leak onto the DOM node.
 */
export const Button = ({
  children,
  onPress,
  disabled,
  testID,
}: {
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
} & Record<string, unknown>) =>
  createElement(
    'button',
    { type: 'button', onClick: onPress, disabled, 'data-testid': testID },
    children,
  );

export const Loading = () => createElement('span', null, 'loading');

/**
 * Minimal stubs for the Bloom primitives the account switchers render
 * (`@oxyhq/bloom/avatar`, `@oxyhq/bloom/typography`, `@oxyhq/bloom/divider`, and
 * the root `Dialog` / `useDialogControl`). All bloom subpaths map to this file,
 * so a component under test resolves these names here. `Avatar` renders no text
 * so it never collides with `getByText(displayName)` queries.
 */
export const Avatar = () => createElement('span', { 'aria-hidden': 'true' });

export const Text = ({
  children,
  testID,
}: { children?: ReactNode; testID?: string } & Record<string, unknown>) =>
  createElement('span', { 'data-testid': testID }, children);

export const Divider = () => createElement('hr', null);

/**
 * `@oxyhq/bloom/theme` per-account color-scope stubs used by `OxyAccountDialog`.
 * `BloomColorScope` just renders its children (the real one merges scoped CSS
 * vars); the preset registry is empty so the dialog's accent resolves to the
 * theme fallback in tests.
 */
export const BloomColorScope = ({ children }: { children?: ReactNode }) =>
  createElement('div', null, children);

export const APP_COLOR_NAMES: readonly string[] = [];

export const APP_COLOR_PRESETS: Record<string, { hex: string }> = {};

/**
 * `@oxyhq/bloom/dialog` `<Dialog>` stub. The real component renders its own
 * portal/backdrop chrome; here we only need the controlled `open` gate and the
 * `children` so a component under test (e.g. `OxyAccountDialog`) can be queried
 * for its content. Extra props (`placement`, `onClose`, `dismissOnBackdrop`, …)
 * are ignored.
 */
export const Dialog = ({
  open,
  children,
}: { open?: boolean; children?: ReactNode } & Record<string, unknown>) =>
  open === false ? null : createElement(Fragment, null, children);

export const useDialogControl = (): {
  open: () => void;
  close: () => void;
  isOpen: boolean;
} => ({
  open: jest.fn(),
  close: jest.fn(),
  isOpen: false,
});

export const toast: {
  (message: string, options?: Record<string, unknown>): void;
  success: ToastFn;
  error: ToastFn;
  info: ToastFn;
  warning: ToastFn;
  promise: ToastFn;
  dismiss: () => void;
} = Object.assign(
  jest.fn() as unknown as ToastFn,
  {
    success: jest.fn() as ToastFn,
    error: jest.fn() as ToastFn,
    info: jest.fn() as ToastFn,
    warning: jest.fn() as ToastFn,
    promise: jest.fn() as ToastFn,
    dismiss: jest.fn(),
  },
);

/**
 * Stub for `@oxyhq/bloom/theme`'s `useTheme`. Components under test
 * (`FollowButton`, etc.) only read `colors.*`; return the canonical key set so
 * any themed component renders without dragging in the real theme provider.
 */
export const useTheme = (): { isDark: boolean; colors: Record<string, string> } => ({
  isDark: false,
  colors: {
    primary: '#5e3bff',
    primaryForeground: '#ffffff',
    secondary: '#eeeeee',
    background: '#ffffff',
    backgroundSecondary: '#f5f5f5',
    backgroundTertiary: '#efefef',
    inputBackground: '#f5f5f5',
    text: '#000000',
    textSecondary: '#666666',
    card: '#ffffff',
    border: '#e0e0e0',
    icon: '#666666',
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
});

/** Generic passthrough for Bloom layout primitives not asserted in unit tests. */
const passthrough =
  (tag: string) =>
  ({ children, testID }: { children?: ReactNode; testID?: string } & Record<string, unknown>) =>
    createElement(tag, { 'data-testid': testID }, children);

export const BloomDialogProvider = ({ children }: { children?: ReactNode }) =>
  createElement(Fragment, null, children);

export const ToastOutlet = () => null;

export const PressableScale = passthrough('div');

export const SettingsListGroup = passthrough('div');
export const SettingsListItem = passthrough('div');

export const Switch = ({
  value,
  onValueChange,
  testID,
}: {
  value?: boolean;
  onValueChange?: (next: boolean) => void;
  testID?: string;
} & Record<string, unknown>) =>
  createElement('input', {
    type: 'checkbox',
    role: 'switch',
    checked: value,
    onChange: () => onValueChange?.(!value),
    'data-testid': testID,
  });

export const TextField = passthrough('div');
export const TextFieldInput = passthrough('input');

export const H1 = Text;
export const H4 = Text;
export const H5 = Text;
export const H6 = Text;

export const Chip = passthrough('span');
export const SearchInput = passthrough('input');
export const IconCircle = passthrough('span');
export const BenefitList = passthrough('div');
export const BenefitRow = passthrough('div');
export const Accordion = passthrough('div');
export const AccordionItem = passthrough('div');
export const AccordionTrigger = passthrough('button');
export const AccordionContent = passthrough('div');
export const SegmentedControl = passthrough('div');
export const SegmentedControlItem = passthrough('button');

export default toast;

/**
 * Lightweight stub for `@oxyhq/bloom` and its subpath exports.
 *
 * Only the symbols actually touched by code under test in the services
 * package are stubbed. Tests that need to assert on toast invocations
 * can spy on the exported `toast` object directly.
 */

import { createElement, type ReactNode } from 'react';

type ToastFn = (message: string, options?: Record<string, unknown>) => void;

/**
 * Minimal `@oxyhq/bloom/button` + `@oxyhq/bloom/loading` stubs. All bloom
 * subpaths map to this single file (see `jest.config.js` moduleNameMapper), so
 * components under test that render `<Button>` / `<Loading>` resolve here. The
 * Button forwards `children` (so queries by label work) and `onPress` (mapped to
 * `onClick` for the jsdom host element); other RN-only props are dropped so they
 * do not leak onto the DOM node.
 */
export const Button = ({
  children,
  onPress,
}: {
  children?: ReactNode;
  onPress?: () => void;
} & Record<string, unknown>) =>
  createElement('button', { type: 'button', onClick: onPress }, children);

export const Loading = () => createElement('span', null, 'loading');

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
    text: '#000000',
    textSecondary: '#666666',
    card: '#ffffff',
    border: '#e0e0e0',
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
});

export default toast;

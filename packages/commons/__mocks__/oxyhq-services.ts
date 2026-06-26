/**
 * Lightweight `@oxyhq/services` stub for unit tests in the accounts package.
 *
 * `useOxy()` is implemented with `useSyncExternalStore` so that calls to
 * `__setOxyState({...})` outside of React are immediately reflected in any
 * mounted consumer's next render.
 */

import { useSyncExternalStore } from 'react';

interface MockOxyServices {
  updateProfile?: jest.Mock;
  getCommonsApprovalInfo?: jest.Mock;
  approveCommonsSignIn?: jest.Mock;
  denyCommonsSignIn?: jest.Mock;
  getPublicKey?: jest.Mock;
}

interface MockOxyState {
  user: { username?: string; language?: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  oxyServices: MockOxyServices | null;
}

function makeDefaultState(): MockOxyState {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    oxyServices: { updateProfile: jest.fn(async () => undefined) },
  };
}

let state: MockOxyState = makeDefaultState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function __setOxyState(next: Partial<MockOxyState>): void {
  state = { ...state, ...next };
  emit();
}

export function __resetOxyState(): void {
  state = makeDefaultState();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MockOxyState {
  return state;
}

export const useOxy = (): MockOxyState =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

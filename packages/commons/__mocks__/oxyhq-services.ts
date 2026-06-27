/**
 * Lightweight `@oxyhq/services` stub for unit tests in the Commons package.
 *
 * `useOxy()` is implemented with `useSyncExternalStore` so that calls to
 * `__setOxyState({...})` outside of React are immediately reflected in any
 * mounted consumer's next render. `useOnlineStatus()` is similarly controllable
 * via `__setOnlineStatus(...)`.
 */

import { useSyncExternalStore } from 'react';

interface MockOxyServices {
  updateProfile?: jest.Mock;
  getCommonsApprovalInfo?: jest.Mock;
  approveCommonsSignIn?: jest.Mock;
  denyCommonsSignIn?: jest.Mock;
  getPublicKey?: jest.Mock;
  getPublicCard?: jest.Mock;
  getReputationBalance?: jest.Mock;
  getReputationTransactions?: jest.Mock;
  getFileDownloadUrl?: jest.Mock;
  getCurrentUserId?: jest.Mock;
  getMyIdPayload?: jest.Mock;
  buildAttestQrPayload?: jest.Mock;
  submitRealLifeAttestation?: jest.Mock;
  getValidatorInbox?: jest.Mock;
  submitValidationVote?: jest.Mock;
  denyValidation?: jest.Mock;
  getMyPersonhood?: jest.Mock;
  getPersonhood?: jest.Mock;
  vouchForPerson?: jest.Mock;
  withdrawVouch?: jest.Mock;
  listMyCredentials?: jest.Mock;
  listCredentials?: jest.Mock;
  verifyCredential?: jest.Mock;
  issueCredential?: jest.Mock;
  revokeCredential?: jest.Mock;
}

interface MockOxyState {
  user: { id?: string; username?: string; language?: string; avatar?: string | null } | null;
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

/** Hydration hook — a no-op in tests. */
export const useCurrentUser = (): { data: undefined } => ({ data: undefined });

/* -------------------------------------------------------------------------- */
/*  Online status                                                             */
/* -------------------------------------------------------------------------- */

let online = true;
const onlineListeners = new Set<() => void>();

export function __setOnlineStatus(next: boolean): void {
  online = next;
  for (const fn of onlineListeners) fn();
}

export const useOnlineStatus = (): boolean =>
  useSyncExternalStore(
    (listener: () => void) => {
      onlineListeners.add(listener);
      return () => {
        onlineListeners.delete(listener);
      };
    },
    () => online,
    () => online,
  );

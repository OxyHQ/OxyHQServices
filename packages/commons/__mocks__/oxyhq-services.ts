/**
 * Lightweight `@oxyhq/services` stub for unit tests in the Commons package.
 *
 * `useOxy()` is implemented with `useSyncExternalStore` so that calls to
 * `__setOxyState({...})` outside of React are immediately reflected in any
 * mounted consumer's next render. `useOnlineStatus()` is similarly controllable
 * via `__setOnlineStatus(...)`.
 */

import { useEffect, useSyncExternalStore } from 'react';

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
  getMyNode?: jest.Mock;
  registerNode?: jest.Mock;
  provisionManagedVault?: jest.Mock;
  removeMyNode?: jest.Mock;
  notifyNodeIngest?: jest.Mock;
}

interface MockOxyState {
  user: { id?: string; username?: string; languages?: string[]; avatar?: string | null } | null;
  isAuthenticated: boolean;
  isAuthResolved: boolean;
  isLoading: boolean;
  /** The active UI locale, as the real SDK derives it. */
  currentLanguage: string;
  /** The ordered account locales (primary first), or the single guest locale. */
  currentLanguages: string[];
  oxyServices: MockOxyServices | null;
}

function makeDefaultState(): MockOxyState {
  return {
    user: null,
    isAuthenticated: false,
    // Defaults to `true`: these tests assert the settled onboarding status,
    // i.e. after the SDK's device-first cold boot has concluded. Set it to
    // `false` explicitly to exercise the still-resolving ("checking") window.
    isAuthResolved: true,
    isLoading: false,
    currentLanguage: 'en-US',
    currentLanguages: [],
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

// Guest override writer: stores a single locale and makes it the active locale.
const setLanguage = jest.fn(async (locale: string): Promise<void> => {
  __setOxyState({ currentLanguage: locale, currentLanguages: [locale] });
});

// Account writer: `{ languages }` sets the ordered account locales; the derived
// `currentLanguage` then follows `languages[0]`.
const updateProfileMutateAsync = jest.fn(
  async (updates: { languages?: string[] }): Promise<void> => {
    const languages = updates.languages;
    if (languages && languages.length > 0) {
      __setOxyState({ currentLanguage: languages[0], currentLanguages: languages });
    }
  },
);

export function __resetOxyState(): void {
  state = makeDefaultState();
  setLanguage.mockClear();
  updateProfileMutateAsync.mockClear();
  emit();
  oxyEventHandlers.clear();
}

/** Exposes the locale writer spies for call assertions. */
export function __getLanguageMocks(): {
  setLanguage: jest.Mock;
  updateProfileMutateAsync: jest.Mock;
} {
  return { setLanguage, updateProfileMutateAsync };
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

export const useOxy = (): MockOxyState & { setLanguage: jest.Mock } => {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, setLanguage };
};

export function useUpdateProfile(): { mutateAsync: jest.Mock; isPending: boolean } {
  return { mutateAsync: updateProfileMutateAsync, isPending: false };
}

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

/* -------------------------------------------------------------------------- */
/*  Server-pushed events (useOxyEvent)                                       */
/* -------------------------------------------------------------------------- */

type OxyEventHandler = (payload: unknown) => void;
const oxyEventHandlers = new Map<string, Set<OxyEventHandler>>();

export function useOxyEvent(event: string, handler: OxyEventHandler): void {
  useEffect(() => {
    let set = oxyEventHandlers.get(event);
    if (!set) {
      set = new Set();
      oxyEventHandlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }, [event, handler]);
}

/** Test helper: fire a fake server-pushed event at all registered handlers. */
export function __emitOxyEvent(event: string, payload: unknown): void {
  for (const handler of [...(oxyEventHandlers.get(event) ?? [])]) handler(payload);
}

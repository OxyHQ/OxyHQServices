import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Linking } from 'react-native';
import { OxyServices, oxyClient } from '@oxyhq/core';
import type {
  User,
  ApiError,
  SessionLoginResponse,
  AccountNode,
  CreateAccountInput,
  ClientSession,
  AuthStateStore,
  PersistedAuthState,
  AccountDialogController,
  AccountDialogView,
} from '@oxyhq/core';
import {
  KeyManager,
  runSessionColdBoot,
  installAuthRefreshHandler,
  startTokenRefreshScheduler,
  createAccountDialogController,
  logger as loggerUtil,
} from '@oxyhq/core';
import type { SecurityAlert } from '@oxyhq/contracts';
import {
  registerAccountDialogControls,
  notifyAccountDialogVisibility,
} from '../navigation/accountDialogManager';
import { tryCompleteOAuthReturn } from '../utils/oauthReturn';
import { redirectToAuthorize } from '../components/oauthNavigation';
import { isWebBrowser } from '../utils/isWebBrowser';
import {
  maybeRedirectIdpHandoff,
  isIdpHubOrigin,
} from '../utils/idpHandoffRedirect';
import {
  maybeStartSilentOAuthRestore,
  consumeSilentOAuthError,
} from '../utils/silentOAuthRestore';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import type { UseFollowHook } from '../hooks/useFollow.types';
import { useLanguageManagement } from '../hooks/useLanguageManagement';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useAuthOperations, clearPersistedAuthSafe } from './hooks/useAuthOperations';
import { useDeviceManagement } from '../hooks/useDeviceManagement';
import { getStorageKeys, createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { useQueryClient } from '@tanstack/react-query';
import { clearQueryCache } from '../hooks/queryClient';
import { useAvatarPicker } from '../hooks/useAvatarPicker';
import { useAccountStore } from '../stores/accountStore';
import {
  createSessionClient,
  createPlatformAuthStateStore,
  deviceStateToClientSessions,
  activeSessionIdOf,
  activeUserOf,
  accountIdsOf,
} from '../session';

export interface OxyContextState {
  user: User | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  hasAccessToken: boolean;
  canUsePrivateApi: boolean;
  isPrivateApiPending: boolean;
  /**
   * Whether the initial auth determination has concluded.
   *
   * `false` from mount until the FIRST device-first cold boot resolves —
   * during that window `isAuthenticated: false` is UNDETERMINED, not a
   * definitive "logged out". Flips to `true` exactly once the boot concludes
   * (a session was committed OR none exists) and never reverts. Consumers should
   * defer their first auth-dependent fetch until this is `true` so a cold-boot
   * web reload with an existing session does not fetch anonymous data.
   */
  isAuthResolved: boolean;
  isStorageReady: boolean;
  error: string | null;
  currentLanguage: string;
  currentLanguageMetadata: ReturnType<typeof useLanguageManagement>['metadata'];
  currentLanguageName: string;
  currentNativeLanguageName: string;

  // Identity (cryptographic key pair)
  hasIdentity: () => Promise<boolean>;
  getPublicKey: () => Promise<string | null>;

  // Authentication
  signIn: (publicKey: string, deviceName?: string) => Promise<User>;

  /**
   * Sign in with a username/email + password.
   *
   * Commits a successful session into context state through the SAME path the
   * QR device-flow and cold boot use (so `isAuthenticated` / `user` update and
   * the zero-cookie device credential is persisted). Returns a discriminated result
   * so the caller can branch on the two-factor-required case — which creates NO
   * session; the caller completes the 2FA challenge with the returned
   * `loginToken` via {@link OxyContextState.completeTwoFactorSignIn}.
   */
  signInWithPassword: (
    identifier: string,
    password: string,
    opts?: { deviceName?: string; deviceFingerprint?: string },
  ) => Promise<PasswordSignInResult>;

  /**
   * Complete a 2FA-gated password sign-in started by {@link signInWithPassword}.
   * Presents the short-lived `loginToken` with a TOTP `token` or a `backupCode`;
   * on success the session is committed exactly like a one-step sign-in. Returns
   * any `securityAlert` the server attached so the caller can show the same
   * "New sign-in detected" acknowledgement as the one-step path.
   */
  completeTwoFactorSignIn: (params: {
    loginToken: string;
    token?: string;
    backupCode?: string;
    deviceName?: string;
  }) => Promise<{ securityAlert?: SecurityAlert }>;

  /**
   * Repudiate the sign-in that just committed — the "That wasn't me" response to
   * a server-flagged {@link SecurityAlert}. Revokes the current device session
   * server-side (via the same device-first `POST /session/device/signout` path
   * {@link logout} uses) and, when no other account remains on this device,
   * clears the persisted zero-cookie `{deviceId, deviceSecret}` credential and
   * local session state so the next cold boot finds nothing to restore. Any
   * sibling accounts already signed in on the device are preserved. There is NO
   * dedicated "report suspicious" API endpoint — repudiation IS device-session
   * revocation, so a compromised new sign-in cannot be restored.
   */
  revokeSuspiciousSignIn: () => Promise<void>;

  /**
   * Commit a session obtained out-of-band (the "Sign in with Oxy" QR device
   * flow). Plants tokens, persists the zero-cookie device credential, registers
   * the account into the device set, and hydrates the full user profile.
   */
  handleWebSession: (session: SessionLoginResponse) => Promise<void>;

  // Session management
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<User>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  setLanguage: (languageId: string) => Promise<void>;
  getDeviceSessions: () => Promise<
    Array<{
      sessionId: string;
      deviceId: string;
      deviceName?: string;
      lastActive?: string;
      expiresAt?: string;
    }>
  >;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  clearAllAccountData: () => Promise<void>;
  storageKeyPrefix: string;
  /**
   * The app's Oxy OAuth client id / ApplicationCredential publicKey, as
   * supplied via the `clientId` prop. Required for the cross-app device
   * sign-in flow: the sign-in components send it to
   * `POST /auth/session/create` so the API can identify the requesting app by
   * its real registered client id. `null` when the consuming app did not
   * configure a client id — the device sign-in flow surfaces a configuration
   * error in that case.
   */
  clientId: string | null;
  oxyServices: OxyServices;
  useFollow?: UseFollowHook;
  showBottomSheet?: (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => void;
  openAvatarPicker: () => void;

  // Unified account dialog (the single switcher + sign-in surface). The headless
  // state machine lives in `@oxyhq/core`; `OxyAccountDialog` (mounted by
  // `OxyProvider`) binds to it. `null` in the no-provider loading state.
  /** The headless controller driving {@link openAccountDialog}. `null` before mount. */
  accountDialogController: AccountDialogController | null;
  /** Whether the unified account dialog is currently presented. */
  isAccountDialogOpen: boolean;
  /**
   * Open the unified account dialog. `accounts` (default) shows the switcher;
   * `signin` / `add` open the sign-in entry. Replaces every prior device/account
   * surface and the standalone sign-in modal.
   */
  openAccountDialog: (view?: AccountDialogView) => void;
  /** Dismiss the unified account dialog and cancel any in-flight sign-in flow. */
  closeAccountDialog: () => void;

  // Unified account graph (self, owned orgs/projects/bots, accounts shared with
  // the caller). The cryptographic Commons/DID "identity" is a SEPARATE concept.
  //
  // UX concept: the user picks an account and the WHOLE app becomes that account
  // — a genuine, REAL-SESSION switch (`switchToAccount`), identical to switching
  // between device sign-ins. There is NO separate "active account" concept:
  // `user` IS the active account after a switch.
  /** Every account the caller can access — own personal root, owned, and shared — from `listAccounts()`. */
  accounts: AccountNode[];
  /**
   * Switch the active session INTO an account from the {@link accounts} graph.
   *
   * Uniform with every other account switch: if the account is already on this
   * device's multi-account set, switches straight through the same
   * server-authoritative `SessionClient.switchAccount()` path {@link switchSession}
   * uses. Only the FIRST switch into an account mints+plants a real session via
   * `oxyServices.switchToAccount` and registers it into the device set, so it
   * survives reload and appears in the device account list exactly like a device
   * sign-in from then on. Either way, afterwards `user` IS the target account.
   */
  switchToAccount: (accountId: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  createAccount: (data: CreateAccountInput) => Promise<AccountNode>;
}

const OxyContext = createContext<OxyContextState | null>(null);

/**
 * Result of {@link OxyContextState.signInWithPassword}.
 *
 * `'ok'` — the password was accepted and the session committed (so
 * `isAuthenticated` / `user` are updated and the device credential persisted).
 * `securityAlert` is present when the server flagged this sign-in as anomalous
 * (new device / location) — the caller shows a "New sign-in detected"
 * acknowledgement before proceeding; the session is already committed.
 *
 * `'2fa_required'` — the account has two-factor auth enabled, so NO session was
 * created. Complete the challenge with the returned short-lived `loginToken`
 * via {@link OxyContextState.completeTwoFactorSignIn}.
 */
export type PasswordSignInResult =
  | { status: 'ok'; securityAlert?: SecurityAlert }
  | { status: '2fa_required'; loginToken: string };

export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices?: OxyServices;
  baseURL?: string;
  authWebUrl?: string;
  authRedirectUri?: string;
  storageKeyPrefix?: string;
  /**
   * The app's Oxy OAuth client id / ApplicationCredential publicKey; required
   * for the cross-app device sign-in flow. See {@link OxyContextState.clientId}.
   */
  clientId?: string;
  /**
   * Whether this provider is the device-first **session authority**. `true`
   * (default) runs `runSessionColdBoot` on mount and opens the signed-out
   * device-state socket — the correct behavior for every Relying Party app.
   *
   * `false` is the IdP host (`auth.oxy.so`) opt-out: the IdP is NOT a session
   * authority (handoff "IdP vs RP"), so it must NOT restore or reproject an
   * ambient device session. With `coldBoot={false}` the cold boot never runs
   * and the signed-out device socket never opens; auth resolves immediately as
   * signed out. Interactive sign-in still commits a normal session on this
   * origin — only the automatic restore/reproject is suppressed.
   * @default true
   */
  coldBoot?: boolean;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void;
}

/**
 * Fallback client-session validity window (ms) — 7 days — applied when a
 * committed session does not carry an explicit `expiresAt`. This is only a
 * local display hint for the multi-session store; the server remains the source
 * of truth for actual session expiry.
 */
const DEFAULT_SESSION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long the cold boot WAITS for the post-boot SessionClient handoff
 * (`addCurrentAccount` + `start` + `syncFromClient`) before it resolves auth and
 * stops blocking. Once a boot step planted a token the user is already
 * authenticated — the handoff only populates the multi-account set and the
 * server-authoritative active account, and those also arrive via the socket
 * subscription. So on a slow backend we stop AWAITING the handoff here (it keeps
 * running in the background and projects when it lands) rather than delaying
 * auth resolution.
 */
const SESSION_HANDOFF_DEADLINE = 6000;

/** The internal commit input — a session plus the zero-cookie device credential
 * (`deviceId` + `deviceSecret`) that is not on the public `SessionLoginResponse`.
 * All extras optional so `SessionLoginResponse` is assignable. */
interface CommitInput {
  sessionId: string;
  accessToken?: string;
  deviceId?: string;
  /** Rotating device secret (zero-cookie transport); persisted with `deviceId`
   * so the cold boot can mint via `POST /session/device/token`. */
  deviceSecret?: string;
  expiresAt?: string;
  userId?: string;
  /** Minimal user carried by the sign-in response; a best-effort fallback used
   * only when the full-profile fetch fails. Both `SessionLoginResponse.user`
   * (structured `name`) and the login-result user (`{id, username?, avatar?}`)
   * are assignable. */
  user?: { id: string; username?: string; avatar?: string };
}

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  if ('status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  if ('response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'status' in response) {
      const status = (response as { status?: unknown }).status;
      if (typeof status === 'number') {
        return status;
      }
    }
  }
  return undefined;
}

function isUnauthorizedStatus(error: unknown): boolean {
  return getHttpStatus(error) === 401;
}

let cachedUseFollowHook: UseFollowHook | null = null;

const loadUseFollowHook = (): UseFollowHook => {
  if (cachedUseFollowHook) {
    return cachedUseFollowHook;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useFollow } = require('../hooks/useFollow');
    cachedUseFollowHook = useFollow as UseFollowHook;
    return cachedUseFollowHook;
  } catch (error) {
    if (__DEV__) {
      loggerUtil.warn(
        'useFollow hook is not available. Please import useFollow from @oxyhq/services directly.',
        { component: 'OxyContext', method: 'loadUseFollowHook' },
        error,
      );
    }
    const fallback: UseFollowHook = () => {
      throw new Error('useFollow hook is only available in the UI bundle. Import it from @oxyhq/services.');
    };
    cachedUseFollowHook = fallback;
    return cachedUseFollowHook;
  }
};

export const OxyProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices: providedOxyServices,
  baseURL,
  authWebUrl,
  authRedirectUri,
  storageKeyPrefix = 'oxy_session',
  clientId: clientIdProp,
  coldBoot = true,
  onAuthStateChange,
  onError,
}) => {
  const oxyServicesRef = useRef<OxyServices | null>(null);
  if (!oxyServicesRef.current) {
    if (providedOxyServices) {
      oxyServicesRef.current = providedOxyServices;
    } else if (baseURL) {
      // `authWebUrl` now only points the OAuth "Sign in with Oxy" third-party
      // link builder at the central auth host; there is no cold-boot redirect.
      oxyServicesRef.current = new OxyServices({ baseURL, authWebUrl, authRedirectUri });
    } else {
      throw new Error('Either oxyServices or baseURL must be provided to OxyContextProvider');
    }
  }
  const oxyServices = oxyServicesRef.current;

  // The device-first persisted auth-state store (per-origin zero-cookie device
  // credential on web; SecureStore session blob on native). Built ONCE per
  // provider mount.
  const authStoreRef = useRef<AuthStateStore | null>(null);
  if (!authStoreRef.current) {
    authStoreRef.current = createPlatformAuthStateStore();
  }
  const authStore = authStoreRef.current;

  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    loginSuccess,
    loginFailure,
    logoutStore,
  } = useAuthStore(
    useShallow((state: AuthState) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      error: state.error,
      loginSuccess: state.loginSuccess,
      loginFailure: state.loginFailure,
      logoutStore: state.logout,
    })),
  );

  const [tokenReady, setTokenReady] = useState(true);
  const [hasAccessToken, setHasAccessToken] = useState(() => Boolean(oxyServices.getAccessToken()));
  const [authResolved, setAuthResolved] = useState(false);
  const authResolvedRef = useRef(false);
  const userRef = useRef<User | null>(user);
  const isAuthenticatedRef = useRef(isAuthenticated);
  userRef.current = user;
  isAuthenticatedRef.current = isAuthenticated;
  const [initialized, setInitialized] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const setAuthState = useAuthStore.setState;

  // Keep the shared `oxyClient` singleton's token store in lockstep with the
  // session owned by THIS provider's instance (many apps build API clients
  // against the exported singleton while passing only `baseURL` here). Skipped
  // when the app passed the singleton itself as `oxyServices`.
  useEffect(() => {
    if (oxyServices === oxyClient) {
      return;
    }
    const applyToSingleton = (accessToken: string | null) => {
      if (accessToken) {
        oxyClient.setTokens(accessToken);
      } else {
        oxyClient.clearTokens();
      }
    };
    applyToSingleton(oxyServices.getAccessToken());
    return oxyServices.onTokensChanged(applyToSingleton);
  }, [oxyServices]);

  const logger = useCallback((message: string, err?: unknown) => {
    if (__DEV__) {
      loggerUtil.warn(message, { component: 'OxyContext' }, err);
    }
  }, []);

  const storageKeys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  const clientId = useMemo(() => {
    const trimmed = clientIdProp?.trim();
    return trimmed ? trimmed : null;
  }, [clientIdProp]);

  // Local display/bookkeeping storage (session id list, language). Distinct
  // from `authStore` (the durable credential blob). Exposed as an awaitable so
  // a persistence write is never dropped because it raced storage init.
  const storageRef = useRef<StorageInterface | null>(null);
  const [storage, setStorage] = useState<StorageInterface | null>(null);
  const buildStorageDeferred = () => {
    let resolve: (storage: StorageInterface) => void = () => undefined;
    const promise = new Promise<StorageInterface>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const storageReadyRef = useRef<ReturnType<typeof buildStorageDeferred> | null>(null);
  if (storageReadyRef.current === null) {
    storageReadyRef.current = buildStorageDeferred();
  }
  const storageReady = storageReadyRef.current;

  useEffect(() => {
    let mounted = true;
    createPlatformStorage()
      .then((storageInstance) => {
        storageRef.current = storageInstance;
        storageReady.resolve(storageInstance);
        if (mounted) {
          setStorage(storageInstance);
        }
      })
      .catch((err) => {
        if (mounted) {
          logger('Failed to initialize storage', err);
          onError?.({ message: 'Failed to initialize storage', code: 'STORAGE_INIT_ERROR', status: 500 });
        }
      });
    return () => {
      mounted = false;
    };
  }, [logger, onError, storageReady]);

  const {
    currentLanguage,
    metadata: currentLanguageMetadata,
    languageName: currentLanguageName,
    nativeLanguageName: currentNativeLanguageName,
    setLanguage,
    applyLanguagePreference,
  } = useLanguageManagement({
    storage,
    languageKey: storageKeys.language,
    onError,
    logger,
  });

  const queryClient = useQueryClient();

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    updateSessions,
    switchSession,
    clearSessionState,
    saveActiveSessionId,
  } = useSessionManagement({
    oxyServices,
    storage,
    storageKeyPrefix,
    loginSuccess,
    logoutStore,
    applyLanguagePreference,
    onAuthStateChange,
    onError,
    setAuthError: (message) => setAuthState({ error: message }),
    logger,
    setTokenReady,
    queryClient,
  });

  // Refs so callbacks below can invoke the latest session-management functions
  // without widening dependency arrays.
  const switchSessionRef = useRef(switchSession);
  switchSessionRef.current = switchSession;
  const clearSessionStateRef = useRef(clearSessionState);
  clearSessionStateRef.current = clearSessionState;
  const setActiveSessionIdRef = useRef(setActiveSessionId);
  setActiveSessionIdRef.current = setActiveSessionId;
  const loginSuccessRef = useRef(loginSuccess);
  loginSuccessRef.current = loginSuccess;
  const onAuthStateChangeRef = useRef(onAuthStateChange);
  onAuthStateChangeRef.current = onAuthStateChange;

  // Flip the auth-resolution gate (`authResolved` + `tokenReady`) the moment a
  // session commits or the boot concludes signed out. Idempotent + monotonic.
  const markAuthResolved = useCallback(() => {
    if (authResolvedRef.current) {
      return;
    }
    authResolvedRef.current = true;
    setTokenReady(true);
    setAuthResolved(true);
  }, []);
  const markAuthResolvedRef = useRef(markAuthResolved);
  markAuthResolvedRef.current = markAuthResolved;

  // Server-authoritative device session client. Built ONCE per `oxyServices`
  // instance. `onUnauthenticated` (a device signout-all pushed over the
  // bearer-authenticated socket, or bootstrapped as zero-account) clears the
  // persisted store + local state so a reload does not try to restore a session
  // the device no longer has. The realtime socket is bearer-only now: a
  // signed-out tab cannot join any device room, so there is no signed-out sync
  // wiring here.
  const sessionClientPairRef = useRef<ReturnType<typeof createSessionClient> | null>(null);
  if (!sessionClientPairRef.current) {
    sessionClientPairRef.current = createSessionClient(
      oxyServices,
      authStore,
      () => {
        clearPersistedAuthSafe(authStore, logger);
        void clearSessionStateRef.current().catch((clearError) => {
          logger('Failed to clear local state on remote sign-out', clearError);
        });
      },
    );
  }
  const { client: sessionClient, host: sessionClientHost } = sessionClientPairRef.current;

  // Projects `client.getState()` onto the exposed `sessions`/`activeSessionId`/
  // `user`. Sole authority for both locally-initiated mutations (switch/logout)
  // AND remotely-pushed `session_state` over the `device:<deviceId>` socket.
  const syncFromClient = useCallback(async (): Promise<void> => {
    const state = sessionClient.getState();
    if (state === null) {
      return;
    }
    if (state.accounts.length === 0) {
      sessionClientHost.setCurrentAccountId(null);
      clearPersistedAuthSafe(authStore, logger);
      await clearSessionState();
      return;
    }
    // Last-write-wins guard: capture the revision this projection is for, then
    // after the async profile fetch bail if a fresher state has landed.
    const capturedRevision = state.revision;
    const ids = accountIdsOf(state);
    let users: User[] = [];
    try {
      users = ids.length > 0 ? await oxyServices.getUsersByIds(ids) : [];
    } catch (fetchError) {
      logger('Failed to resolve account profiles during syncFromClient', fetchError);
      return;
    }
    const latest = sessionClient.getState();
    if (!latest || latest.revision !== capturedRevision) {
      return;
    }
    const usersById = new Map(users.map((resolvedUser) => [resolvedUser.id, resolvedUser]));
    updateSessions(deviceStateToClientSessions(latest, usersById));
    setActiveSessionId(activeSessionIdOf(latest));
    const activeUser = activeUserOf(latest, usersById);
    if (activeUser) {
      loginSuccess(activeUser);
    }
    sessionClientHost.setCurrentAccountId(latest.activeAccountId);
  }, [
    oxyServices,
    sessionClient,
    sessionClientHost,
    authStore,
    updateSessions,
    setActiveSessionId,
    loginSuccess,
    clearSessionState,
    logger,
  ]);
  const syncFromClientRef = useRef(syncFromClient);
  syncFromClientRef.current = syncFromClient;

  useEffect(() => {
    return sessionClient.subscribe(() => {
      void syncFromClient();
    });
  }, [sessionClient, syncFromClient]);

  const { signIn, logout, logoutAll } = useAuthOperations({
    oxyServices,
    store: authStore,
    storage,
    activeSessionId,
    setActiveSessionId,
    updateSessions,
    saveActiveSessionId,
    clearSessionState,
    switchSession,
    sessionClient,
    syncFromClient,
    applyLanguagePreference,
    onAuthStateChange,
    onError,
    loginSuccess,
    loginFailure,
    logoutStore,
    setAuthState,
    logger,
  });

  // "That wasn't me": repudiating a flagged sign-in IS revoking the device
  // session that just committed — the same server-authoritative
  // `sessionClient.signOut(...)` path `logout` uses, which also clears the
  // persisted device credential + local state when no sibling account remains.
  // No dedicated "report suspicious" API endpoint exists (or is needed).
  const revokeSuspiciousSignIn = useCallback(async (): Promise<void> => {
    await logout();
  }, [logout]);

  const clearAllAccountData = useCallback(async (): Promise<void> => {
    queryClient.clear();
    if (storage) {
      try {
        await clearQueryCache(storage);
      } catch (error) {
        logger('Failed to clear persisted query cache', error);
      }
    }
    await clearSessionState();
    // Explicit FULL wipe: also drop the persisted device credential so a reload
    // finds nothing to restore.
    await authStore.clear();
    useAccountStore.getState().reset();
    oxyServices.clearCache();
  }, [queryClient, storage, clearSessionState, authStore, logger, oxyServices]);

  const { getDeviceSessions, logoutAllDeviceSessions, updateDeviceName } = useDeviceManagement({
    oxyServices,
    activeSessionId,
    onError,
    clearSessionState,
    logger,
  });

  const useFollowHook = loadUseFollowHook();

  // Token-change side effects: an invalidated bearer (HttpService clears tokens
  // on an unrecoverable 401 and emits `null`) must locally sign out an
  // authenticated user so `isAuthenticated` never lingers true with no token.
  // The persisted store is NOT cleared here — the refresh handler already
  // cleared it if the family was revoked; a transient null leaves it intact so a
  // later reload can still restore.
  const clearingInvalidTokenRef = useRef(false);
  useEffect(() => {
    const handleTokenChange = (accessToken: string | null) => {
      setHasAccessToken(Boolean(accessToken));
      if (accessToken) {
        setTokenReady(true);
        return;
      }
      if (userRef.current || isAuthenticatedRef.current) {
        setTokenReady(false);
        if (clearingInvalidTokenRef.current) {
          return;
        }
        clearingInvalidTokenRef.current = true;
        clearSessionStateRef.current()
          .catch((clearError) => {
            logger('Failed to clear invalidated auth session', clearError);
          })
          .finally(() => {
            clearingInvalidTokenRef.current = false;
            if (authResolvedRef.current) {
              setTokenReady(true);
            }
          });
        return;
      }
      if (authResolvedRef.current) {
        setTokenReady(true);
      }
    };
    handleTokenChange(oxyServices.getAccessToken());
    return oxyServices.onTokensChanged(handleTokenChange);
  }, [logger, oxyServices]);

  // Unified in-session refresh (SDK-owned; every RP inherits it). Installs the
  // ONE core refresh handler (re-mint from the persisted zero-cookie device
  // credential via `POST /session/device/token`) plus the proactive scheduler
  // that refreshes ~60s before expiry and on tab-focus. Replaces the deleted
  // services-local `inSessionTokenRefresh` module.
  useEffect(() => {
    const dispose = installAuthRefreshHandler({ oxy: oxyServices, store: authStore });
    const scheduler = startTokenRefreshScheduler(oxyServices);
    return () => {
      scheduler.dispose();
      dispose();
    };
  }, [oxyServices, authStore]);

  // ── Session commit funnel ────────────────────────────────────────────────
  // The single place a session becomes committed: plant tokens, persist the
  // zero-cookie device credential (`deviceId` + `deviceSecret`), register the
  // account into the server-authoritative device set, and hydrate the full user.
  // Used by the QR device flow (`handleWebSession`), password sign-in, 2FA
  // completion, and the cold boot.
  const commitSession = useCallback(
    async (
      input: CommitInput,
      options: { activate: boolean; skipIdpHandoff?: boolean },
    ): Promise<void> => {
      if (input.accessToken) {
        oxyServices.setTokens(input.accessToken);
      }

      // Persist the durable blob when the zero-cookie device credential
      // (`deviceId` + `deviceSecret`) is present. The cold boot has usually
      // persisted already; this is idempotent. Without the credential there is
      // nothing durable to persist and the session lives only for this runtime.
      if (input.deviceId && input.deviceSecret && input.userId) {
        try {
          const next: PersistedAuthState = {
            sessionId: input.sessionId,
            userId: input.userId,
            deviceId: input.deviceId,
            deviceSecret: input.deviceSecret,
            ...(input.accessToken ? { accessToken: input.accessToken } : {}),
            ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
          };
          await authStore.save(next);
        } catch (persistError) {
          logger('Failed to persist auth state on commit', persistError);
        }
      }

      // Fast local mirror so the UI updates before the server round-trip; the
      // SessionClient projection below overwrites it with server truth.
      if (input.userId) {
        const now = new Date();
        updateSessions(
          [
            {
              sessionId: input.sessionId,
              deviceId: input.deviceId ?? '',
              expiresAt: input.expiresAt || new Date(now.getTime() + DEFAULT_SESSION_VALIDITY_MS).toISOString(),
              lastActive: now.toISOString(),
              userId: input.userId,
              isCurrent: true,
            },
          ],
          { merge: true },
        );
        setActiveSessionId(input.sessionId);
      }

      // Register into the device set. A deliberate sign-in ACTIVATES the account
      // (`registerAndActivate`); the cold boot only ensures membership and lets
      // the server's own `activeAccountId` win (`addCurrentAccount`). Both then
      // start the socket + project. Best-effort — a failure never fails the
      // sign-in (cold boot re-registers on the next load).
      try {
        if (options.activate) {
          await sessionClient.registerAndActivate(input.userId);
        } else {
          await sessionClient.addCurrentAccount();
        }
        await sessionClient.start();
        await syncFromClient();
      } catch (registrationError) {
        loggerUtil.warn(
          'commitSession: device-set registration failed',
          { component: 'OxyContext', method: 'commitSession' },
          registrationError as unknown,
        );
      }

      // Hydrate the full user (the commit input carries only minimal data). Fall
      // back to the minimal shape if the profile fetch fails.
      let fullUser: User | null = null;
      try {
        fullUser = await oxyServices.getCurrentUser();
      } catch (profileError) {
        if (__DEV__) {
          loggerUtil.debug(
            'Failed to fetch full user on commit; using minimal fallback',
            { component: 'OxyContext', method: 'commitSession' },
            profileError as unknown,
          );
        }
        fullUser = (input.user as unknown as User) ?? null;
      }
      if (fullUser) {
        loginSuccess(fullUser);
        onAuthStateChangeRef.current?.(fullUser);
      }
      markAuthResolvedRef.current();

      // Propagate credentials to auth.oxy.so (IdP hub) after interactive sign-in
      // only — never after silent OAuth return, cold boot, account switch, or
      // handoff exchange (those paths already converged via IdP or local mint).
      if (
        options.activate &&
        !options.skipIdpHandoff &&
        isWebBrowser() &&
        !isIdpHubOrigin()
      ) {
        await maybeRedirectIdpHandoff({ oxyServices }).catch(() => false);
      }
    },
    [oxyServices, authStore, updateSessions, setActiveSessionId, sessionClient, syncFromClient, loginSuccess, logger],
  );
  const commitSessionRef = useRef(commitSession);
  commitSessionRef.current = commitSession;

  // Public `handleWebSession`: commit a session from the QR device flow. It is a
  // deliberate sign-in on THIS device, so it activates the account.
  const handleWebSession = useCallback(
    async (session: SessionLoginResponse): Promise<void> => {
      if (!session?.user || !session?.sessionId || !session.accessToken) {
        throw new Error('Session response did not include a usable session');
      }
      await commitSession(
        {
          sessionId: session.sessionId,
          accessToken: session.accessToken,
          // deviceFlow threads the rotating deviceSecret on the runtime object
          // even though `SessionLoginResponse` does not type it.
          deviceSecret: (session as { deviceSecret?: string }).deviceSecret,
          deviceId: session.deviceId,
          expiresAt: session.expiresAt,
          userId: session.user.id,
          user: session.user,
        },
        { activate: true },
      );
    },
    [commitSession],
  );

  // ── Unified account dialog ─────────────────────────────────────────────────
  // The single account-chooser + sign-in surface. Built ONCE per provider mount
  // and bound to the live `oxyServices` + `sessionClient` + this provider's
  // `handleWebSession` commit funnel. `handleWebSession` is threaded through a ref
  // so the controller keeps a STABLE `commitSession` (rebuilding the controller
  // on every commit-identity change would drop its subscription + state).
  const handleWebSessionRef = useRef(handleWebSession);
  handleWebSessionRef.current = handleWebSession;

  const accountDialogControllerRef = useRef<AccountDialogController | null>(null);
  if (!accountDialogControllerRef.current) {
    accountDialogControllerRef.current = createAccountDialogController({
      oxyServices,
      sessionClient,
      clientId,
      authRedirectUri,
      locale: currentLanguage,
      commitSession: (session) => handleWebSessionRef.current(session),
      onSignedIn: () => setAccountDialogOpen(false),
      openUrl: (url) => {
        if (isWebBrowser()) {
          redirectToAuthorize(url);
          return;
        }
        void Linking.openURL(url);
      },
    });
  }
  const accountDialogController = accountDialogControllerRef.current;

  const openAccountDialog = useCallback((view?: AccountDialogView): void => {
    accountDialogControllerRef.current?.setView(view ?? 'accounts');
    setAccountDialogOpen(true);
  }, []);

  const closeAccountDialog = useCallback((): void => {
    accountDialogControllerRef.current?.cancelSignIn();
    setAccountDialogOpen(false);
  }, []);

  // Start driving the dialog on mount; tear it down on unmount.
  useEffect(() => {
    const controller = accountDialogControllerRef.current;
    controller?.start();
    return () => controller?.destroy();
  }, []);

  // Expose the live open/close controls to the imperative manager so
  // `showSignInModal()` (and any app-level imperative "sign in" handler) works.
  useEffect(
    () => registerAccountDialogControls({ open: openAccountDialog, close: closeAccountDialog }),
    [openAccountDialog, closeAccountDialog],
  );

  // Broadcast visibility so `OxySignInButton`'s "Signing in…" affordance stays
  // accurate regardless of what opened or dismissed the dialog.
  useEffect(() => {
    notifyAccountDialogVisibility(accountDialogOpen);
  }, [accountDialogOpen]);

  // Keyless password sign-in: username/email + password.
  const signInWithPassword = useCallback(
    async (
      identifier: string,
      password: string,
      opts?: { deviceName?: string; deviceFingerprint?: string },
    ): Promise<PasswordSignInResult> => {
      const persisted = await authStore.load();
      const result = await oxyServices.passwordSignIn(identifier, password, {
        deviceName: opts?.deviceName,
        deviceFingerprint: opts?.deviceFingerprint,
        deviceId: persisted?.deviceId,
      });
      if ('twoFactorRequired' in result) {
        return { status: '2fa_required', loginToken: result.loginToken };
      }
      // `passwordSignIn` already planted the access token on the session arm.
      await commitSession(
        {
          sessionId: result.sessionId,
          accessToken: result.accessToken,
          deviceSecret: result.deviceSecret,
          deviceId: result.deviceId,
          expiresAt: result.expiresAt,
          userId: result.user.id,
          user: result.user,
        },
        { activate: true },
      );
      return { status: 'ok', ...(result.securityAlert ? { securityAlert: result.securityAlert } : {}) };
    },
    [oxyServices, commitSession],
  );

  const completeTwoFactorSignIn = useCallback(
    async (params: {
      loginToken: string;
      token?: string;
      backupCode?: string;
      deviceName?: string;
    }): Promise<{ securityAlert?: SecurityAlert }> => {
      const persisted = await authStore.load();
      const result = await oxyServices.completeTwoFactorSignIn({
        loginToken: params.loginToken,
        token: params.token,
        backupCode: params.backupCode,
        deviceName: params.deviceName,
        deviceId: persisted?.deviceId,
      });
      await commitSession(
        {
          sessionId: result.sessionId,
          accessToken: result.accessToken,
          deviceSecret: result.deviceSecret,
          deviceId: result.deviceId,
          expiresAt: result.expiresAt,
          userId: result.user.id,
          user: result.user,
        },
        { activate: true },
      );
      return { securityAlert: result.securityAlert };
    },
    [oxyServices, commitSession],
  );

  // ── Cold boot ────────────────────────────────────────────────────────────
  // The single device-first session restore. Runs ONCE after storage init.
  // `runSessionColdBoot` resolves the device's session (bootstrap-return →
  // stored-tokens → shared-key (native) → bootstrap-hop (web)) WITHOUT ever
  // redirecting to a login page; an unresolved boot ends signed-out and the app
  // renders its "Sign in with Oxy" affordance. On a winning boot the token is
  // already planted + persisted, so `onSession` only hands off to the
  // SessionClient (membership + active account + realtime socket) and marks
  // auth resolved. `onSignedOut` marks auth resolved with no session.
  const runColdBoot = useCallback(async (): Promise<void> => {
    setTokenReady(false);
    try {
      if (coldBoot) {
        consumeSilentOAuthError();

        const oauthCompleted = await tryCompleteOAuthReturn({
          oxyServices,
          clientId: clientIdProp,
          authRedirectUri,
          commitSession: (input) =>
            commitSessionRef.current(input, {
              activate: true,
              skipIdpHandoff: true,
            }),
        });
        if (oauthCompleted) {
          setTokenReady(true);
          markAuthResolvedRef.current();
          return;
        }
      }

      const outcome = await runSessionColdBoot({
        oxy: oxyServices,
        store: authStore,
        platform: { isWeb: isWebBrowser(), isNative: !isWebBrowser() },
        onSession: async (session) => {
          // Bound how long auth resolution waits for the handoff — the token is
          // already planted, so on a slow backend we proceed and let the handoff
          // land asynchronously (the socket subscription re-projects when it does).
          const handoff = commitSessionRef.current(
            { sessionId: session.sessionId, accessToken: session.accessToken, userId: session.userId },
            { activate: false },
          );
          let handoffDeadlineId: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            handoff,
            new Promise<void>((resolve) => {
              handoffDeadlineId = setTimeout(resolve, SESSION_HANDOFF_DEADLINE);
            }),
          ]).finally(() => {
            if (handoffDeadlineId !== undefined) {
              clearTimeout(handoffDeadlineId);
            }
          });
          markAuthResolvedRef.current();
        },
        onSignedOut: () => {
          // The realtime socket is bearer-only: a signed-out tab cannot join any
          // device room, so there is no signed-out socket to start here.
          markAuthResolvedRef.current();
        },
        onStepError: (id, error) => {
          if (__DEV__) {
            loggerUtil.debug(
              `Cold-boot step "${id}" errored (non-fatal, falling through)`,
              { component: 'OxyContext', method: 'runColdBoot' },
              error,
            );
          }
        },
      });

      // Web cross-origin restore: silent OAuth against the IdP hub when local
      // mint found no usable credential (or secret was stale).
      if (
        coldBoot &&
        isWebBrowser() &&
        clientIdProp &&
        outcome.kind !== 'session'
      ) {
        const redirected = await maybeStartSilentOAuthRestore({
          oxyServices,
          clientId: clientIdProp,
          redirectUri: authRedirectUri,
        });
        if (redirected) {
          return;
        }
      }
    } catch (error) {
      if (__DEV__) {
        loggerUtil.error(
          'Cold boot error',
          error instanceof Error ? error : new Error(String(error)),
          { component: 'OxyContext', method: 'runColdBoot' },
        );
      }
    } finally {
      // Backstop: resolve on every exit path so the gate can never hang.
      markAuthResolvedRef.current();
    }
  }, [oxyServices, authStore, coldBoot, clientIdProp, authRedirectUri]);

  useEffect(() => {
    if (initialized) {
      return;
    }
    // IdP mode (`coldBoot={false}`): this provider is NOT the ecosystem session
    // authority, so it never runs the device-first restore. Resolve auth
    // immediately as signed out so there is no boot spinner; a deliberate sign-in
    // still commits a normal session.
    if (!coldBoot) {
      setInitialized(true);
      markAuthResolved();
      return;
    }
    if (!storage) {
      return;
    }
    setInitialized(true);
    runColdBoot().catch((error) => {
      if (__DEV__) {
        logger('Cold boot failed', error);
      }
    });
  }, [coldBoot, runColdBoot, storage, initialized, logger, markAuthResolved]);

  // Reconcile device state when the tab returns to foreground (background tabs may
  // miss socket pushes or have stale bearer tokens).
  useEffect(() => {
    if (!isWebBrowser()) return;
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (!oxyServices.getAccessToken()) return;
      void sessionClient.bootstrap().then(() => syncFromClient()).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [oxyServices, sessionClient, syncFromClient]);

  // Exposed `refreshSessions`: re-bootstrap the server-authoritative device
  // state and reproject — the manual counterpart to the realtime socket.
  const refreshSessionsForContext = useCallback(async (): Promise<void> => {
    await sessionClient.bootstrap();
    await syncFromClient();
  }, [sessionClient, syncFromClient]);

  // Exposed `switchSession`: route through the server-authoritative
  // `SessionClient`. Resolve the target account from the current device state,
  // ask the server to switch, reproject, and return the now-active user.
  const switchSessionForContext = useCallback(
    async (sessionId: string): Promise<User> => {
      const targetAccountId = sessionClient
        .getState()
        ?.accounts.find((account) => account.sessionId === sessionId)?.accountId;
      if (!targetAccountId) {
        throw new Error(`No device account found for session "${sessionId}"`);
      }
      await sessionClient.switchAccount(targetAccountId);
      await syncFromClient();
      const activeUser = useAuthStore.getState().user;
      if (!activeUser) {
        throw new Error('Active account profile could not be resolved after switch');
      }
      return activeUser;
    },
    [sessionClient, syncFromClient],
  );

  const hasIdentity = useCallback(async (): Promise<boolean> => KeyManager.hasIdentity(), []);
  const getPublicKey = useCallback(async (): Promise<string | null> => KeyManager.getPublicKey(), []);

  const showBottomSheetForContext = useCallback(
    (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => {
      globalShowBottomSheet(screenOrConfig);
    },
    [],
  );

  const { openAvatarPicker } = useAvatarPicker({
    oxyServices,
    currentLanguage,
    activeSessionId,
    queryClient,
    showBottomSheet: showBottomSheetForContext,
  });

  // ── Account graph ──────────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<AccountNode[]>([]);

  const refreshAccounts = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || !tokenReady || !oxyServices.getAccessToken()) {
      setAccounts([]);
      return;
    }
    try {
      const list = await oxyServices.listAccounts();
      setAccounts(list);
    } catch (err) {
      if (isUnauthorizedStatus(err)) {
        setAccounts([]);
        await clearSessionStateRef.current();
        return;
      }
      if (__DEV__) {
        loggerUtil.debug('Failed to load accounts', { component: 'OxyContext' }, err as unknown);
      }
    }
  }, [isAuthenticated, oxyServices, tokenReady]);

  useEffect(() => {
    if (isAuthenticated && initialized && tokenReady) {
      refreshAccounts();
      // Reload the dialog's own account graph too, so a session restored OUTSIDE
      // the dialog (cold boot / password sign-in) surfaces its graph accounts.
      void accountDialogControllerRef.current?.refresh();
    }
  }, [isAuthenticated, initialized, tokenReady, refreshAccounts]);

  const runPostAccountSwitchSideEffects = useCallback(async (): Promise<void> => {
    await refreshAccounts();
    queryClient.invalidateQueries();
  }, [refreshAccounts, queryClient]);

  // Switch the active session INTO an account from the unified graph. In the
  // real-session model this is identical to switching device sign-ins.
  const switchToAccount = useCallback(
    async (accountId: string): Promise<void> => {
      const deviceState = sessionClient.getState();
      if (deviceState?.accounts.some((account) => account.accountId === accountId)) {
        await sessionClient.switchAccount(accountId);
        await syncFromClient();
        await runPostAccountSwitchSideEffects();
        return;
      }

      const result = await oxyServices.switchToAccount(accountId);
      if (!result?.user || !result?.sessionId) {
        throw new Error('Account switch did not return a valid session');
      }
      // `oxyServices.switchToAccount` already planted the access token; commit
      // the minted session through the shared funnel (persist + register +
      // hydrate) as a deliberate activation.
      await commitSession(
        {
          sessionId: result.sessionId,
          accessToken: result.accessToken,
          deviceSecret: (result as { deviceSecret?: string }).deviceSecret,
          deviceId: result.deviceId,
          expiresAt: result.expiresAt,
          userId: result.user.id,
          user: result.user,
        },
        { activate: true, skipIdpHandoff: true },
      );
      await runPostAccountSwitchSideEffects();
    },
    [oxyServices, sessionClient, syncFromClient, commitSession, runPostAccountSwitchSideEffects],
  );

  const createAccountFn = useCallback(
    async (data: CreateAccountInput): Promise<AccountNode> => {
      const account = await oxyServices.createAccount(data);
      await refreshAccounts();
      return account;
    },
    [oxyServices, refreshAccounts],
  );

  const canUsePrivateApi = authResolved && isAuthenticated && tokenReady && hasAccessToken;
  const isPrivateApiPending = !authResolved || (isAuthenticated && (!tokenReady || !hasAccessToken));

  const contextValue: OxyContextState = useMemo(
    () => ({
      user,
      sessions,
      activeSessionId,
      isAuthenticated,
      isLoading,
      isTokenReady: tokenReady,
      hasAccessToken,
      canUsePrivateApi,
      isPrivateApiPending,
      isAuthResolved: authResolved,
      isStorageReady: storage !== null,
      error,
      currentLanguage,
      currentLanguageMetadata,
      currentLanguageName,
      currentNativeLanguageName,
      hasIdentity,
      getPublicKey,
      signIn,
      signInWithPassword,
      completeTwoFactorSignIn,
      revokeSuspiciousSignIn,
      handleWebSession,
      logout,
      logoutAll,
      switchSession: switchSessionForContext,
      removeSession: logout,
      refreshSessions: refreshSessionsForContext,
      setLanguage,
      getDeviceSessions,
      logoutAllDeviceSessions,
      updateDeviceName,
      clearSessionState,
      clearAllAccountData,
      storageKeyPrefix,
      clientId,
      oxyServices,
      useFollow: useFollowHook,
      showBottomSheet: showBottomSheetForContext,
      openAvatarPicker,
      accountDialogController,
      isAccountDialogOpen: accountDialogOpen,
      openAccountDialog,
      closeAccountDialog,
      accounts,
      switchToAccount,
      refreshAccounts,
      createAccount: createAccountFn,
    }),
    [
      user,
      sessions,
      activeSessionId,
      isAuthenticated,
      isLoading,
      tokenReady,
      hasAccessToken,
      canUsePrivateApi,
      isPrivateApiPending,
      authResolved,
      storage,
      error,
      currentLanguage,
      currentLanguageMetadata,
      currentLanguageName,
      currentNativeLanguageName,
      hasIdentity,
      getPublicKey,
      signIn,
      signInWithPassword,
      completeTwoFactorSignIn,
      revokeSuspiciousSignIn,
      handleWebSession,
      logout,
      logoutAll,
      switchSessionForContext,
      refreshSessionsForContext,
      setLanguage,
      getDeviceSessions,
      logoutAllDeviceSessions,
      updateDeviceName,
      clearSessionState,
      clearAllAccountData,
      storageKeyPrefix,
      clientId,
      oxyServices,
      useFollowHook,
      showBottomSheetForContext,
      openAvatarPicker,
      accountDialogController,
      accountDialogOpen,
      openAccountDialog,
      closeAccountDialog,
      accounts,
      switchToAccount,
      refreshAccounts,
      createAccountFn,
    ],
  );

  return <OxyContext.Provider value={contextValue}>{children}</OxyContext.Provider>;
};

export const OxyContextProvider = OxyProvider;

/**
 * Loading-state stub used when `useOxy()` is called outside an OxyProvider.
 * All async methods reject with a clear error so misuse is caught early.
 */
const PROVIDER_MISSING_ERROR_MESSAGE =
  'OxyProvider is not mounted. Wrap your app in <OxyProvider> before calling useOxy() methods.';

const rejectMissingProvider = <T,>(): Promise<T> =>
  Promise.reject(new Error(PROVIDER_MISSING_ERROR_MESSAGE));

const LOADING_STATE_OXY_SERVICES = new OxyServices({ baseURL: 'about:blank' });

const LOADING_STATE: OxyContextState = {
  user: null,
  sessions: [],
  activeSessionId: null,
  isAuthenticated: false,
  isLoading: true,
  isTokenReady: false,
  hasAccessToken: false,
  canUsePrivateApi: false,
  isPrivateApiPending: true,
  isAuthResolved: false,
  isStorageReady: false,
  error: null,
  currentLanguage: 'en',
  currentLanguageMetadata: null,
  currentLanguageName: 'English',
  currentNativeLanguageName: 'English',
  hasIdentity: () => Promise.resolve(false),
  getPublicKey: () => Promise.resolve(null),
  signIn: () => rejectMissingProvider<User>(),
  signInWithPassword: () => rejectMissingProvider<PasswordSignInResult>(),
  completeTwoFactorSignIn: () => rejectMissingProvider<{ securityAlert?: SecurityAlert }>(),
  revokeSuspiciousSignIn: () => rejectMissingProvider<void>(),
  handleWebSession: () => rejectMissingProvider<void>(),
  logout: () => rejectMissingProvider<void>(),
  logoutAll: () => rejectMissingProvider<void>(),
  switchSession: () => rejectMissingProvider<User>(),
  removeSession: () => rejectMissingProvider<void>(),
  refreshSessions: () => rejectMissingProvider<void>(),
  setLanguage: () => rejectMissingProvider<void>(),
  getDeviceSessions: () => Promise.resolve([]),
  logoutAllDeviceSessions: () => rejectMissingProvider<void>(),
  updateDeviceName: () => rejectMissingProvider<void>(),
  clearSessionState: () => rejectMissingProvider<void>(),
  clearAllAccountData: () => rejectMissingProvider<void>(),
  storageKeyPrefix: 'oxy_session',
  clientId: null,
  oxyServices: LOADING_STATE_OXY_SERVICES,
  openAvatarPicker: () => {},
  accountDialogController: null,
  isAccountDialogOpen: false,
  openAccountDialog: () => {},
  closeAccountDialog: () => {},
  accounts: [],
  switchToAccount: () => rejectMissingProvider<void>(),
  refreshAccounts: () => rejectMissingProvider<void>(),
  createAccount: () => rejectMissingProvider<AccountNode>(),
};

export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    return LOADING_STATE;
  }
  return context;
};

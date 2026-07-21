import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking } from 'react-native';
import { io } from 'socket.io-client';
import { OxyServices, oxyClient } from '@oxyhq/core';
import type {
  User,
  SessionLoginResponse,
  AuthStateStore,
  PersistedAuthState,
  AccountDialogController,
  AccountDialogView,
} from '@oxyhq/core';
import {
  KeyManager,
  installAuthRefreshHandler,
  startTokenRefreshScheduler,
  createAccountDialogController,
  logger as loggerUtil,
  syncHubAfterSignIn,
} from '@oxyhq/core';
import {
  registerAccountDialogControls,
  notifyAccountDialogVisibility,
} from '../navigation/accountDialogManager';
import { redirectToAuthorize } from '../components/oauthNavigation';
import { openPasskeyHubPopup } from '../components/passkeyHubPopup';
import { isWebBrowser } from '../utils/isWebBrowser';
import { runProviderColdBoot } from '../boot/runProviderColdBoot';
import { loadPersistedDeviceCredential } from '../utils/deviceCredential';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useLanguageManagement } from '../hooks/useLanguageManagement';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useAuthOperations, clearPersistedAuthSafe } from './hooks/useAuthOperations';
import { useDeviceManagement } from '../hooks/useDeviceManagement';
import { getStorageKeys, createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { presentDetached, type SurfaceInstance } from '../navigation/surfaces';
import { useQueryClient, onlineManager } from '@tanstack/react-query';
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
import type {
  OxyContextState,
  OxyContextProviderProps,
  CommitInput,
} from './oxyContextTypes';
import { DEFAULT_SESSION_VALIDITY_MS, loadUseFollowHook } from './oxyContextHelpers';
import { commitDeviceSetAndResolve } from './commitSessionFlow';
import { runPasskeyLogin, runPasskeyRegister, runPasskeyAdd } from './passkeyFlow';
import {
  isPasskeySupported,
  runRegistrationCeremony,
  runAuthenticationCeremony,
} from '../../webauthn/passkeyClient';
import { queryKeys } from '../hooks/queries/queryKeys';
import { useOxyAccountGraph } from './useOxyAccountGraph';

export type { OxyContextState, OxyContextProviderProps } from './oxyContextTypes';

const OxyContext = createContext<OxyContextState | null>(null);

export const OxyProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices: providedOxyServices,
  baseURL,
  authWebUrl,
  authRedirectUri,
  authorizeBaseUrl,
  storageKeyPrefix = 'oxy_session',
  clientId: clientIdProp,
  hubSync = true,
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
    languages: currentLanguages,
    metadata: currentLanguageMetadata,
    languageName: currentLanguageName,
    nativeLanguageName: currentNativeLanguageName,
    setLanguage,
  } = useLanguageManagement({
    storage,
    languageKey: storageKeys.language,
    user,
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
  // instance. Device-scoped sockets connect with deviceId+deviceSecret when no
  // bearer is planted yet, so cross-origin apps sync via `session_state` after
  // the one-shot join redirect.
  const sessionClientPairRef = useRef<ReturnType<typeof createSessionClient> | null>(null);
  if (!sessionClientPairRef.current) {
    sessionClientPairRef.current = createSessionClient(
      oxyServices,
      (origin) => {
        // Erase the DURABLE device credential only on a `request`-origin verdict
        // (a REST sign-out / revocation). A `push`-origin empty state is a socket
        // broadcast that may be a transient reconnect artifact — clearing the
        // credential on it would strand the user signed out with no way back, so
        // we clear only the local UI session and keep the credential (a dead one
        // re-mints to `no_active_session` and resolves signed-out on next boot).
        if (origin === 'request') {
          clearPersistedAuthSafe(authStore, logger);
        }
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
      // Clear the LOCAL UI session on any applied empty state, but NEVER the
      // durable device credential here: `syncFromClient` runs for socket-pushed
      // (possibly transient) states too, and wiping the credential on one would
      // strand the user signed out. The credential wipe is gated on a
      // `request`-origin verdict in `onUnauthenticated` above.
      sessionClientHost.setCurrentAccountId(null);
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
    updateSessions,
    setActiveSessionId,
    loginSuccess,
    clearSessionState,
    logger,
  ]);
  const syncFromClientRef = useRef(syncFromClient);
  syncFromClientRef.current = syncFromClient;

  const syncDeviceCredentialToHost = useCallback(async (): Promise<void> => {
    const cred = await loadPersistedDeviceCredential(authStore);
    sessionClientHost.setDeviceCredential(cred);
  }, [authStore, sessionClientHost]);

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
        if (sessionClient.getState()?.accounts.length) {
          void syncFromClientRef.current();
        }
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
      options: { activate: boolean; hubSync?: boolean },
    ): Promise<void> => {
      if (input.accessToken) {
        oxyServices.setTokens(input.accessToken);
      }

      // Persist the durable blob when the zero-cookie device credential is present.
      if (input.deviceId && input.deviceSecret) {
        try {
          const prior = await authStore.load();
          const next: PersistedAuthState = {
            sessionId: input.sessionId || prior?.sessionId || '',
            userId: input.userId || prior?.userId || '',
            deviceId: input.deviceId,
            deviceSecret: input.deviceSecret,
            ...(input.accessToken ? { accessToken: input.accessToken } : {}),
            ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
          };
          await authStore.save(next);
          sessionClientHost.setDeviceCredential({
            deviceId: input.deviceId,
            deviceSecret: input.deviceSecret,
          });
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

      // Register into the device set, hydrate the full user, and flip the
      // auth-resolution gate. A deliberate sign-in ACTIVATES the account and
      // BLOCKS on the reconcile (register + socket + sessions projection) before
      // resolving — unchanged ordering. The cold boot resolves auth from the
      // profile fetch FIRST and reconciles the device set in the background, so
      // first paint is not held behind those extra round-trips. Reconcile is
      // best-effort — a failure never fails the sign-in (cold boot re-registers
      // on the next load).
      await commitDeviceSetAndResolve({
        activate: options.activate,
        userId: input.userId,
        fallbackUser: (input.user as unknown as User) ?? null,
        registerAndActivate: (userId) => sessionClient.registerAndActivate(userId),
        addCurrentAccount: () => sessionClient.addCurrentAccount(),
        startSocket: () => sessionClient.start(),
        syncFromClient,
        getCurrentUser: () => oxyServices.getCurrentUser(),
        loginSuccess,
        onAuthStateChange: onAuthStateChangeRef.current,
        markAuthResolved: markAuthResolvedRef.current,
      });

      if (options.activate && options.hubSync && hubSync && isWebBrowser()) {
        try {
          await syncHubAfterSignIn(oxyServices, { enabled: hubSync });
        } catch (hubError) {
          if (__DEV__) {
            loggerUtil.debug(
              'Hub sync after sign-in failed (non-fatal)',
              { component: 'OxyContext', method: 'commitSession' },
              hubError as unknown,
            );
          }
        }
      }
    },
    [oxyServices, authStore, updateSessions, setActiveSessionId, sessionClient, sessionClientHost, syncFromClient, loginSuccess, logger, hubSync],
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
          deviceSecret: session.deviceSecret,
          deviceId: session.deviceId,
          expiresAt: session.expiresAt,
          userId: session.user.id,
          user: session.user,
        },
        { activate: true, hubSync: true },
      );
    },
    [commitSession],
  );

  // Commit a minted graph-SWITCH session. Same funnel as `handleWebSession` but
  // IN-PLACE: `hubSync: false` so switching accounts never triggers the
  // cross-origin hub-sync full-page redirect. The switch already propagates
  // across tabs/apps via the server's `session_state` socket broadcast.
  const commitSwitchedSession = useCallback(
    async (session: SessionLoginResponse): Promise<void> => {
      if (!session?.user || !session?.sessionId || !session.accessToken) {
        throw new Error('Session response did not include a usable session');
      }
      await commitSession(
        {
          sessionId: session.sessionId,
          accessToken: session.accessToken,
          deviceSecret: session.deviceSecret,
          deviceId: session.deviceId,
          expiresAt: session.expiresAt,
          userId: session.user.id,
          user: session.user,
        },
        { activate: true, hubSync: false },
      );
    },
    [commitSession],
  );

  // ── Unified account dialog ─────────────────────────────────────────────────
  // The single account-chooser + sign-in surface. Built ONCE per provider mount
  // and bound to the live `oxyServices` + `sessionClient` + this provider's
  // commit funnels. Both funnels are threaded through refs so the controller
  // keeps STABLE commit callbacks (rebuilding the controller on every
  // commit-identity change would drop its subscription + state).
  const handleWebSessionRef = useRef(handleWebSession);
  handleWebSessionRef.current = handleWebSession;
  const commitSwitchedSessionRef = useRef(commitSwitchedSession);
  commitSwitchedSessionRef.current = commitSwitchedSession;

  // The live AccountDialog surface (a stacked Bloom surface), while open — the
  // SINGLE source of truth for "is the account dialog open". Held so
  // `openAccountDialog` can no-op when already open and `closeAccountDialog` /
  // `onSignedIn` can dismiss it. Its present→settle lifecycle is what drives the
  // reactive `accountDialogOpen` mirror below: presenting flips it true, the
  // surface settling (`result.finally`) flips it false — no other write site.
  const accountDialogSurfaceRef = useRef<SurfaceInstance<'AccountDialog'> | null>(null);

  const accountDialogControllerRef = useRef<AccountDialogController | null>(null);
  if (!accountDialogControllerRef.current) {
    accountDialogControllerRef.current = createAccountDialogController({
      oxyServices,
      sessionClient,
      clientId,
      locale: currentLanguage,
      // Same statically-injected `io` as the SessionClient: gives the QR flow an
      // instant `/auth-session` `auth_update` wake instead of a slow poll.
      socketFactory: io,
      commitSession: (session) => handleWebSessionRef.current(session),
      commitSwitchedSession: (session) => commitSwitchedSessionRef.current(session),
      onSignedIn: () => {
        // Dismiss the surface; its settle (`result.finally` below) is what flips
        // `accountDialogOpen` false. The surface's present→settle lifecycle is the
        // SINGLE source of truth for "is the account dialog open" — never a manual
        // flip here.
        accountDialogSurfaceRef.current?.dismiss();
      },
      openUrl: (url) => {
        if (isWebBrowser()) {
          redirectToAuthorize(url);
          return;
        }
        void Linking.openURL(url);
      },
      // Native-only probe so the controller can detect an installed Commons and
      // deep-link straight into its approve screen (keeping the QR/polling live
      // as fallback). `undefined` on web mirrors the `openUrl` split — the
      // controller short-circuits, so `redirectToAuthorize` never runs for the
      // `oxycommons://` payload.
      canOpenApp: isWebBrowser() ? undefined : (url) => Linking.canOpenURL(url),
      // Web-only: lets `startPasskeyHubSignIn` open the auth.oxy.so passkey hub
      // popup (b2) for a non-Oxy origin. `undefined` on native — there is no
      // popup concept there, and off-origin passkey sign-in isn't reachable
      // (Commons owns the native flow).
      openPopup: isWebBrowser() ? openPasskeyHubPopup : undefined,
    });
  }
  const accountDialogController = accountDialogControllerRef.current;

  const openAccountDialog = useCallback((view?: AccountDialogView): void => {
    accountDialogControllerRef.current?.setView(view ?? 'accounts');
    // Present the AccountDialog surface on the shared Bloom stack the FIRST time
    // (subsequent opens just re-point the controller's view above). `presentDetached`
    // keeps it OUT of the `showBottomSheet` route-surface lineage, so closing the
    // bottom-sheet session never touches the account dialog and vice-versa. When a
    // route surface (e.g. ManageAccount) is already open, this stacks the dialog
    // ABOVE it; dismissing the dialog unwinds back to that surface.
    if (!accountDialogSurfaceRef.current) {
      const instance = presentDetached(
        'AccountDialog',
        { initialView: view ?? 'accounts' },
        { placement: { base: 'bottom', md: 'center' }, dismissOnBackdrop: false, maxWidth: 420 },
      );
      accountDialogSurfaceRef.current = instance;
      // The surface settling is the ONE place `accountDialogOpen` flips false —
      // covering every dismiss path (close button, `onSignedIn`, programmatic
      // `closeAccountDialog`, host unmount). So the stack owns the open state.
      instance.result.finally(() => {
        if (accountDialogSurfaceRef.current === instance) accountDialogSurfaceRef.current = null;
        setAccountDialogOpen(false);
      });
    }
    setAccountDialogOpen(true);
  }, []);

  const closeAccountDialog = useCallback((): void => {
    accountDialogControllerRef.current?.cancelSignIn();
    // Dismiss the surface; its settle (`result.finally` above) flips
    // `accountDialogOpen` false. Do NOT flip it here — the surface lifecycle is
    // the single source of truth, so a manual write would be a second authority.
    accountDialogSurfaceRef.current?.dismiss();
  }, []);

  // Start driving the dialog on mount; tear it down on unmount.
  useEffect(() => {
    const controller = accountDialogControllerRef.current;
    controller?.start();
    return () => controller?.destroy();
  }, []);

  // Expose the live open/close controls to the imperative manager so
  // Imperative `openAccountDialog('signin')` (and app-level sign-in handlers) works.
  useEffect(
    () => registerAccountDialogControls({ open: openAccountDialog, close: closeAccountDialog }),
    [openAccountDialog, closeAccountDialog],
  );

  // Broadcast visibility so `OxySignInButton`'s "Signing in…" affordance stays
  // accurate regardless of what opened or dismissed the dialog.
  useEffect(() => {
    notifyAccountDialogVisibility(accountDialogOpen);
  }, [accountDialogOpen]);

  // ── Passkey (WebAuthn) ─────────────────────────────────────────────────────
  // Web-only sign-in / registration via the browser WebAuthn ceremony. The fixed
  // `options → ceremony → verify → commit` ordering lives in the pure
  // `passkeyFlow` helpers (deps-injected, unit-tested); these wrappers supply the
  // real deps (core `webauthn*` methods, the platform ceremony client, and the
  // `commitSession` funnel). All three GATE on `isPasskeySupported()` so a native
  // / unsupported surface throws loudly instead of stalling in a ceremony.

  // Passkey sign-in. No `username` → usernameless (discoverable) flow. With a
  // `username` → username-first: the server scopes `allowCredentials` to that
  // user's passkeys so a non-discoverable hardware key (U2F/security key) can
  // be selected.
  const signInWithPasskey = useCallback(
    async (opts?: { username?: string; deviceName?: string; deviceFingerprint?: string }): Promise<void> => {
      const persisted = await authStore.load();
      await runPasskeyLogin({
        isSupported: isPasskeySupported,
        getLoginOptions: (username) => oxyServices.webauthnLoginOptions(username),
        runCeremony: runAuthenticationCeremony,
        loginVerify: (response, envelope) => oxyServices.webauthnLoginVerify(response, envelope),
        commit: (input) => commitSession(input, { activate: true, hubSync: true }),
        username: opts?.username,
        deviceId: persisted?.deviceId,
        deviceName: opts?.deviceName,
        deviceFingerprint: opts?.deviceFingerprint,
      });
    },
    [oxyServices, authStore, commitSession],
  );

  // Create a brand-new account whose first auth method is a passkey.
  const registerWithPasskey = useCallback(
    async (params: { username: string; deviceName?: string }): Promise<void> => {
      await runPasskeyRegister({
        isSupported: isPasskeySupported,
        getRegisterOptions: (username) => oxyServices.webauthnRegisterOptions(username),
        runCeremony: runRegistrationCeremony,
        registerVerify: (response, envelope) => oxyServices.webauthnRegisterVerify(response, envelope),
        commit: (input) => commitSession(input, { activate: true, hubSync: true }),
        username: params.username,
        deviceName: params.deviceName,
      });
    },
    [oxyServices, commitSession],
  );

  // Add a passkey to the already-signed-in account (bearer present). No new
  // session is committed — just refresh the linked auth-methods list.
  const addPasskey = useCallback(
    async (params?: { deviceName?: string }): Promise<void> => {
      await runPasskeyAdd({
        isSupported: isPasskeySupported,
        getRegisterOptions: () => oxyServices.webauthnRegisterOptions(),
        runCeremony: runRegistrationCeremony,
        registerVerify: (response, envelope) => oxyServices.webauthnRegisterVerify(response, envelope),
        onLinked: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.authMethods.all });
        },
        deviceName: params?.deviceName,
      });
    },
    [oxyServices, queryClient],
  );

  // Remove a passkey from the already-signed-in account by credential id. Not a
  // ceremony — a plain unlink — so it needs no `isPasskeySupported` gate; it just
  // refreshes the linked auth-methods list on success.
  const removePasskey = useCallback(
    async (credentialId: string): Promise<void> => {
      await oxyServices.removePasskey(credentialId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.authMethods.all });
    },
    [oxyServices, queryClient],
  );

  // ── Cold boot ────────────────────────────────────────────────────────────
  // Device-first session restore via `runProviderColdBoot` (see boot/runProviderColdBoot.ts).
  const runColdBoot = useCallback(async (): Promise<void> => {
    await runProviderColdBoot({
      oxyServices,
      authStore,
      clientId: clientIdProp,
      authRedirectUri,
      authorizeBaseUrl,
      sessionClient,
      syncDeviceCredentialToHost,
      commitSession: (input, options) => commitSessionRef.current(input, options),
      markAuthResolved: () => markAuthResolvedRef.current(),
      setTokenReady,
    });
  }, [
    oxyServices,
    authStore,
    clientIdProp,
    authRedirectUri,
    authorizeBaseUrl,
    syncDeviceCredentialToHost,
    sessionClient,
  ]);

  useEffect(() => {
    if (initialized) {
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
  }, [runColdBoot, storage, initialized, logger]);

  // Reconcile device state when the tab returns to foreground (background tabs may
  // miss socket pushes or have stale bearer tokens).
  useEffect(() => {
    if (!isWebBrowser()) return;
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return;
      const reconcile = async (): Promise<void> => {
        if (!oxyServices.getAccessToken() && sessionClientHost.getDeviceCredential()) {
          // Route through the ONE shared single-flight the scheduler/preflight/401
          // use — never a private mint lane — so a tab-focus reconcile can't
          // double-rotate the device secret against them.
          await oxyServices.httpService.refreshAccessToken('preflight');
        }
        if (!oxyServices.getAccessToken() && !sessionClientHost.getDeviceCredential()) {
          return;
        }
        await sessionClient.bootstrap();
        await syncFromClient();
      };
      void reconcile().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [oxyServices, sessionClient, sessionClientHost, syncFromClient]);

  // Reconnect heal: when connectivity transitions offline→online while there is
  // no live access token but a persisted device credential exists, re-mint ONCE
  // through the SAME shared single-flight lane the scheduler / tab-focus
  // reconcile / 401 path use — never a private mint lane, so this can't
  // double-rotate the device secret against them. A device that cold-booted
  // OFFLINE skipped the network mint step, so its session is otherwise only
  // recovered by the next scheduled re-mint; healing on the reconnect edge makes
  // recovery immediate. `onlineManager` is fed by OxyProvider's existing NetInfo
  // (native) / `navigator.onLine` (web) listener, so this reuses the one
  // connectivity signal instead of opening a second NetInfo subscription. Works
  // on native and web alike.
  useEffect(() => {
    // Seed from the current verdict so the first callback heals only on a
    // genuine offline→online edge, never an initial subscribe fan-out.
    let previousOnline = onlineManager.isOnline();
    return onlineManager.subscribe((online: boolean) => {
      const wasOffline = previousOnline === false;
      previousOnline = online;
      if (!online || !wasOffline) {
        return;
      }
      void (async () => {
        if (oxyServices.getAccessToken() || !sessionClientHost.getDeviceCredential()) {
          return;
        }
        await oxyServices.httpService.refreshAccessToken('preflight');
        if (!oxyServices.getAccessToken()) {
          return;
        }
        await sessionClient.bootstrap();
        await syncFromClient();
      })().catch(() => undefined);
    });
  }, [oxyServices, sessionClient, sessionClientHost, syncFromClient]);

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

  // Thin passthroughs to the platform-agnostic KeyManager. NOTE: both now THROW
  // `IdentityUnavailableError` (from `@oxyhq/core`) when identity storage is
  // locked/unreadable, instead of flattening that into `false`/`null`. We keep
  // the signatures and deliberately let the typed error PROPAGATE to the caller
  // — a locked keychain must never be misreported as "no identity". `hasIdentity`
  // still resolves `false` and `getPublicKey` still resolves `null` for a genuine
  // absence.
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
  });

  const { accounts, refreshAccounts, switchToAccount, createAccount: createAccountFn } = useOxyAccountGraph({
    isAuthenticated,
    tokenReady,
    initialized,
    oxyServices,
    sessionClient,
    syncFromClient,
    commitSession,
    queryClient,
    accountDialogControllerRef,
    clearSessionStateRef,
  });

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
      currentLanguages,
      currentLanguageMetadata,
      currentLanguageName,
      currentNativeLanguageName,
      hasIdentity,
      getPublicKey,
      signIn,
      signInWithPasskey,
      registerWithPasskey,
      addPasskey,
      removePasskey,
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
      sessionClient,
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
      currentLanguages,
      currentLanguageMetadata,
      currentLanguageName,
      currentNativeLanguageName,
      hasIdentity,
      getPublicKey,
      signIn,
      signInWithPasskey,
      registerWithPasskey,
      addPasskey,
      removePasskey,
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
      sessionClient,
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
  currentLanguage: 'en-US',
  currentLanguages: [],
  currentLanguageMetadata: null,
  currentLanguageName: 'English (United States)',
  currentNativeLanguageName: 'English (United States)',
  hasIdentity: () => Promise.resolve(false),
  getPublicKey: () => Promise.resolve(null),
  signIn: () => rejectMissingProvider<User>(),
  signInWithPasskey: () => rejectMissingProvider<void>(),
  registerWithPasskey: () => rejectMissingProvider<void>(),
  addPasskey: () => rejectMissingProvider<void>(),
  removePasskey: () => rejectMissingProvider<void>(),
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
  sessionClient: null,
  openAvatarPicker: () => {},
  accountDialogController: null,
  isAccountDialogOpen: false,
  openAccountDialog: () => {},
  closeAccountDialog: () => {},
  accounts: [],
  switchToAccount: () => rejectMissingProvider<void>(),
  refreshAccounts: () => rejectMissingProvider<void>(),
  createAccount: () => rejectMissingProvider<import('@oxyhq/core').AccountNode>(),
};

export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    return LOADING_STATE;
  }
  return context;
};

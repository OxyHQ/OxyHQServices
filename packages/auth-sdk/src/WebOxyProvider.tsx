/**
 * @oxyhq/auth — Web Authentication Provider (device-first).
 *
 * A THIN binding over the shared `@oxyhq/core` device-first session machinery:
 *   - `runSessionColdBoot` resolves the device's session on load with ZERO
 *     redirects — an unresolved boot ends signed-out and the app renders the
 *     in-app "Sign in with Oxy" screen (there is NO automatic navigation to any
 *     login page, ever).
 *   - `createWebAuthStateStore` persists the per-origin rotating refresh-token
 *     family so a reload restores the session locally.
 *   - the unified refresh handler + proactive scheduler keep the access token
 *     fresh (reactive 401/preflight + scheduled rotation).
 *   - `SessionClient` owns the server-authoritative device-session set
 *     (accounts, active session, cross-tab/-device realtime sync via socket).
 *
 * There is NO `CrossDomainAuth`, FedCM, `/sso` bounce, or silent-iframe path in
 * this provider anymore (device-first cutover). `signIn()` opens the in-app
 * {@link OxySignInModal}; it NEVER calls `window.location.assign` to an IdP.
 *
 * Zero React Native / Expo dependencies.
 */

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
import {
  OxyServices,
  runSessionColdBoot,
  createWebAuthStateStore,
  installAuthRefreshHandler,
  startTokenRefreshScheduler,
  refreshPersistedSession,
  createSessionClient,
  deviceStateToClientSessions,
  activeSessionIdOf,
  activeUserOf,
  accountIdsOf,
  logger,
} from '@oxyhq/core';
import type {
  User,
  ClientSession,
  AuthStateStore,
  PersistedAuthState,
  TokenTransport,
  DeviceBootSession,
  SignedOutReason,
} from '@oxyhq/core';
import type { DeviceSessionState } from '@oxyhq/contracts';
import { io } from 'socket.io-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { attachQueryPersistence, clearQueryCache, createQueryClient } from './hooks/queryClient';
import type { CommonsClaimResult } from './hooks/useCommonsSignIn';
import { OxySignInModal } from './components/OxySignInModal';
import {
  projectDeviceAccounts,
  activeAuthuserOf,
  type DeviceAccountView,
} from './session/deviceAccountsProjection';

/**
 * A committed sign-in session (modal password / 2FA / QR claim) handed to the
 * provider's shared commit path. The access token has already been planted on
 * `oxyServices` by the SDK method that produced it; the provider persists the
 * rotating refresh family (when supplied), registers + activates the account in
 * the `SessionClient`, and projects the resulting device state.
 */
export interface CommittedSignInSession {
  sessionId: string;
  userId: string;
  accessToken: string;
  /** Rotating refresh-token family head (trusted-lane logins only). */
  refreshToken?: string;
  expiresAt?: string;
  /** The fully-hydrated user, when the producing method returned one. */
  user?: User;
  /** Rotated device-attribution token to persist for this device. */
  deviceToken?: string;
}

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * The app's Oxy OAuth client id (ApplicationCredential publicKey), as supplied
   * via the `clientId` prop, normalized to a trimmed non-empty string or `null`.
   */
  clientId: string | null;
  activeSessionId: string | null;
  /** Device-session list projected from the `SessionClient`-owned state. */
  sessions: ClientSession[];
  /**
   * Every device-local account the `SessionClient` knows about, projected onto
   * {@link DeviceAccountView} and sorted by `authuser` ascending.
   */
  accounts: DeviceAccountView[];
  /** The active account's `authuser` slot, or `null` when signed out. */
  activeAuthuser: number | null;
  /**
   * Whether the sign-in modal owned by the provider is currently open. Consumers
   * that render their own sign-in UI can ignore this.
   */
  isSignInOpen: boolean;
}

export interface WebAuthActions {
  /**
   * Open the in-app "Sign in with Oxy" modal. NEVER navigates to an IdP. Safe to
   * call from an auth-guard render/effect — it only toggles local modal state, so
   * there is no redirect loop to break.
   */
  signIn: () => void;
  /** Close the in-app sign-in modal. */
  closeSignIn: () => void;
  /**
   * Sign out of this device entirely: revoke every account via the
   * server-authoritative `SessionClient` (`POST /session/device/signout`,
   * `{ all: true }`), then clear all local + persisted session state (including
   * the persisted refresh family).
   */
  signOut: () => Promise<void>;
  /** Switch to a different device session by its server-side session id. Throws when unknown. */
  switchSession: (sessionId: string) => Promise<void>;
  /** Switch to a different device-local account by its `authuser` index. Never rejects. */
  switchAccount: (authuser: number) => Promise<void>;
  /** Sign out a specific device-local account by its `authuser` index. Never rejects. */
  signOutAccount: (authuser: number) => Promise<void>;
  /** Sign out EVERY device-local account (equivalent to {@link signOut}). */
  signOutAll: () => Promise<void>;
  /** Full local + persisted teardown (no server call of its own). */
  clearSessionState: () => Promise<void>;
  /**
   * Commit a session claimed by the "Sign in with Oxy" QR handoff
   * (`useCommonsSignIn` calls this after `claimSessionByToken`).
   */
  commitClaimedSession: (claimed: CommonsClaimResult) => Promise<void>;
  /**
   * Commit a session produced by the in-app sign-in modal (password / 2FA).
   * Used by {@link OxySignInModal}; also usable by a consumer's own UI built on
   * `useOxySignIn`.
   */
  commitSignInSession: (session: CommittedSignInSession) => Promise<void>;
}

export interface WebOxyContextValue extends WebAuthState, WebAuthActions {
  oxyServices: OxyServices;
}

const WebOxyContext = createContext<WebOxyContextValue | null>(null);

/**
 * Do not warm-plant a stored access token with less than this remaining — it
 * would need an immediate refresh anyway. Matches the refresh lead window.
 */
const SESSION_HANDOFF_DEADLINE = 6000;

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
  /**
   * The app's Oxy OAuth client id (ApplicationCredential publicKey). Used to
   * identify this app for the "Sign in with Oxy" QR handoff and OAuth flows.
   */
  clientId?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: Error) => void;
  /**
   * Skip the automatic cold boot on mount. When set, the provider starts
   * signed-out (`isLoading:false`) and the app drives sign-in explicitly.
   */
  skipAutoCheck?: boolean;
}

/**
 * Web-only Oxy Provider.
 *
 * @example
 * ```tsx
 * import { WebOxyProvider, useAuth } from '@oxyhq/auth';
 *
 * function App() {
 *   return (
 *     <WebOxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
 *       <YourApp />
 *     </WebOxyProvider>
 *   );
 * }
 * ```
 */
export function WebOxyProvider({
  children,
  baseURL,
  clientId: clientIdProp,
  onAuthStateChange,
  onError,
  skipAutoCheck = false,
}: WebOxyProviderProps) {
  const clientId = useMemo(() => {
    const trimmed = clientIdProp?.trim();
    return trimmed ? trimmed : null;
  }, [clientIdProp]);

  const [oxyServices] = useState(
    () => new OxyServices({ baseURL, clientId: clientIdProp?.trim() || undefined }),
  );
  const [store] = useState<AuthStateStore>(() => createWebAuthStateStore());
  const [queryClient] = useState(() => createQueryClient());

  // Block first render until the persisted localStorage query cache is restored
  // (mirrors the RN OxyProvider). Persistence is attached inside the effect so
  // we can await the `restored` promise before exposing the client.
  const [isRestoring, setIsRestoring] = useState(true);
  useEffect(() => {
    let mounted = true;
    const { restored, unsubscribe } = attachQueryPersistence(queryClient);
    restored.finally(() => {
      if (mounted) setIsRestoring(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [queryClient]);

  // Auth state.
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(!skipAutoCheck);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<DeviceAccountView[]>([]);
  const [activeAuthuser, setActiveAuthuserState] = useState<number | null>(null);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [clientProjectedSessions, setClientProjectedSessions] = useState<ClientSession[] | null>(null);
  const sessions = useMemo<ClientSession[]>(() => clientProjectedSessions ?? [], [clientProjectedSessions]);

  const isAuthenticated = !!user;

  // Re-boot indirection: the SessionClient is built in the ref initializer below
  // (before the boot is defined), but its `onSessionAppeared` must re-run the cold
  // boot to self-acquire when a sibling tab signs in on this device. A ref bridges
  // the ordering; it is assigned right after `runBoot` is declared.
  const runBootRef = useRef<(() => Promise<void>) | null>(null);

  // Device-first web `TokenTransport`: when the `SessionClient` applies a state
  // and no active token is held (e.g. a cross-tab push), mint one by rotating
  // the persisted refresh family. No native shared-key arm (web-only). Best
  // effort — must never throw out of the SessionClient state/socket path.
  const sessionClientPairRef = useRef<ReturnType<typeof createSessionClient> | null>(null);
  if (!sessionClientPairRef.current) {
    const transport: TokenTransport = {
      async ensureActiveToken(): Promise<void> {
        try {
          if (oxyServices.getAccessToken()) return;
          await refreshPersistedSession({ oxy: oxyServices, store, allowSharedKeyFallback: false });
        } catch (transportError) {
          logger.warn(
            'ensureActiveToken failed (non-fatal)',
            { component: 'WebOxyProvider', method: 'ensureActiveToken' },
            transportError,
          );
        }
      },
    };
    // `io` (socket.io-client, a real @oxyhq/auth dependency) is statically
    // imported + injected so realtime sync survives Vite/Rolldown bundling of the
    // published core dist (core's lazy dynamic import of a bare specifier does
    // not resolve reliably there).
    sessionClientPairRef.current = createSessionClient(oxyServices, transport, io, {
      // Web is always `*.oxy.so`: the first-party `oxy_device` cookie rides the
      // same-site socket handshake, so an idle signed-out tab can join its
      // `device:<id>` room and receive a sibling's sign-in push.
      signedOutSocketAuth: () => true,
      onSessionAppeared: () => {
        void runBootRef.current?.();
      },
    });
  }
  const { client: sessionClient, host: sessionClientHost } = sessionClientPairRef.current;

  /**
   * Full local + persisted session teardown. Shared by an explicit sign-out and
   * by `syncFromClient`'s zero-account branch (a remote device signout-all).
   * Clears the SessionClient projection, wipes the React Query cache (in-memory
   * + persisted blob), and clears the persisted refresh family + device token.
   */
  const clearSessionState = useCallback(async () => {
    setUser(null);
    setActiveSessionId(null);
    setClientProjectedSessions([]);
    setAccounts([]);
    setActiveAuthuserState(null);
    sessionClientHost.setCurrentAccountId(null);
    clearQueryCache(queryClient);
    // Clear the persisted refresh family so a reload does not try to restore a
    // session that no longer exists. The long-lived device token also goes on an
    // explicit full sign-out.
    await store.clear();
    await store.clearDeviceToken();
  }, [queryClient, sessionClientHost, store]);

  /**
   * Project `client.getState()` onto every exposed session field. The
   * `SessionClient` device-session set is the sole authority for
   * `user` / `activeSessionId` / `sessions` / `accounts` / `activeAuthuser`.
   */
  const syncFromClient = useCallback(async (): Promise<void> => {
    const state = sessionClient.getState();
    if (state === null) {
      return;
    }
    if (state.accounts.length === 0) {
      // A remote (or local) device signout-all removed the last account: route
      // through the same full teardown a local sign-out uses.
      await clearSessionState();
      return;
    }
    // Last-write-wins guard: capture the revision this fetch is for, then bail
    // if the client's state has moved on after the await.
    const capturedRevision = state.revision;
    const ids = accountIdsOf(state);
    let users: User[] = [];
    try {
      users = ids.length > 0 ? await oxyServices.getUsersByIds(ids) : [];
    } catch (fetchError) {
      // Do NOT bail to an empty account list: a transient batch-profile failure
      // must still LIST the device accounts so the chooser shows them (rows
      // project with a null user → the account-chooser renders a handle
      // fallback). Profiles fill in on the next successful sync. Leaving `users`
      // empty preserves the already-resolved active `user` (the `if (activeUser)`
      // guard below never clears it).
      logger.warn(
        'syncFromClient: failed to resolve account profiles — listing accounts without profiles',
        { component: 'WebOxyProvider', method: 'syncFromClient' },
        fetchError as unknown,
      );
    }
    const latest = sessionClient.getState();
    if (!latest || latest.revision !== capturedRevision) {
      return;
    }
    const usersById = new Map(users.map((resolvedUser) => [resolvedUser.id, resolvedUser]));
    setClientProjectedSessions(deviceStateToClientSessions(latest, usersById));
    setActiveSessionId(activeSessionIdOf(latest));
    const activeUser = activeUserOf(latest, usersById);
    if (activeUser) {
      setUser(activeUser);
    }
    const expSeconds = oxyServices.getAccessTokenExpiry();
    setAccounts(
      projectDeviceAccounts(latest, usersById, {
        accessToken: oxyServices.getAccessToken(),
        expiresAt: expSeconds !== null ? new Date(expSeconds * 1000).toISOString() : null,
      }),
    );
    setActiveAuthuserState(activeAuthuserOf(latest));
    sessionClientHost.setCurrentAccountId(latest.activeAccountId);
  }, [oxyServices, sessionClient, sessionClientHost, clearSessionState]);

  useEffect(() => {
    return sessionClient.subscribe(() => {
      void syncFromClient();
    });
  }, [sessionClient, syncFromClient]);

  const handleAuthError = useCallback((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
    setError(errorMessage);
    setIsLoading(false);
    onError?.(err instanceof Error ? err : new Error(errorMessage));
  }, [onError]);

  // Reactive refresh handler (401/preflight rotation) + proactive scheduler.
  // Both live in `@oxyhq/core` (`refresh.ts`) — the provider only installs them.
  useEffect(() => {
    const dispose = installAuthRefreshHandler({ oxy: oxyServices, store, allowSharedKeyFallback: false });
    return dispose;
  }, [oxyServices, store]);

  useEffect(() => {
    const scheduler = startTokenRefreshScheduler(oxyServices);
    return () => scheduler.dispose();
  }, [oxyServices]);

  /**
   * Hand a cold-boot-recovered session off to the `SessionClient` and project
   * it. The access token is already planted by `runSessionColdBoot`; register
   * the account into the device set, start the client (idempotent — bootstraps
   * device state + connects the socket), and project. A direct profile fetch
   * guarantees `user` is populated even if the projection's batch fetch fails.
   */
  const commitBootSession = useCallback(async (session: DeviceBootSession) => {
    setActiveSessionId(session.sessionId);
    setError(null);
    // Authoritative active-account user (single fetch); the SessionClient
    // projection refines the multi-account list.
    try {
      const bootedUser = await oxyServices.getUserById(session.userId);
      if (bootedUser) {
        setUser(bootedUser);
      }
    } catch (userFetchError) {
      logger.warn(
        'commitBootSession: active-account profile fetch failed',
        { component: 'WebOxyProvider', method: 'commitBootSession' },
        userFetchError,
      );
    }
    try {
      await sessionClient.addCurrentAccount();
      await sessionClient.start();
      await syncFromClient();
    } catch (handoffError) {
      logger.warn(
        'commitBootSession: SessionClient handoff failed',
        { component: 'WebOxyProvider', method: 'commitBootSession' },
        handoffError,
      );
    }
    setIsLoading(false);
  }, [oxyServices, sessionClient, syncFromClient]);

  /**
   * Commit a freshly-authenticated session (modal password / 2FA / QR claim).
   * The token is already planted by the producing SDK method; persist the
   * rotating refresh family (when supplied), register + ACTIVATE the account in
   * the `SessionClient` (explicit user intent), and project.
   */
  const commitSignInSession = useCallback(async (session: CommittedSignInSession) => {
    if (session.accessToken) {
      oxyServices.setTokens(session.accessToken);
    }
    // Persist the per-origin rotating refresh family (trusted-lane logins) so a
    // reload restores locally with no redirect.
    if (session.refreshToken) {
      const next: PersistedAuthState = {
        sessionId: session.sessionId,
        refreshToken: session.refreshToken,
        userId: session.userId,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
      };
      const deviceToken = session.deviceToken ?? (await store.loadDeviceToken()) ?? undefined;
      if (deviceToken) {
        next.deviceToken = deviceToken;
      }
      await store.save(next);
    }
    if (session.deviceToken) {
      await store.saveDeviceToken(session.deviceToken);
    }
    setActiveSessionId(session.sessionId);
    if (session.user) {
      setUser(session.user);
    }
    setError(null);
    setIsSignInOpen(false);
    try {
      await sessionClient.registerAndActivate(session.userId);
      await sessionClient.start();
      await syncFromClient();
    } catch (handoffError) {
      logger.warn(
        'commitSignInSession: SessionClient handoff failed',
        { component: 'WebOxyProvider', method: 'commitSignInSession' },
        handoffError,
      );
    }
    if (!session.user) {
      // The producing method did not return a hydrated user (e.g. a bare
      // session arm): resolve it so `isAuthenticated` flips even if the
      // projection's batch fetch failed.
      try {
        const resolved = await oxyServices.getUserById(session.userId);
        if (resolved) {
          setUser(resolved);
        }
      } catch (userFetchError) {
        logger.warn(
          'commitSignInSession: profile fetch failed',
          { component: 'WebOxyProvider', method: 'commitSignInSession' },
          userFetchError,
        );
      }
    }
    setIsLoading(false);
  }, [oxyServices, sessionClient, syncFromClient, store]);

  /**
   * Commit a session claimed by the "Sign in with Oxy" QR handoff. The claim
   * already returns a fully-hydrated session; funnel it through the shared
   * commit path so it is indistinguishable from a modal sign-in.
   */
  const commitClaimedSession = useCallback(async (claimed: CommonsClaimResult) => {
    await commitSignInSession({
      sessionId: claimed.sessionId,
      userId: claimed.user.id,
      accessToken: claimed.accessToken,
      expiresAt: claimed.expiresAt,
      user: claimed.user,
    });
  }, [commitSignInSession]);

  // Cold boot — device-first, zero-redirect. Delegates the entire ordered
  // resolution to core's `runSessionColdBoot`; the provider only reacts to the
  // outcome (`onSession` → commit; `onSignedOut` → open the signed-out realtime
  // channel + stop loading). No `signIn` navigation, no SSO bounce. Shared by the
  // mount effect and `onSessionAppeared`'s re-acquisition (a sibling sign-in).
  const runBoot = useCallback(async () => {
    await runSessionColdBoot({
      oxy: oxyServices,
      store,
      platform: { isWeb: true, isNative: false },
      onSession: async (session) => {
        await commitBootSession(session);
      },
      onSignedOut: () => {
        setIsLoading(false);
        // Join this idle tab's `device:<id>` room (via the first-party
        // `oxy_device` cookie) so a sibling's sign-in wakes it. Idempotent +
        // best-effort — never throw out of the boot.
        void sessionClient.start().catch((startError) => {
          logger.debug(
            'signed-out socket start failed (non-fatal)',
            { component: 'WebOxyProvider', method: 'coldBoot' },
            startError,
          );
        });
      },
      onStepError: (id, stepError) => {
        logger.debug(
          'cold-boot step did not resolve a session',
          { component: 'WebOxyProvider', method: 'coldBoot', step: id },
          stepError,
        );
      },
    });
  }, [oxyServices, store, commitBootSession, sessionClient]);
  runBootRef.current = runBoot;

  useEffect(() => {
    if (skipAutoCheck) {
      setIsLoading(false);
      return;
    }
    let mounted = true;

    // Safety net: if a step stalls, stop loading after a bound.
    const timeoutId = setTimeout(() => {
      if (mounted) setIsLoading(false);
    }, SESSION_HANDOFF_DEADLINE * 2);

    runBoot()
      .catch((bootError) => {
        if (mounted) handleAuthError(bootError);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [skipAutoCheck, runBoot, handleAuthError]);

  useEffect(() => {
    onAuthStateChange?.(user);
  }, [user, onAuthStateChange]);

  const signIn = useCallback(() => {
    setError(null);
    setIsSignInOpen(true);
  }, []);

  const closeSignIn = useCallback(() => {
    setIsSignInOpen(false);
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      try {
        await sessionClient.signOut({ all: true });
      } catch (sessionSignOutError) {
        logger.warn(
          'signOut: SessionClient device signout failed (continuing with local cleanup)',
          { component: 'WebOxyProvider', method: 'signOut' },
          sessionSignOutError as unknown,
        );
      }
      await clearSessionState();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed';
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [sessionClient, clearSessionState, onError]);

  const switchAccount = useCallback(async (authuser: number) => {
    setError(null);
    try {
      const targetAccountId = sessionClient
        .getState()
        ?.accounts.find((account) => account.authuser === authuser)?.accountId;
      if (!targetAccountId) {
        throw new Error(`No device account found for authuser=${authuser}`);
      }
      await sessionClient.switchAccount(targetAccountId);
      await syncFromClient();
    } catch (err) {
      handleAuthError(err);
    }
  }, [sessionClient, syncFromClient, handleAuthError]);

  const switchSession = useCallback(async (sessionId: string) => {
    const targetAccountId = sessionClient
      .getState()
      ?.accounts.find((account) => account.sessionId === sessionId)?.accountId;
    if (!targetAccountId) {
      const err = new Error(`No device account found for session "${sessionId}"`);
      handleAuthError(err);
      throw err;
    }
    try {
      await sessionClient.switchAccount(targetAccountId);
      await syncFromClient();
    } catch (err) {
      handleAuthError(err);
      throw err;
    }
  }, [sessionClient, syncFromClient, handleAuthError]);

  const signOutAccount = useCallback(async (authuser: number) => {
    setError(null);
    try {
      const targetAccountId = sessionClient
        .getState()
        ?.accounts.find((account) => account.authuser === authuser)?.accountId;
      if (!targetAccountId) {
        throw new Error(`No device account found for authuser=${authuser}`);
      }
      await sessionClient.signOut({ accountId: targetAccountId });
      await syncFromClient();
    } catch (err) {
      handleAuthError(err);
    }
  }, [sessionClient, syncFromClient, handleAuthError]);

  const signOutAll = useCallback(async () => {
    await signOut();
  }, [signOut]);

  // Tear down the SessionClient's socket + token subscription on unmount.
  useEffect(() => {
    return () => { sessionClient.stop(); };
  }, [sessionClient]);

  const contextValue = useMemo<WebOxyContextValue>(() => ({
    user,
    isAuthenticated,
    isLoading,
    error,
    clientId,
    activeSessionId,
    sessions,
    accounts,
    activeAuthuser,
    isSignInOpen,
    oxyServices,
    signIn,
    closeSignIn,
    signOut,
    switchSession,
    switchAccount,
    signOutAccount,
    signOutAll,
    clearSessionState,
    commitClaimedSession,
    commitSignInSession,
  }), [
    user, isAuthenticated, isLoading, error, clientId, activeSessionId, sessions,
    accounts, activeAuthuser, isSignInOpen, oxyServices,
    signIn, closeSignIn, signOut, switchSession, switchAccount, signOutAccount,
    signOutAll, clearSessionState, commitClaimedSession, commitSignInSession,
  ]);

  // Mirror the RN OxyProvider: don't expose the QueryClient (or mount children)
  // until the persisted cache has been restored.
  if (isRestoring) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WebOxyContext.Provider value={contextValue}>
        {children}
        <OxySignInModal open={isSignInOpen} onClose={closeSignIn} />
      </WebOxyContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * Hook to access the full Web Oxy context.
 */
export function useWebOxy(): WebOxyContextValue {
  const context = useContext(WebOxyContext);
  if (!context) {
    throw new Error('useWebOxy must be used within WebOxyProvider');
  }
  return context;
}

/**
 * Non-throwing variant of {@link useWebOxy}: returns the Web Oxy context when
 * rendered inside a {@link WebOxyProvider}, or `null` otherwise. Used by hooks
 * (e.g. `useCommonsSignIn`, `useOxySignIn`) that work BOTH inside the provider
 * (zero-config) and standalone (explicit `oxyServices` / `clientId`).
 */
export function useWebOxyOptional(): WebOxyContextValue | null {
  return useContext(WebOxyContext);
}

/**
 * Hook for authentication in web apps.
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   const { user, isAuthenticated, signIn, signOut } = useAuth();
 *   if (!isAuthenticated) return <button onClick={signIn}>Sign in</button>;
 *   return <button onClick={signOut}>Sign out</button>;
 * }
 * ```
 */
export function useAuth() {
  const ctx = useWebOxy();
  return {
    user: ctx.user,
    isAuthenticated: ctx.isAuthenticated,
    isLoading: ctx.isLoading,
    isReady: !ctx.isLoading,
    error: ctx.error,
    clientId: ctx.clientId,
    activeSessionId: ctx.activeSessionId,
    sessions: ctx.sessions,
    accounts: ctx.accounts,
    activeAuthuser: ctx.activeAuthuser,
    isSignInOpen: ctx.isSignInOpen,
    signIn: ctx.signIn,
    closeSignIn: ctx.closeSignIn,
    signOut: ctx.signOut,
    switchSession: ctx.switchSession,
    switchAccount: ctx.switchAccount,
    signOutAccount: ctx.signOutAccount,
    signOutAll: ctx.signOutAll,
    oxyServices: ctx.oxyServices,
  };
}

export default WebOxyProvider;

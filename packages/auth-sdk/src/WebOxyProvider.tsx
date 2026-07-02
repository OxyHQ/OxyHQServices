/**
 * @oxyhq/auth — Web Authentication Provider
 *
 * Clean implementation with ZERO React Native dependencies.
 * Provides FedCM and redirect authentication methods.
 * Session state (accounts, active session/token, sign-out, in-session token
 * refresh) is owned entirely by the server-authoritative `SessionClient`
 * (`@oxyhq/core`) — there is no local `AuthManager` / `oxy_rt` cookie-slot
 * registry (Fase 4 cutover, Task 5: `AuthManager` retired).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  OxyServices,
  CrossDomainAuth,
  resolveCentralAuthUrl,
  runColdBoot,
  logger,
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoNoSessionKey,
  ssoGuardKey,
  ssoDestKey,
  ssoAttemptedKey,
  ssoPriorSessionKey,
  ssoSignedOutKey,
  silentRestoreSuppressed,
  isCentralIdPOrigin,
  guardActive,
  allowSsoBounce,
  buildSsoBounceUrl,
  consumeSsoReturn,
  createSessionClient,
  deviceStateToClientSessions,
  activeSessionIdOf,
  activeUserOf,
  accountIdsOf,
  autoDetectAuthWebUrl,
} from '@oxyhq/core';
import type {
  User,
  SessionLoginResponse,
  ClientSession,
  AuthManagerAccount,
  ColdBootStep,
  ColdBootOutcome,
} from '@oxyhq/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { attachQueryPersistence, clearQueryCache, createQueryClient } from './hooks/queryClient';
import { isWebBrowser } from './hooks/useWebSSO';
import type { CommonsClaimResult } from './hooks/useCommonsSignIn';
import { createWebTokenTransport } from './session/tokenTransport';
import { createWebAuthRefreshHandler, startTokenRefreshScheduler } from './session/tokenRefresh';
import { projectAuthManagerAccounts, activeAuthuserOf } from './session/deviceAccountsProjection';

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * The app's Oxy OAuth client id (ApplicationCredential publicKey), as
   * supplied via the `clientId` prop. Used to identify this app in OAuth
   * authorize / consent flows (issue #214). Normalized to a trimmed non-empty
   * string, or `null` when the consuming app did not configure one.
   */
  clientId: string | null;
  activeSessionId: string | null;
  /**
   * Device-session list projected from the `SessionClient`-owned
   * `DeviceSessionState` (`@oxyhq/core`'s `deviceStateToClientSessions`).
   */
  sessions: ClientSession[];
  /**
   * Every device-local account `SessionClient` knows about (the server's
   * `DeviceSessionState.accounts`), projected onto the legacy
   * `AuthManagerAccount` shape and sorted by `authuser` ascending. Populated
   * by `syncFromClient()` — the SessionClient device-session set is the SOLE
   * authority; there is no separate cookie-slot registry to go stale
   * against. Non-active accounts carry an empty-string `accessToken` (see
   * `projectAuthManagerAccounts`'s doc comment for why).
   */
  accounts: AuthManagerAccount[];
  /** The active account's `authuser` slot, or `null` when no account is signed in. */
  activeAuthuser: number | null;
}

export interface WebAuthActions {
  /**
   * Sign in via the preferred method (auto / fedcm / redirect).
   */
  signIn: () => Promise<void>;
  signInWithFedCM: () => Promise<void>;
  signInWithRedirect: () => void;
  /**
   * Sign out of this device entirely: revokes every account this device
   * knows about via the server-authoritative `SessionClient`
   * (`POST /session/device/signout` with `{ all: true }`), then tears down
   * every local/persisted piece of session state. See `clearSessionState`'s
   * doc comment for the exact cleanup steps — `signOut` runs them via that
   * shared helper.
   */
  signOut: () => Promise<void>;
  isFedCMSupported: () => boolean;
  /**
   * Switch to a different device session by its server-side session id.
   * Resolves the target account from the `SessionClient` device state and
   * switches via `sessionClient.switchAccount()`. THROWS when the session id
   * is not one of this device's accounts (never silently no-ops) — this is
   * an account-SWITCH between accounts already registered on this device,
   * never a way to hydrate a freshly-claimed session (use
   * `commitClaimedSession` for that).
   */
  switchSession: (sessionId: string) => Promise<void>;
  /**
   * Multi-account: switch to a different device-local account by its LEGACY
   * `authuser` index. Maps the index to its `SessionClient` device-account
   * id and switches via `sessionClient.switchAccount()`. Never rejects — a
   * failed lookup or switch surfaces via `error`/`onError`.
   */
  switchAccount: (authuser: number) => Promise<void>;
  /**
   * Multi-account: sign out a specific device-local account by its LEGACY
   * `authuser` index. Resolves the index to its `SessionClient` device
   * account id and revokes it via `sessionClient.signOut({accountId})` — the
   * SOLE revocation authority. If the active account was signed out, the
   * server promotes the next remaining account to active (or, if none
   * remain, `syncFromClient`'s zero-account branch routes through
   * `clearSessionState()` — the same full local teardown a `signOut()` uses).
   */
  signOutAccount: (authuser: number) => Promise<void>;
  /**
   * Multi-account: sign out EVERY device-local account at once. Equivalent to
   * `signOut()`.
   */
  signOutAll: () => Promise<void>;
  /**
   * Full local session teardown (no server-side `SessionClient` revocation
   * call of its own — callers that need server revocation call
   * `signOut()`/`signOutAll()`/`signOutAccount()`, which call this after
   * revoking). Also the target of `syncFromClient`'s zero-account branch, so
   * a remote full sign-out reaches the same cleanup.
   */
  clearSessionState: () => Promise<void>;
  /**
   * Commit a session claimed out-of-band by the "Sign in with Oxy" (QR)
   * handoff — `useCommonsSignIn` calls this after `claimSessionByToken` so the
   * device-flow result flows through the SAME commit path as FedCM / redirect
   * (token plant + device-set registration). Surfaced on the context so the
   * hook can default to it when used zero-config inside the provider.
   */
  commitClaimedSession: (claimed: CommonsClaimResult) => Promise<void>;
}

export interface WebOxyContextValue extends WebAuthState, WebAuthActions {
  oxyServices: OxyServices;
  crossDomainAuth: CrossDomainAuth;
}

const WebOxyContext = createContext<WebOxyContextValue | null>(null);

/**
 * Discriminated union carried by each cold-boot step's `kind: 'session'`
 * result. The `method` tag lets the post-runner switch reproduce the correct
 * per-branch commit — every winning ladder step funnels through
 * `handleAuthSuccess` (which now also registers the recovered account into
 * the server-authoritative `SessionClient` device-session set):
 *   - `redirect` / `fedcm` → `handleAuthSuccess(session, method)`.
 *   - `sso` → `commitSsoSessionOnceRef.current(session)` (itself a thin
 *     dedup wrapper over `handleAuthSuccess(session, 'credentials')`).
 *   - `silent-iframe` → `handleAuthSuccess(session, 'credentials')` — a
 *     non-interactive silent restore, tagged the same as any other
 *     zero-UI commit (mirrors `commitClaimedSession`).
 *
 * Every variant carries a fully-hydrated `SessionLoginResponse` (real user,
 * never the empty-id placeholder). There is no `cookie` variant anymore — the
 * oxy_rt refresh-cookie cold-boot restore was retired in favour of the
 * `silent-iframe` step (see the steps array below for the rationale).
 */
type ColdBootSession = {
  method: 'redirect' | 'fedcm' | 'sso' | 'silent-iframe';
  session: SessionLoginResponse;
};

/**
 * The precise result of the `sso-return` step — always the `sso` variant or
 * `null`. Returned by `runSsoReturn` so both call sites (the cold-boot step and
 * the bfcache `pageshow` handler) can read `.session` without narrowing the
 * full {@link ColdBootSession} union.
 */
type SsoReturnSession = { method: 'sso'; session: SessionLoginResponse };

/**
 * Module-level run-once guard for the central FedCM silent sign-in step.
 *
 * The init effect runs again whenever the provider remounts (route change,
 * StrictMode double-invoke, error-boundary recovery). The redirect-callback
 * and silent-iframe steps are cheap and idempotent, but the FedCM silent step
 * triggers `navigator.credentials.get` (`mediation: 'silent'`) against the
 * central IdP, which must fire AT MOST ONCE per page load. Otherwise a remount
 * storm becomes a credential-request storm.
 *
 * Keyed on `origin|baseURL` (the same signature `useWebSSO.ssoSignature` uses)
 * so two providers on the same origin pointed at different APIs each get their
 * own one-shot budget, while same-origin same-API remounts share one. The set
 * is intentionally never cleared: only a fresh page load (a fresh module scope)
 * can change the IdP session state.
 */
const fedcmSilentSignInAttempted = new Set<string>();

/**
 * Per-step fail-fast budget for the cold-boot silent iframe (`silentSignIn`
 * against the per-apex `/auth/silent` host).
 *
 * This step ONLY succeeds when a durable per-apex `fedcm_session` cookie
 * exists (established by a prior `/sso` bounce). On the common reload of a
 * logged-out tab the iframe never posts a message, so the full wait would be
 * dead latency in front of the terminal `/sso` bounce. `silentSignIn` already
 * fails fast on a load error via `iframe.onerror`; this caps the no-message
 * case. Mirrors the services `OxyContext` constant of the same name.
 */
const SILENT_IFRAME_TIMEOUT = 2500;

/**
 * HARD overall deadline (ms) for the entire cold-boot step loop —
 * defense-in-depth so a single non-settling step can never hang auth
 * resolution forever (mirrors the services `OxyContext` regression this
 * guards against: a `navigator.credentials.get()` that ignored its abort
 * signal left a step's promise unsettled, so `runColdBoot` never advanced to
 * the terminal `/sso` bounce).
 *
 * Every step already bounds its own network work (`SILENT_IFRAME_TIMEOUT`,
 * FedCM's own settle budget), so on a healthy load the first recovering step
 * wins in a single round-trip and the chain short-circuits long before this
 * fires. Chosen smaller than the outer `INIT_TIMEOUT_MS` safety net below so
 * that, on regression, `runColdBoot` still unwinds to the terminal
 * `sso-bounce` step (whose navigation side effect runs synchronously) ahead
 * of the outer backstop flipping `isLoading` false.
 */
const COLD_BOOT_OVERALL_DEADLINE = 12000;

/**
 * How long cold boot WAITS for the post-ladder `SessionClient` handoff
 * (`addCurrentAccount` + `start` + `syncFromClient`) before it stops
 * blocking. Once a ladder step planted a token the user is already
 * authenticated (`handleAuthSuccess` already flipped `isLoading` false) — the
 * handoff only populates the multi-account/device-session projection, which
 * also arrives via the socket subscription wired in the `useEffect` above. On
 * a slow/unresponsive backend the handoff keeps running in the background and
 * projects when it lands, rather than delaying anything user-visible.
 * Mirrors the services `OxyContext` constant of the same name.
 */
const SESSION_HANDOFF_DEADLINE = 6000;

/**
 * Build the run-once signature for the silent sign-in guard. Matches
 * `useWebSSO.ssoSignature` exactly: `${origin}|${baseURL}`.
 */
function silentSignInKey(oxyServices: OxyServices): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'no-origin';
  let baseURL = '';
  try {
    baseURL = oxyServices.getBaseURL?.() ?? '';
  } catch {
    baseURL = '';
  }
  return `${origin}|${baseURL}`;
}

/**
 * Clear all per-origin SSO bounce sessionStorage keys. Called ONLY on EXPLICIT
 * user sign-out (`signOut` / `clearSessionState`) — never on a cold-boot
 * failure path — so a fresh deliberate sign-in can re-probe the central IdP.
 * Clearing on cold-boot failure would reintroduce the redirect loop.
 *
 * No-ops off-web and on any storage failure (best-effort).
 */
function clearSsoBounceStateWeb(): void {
  if (!isWebBrowser()) return;
  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    const origin = window.location.origin;
    storage.removeItem(ssoAttemptedKey(origin));
    storage.removeItem(ssoNoSessionKey(origin));
    storage.removeItem(ssoGuardKey(origin));
    storage.removeItem(ssoStateKey(origin));
    storage.removeItem(ssoDestKey(origin));
  } catch {
    // Best-effort; swallow SecurityError (e.g. Safari private mode).
  }
}

/**
 * Read the DURABLE "this origin has had a signed-in Oxy session before" hint
 * from `localStorage`. Drives the smart {@link allowSsoBounce} gate: a returning
 * visitor (hint present) whose cookie restore came back empty cross-domain
 * still earns ONE terminal `/sso` establish bounce, while a truly first-time
 * anonymous visitor is never force-redirected. Returns `false` off-web and on
 * any storage error (fail safe toward anonymous-browse).
 */
/**
 * Fail-safe accessor for `window.localStorage`. Reading the PROPERTY itself
 * (`window.localStorage`) can throw a `SecurityError` synchronously in
 * opaque-origin / sandboxed iframes or when storage is disabled — BEFORE any
 * `getItem`. Callers that pass the store to a helper (rather than accessing it
 * inside their own try) MUST go through this so that property access can't
 * escape unguarded (PR #462). Returns `null` off-web / on any access error.
 */
function getLocalStorageWeb(): Storage | null {
  if (!isWebBrowser()) return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function hasPriorSessionWeb(): boolean {
  if (!isWebBrowser()) return false;
  try {
    return window.localStorage.getItem(ssoPriorSessionKey(window.location.origin)) === '1';
  } catch {
    return false;
  }
}

/**
 * Set the durable prior-session hint. Called whenever a session is established
 * or restored. Best-effort; no-ops off-web and swallows storage errors.
 */
function markPriorSessionWeb(): void {
  if (!isWebBrowser()) return;
  try {
    window.localStorage.setItem(ssoPriorSessionKey(window.location.origin), '1');
  } catch {
    // Best-effort; swallow QuotaExceededError / SecurityError (private mode).
  }
}

/**
 * Clear the durable prior-session hint. Called ONLY on EXPLICIT full sign-out
 * (`signOut` / `clearSessionState`) — never on a cold-boot failure path — so the
 * next cold boot treats this device as a first-time anonymous visitor. The
 * passive cookie-expiry path leaves it intact so an expired session still
 * recovers via a returning-user bounce. No-ops off-web / on storage failure.
 */
function clearPriorSessionWeb(): void {
  if (!isWebBrowser()) return;
  try {
    window.localStorage.removeItem(ssoPriorSessionKey(window.location.origin));
  } catch {
    // Best-effort.
  }
}

/**
 * Set the durable "deliberately signed out" flag (core {@link ssoSignedOutKey}).
 * Called ONLY on EXPLICIT full sign-out so the next cold boot does not silently
 * re-mint a session from a still-live IdP session via `fedcm-silent`. Cleared by
 * any deliberate sign-in (see {@link clearSignedOutWeb}). No-ops off-web / on
 * storage failure (best-effort).
 */
function markSignedOutWeb(): void {
  if (!isWebBrowser()) return;
  try {
    window.localStorage.setItem(ssoSignedOutKey(window.location.origin), '1');
  } catch {
    // Best-effort; swallow QuotaExceededError / SecurityError (private mode).
  }
}

/**
 * Clear the durable "deliberately signed out" flag. Called on ANY deliberate
 * sign-in so a real sign-in fully re-enables automatic silent restore — no
 * "stuck signed out" state. No-ops off-web / on storage failure.
 */
function clearSignedOutWeb(): void {
  if (!isWebBrowser()) return;
  try {
    window.localStorage.removeItem(ssoSignedOutKey(window.location.origin));
  } catch {
    // Best-effort.
  }
}

/**
 * Whether AUTOMATIC silent restore is suppressed because the user deliberately
 * signed out (durable flag, read via the core {@link silentRestoreSuppressed}
 * predicate). Gates the `fedcm-silent` cold-boot step. Returns `false` off-web /
 * on storage failure (fail safe toward normal restore).
 */
function silentRestoreSuppressedWeb(): boolean {
  const storage = getLocalStorageWeb();
  if (!storage) return false;
  return silentRestoreSuppressed(storage, window.location.origin);
}

function isOnSsoCallbackPath(): boolean {
  return isWebBrowser() && window.location.pathname === SSO_CALLBACK_PATH;
}

const useBrowserLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
  /**
   * The FAPI (Federated Auth API / IdP) origin. When omitted, the provider
   * auto-detects `https://auth.<rp-domain>` from `window.location.hostname`
   * so an RP only needs to CNAME `auth.<rp-domain>` → the central IdP and
   * everything else (FedCM config URL, redirect URL) follows.
   * Pass explicitly to override (e.g. point at a staging IdP).
   */
  authWebUrl?: string;
  /**
   * The app's Oxy OAuth client id (ApplicationCredential publicKey). Used to
   * identify this app in OAuth authorize / consent flows (issue #214).
   *
   * Stored on `OxyServices.config.clientId` and surfaced on the web context as
   * `clientId`. Purely declarative — unrelated to the cross-domain
   * `/sso?client_id=<rp-origin>` bounce, which is left untouched.
   */
  clientId?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: Error) => void;
  preferredAuthMethod?: 'auto' | 'fedcm' | 'redirect';
  skipAutoCheck?: boolean;
}

/**
 * Web-only Oxy Provider
 *
 * Provides authentication context for pure web applications (React, Next.js, Vite).
 * Supports FedCM and redirect authentication methods.
 *
 * @example
 * ```tsx
 * import { WebOxyProvider, useAuth } from '@oxyhq/auth';
 *
 * function App() {
 *   return (
 *     <WebOxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </WebOxyProvider>
 *   );
 * }
 * ```
 */
export function WebOxyProvider({
  children,
  baseURL,
  authWebUrl,
  clientId: clientIdProp,
  onAuthStateChange,
  onError,
  preferredAuthMethod = 'auto',
  skipAutoCheck = false,
}: WebOxyProviderProps) {
  // Normalize the app's OAuth client id to a trimmed non-empty string, or
  // `null` when the consumer did not configure one. Surfaced on the web
  // context as `clientId` and stored on `OxyServices.config.clientId` for
  // later OAuth-authorize use (issue #214).
  const clientId = useMemo(() => {
    const trimmed = clientIdProp?.trim();
    return trimmed ? trimmed : null;
  }, [clientIdProp]);
  const [oxyServices] = useState(
    // Central cross-domain SSO targets ONE IdP (`auth.oxy.so`). Resolve the
    // auth web URL via the central default — an explicit `authWebUrl` still
    // wins (e.g. to point at a staging IdP). `clientId` is stored on the
    // config for later OAuth-authorize use; it does NOT affect SSO bounce.
    () => new OxyServices({
      baseURL,
      authWebUrl: resolveCentralAuthUrl(authWebUrl),
      clientId: clientIdProp?.trim() || undefined,
    })
  );
  const [crossDomainAuth] = useState(() => new CrossDomainAuth(oxyServices));
  const [queryClient] = useState(() => createQueryClient());

  // Block first render until the persisted localStorage cache has been
  // restored — mirrors the RN OxyProvider pattern. Without this gate the
  // first paint observes an empty cache and any consumer reading
  // `getQueryData(...)` synchronously (or using `placeholderData: 'previous'`
  // gating) misses the persisted blob.
  //
  // Persistence is attached inside the same effect so we can hold a
  // reference to the `restored` promise and only flip `isRestoring` to
  // false once it settles (success OR failure). Detach on unmount so HMR
  // doesn't leak subscriptions.
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

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(!skipAutoCheck);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [ssoCallbackIntercepting, setSsoCallbackIntercepting] = useState(false);

  // Multi-account state — projected from the `SessionClient` device-session
  // set by `syncFromClient()` (Fase 4 cutover, Task 5.1). `SessionClient` is
  // the SOLE authority; there is no separate cookie-path registry to keep in
  // sync or go stale against.
  const [accounts, setAccounts] = useState<AuthManagerAccount[]>([]);
  const [activeAuthuser, setActiveAuthuserState] = useState<number | null>(null);

  /**
   * Sessions projected from the `SessionClient`. `null` until `syncFromClient`
   * has applied a state at least once (before cold boot resolves); the public
   * `sessions` field falls back to `[]` in that window.
   */
  const [clientProjectedSessions, setClientProjectedSessions] = useState<ClientSession[] | null>(null);
  const sessions = useMemo<ClientSession[]>(() => clientProjectedSessions ?? [], [clientProjectedSessions]);

  const isAuthenticated = !!user;

  // Session-sync integration layer (Fase 4-A -> Fase 4 `WebOxyProvider`
  // cutover). Built ONCE per `oxyServices` instance via a lazy ref (mirrors the
  // `oxyServices` `useState` pattern above) so the underlying `SessionClient`
  // — and its socket connection, once started — is never recreated across
  // renders. `createWebTokenTransport` is the WEB-ONLY `TokenTransport`
  // (silent sign-in only — auth-sdk never touches the native shared-keychain
  // path the services equivalent transport has).
  //
  // AUTHORITATIVE (Fase 4 cutover complete): the cold-boot ladder below and
  // `handleAuthSuccess` both call `client.start()` / `addCurrentAccount()`, so
  // `client.getState()` advances in production — `syncFromClient` is the SOLE
  // authority for the device-session projection (`sessions`, `accounts`,
  // `activeAuthuser`, `activeSessionId`, `user`). There is no AuthManager to
  // fall back to or go stale against.
  const sessionClientPairRef = useRef<ReturnType<typeof createSessionClient> | null>(null);
  if (!sessionClientPairRef.current) {
    sessionClientPairRef.current = createSessionClient(oxyServices, createWebTokenTransport(oxyServices));
  }
  const { client: sessionClient, host: sessionClientHost } = sessionClientPairRef.current;

  /**
   * Full local session teardown. Shared by:
   *   - `signOut()` / `signOutAll()` — prefixed by an explicit
   *     `sessionClient.signOut({ all: true })` call.
   *   - `syncFromClient()`'s zero-account branch below — a REMOTE full
   *     sign-out (another tab/device, or an admin revoking every device
   *     account, or this device's OWN `signOutAccount()` emptying the last
   *     account) pushed over the `SessionClient` socket must be
   *     indistinguishable from a local one to the next cold boot. Idempotent
   *     with an explicit caller's own call to this function.
   *
   * Resets the SessionClient projection (`sessions`/`accounts`/
   * `activeAuthuser` + the host's current-account marker), wipes the React
   * Query cache (in-memory + persisted blob), and sets the durable
   * SSO-bounce/prior-session/deliberately-signed-out flags so the next cold
   * boot treats this device as a first-time anonymous visitor rather than
   * silently re-minting a session from a still-live IdP credential.
   */
  const clearSessionState = useCallback(async () => {
    setUser(null);
    setActiveSessionId(null);
    setClientProjectedSessions([]);
    setAccounts([]);
    setActiveAuthuserState(null);
    sessionClientHost.setCurrentAccountId(null);
    // EXPLICIT full sign-out (no account remains): wipe the React Query cache —
    // BOTH the in-memory store AND the persisted `oxy_auth_query_cache_v2`
    // localStorage blob — so a prior user's cached profile/sessions/accounts
    // cannot flash on a shared browser before the network reconfirms.
    clearQueryCache(queryClient);
    // Clear the per-origin SSO bounce state so a fresh deliberate sign-in can
    // re-probe the central IdP. Never done on a cold-boot failure path (that
    // would reintroduce the redirect loop).
    clearSsoBounceStateWeb();
    // Also drop the durable returning-user hint so the next cold boot treats
    // this device as a first-time anonymous visitor (no forced `/sso` bounce
    // after an explicit sign-out). The passive cookie-expiry path leaves it
    // intact so an expired session still recovers via a returning-user bounce.
    clearPriorSessionWeb();
    // Set the durable "deliberately signed out" flag so the `fedcm-silent` /
    // `silent-iframe` cold-boot steps do not silently re-mint a session from a
    // still-live IdP session on the next reload. Cleared on any deliberate
    // sign-in.
    markSignedOutWeb();
  }, [queryClient, sessionClientHost]);

  /**
   * Cold-boot registration dedup. `handleAuthSuccess` is the single commit
   * funnel for every web ladder step that mints a session (`sso-return`,
   * `fedcm-silent`, `silent-iframe`) — it registers the recovered account into
   * the device set itself (`sessionClient.addCurrentAccount()`). The post-ladder
   * handoff below ALSO registers, but only as a fallback for the case where
   * `initAuth` finds an access token already planted from a prior render
   * without a fresh `{kind:'session'}` outcome this pass (e.g. a remount). This
   * ref lets the handoff detect "did a ladder step already register this
   * boot?" and skip a redundant second `POST /session/device/add`. Reset at the
   * start of every cold-boot pass (mirrors the services `OxyContext` ref of the
   * same name).
   */
  const registeredDuringBootRef = useRef(false);

  /**
   * Projects `client.getState()` onto EVERY exposed session field: `user` /
   * `activeSessionId` / `sessions` (via the setters above) AND, since Task
   * 5.1, `accounts` / `activeAuthuser` (via `projectAuthManagerAccounts` /
   * `activeAuthuserOf`) — `SessionClient` is the sole authority for the
   * entire multi-account surface; there is no separate AuthManager
   * projection to keep in sync.
   */
  const syncFromClient = useCallback(async (): Promise<void> => {
    const state = sessionClient.getState();
    if (state === null) {
      // No session state has been bootstrapped yet this render (e.g. called
      // before `client.start()`/`addCurrentAccount()` has resolved, or for an
      // anonymous visitor with no session at all). Never overwrite the
      // existing cold-boot-driven state with an empty projection.
      return;
    }
    if (state.accounts.length === 0) {
      // A REMOTE actor (another tab/device, or an admin) removed the last
      // account from this device's session set — or this device's OWN
      // `signOut` / `signOutAll` / `signOutAccount` just did, and this is the
      // socket `notify()` callback (or a direct post-mutation call) catching
      // up. Route through the SAME `clearSessionState()` a local full
      // sign-out uses (see its doc comment) so a remote wipe is
      // indistinguishable from a local one to the next cold boot.
      await clearSessionState();
      return;
    }
    const ids = accountIdsOf(state);
    const users = ids.length > 0 ? await oxyServices.getUsersByIds(ids) : [];
    const usersById = new Map(users.map((resolvedUser) => [resolvedUser.id, resolvedUser]));
    setClientProjectedSessions(deviceStateToClientSessions(state, usersById));
    setActiveSessionId(activeSessionIdOf(state));
    const activeUser = activeUserOf(state, usersById);
    if (activeUser) {
      setUser(activeUser);
    }
    const expSeconds = oxyServices.getAccessTokenExpiry();
    setAccounts(projectAuthManagerAccounts(state, usersById, {
      accessToken: oxyServices.getAccessToken(),
      expiresAt: expSeconds !== null ? new Date(expSeconds * 1000).toISOString() : null,
    }));
    setActiveAuthuserState(activeAuthuserOf(state));
    sessionClientHost.setCurrentAccountId(state.activeAccountId);
  }, [oxyServices, sessionClient, sessionClientHost, clearSessionState]);

  useEffect(() => {
    return sessionClient.subscribe(() => {
      void syncFromClient();
    });
  }, [sessionClient, syncFromClient]);

  // Mutex: prevents concurrent sign-in attempts (FedCM + redirect)
  const signingInRef = useRef(false);

  const handleAuthSuccess = useCallback(async (
    session: SessionLoginResponse,
    method: 'fedcm' | 'redirect' | 'credentials' = 'credentials'
  ) => {
    // Access tokens are memory-only, planted directly on `oxyServices`
    // (never written to JS-accessible storage). This is the single chokepoint
    // that plants a freshly-minted session's token — every winning cold-boot
    // ladder step, every interactive sign-in, the Commons device-flow commit,
    // AND the in-session refresh handler's silent re-mint arms all funnel
    // through here (`AuthManager.handleAuthSuccess` used to own this; retired
    // in Fase 4 Task 5).
    if (session.accessToken) {
      oxyServices.setTokens(session.accessToken);
    }
    logger.debug(
      'handleAuthSuccess: committed session',
      { component: 'WebOxyProvider', method: 'handleAuthSuccess', authMethod: method },
    );

    if (session.sessionId) {
      setActiveSessionId(session.sessionId);
    }

    // Use the session user directly to avoid an extra API round-trip.
    // The session already contains user data from the auth exchange.
    setUser(session.user as User);
    setError(null);
    setIsLoading(false);

    // A session is now established — set the durable returning-user hint so a
    // future cold boot whose cross-domain cookie restore comes back empty still
    // earns ONE `/sso` establish bounce. Every first-party commit path
    // (FedCM / redirect / SSO return / claimed device-flow) funnels through
    // here, so this is the single chokepoint for the hint.
    markPriorSessionWeb();
    // A committed session re-enables automatic silent restore: clear the durable
    // "deliberately signed out" flag. The `fedcm-silent` step is GATED on the
    // flag, so when it is set that step never runs and never reaches here — this
    // clear is only hit on a genuine (re-)sign-in or when restore was permitted.
    clearSignedOutWeb();

    // Register this recovered account+session into the server-authoritative
    // device-session set (Fase 4 cutover — mirrors the services `OxyContext`
    // `handleWebSSOSession`). Every winning cold-boot ladder step
    // (`sso-return`, `fedcm-silent`, `silent-iframe`), every interactive
    // sign-in (`signIn`/`signInWithFedCM`), AND the Commons device-flow commit
    // (`commitClaimedSession`) funnel through here, so this is the single
    // chokepoint that registers the account into the device's `DeviceSession`
    // doc. This MUST be a registration (`addCurrentAccount`), never an
    // account-SWITCH — switching requires the account already be present on
    // this device, which a brand-new sign-in/claim never is (the exact bug the
    // services cutover hit and fixed for the Commons device-flow path).
    // Best-effort: a failure here must NEVER fail the sign-in itself — the
    // post-ladder handoff (see the init effect) re-registers this account into
    // the device set as a fallback when this call didn't run/failed this boot.
    try {
      await sessionClient.addCurrentAccount();
      registeredDuringBootRef.current = true;
      await syncFromClient();
    } catch (registrationError) {
      logger.warn(
        'handleAuthSuccess: failed to register session into device set',
        { component: 'WebOxyProvider', method: 'handleAuthSuccess' },
        registrationError as unknown,
      );
    }
  }, [oxyServices, sessionClient, syncFromClient]);

  /**
   * Commit a session claimed by the "Sign in with Oxy" QR handoff. The
   * device-flow claim ({@link OxyServices.claimSessionByToken}) already returns
   * a fully-hydrated session; project it into a {@link SessionLoginResponse} and
   * funnel it through `handleAuthSuccess` so it is indistinguishable from a
   * FedCM / redirect login (same token plant + device-set registration).
   * Tagged `credentials` like the other first-party commit paths.
   */
  const commitClaimedSession = useCallback(async (claimed: CommonsClaimResult) => {
    await handleAuthSuccess(
      {
        sessionId: claimed.sessionId,
        deviceId: claimed.deviceId,
        expiresAt: claimed.expiresAt,
        accessToken: claimed.accessToken,
        // The full claimed `User` carries every field; the spread satisfies the
        // narrower `MinimalUserData` boundary (it only coalesces `avatar`'s
        // `string | null` → `string | undefined`) while preserving the rest —
        // `handleAuthSuccess` casts it back to `User` for `setUser`.
        user: { ...claimed.user, avatar: claimed.user.avatar ?? undefined },
      },
      'credentials',
    );
  }, [handleAuthSuccess]);

  // `handleAuthSuccess` routed through a ref so the eager SSO-callback
  // interception effect (registered once with deps `[]`) can commit an `ok`
  // session without listing `handleAuthSuccess` as a dependency — which would
  // re-fire the effect on every callback-identity change. Assigned synchronously
  // on every render so the ref is populated before any effect fires.
  const handleAuthSuccessRef = useRef(handleAuthSuccess);
  handleAuthSuccessRef.current = handleAuthSuccess;

  // In-session token refresh (Fase 4 cutover — Task 5.2, replaces
  // `AuthManager.setupCookieRefresh` + its reactive `HttpService`
  // `authRefreshHandler`). Two cooperating pieces — see
  // `./session/tokenRefresh.ts`'s module doc comment for the full mechanism
  // and why `SessionClient` REST calls are deliberately never used here:
  //   1. The reactive handler installed on `oxyServices.httpService` — fires
  //      on a per-request preflight (token expiring within HttpService's own
  //      lead window) or a genuine 401. Silently re-mints via the per-apex
  //      `/auth/silent` iframe, then FedCM silent, committing exactly like a
  //      winning cold-boot ladder step would (`handleAuthSuccessRef`).
  //   2. The proactive scheduler — fires `TOKEN_REFRESH_LEAD_MS` before the
  //      current token's `exp` so the common case never even reaches the
  //      reactive 401-then-recover flash.
  useEffect(() => {
    const handler = createWebAuthRefreshHandler({
      oxyServices,
      commitSilentSession: (session, method) => handleAuthSuccessRef.current(session, method),
    });
    oxyServices.httpService.setAuthRefreshHandler(handler);
    return () => {
      oxyServices.httpService.setAuthRefreshHandler(null);
    };
  }, [oxyServices]);

  useEffect(() => {
    const scheduler = startTokenRefreshScheduler(oxyServices);
    return () => scheduler.dispose();
  }, [oxyServices]);

  const committedSsoSessionsRef = useRef<WeakSet<SessionLoginResponse>>(new WeakSet());
  const commitSsoSessionOnce = useCallback(async (session: SessionLoginResponse) => {
    // The eager callback interceptor and cold-boot SSO step intentionally share
    // one exchange promise, but both can observe its non-null session. Commit
    // before awaiting so overlapping callers cannot both run the side-effectful
    // post-login cookie restore/rotation path for the same SSO return.
    if (committedSsoSessionsRef.current.has(session)) {
      return;
    }
    committedSsoSessionsRef.current.add(session);
    await handleAuthSuccessRef.current(session, 'credentials');
  }, []);

  const commitSsoSessionOnceRef = useRef(commitSsoSessionOnce);
  commitSsoSessionOnceRef.current = commitSsoSessionOnce;

  const handleAuthError = useCallback((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : 'Authentication failed';
    setError(errorMessage);
    setIsLoading(false);
    onError?.(err instanceof Error ? err : new Error(errorMessage));
  }, [onError]);

  /**
   * SSO return (cold-boot step 1).
   *
   * We may be back from a top-level bounce to the central IdP. Delegates the
   * entire security-critical CSRF/fragment-strip/state-check/exchange/dest-
   * restore/loop-breaker sequence to core's `consumeSsoReturn`, which is
   * byte-for-byte identical across `@oxyhq/auth` and `@oxyhq/services` (the
   * security-sensitive parts MUST NOT diverge). `consumeSsoReturn` is
   * COMMIT-FREE — it returns the exchanged session (or `null`) and never touches
   * UI/auth state — so this provider commits it AROUND the call: the cold-boot
   * post-runner switch (`'sso'` → `handleAuthSuccess`) and the bfcache
   * `pageshow` handler both consume the returned `SsoReturnSession | null`.
   *
   * Web-detection (`isWeb`) is wired to `isWebBrowser` so it matches the rest of
   * the provider exactly; storage / location / history default to the `window.*`
   * globals (the same surfaces the previous inline implementation used).
   *
   * CONCURRENCY: the eager SSO-callback interception effect and the cold-boot
   * `sso-return` step can both invoke this in the same tick (both fire on mount
   * when we land on the callback path). `consumeSsoReturn` strips the fragment
   * FIRST, so a naive second invocation would parse an already-stripped URL and
   * return `null` — leaving whichever caller lost the race with no session, which
   * on an `ok` outcome would let the cold-boot terminal bounce fire spuriously.
   * To make the two paths race-free, the FIRST call's promise is memoised in
   * `inFlightSsoReturnRef` and SHARED with every concurrent caller, so the single
   * `consumeSsoReturn` invocation's result (the exchanged session, or `null`) is
   * delivered identically to both the eager effect and the cold-boot step. The
   * shared promise is cleared once it settles so a later, genuinely-separate
   * return (e.g. a bfcache restore with a fresh fragment) runs a fresh pass.
   */
  const inFlightSsoReturnRef = useRef<Promise<SsoReturnSession | null> | null>(null);
  const runSsoReturn = useCallback((): Promise<SsoReturnSession | null> => {
    if (inFlightSsoReturnRef.current) {
      return inFlightSsoReturnRef.current;
    }
    const inFlight = consumeSsoReturn(oxyServices, {
      isWeb: isWebBrowser,
      onExchangeError: (err) =>
        logger.debug(
          'SSO code exchange failed (treating as no session)',
          { component: 'WebOxyProvider', method: 'runSsoReturn' },
          err,
        ),
    })
      .then((session): SsoReturnSession | null => (session ? { method: 'sso', session } : null))
      .finally(() => {
        inFlightSsoReturnRef.current = null;
      });
    inFlightSsoReturnRef.current = inFlight;
    return inFlight;
  }, [oxyServices]);

  // The cold-boot step references `runSsoReturn` through a ref because the
  // steps array is built inside the init effect, which must not list every
  // callback as a dependency (it would re-run the whole cold boot on each
  // callback identity change). Assigned synchronously on every render so the
  // ref is populated before the init effect (or the bfcache handler) fires.
  const runSsoReturnRef = useRef(runSsoReturn);
  runSsoReturnRef.current = runSsoReturn;

  /**
   * SSO bounce gate (cold-boot step 5 `enabled`).
   *
   * Only bounce when:
   *   - we are a top-level web document (never inside an iframe), AND
   *   - the smart gate allows it: a RETURNING visitor (durable prior-session
   *     hint) — a truly first-time anonymous visitor browses without a forced
   *     redirect, AND
   *   - we are NOT sitting on the central IdP itself (never loop it), AND
   *   - the NO_SESSION flag is not set (a prior `none`/`error`/mismatch this
   *     page-session already proved there is no central session), AND
   *   - no fresh bounce guard is active (a bounce younger than the 30s TTL is
   *     in flight; a stale one self-heals).
   */
  const evaluateSsoBounce = useCallback((): boolean => {
    if (!isWebBrowser() || window.top !== window.self) return false;
    const origin = window.location.origin;
    // Smart gate (SDK-owned, shared with the services `OxyContext` via core's
    // `allowSsoBounce`): allow ONLY a returning visitor (durable prior-session
    // hint) — a truly first-time anonymous visitor browses without a forced
    // redirect. WebOxyProvider has no stored-bearer step, so `hasLocalSession`
    // is always `false` here (a cookie restore that succeeded would have won an
    // earlier cold-boot step). The per-tab guards below still cap an allowed
    // bounce at one per cold boot.
    if (!allowSsoBounce({
      hasPriorSession: hasPriorSessionWeb(),
      hasLocalSession: false,
    })) {
      return false;
    }
    if (isCentralIdPOrigin(origin)) return false;
    if (window.sessionStorage.getItem(ssoNoSessionKey(origin)) === '1') return false;
    if (window.sessionStorage.getItem(ssoAttemptedKey(origin)) === '1') return false;
    if (guardActive(window.sessionStorage, origin)) return false;
    return true;
  }, []);

  /**
   * SSO bounce (cold-boot step 5 `run`). TERMINAL: navigates the top-level
   * document to the central IdP's `/sso` endpoint with `prompt=none`. The
   * document is torn down, so nothing after `window.location.assign` runs in
   * practice.
   */
  const runSsoBounce = useCallback((): void => {
    if (!isWebBrowser()) return;
    const origin = window.location.origin;

    const state = oxyServices.generateSsoState();
    window.sessionStorage.setItem(ssoStateKey(origin), state);
    window.sessionStorage.setItem(ssoGuardKey(origin), String(Date.now()));
    // Capture the real destination so it can be restored after the callback.
    window.sessionStorage.setItem(ssoDestKey(origin), window.location.href);
    // OUTCOME-INDEPENDENT once-guard: mark the probe attempted the instant we
    // commit to the bounce, so even if the callback never lands cleanly no
    // second bounce can ever fire this tab (the definitive loop breaker).
    window.sessionStorage.setItem(ssoAttemptedKey(origin), '1');

    // Honour an explicit `authWebUrl` override (e.g. a staging IdP) for the
    // SSO bounce exactly as it drives FedCM — mirroring the services
    // `OxyContext`, which builds from
    // `resolveCentralAuthUrl(oxyServices.config?.authWebUrl)`. The constructor
    // above already resolved `config.authWebUrl` to the central default when no
    // override was supplied, so reading it here is sufficient.
    window.location.assign(
      buildSsoBounceUrl(origin, state, oxyServices.config?.authWebUrl),
    );
  }, [oxyServices]);

  // Initialize
  useEffect(() => {
    if (skipAutoCheck) return;

    let mounted = true;

    const initAuth = async () => {
      // Fresh per-boot flag — see the declaration comment above
      // `registeredDuringBootRef`.
      registeredDuringBootRef.current = false;

      // Cold boot — a pure TOKEN-ACQUISITION LADDER, consuming the SAME
      // `runColdBoot` core primitive as the services `OxyContext`. The FIRST
      // step that yields a session wins; every later step is skipped. Step
      // ids + guard logic mirror the services provider EXACTLY (consistency
      // mandate) even though `WebOxyProvider` is web-only. Once a token is
      // acquired (or the ladder exhausts), the SERVER-authoritative
      // `SessionClient` takes over — see the post-ladder handoff below.
      //
      // Order (web):
      //   0. sso-return     — parse `window.location.hash`; on `ok` exchange the
      //                       opaque code via `oxyServices.exchangeSsoCode` and
      //                       commit; on `none`/`error` set the no-rebounce flag.
      //   1. fedcm-silent   — silent FedCM against the CENTRAL `auth.oxy.so`
      //                       (Chrome enhancement). Fires once per page load.
      //   2. silent-iframe  — first-party `/auth/silent` iframe at the PER-APEX
      //                       IdP (durable cross-domain AND same-apex reload
      //                       restore). This IS cold boot's durable
      //                       reload-restore path — there is no `oxy_rt`
      //                       cookie read anywhere during cold boot.
      //   3. sso-bounce     — TERMINAL top-level navigation to `auth.oxy.so/sso`.
      //
      // NOTE: the services `OxyContext` has an additional `stored-session`
      // bearer-restore step (native's ONLY restore path, which also runs BEFORE
      // the slow web probes so a local reload wins fast). `WebOxyProvider` is
      // web-only and never persists a bearer session to JS-accessible storage,
      // so that step is a guaranteed no-op here and is omitted; the effective
      // web durable-restore is the `silent-iframe` step (step 2). The early
      // `setIsLoading(false)` inside `handleAuthSuccess` already gives
      // WebOxyProvider the "flip loading the instant a session commits"
      // behaviour inherently (each commit branch flips loading immediately;
      // there is no deferred-until-chain-completes gate to decouple).
      //
      // CRITICAL: every winning step MUST hydrate a REAL user before claiming a
      // session. A placeholder user (empty id) is never exposed (R4).
      const ssoKey = silentSignInKey(oxyServices);

      // DELIBERATELY-SIGNED-OUT gate (web): when the user pressed "Sign out", the
      // central IdP session can still be live, so the silent `fedcm-silent` /
      // `silent-iframe` steps below would re-mint a session on the next cold boot
      // and sign the user back in without intent. Read the durable flag ONCE here
      // (synchronously usable by each step's `enabled` gate) and skip both steps
      // while it is set. Any deliberate sign-in clears it. The terminal
      // `sso-bounce` is already self-suppressed after sign-out (its
      // prior-session hint is cleared).
      const silentRestoreBlocked = silentRestoreSuppressedWeb();

      const steps: ReadonlyArray<ColdBootStep<ColdBootSession>> = [
        {
          // 0) SSO return: we are back from a top-level bounce to the central
          // IdP. Parse the fragment, validate state, exchange the opaque code.
          id: 'sso-return',
          enabled: () => isWebBrowser(),
          run: async () => {
            const session = await runSsoReturnRef.current();
            if (!session) return { kind: 'skip' };
            return { kind: 'session', session };
          },
        },
        {
          // 1) FedCM silent reauthn (Chrome) against the CENTRAL IdP
          // (`auth.oxy.so`). Fires `navigator.credentials.get` with
          // `mediation: 'silent'`, which must happen AT MOST ONCE per page
          // load — gate on the module-level run-once guard. This is the
          // FedCM-only silent path. Cross-domain restore on non-FedCM browsers is
          // owned by the `silent-iframe` / `sso-bounce` steps below. Only runs
          // where FedCM is supported.
          id: 'fedcm-silent',
          enabled: () =>
            isWebBrowser() &&
            !silentRestoreBlocked &&
            oxyServices.isFedCMSupported() === true &&
            !fedcmSilentSignInAttempted.has(ssoKey),
          run: async () => {
            fedcmSilentSignInAttempted.add(ssoKey);
            const session = await oxyServices.silentSignInWithFedCM();
            if (!session?.user) return { kind: 'skip' };
            return {
              kind: 'session',
              session: { method: 'fedcm', session },
            };
          },
        },
        {
          // 2) First-party silent iframe at the PER-APEX IdP — the DURABLE
          // cross-domain (and same-apex) reload-restore path. The durable
          // session lives as a first-party `fedcm_session` cookie on
          // `auth.<rp-apex>` (e.g. `auth.mention.earth`), established during
          // the `/sso` bounce's `/sso/establish` hop. That host is SAME-SITE to
          // the RP page, so the cookie is first-party under Safari ITP /
          // Firefox TCP — and an iframe read is NOT a top-level navigation, so
          // it restores on reload with NO flash and works in a backgrounded
          // tab. This is the step that prevents the re-bounce loop: when it
          // finds a session, the terminal `sso-bounce` never fires. This IS
          // cold boot's durable restore path — `handleAuthSuccess` registers
          // the recovered account into the server-authoritative
          // `SessionClient` device-session set once a token is committed;
          // there is no separate `oxy_rt` cookie-slot side effect.
          //
          // Points `silentSignIn` at `autoDetectAuthWebUrl()` (the per-apex
          // host) rather than the instance's configured CENTRAL auth URL — the
          // central host cannot read the per-apex `fedcm_session` cookie. On a
          // `*.oxy.so` app the per-apex host IS the central host, so this also
          // covers same-apex reloads. Skips when auto-detection bails
          // (localhost / IP / single-label / off-browser) — there is no
          // per-apex IdP to query. Bounded by `SILENT_IFRAME_TIMEOUT` so a
          // no-message iframe cannot stall cold boot.
          id: 'silent-iframe',
          enabled: () => isWebBrowser() && !silentRestoreBlocked,
          run: async () => {
            const perApexAuthUrl = autoDetectAuthWebUrl();
            if (!perApexAuthUrl) return { kind: 'skip' };
            const session = await oxyServices.silentSignIn({
              authWebUrlOverride: perApexAuthUrl,
              timeout: SILENT_IFRAME_TIMEOUT,
            });
            if (!session?.user || !session.sessionId) return { kind: 'skip' };
            return {
              kind: 'session',
              session: { method: 'silent-iframe', session },
            };
          },
        },
        {
          // 3) SSO bounce (TERMINAL, once). No local session was recovered by
          // any prior step. Navigate top-level to the central IdP's `/sso`
          // endpoint with `prompt=none`. The document is torn down, so `run`
          // returns `skip` only if `assign` no-ops (e.g. blocked navigation).
          id: 'sso-bounce',
          enabled: () => evaluateSsoBounce(),
          run: async () => {
            runSsoBounce();
            return { kind: 'skip' };
          },
        },
      ];

      const outcome: ColdBootOutcome<ColdBootSession> = await runColdBoot({
        steps,
        onStepError: (id, err) => {
          // Cold-boot step errors are the EXPECTED branch for logged-out
          // visitors and FedCM-less browsers — log at debug so they don't
          // spam the console every page load.
          logger.debug(
            'cold-boot step did not resolve a session',
            { component: 'WebOxyProvider', method: 'initAuth', step: id },
            err
          );
        },
        // Defense-in-depth: a single step whose promise never settles can no
        // longer block the chain forever. On expiry the runner keeps iterating
        // to the terminal `sso-bounce` step so a genuine no-local-session visit
        // still reaches the cross-domain `/sso` fallback. See
        // `COLD_BOOT_OVERALL_DEADLINE`.
        overallDeadlineMs: COLD_BOOT_OVERALL_DEADLINE,
        onStepDeadline: (id) => {
          logger.debug(
            'cold-boot step exceeded the overall deadline (abandoned, falling through)',
            { component: 'WebOxyProvider', method: 'initAuth', step: id },
          );
        },
      });

      if (!mounted) return;

      if (outcome.kind === 'unauthenticated') {
        setIsLoading(false);
      } else {
        // Reproduce the correct per-branch commit. Every branch funnels
        // through `handleAuthSuccess` (`sso` via the dedup wrapper), which now
        // also registers the recovered account into the `SessionClient`
        // device-session set — see the post-ladder handoff below.
        switch (outcome.session.method) {
          case 'sso':
            await commitSsoSessionOnceRef.current(outcome.session.session);
            break;
          case 'silent-iframe':
            await handleAuthSuccess(outcome.session.session, 'credentials');
            break;
          case 'redirect':
          case 'fedcm':
            await handleAuthSuccess(outcome.session.session, outcome.session.method);
            break;
        }
      }

      // TOKEN LADDER → SESSIONCLIENT AUTHORITY HANDOFF. The steps above are
      // ONLY a token-acquisition ladder — they mint the first per-domain
      // access token by whichever means recovers one fastest. Once a session
      // is known (either this cold boot committed one via the ladder, or an
      // access token is already held in memory — e.g. a prior render already
      // planted it), hand off to the server-authoritative `SessionClient`:
      // `addCurrentAccount` registers this recovered account+session into the
      // server `DeviceSession` (derives identity from the bearer), `start`
      // bootstraps the full device-session state (server `activeAccountId` +
      // `activeToken`) and connects the realtime socket, and `syncFromClient`
      // projects that state onto the exposed `sessions`/`activeSessionId`/
      // `user`. Never call the client when no session was acquired — an
      // anonymous visitor must stay logged out. Failures are logged and
      // swallowed; they must never throw out of cold boot.
      //
      // `addCurrentAccount` is SKIPPED when `registeredDuringBootRef` is
      // already `true` — every ladder step that commits a session does so via
      // `handleAuthSuccess`, which registers the account itself. Without this
      // guard a winning step would register the SAME account twice (`POST
      // /session/device/add` called back-to-back). `start()` and
      // `syncFromClient()` still always run — `start()` is idempotent (no-ops
      // once already started) and is what connects the realtime socket for the
      // first time.
      if (outcome.kind === 'session' || oxyServices.getAccessToken()) {
        const handoff = (async () => {
          try {
            if (!registeredDuringBootRef.current) {
              await sessionClient.addCurrentAccount();
            }
            await sessionClient.start();
            await syncFromClient();
          } catch (startErr) {
            logger.warn(
              'cold-boot: SessionClient start failed',
              { component: 'WebOxyProvider', method: 'initAuth' },
              startErr as unknown,
            );
          }
        })();
        // Bound how long auth resolution waits for the handoff (see
        // `SESSION_HANDOFF_DEADLINE`): the token is already planted, so on a
        // slow backend we let the handoff complete asynchronously in the
        // background rather than stalling further.
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
      }
    };

    // Safety timeout: if all auth methods stall, stop loading
    const INIT_TIMEOUT_MS = 15_000;
    const timeoutId = setTimeout(() => {
      if (mounted) {
        setIsLoading(false);
      }
    }, INIT_TIMEOUT_MS);

    initAuth()
      .catch((err) => {
        // The post-runner commit (`handleAuthSuccess`) awaits a token plant
        // before it flips `setIsLoading(false)`. If anything throws BEFORE
        // that flip, the rejection would otherwise be unhandled and
        // `isLoading` would stay true until the 15s safety timeout. Route it
        // through the existing error handler so loading resets immediately.
        if (mounted) {
          handleAuthError(err);
        }
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [oxyServices, crossDomainAuth, skipAutoCheck, handleAuthSuccess, handleAuthError, evaluateSsoBounce, runSsoBounce, sessionClient, syncFromClient]);

  // bfcache restore handler — registered ONCE, OUTSIDE the cold boot.
  //
  // When the browser restores this page from the back/forward cache
  // (`pageshow` with `event.persisted === true`), React state is preserved but
  // the cold-boot effect does NOT re-run. If the user signed in on the central
  // IdP and hit "back", the restored page would otherwise miss the new session.
  // Re-run the `sso-return` parse so a pending `#oxy_sso=ok` fragment is
  // exchanged and committed, and re-evaluate the bounce gate so a now-stale
  // NO_SESSION/guard does not strand the page logged-out.
  useEffect(() => {
    if (!isWebBrowser()) return;

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;

      runSsoReturnRef.current()
        .then(async (session) => {
          if (session) {
            await commitSsoSessionOnceRef.current(session.session);
            return;
          }
          // No SSO return to commit. Re-evaluate the bounce gate: if a session
          // could now be recovered centrally (NO_SESSION cleared by a sign-in
          // elsewhere) and we have no local user, trigger one terminal bounce.
          if (!user && evaluateSsoBounce()) {
            runSsoBounce();
          }
        })
        .catch((err) => {
          logger.debug(
            'bfcache sso-return did not resolve a session',
            { component: 'WebOxyProvider', method: 'onPageShow' },
            err,
          );
        });
    };

    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [handleAuthSuccess, evaluateSsoBounce, runSsoBounce, user]);

  // EAGER, universal SSO-callback interception (web only, once on mount).
  //
  // When the central IdP redirects the RP back to the internal callback path
  // ({@link SSO_CALLBACK_PATH}), the app's own router would otherwise mount on
  // `/__oxy/sso-callback` — a route NO app declares — and briefly flash its
  // +not-found screen before the cold-boot `sso-return` step strips the fragment
  // and restores the real destination.
  //
  // This effect runs the SAME `runSsoReturn` kernel the instant we mount ON the
  // callback path, BEFORE the init effect's cold boot. The first render
  // intentionally matches the app/router's static HTML; the browser layout
  // effect then hides the internal route and consumes the callback before the
  // first visible paint. That keeps SSR/SSG hydration stable while still making
  // the SDK own `/__oxy/sso-callback` for every consumer.
  //
  // Purely ADDITIVE: the cold-boot `sso-return` step stays as defense-in-depth.
  // `consumeSsoReturn` strips the fragment first, so once this eager pass has run
  // the cold-boot step is a harmless idempotent no-op. The path guard scopes this
  // strictly to the callback path. Routed through `runSsoReturnRef` and
  // `handleAuthSuccessRef` so deps stay `[]` and it registers exactly once.
  useBrowserLayoutEffect(() => {
    if (!isOnSsoCallbackPath()) {
      setSsoCallbackIntercepting(false);
      return;
    }

    let mounted = true;
    setSsoCallbackIntercepting(true);
    runSsoReturnRef.current()
      .then(async (session) => {
        if (session) {
          await commitSsoSessionOnceRef.current(session.session);
        }
      })
      .catch((err) => {
        logger.debug(
          'Eager SSO callback interception failed (non-fatal)',
          { component: 'WebOxyProvider', method: 'eagerSsoCallbackIntercept' },
          err,
        );
      })
      .finally(() => {
        if (mounted) {
          setSsoCallbackIntercepting(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    onAuthStateChange?.(user);
  }, [user, onAuthStateChange]);

  const signIn = useCallback(async () => {
    if (signingInRef.current) {
      return;
    }

    signingInRef.current = true;
    setError(null);
    setIsLoading(true);

    let selectedMethod: 'fedcm' | 'redirect' = 'redirect';

    try {
      const session = await crossDomainAuth.signIn({
        method: preferredAuthMethod,
        onMethodSelected: (method) => {
          selectedMethod = method;
        },
      });

      if (session) {
        await handleAuthSuccess(session, selectedMethod);
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      signingInRef.current = false;
    }
  }, [crossDomainAuth, preferredAuthMethod, handleAuthSuccess, handleAuthError]);

  const signInWithFedCM = useCallback(async () => {
    if (signingInRef.current) return;
    signingInRef.current = true;
    setError(null);
    setIsLoading(true);
    try {
      const session = await crossDomainAuth.signInWithFedCM();
      await handleAuthSuccess(session, 'fedcm');
    } catch (err) {
      handleAuthError(err);
    } finally {
      signingInRef.current = false;
    }
  }, [crossDomainAuth, handleAuthSuccess, handleAuthError]);

  const signInWithRedirect = useCallback(() => {
    setError(null);
    crossDomainAuth.signInWithRedirect({
      redirectUri: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  }, [crossDomainAuth]);

  const isFedCMSupported = useCallback(() => {
    return crossDomainAuth.isFedCMSupported();
  }, [crossDomainAuth]);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      // Server-authoritative device-session revocation: revoke every account
      // this device knows about via `SessionClient`. Best-effort — a failure
      // here must NEVER block the local cleanup that follows
      // (`clearSessionState`), which is what actually guarantees this device
      // signs out. `syncFromClient`'s zero-account branch (fed by this call's
      // socket `notify()`, when it succeeds) redundantly runs the SAME
      // `clearSessionState()` — harmless and idempotent with the explicit
      // call below.
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

  /**
   * Multi-account: switch to a different device-local account by its LEGACY
   * `authuser` index. Resolves the index to its `SessionClient` device
   * account id (`SessionAccount.authuser` is carried through the projection
   * specifically for this mapping) and switches via the server-authoritative
   * `SessionClient.switchAccount()` — the SOLE switch authority. `accounts`
   * and `activeAuthuser` are re-derived from the SAME `SessionClient` state
   * by the trailing `syncFromClient()` call, so they never go stale relative
   * to the real active account. An `authuser` that is not (yet) registered in
   * the `SessionClient` device set cannot be switched into by this method —
   * it surfaces as an `error`, matching the "unmapped" failure mode below.
   *
   * Never rejects (matches the pre-cutover contract): a failed lookup or
   * switch surfaces via `error`/`onError`, not a thrown/rejected promise.
   */
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
      // A switch is a deliberate sign-in into an account: re-enable automatic
      // silent restore by clearing any prior "deliberately signed out" flag.
      clearSignedOutWeb();
      await syncFromClient();
    } catch (err) {
      handleAuthError(err);
    }
  }, [sessionClient, syncFromClient, handleAuthError]);

  /**
   * Switch to a different device session by its server-side session id.
   * Fase 4 cutover: resolves the target account from the `SessionClient`
   * device state and switches via `sessionClient.switchAccount()` — this is
   * an account-SWITCH between accounts ALREADY registered on this device,
   * never a hydrate. A freshly-claimed session (e.g. the Commons QR
   * device-flow) is NOT yet a device account and MUST commit via
   * `handleAuthSuccess` / `commitClaimedSession` (which registers it through
   * `addCurrentAccount`) instead of this method.
   *
   * Unlike `switchAccount`, THROWS a clear Error when the session id is not
   * one of this device's accounts, rather than silently no-oping — a stale
   * or unknown session id must be a visible failure to the caller.
   */
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
      clearSignedOutWeb();
      await syncFromClient();
    } catch (err) {
      handleAuthError(err);
      throw err;
    }
  }, [sessionClient, syncFromClient, handleAuthError]);

  /**
   * Multi-account: sign out a specific device-local account by its LEGACY
   * `authuser` index. Resolves the index to its `SessionClient` device
   * account id and revokes it via `sessionClient.signOut({accountId})` — the
   * SOLE revocation authority (no separate cookie-slot registry to also
   * tear down). If the active account was signed out, the server promotes
   * the next remaining account to active and `syncFromClient()` re-projects
   * `user`/`activeSessionId`/`accounts`/`activeAuthuser` to match. If NO
   * account remains, `syncFromClient`'s zero-account branch routes through
   * `clearSessionState()` — the exact same full local teardown (React Query
   * cache wipe + durable signed-out flag) a `signOut()` uses, so a
   * single-account sign-out that empties the device never leaves stale
   * cache/flags behind.
   *
   * Never rejects (matches `switchAccount`'s contract): a failed lookup or
   * revocation surfaces via `error`/`onError`, not a thrown/rejected promise.
   */
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

  // Tear down the SessionClient's socket connection (and its `onTokensChanged`
  // subscription) on unmount. Retired `AuthManager.destroy()` used to clear
  // its own refresh timer/listeners here; `SessionClient.stop()` is the
  // equivalent for the server-authoritative model.
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
    oxyServices,
    crossDomainAuth,
    signIn,
    signInWithFedCM,
    signInWithRedirect,
    signOut,
    isFedCMSupported,
    switchSession,
    switchAccount,
    signOutAccount,
    signOutAll,
    clearSessionState,
    commitClaimedSession,
  }), [
    user, isAuthenticated, isLoading, error, clientId, activeSessionId, sessions,
    accounts, activeAuthuser,
    oxyServices, crossDomainAuth,
    signIn, signInWithFedCM, signInWithRedirect,
    signOut, isFedCMSupported, switchSession,
    switchAccount, signOutAccount, signOutAll, clearSessionState,
    commitClaimedSession,
  ]);

  // Mirror the RN OxyProvider pattern: don't expose the QueryClient (or
  // mount children) until the persisted cache has been restored. On the
  // web this prevents the first paint from observing an empty
  // localStorage-backed cache, which would otherwise force every
  // identity/session/auth query to refetch from the network even when a
  // fresh blob was available on disk.
  //
  // The restored promise is wired with `.finally(...)` upstream, so this
  // unblocks on both success and failure within typically <50ms (sync
  // localStorage read + JSON.parse). A safety net is unnecessary: the
  // restore promise always settles synchronously after one microtask.
  if (isRestoring) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WebOxyContext.Provider value={contextValue}>
        {ssoCallbackIntercepting ? null : children}
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
 * (e.g. `useCommonsSignIn`) that work BOTH inside the provider (zero-config) and
 * standalone (explicit `oxyServices` / `clientId`), so they can opt into the
 * provider's session-commit path only when one is present.
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
    signIn: ctx.signIn,
    signInWithFedCM: ctx.signInWithFedCM,
    signInWithRedirect: ctx.signInWithRedirect,
    signOut: ctx.signOut,
    isFedCMSupported: ctx.isFedCMSupported,
    switchSession: ctx.switchSession,
    switchAccount: ctx.switchAccount,
    signOutAccount: ctx.signOutAccount,
    signOutAll: ctx.signOutAll,
    oxyServices: ctx.oxyServices,
  };
}

export default WebOxyProvider;

/**
 * Headless controller for the unified Oxy account dialog.
 *
 * A framework-agnostic state machine + subscribe/getSnapshot store (the same
 * pattern {@link SessionClient} uses — no React, no RN) that both
 * every `OxyProvider` platform variant (Expo/RN and RN-Web)
 * bind to via `useSyncExternalStore`, so the account chooser is ONE
 * implementation across the ecosystem instead of the five drifting copies it
 * replaces.
 *
 * The controller owns:
 *   - the unified account list (via {@link projectSwitchableAccounts}), fetched
 *     from `SessionClient` state ∪ `oxyServices.listAccounts()` and hydrated
 *     with `oxyServices.getUsersByIds()`;
 *   - the dialog `view` state machine (`accounts` | `signin` | `qr` | `add` |
 *     `signup`);
 *   - `switchTo` (the uniform switch: `SessionClient.switchAccount` for an
 *     account already on the device, `oxyServices.switchToAccount` to mint on
 *     first entry into a graph account — reusing the existing SDK primitives, no
 *     new switch path);
 *   - the "Sign in with Oxy" device flow (same-device shared-keychain via
 *     `oxyServices.signInWithSharedIdentity`, else the cross-device QR handoff
 *     via `startCommonsSignIn` → poll → `claimSessionByToken`);
 *   - `commonsAvailability` — whether Commons is installed on this device
 *     (native only, via the injected `canOpenApp` probe), so the QR view can
 *     offer a "Get Commons" fallback instead of a same-device dead end.
 *   - `startPasskeyHubSignIn` — on a non-Oxy web origin (where a WebAuthn
 *     ceremony can't run locally, the RP-ID is bound to oxy.so), open a popup
 *     at the auth.oxy.so passkey hub instead, scoped to the SAME device-flow
 *     session `showQr` creates, and complete it via the SAME poll/socket/claim
 *     engine. Falls back to `showQr`'s plain QR rendering if the popup is
 *     blocked.
 *
 * Sign-in is passkey (WebAuthn) or the Commons QR / shared-keychain handoff —
 * password, social login, and 2FA were removed ecosystem-wide. Account
 * creation (`signup` view) is the same two identity backends: a passkey
 * ceremony on web, or a Commons-created identity.
 */

import type { OxyServices } from '../OxyServices';
import type { SessionLoginResponse, MinimalUserData } from '../models/session';
import type { User } from '../models/interfaces';
import { logger } from '../logger';
import { extractErrorStatus } from '../utils/errorUtils';
import { CENTRAL_IDP_APEX } from '../utils/authWebUrl';
import type { SessionClient } from './SessionClient';
import type { MinimalSocket, SocketIOFactory } from './socketLoader';
import {
  projectSwitchableAccounts,
  switchableAccountIds,
  type SwitchableAccount,
} from './accountProjection';
import type { AccountNode } from '../mixins/OxyServices.accounts';
import type { CommonsSignInHandle } from '../mixins/OxyServices.auth';

/** The dialog's top-level view. */
export type AccountDialogView = 'accounts' | 'signin' | 'qr' | 'add' | 'signup';

/**
 * Whether Commons is installed on this device, as resolved by the injected
 * `canOpenApp` probe:
 *   - `'unknown'` — not yet probed, OR no probe was injected (web — there is
 *     no API to ask a browser whether a custom URL scheme is registered, so
 *     this stays `'unknown'` forever there and the QR view renders
 *     unconditionally, no gating).
 *   - `'checking'` — the probe is in flight.
 *   - `'available'` / `'unavailable'` — the probe's resolved terminal answer
 *     (native only). A probe error is treated as `'unavailable'` (fail-closed).
 */
export type CommonsAvailability = 'unknown' | 'checking' | 'available' | 'unavailable';

/** Lifecycle phase of the "Sign in with Oxy" device flow. */
export type SignInFlowPhase = 'idle' | 'starting' | 'waiting' | 'authorized' | 'error';

/**
 * Minimal structural handle over a popup `Window` — just enough for the
 * cross-origin passkey hub flow ({@link AccountDialogController.startPasskeyHubSignIn}):
 * navigate it once the device-flow session's `authorizeCode` is known, detect
 * the user closing it early (`closed`), and close it programmatically on
 * completion/failure. Satisfied directly by `window.open()`'s return value on
 * web; native has no popup concept and never injects an opener.
 */
export interface PopupWindowHandle {
  readonly closed: boolean;
  close(): void;
  location: { href: string };
}

/** State of the "Sign in with Oxy" (shared-key / QR) device flow. */
export interface SignInFlowState {
  phase: SignInFlowPhase;
  /**
   * The PUBLIC, single-use authorize code (safe to display), or `null`. NOT the
   * secret `sessionToken` — the approver resolves the app identity from this.
   */
  authorizeCode: string | null;
  /**
   * The structured deep-link / QR payload (`oxycommons://approve?...`) to render
   * as a QR (cross-device) and open as a deep link (same-device), or `null`.
   */
  qrPayload: string | null;
  /** Server-authoritative expiry (epoch ms), or `null`. */
  expiresAt: number | null;
  /** Human-readable error for the retry UI, or `null`. */
  error: string | null;
}

/** Immutable snapshot consumed by `useSyncExternalStore`. */
export interface AccountDialogSnapshot {
  /** The current view. */
  view: AccountDialogView;
  /** The unified, deduped account list (device sign-ins ∪ graph accounts). */
  accounts: SwitchableAccount[];
  /** The currently-active account id, or `null` when signed out. */
  activeAccountId: string | null;
  /** `true` while the initial account-list fetch is in flight with no data yet. */
  loading: boolean;
  /** A human-readable account-list error, or `null`. */
  error: string | null;
  /** The `accountId` of an in-flight switch, or `null`. */
  switchingAccountId: string | null;
  /** The "Sign in with Oxy" device-flow state. */
  signIn: SignInFlowState;
  /** Whether Commons is installed on this device. See {@link CommonsAvailability}. */
  commonsAvailability: CommonsAvailability;
}

/** Construction options for {@link AccountDialogController}. */
export interface AccountDialogControllerOptions {
  /** The API client. Source of graph accounts, profiles, and the sign-in methods. */
  oxyServices: OxyServices;
  /** The device-first session authority. Source of device rows + the switch path. */
  sessionClient: SessionClient;
  /**
   * The RP's registered OAuth client id (ApplicationCredential publicKey).
   * Required for the QR handoff (`startCommonsSignIn`); when absent, `showQr`
   * fails with a clear configuration error instead of creating a session the
   * server would reject.
   */
  clientId?: string | null;
  /** Locale for display-name resolution. */
  locale?: string;
  /**
   * Commit a freshly-authorized SIGN-IN session (device flow / shared identity)
   * into the host's session set — device-first registration + durable persist +
   * profile hydration. The consumer supplies its provider's commit path
   * (`useOxy().handleWebSession` / the auth-sdk equivalent). Called AFTER the SDK
   * has planted the access token. When omitted the controller falls back to
   * `SessionClient.registerAndActivate` (registration + activation only — no
   * provider-side durable persist/hydration).
   *
   * This is the SIGN-IN commit: on an official web origin it may run the
   * cross-origin hub-sync (a full-page redirect to `auth.oxy.so/sync`) that
   * bootstraps silent OAuth restore on OTHER origins. A first sign-in on a web
   * origin legitimately needs that. An account SWITCH does NOT — see
   * {@link commitSwitchedSession}.
   */
  commitSession?: (session: SessionLoginResponse) => Promise<void>;
  /**
   * Commit a minted graph SWITCH session into the host's session set — same
   * device-first registration + durable persist + profile hydration as
   * {@link commitSession}, but IN-PLACE: it must NOT trigger the cross-origin
   * hub-sync redirect. Switching into an account you already operate reuses the
   * device credential that was already hub-synced at the original sign-in, so
   * re-syncing is redundant and a full-page redirect on switch is the exact
   * regression this separation prevents. Cross-tab/app propagation of the switch
   * still happens instantly via the server's device-scoped `session_state` /
   * `session_accounts_changed` socket broadcast — no navigation required.
   *
   * When omitted the controller falls back to {@link commitSession} (if wired)
   * and then to `SessionClient.registerAndActivate`.
   */
  commitSwitchedSession?: (session: SessionLoginResponse) => Promise<void>;
  /** Notified after a completed sign-in (bearer planted + session committed). */
  onSignedIn?: (user: MinimalUserData) => void;
  /**
   * QR device-flow FALLBACK poll interval in ms (default 12000). The primary
   * approval signal is the `/auth-session` socket's `auth_update` event (instant);
   * this slow poll is only the safety net for when the socket can't connect.
   */
  pollIntervalMs?: number;
  /**
   * Statically-injected `socket.io-client` factory (its `io` export), same as
   * {@link SessionClient}'s. When provided, the QR flow subscribes to the
   * `/auth-session` namespace for an INSTANT `auth_update` wake instead of relying
   * on the slow fallback poll. Absent on web builds without a bundled `io` and in
   * headless/core usage → the controller silently degrades to poll-only.
   */
  socketFactory?: SocketIOFactory;
  /**
   * Optional URL opener. When provided, the controller invokes it to deep-link
   * the Commons app for the QR handoff (web: `location.assign`; native:
   * `Linking.openURL`). Headless core never touches `window`/`Linking` itself.
   */
  openUrl?: (url: string) => void;
  /**
   * Optional "can this app open this URL scheme?" probe, symmetric to
   * {@link openUrl}. When provided, `showQr` uses it to detect an installed
   * Commons (`oxycommons://`) and, if present, deep-links straight into its
   * approve screen via {@link openUrl} — while KEEPING the QR/polling active as
   * the fallback. Injected by the provider (native: `Linking.canOpenURL`; web:
   * absent/false). Headless core never touches `Linking` itself; when absent
   * `showQr` behaves exactly as before (render QR only).
   */
  canOpenApp?: (url: string) => Promise<boolean>;
  /**
   * Open a new, empty popup window SYNCHRONOUSLY (before any `await`) so the
   * browser attributes it to the click gesture that triggered it, returning a
   * handle to navigate once the device-flow session is known — or `null` if
   * the popup was blocked. Injected by the provider (web only:
   * `window.open('', ...)`; absent on native, where the hub-popup flow does
   * not apply). Used by {@link AccountDialogController.startPasskeyHubSignIn}.
   */
  openPopup?: () => PopupWindowHandle | null;
  /**
   * Base origin of the auth.oxy.so passkey hub (defaults to
   * `https://auth.${CENTRAL_IDP_APEX}`). Overridable for local/staging testing.
   */
  hubBaseUrl?: string;
}

/**
 * Slow FALLBACK poll cadence for the QR flow. The `/auth-session` socket delivers
 * the approval instantly via `auth_update`; this poll only covers the case where
 * the socket can't connect, so it is deliberately slow (was 3000 when polling was
 * the sole mechanism).
 */
const DEFAULT_POLL_INTERVAL_MS = 12000;

/** Socket.IO namespace the API emits QR-flow approval (`auth_update`) events on. */
const AUTH_SESSION_NAMESPACE = '/auth-session';

/**
 * Commons's custom URL scheme. Probed via the injected `canOpenApp` to detect an
 * installed Commons on the same device; the `oxycommons://approve?...` deep link
 * itself is the flow's `qrPayload`.
 */
const COMMONS_APP_SCHEME = 'oxycommons://';

const IDLE_SIGN_IN: SignInFlowState = {
  phase: 'idle',
  authorizeCode: null,
  qrPayload: null,
  expiresAt: null,
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type SnapshotListener = (snapshot: AccountDialogSnapshot) => void;

export class AccountDialogController {
  private readonly oxyServices: OxyServices;
  private readonly sessionClient: SessionClient;
  private readonly clientId: string | null;
  private readonly locale?: string;
  private readonly commitSession?: (session: SessionLoginResponse) => Promise<void>;
  private readonly commitSwitchedSession?: (session: SessionLoginResponse) => Promise<void>;
  private readonly onSignedIn?: (user: MinimalUserData) => void;
  private readonly pollIntervalMs: number;
  private readonly openUrl?: (url: string) => void;
  private readonly canOpenApp?: (url: string) => Promise<boolean>;
  private readonly socketFactory?: SocketIOFactory;
  private readonly openPopup?: () => PopupWindowHandle | null;
  private readonly hubBaseUrl: string;

  private readonly listeners = new Set<SnapshotListener>();

  // --- Internal (unprojected) state ---
  private view: AccountDialogView = 'accounts';
  private graph: AccountNode[] = [];
  private profilesById = new Map<string, User>();
  private loading = false;
  private error: string | null = null;
  private switchingAccountId: string | null = null;
  private signIn: SignInFlowState = IDLE_SIGN_IN;
  private commonsAvailability: CommonsAvailability = 'unknown';

  // --- Sign-in device-flow bookkeeping ---
  /** The secret device-flow token of the active QR flow (never surfaced). */
  private signInToken: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The `/auth-session` socket for the active QR flow, or null (poll-only). Its
   * `auth_update` event wakes {@link pollOnce} instantly instead of waiting for the
   * slow fallback timer.
   */
  private authSessionSocket: MinimalSocket | null = null;
  /**
   * Guards {@link pollOnce} against re-entrancy: the fallback timer and a socket
   * `auth_update` wake can fire together — without this both could claim the
   * single-use token concurrently.
   */
  private pollInFlight = false;
  /** The popup opened by {@link startPasskeyHubSignIn}, or `null`. */
  private activePopup: PopupWindowHandle | null = null;
  /** Watches {@link activePopup}'s `closed` state; see {@link watchPopup}. */
  private popupWatchTimer: ReturnType<typeof setInterval> | null = null;

  // --- Store plumbing ---
  private unsubscribeSession: (() => void) | null = null;
  private unsubscribeTokens: (() => void) | null = null;
  /** Last-observed SDK auth readiness (a planted bearer). Drives the fetch edge. */
  private authed = false;
  private started = false;
  private refreshSeq = 0;
  private snapshot: AccountDialogSnapshot;

  constructor(options: AccountDialogControllerOptions) {
    this.oxyServices = options.oxyServices;
    this.sessionClient = options.sessionClient;
    this.clientId = options.clientId ?? null;
    this.locale = options.locale;
    this.commitSession = options.commitSession;
    this.commitSwitchedSession = options.commitSwitchedSession;
    this.onSignedIn = options.onSignedIn;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.openUrl = options.openUrl;
    this.canOpenApp = options.canOpenApp;
    this.socketFactory = options.socketFactory;
    this.openPopup = options.openPopup;
    this.hubBaseUrl = options.hubBaseUrl ?? `https://auth.${CENTRAL_IDP_APEX}`;
    this.snapshot = this.computeSnapshot();
  }

  // =========================================================================
  // Store surface (useSyncExternalStore)
  // =========================================================================

  /** Returns the current immutable snapshot (stable reference between changes). */
  getSnapshot(): AccountDialogSnapshot {
    return this.snapshot;
  }

  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Begin driving the dialog: subscribe to `SessionClient` state and load the
   * account list. Idempotent — a second `start()` is a no-op. Pair with
   * {@link destroy}.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.authed = this.isAuthenticated();
    this.unsubscribeSession = this.sessionClient.subscribe(() => {
      // A device-state change (switch / sign-out / sibling sign-in) can add or
      // remove accounts — re-project immediately, refetch profiles when new
      // account ids appeared, and reconcile the auth-readiness edge.
      this.emit();
      void this.ensureProfiles();
      this.reconcileAuth();
    });
    // The access token is planted AFTER `SessionClient.applyState` fires its
    // subscription (`applySync` calls `setTokens` only once `applyState`/notify
    // has returned; `ensureActiveToken` plants it async later), so the
    // device-state subscription alone cannot observe the signed-out → signed-in
    // edge. Observe the SDK-canonical readiness signal directly — a change to
    // `oxyServices.getAccessToken()`, the `hasAccessToken` term of
    // `OxyContext.canUsePrivateApi`.
    this.unsubscribeTokens = this.oxyServices.onTokensChanged(() => {
      this.reconcileAuth();
    });
    // Initial projection is device-only. `refresh()` fetches the graph IFF a
    // bearer is already planted (warm start); when signed out (cold boot before
    // restore) it re-projects from device state and makes NO private call.
    void this.refresh();
    // Eager, cached Commons-availability probe (native only — a no-op when no
    // `canOpenApp` was injected). It's a cheap local OS check, so by the time a
    // user actually opens the sign-in entry it has almost always resolved —
    // `showQr`'s own lazy probe below is only the safety net for the rare race.
    void this.resolveCommonsAvailability();
  }

  /**
   * Stop driving the dialog: unsubscribe from `SessionClient` and tear down the
   * active sign-in flow (timers). Idempotent.
   */
  destroy(): void {
    this.started = false;
    if (this.unsubscribeSession) {
      this.unsubscribeSession();
      this.unsubscribeSession = null;
    }
    if (this.unsubscribeTokens) {
      this.unsubscribeTokens();
      this.unsubscribeTokens = null;
    }
    this.clearPollTimer();
    this.closeAuthSessionSocket();
    this.closeActivePopup();
    this.signInToken = null;
    this.listeners.clear();
  }

  // =========================================================================
  // Auth readiness (SDK-canonical — mirrors OxyContext.canUsePrivateApi)
  // =========================================================================

  /**
   * Whether a PRIVATE endpoint may be called right now. Mirrors the
   * `hasAccessToken` term of `OxyContext.canUsePrivateApi`
   * (`authResolved && isAuthenticated && tokenReady && hasAccessToken`, where
   * `hasAccessToken = Boolean(oxyServices.getAccessToken())`): a planted bearer
   * is the only term that decides whether a request carries auth — the other
   * three are provider render-lifecycle gates with no headless equivalent.
   *
   * `listAccounts()` (`GET /accounts`) and `getUsersByIds()`
   * (`POST /users/by-ids`) are private; calling either before cold-boot restore
   * plants the token 401s → `HttpService` clears the bearer + emits
   * `onTokensChanged(null)` → the app signs out. Every graph/profile fetch gates
   * on this.
   */
  private isAuthenticated(): boolean {
    return Boolean(this.oxyServices.getAccessToken());
  }

  /**
   * Reconcile the account graph against the current auth-readiness edge. On the
   * signed-out → signed-in edge fetch the graph ONCE; on signed-in → signed-out
   * drop it and re-project device-only. A no-op when readiness is unchanged, so
   * a burst of token events / device pushes cannot restart the fetch — and a
   * failed `listAccounts()` never flips the edge, so it cannot re-trigger itself
   * (no retry storm).
   */
  private reconcileAuth(): void {
    const authed = this.isAuthenticated();
    if (authed === this.authed) return;
    this.authed = authed;
    if (authed) {
      void this.refresh();
      return;
    }
    // Signed out: the graph is no longer fetchable/switchable — drop it and
    // re-project from the device session set alone.
    this.graph = [];
    this.error = null;
    this.loading = false;
    this.emit();
  }

  // =========================================================================
  // View actions
  // =========================================================================

  /** Set the dialog view directly. */
  setView(view: AccountDialogView): void {
    if (this.view === view) return;
    this.view = view;
    this.emit();
  }

  /** Return to the account list and cancel any in-flight sign-in flow. */
  close(): void {
    this.cancelSignIn();
    this.setView('accounts');
  }

  /** Switch to the "add account" view (the sign-in entry chooser). */
  add(): void {
    this.setView('add');
  }

  /** Switch to the "create account" view (passkey / Commons signup entry). */
  startSignup(): void {
    this.setView('signup');
  }

  // =========================================================================
  // Account list
  // =========================================================================

  /**
   * Reload the account graph and per-account profiles, then re-project. Safe to
   * call repeatedly; concurrent calls are reconciled by a sequence guard so a
   * slow earlier fetch never overwrites a newer result.
   */
  async refresh(): Promise<void> {
    const seq = ++this.refreshSeq;

    // Never hit the private `listAccounts()` while signed out: at cold boot the
    // bearer is not planted yet, so the call 401s → `HttpService` clears the
    // token and signs the user out. Re-project from the device session set alone
    // (`projectSwitchableAccounts` works from `SessionClient` state) and stop.
    if (!this.isAuthenticated()) {
      this.graph = [];
      this.loading = false;
      this.error = null;
      this.emit();
      return;
    }

    const hadAccounts = this.snapshot.accounts.length > 0;
    this.loading = !hadAccounts;
    this.error = null;
    this.emit();

    let graph: AccountNode[] = this.graph;
    try {
      graph = await this.oxyServices.listAccounts();
    } catch (error) {
      // A 401 here is the EXPECTED signed-out edge, not a failure: the bearer was
      // stale/revoked, so `HttpService` already cleared it and emitted
      // `onTokensChanged(null)`, which drops the graph via `reconcileAuth`. Log at
      // debug and leave the dialog error-free — a signed-out device with zero
      // accounts is a normal state, not a warning. Any other error (network, 5xx,
      // malformed) IS unexpected: surface it and warn while keeping the prior graph
      // so device rows still render.
      if (extractErrorStatus(error) === 401) {
        logger.debug('[AccountDialogController] listAccounts unauthorized (signed out)', { component: 'AccountDialogController' }, error);
      } else {
        this.error = errorMessage(error);
        logger.warn('[AccountDialogController] listAccounts failed', { component: 'AccountDialogController' }, error);
      }
    }
    if (seq !== this.refreshSeq) return; // superseded by a newer refresh

    this.graph = graph;
    await this.loadProfiles(seq);
    if (seq !== this.refreshSeq) return;

    this.loading = false;
    this.emit();
  }

  /**
   * Fetch profiles for any account id (device set ∪ graph) not yet resolved.
   * Cheap no-op when everything is already hydrated — used from the session
   * subscription so a newly-added device account gets a name/avatar.
   */
  private async ensureProfiles(): Promise<void> {
    // `getUsersByIds` is private — skip the whole path while signed out.
    if (!this.isAuthenticated()) return;
    const ids = switchableAccountIds(this.sessionClient.getState(), this.graph);
    if (ids.every((id) => this.profilesById.has(id))) return;
    await this.loadProfiles(this.refreshSeq);
    this.emit();
  }

  private async loadProfiles(seq: number): Promise<void> {
    // `getUsersByIds` (`POST /users/by-ids`) is a private call — never issue it
    // while signed out (the 401 → sign-out cascade). Callers already gate; this
    // guards the network chokepoint too (e.g. the token was cleared mid-refresh).
    if (!this.isAuthenticated()) return;
    const ids = switchableAccountIds(this.sessionClient.getState(), this.graph);
    if (ids.length === 0) return;
    let profiles: User[] = [];
    try {
      profiles = await this.oxyServices.getUsersByIds(ids);
    } catch (error) {
      // A 401 is the EXPECTED signed-out edge (stale/cleared bearer) — log at debug.
      // `getUsersByIds` already swallows per-chunk failures and returns `[]`, so any
      // OTHER error here is an unexpected total failure worth a warn. Either way keep
      // the prior profile map.
      if (extractErrorStatus(error) === 401) {
        logger.debug('[AccountDialogController] getUsersByIds unauthorized (signed out)', { component: 'AccountDialogController' }, error);
      } else {
        logger.warn('[AccountDialogController] getUsersByIds failed', { component: 'AccountDialogController' }, error);
      }
      return;
    }
    if (seq !== this.refreshSeq) return; // superseded
    const next = new Map(this.profilesById);
    for (const profile of profiles) {
      next.set(profile.id, profile);
    }
    this.profilesById = next;
  }

  // =========================================================================
  // Switching (uniform switch model — reuses the existing SDK primitives)
  // =========================================================================

  /**
   * Switch the active account to `accountId`.
   *
   * Uniform switch model, mirroring the SDK's existing path — NOT a new switch
   * mechanism:
   *   - already on this device → `SessionClient.switchAccount` (device-first
   *     switch of `/session/device/switch`);
   *   - a graph account not yet on the device (first entry) →
   *     `oxyServices.switchToAccount` mints + plants a real session and the
   *     server registers it into the device set, then it is committed
   *     (`commitSession` when supplied, else `SessionClient.registerAndActivate`).
   *
   * The resulting device-state change flows back through the `SessionClient`
   * subscription, which re-projects the active row. Concurrent switches are
   * ignored while one is in flight.
   */
  async switchTo(accountId: string): Promise<void> {
    if (this.switchingAccountId) return;
    this.switchingAccountId = accountId;
    this.error = null;
    this.emit();
    try {
      const state = this.sessionClient.getState();
      const onDevice = state?.accounts.some((account) => account.accountId === accountId) ?? false;
      if (onDevice) {
        await this.sessionClient.switchAccount(accountId);
      } else {
        const result = await this.oxyServices.switchToAccount(accountId);
        if (!result?.user || !result?.sessionId) {
          throw new Error('Account switch did not return a valid session');
        }
        await this.commitAuthorizedSession(
          {
            sessionId: result.sessionId,
            deviceId: result.deviceId,
            expiresAt: result.expiresAt,
            user: result.user,
            accessToken: result.accessToken,
          },
          result.user,
          // A switch is IN-PLACE: commit without the hub-sync redirect (the
          // device is already known/synced). Cross-tab/app propagation rides the
          // server's `session_state` socket broadcast, not a navigation.
          { fromSwitch: true },
        );
      }
      // Re-project + refetch immediately; the subscription also fires.
      await this.refresh();
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.switchingAccountId = null;
      this.emit();
    }
  }

  // =========================================================================
  // Sign in with Oxy (device flow — shared keychain, else cross-device QR)
  // =========================================================================

  /**
   * Start "Sign in with Oxy". Native devices with a shared identity mint a
   * session silently (`signInWithSharedIdentity`); everything else (web, or a
   * native device without a shared identity) falls through to the cross-device
   * QR handoff.
   */
  async signInWithOxy(): Promise<void> {
    this.setView('qr');
    this.setSignIn({ ...IDLE_SIGN_IN, phase: 'starting' });
    try {
      const session = await this.oxyServices.signInWithSharedIdentity();
      if (session) {
        await this.completeSignIn(session, session.user);
        return;
      }
    } catch (error) {
      // Shared-key mint failed — log and fall through to the QR handoff rather
      // than dead-ending the sign-in.
      logger.warn('[AccountDialogController] signInWithSharedIdentity failed', { component: 'AccountDialogController' }, error);
    }
    await this.showQr();
  }

  /**
   * Begin (or restart) the cross-device QR handoff: create a device-flow
   * session, surface its `authorizeCode` + `qrPayload`, and poll for approval.
   * On approval the secret token is exchanged (`claimSessionByToken`) and the
   * session committed. Requires `clientId`.
   */
  async showQr(): Promise<void> {
    this.cancelSignIn();
    this.setView('qr');
    await this.startDeviceFlowSession();
  }

  /**
   * Web-only: "Sign in with a passkey" on a non-Oxy origin cannot run the
   * WebAuthn ceremony locally — a credential minted with `WEBAUTHN_RP_ID=oxy.so`
   * can only be asserted from `oxy.so`/a subdomain/loopback, a browser-enforced
   * boundary `isOxyRpOrigin()` (consumer-side) already gates on. Instead, open
   * a popup at the auth.oxy.so passkey hub, scoped to the SAME device-flow
   * session {@link showQr} would create (same `authorizeCode`/`sessionToken`
   * pair), and let the SAME poll/socket/claim engine complete it once the hub
   * authorizes the session (`POST /auth/session/authorize-code/:authorizeCode`,
   * bearer-authed, server-side — this method never sees or transmits the
   * secret `sessionToken`).
   *
   * The popup MUST be opened synchronously, before any `await`, or the
   * browser's popup blocker loses the click-gesture attribution and silently
   * blocks it — so {@link openPopup} is invoked as the very first step, before
   * the device-flow session (which needs an async call) even exists. If the
   * popup is blocked (or no `openPopup` was injected), this falls back to
   * `showQr`'s plain QR rendering — no dead end.
   */
  async startPasskeyHubSignIn(): Promise<void> {
    this.cancelSignIn();
    this.setView('qr');
    const popup = this.openPopup?.() ?? null;
    if (!popup) {
      await this.startDeviceFlowSession();
      return;
    }
    const handle = await this.startDeviceFlowSession();
    if (!handle) {
      popup.close();
      return;
    }
    // The user may have closed the popup during the async session creation
    // above, before any watcher was attached to catch it — guard rather than
    // navigate a dead window (browsers vary on whether that throws).
    if (popup.closed) {
      this.failSignIn('Sign-in was cancelled.');
      return;
    }
    this.activePopup = popup;
    popup.location.href = `${this.hubBaseUrl}/hub-passkey?code=${encodeURIComponent(handle.authorizeCode)}`;
    this.watchPopup(popup);
  }

  /**
   * Shared device-flow session creation for both {@link showQr} (renders the
   * QR) and {@link startPasskeyHubSignIn} (also opens the hub popup) — the
   * same `startCommonsSignIn` → poll/socket wiring either way. Returns the
   * handle on success (already reflected in `signIn`), or `null` on failure
   * (already set as `signIn.error`).
   */
  private async startDeviceFlowSession(): Promise<CommonsSignInHandle | null> {
    if (!this.clientId) {
      this.setSignIn({ ...IDLE_SIGN_IN, phase: 'error', error: 'This app is not configured for sign-in (missing clientId).' });
      return null;
    }
    this.setSignIn({ ...IDLE_SIGN_IN, phase: 'starting' });
    try {
      const handle = await this.oxyServices.startCommonsSignIn({ clientId: this.clientId });
      this.signInToken = handle.sessionToken;
      this.setSignIn({
        phase: 'waiting',
        authorizeCode: handle.authorizeCode,
        qrPayload: handle.qrPayload,
        expiresAt: handle.expiresAt,
        error: null,
      });
      // Primary path: an instant `auth_update` wake over the `/auth-session`
      // socket. The poll below is only the fallback for when the socket can't
      // connect, so it now runs at the slow fallback cadence.
      this.openAuthSessionSocket(handle.sessionToken);
      this.scheduleNextPoll(handle.sessionToken);
      // Same-device convenience: if Commons is confirmed installed (native
      // only — stays `'unknown'` on web, where this never opens anything),
      // deep-link straight into its approve screen with the same
      // `oxycommons://approve?...` payload the QR encodes. The QR + polling
      // stay live as the fallback, so a user who dismisses the app-open still
      // completes the sign-in by scanning.
      void this.deepLinkIntoCommonsIfAvailable(handle.qrPayload);
      return handle;
    } catch (error) {
      this.setSignIn({ ...IDLE_SIGN_IN, phase: 'error', error: errorMessage(error) });
      return null;
    }
  }

  /**
   * Poll {@link PopupWindowHandle.closed} so a user who dismisses the hub
   * popup without completing sign-in gets prompt feedback (there is no DOM
   * event for a cross-origin popup closing — polling is the only mechanism).
   * Cleared by {@link closeActivePopup}, which every sign-in exit path already
   * calls.
   */
  private watchPopup(popup: PopupWindowHandle): void {
    this.clearPopupWatchTimer();
    this.popupWatchTimer = setInterval(() => {
      if (!popup.closed) return;
      this.clearPopupWatchTimer();
      if (this.signIn.phase === 'starting' || this.signIn.phase === 'waiting') {
        this.failSignIn('Sign-in was cancelled.');
      }
    }, 1000);
  }

  private clearPopupWatchTimer(): void {
    if (this.popupWatchTimer !== null) {
      clearInterval(this.popupWatchTimer);
      this.popupWatchTimer = null;
    }
  }

  /** Tear down the popup watch timer and close the popup, if any. Idempotent. */
  private closeActivePopup(): void {
    this.clearPopupWatchTimer();
    const popup = this.activePopup;
    this.activePopup = null;
    if (!popup || popup.closed) return;
    try {
      popup.close();
    } catch (error) {
      logger.debug('[AccountDialogController] popup close failed', { component: 'AccountDialogController' }, error);
    }
  }

  /**
   * Resolve whether Commons is installed on this device via the injected
   * `canOpenApp` probe, updating {@link commonsAvailability} as durable,
   * observable snapshot state. Native only — a no-op when `canOpenApp` was
   * not injected (web), where `commonsAvailability` stays `'unknown'` forever
   * and the QR view renders unconditionally (no gating).
   *
   * Replaces the old `maybeOpenCommons` fire-and-forget probe, whose outcome
   * was only ever reflected by whether Commons silently opened — a probe
   * failure or "not installed" answer was swallowed into a debug log with no
   * way for the UI to react. `commonsAvailability` fixes that.
   */
  private async resolveCommonsAvailability(): Promise<void> {
    if (!this.canOpenApp) return;
    this.commonsAvailability = 'checking';
    this.emit();
    let available = false;
    try {
      available = await this.canOpenApp(COMMONS_APP_SCHEME);
    } catch (error) {
      logger.debug(
        '[AccountDialogController] Commons availability probe failed',
        { component: 'AccountDialogController' },
        error,
      );
      available = false; // fail-closed — treat a probe error as "not installed"
    }
    this.commonsAvailability = available ? 'available' : 'unavailable';
    this.emit();
  }

  /**
   * When Commons is confirmed installed, deep-link straight into its approve
   * screen via the injected `openUrl` with the same `oxycommons://approve?...`
   * payload the QR encodes. Best-effort and non-blocking — the QR/polling
   * fallback stays live regardless of the outcome here.
   */
  private async deepLinkIntoCommonsIfAvailable(qrPayload: string): Promise<void> {
    if (!this.openUrl) return;
    if (this.commonsAvailability === 'unknown' || this.commonsAvailability === 'checking') {
      // The eager `start()` probe hasn't resolved yet (or was never run, e.g.
      // `showQr` called without a prior `start()`) — resolve it now rather
      // than skipping the deep link.
      await this.resolveCommonsAvailability();
    }
    if (this.commonsAvailability === 'available') {
      this.openUrl(qrPayload);
    }
  }

  /** Tear down the active sign-in device flow (timers + socket + popup + token) and reset to idle. */
  cancelSignIn(): void {
    this.clearPollTimer();
    this.closeAuthSessionSocket();
    this.closeActivePopup();
    this.signInToken = null;
    if (this.signIn !== IDLE_SIGN_IN) {
      this.setSignIn(IDLE_SIGN_IN);
    }
  }

  // =========================================================================
  // Internal sign-in helpers
  // =========================================================================

  private scheduleNextPoll(sessionToken: string): void {
    this.clearPollTimer();
    this.pollTimer = setTimeout(() => {
      void this.pollOnce(sessionToken);
    }, this.pollIntervalMs);
  }

  /**
   * Run one status check + (on approval) claim. Triggered by the fallback timer
   * AND by the `/auth-session` socket's `auth_update` wake, so it is guarded
   * against concurrent entry: whichever fires first claims the single-use token;
   * the other no-ops. The `auth_update` payload is never trusted — this always
   * re-checks the authoritative status via `pollCommonsSignIn`.
   */
  private async pollOnce(sessionToken: string): Promise<void> {
    // A superseded / cancelled flow must not act; a poll already running owns the claim.
    if (this.signInToken !== sessionToken || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const expiresAt = this.signIn.expiresAt;
      if (typeof expiresAt === 'number' && Date.now() > expiresAt) {
        this.failSignIn('Session expired. Please try again.');
        return;
      }
      try {
        const status = await this.oxyServices.pollCommonsSignIn(sessionToken);
        if (this.signInToken !== sessionToken) return; // cancelled mid-request
        if (status.authorized && status.sessionId) {
          this.clearPollTimer();
          await this.claimAndComplete(status.sessionId, sessionToken);
          return;
        }
        if (status.status === 'cancelled') {
          this.failSignIn('Authorization was denied.');
          return;
        }
        if (status.status === 'expired') {
          this.failSignIn('Session expired. Please try again.');
          return;
        }
      } catch (error) {
        // Transient poll error — the next tick retries. Logged, never thrown.
        logger.debug('[AccountDialogController] poll error (will retry)', { component: 'AccountDialogController' }, error);
      }
      if (this.signInToken === sessionToken) {
        this.scheduleNextPoll(sessionToken);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async claimAndComplete(sessionId: string, sessionToken: string): Promise<void> {
    this.setSignIn({ ...this.signIn, phase: 'authorized' });
    let claimed: {
      accessToken: string;
      sessionId: string;
      deviceId: string;
      expiresAt: string;
      user: User;
      deviceSecret?: string;
    };
    try {
      claimed = await this.oxyServices.claimSessionByToken(sessionToken);
    } catch (error) {
      this.failSignIn(errorMessage(error));
      return;
    }
    if (!claimed?.accessToken || !claimed.user) {
      this.failSignIn('Authorization succeeded but the session could not be claimed. Please try again.');
      return;
    }
    // `SessionLoginResponse.user` is the minimal session-carried shape; the claim
    // returns the full `User` (avatar is `string | null | undefined`). Normalize
    // rather than widening the minimal shape to accept `null`.
    const minimalUser: MinimalUserData = {
      id: claimed.user.id,
      username: claimed.user.username,
      name: claimed.user.name,
      avatar: claimed.user.avatar ?? undefined,
    };
    try {
      await this.completeSignIn(
        {
          sessionId: claimed.sessionId || sessionId,
          deviceId: claimed.deviceId ?? '',
          expiresAt: claimed.expiresAt ?? '',
          user: minimalUser,
          accessToken: claimed.accessToken,
          ...(claimed.deviceSecret ? { deviceSecret: claimed.deviceSecret } : {}),
        },
        minimalUser,
      );
    } catch (error) {
      this.failSignIn(errorMessage(error));
    }
  }

  /**
   * Commit an authorized session, notify, and return to the account list. Shared
   * by the shared-key, QR, and mint-switch paths so they cannot drift.
   */
  private async completeSignIn(
    session: SessionLoginResponse,
    user: MinimalUserData,
  ): Promise<void> {
    await this.commitAuthorizedSession(session, user);
    this.signInToken = null;
    this.clearPollTimer();
    this.closeAuthSessionSocket();
    this.closeActivePopup();
    this.signIn = IDLE_SIGN_IN;
    this.view = 'accounts';
    this.emit();
    this.onSignedIn?.(user);
    await this.refresh();
  }

  /**
   * Register a token-planted session into the device set. Prefers the
   * consumer's commit funnel (durable persist + hydration); falls back to
   * `SessionClient.registerAndActivate` (registration + activation only).
   *
   * A SWITCH (`opts.fromSwitch`) uses the IN-PLACE `commitSwitchedSession` funnel
   * so it never runs the cross-origin hub-sync redirect; a SIGN-IN uses
   * `commitSession` (which may hub-sync on an official web origin). When the
   * switch funnel is not wired it falls back to the sign-in funnel, then to
   * `registerAndActivate`.
   */
  private async commitAuthorizedSession(
    session: SessionLoginResponse,
    user: MinimalUserData,
    opts?: { fromSwitch?: boolean },
  ): Promise<void> {
    const commit = opts?.fromSwitch
      ? this.commitSwitchedSession ?? this.commitSession
      : this.commitSession;
    if (commit) {
      await commit(session);
    } else {
      await this.sessionClient.registerAndActivate(user.id);
    }
  }

  private failSignIn(message: string): void {
    this.clearPollTimer();
    this.closeAuthSessionSocket();
    this.closeActivePopup();
    this.signInToken = null;
    this.setSignIn({ ...IDLE_SIGN_IN, phase: 'error', error: message });
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // =========================================================================
  // /auth-session socket (instant QR approval wake — replaces 3s polling)
  // =========================================================================

  /**
   * Subscribe the active QR flow to the `/auth-session` namespace so the API's
   * `auth_update` event wakes {@link pollOnce} the instant the approval lands.
   *
   * The join is keyed by the secret `sessionToken` (the server's `auth:<token>`
   * room, joined by emitting `join`) and re-issued on every (re)connect so it
   * survives socket drops. `auth_update` is treated as a pure SIGNAL — the payload
   * is never trusted; `pollOnce` re-checks the authoritative status and claims.
   *
   * No-op (poll-only) when no `socketFactory` was injected (web without a bundled
   * `io`, headless/core usage, tests). The namespace needs no auth.
   */
  private openAuthSessionSocket(sessionToken: string): void {
    this.closeAuthSessionSocket();
    if (!this.socketFactory) return;
    let socket: MinimalSocket;
    try {
      socket = this.socketFactory(`${this.oxyServices.getBaseURL()}${AUTH_SESSION_NAMESPACE}`, {
        transports: ['websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Number.POSITIVE_INFINITY,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
    } catch (error) {
      // Socket unavailable — the fallback poll still completes the flow.
      logger.debug('[AccountDialogController] auth-session socket create failed (poll fallback)', { component: 'AccountDialogController' }, error);
      return;
    }
    const join = (): void => {
      if (this.signInToken !== sessionToken) return;
      try {
        socket.emit('join', sessionToken);
      } catch (error) {
        logger.debug('[AccountDialogController] auth-session join failed', { component: 'AccountDialogController' }, error);
      }
    };
    socket.on('connect', join);
    if (socket.connected) join();
    socket.on('auth_update', () => {
      if (this.signInToken !== sessionToken) return;
      // Pure wake signal — re-check the authoritative status + claim the poll would have.
      void this.pollOnce(sessionToken);
    });
    this.authSessionSocket = socket;
  }

  /** Tear down the `/auth-session` socket, if any. Idempotent. */
  private closeAuthSessionSocket(): void {
    const socket = this.authSessionSocket;
    if (!socket) return;
    this.authSessionSocket = null;
    try {
      socket.off('auth_update');
      socket.off('connect');
      socket.disconnect();
    } catch (error) {
      logger.debug('[AccountDialogController] auth-session socket close failed', { component: 'AccountDialogController' }, error);
    }
  }

  // =========================================================================
  // Snapshot plumbing
  // =========================================================================

  private setSignIn(next: SignInFlowState): void {
    this.signIn = next;
    this.emit();
  }

  private computeSnapshot(): AccountDialogSnapshot {
    const state = this.sessionClient.getState();
    return {
      view: this.view,
      accounts: projectSwitchableAccounts({
        state,
        graph: this.graph,
        profilesById: this.profilesById,
        locale: this.locale,
        resolveAvatarUrl: (avatar) =>
          (avatar ? this.oxyServices.getFileDownloadUrl(avatar, 'thumb') : undefined),
      }),
      activeAccountId: state?.activeAccountId ?? null,
      loading: this.loading,
      error: this.error,
      switchingAccountId: this.switchingAccountId,
      signIn: this.signIn,
      commonsAvailability: this.commonsAvailability,
    };
  }

  /** Recompute the snapshot and notify subscribers. */
  private emit(): void {
    this.snapshot = this.computeSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch (error) {
        logger.error('[AccountDialogController] subscriber threw', error);
      }
    }
  }
}

/** Factory mirroring `createSessionClient`, for ergonomic wiring by consumers. */
export function createAccountDialogController(
  options: AccountDialogControllerOptions,
): AccountDialogController {
  return new AccountDialogController(options);
}

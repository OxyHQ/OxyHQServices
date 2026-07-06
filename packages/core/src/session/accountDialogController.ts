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
 *   - the dialog `view` state machine (`accounts` | `signin` | `qr` | `add`);
 *   - `switchTo` (the uniform switch: `SessionClient.switchAccount` for an
 *     account already on the device, `oxyServices.switchToAccount` to mint on
 *     first entry into a graph account — reusing the existing SDK primitives, no
 *     new switch path);
 *   - the "Sign in with Oxy" device flow (same-device shared-keychain via
 *     `oxyServices.signInWithSharedIdentity`, else the cross-device QR handoff
 *     via `startCommonsSignIn` → poll → `claimSessionByToken`).
 *
 * It deliberately owns NO password/2FA logic — those live at the IdP
 * (auth.oxy.so). {@link AccountDialogController.openPasswordAtOxyAuth} only
 * builds the hand-off URL; device-first convergence syncs the session back.
 */

import type { OxyServices } from '../OxyServices';
import type { SessionLoginResponse, MinimalUserData } from '../models/session';
import type { User } from '../models/interfaces';
import { logger } from '../utils/loggerUtils';
import { CENTRAL_IDP_APEX } from '../utils/authWebUrl';
import { SessionClient } from './SessionClient';
import {
  projectSwitchableAccounts,
  switchableAccountIds,
  type SwitchableAccount,
} from './accountProjection';
import type { AccountNode } from '../mixins/OxyServices.accounts';

/** The dialog's top-level view. */
export type AccountDialogView = 'accounts' | 'signin' | 'qr' | 'add';

/** Lifecycle phase of the "Sign in with Oxy" device flow. */
export type SignInFlowPhase = 'idle' | 'starting' | 'waiting' | 'authorized' | 'error';

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
   * Commit a freshly-authorized session (device flow / shared identity / minted
   * graph switch) into the host's session set — device-first registration +
   * durable persist + profile hydration. The consumer supplies its provider's
   * commit path (`useOxy().handleWebSession` / the auth-sdk equivalent). Called
   * AFTER the SDK has planted the access token. When omitted the controller
   * falls back to `SessionClient.registerAndActivate` (registration + activation
   * only — no provider-side durable persist/hydration).
   */
  commitSession?: (session: SessionLoginResponse & { refreshToken?: string }) => Promise<void>;
  /** Notified after a completed sign-in (bearer planted + session committed). */
  onSignedIn?: (user: MinimalUserData) => void;
  /** Central IdP apex for `openPasswordAtOxyAuth` (defaults to `CENTRAL_IDP_APEX`). */
  idpApex?: string;
  /** QR device-flow poll interval in ms (default 3000). */
  pollIntervalMs?: number;
  /**
   * Optional URL opener. When provided, `openPasswordAtOxyAuth` invokes it with
   * the built URL in addition to returning it (web: `location.assign`; native:
   * `Linking.openURL`). Headless core never touches `window`/`Linking` itself.
   */
  openUrl?: (url: string) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;

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
  private readonly commitSession?: (session: SessionLoginResponse & { refreshToken?: string }) => Promise<void>;
  private readonly onSignedIn?: (user: MinimalUserData) => void;
  private readonly idpApex: string;
  private readonly pollIntervalMs: number;
  private readonly openUrl?: (url: string) => void;

  private readonly listeners = new Set<SnapshotListener>();

  // --- Internal (unprojected) state ---
  private view: AccountDialogView = 'accounts';
  private graph: AccountNode[] = [];
  private profilesById = new Map<string, User>();
  private loading = false;
  private error: string | null = null;
  private switchingAccountId: string | null = null;
  private signIn: SignInFlowState = IDLE_SIGN_IN;

  // --- Sign-in device-flow bookkeeping ---
  /** The secret device-flow token of the active QR flow (never surfaced). */
  private signInToken: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.onSignedIn = options.onSignedIn;
    this.idpApex = options.idpApex ?? CENTRAL_IDP_APEX;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.openUrl = options.openUrl;
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
      // A graph-load failure is non-fatal: device rows still render. Surface the
      // message but keep going with whatever graph we already had.
      this.error = errorMessage(error);
      logger.warn('[AccountDialogController] listAccounts failed', { component: 'AccountDialogController' }, error);
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
      // `getUsersByIds` already swallows per-chunk failures and returns `[]`;
      // this guards the unexpected total failure. Non-fatal — keep prior map.
      logger.warn('[AccountDialogController] getUsersByIds failed', { component: 'AccountDialogController' }, error);
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
            ...(readRefreshToken(result) ? { refreshToken: readRefreshToken(result) } : {}),
          },
          result.user,
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
    if (!this.clientId) {
      this.setSignIn({ ...IDLE_SIGN_IN, phase: 'error', error: 'This app is not configured for sign-in (missing clientId).' });
      return;
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
      this.scheduleNextPoll(handle.sessionToken);
    } catch (error) {
      this.setSignIn({ ...IDLE_SIGN_IN, phase: 'error', error: errorMessage(error) });
    }
  }

  /** Tear down the active sign-in device flow (timers + token) and reset to idle. */
  cancelSignIn(): void {
    this.clearPollTimer();
    this.signInToken = null;
    if (this.signIn !== IDLE_SIGN_IN) {
      this.setSignIn(IDLE_SIGN_IN);
    }
  }

  /**
   * Build (and, when an `openUrl` handler was supplied, open) the auth.oxy.so
   * password sign-in URL. Password + 2FA are NOT in the SDK — they live at the
   * IdP; this only hands off. Device-first: after login at the IdP the device
   * session converges and the caller is woken via the device socket /
   * `BroadcastChannel`, so the URL only needs to point at the IdP sign-in with
   * the right return.
   *
   * @param params.returnUrl - Where the IdP returns after login. Defaults to the
   *   current document URL on web (`globalThis.location.href`); pass explicitly
   *   on native (no `location`).
   * @param params.state - Optional opaque state echoed back on return.
   * @returns The absolute auth.oxy.so sign-in URL.
   */
  openPasswordAtOxyAuth(params: { returnUrl?: string; state?: string } = {}): string {
    const base = `https://auth.${this.idpApex}`;
    const url = new URL('/login', base);
    const returnUrl = params.returnUrl ?? currentLocationHref();
    if (returnUrl) {
      url.searchParams.set('redirect_uri', returnUrl);
    }
    if (this.clientId) {
      url.searchParams.set('client_id', this.clientId);
    }
    if (params.state) {
      url.searchParams.set('state', params.state);
    }
    const href = url.toString();
    this.openUrl?.(href);
    return href;
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

  private async pollOnce(sessionToken: string): Promise<void> {
    // A superseded / cancelled flow must not act.
    if (this.signInToken !== sessionToken) return;
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
  }

  private async claimAndComplete(sessionId: string, sessionToken: string): Promise<void> {
    this.setSignIn({ ...this.signIn, phase: 'authorized' });
    let claimed: { accessToken: string; sessionId: string; deviceId: string; expiresAt: string; user: User };
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
    const refreshToken = readRefreshToken(claimed);
    try {
      await this.completeSignIn(
        {
          sessionId: claimed.sessionId || sessionId,
          deviceId: claimed.deviceId ?? '',
          expiresAt: claimed.expiresAt ?? '',
          user: minimalUser,
          accessToken: claimed.accessToken,
          ...(refreshToken ? { refreshToken } : {}),
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
    session: SessionLoginResponse & { refreshToken?: string },
    user: MinimalUserData,
  ): Promise<void> {
    await this.commitAuthorizedSession(session, user);
    this.signInToken = null;
    this.clearPollTimer();
    this.signIn = IDLE_SIGN_IN;
    this.view = 'accounts';
    this.emit();
    this.onSignedIn?.(user);
    await this.refresh();
  }

  /**
   * Register a token-planted session into the device set. Prefers the
   * consumer's `commitSession` (durable persist + hydration); falls back to
   * `SessionClient.registerAndActivate` (registration + activation only).
   */
  private async commitAuthorizedSession(
    session: SessionLoginResponse & { refreshToken?: string },
    user: MinimalUserData,
  ): Promise<void> {
    if (this.commitSession) {
      await this.commitSession(session);
    } else {
      await this.sessionClient.registerAndActivate(user.id);
    }
  }

  private failSignIn(message: string): void {
    this.clearPollTimer();
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

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * The rotating refresh-token family head is threaded on the runtime object by
 * the trusted device-flow / switch lanes even though it is NOT on the typed
 * return of `claimSessionByToken` / `switchToAccount`. Read it defensively so
 * the commit funnel can persist a durable session.
 */
function readRefreshToken(value: unknown): string | undefined {
  const token = (value as { refreshToken?: unknown }).refreshToken;
  return typeof token === 'string' ? token : undefined;
}

/** Current document URL on web; empty string where `location` is absent (native/SSR). */
function currentLocationHref(): string {
  const location = (globalThis as { location?: { href?: string } }).location;
  return typeof location?.href === 'string' ? location.href : '';
}

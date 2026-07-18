import {
  deviceSessionStateSchema,
  deviceSessionSyncSchema,
  safeParseContract,
  SESSION_ACCOUNTS_CHANGED_EVENT,
  sessionAccountsChangedEventSchema,
  type DeviceSessionState,
} from '@oxyhq/contracts';
import { logger } from '../logger';
import { computeIdentityTag } from '../utils/cacheKey';
import { getSocketIO } from './socketLoader';
import type { MinimalSocket, SocketIOFactory } from './socketLoader';

export interface TokenTransport {
  /** Ensure this app holds a per-domain access token for state.activeAccountId (mint via the persisted refresh family / shared keychain). Best-effort. */
  ensureActiveToken(state: DeviceSessionState): Promise<void>;
}

/**
 * Where an applied device state came from, so consumers can decide how
 * AUTHORITATIVE a zero-account ("signed out") verdict is:
 *  - `request` — the response to a direct REST call this client made
 *    (`bootstrap` / `switch` / `signOut` / `add`). A stable, server-authoritative
 *    verdict: an empty state here reflects a real sign-out or revocation, so the
 *    durable device credential MAY be erased.
 *  - `push` — an out-of-band Socket.IO `session_state` broadcast. Potentially
 *    transient (a reconnect race / another device's mutation), so an empty state
 *    here must NOT erase THIS origin's durable device credential — only clear the
 *    local UI session. A dead credential re-mints to `no_active_session` and
 *    resolves signed-out cleanly on the next boot; a wrongly-erased one cannot be
 *    recovered without a fresh sign-in.
 */
export type SessionStateOrigin = 'request' | 'push';

export interface DeviceCredential {
  deviceId: string;
  deviceSecret: string;
}

export interface SessionClientHost {
  makeRequest<T>(method: 'GET' | 'POST', url: string, data?: unknown, options?: { cache?: boolean }): Promise<T>;
  getBaseURL(): string;
  getAccessToken(): string | null;
  /** Zero-cookie device credential for socket handshake when no bearer is planted yet. */
  getDeviceCredential(): DeviceCredential | null;
  onTokensChanged(listener: (token: string | null) => void): () => void;
  setTokens(accessToken: string): void;
  getCurrentAccountId(): string | null;
}

export interface SessionClientOptions {
  transport?: TokenTransport;
  /**
   * Invoked when an APPLIED state has zero accounts — i.e. a device
   * signout-all removed the last account from this device set. Providers use
   * this to clear local session state and, for a `request`-origin verdict, the
   * persisted {@link AuthStateStore} so a reload does not try to restore a
   * session that no longer exists on the device.
   *
   * The {@link SessionStateOrigin} is passed so the consumer can gate the
   * DESTRUCTIVE credential wipe: a `push`-origin empty state (a socket broadcast,
   * possibly a transient reconnect artifact) must NOT erase the durable device
   * credential — only a `request`-origin verdict (a direct REST sign-out /
   * revocation) is authoritative enough for that.
   *
   * Only fires when a state is actually applied (revision advanced), never on
   * a stale/rejected push. Exceptions thrown by the callback are isolated.
   */
  onUnauthenticated?: (origin: SessionStateOrigin) => void;
  /**
   * Statically-injected `socket.io-client` factory (its `io` export).
   * `@oxyhq/services` lists `socket.io-client` as a real dependency and
   * passes `io` in directly, so realtime session sync never
   * depends on a runtime dynamic `import('socket.io-client')` of a bare
   * specifier — which is bundler-fragile in Metro/Expo-web and Vite when
   * `@oxyhq/core` is consumed as its published dist (the import resolves to
   * nothing → `connectSocket` warns and falls back to REST-only). When this is
   * provided, `connectSocket` uses it and never touches the lazy loader; when
   * absent it falls back to `getSocketIO()`.
   */
  socketFactory?: SocketIOFactory;
}

type StateListener = (state: DeviceSessionState | null) => void;

/**
 * Same-origin `BroadcastChannel` name for instant, network-free session-state
 * propagation across tabs of the SAME origin (e.g. two `accounts.oxy.so` tabs):
 * when one authenticated tab commits an account switch / sign-out, siblings
 * re-sync their device state without waiting on the socket. Cross-origin
 * same-apex propagation rides the authenticated device socket; cross-APEX
 * (mention.earth) relies on a reload — the documented limitation.
 */
const SESSION_BROADCAST_CHANNEL = 'oxy.session';

/** A minimal, feature-detected `BroadcastChannel` surface (absent on native RN). */
interface SessionBroadcastChannel {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export class SessionClient {
  private state: DeviceSessionState | null = null;
  private readonly listeners = new Set<StateListener>();
  protected socket: MinimalSocket | null = null;
  private tokenUnsub: (() => void) | null = null;
  private started = false;
  /** Same-origin cross-tab state-propagation channel; null on platforms without BroadcastChannel. */
  private channel: SessionBroadcastChannel | null = null;
  /** App-facing subscriptions to named server-pushed socket events. */
  private readonly serverEvents = new Map<string, Set<(payload: unknown) => void>>();
  /** Event names already bound on the CURRENT socket instance. */
  private readonly boundServerEvents = new Set<string>();

  constructor(
    protected readonly host: SessionClientHost,
    protected readonly options: SessionClientOptions = {},
  ) {}

  getState(): DeviceSessionState | null {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to a named server-pushed Socket.IO event (e.g. `civic:attested`).
   * Listeners survive reconnects and socket re-creation; the returned function
   * unsubscribes. Payloads are delivered as-is — callers validate shape.
   */
  onServerEvent(event: string, listener: (payload: unknown) => void): () => void {
    let listeners = this.serverEvents.get(event);
    if (!listeners) {
      listeners = new Set();
      this.serverEvents.set(event, listeners);
    }
    listeners.add(listener);
    this.bindServerEvent(event);
    return () => {
      listeners.delete(listener);
    };
  }

  private bindServerEvent(event: string): void {
    if (!this.socket || this.boundServerEvents.has(event)) return;
    this.boundServerEvents.add(event);
    this.socket.on(event, (payload: unknown) => {
      const listeners = this.serverEvents.get(event);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        try {
          listener(payload);
        } catch (error) {
          logger.warn('[SessionClient] server-event listener threw', { component: 'SessionClient' }, error);
        }
      }
    });
  }

  protected notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        logger.error('[SessionClient] subscriber threw', error);
      }
    }
  }

  /**
   * Validate + last-writer-wins by revision. Returns true if applied.
   *
   * `activeToken` (sync path only) is the server-issued access token for
   * `raw.activeAccountId`. When present and the state is applied, it is planted
   * BEFORE any subscriber is notified so the bearer already belongs to the new
   * active account — the local switch/bootstrap path then needs no redundant
   * device-secret mint. Push-origin applies carry no token and rely on the
   * mint-before-notify gate below.
   *
   * ORDERING INVARIANT: a subscriber must NEVER observe a newly-active account
   * while the planted bearer still identifies the PREVIOUS one — otherwise a
   * `useCurrentUser`-style refetch fires under the wrong account's token (the
   * account-switch 404 race). So when a transport is available and the planted
   * bearer does not already belong to `next.activeAccountId`, minting is awaited
   * BEFORE `notify()`. This covers EVERY notify source (a switch push, a
   * cross-device push, a cold mint), not just the initial "no bearer yet" case.
   */
  protected applyState(raw: unknown, origin: SessionStateOrigin = 'push', activeToken?: string): boolean {
    const next = safeParseContract(deviceSessionStateSchema, raw);
    if (!next) {
      logger.warn('[SessionClient] discarded invalid session state');
      return false;
    }
    // The revision is monotone ONLY within a single deviceId. When the incoming
    // state belongs to a DIFFERENT device than the currently-applied one, reset
    // the baseline and accept it regardless of revision: a freshly-converged
    // device (low revision) must not lose last-writer-wins to a stale, higher-
    // revision state from a retired device. Only when the deviceIds MATCH is the
    // `revision <= current` guard a valid staleness check.
    if (
      this.state &&
      next.deviceId === this.state.deviceId &&
      next.revision <= this.state.revision
    ) {
      return false;
    }
    const previousState = this.state;
    this.state = next;
    // Plant the sync-supplied active token (it is for `next.activeAccountId`)
    // now — before the notify below — so the bearer matches the new active
    // account when subscribers observe it. Guarded on difference to avoid a
    // redundant token-change notification on an unchanged token (bootstrap
    // restate).
    if (activeToken && next.activeAccountId !== null && activeToken !== this.host.getAccessToken()) {
      this.host.setTokens(activeToken);
    }
    const transport = this.options.transport;
    const activeAccountId = next.activeAccountId;
    // Mint before notifying when the bearer does not already belong to the new
    // active account: no bearer at all, an opaque bearer, OR a bearer for a
    // DIFFERENT account. `computeIdentityTag` yields the token's `userId`/`id`
    // for a real JWT (comparable to the account id) and a non-account sentinel
    // otherwise, so a mismatch always resolves to "mint".
    const needsMintBeforeNotify =
      transport != null &&
      next.accounts.length > 0 &&
      (activeAccountId === null || computeIdentityTag(this.host.getAccessToken()) !== activeAccountId);

    const finishApply = (): void => {
      this.notify();
      if (next.accounts.length === 0 && this.options.onUnauthenticated) {
        try {
          this.options.onUnauthenticated(origin);
        } catch (error) {
          logger.error('[SessionClient] onUnauthenticated threw', error);
        }
      }
    };

    if (needsMintBeforeNotify) {
      void transport.ensureActiveToken(next).then(finishApply).catch((error) => {
        logger.warn('[SessionClient] ensureActiveToken failed — reverting session state', { component: 'SessionClient' }, error);
        // Do NOT notify under a mismatched bearer. Revert to the last applied
        // state so subscribers keep observing the account whose token is planted.
        this.state = previousState ?? null;
      });
    } else {
      if (transport) {
        void transport.ensureActiveToken(next).catch((error) => {
          logger.warn('[SessionClient] ensureActiveToken failed', { component: 'SessionClient' }, error);
        });
      }
      finishApply();
    }
    return true;
  }

  /**
   * Validate `{ state, activeToken }`, apply the state, and plant the active token host-side.
   * Token-planting is decoupled from whether `applyState` advanced the revision: a socket push
   * followed by this same `GET /state` fetch returns the SAME revision (applyState no-ops), but
   * the token still needs to be planted. The account-match guard rejects a stale response for an
   * account that is no longer active.
   */
  private applySync(raw: unknown): void {
    const sync = safeParseContract(deviceSessionSyncSchema, raw);
    if (!sync) {
      const parsed = deviceSessionSyncSchema.safeParse(raw);
      // Log field-level type diagnostics ONLY — never values. The payload carries tokens and
      // session ids; issue.path/code and the invalid_type expected/received TYPE names are safe,
      // but zod messages can embed offending values for other codes, so they are omitted.
      const issues = parsed.success
        ? []
        : parsed.error.issues.map((issue) =>
            issue.code === 'invalid_type'
              ? { path: issue.path.join('.'), code: issue.code, expected: issue.expected, received: issue.received }
              : { path: issue.path.join('.'), code: issue.code },
          );
      const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
      logger.warn('[SessionClient] discarded invalid session sync', { component: 'SessionClient', issues, keys });
      return;
    }
    // A `sync` is always the response to a direct REST call this client made
    // (bootstrap / switch / signOut / add) → a `request`-origin, authoritative
    // verdict. Hand the active token to `applyState`: in the applied path it is
    // planted BEFORE notify (bearer matches the new active account when
    // subscribers observe it, and no redundant device-secret mint is triggered).
    const applied = this.applyState(sync.state, 'request', sync.activeToken?.accessToken);
    // Equal-revision restate (this revision was already applied by a preceding
    // socket push): `applyState` no-ops without planting, but the token still
    // needs planting. Guard on the sync's active account STILL being the current
    // active account so a stale response cannot adopt a token for an account a
    // newer state already switched away from.
    if (
      !applied &&
      sync.activeToken &&
      this.state &&
      sync.state.activeAccountId !== null &&
      sync.state.activeAccountId === this.state.activeAccountId &&
      sync.activeToken.accessToken !== this.host.getAccessToken()
    ) {
      this.host.setTokens(sync.activeToken.accessToken);
    }
  }

  async bootstrap(): Promise<void> {
    const res = await this.host.makeRequest<unknown>('GET', '/session/device/state', undefined, { cache: false });
    this.applySync(res);
  }

  async switchAccount(accountId: string): Promise<void> {
    const res = await this.host.makeRequest<unknown>('POST', '/session/device/switch', { accountId }, { cache: false });
    this.applySync(res);
    this.postCommitPing();
  }

  async signOut(target: { accountId: string } | { all: true }): Promise<void> {
    const res = await this.host.makeRequest<unknown>('POST', '/session/device/signout', target, { cache: false });
    this.applySync(res);
    this.postCommitPing();
  }

  async addCurrentAccount(): Promise<void> {
    const res = await this.host.makeRequest<unknown>('POST', '/session/device/add', undefined, { cache: false });
    this.applySync(res);
    this.postCommitPing();
  }

  /**
   * Register the just-signed-in account into the device set AND make it the
   * ACTIVE account — the explicit user-intent activation a sign-in UI performs.
   *
   * `addCurrentAccount` alone honors the server's `activate:'if-empty'` policy
   * (a new account does NOT steal focus from an already-active one), which is
   * correct for a background/silent add but wrong right after a deliberate
   * sign-in. This adds, then switches to the target so the UI lands on the
   * account the user just authenticated.
   *
   * @param accountId - The signed-in account id (e.g. `session.user.id`). When
   *   omitted, falls back to the host's current-account ref. If neither
   *   resolves, the add still applies and no switch is performed.
   */
  async registerAndActivate(accountId?: string): Promise<void> {
    await this.addCurrentAccount();
    const target = accountId ?? this.host.getCurrentAccountId();
    if (target && this.state?.activeAccountId !== target) {
      await this.switchAccount(target);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.tokenUnsub = this.host.onTokensChanged((token) => {
      // A rotated/fresh bearer landed — reconnect a dropped socket so its
      // handshake re-runs with the current token. Sign-out (null token) keeps
      // the device-scoped socket when a device credential is available.
      if (!this.socket) return;
      if (token) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        return;
      }
      const cred = this.host.getDeviceCredential();
      if (cred && !this.socket.connected) {
        this.socket.connect();
      }
    });
    this.openBroadcastChannel();
    // Device-scoped socket: bearer when authenticated, else deviceId+deviceSecret so
    // signed-out tabs still receive `session_state` and can mint on change.
    if (this.host.getAccessToken()) {
      try {
        await this.bootstrap();
      } catch (error) {
        logger.warn('[SessionClient] bootstrap during start failed (non-fatal)', { component: 'SessionClient' }, error);
      }
    }
    await this.connectSocket();
  }

  stop(): void {
    this.started = false;
    if (this.tokenUnsub) {
      this.tokenUnsub();
      this.tokenUnsub = null;
    }
    if (this.channel) {
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch (error) {
        logger.debug('[SessionClient] BroadcastChannel close failed', { component: 'SessionClient' }, error);
      }
      this.channel = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.boundServerEvents.clear();
    }
  }

  private async connectSocket(): Promise<void> {
    // Prefer a statically-injected factory (services/auth-sdk bundle
    // socket.io-client as a real dep); fall back to the lazy loader — and warn
    // if THAT yields nothing — only when no factory was injected.
    const io = this.options.socketFactory ?? (await getSocketIO());
    if (!io) {
      logger.warn('[SessionClient] no socket.io-client; running REST-only (no realtime sync)', { component: 'SessionClient' });
      return;
    }
    if (!this.started) return; // stopped while the dynamic import was in flight

    const token = this.host.getAccessToken();
    const deviceCredential = this.host.getDeviceCredential();
    if (!token && !deviceCredential) return;

    const socket = io(this.host.getBaseURL(), {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (cb: (data: Record<string, string>) => void) => {
        const bearer = this.host.getAccessToken();
        if (bearer) {
          cb({ token: bearer });
          return;
        }
        const cred = this.host.getDeviceCredential();
        if (cred) {
          cb({ deviceId: cred.deviceId, deviceSecret: cred.deviceSecret });
          return;
        }
        cb({ token: '' });
      },
    });
    socket.on('session_state', (payload: unknown) => {
      // A socket broadcast is a `push`-origin — potentially transient, so an
      // empty state here must not erase the durable device credential.
      const applied = this.applyState(payload, 'push');
      if (!applied) return;
      // A push changed the active account on another device/tab — re-fetch state
      // to plant the access token for the newly-active account. When this tab is
      // still signed out, applyState mints via ensureActiveToken first; bootstrap
      // requires a bearer and must not run until then.
      const active = this.state?.activeAccountId ?? null;
      if (active && active !== this.host.getCurrentAccountId() && this.host.getAccessToken()) {
        void this.bootstrap().catch((error) => {
          logger.warn('[SessionClient] post-push token fetch failed', { component: 'SessionClient' }, error);
        });
      }
    });
    socket.on(SESSION_ACCOUNTS_CHANGED_EVENT, (payload: unknown) => {
      this.onSessionAccountsChanged(payload);
    });
    this.socket = socket;
    // (Re)bind app-facing server-event subscriptions on the fresh socket.
    this.boundServerEvents.clear();
    for (const event of this.serverEvents.keys()) {
      this.bindServerEvent(event);
    }
  }

  /**
   * Handle the token-free `session_accounts_changed` signal (room `user:<userId>`).
   *
   * Unlike `session_state` (device-scoped, carries the new state to APPLY), this
   * reaches ALL of a user's connected sockets across their devices/origins and is
   * a pure SIGNAL: it carries no token, no secret, and no account bodies. The only
   * trustworthy bit is "something changed for this user", so — matching the
   * `session_state` contract's guidance — we re-fetch our OWN authoritative device
   * state (`bootstrap` → `GET /session/device/state`) and let the existing
   * `applyState` revision guard reconcile it. We never trust any field on the event
   * beyond routing it to the current user.
   *
   * The refetch is a private (bearer) call: the socket only joins `user:<userId>`
   * when authenticated, so a signed-out client never receives this — but we guard
   * the bearer anyway so a race at sign-out can't 401.
   */
  private onSessionAccountsChanged(payload: unknown): void {
    const event = safeParseContract(sessionAccountsChangedEventSchema, payload);
    if (!event) {
      logger.warn('[SessionClient] discarded invalid session_accounts_changed', { component: 'SessionClient' });
      return;
    }
    // The socket is in `user:<activeUserId>` for the planted bearer, so this should
    // always be the current user; ignore a foreign id defensively (out-of-band relay).
    if (event.userId !== this.host.getCurrentAccountId()) return;
    if (!this.host.getAccessToken()) return;
    void this.bootstrap().catch((error) => {
      logger.warn('[SessionClient] session_accounts_changed refetch failed', { component: 'SessionClient' }, error);
    });
  }

  /**
   * Open the same-origin `BroadcastChannel` (web only). A sibling tab that
   * commits an account switch / sign-out posts a wake ping; on receipt an
   * authenticated tab re-syncs its device state — instant + network-free for the
   * common "two tabs of the same origin" case, with no state (and no tokens)
   * ever crossing the channel. No-op on native (no BroadcastChannel).
   */
  private openBroadcastChannel(): void {
    if (this.channel) return;
    const Ctor = (globalThis as { BroadcastChannel?: new (name: string) => SessionBroadcastChannel }).BroadcastChannel;
    if (typeof Ctor !== 'function') return; // native RN / SSR — feature absent
    let channel: SessionBroadcastChannel;
    try {
      channel = new Ctor(SESSION_BROADCAST_CHANNEL);
    } catch (error) {
      logger.debug('[SessionClient] BroadcastChannel unavailable', { component: 'SessionClient' }, error);
      return;
    }
    channel.onmessage = (event) => {
      if (!event || typeof event.data !== 'object' || event.data === null) return;
      if ((event.data as { type?: unknown }).type !== 'commit') return;
      // BroadcastChannel never echoes to the posting context, so this is a
      // sibling's commit. An authenticated tab re-syncs its device state; the
      // re-sync does not re-post, so there is no cross-tab ping loop.
      if (this.host.getAccessToken()) {
        void this.bootstrap().catch((error) => {
          logger.warn('[SessionClient] broadcast re-sync failed', { component: 'SessionClient' }, error);
        });
      }
    };
    this.channel = channel;
  }

  /**
   * Wake same-origin sibling tabs after a locally-initiated session mutation.
   * Opens the channel lazily: a sign-in registers the account (`addCurrentAccount`
   * / `switchAccount`) BEFORE `start()` runs, so the ping must not depend on
   * `start()` having opened the channel first.
   */
  private postCommitPing(): void {
    this.openBroadcastChannel();
    if (!this.channel) return;
    try {
      this.channel.postMessage({ type: 'commit', at: Date.now() });
    } catch (error) {
      logger.debug('[SessionClient] BroadcastChannel post failed', { component: 'SessionClient' }, error);
    }
  }
}

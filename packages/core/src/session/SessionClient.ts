import {
  deviceSessionStateSchema,
  deviceSessionSyncSchema,
  safeParseContract,
  type DeviceSessionState,
} from '@oxyhq/contracts';
import { logger } from '../utils/loggerUtils';
import { getSocketIO } from './socketLoader';
import type { MinimalSocket, SocketIOFactory } from './socketLoader';

export interface TokenTransport {
  /** Ensure this app holds a per-domain access token for state.activeAccountId (mint via the persisted refresh family / shared keychain). Best-effort. */
  ensureActiveToken(state: DeviceSessionState): Promise<void>;
}

export interface SessionClientHost {
  makeRequest<T>(method: 'GET' | 'POST', url: string, data?: unknown, options?: { cache?: boolean }): Promise<T>;
  getBaseURL(): string;
  getAccessToken(): string | null;
  onTokensChanged(listener: (token: string | null) => void): () => void;
  setTokens(accessToken: string): void;
  getCurrentAccountId(): string | null;
}

export interface SessionClientOptions {
  transport?: TokenTransport;
  /**
   * Invoked when an APPLIED state has zero accounts — i.e. a device
   * signout-all removed the last account from this device set. Providers use
   * this to clear the persisted {@link AuthStateStore} so a reload does not
   * try to restore a session that no longer exists on the device.
   *
   * Only fires when a state is actually applied (revision advanced), never on
   * a stale/rejected push. Exceptions thrown by the callback are isolated.
   */
  onUnauthenticated?: () => void;
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

  protected notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        logger.error('[SessionClient] subscriber threw', error);
      }
    }
  }

  /** Validate + last-writer-wins by revision. Returns true if applied. */
  protected applyState(raw: unknown): boolean {
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
    this.state = next;
    this.notify();
    if (this.options.transport) {
      void this.options.transport.ensureActiveToken(next).catch((error) => {
        logger.warn('[SessionClient] ensureActiveToken failed', { component: 'SessionClient' }, error);
      });
    }
    // A device signout-all leaves zero accounts — tell the provider to clear
    // the persisted store so a reload does not try to restore a dead session.
    if (next.accounts.length === 0 && this.options.onUnauthenticated) {
      try {
        this.options.onUnauthenticated();
      } catch (error) {
        logger.error('[SessionClient] onUnauthenticated threw', error);
      }
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
    this.applyState(sync.state);
    if (sync.activeToken && this.state && sync.state.activeAccountId === this.state.activeAccountId) {
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
      // handshake re-runs with the current token. Sign-out (null token) is
      // handled by the consumer calling `stop()`.
      if (!token || !this.socket) return;
      if (!this.socket.connected) {
        this.socket.connect();
      }
    });
    this.openBroadcastChannel();
    // `bootstrap` (`GET /session/device/state`) is bearer-authenticated. A
    // signed-out client opens no socket and runs no bootstrap; a bootstrap
    // failure is non-fatal — the socket still connects so realtime sync
    // survives a transient state-fetch error.
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
    // Sockets are BEARER-ONLY: the server rejects any handshake without a valid
    // bearer, so a signed-out client never opens a socket.
    if (!this.host.getAccessToken()) return;

    const socket = io(this.host.getBaseURL(), {
      transports: ['websocket'],
      autoConnect: true,
      auth: (cb: (data: { token: string }) => void) => {
        cb({ token: this.host.getAccessToken() ?? '' });
      },
    });
    socket.on('session_state', (payload: unknown) => {
      const applied = this.applyState(payload);
      if (!applied) return;
      // A push changed the active account on another device/tab — re-fetch state
      // to plant the access token for the newly-active account.
      const active = this.state?.activeAccountId ?? null;
      if (active && active !== this.host.getCurrentAccountId()) {
        void this.bootstrap().catch((error) => {
          logger.warn('[SessionClient] post-push token fetch failed', { component: 'SessionClient' }, error);
        });
      }
    });
    this.socket = socket;
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

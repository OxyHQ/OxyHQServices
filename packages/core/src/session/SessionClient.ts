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
  /** Ensure this app holds a per-domain access token for state.activeAccountId (mint via FedCM/silent/sso/keychain). Best-effort. */
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
   * `@oxyhq/services` and `@oxyhq/auth` list `socket.io-client` as a real
   * dependency and pass `io` in directly, so realtime session sync never
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

export class SessionClient {
  private state: DeviceSessionState | null = null;
  private readonly listeners = new Set<StateListener>();
  protected socket: MinimalSocket | null = null;
  private tokenUnsub: (() => void) | null = null;
  private started = false;

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
    if (this.state && next.revision <= this.state.revision) {
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
  }

  async signOut(target: { accountId: string } | { all: true }): Promise<void> {
    const res = await this.host.makeRequest<unknown>('POST', '/session/device/signout', target, { cache: false });
    this.applySync(res);
  }

  async addCurrentAccount(): Promise<void> {
    const res = await this.host.makeRequest<unknown>('POST', '/session/device/add', undefined, { cache: false });
    this.applySync(res);
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
      if (token && this.socket && !this.socket.connected) {
        this.socket.connect();
      }
    });
    await this.bootstrap();
    await this.connectSocket();
  }

  stop(): void {
    this.started = false;
    if (this.tokenUnsub) {
      this.tokenUnsub();
      this.tokenUnsub = null;
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
    const hasToken = Boolean(this.host.getAccessToken());
    const socket = io(this.host.getBaseURL(), {
      transports: ['websocket'],
      autoConnect: hasToken,
      auth: (cb: (data: { token: string }) => void) => {
        cb({ token: this.host.getAccessToken() ?? '' });
      },
    });
    socket.on('session_state', (payload: unknown) => {
      const applied = this.applyState(payload);
      if (applied) {
        const active = this.state?.activeAccountId ?? null;
        if (active && active !== this.host.getCurrentAccountId()) {
          void this.bootstrap().catch((error) => {
            logger.warn('[SessionClient] post-push token fetch failed', { component: 'SessionClient' }, error);
          });
        }
      }
    });
    this.socket = socket;
  }
}

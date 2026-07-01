import { deviceSessionStateSchema, safeParseContract, type DeviceSessionState } from '@oxyhq/contracts';
import { logger } from '../utils/loggerUtils';
import type { MinimalSocket } from './socketLoader';

export interface TokenTransport {
  /** Ensure this app holds a per-domain access token for state.activeAccountId (mint via FedCM/silent/sso/keychain). Best-effort. */
  ensureActiveToken(state: DeviceSessionState): Promise<void>;
}

export interface SessionClientHost {
  makeRequest<T>(method: 'GET' | 'POST', url: string, data?: unknown, options?: { cache?: boolean }): Promise<T>;
  getBaseURL(): string;
  getAccessToken(): string | null;
  onTokensChanged(listener: (token: string | null) => void): () => void;
}

export interface SessionClientOptions {
  transport?: TokenTransport;
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
    return true;
  }

  async bootstrap(): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('GET', '/session/device/state', undefined, { cache: false });
    this.applyState(raw);
  }

  async switchAccount(accountId: string): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('POST', '/session/device/switch', { accountId }, { cache: false });
    this.applyState(raw);
  }

  async signOut(target: { accountId: string } | { all: true }): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('POST', '/session/device/signout', target, { cache: false });
    this.applyState(raw);
  }

  async addCurrentAccount(): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('POST', '/session/device/add', undefined, { cache: false });
    this.applyState(raw);
  }
}

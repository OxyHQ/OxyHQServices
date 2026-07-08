/**
 * Persisted auth state — ONE shape, web + native.
 *
 * The zero-cookie device transport persists the device credential per ORIGIN so
 * a reload restores the session locally without a redirect: `deviceId` +
 * `deviceSecret` mint a fresh access token via `POST /session/device/token`.
 * This module is the storage seam: a tiny `load / save / clear` interface plus
 * platform factories, so the cold boot (`coldBootV2`) and the unified re-mint
 * handler (`refresh.ts`) never touch a platform storage API directly.
 *
 * Platform-agnostic — the native factory takes an INJECTED key/value store
 * (`@oxyhq/services` passes a SecureStore-backed adapter) so `@oxyhq/core`
 * never imports `expo-secure-store`. The web factory is self-contained
 * (`localStorage`) and degrades to in-memory when storage is unavailable
 * (sandboxed iframe `SecurityError`, private-mode quota, SSR).
 *
 * ESM-safe (no `require()`).
 */

/**
 * The persisted session credential set for a single origin.
 *
 * `sessionId` + `userId` identify the owning device session and active account.
 * `deviceId` + `deviceSecret` are the zero-cookie mint credential: the client
 * presents BOTH at `POST /session/device/token` — the secret is the proof, the
 * deviceId selects the device doc. The secret is rotated in-use: the mint returns
 * `nextDeviceSecret`, which the cold boot / re-mint handler persist BEFORE
 * planting the minted access token (multi-tab anti-loss).
 *
 * `accessToken` + `expiresAt` are OPTIONAL warm-boot fields. Persisting them lets
 * the cold boot plant a still-valid access token on the very first paint WITHOUT
 * a blocking mint round-trip — the proactive scheduler then rotates it in the
 * background. They are a strict optimization: the store is fully functional (via
 * `deviceSecret`) when they are absent or stale, and the access token is
 * short-lived, so persisting it adds no exposure the already-persisted
 * `deviceSecret` does not.
 */
export interface PersistedAuthState {
  sessionId: string;
  userId: string;
  /**
   * The stable device identifier this session is bound to (zero-cookie
   * transport). Persisted alongside {@link deviceSecret} because the
   * `POST /session/device/token` mint presents BOTH. Sourced from every login
   * lane (password / 2FA / QR claim / challenge verify) via the response's
   * `deviceId`.
   */
  deviceId?: string;
  /**
   * The rotating device secret (zero-cookie transport). Possession of it mints a
   * short access token for the device's active account via
   * `POST /session/device/token`. Rotated in-use.
   */
  deviceSecret?: string;
  /** Optional warm-boot access token (short-lived; see interface docs). */
  accessToken?: string;
  /** Optional warm-boot access-token expiry, ISO-8601. */
  expiresAt?: string;
}

/**
 * The storage seam consumed by the cold boot and the re-mint handler. Async
 * throughout so one interface fits both synchronous web `localStorage` and
 * asynchronous native SecureStore/AsyncStorage. `clear()` (sign-out) wipes the
 * per-sign-in credential blob.
 */
export interface AuthStateStore {
  load(): Promise<PersistedAuthState | null>;
  save(state: PersistedAuthState): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The minimal async key/value surface a native store must provide. Matches
 * both `expo-secure-store` (wrapped) and `@react-native-async-storage`.
 */
export interface NativeKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Versioned storage key. The `.v1` suffix lets a future shape change ship a
 * `.v2` key without reading a stale/incompatible `.v1` blob. Distinct from the
 * `oxy_shared_*` keychain keys in `KeyManager`, so it never collides.
 */
export const AUTH_STATE_STORAGE_KEY = 'oxy.auth.v1';

/**
 * Parse + shape-validate a stored blob. Returns `null` for anything that is
 * not a well-formed {@link PersistedAuthState} (absent, malformed JSON, wrong
 * types) so a corrupt entry degrades to "signed out" rather than throwing.
 */
function deserialize(raw: string | null): PersistedAuthState | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  const hasDeviceCredential =
    typeof candidate.deviceId === 'string' &&
    candidate.deviceId.length > 0 &&
    typeof candidate.deviceSecret === 'string' &&
    candidate.deviceSecret.length > 0;

  const hasSessionIdentity =
    typeof candidate.sessionId === 'string' &&
    typeof candidate.userId === 'string' &&
    candidate.sessionId.length > 0 &&
    candidate.userId.length > 0;

  // Device-only bootstrap (post join, pre-sign-in): durable credential without session.
  if (!hasSessionIdentity && !hasDeviceCredential) {
    return null;
  }

  const state: PersistedAuthState = {
    sessionId: hasSessionIdentity ? (candidate.sessionId as string) : '',
    userId: hasSessionIdentity ? (candidate.userId as string) : '',
  };
  if (typeof candidate.deviceId === 'string' && candidate.deviceId.length > 0) {
    state.deviceId = candidate.deviceId;
  }
  if (typeof candidate.deviceSecret === 'string' && candidate.deviceSecret.length > 0) {
    state.deviceSecret = candidate.deviceSecret;
  }
  if (typeof candidate.accessToken === 'string' && candidate.accessToken.length > 0) {
    state.accessToken = candidate.accessToken;
  }
  if (typeof candidate.expiresAt === 'string' && candidate.expiresAt.length > 0) {
    state.expiresAt = candidate.expiresAt;
  }
  return state;
}

/**
 * A process-lifetime, in-memory {@link AuthStateStore}. Used directly for
 * tests/SSR and as the degraded fallback of the web store when `localStorage`
 * is unreachable. Not durable across reloads — that is acceptable for the
 * fallback because the alternative (throwing) would break cold boot entirely.
 */
export function createMemoryAuthStateStore(): AuthStateStore {
  let current: PersistedAuthState | null = null;
  return {
    load: async () => current,
    save: async (state) => {
      current = state;
    },
    clear: async () => {
      current = null;
    },
  };
}

/**
 * Read the ambient `localStorage`, tolerating the case where merely ACCESSING
 * `window.localStorage` throws. In a sandboxed / cross-origin iframe the getter
 * itself raises `SecurityError` (not the method calls), so the access must be
 * inside the try. Returns `null` when storage is unavailable.
 */
function safeGetLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') {
      return null;
    }
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/**
 * A `localStorage`-backed {@link AuthStateStore} under the versioned
 * {@link AUTH_STATE_STORAGE_KEY}.
 *
 * Resilience:
 *  - If `localStorage` is unreachable (sandboxed-iframe `SecurityError`, SSR),
 *    the whole store degrades to an in-memory {@link createMemoryAuthStateStore}
 *    for this page's lifetime — never throws on construction.
 *  - Individual `getItem`/`setItem`/`removeItem` are each wrapped: a read that
 *    throws yields `null`; a write that throws (quota, private mode) is
 *    swallowed. The re-mint lane treats a failed persist as "no durable state"
 *    rather than crashing.
 */
export function createWebAuthStateStore(): AuthStateStore {
  const storage = safeGetLocalStorage();
  if (!storage) {
    return createMemoryAuthStateStore();
  }
  // In-memory mirror so a FAILED persist (quota / private mode / locked store)
  // does not silently lose the session for this page's lifetime. `undefined`
  // means "never written this session" → fall back to storage; any set value
  // (including `null` after clear) is authoritative and preferred over storage.
  let sessionMirror: PersistedAuthState | null | undefined;
  return {
    load: async () => {
      if (sessionMirror !== undefined) {
        return sessionMirror;
      }
      try {
        return deserialize(storage.getItem(AUTH_STATE_STORAGE_KEY));
      } catch {
        return null;
      }
    },
    save: async (state) => {
      sessionMirror = state; // mirror FIRST — authoritative even if persist fails
      try {
        storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Quota / private-mode / disabled storage — non-fatal. The session
        // stays live via the in-memory mirror; only reload durability is lost.
      }
    },
    clear: async () => {
      sessionMirror = null;
      try {
        storage.removeItem(AUTH_STATE_STORAGE_KEY);
      } catch {
        // Non-fatal — see save().
      }
    },
  };
}

/**
 * A native {@link AuthStateStore} over an injected async key/value store.
 *
 * `@oxyhq/core` never imports `expo-secure-store`; `@oxyhq/services` constructs
 * the SecureStore-backed adapter and passes it here. Every operation is wrapped
 * so a storage exception degrades gracefully (read → `null`, write → swallowed)
 * exactly like the web store.
 */
export function createNativeAuthStateStore(storage: NativeKeyValueStorage): AuthStateStore {
  // Same in-memory mirror as the web store — a locked/failed SecureStore write
  // must not silently lose the session for the app's lifetime.
  let sessionMirror: PersistedAuthState | null | undefined;
  return {
    load: async () => {
      if (sessionMirror !== undefined) {
        return sessionMirror;
      }
      try {
        return deserialize(await storage.getItem(AUTH_STATE_STORAGE_KEY));
      } catch {
        return null;
      }
    },
    save: async (state) => {
      sessionMirror = state;
      try {
        await storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Non-fatal — session stays live via the in-memory mirror.
      }
    },
    clear: async () => {
      sessionMirror = null;
      try {
        await storage.removeItem(AUTH_STATE_STORAGE_KEY);
      } catch {
        // Non-fatal.
      }
    },
  };
}

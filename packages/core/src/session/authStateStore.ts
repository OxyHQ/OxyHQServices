/**
 * Persisted auth state — ONE shape, web + native.
 *
 * The device-first session model (auth-centralization wave 1) persists the
 * rotating refresh-token family head per ORIGIN so a reload restores the
 * session locally without a redirect. This module is the storage seam: a tiny
 * `load / save / clear` interface plus platform factories, so the cold boot
 * (`coldBootV2`) and the unified refresh handler (`refresh.ts`) never touch a
 * platform storage API directly.
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
 * `refreshToken` is the rotating single-use family head; `sessionId` + `userId`
 * identify the owning device session and account. `deviceToken` is the opaque,
 * add-only device attribution token (mirrored to the shared keychain on native
 * so every Oxy app on one phone shares one DeviceSession).
 *
 * `accessToken` + `expiresAt` are OPTIONAL warm-boot fields. Persisting them
 * lets the cold boot plant a still-valid access token on the very first paint
 * WITHOUT a blocking `/auth/refresh-token` round-trip — the proactive scheduler
 * then rotates it in the background. They are a strict optimization: the store
 * is fully functional (via `refreshToken`) when they are absent or stale, and
 * the access token is short-lived, so persisting it adds no exposure the
 * already-persisted refresh token does not (see the plan's XSS risk note — the
 * refresh token is the dominant secret either way).
 */
export interface PersistedAuthState {
  sessionId: string;
  refreshToken: string;
  userId: string;
  deviceToken?: string;
  /** Optional warm-boot access token (short-lived; see interface docs). */
  accessToken?: string;
  /** Optional warm-boot access-token expiry, ISO-8601. */
  expiresAt?: string;
}

/**
 * The storage seam consumed by the cold boot and the refresh handler. Async
 * throughout so one interface fits both synchronous web `localStorage` and
 * asynchronous native SecureStore/AsyncStorage.
 *
 * Two lifetimes:
 *  - The SESSION credential blob (`load`/`save`/`clear`) is per-sign-in and is
 *    wiped on `clear()` (sign-out).
 *  - The DEVICE token (`loadDeviceToken`/`saveDeviceToken`/`clearDeviceToken`)
 *    is long-lived device attribution that SURVIVES `clear()`: a signed-out
 *    browser is still the same device, and a later in-app (cross-apex,
 *    cookie-less) login sends this token so the new session joins the SAME
 *    server-side DeviceSession. Only an explicit device signout-all
 *    (`clearDeviceToken`) removes it.
 */
export interface AuthStateStore {
  load(): Promise<PersistedAuthState | null>;
  save(state: PersistedAuthState): Promise<void>;
  clear(): Promise<void>;
  loadDeviceToken(): Promise<string | null>;
  saveDeviceToken(token: string): Promise<void>;
  clearDeviceToken(): Promise<void>;
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
 * Storage key for the long-lived device-attribution token. Separate from
 * {@link AUTH_STATE_STORAGE_KEY} because it must OUTLIVE a session `clear()`
 * (sign-out) — the device is unchanged across sign-ins.
 */
export const DEVICE_TOKEN_STORAGE_KEY = 'oxy.device.v1';

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
  if (
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    typeof candidate.userId !== 'string' ||
    candidate.sessionId.length === 0 ||
    candidate.refreshToken.length === 0 ||
    candidate.userId.length === 0
  ) {
    return null;
  }
  const state: PersistedAuthState = {
    sessionId: candidate.sessionId,
    refreshToken: candidate.refreshToken,
    userId: candidate.userId,
  };
  if (typeof candidate.deviceToken === 'string' && candidate.deviceToken.length > 0) {
    state.deviceToken = candidate.deviceToken;
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
  let deviceToken: string | null = null;
  return {
    load: async () => current,
    save: async (state) => {
      current = state;
    },
    clear: async () => {
      current = null;
    },
    loadDeviceToken: async () => deviceToken,
    saveDeviceToken: async (token) => {
      deviceToken = token;
    },
    clearDeviceToken: async () => {
      deviceToken = null;
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
 *    swallowed. The persisted-refresh lane treats a failed persist as "no
 *    durable state" (falls back to the bootstrap hop) rather than crashing.
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
  let deviceTokenMirror: string | null | undefined;
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
    loadDeviceToken: async () => {
      if (deviceTokenMirror !== undefined) {
        return deviceTokenMirror;
      }
      try {
        return storage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    saveDeviceToken: async (token) => {
      deviceTokenMirror = token;
      try {
        storage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
      } catch {
        // Non-fatal — see save().
      }
    },
    clearDeviceToken: async () => {
      deviceTokenMirror = null;
      try {
        storage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
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
  let deviceTokenMirror: string | null | undefined;
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
    loadDeviceToken: async () => {
      if (deviceTokenMirror !== undefined) {
        return deviceTokenMirror;
      }
      try {
        return await storage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    saveDeviceToken: async (token) => {
      deviceTokenMirror = token;
      try {
        await storage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
      } catch {
        // Non-fatal.
      }
    },
    clearDeviceToken: async () => {
      deviceTokenMirror = null;
      try {
        await storage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
      } catch {
        // Non-fatal.
      }
    },
  };
}

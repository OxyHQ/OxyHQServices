import {
  createWebAuthStateStore,
  createNativeAuthStateStore,
  createMemoryAuthStateStore,
  AUTH_STATE_STORAGE_KEY,
  DEVICE_TOKEN_STORAGE_KEY,
  type PersistedAuthState,
  type NativeKeyValueStorage,
} from '../authStateStore';

const SAMPLE: PersistedAuthState = {
  sessionId: 's-1',
  refreshToken: 'r-abcdefghijklmnop',
  userId: 'u-1',
  deviceToken: 'd-1234567890',
  accessToken: 'a-jwt',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

/** A minimal in-map Storage; setItem can be made to throw (quota simulation). */
function makeFakeStorage(opts: { throwOnSet?: boolean } = {}): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function installLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  // Remove whatever localStorage the test installed (value or throwing getter).
  if (Object.getOwnPropertyDescriptor(globalThis, 'localStorage')) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe('createWebAuthStateStore', () => {
  it('round-trips a PersistedAuthState under the versioned key', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    await store.save(SAMPLE);
    expect(storage.getItem(AUTH_STATE_STORAGE_KEY)).toBeTruthy();
    expect(await store.load()).toEqual(SAMPLE);
  });

  it('round-trips the optional phase-2c deviceId + deviceSecret', async () => {
    installLocalStorage(makeFakeStorage());
    const store = createWebAuthStateStore();
    const withCreds: PersistedAuthState = { ...SAMPLE, deviceId: 'dev-abc', deviceSecret: 'ds-secret-xyz' };

    await store.save(withCreds);
    const loaded = await store.load();
    expect(loaded?.deviceId).toBe('dev-abc');
    expect(loaded?.deviceSecret).toBe('ds-secret-xyz');
    expect(loaded).toEqual(withCreds);
  });

  it('deserializes a legacy blob with no device credentials (additive — fields absent)', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    storage.setItem(
      AUTH_STATE_STORAGE_KEY,
      JSON.stringify({ sessionId: 's-1', refreshToken: 'r-abcdefghijklmnop', userId: 'u-1' }),
    );
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded && 'deviceId' in loaded).toBe(false);
    expect(loaded && 'deviceSecret' in loaded).toBe(false);
  });

  it('clear() wipes the session but the deviceToken survives', async () => {
    installLocalStorage(makeFakeStorage());
    const store = createWebAuthStateStore();

    await store.save(SAMPLE);
    await store.saveDeviceToken('device-token-xyz');
    await store.clear();

    expect(await store.load()).toBeNull();
    expect(await store.loadDeviceToken()).toBe('device-token-xyz');
  });

  it('persists the deviceToken under a separate long-lived key', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    await store.saveDeviceToken('dt');
    expect(storage.getItem(DEVICE_TOKEN_STORAGE_KEY)).toBe('dt');
    await store.clearDeviceToken();
    expect(await store.loadDeviceToken()).toBeNull();
  });

  it('returns null for a malformed or incomplete blob', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    storage.setItem(AUTH_STATE_STORAGE_KEY, 'not-json');
    expect(await store.load()).toBeNull();

    storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify({ sessionId: 's', userId: 'u' }));
    expect(await store.load()).toBeNull();
  });

  it('degrades to in-memory when accessing localStorage throws (sandboxed iframe SecurityError)', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });

    // Construction must not throw, and the store must still function (in-memory).
    const store = createWebAuthStateStore();
    await expect(store.save(SAMPLE)).resolves.toBeUndefined();
    expect(await store.load()).toEqual(SAMPLE);
  });

  it('swallows a write that throws (quota / private mode) without rejecting', async () => {
    installLocalStorage(makeFakeStorage({ throwOnSet: true }));
    const store = createWebAuthStateStore();

    await expect(store.save(SAMPLE)).resolves.toBeUndefined();
    // The write never reached storage...
    expect(localStorage.getItem(AUTH_STATE_STORAGE_KEY)).toBeNull();
    // ...but the in-memory mirror keeps the session live for this page's lifetime.
    expect(await store.load()).toEqual(SAMPLE);
  });

  it('the mirror keeps the deviceToken live when the write throws', async () => {
    installLocalStorage(makeFakeStorage({ throwOnSet: true }));
    const store = createWebAuthStateStore();

    await store.saveDeviceToken('dt-mirrored');
    expect(await store.loadDeviceToken()).toBe('dt-mirrored');
  });

  it('a cleared session reads null even if storage later holds a stale blob (mirror wins)', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    await store.save(SAMPLE);
    await store.clear();
    // Something (another tab / a failed remove) leaves a stale blob behind.
    storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify(SAMPLE));
    // The authoritative in-memory mirror still reports the cleared state.
    expect(await store.load()).toBeNull();
  });
});

describe('createNativeAuthStateStore', () => {
  function makeNativeStorage(): NativeKeyValueStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: async (k) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: async (k, v) => {
        map.set(k, v);
      },
      removeItem: async (k) => {
        map.delete(k);
      },
    };
  }

  it('round-trips through the injected async storage', async () => {
    const storage = makeNativeStorage();
    const store = createNativeAuthStateStore(storage);

    await store.save(SAMPLE);
    expect(storage.map.get(AUTH_STATE_STORAGE_KEY)).toBeTruthy();
    expect(await store.load()).toEqual(SAMPLE);
  });

  it('deviceToken survives a session clear', async () => {
    const store = createNativeAuthStateStore(makeNativeStorage());
    await store.save(SAMPLE);
    await store.saveDeviceToken('dt-native');
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(await store.loadDeviceToken()).toBe('dt-native');
  });

  it('keeps the session live via the mirror when the injected storage throws (locked keychain)', async () => {
    const store = createNativeAuthStateStore({
      getItem: async () => {
        throw new Error('secure store locked');
      },
      setItem: async () => {
        throw new Error('secure store locked');
      },
      removeItem: async () => {
        throw new Error('secure store locked');
      },
    });
    await expect(store.save(SAMPLE)).resolves.toBeUndefined();
    // The write threw, but the in-memory mirror preserves the session.
    expect(await store.load()).toEqual(SAMPLE);
  });
});

describe('createMemoryAuthStateStore', () => {
  it('round-trips and clears in process memory', async () => {
    const store = createMemoryAuthStateStore();
    await store.save(SAMPLE);
    expect(await store.load()).toEqual(SAMPLE);
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

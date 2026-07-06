import {
  createWebAuthStateStore,
  createNativeAuthStateStore,
  createMemoryAuthStateStore,
  AUTH_STATE_STORAGE_KEY,
  type PersistedAuthState,
  type NativeKeyValueStorage,
} from '../authStateStore';

/**
 * The zero-cookie persisted shape: `sessionId` + `userId` are the only required
 * fields; `deviceId` / `deviceSecret` (the mint credential) and
 * `accessToken` / `expiresAt` (warm-boot) are all optional round-trip fields.
 */
const SAMPLE: PersistedAuthState = {
  sessionId: 's-1',
  userId: 'u-1',
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

  it('round-trips the optional deviceId + deviceSecret mint credential', async () => {
    installLocalStorage(makeFakeStorage());
    const store = createWebAuthStateStore();
    const withCreds: PersistedAuthState = { ...SAMPLE, deviceId: 'dev-abc', deviceSecret: 'ds-secret-xyz' };

    await store.save(withCreds);
    const loaded = await store.load();
    expect(loaded?.deviceId).toBe('dev-abc');
    expect(loaded?.deviceSecret).toBe('ds-secret-xyz');
    expect(loaded).toEqual(withCreds);
  });

  it('deserializes a minimal blob with no device credentials (fields absent)', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify({ sessionId: 's-1', userId: 'u-1' }));
    const loaded = await store.load();
    expect(loaded).toEqual({ sessionId: 's-1', userId: 'u-1' });
    expect(loaded && 'deviceId' in loaded).toBe(false);
    expect(loaded && 'deviceSecret' in loaded).toBe(false);
    expect(loaded && 'accessToken' in loaded).toBe(false);
  });

  it('clear() wipes the persisted session', async () => {
    installLocalStorage(makeFakeStorage());
    const store = createWebAuthStateStore();

    await store.save({ ...SAMPLE, deviceId: 'dev-abc', deviceSecret: 'ds-secret-xyz' });
    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('returns null for malformed JSON or a blob missing a required field', async () => {
    const storage = makeFakeStorage();
    installLocalStorage(storage);
    const store = createWebAuthStateStore();

    storage.setItem(AUTH_STATE_STORAGE_KEY, 'not-json');
    expect(await store.load()).toBeNull();

    // Missing userId → invalid.
    storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify({ sessionId: 's' }));
    expect(await store.load()).toBeNull();

    // Missing sessionId → invalid.
    storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify({ userId: 'u' }));
    expect(await store.load()).toBeNull();

    // Empty required strings → invalid.
    storage.setItem(AUTH_STATE_STORAGE_KEY, JSON.stringify({ sessionId: '', userId: '' }));
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

  it('swallows a write that throws (quota / private mode) without rejecting, and the mirror keeps the session live', async () => {
    installLocalStorage(makeFakeStorage({ throwOnSet: true }));
    const store = createWebAuthStateStore();
    const withCreds: PersistedAuthState = { ...SAMPLE, deviceId: 'dev-abc', deviceSecret: 'ds-secret-xyz' };

    await expect(store.save(withCreds)).resolves.toBeUndefined();
    // The write never reached storage...
    expect(localStorage.getItem(AUTH_STATE_STORAGE_KEY)).toBeNull();
    // ...but the in-memory mirror keeps the session (incl. the mint credential) live.
    expect(await store.load()).toEqual(withCreds);
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

  it('clear() wipes the persisted session', async () => {
    const store = createNativeAuthStateStore(makeNativeStorage());
    await store.save({ ...SAMPLE, deviceId: 'dev-1', deviceSecret: 'ds-1' });
    await store.clear();
    expect(await store.load()).toBeNull();
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

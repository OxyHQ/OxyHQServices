/**
 * The identity pin store — the durable `{publicKey, accountId}` binding an
 * identity-bound client (the identity vault) uses instead of the device's
 * mutable `activeAccountId`.
 *
 * The load-bearing property is FAIL-CLOSED validation: anything that is not a
 * well-formed pin must read back as "not pinned", because a half-trusted pin
 * would bind the client to the wrong account.
 */
import {
  createMemoryIdentityPinStore,
  createNativeIdentityPinStore,
  identityPinMatches,
  IDENTITY_PIN_STORAGE_KEY,
  type IdentityPin,
} from '../identityPin';
import type { NativeKeyValueStorage } from '../authStateStore';

/** A syntactically valid compressed secp256k1 public key (66 hex chars). */
const PUBLIC_KEY = `02${'a'.repeat(64)}`;
const PIN: IdentityPin = { publicKey: PUBLIC_KEY, accountId: 'acct-1' };

/** An in-memory `NativeKeyValueStorage` with the raw map exposed for assertions. */
function makeNativeStorage(): NativeKeyValueStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: async (key) => raw.get(key) ?? null,
    setItem: async (key, value) => {
      raw.set(key, value);
    },
    removeItem: async (key) => {
      raw.delete(key);
    },
  };
}

describe('identityPinMatches', () => {
  it('matches case-insensitively (hex)', () => {
    expect(identityPinMatches(PIN, PUBLIC_KEY.toUpperCase())).toBe(true);
  });

  it('does NOT match a different key', () => {
    expect(identityPinMatches(PIN, `03${'b'.repeat(64)}`)).toBe(false);
  });

  it('does NOT match when the local key is absent (a definitive "identity gone")', () => {
    expect(identityPinMatches(PIN, null)).toBe(false);
  });

  it('does NOT match when there is no pin', () => {
    expect(identityPinMatches(null, PUBLIC_KEY)).toBe(false);
  });
});

describe('createMemoryIdentityPinStore', () => {
  it('round-trips a pin and clears it', async () => {
    const store = createMemoryIdentityPinStore();
    expect(await store.load()).toBeNull();
    expect(await store.save(PIN)).toBe(true);
    expect(await store.load()).toEqual(PIN);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('normalizes the stored public key to lower case', async () => {
    const store = createMemoryIdentityPinStore();
    await store.save({ publicKey: PUBLIC_KEY.toUpperCase(), accountId: 'acct-1' });
    expect((await store.load())?.publicKey).toBe(PUBLIC_KEY);
  });

  it('refuses to store a malformed pin', async () => {
    const store = createMemoryIdentityPinStore();
    expect(await store.save({ publicKey: 'not-a-key', accountId: 'acct-1' })).toBe(false);
    expect(await store.save({ publicKey: PUBLIC_KEY, accountId: '' })).toBe(false);
    expect(await store.load()).toBeNull();
  });
});

describe('createNativeIdentityPinStore', () => {
  it('persists under the versioned key and reads it back', async () => {
    const storage = makeNativeStorage();
    const store = createNativeIdentityPinStore(storage);

    expect(await store.save(PIN)).toBe(true);
    expect(storage.raw.get(IDENTITY_PIN_STORAGE_KEY)).toBe(
      JSON.stringify({ publicKey: PUBLIC_KEY, accountId: 'acct-1' }),
    );
    // Fresh store instance → reads from storage, not the in-memory mirror.
    expect(await createNativeIdentityPinStore(storage).load()).toEqual(PIN);
  });

  it.each([
    ['malformed JSON', 'not json'],
    ['a non-object', '"a string"'],
    ['a junk public key', JSON.stringify({ publicKey: 'zz', accountId: 'acct-1' })],
    ['a wrong-length public key', JSON.stringify({ publicKey: 'ab', accountId: 'acct-1' })],
    ['an empty accountId', JSON.stringify({ publicKey: PUBLIC_KEY, accountId: '' })],
    ['a missing accountId', JSON.stringify({ publicKey: PUBLIC_KEY })],
  ])('reads back "not pinned" for %s', async (_label, raw) => {
    const storage = makeNativeStorage();
    storage.raw.set(IDENTITY_PIN_STORAGE_KEY, raw);
    expect(await createNativeIdentityPinStore(storage).load()).toBeNull();
  });

  it('reports a failed durable write while keeping this run pinned in memory', async () => {
    const storage = makeNativeStorage();
    // A write that resolves WITHOUT throwing yet does not land (the Android
    // SecureStore failure mode) — only the read-back catches it.
    const store = createNativeIdentityPinStore({
      ...storage,
      setItem: async () => undefined,
    });

    expect(await store.save(PIN)).toBe(false);
    // The in-memory mirror still pins this app run.
    expect(await store.load()).toEqual(PIN);
    expect(storage.raw.get(IDENTITY_PIN_STORAGE_KEY)).toBeUndefined();
  });

  it('degrades to "not pinned" when a read throws', async () => {
    const store = createNativeIdentityPinStore({
      getItem: async () => {
        throw new Error('keychain locked');
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    });
    expect(await store.load()).toBeNull();
  });
});

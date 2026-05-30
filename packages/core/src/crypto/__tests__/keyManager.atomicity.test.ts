/**
 * Tests for KeyManager atomic-write & backup-restore safety under FLAKY storage.
 *
 * These pin the "never leave the device with zero recoverable copies of a
 * healthy identity" invariant. Each scenario corresponds to a real
 * account-loss / account-switch bug that a half-failed SecureStore write could
 * otherwise cause:
 *
 *   1. A failed OVERWRITE must roll the primary back to the ORIGINAL identity
 *      and must keep a recoverable backup of it — never switch to the
 *      half-written new identity.
 *   2. A transient read failure must not cause restoreIdentityFromBackup() to
 *      clobber a healthy-but-momentarily-locked primary with a stale backup.
 *   3. restoreIdentityFromBackup() must refuse when the backup identifies a
 *      different account than a private key still present in the primary slot.
 *   4. A first-time create still writes a backup (no regression).
 */

import { setPlatformOS } from '../../utils/platform';

// Fault-injectable in-memory secure store. `failPlan` lets a test make a
// specific (op, key) pair throw to simulate a keychain that fails mid-write or
// is transiently locked.
const failPlan: { failKey?: string; failOp?: 'set' | 'get' } = {};

jest.mock(
  'expo-secure-store',
  () => {
    const store = new Map<string, string>();
    const maybeFail = (op: 'set' | 'get', key: string) => {
      if (failPlan.failOp === op && failPlan.failKey === key) {
        throw new Error(`Simulated ${op} failure for ${key}`);
      }
    };
    return {
      __esModule: true,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      WHEN_UNLOCKED: 'WHEN_UNLOCKED',
      setItemAsync: jest.fn(async (key: string, value: string) => {
        maybeFail('set', key);
        store.set(key, value);
      }),
      getItemAsync: jest.fn(async (key: string) => {
        maybeFail('get', key);
        return store.get(key) ?? null;
      }),
      deleteItemAsync: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      __resetStore__: () => {
        store.clear();
        failPlan.failKey = undefined;
        failPlan.failOp = undefined;
      },
      __getStore__: () => store,
      __failPlan__: failPlan,
    };
  },
  { virtual: true },
);

jest.mock(
  'expo-crypto',
  () => ({
    __esModule: true,
    getRandomBytes: (length: number) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = (Math.random() * 256) & 0xff;
      return out;
    },
    digestStringAsync: async () => '0'.repeat(64),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  }),
  { virtual: true },
);

jest.mock('../../utils/platformCrypto', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loadExpoCrypto: async () => require('expo-crypto'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loadSecureStore: async () => require('expo-secure-store'),
  loadAsyncStorage: async () => ({
    default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
  }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loadNodeCrypto: async () => require('crypto'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getRandomBytesRN: (n: number) => require('expo-crypto').getRandomBytes(n),
}));

interface SecureStoreTestHandle {
  __resetStore__: () => void;
  __getStore__: () => Map<string, string>;
  __failPlan__: { failKey?: string; failOp?: 'set' | 'get' };
}

describe('KeyManager atomicity & recoverability under flaky storage', () => {
  let KeyManager: typeof import('../keyManager').KeyManager;

  const resetCaches = () => {
    const km = KeyManager as unknown as { cachedPublicKey: unknown; cachedHasIdentity: unknown };
    km.cachedPublicKey = null;
    km.cachedHasIdentity = null;
  };

  beforeAll(() => {
    setPlatformOS('ios');
    (globalThis as unknown as { navigator: unknown }).navigator = { product: 'ReactNative' };
  });

  beforeEach(async () => {
    jest.resetModules();
    setPlatformOS('ios');
    const ss = (await import('expo-secure-store' as string)) as unknown as SecureStoreTestHandle;
    ss.__resetStore__();
    const km = await import('../keyManager');
    KeyManager = km.KeyManager;
    resetCaches();
  });

  it('a failed OVERWRITE leaves the ORIGINAL identity intact and recoverable (no silent switch)', async () => {
    const originalPublic = await KeyManager.createIdentity();
    const ss = (await import('expo-secure-store' as string)) as unknown as SecureStoreTestHandle;
    const originalPriv = ss.__getStore__().get('oxy_identity_private_key');
    resetCaches();

    // The new primary private write fails mid-overwrite.
    ss.__failPlan__.failOp = 'set';
    ss.__failPlan__.failKey = 'oxy_identity_private_key';
    await expect(KeyManager.createIdentity({ overwrite: true })).rejects.toBeDefined();

    // Recover from the simulated fault.
    ss.__failPlan__.failKey = undefined;
    ss.__failPlan__.failOp = undefined;
    resetCaches();

    // Primary must still be the original identity (rolled back).
    expect(await KeyManager.hasIdentity()).toBe(true);
    expect(await KeyManager.getPublicKey()).toBe(originalPublic);
    expect(ss.__getStore__().get('oxy_identity_private_key')).toBe(originalPriv);

    // And the backup must still hold the ORIGINAL identity, never the new one.
    const m = ss.__getStore__();
    expect(m.get('oxy_identity_backup_private_key')).toBe(originalPriv);
    expect(m.get('oxy_identity_backup_public_key')).toBe(originalPublic);
  });

  it('restoreIdentityFromBackup does NOT clobber a healthy primary that is only transiently unreadable', async () => {
    const original = await KeyManager.createIdentity();
    const ss = (await import('expo-secure-store' as string)) as unknown as SecureStoreTestHandle;

    // Put a DIFFERENT identity in the backup slot (simulates a stale backup
    // from a previous account that a failed backup-refresh left behind).
    const other = await KeyManager.generateKeyPair();
    ss.__getStore__().set('oxy_identity_backup_private_key', other.privateKey);
    ss.__getStore__().set('oxy_identity_backup_public_key', other.publicKey);
    resetCaches();

    // Make the primary PRIVATE read throw (transient keychain lock).
    ss.__failPlan__.failOp = 'get';
    ss.__failPlan__.failKey = 'oxy_identity_private_key';

    const restored = await KeyManager.restoreIdentityFromBackup();
    expect(restored).toBe(false); // refused — transient read must not trigger a restore

    // Clear the fault; the original primary must be intact and unchanged.
    ss.__failPlan__.failKey = undefined;
    ss.__failPlan__.failOp = undefined;
    resetCaches();
    expect(await KeyManager.getPublicKey()).toBe(original);
    expect(ss.__getStore__().get('oxy_identity_public_key')).toBe(original);
  });

  it('restoreIdentityFromBackup refuses when a present primary private key identifies a different account than the backup', async () => {
    // Primary holds identity A (valid). Corrupt ONLY the public key so the
    // primary fails its consistency check but the private key still derives a
    // real, different identity than the backup.
    const a = await KeyManager.createIdentity();
    const ss = (await import('expo-secure-store' as string)) as unknown as SecureStoreTestHandle;
    const m = ss.__getStore__();

    // Backup holds a DIFFERENT identity B.
    const b = await KeyManager.generateKeyPair();
    m.set('oxy_identity_backup_private_key', b.privateKey);
    m.set('oxy_identity_backup_public_key', b.publicKey);
    // Corrupt A's stored public key (private key A still present & valid).
    m.set('oxy_identity_public_key', `04${'e'.repeat(128)}`);
    resetCaches();

    const restored = await KeyManager.restoreIdentityFromBackup();
    expect(restored).toBe(false);
    // Must NOT have switched the primary to B.
    expect(m.get('oxy_identity_public_key')).not.toBe(b.publicKey);
    expect(m.get('oxy_identity_private_key')).not.toBe(b.privateKey);
    // The original A private key is still in place (untouched).
    expect(KeyManager.derivePublicKey(m.get('oxy_identity_private_key') as string)).toBe(a);
  });

  it('restores a provably-absent primary from a valid backup', async () => {
    const original = await KeyManager.createIdentity();
    const ss = (await import('expo-secure-store' as string)) as unknown as SecureStoreTestHandle;
    const m = ss.__getStore__();
    // Wipe the primary entirely (backup remains).
    m.delete('oxy_identity_private_key');
    m.delete('oxy_identity_public_key');
    resetCaches();

    const restored = await KeyManager.restoreIdentityFromBackup();
    expect(restored).toBe(true);
    expect(await KeyManager.getPublicKey()).toBe(original);
    expect(await KeyManager.verifyIdentityIntegrity()).toBe(true);
  });
});

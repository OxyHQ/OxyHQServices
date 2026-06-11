/**
 * Web-platform tests for the identity store.
 *
 * Regression guard for the `getValueWithKeyAsync is not a function` crash:
 * on web, `expo-secure-store`'s `getItemAsync` / `setItemAsync` exist but
 * throw at call time because they delegate to the iOS/Android-native
 * `getValueWithKeyAsync`. The store must therefore use a `localStorage`
 * backing store on web and never touch `expo-secure-store`.
 *
 * The storage adapter is selected at module-load time from `Platform.OS`,
 * so each case loads the module fresh inside `jest.isolateModulesAsync`
 * with `Platform.OS` pinned to `'web'`.
 */

type IdentityStoreModule = typeof import('@/hooks/identity/identityStore');
type SecureStoreModule = typeof import('@/__mocks__/expo-secure-store');

interface WebStoreUnderTest {
  store: IdentityStoreModule;
  /**
   * The `expo-secure-store` mock instance as seen *inside* the isolated
   * module registry — the same instance the store would use if it
   * (incorrectly) reached for secure-store on web. Asserting against this
   * instance is what makes "never touches secure-store on web" reliable;
   * the outer-scope import is a different instance.
   */
  secureStore: SecureStoreModule;
}

/**
 * Load the identity store fresh with `Platform.OS === 'web'` so it binds
 * to the web (`localStorage`) storage adapter.
 *
 * The store picks its storage adapter from `Platform.OS` at module-load
 * time, so `Platform.OS` must be set on the same `react-native` instance
 * the store sees. `jest.isolateModulesAsync` resets the module registry,
 * so `react-native` is re-evaluated inside the callback — we therefore
 * flip `Platform.OS` on the freshly-required mock there, before importing
 * the store. We also grab the isolated secure-store mock so call-count
 * assertions target the correct instance.
 */
async function loadStoreOnWeb(): Promise<WebStoreUnderTest> {
  let result: WebStoreUnderTest | undefined;
  await jest.isolateModulesAsync(async () => {
    const { Platform } = await import('react-native');
    Platform.OS = 'web';
    const secureStore = await import('@/__mocks__/expo-secure-store');
    const store = await import('@/hooks/identity/identityStore');
    result = { store, secureStore };
  });
  if (!result) {
    throw new Error('Failed to load identityStore module under test');
  }
  return result;
}

describe('identityStore — web (localStorage) storage', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    jest.clearAllMocks();
  });

  it('persists the sync flag to localStorage (not expo-secure-store)', async () => {
    const { store, secureStore } = await loadStoreOnWeb();

    await store.persistIdentitySyncState(true);

    expect(globalThis.localStorage.getItem(store.IDENTITY_SYNC_STORAGE_KEY)).toBe('true');
    // The native secure-store module must never be touched on web.
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('reads the sync flag back from localStorage', async () => {
    const { store, secureStore } = await loadStoreOnWeb();
    globalThis.localStorage.setItem(store.IDENTITY_SYNC_STORAGE_KEY, 'true');

    await expect(store.getIdentitySyncStateFromStorage()).resolves.toBe(true);
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('round-trips the recovery-phrase acknowledgement flag', async () => {
    const { store } = await loadStoreOnWeb();

    await store.persistRecoveryPhraseAcknowledged(true);
    expect(globalThis.localStorage.getItem(store.RECOVERY_PHRASE_ACK_STORAGE_KEY)).toBe('true');
    await expect(store.getRecoveryPhraseAcknowledgedFromStorage()).resolves.toBe(true);

    await store.persistRecoveryPhraseAcknowledged(false);
    expect(globalThis.localStorage.getItem(store.RECOVERY_PHRASE_ACK_STORAGE_KEY)).toBe('false');
    await expect(store.getRecoveryPhraseAcknowledgedFromStorage()).resolves.toBe(false);
  });

  it('hydrate() reads both flags from localStorage without throwing', async () => {
    const { store, secureStore } = await loadStoreOnWeb();
    globalThis.localStorage.setItem(store.IDENTITY_SYNC_STORAGE_KEY, 'true');
    globalThis.localStorage.setItem(store.RECOVERY_PHRASE_ACK_STORAGE_KEY, 'true');

    const errorSpy = jest.spyOn(console, 'error');
    await store.useIdentityStore.getState().hydrate();

    expect(store.useIdentityStore.getState().isSynced).toBe(true);
    expect(store.useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(true);
    // No throw → no "[IdentityStore] Failed to hydrate ..." console.error.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('hydrate() defaults to false when nothing is stored', async () => {
    const { store } = await loadStoreOnWeb();

    await store.useIdentityStore.getState().hydrate();

    expect(store.useIdentityStore.getState().isSynced).toBe(false);
    expect(store.useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(false);
  });

  it('treats only the literal "true" as set (ambiguous values stay false)', async () => {
    const { store } = await loadStoreOnWeb();
    globalThis.localStorage.setItem(store.RECOVERY_PHRASE_ACK_STORAGE_KEY, '1');

    await expect(store.getRecoveryPhraseAcknowledgedFromStorage()).resolves.toBe(false);

    globalThis.localStorage.setItem(store.RECOVERY_PHRASE_ACK_STORAGE_KEY, 'yes');
    await expect(store.getRecoveryPhraseAcknowledgedFromStorage()).resolves.toBe(false);
  });
});

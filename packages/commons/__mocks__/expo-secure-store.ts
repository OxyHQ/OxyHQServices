/**
 * In-memory expo-secure-store stub for unit tests.
 *
 * Mirrors the subset of the expo-secure-store API that identity / sync
 * state persistence uses. Identity-related tests assume secure storage
 * is available and writable.
 */

const store = new Map<string, string>();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
export const WHEN_UNLOCKED = 'WHEN_UNLOCKED';

export const getItemAsync = jest.fn(async (key: string): Promise<string | null> => {
  return store.get(key) ?? null;
});

export const setItemAsync = jest.fn(async (key: string, value: string): Promise<void> => {
  store.set(key, value);
});

export const deleteItemAsync = jest.fn(async (key: string): Promise<void> => {
  store.delete(key);
});

/** Helper for tests that need to seed secure-store before mount. */
export function __seedSecureStore(key: string, value: string): void {
  store.set(key, value);
}

/** Helper for tests that need to wipe secure-store between cases. */
export function __resetSecureStore(): void {
  store.clear();
  (getItemAsync as jest.Mock).mockClear();
  (setItemAsync as jest.Mock).mockClear();
  (deleteItemAsync as jest.Mock).mockClear();
}

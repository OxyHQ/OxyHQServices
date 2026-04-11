/**
 * Multi-account storage for the Inbox app.
 *
 * Persists an array of saved account profiles (userId, display info, sessionId)
 * so the account switcher can render accounts instantly and switch auth state.
 *
 * Uses localStorage on web, AsyncStorage on native.
 */

import { Platform } from 'react-native';

const STORAGE_KEY = 'inbox_accounts';

export interface StoredAccount {
  userId: string;
  sessionId: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  /** ISO timestamp of when this account was last active */
  lastActive: string;
}

// ---------------------------------------------------------------------------
// Platform-agnostic storage helpers
// ---------------------------------------------------------------------------

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    const AsyncStorage = await import('@react-native-async-storage/async-storage').then((m) => m.default);
    return AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch { /* quota exceeded, ignore */ }
    return;
  }
  try {
    const AsyncStorage = await import('@react-native-async-storage/async-storage').then((m) => m.default);
    await AsyncStorage.setItem(key, value);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Retrieve all saved accounts. */
export async function getAccounts(): Promise<StoredAccount[]> {
  const raw = await getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredAccount[];
  } catch {
    return [];
  }
}

/**
 * Add or update an account in the store.
 * If an account with the same userId already exists, its fields are updated.
 */
export async function addAccount(account: StoredAccount): Promise<void> {
  const accounts = await getAccounts();
  const idx = accounts.findIndex((a) => a.userId === account.userId);
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], ...account };
  } else {
    accounts.push(account);
  }
  await setItem(STORAGE_KEY, JSON.stringify(accounts));
}

/** Remove an account by userId. */
export async function removeAccount(userId: string): Promise<void> {
  const accounts = await getAccounts();
  const filtered = accounts.filter((a) => a.userId !== userId);
  await setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Mark an account as the most-recently-active by updating its `lastActive` timestamp.
 * This is cosmetic -- the actual auth session switching is handled by OxyContext.
 */
export async function setActiveAccount(userId: string): Promise<void> {
  const accounts = await getAccounts();
  const idx = accounts.findIndex((a) => a.userId === userId);
  if (idx >= 0) {
    accounts[idx].lastActive = new Date().toISOString();
    await setItem(STORAGE_KEY, JSON.stringify(accounts));
  }
}

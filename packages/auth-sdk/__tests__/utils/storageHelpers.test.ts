/**
 * Tests for `@oxyhq/auth` storage helpers.
 *
 * Web SDK stores access tokens, active session IDs, and user language
 * preference via `localStorage` (with in-memory fallback for SSR and
 * Safari private browsing). These tests pin the contract.
 */

import {
  createPlatformStorage,
  getStorageKeys,
  isReactNative,
  STORAGE_KEY_PREFIX,
} from '../../src/utils/storageHelpers';

describe('STORAGE_KEY_PREFIX (auth-sdk)', () => {
  it('uses the same default prefix as the RN SDK', () => {
    expect(STORAGE_KEY_PREFIX).toBe('oxy_session');
  });
});

describe('getStorageKeys (auth-sdk)', () => {
  it('builds the canonical key triple', () => {
    expect(getStorageKeys('oxy_session')).toEqual({
      activeSessionId: 'oxy_session_active_session_id',
      sessionIds: 'oxy_session_session_ids',
      language: 'oxy_session_language',
    });
  });

  it('honors a custom prefix', () => {
    expect(getStorageKeys('staging').activeSessionId).toBe('staging_active_session_id');
  });
});

describe('isReactNative (auth-sdk)', () => {
  it('is false under jsdom', () => {
    expect(isReactNative()).toBe(false);
  });
});

describe('createPlatformStorage (auth-sdk)', () => {
  it('round-trips through localStorage when available', async () => {
    const storage = await createPlatformStorage();
    await storage.setItem('k', 'v');
    expect(await storage.getItem('k')).toBe('v');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('swallows getItem failures and returns null', async () => {
    const storage = await createPlatformStorage();
    const spy = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    try {
      expect(await storage.getItem('k')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('swallows setItem failures (quota exceeded / private browsing)', async () => {
    const storage = await createPlatformStorage();
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    try {
      await expect(storage.setItem('k', 'v')).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('clear() empties every key', async () => {
    const storage = await createPlatformStorage();
    await storage.setItem('a', '1');
    await storage.setItem('b', '2');
    await storage.clear();
    expect(await storage.getItem('a')).toBeNull();
    expect(await storage.getItem('b')).toBeNull();
  });
});

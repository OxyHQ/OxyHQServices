/**
 * Shared device-token contract on web. Under the jest `node` environment
 * `getPlatformOS()` resolves to `'web'`, so the shared-keychain device-token
 * methods are no-ops (web persists its deviceToken in the per-origin
 * AuthStateStore instead of a keychain). The native keychain plumbing is
 * exercised via spies in the coldBootV2 suite.
 */
import { KeyManager } from '../keyManager';

describe('KeyManager shared device token (web)', () => {
  it('getSharedDeviceToken returns null on web', async () => {
    expect(await KeyManager.getSharedDeviceToken()).toBeNull();
  });

  it('setSharedDeviceToken is a no-op that does not throw on web', async () => {
    await expect(KeyManager.setSharedDeviceToken('dt-web')).resolves.toBeUndefined();
    // Still null — nothing was persisted on web.
    expect(await KeyManager.getSharedDeviceToken()).toBeNull();
  });

  it('clearSharedDeviceToken is a no-op that does not throw on web', async () => {
    await expect(KeyManager.clearSharedDeviceToken()).resolves.toBeUndefined();
  });
});

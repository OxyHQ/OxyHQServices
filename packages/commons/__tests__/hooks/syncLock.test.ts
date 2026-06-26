/**
 * Tests for the global identity sync lock.
 *
 * The lock prevents concurrent syncIdentity() calls from both calling
 * /auth/register and creating duplicate sessions. We pin down:
 *   - Only one holder at a time.
 *   - The lock can be released and re-acquired.
 *   - Releasing the lock aborts in-flight signals.
 *   - isSyncLocked() reflects state correctly.
 *   - isSyncLockAborted() recognizes AbortError instances.
 */

import {
  acquireSyncLock,
  isSyncLocked,
  releaseSyncLock,
  isSyncLockAborted,
} from '@/hooks/identity/syncLock';

describe('syncLock', () => {
  afterEach(() => {
    // Ensure we never leak a held lock between tests.
    releaseSyncLock();
  });

  it('reports isSyncLocked() correctly across lifecycle', () => {
    expect(isSyncLocked()).toBe(false);
    const lock = acquireSyncLock();
    expect(isSyncLocked()).toBe(true);
    lock.release();
    expect(isSyncLocked()).toBe(false);
  });

  it('refuses to grant a second concurrent lock', () => {
    const first = acquireSyncLock();
    expect(() => acquireSyncLock()).toThrow(/Sync already in progress/);
    first.release();
    // Release should free it; the next acquire must succeed.
    const second = acquireSyncLock();
    expect(isSyncLocked()).toBe(true);
    second.release();
  });

  it('aborts the in-flight signal on release', async () => {
    const lock = acquireSyncLock();
    expect(lock.signal.aborted).toBe(false);
    lock.release();
    expect(lock.signal.aborted).toBe(true);
  });

  it('releaseSyncLock() is idempotent', () => {
    expect(() => releaseSyncLock()).not.toThrow();
    const lock = acquireSyncLock();
    lock.release();
    expect(() => releaseSyncLock()).not.toThrow();
  });

  describe('isSyncLockAborted', () => {
    it('recognizes AbortError name', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      expect(isSyncLockAborted(e)).toBe(true);
    });

    it('recognizes "aborted" in message', () => {
      expect(isSyncLockAborted(new Error('the sync was aborted'))).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isSyncLockAborted(new Error('network'))).toBe(false);
      expect(isSyncLockAborted(null)).toBe(false);
      expect(isSyncLockAborted('string error')).toBe(false);
    });
  });
});

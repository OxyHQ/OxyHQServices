/**
 * Fail-safe guarantees for the web `activeAuthuser` storage helpers.
 *
 * The PROPERTY ACCESS `window.localStorage` can throw a `SecurityError`
 * synchronously in opaque-origin / sandboxed iframes or when storage is
 * disabled — not just `getItem`/`setItem`. These helpers run during cold boot
 * (and feed render-phase gate values in the providers), so they MUST never
 * propagate that throw: reads fail safe to a benign default and writes no-op.
 */

import {
  readActiveAuthuser,
  writeActiveAuthuser,
  clearActiveAuthuser,
  markSignedOut,
  clearSignedOut,
  isSilentRestoreSuppressed,
} from '../activeAuthuser';

describe('activeAuthuser helpers — localStorage fail-safe', () => {
  const realDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

  afterEach(() => {
    if (realDescriptor) {
      Object.defineProperty(window, 'localStorage', realDescriptor);
    }
    window.localStorage?.clear?.();
  });

  /** Replace the `localStorage` accessor so reading the property throws. */
  function makeLocalStorageGetterThrow(): void {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  }

  it('readActiveAuthuser returns null (never throws) when the getter throws', () => {
    makeLocalStorageGetterThrow();
    expect(() => readActiveAuthuser()).not.toThrow();
    expect(readActiveAuthuser()).toBeNull();
  });

  it('isSilentRestoreSuppressed returns false (never throws) when the getter throws', () => {
    makeLocalStorageGetterThrow();
    expect(() => isSilentRestoreSuppressed()).not.toThrow();
    expect(isSilentRestoreSuppressed()).toBe(false);
  });

  it('writeActiveAuthuser / clearActiveAuthuser / markSignedOut / clearSignedOut no-op when the getter throws', () => {
    makeLocalStorageGetterThrow();
    expect(() => {
      writeActiveAuthuser(2);
      clearActiveAuthuser();
      markSignedOut();
      clearSignedOut();
    }).not.toThrow();
  });

  it('round-trips normally when storage works (zero behavior change)', () => {
    writeActiveAuthuser(3);
    expect(readActiveAuthuser()).toBe(3);

    expect(isSilentRestoreSuppressed()).toBe(false);
    markSignedOut();
    expect(isSilentRestoreSuppressed()).toBe(true);
    clearSignedOut();
    expect(isSilentRestoreSuppressed()).toBe(false);

    clearActiveAuthuser();
    expect(readActiveAuthuser()).toBeNull();
  });
});

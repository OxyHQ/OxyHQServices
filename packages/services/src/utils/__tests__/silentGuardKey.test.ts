/**
 * @jest-environment node
 *
 * Regression coverage for the native session-restore crash:
 *
 *   W [component:OxyContext]: Failed to restore sessions from storage
 *   [TypeError: Cannot read property 'origin' of undefined]
 *
 * `silentColdBootKey` (OxyContext) and `ssoSignature` (useWebSSO) both build an
 * `origin|baseURL` guard signature UNCONDITIONALLY at the top of the cold-boot
 * path, on every platform. React Native aliases a global `window` (so
 * `typeof window !== 'undefined'` is `true`) but provides NO `window.location`.
 * The previous `typeof window`-only guard then read `window.location.origin`
 * and threw `Cannot read property 'origin' of undefined`, escaping session
 * restore entirely. Both call sites now delegate to the shared, guarded
 * `buildSilentGuardKey`, verified here under all three platform shapes.
 *
 * Runs in the `node` environment so `window` is genuinely controllable — under
 * jsdom `window.location` is non-configurable and cannot be removed, so the
 * native shape (window present, location absent) is not reproducible there.
 */

import { buildSilentGuardKey, safeWindowOrigin } from '../silentGuardKey';

describe('silentGuardKey native safety', () => {
  const globalRef = globalThis as { window?: unknown };

  afterEach(() => {
    delete globalRef.window;
  });

  describe('safeWindowOrigin', () => {
    it('returns "no-origin" when there is no window (Node / SSR)', () => {
      delete globalRef.window;
      expect(safeWindowOrigin()).toBe('no-origin');
    });

    it('returns "no-origin" on React Native (window present, no location)', () => {
      // EXACT native shape: RN aliases a global `window` to the JS global, but
      // there is no `window.location`. The old `typeof window`-only guard threw
      // here; the new guard must return the sentinel without throwing.
      globalRef.window = {};
      expect(() => safeWindowOrigin()).not.toThrow();
      expect(safeWindowOrigin()).toBe('no-origin');
    });

    it('returns the browser origin on web', () => {
      globalRef.window = { location: { origin: 'https://app.mention.earth' } };
      expect(safeWindowOrigin()).toBe('https://app.mention.earth');
    });
  });

  describe('buildSilentGuardKey', () => {
    it('does not throw and composes "no-origin|" on React Native', () => {
      globalRef.window = {};
      const getBaseURL = () => 'https://api.mention.earth';
      expect(() => buildSilentGuardKey(getBaseURL)).not.toThrow();
      expect(buildSilentGuardKey(getBaseURL)).toBe('no-origin|https://api.mention.earth');
    });

    it('composes "origin|baseURL" on web', () => {
      globalRef.window = { location: { origin: 'https://app.mention.earth' } };
      expect(buildSilentGuardKey(() => 'https://api.mention.earth')).toBe(
        'https://app.mention.earth|https://api.mention.earth',
      );
    });

    it('degrades baseURL to empty when getBaseURL is absent', () => {
      globalRef.window = {};
      expect(buildSilentGuardKey()).toBe('no-origin|');
    });

    it('degrades baseURL to empty when getBaseURL throws', () => {
      globalRef.window = {};
      const throwing = (): string => {
        throw new Error('client not initialised');
      };
      expect(() => buildSilentGuardKey(throwing)).not.toThrow();
      expect(buildSilentGuardKey(throwing)).toBe('no-origin|');
    });
  });
});

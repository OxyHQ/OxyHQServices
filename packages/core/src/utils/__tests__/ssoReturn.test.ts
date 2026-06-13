/**
 * `parseSsoReturnFragment` — SSO return fragment parsing.
 *
 * The central IdP returns the RP via a top-level redirect with the bounce
 * result in the URL fragment. The parser must be pure, total (never throws),
 * and report `kind` strictly as one of `'ok' | 'none' | 'error'`, returning
 * `null` for anything that is not an oxy_sso fragment.
 */

import { parseSsoReturnFragment } from '../ssoReturn';

describe('parseSsoReturnFragment', () => {
  describe('ok', () => {
    it('parses a success fragment with code and state', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&code=abc123&state=xyz');

      expect(result).toEqual({ kind: 'ok', code: 'abc123', state: 'xyz' });
    });

    it('parses a success fragment without a leading #', () => {
      const result = parseSsoReturnFragment('oxy_sso=ok&code=abc123&state=xyz');

      expect(result).toEqual({ kind: 'ok', code: 'abc123', state: 'xyz' });
    });

    it('omits code when ok carries no code', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&state=xyz');

      expect(result).toEqual({ kind: 'ok', state: 'xyz' });
      expect(result?.code).toBeUndefined();
    });

    it('URL-decodes percent-encoded values', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&code=a%2Bb%2Fc&state=s%20t');

      expect(result).toEqual({ kind: 'ok', code: 'a+b/c', state: 's t' });
    });
  });

  describe('none', () => {
    it('parses a none fragment and carries state but never a code', () => {
      const result = parseSsoReturnFragment('#oxy_sso=none&state=xyz');

      expect(result).toEqual({ kind: 'none', state: 'xyz' });
    });

    it('ignores a stray code on a none outcome', () => {
      const result = parseSsoReturnFragment('#oxy_sso=none&code=leaked&state=xyz');

      expect(result).toEqual({ kind: 'none', state: 'xyz' });
      expect(result?.code).toBeUndefined();
    });
  });

  describe('error', () => {
    it('parses an error fragment', () => {
      const result = parseSsoReturnFragment('#oxy_sso=error&state=xyz');

      expect(result).toEqual({ kind: 'error', state: 'xyz' });
    });

    it('ignores a stray code on an error outcome', () => {
      const result = parseSsoReturnFragment('#oxy_sso=error&code=leaked');

      expect(result).toEqual({ kind: 'error' });
      expect(result?.code).toBeUndefined();
    });
  });

  describe('null (not an oxy_sso fragment)', () => {
    it('returns null for an empty string', () => {
      expect(parseSsoReturnFragment('')).toBeNull();
    });

    it('returns null for a bare #', () => {
      expect(parseSsoReturnFragment('#')).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseSsoReturnFragment(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(parseSsoReturnFragment(null)).toBeNull();
    });

    it('returns null for a fragment without oxy_sso', () => {
      expect(parseSsoReturnFragment('#access_token=foo&state=bar')).toBeNull();
    });

    it('returns null for an unrecognised oxy_sso value', () => {
      expect(parseSsoReturnFragment('#oxy_sso=bogus&code=x')).toBeNull();
    });

    it('returns null for an empty oxy_sso value', () => {
      expect(parseSsoReturnFragment('#oxy_sso=&code=x')).toBeNull();
    });
  });

  describe('malformed / defensive', () => {
    it('never throws and returns a valid kind for junk after the marker', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&=&&&code=c&&');

      expect(result?.kind).toBe('ok');
      expect(result?.code).toBe('c');
    });

    it('always reports a kind in the strict union', () => {
      for (const input of [
        '#oxy_sso=ok',
        '#oxy_sso=none',
        '#oxy_sso=error',
      ]) {
        const result = parseSsoReturnFragment(input);
        expect(result).not.toBeNull();
        expect(['ok', 'none', 'error']).toContain(result?.kind);
      }
    });
  });
});

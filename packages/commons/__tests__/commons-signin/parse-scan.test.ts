import { parseScan } from '@/lib/commons-signin/parse-scan';

describe('parseScan', () => {
  const future = () => Date.now() + 5 * 60 * 1000;
  const past = () => Date.now() - 60 * 1000;

  describe('approval links', () => {
    it('branches a valid approval link to { kind: approval }', () => {
      const url = `oxycommons://approve?v=1&code=ABC123&app=oxy_dk_x&exp=${future()}`;
      expect(parseScan(url)).toEqual({ kind: 'approval', code: 'ABC123' });
    });

    it('accepts the commons:// app scheme', () => {
      expect(parseScan('commons://approve?code=XYZ')).toEqual({ kind: 'approval', code: 'XYZ' });
    });

    it('surfaces an expired approval link as expired (not invalid, not dni)', () => {
      expect(parseScan(`oxycommons://approve?code=ABC&exp=${past()}`)).toEqual({
        kind: 'invalid',
        reason: 'expired',
      });
    });

    it('treats an approve link with no code as invalid', () => {
      expect(parseScan('oxycommons://approve?v=1')).toEqual({ kind: 'invalid', reason: 'invalid' });
    });
  });

  describe('DNI cards', () => {
    it('branches a valid DNI payload to { kind: dni } carrying the DID', () => {
      const did = 'did:web:oxy.so:u:65f0abc123';
      expect(parseScan(`oxydni://card?did=${did}&v=1`)).toEqual({ kind: 'dni', did });
    });

    it('url-decodes a percent-encoded DID', () => {
      const encoded = encodeURIComponent('did:web:oxy.so:u:65f0abc123');
      expect(parseScan(`oxydni://card?did=${encoded}`)).toEqual({
        kind: 'dni',
        did: 'did:web:oxy.so:u:65f0abc123',
      });
    });

    it('treats a DNI card with no did as invalid', () => {
      expect(parseScan('oxydni://card?v=1')).toEqual({ kind: 'invalid', reason: 'invalid' });
    });
  });

  describe('unrelated input', () => {
    it('rejects an empty string', () => {
      expect(parseScan('')).toEqual({ kind: 'invalid', reason: 'invalid' });
    });

    it('rejects a plain token string', () => {
      expect(parseScan('ABC123')).toEqual({ kind: 'invalid', reason: 'invalid' });
    });

    it('rejects an unrelated deep link', () => {
      expect(parseScan('https://example.com/card?did=x')).toEqual({
        kind: 'invalid',
        reason: 'invalid',
      });
    });

    it('rejects a non-approve / non-card oxy scheme', () => {
      expect(parseScan('oxycommons://something?code=ABC')).toEqual({
        kind: 'invalid',
        reason: 'invalid',
      });
    });
  });
});

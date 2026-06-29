/**
 * `isCrossApexWeb` + `CrossApexDirectSignInError` — the cross-apex gate that
 * decides whether the SDK may complete a direct (non-IdP) sign-in.
 *
 * A web RP is "cross-apex" when its registrable apex differs from the central
 * Oxy IdP apex (`oxy.so`). On such a host the only durable sign-in is the
 * interactive "Continue with Oxy" IdP popup; the direct password / public-key
 * paths and the Commons-app QR/deep-link handoffs establish no `fedcm_session`
 * and would be lost on reload.
 */

import { isCrossApexWeb, CrossApexDirectSignInError } from '../../src/utils/crossApex';

describe('isCrossApexWeb', () => {
  it('returns true for a non-oxy.so registrable apex', () => {
    expect(isCrossApexWeb('mention.earth')).toBe(true);
    expect(isCrossApexWeb('www.mention.earth')).toBe(true);
    expect(isCrossApexWeb('app.mention.earth')).toBe(true);
    expect(isCrossApexWeb('homiio.com')).toBe(true);
  });

  it('returns false for the central oxy.so apex and its subdomains', () => {
    expect(isCrossApexWeb('oxy.so')).toBe(false);
    expect(isCrossApexWeb('accounts.oxy.so')).toBe(false);
    expect(isCrossApexWeb('auth.oxy.so')).toBe(false);
    expect(isCrossApexWeb('console.oxy.so')).toBe(false);
  });

  it('returns false for hosts without a registrable apex (dev / native)', () => {
    expect(isCrossApexWeb('localhost')).toBe(false);
    expect(isCrossApexWeb('127.0.0.1')).toBe(false);
    expect(isCrossApexWeb('intranet')).toBe(false);
    expect(isCrossApexWeb('')).toBe(false);
    expect(isCrossApexWeb(undefined)).toBe(false);
  });
});

describe('CrossApexDirectSignInError', () => {
  it('is an Error with a stable name + code and an actionable message', () => {
    const error = new CrossApexDirectSignInError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CrossApexDirectSignInError');
    expect(error.code).toBe('CROSS_APEX_DIRECT_SIGN_IN_UNSUPPORTED');
    expect(error.message).toContain('Continue with Oxy');
  });
});

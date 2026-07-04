/**
 * Central IdP apex/origin constants.
 *
 * `resolveCentralAuthUrl` was removed in the device-first cutover (the SDK no
 * longer resolves an IdP host). The `CENTRAL_IDP_APEX` / `CENTRAL_AUTH_URL`
 * constants survive because the IdP worker imports them to brand assertions.
 */

import { CENTRAL_AUTH_URL, CENTRAL_IDP_APEX } from '../authWebUrl';

describe('CENTRAL_IDP_APEX', () => {
  it('is the central IdP registrable apex', () => {
    expect(CENTRAL_IDP_APEX).toBe('oxy.so');
  });
});

describe('CENTRAL_AUTH_URL', () => {
  it('is the central IdP origin with no trailing slash', () => {
    expect(CENTRAL_AUTH_URL).toBe('https://auth.oxy.so');
    expect(CENTRAL_AUTH_URL.endsWith('/')).toBe(false);
  });

  it('is derived from CENTRAL_IDP_APEX (apex and origin never drift)', () => {
    expect(CENTRAL_AUTH_URL).toBe(`https://auth.${CENTRAL_IDP_APEX}`);
  });
});

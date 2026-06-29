/**
 * @jest-environment-options {"url": "https://app.mention.earth/"}
 *
 * Shared silent-restore primitives — the ONE implementation cold boot
 * (`OxyContext`) and in-session refresh (`createInSessionRefreshHandler`) both
 * compose, so the two paths can never drift on "how do we mint a first-party
 * per-apex token without a reload" / "which account is active".
 *
 * The jsdom URL (`app.mention.earth`) makes the internal `autoDetectAuthWebUrl()`
 * resolve the per-apex IdP `auth.mention.earth`.
 */
import type { OxyServices } from '@oxyhq/core';
import {
  mintSessionViaPerApexIframe,
  selectActiveRefreshAccount,
} from '../../src/ui/context/silentSessionRestore';

interface SilentStub {
  silentSignIn: jest.Mock;
}

const asOxy = (stub: SilentStub): OxyServices => stub as unknown as OxyServices;

describe('mintSessionViaPerApexIframe', () => {
  it('points the iframe at the per-apex IdP and returns the recovered session', async () => {
    const session = { sessionId: 's1', user: { id: 'u1' }, accessToken: 'TOK' };
    const stub: SilentStub = { silentSignIn: jest.fn(async () => session) };

    const result = await mintSessionViaPerApexIframe(asOxy(stub), 4000);

    expect(result).toBe(session);
    expect(stub.silentSignIn).toHaveBeenCalledWith({
      authWebUrlOverride: 'https://auth.mention.earth',
      timeout: 4000,
    });
  });

  it('returns null when the iframe yields no session', async () => {
    const stub: SilentStub = { silentSignIn: jest.fn(async () => null) };
    expect(await mintSessionViaPerApexIframe(asOxy(stub), 4000)).toBeNull();
  });

  it('returns null for an incomplete session (missing user or sessionId)', async () => {
    const noUser: SilentStub = { silentSignIn: jest.fn(async () => ({ sessionId: 's1', accessToken: 'TOK' })) };
    const noSession: SilentStub = { silentSignIn: jest.fn(async () => ({ user: { id: 'u1' }, accessToken: 'TOK' })) };

    expect(await mintSessionViaPerApexIframe(asOxy(noUser), 4000)).toBeNull();
    expect(await mintSessionViaPerApexIframe(asOxy(noSession), 4000)).toBeNull();
  });
});

describe('selectActiveRefreshAccount', () => {
  const accounts = [
    { authuser: 0, accessToken: 'T0' },
    { authuser: 1, accessToken: 'T1' },
    { authuser: 2, accessToken: 'T2' },
  ];

  it('picks the persisted authuser slot when it matches a returned account', () => {
    expect(selectActiveRefreshAccount(accounts, 1)).toBe(accounts[1]);
  });

  it('falls back to the lowest slot ([0]) when no authuser is persisted', () => {
    expect(selectActiveRefreshAccount(accounts, null)).toBe(accounts[0]);
  });

  it('falls back to the lowest slot ([0]) when the persisted authuser is absent', () => {
    expect(selectActiveRefreshAccount(accounts, 9)).toBe(accounts[0]);
  });
});

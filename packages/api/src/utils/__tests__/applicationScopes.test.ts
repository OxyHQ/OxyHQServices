/**
 * Unit tests for the dependency-free application-scope authority
 * (`utils/applicationScopes.ts`).
 *
 * The two pure reconcilers under test are the single source of truth for how an
 * application's granted scopes flow into a service token:
 *
 *   - `intersectScopes` — effective credential scopes = credential ∩ app scopes.
 *     A credential can never exceed its app's grant.
 *   - `unionValidScopes` — additive rebuild of an app's scopes from a canonical
 *     (declarative) list. Guards the ROOT CAUSE that dropped Mention's granted,
 *     in-use `signals:write`: a destructive `application.scopes = seedScopes`
 *     rebuild silently revoked an out-of-band grant, and because the mint
 *     intersects credential ∩ app scopes, the credential lost it too.
 */

import {
  intersectScopes,
  unionValidScopes,
  isPrivilegedScope,
  isValidApplicationScope,
} from '../applicationScopes';

describe('intersectScopes (credential ∩ app grant)', () => {
  it('keeps only scopes present on both sides, preserving credential order', () => {
    expect(
      intersectScopes(['signals:write', 'user:read'], ['user:read', 'files:write', 'signals:write'])
    ).toEqual(['signals:write', 'user:read']);
  });

  it('drops a credential scope the app no longer grants', () => {
    // Exactly the failure mode: the app lost signals:write, so the mint drops it.
    expect(intersectScopes(['signals:write', 'user:read'], ['user:read', 'files:write'])).toEqual([
      'user:read',
    ]);
  });

  it('drops unknown scopes and de-duplicates', () => {
    expect(
      intersectScopes(['user:read', 'user:read', 'bogus:scope'], ['user:read', 'bogus:scope'])
    ).toEqual(['user:read']);
  });
});

describe('unionValidScopes (additive canonical rebuild)', () => {
  it('preserves an already-granted scope the canonical list omits', () => {
    // The seed's canonical Mention list historically omitted signals:write; the
    // union must NOT revoke the already-granted, in-use scope.
    expect(
      unionValidScopes(
        ['user:read', 'files:write', 'federation:write'],
        ['user:read', 'files:write', 'federation:write', 'signals:write']
      )
    ).toEqual(['user:read', 'files:write', 'federation:write', 'signals:write']);
  });

  it('adds scopes newly declared in the canonical list', () => {
    expect(unionValidScopes(['user:read', 'files:read'], ['user:read'])).toEqual([
      'user:read',
      'files:read',
    ]);
  });

  it('orders canonical scopes first, then extra granted scopes, de-duplicated', () => {
    expect(
      unionValidScopes(['user:read', 'files:write'], ['signals:write', 'user:read'])
    ).toEqual(['user:read', 'files:write', 'signals:write']);
  });

  it('drops unknown/legacy stored scopes that can never survive a mint', () => {
    expect(unionValidScopes(['user:read'], ['user:read', 'legacy:scope'])).toEqual(['user:read']);
  });

  it('returns the canonical set when there is nothing extra granted', () => {
    expect(unionValidScopes(['user:read', 'files:write'], [])).toEqual(['user:read', 'files:write']);
  });

  it('is a no-op fixed point once the canonical list already contains the grant', () => {
    const canonical = ['user:read', 'files:read', 'files:write', 'federation:write', 'signals:write'];
    expect(unionValidScopes(canonical, canonical)).toEqual(canonical);
  });
});

describe('scope classification helpers', () => {
  it('recognises signals:write as a valid privileged scope', () => {
    expect(isValidApplicationScope('signals:write')).toBe(true);
    expect(isPrivilegedScope('signals:write')).toBe(true);
  });

  it('treats a plain read scope as valid but not privileged', () => {
    expect(isValidApplicationScope('files:read')).toBe(true);
    expect(isPrivilegedScope('files:read')).toBe(false);
  });

  it('rejects an unknown scope', () => {
    expect(isValidApplicationScope('bogus:scope')).toBe(false);
    expect(isPrivilegedScope('bogus:scope')).toBe(false);
  });
});

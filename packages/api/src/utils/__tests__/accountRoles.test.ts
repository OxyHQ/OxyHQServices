/**
 * `resolveEffectivePermissions` — the ONE place a role baseline and a member's
 * own grants/revokes become a permission set.
 *
 * Every account authorization decision reads its output, so the cases below are
 * chosen to distinguish it from the implementations it could plausibly be
 * mistaken for: a role-only lookup, a union that forgets revokes, a revoke that
 * loses to a grant, and a pass-through that would let a retired vocabulary entry
 * keep granting.
 */

import {
  ACCOUNT_PERMISSIONS,
  ROLE_PERMISSIONS,
  isAccountPermission,
  permissionsForAccountRole,
  resolveEffectivePermissions,
} from '../accountRoles';

describe('resolveEffectivePermissions', () => {
  test('with no deltas it is exactly the role baseline', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      expect(resolveEffectivePermissions(role, [], []).sort()).toEqual(
        permissionsForAccountRole(role).sort()
      );
    }
  });

  test('a grant adds a permission the role does not carry', () => {
    // `developer` genuinely lacks `members:read` — asserted rather than assumed,
    // because if the baseline ever gained it this test would pass while testing
    // nothing.
    expect(permissionsForAccountRole('developer')).not.toContain('members:read');

    const effective = resolveEffectivePermissions('developer', ['members:read'], []);
    expect(effective).toContain('members:read');
    // Everything the role already carried survives the addition.
    for (const permission of permissionsForAccountRole('developer')) {
      expect(effective).toContain(permission);
    }
  });

  test('a revoke removes a permission the role does carry', () => {
    expect(permissionsForAccountRole('editor')).toContain('account:act_as');

    expect(resolveEffectivePermissions('editor', [], ['account:act_as'])).not.toContain(
      'account:act_as'
    );
  });

  test('a revoke beats a grant naming the same permission', () => {
    // The safe reading of a contradiction is the narrower one. A union-then-add
    // implementation would return it.
    expect(
      resolveEffectivePermissions('viewer', ['account:delete'], ['account:delete'])
    ).not.toContain('account:delete');
  });

  test('a grant outside the current vocabulary is inert', () => {
    // The failure this guards is a permission RETIRED from ACCOUNT_PERMISSIONS
    // while rows still name it. Stored strings are never scrubbed, so the read
    // path is the only thing standing between a retired string and a live grant.
    const effective = resolveEffectivePermissions('viewer', ['account:retired_capability'], []);
    expect(effective).not.toContain('account:retired_capability');
    expect(effective).toEqual(permissionsForAccountRole('viewer'));
  });

  test('a revoke outside the current vocabulary removes nothing', () => {
    expect(resolveEffectivePermissions('admin', [], ['account:retired_capability'])).toEqual(
      resolveEffectivePermissions('admin', [], [])
    );
  });

  test('every returned permission is in the vocabulary, in declaration order', () => {
    const effective = resolveEffectivePermissions(
      'viewer',
      ['ownership:transfer', 'account:act_as', 'not-a-permission'],
      []
    );
    for (const permission of effective) {
      expect(isAccountPermission(permission)).toBe(true);
    }
    // Ordering is the vocabulary's, not the caller's — so the wire value is
    // deterministic for a given input regardless of what order a client sent.
    const indices = effective.map((permission) => ACCOUNT_PERMISSIONS.indexOf(permission));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  test('duplicates in a delta list collapse', () => {
    expect(
      resolveEffectivePermissions('viewer', ['account:act_as', 'account:act_as'], [])
    ).toEqual(resolveEffectivePermissions('viewer', ['account:act_as'], []));
  });
});

describe('isAccountPermission', () => {
  test('accepts every declared permission and nothing else', () => {
    for (const permission of ACCOUNT_PERMISSIONS) {
      expect(isAccountPermission(permission)).toBe(true);
    }
    expect(isAccountPermission('account:moderate')).toBe(false);
    expect(isAccountPermission('')).toBe(false);
    // Neither a prefix nor a superstring of a real permission passes.
    expect(isAccountPermission('account')).toBe(false);
    expect(isAccountPermission('account:read:all')).toBe(false);
  });
});

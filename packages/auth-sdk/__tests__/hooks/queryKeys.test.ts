/**
 * Tests for `@oxyhq/auth` query keys.
 *
 * These keys are part of the public persisted-cache contract: web apps
 * rehydrate from localStorage at app boot and need the keys to match
 * exactly. Changing them silently invalidates every persisted entry.
 */

import {
  invalidateAccountQueries,
  invalidateUserQueries,
  invalidateSessionQueries,
  queryKeys,
} from '../../src/hooks/queries/queryKeys';

describe('queryKeys (auth-sdk)', () => {
  it('accounts.all = ["accounts"]', () => {
    expect(queryKeys.accounts.all).toEqual(['accounts']);
  });

  it('accounts.list(ids) includes the array literal', () => {
    expect(queryKeys.accounts.list(['s1', 's2'])).toEqual(['accounts', 'list', ['s1', 's2']]);
  });

  it('accounts.current() is a stable singleton', () => {
    expect(queryKeys.accounts.current()).toEqual(['accounts', 'current']);
  });

  it('users.profile(sessionId) appends "profile" leaf', () => {
    expect(queryKeys.users.profile('s1')).toEqual(['users', 'detail', 's1', 'profile']);
  });

  it('sessions.device(deviceId) is keyed by deviceId', () => {
    expect(queryKeys.sessions.device('d1')).toEqual(['sessions', 'device', 'd1']);
  });

  it('privacy.settings() defaults to "current"', () => {
    expect(queryKeys.privacy.settings()).toEqual(['privacy', 'settings', 'current']);
  });

  it('security.activity captures every argument', () => {
    expect(queryKeys.security.activity(20, 0, 'login')).toEqual([
      'security',
      'activity',
      20,
      0,
      'login',
    ]);
  });
});

describe('invalidate helpers (auth-sdk)', () => {
  it('invalidateAccountQueries targets accounts root', () => {
    const queryClient = { invalidateQueries: jest.fn() };
    invalidateAccountQueries(queryClient);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['accounts'] });
  });

  it('invalidateUserQueries targets users root', () => {
    const queryClient = { invalidateQueries: jest.fn() };
    invalidateUserQueries(queryClient);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['users'] });
  });

  it('invalidateSessionQueries targets sessions root', () => {
    const queryClient = { invalidateQueries: jest.fn() };
    invalidateSessionQueries(queryClient);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions'] });
  });
});

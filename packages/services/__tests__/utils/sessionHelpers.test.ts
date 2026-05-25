/**
 * Tests for session helpers.
 *
 * These helpers normalize the various session payload shapes returned by
 * the API into the canonical `ClientSession` shape consumed by the auth
 * context. Bugs here surface as missing deviceIds (sessions get dropped
 * from the UI) or as wrong userIds (sessions attributed to the wrong
 * account in the switcher).
 */

import {
  fetchSessionsWithFallback,
  mapSessionsToClient,
  validateSessionBatch,
} from '../../src/ui/utils/sessionHelpers';

describe('mapSessionsToClient', () => {
  it('passes through every primary field unchanged', () => {
    const sessions = [{
      sessionId: 's1',
      deviceId: 'd1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      lastActive: '2025-01-01T00:00:00.000Z',
      userId: 'u1',
      isCurrent: true,
    }];
    const result = mapSessionsToClient(sessions);
    expect(result).toEqual([{
      sessionId: 's1',
      deviceId: 'd1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      lastActive: '2025-01-01T00:00:00.000Z',
      userId: 'u1',
      isCurrent: true,
    }]);
  });

  it('uses fallbackDeviceId when deviceId is missing', () => {
    const [mapped] = mapSessionsToClient(
      [{ sessionId: 's1' }],
      'fallback-device',
      'fallback-user',
    );
    expect(mapped.deviceId).toBe('fallback-device');
    expect(mapped.userId).toBe('fallback-user');
  });

  it('extracts userId from session.user.id', () => {
    const [mapped] = mapSessionsToClient([{
      sessionId: 's1',
      user: { id: 'user-from-nested' },
    }]);
    expect(mapped.userId).toBe('user-from-nested');
  });

  it('extracts userId from session.user._id when id is missing', () => {
    const [mapped] = mapSessionsToClient([{
      sessionId: 's1',
      user: { _id: { toString: () => 'user-from-objectid' } },
    }]);
    expect(mapped.userId).toBe('user-from-objectid');
  });

  it('coerces isCurrent to boolean', () => {
    const result = mapSessionsToClient([
      { sessionId: 's1', isCurrent: true },
      { sessionId: 's2', isCurrent: undefined },
    ]);
    expect(result[0].isCurrent).toBe(true);
    expect(result[1].isCurrent).toBe(false);
  });

  it('generates a 7-day expiration when expiresAt is missing', () => {
    const before = Date.now() + 7 * 24 * 60 * 60 * 1000 - 1000;
    const [mapped] = mapSessionsToClient([{ sessionId: 's1' }]);
    const after = Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000;
    const expires = Date.parse(mapped.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before);
    expect(expires).toBeLessThanOrEqual(after);
  });
});

describe('fetchSessionsWithFallback', () => {
  it('returns mapped device sessions on the happy path', async () => {
    const oxy = {
      getDeviceSessions: jest.fn().mockResolvedValue([{ sessionId: 's1', userId: 'u1' }]),
      getSessionsBySessionId: jest.fn(),
    };
    const result = await fetchSessionsWithFallback(oxy, 's1');
    expect(oxy.getDeviceSessions).toHaveBeenCalledWith('s1');
    expect(oxy.getSessionsBySessionId).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe('s1');
  });

  it('falls back to getSessionsBySessionId when device endpoint throws', async () => {
    const oxy = {
      getDeviceSessions: jest.fn().mockRejectedValue(new Error('404')),
      getSessionsBySessionId: jest.fn().mockResolvedValue([
        { sessionId: 's1', userId: 'u1' },
        { sessionId: 's2', userId: 'u1' },
      ]),
    };
    const result = await fetchSessionsWithFallback(oxy, 's1', { fallbackUserId: 'u1' });
    expect(oxy.getSessionsBySessionId).toHaveBeenCalledWith('s1');
    expect(result.map((s) => s.sessionId)).toEqual(['s1', 's2']);
  });

  it('propagates rejection from the fallback endpoint', async () => {
    const oxy = {
      getDeviceSessions: jest.fn().mockRejectedValue(new Error('device down')),
      getSessionsBySessionId: jest.fn().mockRejectedValue(new Error('user down')),
    };
    await expect(fetchSessionsWithFallback(oxy, 's1')).rejects.toThrow('user down');
  });
});

describe('validateSessionBatch', () => {
  it('returns an empty array for no sessions', async () => {
    const result = await validateSessionBatch({ validateSession: jest.fn() }, []);
    expect(result).toEqual([]);
  });

  it('deduplicates session ids before validating', async () => {
    const validateSession = jest.fn().mockResolvedValue({ valid: true });
    await validateSessionBatch({ validateSession }, ['s1', 's1', 's2'], { maxConcurrency: 5 });
    expect(validateSession).toHaveBeenCalledTimes(2);
  });

  it('marks errored sessions as invalid', async () => {
    const validateSession = jest.fn().mockImplementation((id: string) => {
      if (id === 'bad') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve({ valid: true, user: { id: 'u1' } });
    });
    const result = await validateSessionBatch({ validateSession }, ['good', 'bad'], { maxConcurrency: 2 });
    const good = result.find((r) => r.sessionId === 'good');
    const bad = result.find((r) => r.sessionId === 'bad');
    expect(good?.valid).toBe(true);
    expect(bad?.valid).toBe(false);
    expect(bad?.error).toBeInstanceOf(Error);
  });

  it('clamps concurrency to at least 1 even when caller passes 0', async () => {
    const validateSession = jest.fn().mockResolvedValue({ valid: true });
    const result = await validateSessionBatch(
      { validateSession },
      ['s1', 's2', 's3'],
      { maxConcurrency: 0 },
    );
    expect(result).toHaveLength(3);
    expect(validateSession).toHaveBeenCalledTimes(3);
  });
});

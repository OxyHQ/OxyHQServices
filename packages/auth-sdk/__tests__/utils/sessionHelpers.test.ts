/**
 * Tests for `@oxyhq/auth` session helpers.
 *
 * Identical contract to the RN SDK's helpers — keep the two in lockstep
 * so a session payload that works in a native app also works in a web
 * app and vice versa.
 */

import {
  fetchSessionsWithFallback,
  mapSessionsToClient,
  validateSessionBatch,
} from '../../src/utils/sessionHelpers';

describe('mapSessionsToClient (auth-sdk)', () => {
  it('keeps every primary field intact', () => {
    expect(
      mapSessionsToClient([{
        sessionId: 's1',
        deviceId: 'd1',
        expiresAt: '2030-01-01T00:00:00.000Z',
        lastActive: '2025-01-01T00:00:00.000Z',
        userId: 'u1',
        isCurrent: true,
      }]),
    ).toEqual([{
      sessionId: 's1',
      deviceId: 'd1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      lastActive: '2025-01-01T00:00:00.000Z',
      userId: 'u1',
      isCurrent: true,
    }]);
  });

  it('applies fallback device / user ids when missing', () => {
    const [mapped] = mapSessionsToClient([{ sessionId: 's1' }], 'fallback-d', 'fallback-u');
    expect(mapped.deviceId).toBe('fallback-d');
    expect(mapped.userId).toBe('fallback-u');
  });

  it('prefers user.id over user._id when both present', () => {
    const [mapped] = mapSessionsToClient([{
      sessionId: 's1',
      user: {
        id: 'direct-id',
        _id: { toString: () => 'objectid-id' },
      },
    }]);
    expect(mapped.userId).toBe('direct-id');
  });

  it('coerces isCurrent to boolean', () => {
    const result = mapSessionsToClient([
      { sessionId: 's1', isCurrent: true },
      { sessionId: 's2', isCurrent: undefined },
    ]);
    expect(result[0].isCurrent).toBe(true);
    expect(result[1].isCurrent).toBe(false);
  });
});

describe('fetchSessionsWithFallback (auth-sdk)', () => {
  it('returns mapped device sessions on the happy path', async () => {
    const oxy = {
      getDeviceSessions: jest.fn().mockResolvedValue([{ sessionId: 's1', userId: 'u1' }]),
      getSessionsBySessionId: jest.fn(),
    };
    const result = await fetchSessionsWithFallback(oxy, 's1');
    expect(oxy.getDeviceSessions).toHaveBeenCalled();
    expect(oxy.getSessionsBySessionId).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('falls back to user-session endpoint when device endpoint throws', async () => {
    const oxy = {
      getDeviceSessions: jest.fn().mockRejectedValue(new Error('404')),
      getSessionsBySessionId: jest.fn().mockResolvedValue([
        { sessionId: 's1', userId: 'u1' },
      ]),
    };
    const result = await fetchSessionsWithFallback(oxy, 's1');
    expect(oxy.getSessionsBySessionId).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });
});

describe('validateSessionBatch (auth-sdk)', () => {
  it('returns [] for empty input', async () => {
    expect(await validateSessionBatch({ validateSession: jest.fn() }, [])).toEqual([]);
  });

  it('dedupes session ids', async () => {
    const validateSession = jest.fn().mockResolvedValue({ valid: true });
    await validateSessionBatch({ validateSession }, ['s1', 's1', 's2']);
    expect(validateSession).toHaveBeenCalledTimes(2);
  });

  it('marks failures as invalid', async () => {
    const validateSession = jest.fn().mockImplementation((id: string) => {
      if (id === 'bad') return Promise.reject(new Error('boom'));
      return Promise.resolve({ valid: true });
    });
    const result = await validateSessionBatch({ validateSession }, ['good', 'bad']);
    expect(result.find((r) => r.sessionId === 'good')?.valid).toBe(true);
    expect(result.find((r) => r.sessionId === 'bad')?.valid).toBe(false);
  });

  it('honors maxConcurrency without dropping results', async () => {
    const validateSession = jest.fn().mockResolvedValue({ valid: true });
    const result = await validateSessionBatch(
      { validateSession },
      ['a', 'b', 'c', 'd', 'e'],
      { maxConcurrency: 2 },
    );
    expect(result).toHaveLength(5);
    expect(validateSession).toHaveBeenCalledTimes(5);
  });
});

import type { DeviceSessionState } from '@oxyhq/contracts';
import type { User } from '@oxyhq/core';
import {
  accountIdsOf,
  activeSessionIdOf,
  activeUserOf,
  deviceStateToClientSessions,
} from '../projectSessionState';

function makeUser(id: string): User {
  return {
    id,
    publicKey: `pk-${id}`,
    username: `user-${id}`,
    name: {},
  };
}

// DeviceSessionState.updatedAt is an epoch-ms number on the wire (see
// packages/contracts/src/deviceSession.ts: `updatedAt: z.number()`), not an
// ISO string.
const UPDATED_AT_MS = Date.UTC(2026, 6, 1, 0, 0, 0, 0);
const UPDATED_AT_ISO = new Date(UPDATED_AT_MS).toISOString();

const state: DeviceSessionState = {
  deviceId: 'device-1',
  accounts: [
    { accountId: 'a1', sessionId: 'sess-a1', authuser: 0 },
    { accountId: 'a2', sessionId: 'sess-a2', authuser: 1 },
  ],
  activeAccountId: 'a2',
  revision: 1,
  updatedAt: UPDATED_AT_MS,
};

const usersById = new Map<string, User>([
  ['a1', makeUser('a1')],
  ['a2', makeUser('a2')],
]);

describe('projectSessionState', () => {
  describe('activeSessionIdOf', () => {
    test('returns the active account sessionId', () => {
      expect(activeSessionIdOf(state)).toBe('sess-a2');
    });

    test('returns null for null state', () => {
      expect(activeSessionIdOf(null)).toBeNull();
    });

    test('returns null when activeAccountId is null', () => {
      expect(activeSessionIdOf({ ...state, activeAccountId: null })).toBeNull();
    });
  });

  describe('deviceStateToClientSessions', () => {
    test('maps every account in order with isCurrent + authuser', () => {
      const sessions = deviceStateToClientSessions(state, usersById);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toEqual({
        sessionId: 'sess-a1',
        deviceId: 'device-1',
        expiresAt: UPDATED_AT_ISO,
        lastActive: UPDATED_AT_ISO,
        userId: 'a1',
        isCurrent: false,
        authuser: 0,
      });
      expect(sessions[1]).toEqual({
        sessionId: 'sess-a2',
        deviceId: 'device-1',
        expiresAt: UPDATED_AT_ISO,
        lastActive: UPDATED_AT_ISO,
        userId: 'a2',
        isCurrent: true,
        authuser: 1,
      });
    });

    test('still projects a session for an account absent from usersById', () => {
      const sessions = deviceStateToClientSessions(state, new Map());
      expect(sessions).toHaveLength(2);
      expect(sessions.map((session) => session.userId)).toEqual(['a1', 'a2']);
    });
  });

  describe('activeUserOf', () => {
    test('returns the active account user', () => {
      expect(activeUserOf(state, usersById)).toEqual(makeUser('a2'));
    });

    test('returns null for null state', () => {
      expect(activeUserOf(null, usersById)).toBeNull();
    });

    test('returns null when activeAccountId is null', () => {
      expect(activeUserOf({ ...state, activeAccountId: null }, usersById)).toBeNull();
    });

    test('returns null when the active account id is absent from usersById', () => {
      expect(activeUserOf(state, new Map())).toBeNull();
    });
  });

  describe('accountIdsOf', () => {
    test('returns every account id in order', () => {
      expect(accountIdsOf(state)).toEqual(['a1', 'a2']);
    });

    test('returns [] for null state', () => {
      expect(accountIdsOf(null)).toEqual([]);
    });
  });
});

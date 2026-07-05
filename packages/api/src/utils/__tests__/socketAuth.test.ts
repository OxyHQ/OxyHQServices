/**
 * socketAuth unit tests — the single authority for who a Socket.IO connection is
 * allowed to be.
 *
 * Covers:
 *  - a valid bearer → an AUTHENTICATED user identity (user + device rooms);
 *  - NO bearer + a resolvable `oxy_device` cookie → an ANONYMOUS device identity
 *    (deviceId resolved server-side from the cookie hash, never client input);
 *  - an INVALID bearer falls through to the cookie path (a signed-out tab may
 *    still hold a valid device cookie);
 *  - the native device-token fallback (no cookie jar);
 *  - reject when neither a bearer nor a device anchor resolves;
 *  - socketRoomsFor: a user socket joins BOTH rooms, an anonymous socket joins
 *    ONLY its device room (never a `user:` room).
 */
import jwt from 'jsonwebtoken';

// `jsonwebtoken` is globally mocked in jest.setup.cjs (verify never throws). Drive
// `verify` per-test so we can exercise both the valid-bearer and invalid-bearer
// (throwing) branches.
const mockVerify = jwt.verify as unknown as jest.Mock;

const mockGetStateByCookieKey = jest.fn();
jest.mock('../../services/deviceSession.service', () => {
  const svc = { getStateByCookieKey: (...a: unknown[]) => mockGetStateByCookieKey(...a) };
  return { __esModule: true, default: svc, deviceSessionService: svc };
});

const mockResolveDeviceToken = jest.fn();
jest.mock('../../services/deviceToken.service', () => ({
  resolveDeviceToken: (...a: unknown[]) => mockResolveDeviceToken(...a),
}));

jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { resolveSocketIdentity, type SocketHandshakeAuthInput } from '../socketAuth';
import { socketRoomsFor } from '../socket';

const SECRET = 'test-access-secret';

function handshake(over: Partial<SocketHandshakeAuthInput> = {}): SocketHandshakeAuthInput {
  return { auth: {}, headers: {}, ...over };
}

beforeAll(() => {
  process.env.ACCESS_TOKEN_SECRET = SECRET;
});
beforeEach(() => {
  mockGetStateByCookieKey.mockReset();
  mockResolveDeviceToken.mockReset();
  mockVerify.mockReset().mockReturnValue({ userId: 'u1', deviceId: 'd1', sessionId: 's1' });
});

describe('resolveSocketIdentity', () => {
  it('resolves an authenticated user identity from a valid bearer', async () => {
    const id = await resolveSocketIdentity(handshake({ auth: { token: 'valid.jwt.here' } }));
    expect(id).toEqual({ kind: 'user', user: expect.objectContaining({ id: 'u1', deviceId: 'd1' }) });
    expect(mockVerify).toHaveBeenCalledWith('valid.jwt.here', SECRET);
    // The bearer path never touches the anonymous device resolvers.
    expect(mockGetStateByCookieKey).not.toHaveBeenCalled();
    expect(mockResolveDeviceToken).not.toHaveBeenCalled();
  });

  it('resolves an anonymous device identity from the oxy_device cookie when there is no bearer', async () => {
    mockGetStateByCookieKey.mockResolvedValue({ deviceId: 'dev-cookie', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    const id = await resolveSocketIdentity(handshake({ headers: { cookie: 'oxy_device=rawsecret; other=1' } }));
    expect(id).toEqual({ kind: 'device', deviceId: 'dev-cookie' });
    // deviceId derived server-side from the RAW cookie value, not client input.
    expect(mockGetStateByCookieKey).toHaveBeenCalledWith('rawsecret');
  });

  it('never returns a user identity for a cookie-authed anonymous socket', async () => {
    mockGetStateByCookieKey.mockResolvedValue({ deviceId: 'dev-cookie', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    const id = await resolveSocketIdentity(handshake({ headers: { cookie: 'oxy_device=rawsecret' } }));
    expect(id?.kind).toBe('device');
  });

  it('falls through to the cookie path when the bearer is present but invalid', async () => {
    mockVerify.mockImplementation(() => { throw new Error('invalid signature'); });
    mockGetStateByCookieKey.mockResolvedValue({ deviceId: 'dev-cookie', accounts: [], activeAccountId: null, revision: 0, updatedAt: 1 });
    const id = await resolveSocketIdentity(handshake({ auth: { token: 'not-a-jwt' }, headers: { cookie: 'oxy_device=rawsecret' } }));
    expect(id).toEqual({ kind: 'device', deviceId: 'dev-cookie' });
  });

  it('resolves an anonymous device identity from the native device token when no cookie', async () => {
    mockGetStateByCookieKey.mockResolvedValue(null);
    mockResolveDeviceToken.mockResolvedValue({ deviceId: 'dev-token' });
    const id = await resolveSocketIdentity(handshake({ auth: { deviceToken: 'dt-abc' } }));
    expect(id).toEqual({ kind: 'device', deviceId: 'dev-token' });
    expect(mockResolveDeviceToken).toHaveBeenCalledWith('dt-abc', { headers: {} });
  });

  it('prefers the cookie over the device token, only trying the token when the cookie does not resolve', async () => {
    mockGetStateByCookieKey.mockResolvedValue(null);
    mockResolveDeviceToken.mockResolvedValue({ deviceId: 'dev-token' });
    const id = await resolveSocketIdentity(handshake({ auth: { deviceToken: 'dt-abc' }, headers: { cookie: 'oxy_device=stale' } }));
    expect(mockGetStateByCookieKey).toHaveBeenCalledWith('stale');
    expect(id).toEqual({ kind: 'device', deviceId: 'dev-token' });
  });

  it('rejects (null) when neither a bearer nor a resolvable device anchor is present', async () => {
    const id = await resolveSocketIdentity(handshake());
    expect(id).toBeNull();
  });

  it('rejects (null) when a cookie is present but resolves to no device and there is no token', async () => {
    mockGetStateByCookieKey.mockResolvedValue(null);
    const id = await resolveSocketIdentity(handshake({ headers: { cookie: 'oxy_device=unknown' } }));
    expect(id).toBeNull();
  });
});

describe('socketRoomsFor', () => {
  it('an authenticated user joins BOTH the user and device rooms', () => {
    expect(socketRoomsFor({ user: { id: 'u1', deviceId: 'd1' } })).toEqual(['user:u1', 'device:d1']);
  });

  it('an authenticated user without a device claim joins only the user room', () => {
    expect(socketRoomsFor({ user: { id: 'u1' } })).toEqual(['user:u1']);
  });

  it('an anonymous device socket joins ONLY the device room (never a user room)', () => {
    const rooms = socketRoomsFor({ deviceId: 'dev-cookie' });
    expect(rooms).toEqual(['device:dev-cookie']);
    expect(rooms.some((r) => r.startsWith('user:'))).toBe(false);
  });

  it('returns no rooms for an unresolved identity', () => {
    expect(socketRoomsFor({})).toEqual([]);
  });
});

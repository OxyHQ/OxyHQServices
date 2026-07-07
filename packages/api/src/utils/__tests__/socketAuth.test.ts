/**
 * socketAuth unit tests — the single authority for who a Socket.IO connection is
 * allowed to be.
 *
 * Covers:
 *  - a valid bearer → an AUTHENTICATED user identity (user + device rooms);
 *  - an INVALID bearer → reject;
 *  - no bearer → reject (a signed-out device needs no real-time sync);
 *  - socketRoomsFor: a user socket joins BOTH its user + device rooms (device
 *    from the JWT claim).
 */
import jwt from 'jsonwebtoken';

// `jsonwebtoken` is globally mocked in jest.setup.cjs (verify never throws). Drive
// `verify` per-test so we can exercise both the valid-bearer and invalid-bearer
// (throwing) branches.
const mockVerify = jwt.verify as unknown as jest.Mock;

jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { resolveSocketIdentity, type SocketHandshakeAuthInput } from '../socketAuth';
import { socketRoomsFor } from '../socket';

const SECRET = 'test-access-secret';

function handshake(over: Partial<SocketHandshakeAuthInput> = {}): SocketHandshakeAuthInput {
  return { auth: {}, ...over };
}

beforeAll(() => {
  process.env.ACCESS_TOKEN_SECRET = SECRET;
});
beforeEach(() => {
  mockVerify.mockReset().mockReturnValue({ userId: 'u1', deviceId: 'd1', sessionId: 's1' });
});

describe('resolveSocketIdentity', () => {
  it('resolves an authenticated user identity from a valid bearer', async () => {
    const id = await resolveSocketIdentity(handshake({ auth: { token: 'valid.jwt.here' } }));
    expect(id).toEqual({ kind: 'user', user: expect.objectContaining({ id: 'u1', deviceId: 'd1' }) });
    expect(mockVerify).toHaveBeenCalledWith('valid.jwt.here', SECRET);
  });

  it('rejects (null) when the bearer is present but invalid', async () => {
    mockVerify.mockImplementation(() => { throw new Error('invalid signature'); });
    const id = await resolveSocketIdentity(handshake({ auth: { token: 'not-a-jwt' } }));
    expect(id).toBeNull();
  });

  it('rejects (null) when there is no bearer', async () => {
    const id = await resolveSocketIdentity(handshake());
    expect(id).toBeNull();
  });

  it('rejects (null) when the bearer decodes without a userId', async () => {
    mockVerify.mockReturnValue({ deviceId: 'd1' });
    const id = await resolveSocketIdentity(handshake({ auth: { token: 'valid.jwt.here' } }));
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

  it('returns no rooms for an unresolved identity', () => {
    expect(socketRoomsFor({})).toEqual([]);
  });
});

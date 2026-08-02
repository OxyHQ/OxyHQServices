/**
 * Session ↔ OAuth-client binding (RFC 6749 §6).
 *
 * `POST /auth/oauth/token` may only honour `grant_type=refresh_token` for a
 * client the refresh token was actually issued to. Because an Oxy session is
 * shared across clients on the same (user, device), the binding is a SET on the
 * session that only ever grows — `ISession.oauthClientIds`. These tests pin
 * that `createSession` records it on BOTH write paths (fresh mint and the
 * reuse-an-existing-session path), and that it is absent for every non-OAuth
 * sign-in so those sessions can never be refreshed through the OAuth endpoint.
 */

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

const mockSave = jest.fn();
const mockFindOneAndUpdate = jest.fn();

const findOneQueue: unknown[] = [];
function makeFindOneResult(doc: unknown) {
  const p = Promise.resolve(doc);
  return Object.assign(p, {
    select: () => ({ lean: () => Promise.resolve(doc) }),
    lean: () => Promise.resolve(doc),
    populate: () => Promise.resolve(doc),
  });
}
const mockFindOne = jest.fn(() => makeFindOneResult(findOneQueue.shift() ?? null));

jest.mock('../../models/Session', () => {
  const SessionConstructor = jest.fn().mockImplementation((data: Record<string, unknown>) => ({
    ...data,
    save: mockSave,
  }));
  Object.assign(SessionConstructor, {
    findOne: mockFindOne,
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    find: jest.fn(),
  });
  return { __esModule: true, default: SessionConstructor };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: jest.fn() },
}));

jest.mock('../account.service', () => ({
  __esModule: true,
  accountService: { verifyActingAs: jest.fn() },
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../utils/sessionCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
    invalidate: jest.fn(),
    invalidateUserSessions: jest.fn(),
    shouldUpdateLastActive: jest.fn().mockReturnValue(false),
    clearPendingLastActive: jest.fn(),
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { get: jest.fn().mockReturnValue(null), set: jest.fn(), invalidate: jest.fn() },
}));

jest.mock('../../utils/sessionUtils', () => ({
  generateSessionTokens: jest.fn().mockReturnValue({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
  validateAccessToken: jest.fn(),
  validateRefreshToken: jest.fn(),
  ACCESS_TOKEN_TTL_SECONDS: 900,
}));

jest.mock('../../utils/deviceUtils', () => ({
  extractDeviceInfo: jest.fn().mockReturnValue({
    deviceId: 'device-x', deviceName: 'Dev', deviceType: 'desktop', platform: 'web',
    browser: 'Chrome', os: 'Linux', ipAddress: '127.0.0.1', userAgent: 'ua',
  }),
  generateDeviceFingerprint: jest.fn(),
  registerDevice: jest.fn(),
  deriveServiceDeviceId: jest.fn(),
}));

jest.mock('../securityActivityService', () => ({
  __esModule: true,
  default: { logDeviceAdded: jest.fn().mockResolvedValue(undefined) },
}));

import { Types } from 'mongoose';
import sessionService from '../session.service';
import type { Request } from 'express';

const USER_ID = new Types.ObjectId();
const CLIENT_ID = 'oxy_dk_matrix_auth_service';

const req = { headers: { 'user-agent': 'ua' }, ip: '127.0.0.1' } as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  findOneQueue.length = 0;
  mockSave.mockResolvedValue(undefined);
});

describe('createSession — fresh mint', () => {
  it('records the minting OAuth client on the session', async () => {
    findOneQueue.push(null, null); // isNewDevice probe + no reusable session

    const session = await sessionService.createSession(USER_ID.toString(), req, {
      oauthClientId: CLIENT_ID,
    });

    expect(session.oauthClientIds).toEqual([CLIENT_ID]);
  });

  it('leaves the binding ABSENT for a non-OAuth sign-in', async () => {
    findOneQueue.push(null, null);

    const session = await sessionService.createSession(USER_ID.toString(), req, {
      deviceName: 'Password login',
    });

    expect(session.oauthClientIds).toBeUndefined();
  });
});

describe('createSession — reusing an existing session', () => {
  const existingSession = {
    _id: new Types.ObjectId(),
    sessionId: 'existing-session',
    deviceId: 'device-x',
    deviceInfo: { deviceName: 'Dev' },
  };

  it('adds the client to the set without dropping the ones already there', async () => {
    findOneQueue.push(null, existingSession);
    mockFindOneAndUpdate.mockResolvedValue({
      sessionId: 'existing-session',
      deviceId: 'device-x',
      oauthClientIds: ['oxy_dk_other', CLIENT_ID],
    });

    await sessionService.createSession(USER_ID.toString(), req, { oauthClientId: CLIENT_ID });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: existingSession._id }),
      expect.objectContaining({ $addToSet: { oauthClientIds: CLIENT_ID } }),
      expect.objectContaining({ new: true }),
    );
  });

  it('does not touch the binding when the reuse is not an OAuth exchange', async () => {
    findOneQueue.push(null, existingSession);
    mockFindOneAndUpdate.mockResolvedValue({
      sessionId: 'existing-session',
      deviceId: 'device-x',
    });

    await sessionService.createSession(USER_ID.toString(), req, { deviceName: 'Password login' });

    const update = mockFindOneAndUpdate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(update).not.toHaveProperty('$addToSet');
  });
});

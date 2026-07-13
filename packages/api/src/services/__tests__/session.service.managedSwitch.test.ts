/**
 * Managed-account (account-switch) session binding.
 *
 * A session minted by switching INTO a managed account carries `operatedByUserId`
 * (the operator). Its validity stays bound to that operator's `account:act_as`
 * membership: validate AND refresh re-verify, and a revoked operator's session is
 * deactivated. Ordinary sessions (no operator) are never re-checked.
 *
 * Real `mongoose` is restored so `Types.ObjectId` works (the helper resolves the
 * account/operator ids via the real ObjectId validation). All models/utilities
 * the service touches are mocked; `account.service` is mocked because the helper
 * imports it lazily for the act_as re-check.
 */

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

const mockSave = jest.fn();
const mockUpdateOne = jest.fn();
const mockVerifyActingAs = jest.fn();

// Session.findOne is awaited directly (refresh path) AND chained `.select().lean()`
// / `.lean()` (read path). Return a thenable that ALSO exposes those chain
// methods, all resolving to the same queued doc.
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
    updateOne: mockUpdateOne,
    updateMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  });
  return { __esModule: true, default: SessionConstructor };
});

const mockUserFindById = jest.fn();
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

jest.mock('../account.service', () => ({
  __esModule: true,
  accountService: { verifyActingAs: (...args: unknown[]) => mockVerifyActingAs(...args) },
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
}));

jest.mock('../../utils/deviceUtils', () => ({
  extractDeviceInfo: jest.fn().mockReturnValue({
    deviceId: 'device-x', deviceName: 'Dev', deviceType: 'desktop', platform: 'web',
    browser: 'Chrome', os: 'Linux', userAgent: 'ua',
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
import { validateAccessToken, validateRefreshToken } from '../../utils/sessionUtils';
import type { Request } from 'express';

const ACCOUNT_ID = new Types.ObjectId();
const OPERATOR_ID = new Types.ObjectId();

// The validate-path re-check is throttled per-sessionId via a module-level Map
// that persists across tests, so each test uses a UNIQUE sessionId to exercise
// a fresh re-check (mirrors production, where distinct sessions check independently).
let seq = 0;
let currentSessionId = '';

function managedSessionDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    sessionId: currentSessionId,
    userId: ACCOUNT_ID,
    operatedByUserId: OPERATOR_ID,
    deviceId: 'device-x',
    deviceInfo: { deviceType: 'desktop', platform: 'web', lastActive: new Date() },
    accessToken: 'acc',
    refreshToken: 'ref',
    isActive: true,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    lastRefresh: new Date(),
    save: mockSave,
    ...overrides,
  };
}

const req = { headers: { 'user-agent': 'ua' }, ip: '127.0.0.1' } as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  findOneQueue.length = 0;
  currentSessionId = `session-${++seq}`;
  mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  (validateAccessToken as jest.Mock).mockReturnValue({ valid: true, payload: { sessionId: currentSessionId, userId: ACCOUNT_ID.toString(), deviceId: 'device-x' } });
  (validateRefreshToken as jest.Mock).mockReturnValue({ valid: true, payload: { sessionId: currentSessionId, userId: ACCOUNT_ID.toString(), deviceId: 'device-x' } });
  mockUserFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: ACCOUNT_ID, username: 'acme-org' }) }) });
});

describe('createSession records the operator', () => {
  it('stores operatedByUserId on a switched (managed) session', async () => {
    findOneQueue.push(null, null); // isNewDevice probe + no reusable session
    mockSave.mockResolvedValueOnce(undefined);

    const session = await sessionService.createSession(ACCOUNT_ID.toString(), req, {
      operatedByUserId: OPERATOR_ID.toString(),
    });

    expect(session.operatedByUserId).toBe(OPERATOR_ID.toString());
  });
});

describe('validateSession binds managed sessions to operator act_as', () => {
  it('returns the session while the operator still holds act_as', async () => {
    findOneQueue.push(managedSessionDoc());
    mockVerifyActingAs.mockResolvedValue('admin');

    const result = await sessionService.validateSession('access');

    expect(result).not.toBeNull();
    expect(mockVerifyActingAs).toHaveBeenCalledWith(OPERATOR_ID.toString(), ACCOUNT_ID.toString());
    expect(mockUpdateOne).not.toHaveBeenCalled(); // not deactivated
  });

  it('deactivates and rejects when the operator lost act_as (revoked membership)', async () => {
    findOneQueue.push(managedSessionDoc());
    mockVerifyActingAs.mockResolvedValue(null);

    const result = await sessionService.validateSession('access');

    expect(result).toBeNull();
    expect(mockVerifyActingAs).toHaveBeenCalledWith(OPERATOR_ID.toString(), ACCOUNT_ID.toString());
    // Session was deactivated (revocation kills it).
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: currentSessionId, isActive: true },
      { $set: { isActive: false, updatedAt: expect.any(Date) } }
    );
  });

  it('never re-checks an ordinary (non-switched) session', async () => {
    findOneQueue.push(managedSessionDoc({ operatedByUserId: null }));

    const result = await sessionService.validateSession('access');

    expect(result).not.toBeNull();
    expect(mockVerifyActingAs).not.toHaveBeenCalled();
  });
});

describe('refreshTokens re-checks managed sessions unconditionally', () => {
  it('refuses to refresh and deactivates when the operator lost act_as', async () => {
    findOneQueue.push(managedSessionDoc());
    mockVerifyActingAs.mockResolvedValue(null);

    const result = await sessionService.refreshTokens('ref');

    expect(result).toBeNull();
    expect(mockVerifyActingAs).toHaveBeenCalledWith(OPERATOR_ID.toString(), ACCOUNT_ID.toString());
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: currentSessionId, isActive: true },
      { $set: { isActive: false, updatedAt: expect.any(Date) } }
    );
  });

  it('rotates tokens when the operator still holds act_as', async () => {
    findOneQueue.push(managedSessionDoc());
    mockVerifyActingAs.mockResolvedValue('owner');
    mockSave.mockResolvedValueOnce(undefined);

    const result = await sessionService.refreshTokens('ref');

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe('new-access');
    expect(mockVerifyActingAs).toHaveBeenCalledWith(OPERATOR_ID.toString(), ACCOUNT_ID.toString());
  });
});

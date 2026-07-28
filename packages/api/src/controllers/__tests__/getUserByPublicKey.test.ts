/**
 * GET /auth/user/:publicKey must return a public profile only — no email.
 */

const mockFindOne = jest.fn();
const mockFormatUserResponse = jest.fn();

jest.mock('../../server', () => ({
  emitSessionUpdate: jest.fn(),
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
  buildAuthMethod: jest.fn(),
}));

jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {
    isValidPublicKey: jest.fn(() => true),
  },
}));

jest.mock('../../services/user.service', () => ({
  userService: {
    formatUserResponse: (...args: unknown[]) => mockFormatUserResponse(...args),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../models/Session', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AuthChallenge', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Notification', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/session.service', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/sessionCache', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/securityActivityService', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/deviceLogin.service', () => ({ finalizeDeviceLogin: jest.fn() }));
jest.mock('../../utils/deviceUtils', () => ({
  getDeviceActiveSessions: jest.fn(),
  logoutAllDeviceSessions: jest.fn(),
}));

import { SessionController } from '../session.controller';
import { PUBLIC_USER_PROFILE_SELECT } from '../../utils/publicUserProjection';

const PUBLIC_KEY = 'a'.repeat(64);

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('SessionController.getUserByPublicKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: { toString: () => '64aaaaaaaaaaaaaaaaaaaaaa' },
        username: 'alice',
      }),
    });
    mockFormatUserResponse.mockReturnValue({
      id: '64aaaaaaaaaaaaaaaaaaaaaa',
      username: 'alice',
      name: { full: 'Alice' },
    });
  });

  it('projects only public profile fields and omits email from the response', async () => {
    const req = { params: { publicKey: PUBLIC_KEY } };
    const res = mockRes();

    await SessionController.getUserByPublicKey(req as never, res as never);

    expect(mockFindOne).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
    expect(mockFindOne.mock.results[0].value.select).toHaveBeenCalledWith(
      PUBLIC_USER_PROFILE_SELECT,
    );
    expect(mockFormatUserResponse).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      id: '64aaaaaaaaaaaaaaaaaaaaaa',
      username: 'alice',
      name: { full: 'Alice' },
    });
    expect(JSON.stringify(res.body)).not.toContain('email');
  });
});

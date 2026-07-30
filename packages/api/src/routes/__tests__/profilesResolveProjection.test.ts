/**
 * GET /profiles/resolve public-projection coverage.
 *
 * The sibling suite (`profilesResolve.test.ts`) stubs `formatUserResponse` and
 * its `User.findOne` mock ignores the `.select()` argument. This suite uses the
 * REAL `userService.formatUserResponse` and applies the route's inclusion
 * `.select()` with MongoDB semantics.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('mongoose', () => jest.requireActual('mongoose'));
import { Types } from 'mongoose';

import { PUBLIC_USER_PROFILE_SELECT } from '../../utils/publicUserProjection';

const mockUserFindOne = jest.fn();
const mockResolveAndUpsert = jest.fn();
const mockIsFediverseHandle = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveViewerId: (): string | undefined => undefined,
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { resolveAndUpsert: (...args: unknown[]) => mockResolveAndUpsert(...args) },
  isFediverseHandle: (...args: unknown[]) => mockIsFediverseHandle(...args),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
  default: { aggregate: jest.fn() },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
    findById: jest.fn(),
  },
}));

import profilesRouter from '../profiles';
import { errorHandler } from '../../middleware/errorHandler';
import { userService } from '../../services/user.service';

const STORED_USER = {
  _id: new Types.ObjectId(),
  username: 'nate@oxy.so',
  email: 'nate@oxy.so',
  password: '$2b$10$hash',
  refreshToken: 'rt_secret',
  publicKey: '048295c46ffc47451',
  phone: '+34600000000',
  accountStatus: 'active',
  reputationTier: 'trusted',
  name: { first: 'Nate', last: 'Isern', full: 'Nate Isern' },
  avatar: 'file_123',
  color: 'orange',
  bio: 'hello',
  verified: true,
  type: 'federated',
  federation: { instance: 'oxy.so' },
  privacySettings: {
    isPrivateAccount: false,
    fediverseSharing: true,
  },
  createdAt: '2026-02-03T10:08:23.997Z',
  updatedAt: '2026-07-30T18:20:41.852Z',
} as const;

function applyInclusionSelect(
  doc: Record<string, unknown>,
  select: string,
): Record<string, unknown> {
  const paths = select.split(/\s+/).filter(Boolean);
  const out: Record<string, unknown> = { _id: doc._id };
  for (const path of paths) {
    if (path.includes('.')) {
      const [head, leaf] = path.split('.');
      const parent = doc[head];
      if (parent && typeof parent === 'object') {
        const nested = (out[head] as Record<string, unknown>) ?? {};
        nested[leaf] = (parent as Record<string, unknown>)[leaf];
        out[head] = nested;
      }
    } else if (path in doc) {
      out[path] = doc[path];
    }
  }
  return out;
}

function findOneQuery(result: Record<string, unknown> | null) {
  return {
    select: (selectArg: string) => {
      if (selectArg !== PUBLIC_USER_PROFILE_SELECT) {
        throw new Error(
          `GET /profiles/resolve must use PUBLIC_USER_PROFILE_SELECT, got: ${selectArg}`,
        );
      }
      const projected = result ? applyInclusionSelect(result, selectArg) : null;
      return {
        lean: async () => projected,
      };
    },
  };
}

function requestJson(server: http.Server, handle: string) {
  const address = server.address() as AddressInfo;
  return new Promise<{ status: number; raw: string; body: { data?: Record<string, unknown> | null } }>(
    (resolve, reject) => {
      const req = http.request(
        {
          method: 'GET',
          host: '127.0.0.1',
          port: address.port,
          path: `/profiles/resolve?handle=${encodeURIComponent(handle)}`,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                raw,
                body: raw.length > 0 ? JSON.parse(raw) : {},
              });
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    },
  );
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use('/profiles', profilesRouter);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(userService, 'getUserStats').mockResolvedValue({ followers: 0, following: 0 });
  jest.spyOn(userService, 'getViewerRelationship').mockResolvedValue({
    isFollowing: false,
    followsYou: false,
  });
  mockIsFediverseHandle.mockReturnValue(true);
  mockResolveAndUpsert.mockResolvedValue(null);
  mockUserFindOne.mockImplementation(() => findOneQuery({ ...STORED_USER }));
});

describe('GET /profiles/resolve public projection', () => {
  it('never emits a private field on the response', async () => {
    const res = await requestJson(server, 'nate@oxy.so');

    expect(res.status).toBe(200);
    const profile = res.body.data;
    expect(profile).toBeDefined();

    expect(profile).not.toHaveProperty('email');
    expect(profile).not.toHaveProperty('publicKey');
    expect(profile).not.toHaveProperty('password');
    expect(res.raw).not.toContain('rt_secret');
    expect(res.raw).not.toContain('048295c46ffc47451');
  });

  it('still returns the fields the profile row renders', async () => {
    const res = await requestJson(server, 'nate@oxy.so');
    const profile = res.body.data as Record<string, unknown>;

    expect(profile.id).toBe(STORED_USER._id.toString());
    expect(profile.username).toBe('nate@oxy.so');
    expect(profile.bio).toBe('hello');
    expect(profile.isFederated).toBe(true);
    expect(profile).not.toHaveProperty('accountStatus');
  });
});

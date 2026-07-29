/**
 * `GET /reputation/leaderboard` wire-shape tests.
 *
 * The leaderboard used to hand `sendPaginated` the raw aggregate projection, so
 * each row's `user` carried Mongo's `_id` and the user's RAW stored name
 * subdocument. The SDK type promised `user.id` and the canonical composed
 * `name`, which meant `entry.user.id` was `undefined` for every row — the
 * `@oxyhq/services` leaderboard screen's `keyExtractor` silently fell through to
 * its index fallback, and `name.displayName` did not mean what it means on
 * every other user DTO.
 *
 * The row now goes through `serializeLeaderboardEntry`, which is annotated
 * against `ReputationLeaderboardEntry` from `@oxyhq/contracts` and validated
 * with that type's schema. These tests lock what a consumer actually receives.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockGetLeaderboard = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
}));

jest.mock('../../middleware/optionalAuth', () => ({
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/validation', () => ({
  resolveUserIdToObjectId: jest.fn(),
  validatePagination: () => ({ limit: 20, offset: 0 }),
}));

jest.mock('../../services/reputation.service', () => ({
  __esModule: true,
  default: {
    getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
    listTransactions: jest.fn(),
    getBalance: jest.fn(),
    getInfluence: jest.fn(),
    award: jest.fn(),
    createDispute: jest.fn(),
    upsertRule: jest.fn(),
    listEnabledRules: jest.fn(),
    listDisputesForUser: jest.fn(),
    listOpenDisputes: jest.fn(),
    reverseTransaction: jest.fn(),
    voidTransaction: jest.fn(),
    recalculateBalance: jest.fn(),
    resolveDispute: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import reputationRouter from '../reputation.routes';
import { errorHandler } from '../../middleware/errorHandler';

const USER_ID = '64aaaaaaaaaaaaaaaaaaaaaa';

interface LeaderboardRow {
  user: { id?: string; _id?: string; username: string; name: Record<string, unknown> };
  total: number;
  trustTier: string;
  rank: number;
}

function getJson(
  server: http.Server,
  path: string
): Promise<{ status: number; body: { data?: LeaderboardRow[] } }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: { connection: 'close' },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * One aggregate row exactly as `reputationService.getLeaderboard` projects it:
 * the subject user inlined under `userId`, keyed on `_id`, with the raw stored
 * name subdocument.
 */
function leaderboardRow(name: Record<string, string> | undefined) {
  return {
    userId: {
      _id: { toString: () => USER_ID },
      username: 'nate',
      name,
      avatar: 'file-1',
      publicKey: '04abc',
    },
    total: 120,
    trustTier: 'trusted',
  };
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/reputation', reputationRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /reputation/leaderboard', () => {
  it('emits the user id as `id`, not the raw Mongo `_id`', async () => {
    mockGetLeaderboard.mockResolvedValue({
      items: [leaderboardRow({ first: 'Nate', last: 'Isern' })],
      total: 1,
    });

    const res = await getJson(server, '/reputation/leaderboard');

    expect(res.status).toBe(200);
    const rows = res.body.data as LeaderboardRow[];
    expect(rows[0].user.id).toBe(USER_ID);
    expect(rows[0].user).not.toHaveProperty('_id');
  });

  it('composes `name.displayName` the same way every other user DTO does', async () => {
    mockGetLeaderboard.mockResolvedValue({
      items: [leaderboardRow({ first: 'Nate', last: 'Isern' })],
      total: 1,
    });

    const res = await getJson(server, '/reputation/leaderboard');

    const rows = res.body.data as LeaderboardRow[];
    expect(rows[0].user.name.displayName).toBe('Nate Isern');
  });

  /*
   * `composeDisplayName` never synthesizes a name from the username, so an
   * account with no human name gets NO `displayName` and the consumer falls back
   * to the handle. Locked here so a future "helpful" fallback cannot creep in.
   */
  it('omits `displayName` for an account with no human name', async () => {
    mockGetLeaderboard.mockResolvedValue({ items: [leaderboardRow(undefined)], total: 1 });

    const res = await getJson(server, '/reputation/leaderboard');

    const rows = res.body.data as LeaderboardRow[];
    expect(rows[0].user.name).not.toHaveProperty('displayName');
    expect(rows[0].user.username).toBe('nate');
  });

  it('publishes only the narrow public projection, and the rank', async () => {
    mockGetLeaderboard.mockResolvedValue({ items: [leaderboardRow(undefined)], total: 1 });

    const res = await getJson(server, '/reputation/leaderboard');

    const rows = res.body.data as LeaderboardRow[];
    expect(Object.keys(rows[0]).sort()).toEqual(['rank', 'total', 'trustTier', 'user']);
    expect(Object.keys(rows[0].user).sort()).toEqual([
      'avatar',
      'id',
      'name',
      'publicKey',
      'username',
    ]);
    expect(rows[0].rank).toBe(1);
  });
});

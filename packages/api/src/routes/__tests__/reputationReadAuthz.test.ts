/**
 * /reputation READ authorization tests.
 *
 * Two distinct leaks are guarded here:
 *
 *  - `GET /:userId/transactions` used to serve ANY user's ledger to ANY
 *    authenticated caller. Transaction `metadata` names third parties (the
 *    attestor who physically met the subject, the staking voucher, the full
 *    juror roster of a resolved validation), so the ledger is owner-or-staff.
 *  - `GET /:userId/balance` used to serve `reliability` (abuseScore,
 *    reportAccuracyScore, report counts) and the `influence` weights to
 *    ANONYMOUS callers, for any subject enumerable by id or publicKey. The
 *    endpoint stays public but the response is view-split.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockOptionalAuthMiddleware = jest.fn();
const mockListTransactions = jest.fn();
const mockGetBalance = jest.fn();
const mockGetInfluence = jest.fn();
const mockResolveUserIdToObjectId = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: jest.fn(),
}));

jest.mock('../../middleware/optionalAuth', () => ({
  optionalAuthMiddleware: (...args: unknown[]) => mockOptionalAuthMiddleware(...args),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/validation', () => ({
  resolveUserIdToObjectId: (...args: unknown[]) => mockResolveUserIdToObjectId(...args),
  validatePagination: (_limit: unknown, _offset: unknown, _max: number, defaultLimit: number) => ({
    limit: defaultLimit,
    offset: 0,
  }),
}));

jest.mock('../../services/reputation.service', () => ({
  __esModule: true,
  default: {
    listTransactions: (...args: unknown[]) => mockListTransactions(...args),
    getBalance: (...args: unknown[]) => mockGetBalance(...args),
    getInfluence: (...args: unknown[]) => mockGetInfluence(...args),
    award: jest.fn(),
    createDispute: jest.fn(),
    upsertRule: jest.fn(),
    listEnabledRules: jest.fn(),
    getLeaderboard: jest.fn(),
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

const SUBJECT_ID = '64aaaaaaaaaaaaaaaaaaaaaa';
const OTHER_ID = '64bbbbbbbbbbbbbbbbbbbbbb';
const STAFF_ID = '64cccccccccccccccccccccc';

/** The caller each mocked auth middleware attaches, or `null` for anonymous. */
interface TestCaller {
  _id: string;
  isStaff?: boolean;
}

interface JsonResponse {
  status: number;
  body: {
    error?: string;
    message?: string;
    data?: Record<string, unknown> | Record<string, unknown>[];
  };
}

function getJson(server: http.Server, path: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port: address.port,
        path,
        // Close each socket after its response so the server has no lingering
        // keep-alive connections at teardown (`server.close` resolves cleanly).
        headers: { connection: 'close' },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Point both mocked auth middlewares at `caller` for the next request. */
function signInAs(caller: TestCaller | null): void {
  mockAuthMiddleware.mockImplementation((req, res, next) => {
    if (!caller) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.user = caller;
    next();
  });
  mockOptionalAuthMiddleware.mockImplementation((req, _res, next) => {
    if (caller) {
      req.user = caller;
    }
    next();
  });
}

/**
 * A balance carrying every sensitive field the serializers may expose.
 *
 * Shaped exactly as the `ReputationBalance` mongoose document is — every
 * breakdown bucket present, timestamps as `Date`s — because `serializeBalance`
 * now validates its output against the `@oxyhq/contracts` schema and a fixture
 * the real model could never produce would fail that check rather than the
 * authorization behaviour these tests are about.
 */
function balanceFixture() {
  return {
    userId: { toString: () => SUBJECT_ID },
    total: 120,
    positive: 200,
    negative: -80,
    breakdown: {
      content: 100,
      social: 0,
      trust: 100,
      moderation: 0,
      physical: 0,
      penalties: 80,
    },
    trustTier: 'trusted',
    influence: {
      defaultWeight: 0.34,
      reportWeight: 0.29,
      moderationWeight: 0.34,
      rankingFeedbackWeight: 0.34,
    },
    reliability: {
      abuseScore: 0.62,
      reportAccuracyScore: 0.25,
      accurateReports: 1,
      rejectedReports: 3,
    },
    recalculatedAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

let server: http.Server;

beforeAll((done) => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
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
  mockResolveUserIdToObjectId.mockImplementation((userId: string) => Promise.resolve(userId));
  mockGetBalance.mockResolvedValue(balanceFixture());
  mockListTransactions.mockResolvedValue({
    items: [
      {
        _id: { toString: () => 'txn1' },
        userId: { toString: () => SUBJECT_ID },
        points: 40,
        actionType: 'peer_validated',
        category: 'trust',
        status: 'active',
        reason: 'Validated by a randomly-selected jury of peers',
        metadata: { voterUserIds: ['juror-a', 'juror-b'] },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ],
    total: 1,
  });
});

describe('GET /reputation/:userId/transactions ownership gate', () => {
  it('refuses an authenticated caller reading someone else\'s ledger', async () => {
    signInAs({ _id: OTHER_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/transactions`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own/i);
    expect(mockListTransactions).not.toHaveBeenCalled();
  });

  it('never leaks juror identities to a non-owner', async () => {
    signInAs({ _id: OTHER_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/transactions`);

    expect(JSON.stringify(res.body)).not.toContain('juror-a');
  });

  it('serves the subject their own ledger', async () => {
    signInAs({ _id: SUBJECT_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/transactions`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mockListTransactions).toHaveBeenCalledWith(SUBJECT_ID, expect.any(Number), 0);
  });

  it('serves staff another user\'s ledger', async () => {
    signInAs({ _id: STAFF_ID, isStaff: true });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects an anonymous caller', async () => {
    signInAs(null);

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/transactions`);

    expect(res.status).toBe(401);
    expect(mockListTransactions).not.toHaveBeenCalled();
  });
});

describe('GET /reputation/:userId/balance view split', () => {
  /** Fields that are the platform's internal judgement about the subject. */
  const PRIVATE_FIELDS = [
    'reliability',
    'influence',
    'breakdown',
    'positive',
    'negative',
    'recalculatedAt',
    'updatedAt',
  ];

  it('withholds the sensitive fields from an anonymous caller', async () => {
    signInAs(null);

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/balance`);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    for (const field of PRIVATE_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
    // Belt and braces: no abuse signal may survive anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain('abuseScore');
    expect(JSON.stringify(res.body)).not.toContain('0.62');
  });

  it('keeps the public trust signal readable without a token', async () => {
    signInAs(null);

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/balance`);

    expect(res.body.data).toEqual({
      userId: SUBJECT_ID,
      total: 120,
      trustTier: 'trusted',
    });
  });

  it('withholds the sensitive fields from an authenticated third party', async () => {
    signInAs({ _id: OTHER_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/balance`);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    for (const field of PRIVATE_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
  });

  it('serves the subject their own full balance', async () => {
    signInAs({ _id: SUBJECT_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/balance`);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    for (const field of PRIVATE_FIELDS) {
      expect(data).toHaveProperty(field);
    }
    expect(data.reliability).toMatchObject({ abuseScore: 0.62 });
    expect(data.influence).toMatchObject({ reportWeight: 0.29 });
  });

  it('serves staff another user\'s full balance', async () => {
    signInAs({ _id: STAFF_ID, isStaff: true });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/balance`);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    for (const field of PRIVATE_FIELDS) {
      expect(data).toHaveProperty(field);
    }
  });

  it('recognizes the subject when req.user._id is an ObjectId-like value', async () => {
    signInAs({ _id: { toString: () => SUBJECT_ID } as unknown as string });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/balance`);

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data).toHaveProperty('reliability');
  });
});

describe('GET /reputation/:userId/influence ownership gate', () => {
  const influenceFixture = {
    context: 'default',
    weight: 0.34,
    influence: {
      defaultWeight: 0.34,
      reportWeight: 0.29,
      moderationWeight: 0.34,
      rankingFeedbackWeight: 0.34,
    },
  };

  beforeEach(() => {
    mockGetInfluence.mockResolvedValue(influenceFixture);
  });

  it('refuses an authenticated caller reading someone else\'s influence', async () => {
    signInAs({ _id: OTHER_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/influence`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own influence/i);
    expect(mockGetInfluence).not.toHaveBeenCalled();
  });

  it('serves the subject their own influence', async () => {
    signInAs({ _id: SUBJECT_ID });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/influence`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ weight: 0.34 });
    expect(mockGetInfluence).toHaveBeenCalledWith(SUBJECT_ID, 'default');
  });

  it('serves staff another user\'s influence', async () => {
    signInAs({ _id: STAFF_ID, isStaff: true });

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/influence`);

    expect(res.status).toBe(200);
    expect(mockGetInfluence).toHaveBeenCalledWith(SUBJECT_ID, 'default');
  });

  it('rejects an anonymous caller', async () => {
    signInAs(null);

    const res = await getJson(server, `/reputation/${SUBJECT_ID}/influence`);

    expect(res.status).toBe(401);
    expect(mockGetInfluence).not.toHaveBeenCalled();
  });
});

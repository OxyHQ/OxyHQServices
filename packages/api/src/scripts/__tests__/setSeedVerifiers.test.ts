/**
 * Unit tests for the seed-verifier admin script's core function
 * (`seedVerifierByUsername` in `../set-seed-verifiers`).
 *
 * The DB layer (`User`, `PersonhoodStatus`) and the personhood service
 * (`recomputePersonhood`) are fully mocked — there is NO real mongoose
 * connection. Mocks use the `.js` import paths the source uses; the api
 * jest `moduleNameMapper` (`^(\.{1,2}/.*)\.js$` → `$1`) maps them back to the
 * `.ts` sources so `jest.mock(...)` string paths resolve correctly.
 */

const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockUserUpdateOne = jest.fn();
const mockStatusFindOne = jest.fn();
const mockRecompute = jest.fn();

jest.mock('../../models/User.js', () => ({
  __esModule: true,
  User: {
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
    findById: (...args: unknown[]) => mockUserFindById(...args),
    updateOne: (...args: unknown[]) => mockUserUpdateOne(...args),
  },
}));

jest.mock('../../models/PersonhoodStatus.js', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockStatusFindOne(...args),
  },
}));

jest.mock('../../services/civic/personhood.service.js', () => ({
  __esModule: true,
  recomputePersonhood: (...args: unknown[]) => mockRecompute(...args),
}));

// Keep the script's logger output quiet + assertion-free.
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// dotenv.config() is called at module load — make it a no-op so importing the
// script under test never touches a real `.env`.
jest.mock('dotenv', () => ({ __esModule: true, default: { config: jest.fn() } }));

// mongoose is imported for the connect/close plumbing in main(); the tests only
// drive `seedVerifierByUsername`, so a minimal stub avoids a real connection.
jest.mock('mongoose', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    connection: { close: jest.fn() },
    Types: { ObjectId: class {} },
  },
}));

import { seedVerifierByUsername } from '../set-seed-verifiers';

const USER_ID = '507f1f77bcf86cd799439011';

/** A hydrated-doc stand-in: supports `.select(...).exec()`. */
function mockUserDoc(overrides: {
  isSeedVerifier?: boolean;
  verified?: boolean;
  displayName?: string;
}) {
  return {
    _id: { toString: () => USER_ID },
    username: 'alice',
    verified: overrides.verified ?? false,
    isSeedVerifier: overrides.isSeedVerifier ?? false,
    name: { displayName: overrides.displayName },
  };
}

/** `User.findOne(...)` chain: `.select(...).exec()` → resolves `doc`. */
function findOneResolves(doc: unknown): void {
  mockUserFindOne.mockReturnValue({
    select: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    }),
  });
}

/** `PersonhoodStatus.findOne(...)` chain: `.select(...).lean()` → resolves `status`. */
function statusResolves(status: unknown): void {
  mockStatusFindOne.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(status),
    }),
  });
}

/** `User.findById(...)` chain: `.select('verified').lean()` → resolves `doc`. */
function findByIdResolves(doc: unknown): void {
  mockUserFindById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('seedVerifierByUsername', () => {
  it('seeds a fresh user (isSeedVerifier false) — writes the flag and recomputes', async () => {
    findOneResolves(mockUserDoc({ isSeedVerifier: false, displayName: 'Alice' }));
    mockUserUpdateOne.mockResolvedValue({ acknowledged: true });
    mockRecompute.mockResolvedValue({ score: 1, isRealPerson: true });
    findByIdResolves({ verified: true });

    const result = await seedVerifierByUsername('alice', false);

    expect(mockUserUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockUserUpdateOne).toHaveBeenCalledWith(
      { _id: expect.anything() },
      { $set: { isSeedVerifier: true } },
    );
    expect(mockRecompute).toHaveBeenCalledTimes(1);
    expect(mockRecompute).toHaveBeenCalledWith(USER_ID);

    expect(result.resolved).toBe(true);
    expect(result.seeded).toBe(true);
    expect(result.alreadySeeded).toBe(false);
    expect(result.userId).toBe(USER_ID);
    expect(result.displayName).toBe('Alice');
    expect(result.score).toBe(1);
    expect(result.isRealPerson).toBe(true);
    expect(result.verified).toBe(true);
  });

  it('skips an already-seeded user — no updateOne, no recompute', async () => {
    findOneResolves(mockUserDoc({ isSeedVerifier: true, verified: true }));

    const result = await seedVerifierByUsername('alice', false);

    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockRecompute).not.toHaveBeenCalled();

    expect(result.resolved).toBe(true);
    expect(result.alreadySeeded).toBe(true);
    expect(result.seeded).toBe(false);
    expect(result.verified).toBe(true);
  });

  it('resolves username → user via User.findOne({ username })', async () => {
    findOneResolves(mockUserDoc({ isSeedVerifier: true }));

    await seedVerifierByUsername('alice', false);

    expect(mockUserFindOne).toHaveBeenCalledTimes(1);
    expect(mockUserFindOne).toHaveBeenCalledWith({ username: 'alice' });
  });

  it('DRY_RUN writes nothing — reads current personhood, no updateOne/recompute', async () => {
    findOneResolves(mockUserDoc({ isSeedVerifier: false, verified: false }));
    statusResolves({ score: 0.42, isRealPerson: false });

    const result = await seedVerifierByUsername('alice', true);

    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockStatusFindOne).toHaveBeenCalledTimes(1);
    expect(mockStatusFindOne).toHaveBeenCalledWith({ userId: USER_ID });

    expect(result.resolved).toBe(true);
    expect(result.seeded).toBe(false);
    expect(result.score).toBe(0.42);
    expect(result.isRealPerson).toBe(false);
  });

  it('DRY_RUN defaults score/isRealPerson when no PersonhoodStatus doc exists', async () => {
    findOneResolves(mockUserDoc({ isSeedVerifier: false }));
    statusResolves(null);

    const result = await seedVerifierByUsername('alice', true);

    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(result.score).toBe(0);
    expect(result.isRealPerson).toBe(false);
  });

  it('returns resolved: false for an unresolved username — no writes', async () => {
    findOneResolves(null);

    const result = await seedVerifierByUsername('ghost', false);

    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockStatusFindOne).not.toHaveBeenCalled();

    expect(result.resolved).toBe(false);
    expect(result.username).toBe('ghost');
    expect(result.userId).toBeUndefined();
  });
});

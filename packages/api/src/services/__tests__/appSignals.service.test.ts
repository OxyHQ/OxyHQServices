/**
 * appSignals.service tests.
 *
 * The two new models (AppEndorsementEdge, AppUserSignal), the User model, and the
 * reputation service are mocked with a tiny in-memory store mirroring the exact
 * Mongoose subset the service uses (findOne / create / findOneAndDelete /
 * updateOne with $inc/$set/$setOnInsert+upsert, and User.findById().select().lean()).
 *
 * Coverage:
 *  - add is idempotent (re-ingesting the same edge is a no-op),
 *  - remove subtracts exactly the STORED weight (not the owner's current weight),
 *  - a zero-/floor-reputation owner contributes the influence FLOOR, not a large
 *    boost, and not zero,
 *  - the MEMBER (not the giver) is awarded, exactly once per edge,
 *  - self-endorsement and malformed ids are rejected,
 *  - interest ingest is last-write-wins.
 */

import { Types } from 'mongoose';
import { INFLUENCE_MIN } from '../../utils/reputation.constants';

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

function makeStore() {
  return { docs: [] as AnyDoc[] };
}

const edgeStore = makeStore();
const signalStore = makeStore();
const userStore = makeStore();

function clearStores(): void {
  edgeStore.docs = [];
  signalStore.docs = [];
  userStore.docs = [];
}

/** Does the document match every key in the (flat) query? ObjectId-aware. */
function matchesQuery(doc: AnyDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = doc[key];
    if (expected instanceof Types.ObjectId) {
      return actual instanceof Types.ObjectId && actual.equals(expected);
    }
    return String(actual) === String(expected);
  });
}

/** Single-document thenable for `findById(...).select(...).lean()`. */
function makeDocQuery(doc: AnyDoc | null) {
  const chain = {
    select: () => chain,
    lean: async (): Promise<AnyDoc | null> => doc,
    then: (
      onFulfilled: (value: AnyDoc | null) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(doc).then(onFulfilled, onRejected),
  };
  return chain;
}

function makeModel(store: ReturnType<typeof makeStore>) {
  return {
    async create(payload: Record<string, unknown>) {
      const doc: AnyDoc = {
        _id: (payload._id as Types.ObjectId) ?? new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...payload,
      };
      store.docs.push(doc);
      return doc;
    },
    async findOne(query: Record<string, unknown> = {}) {
      return store.docs.find((d) => matchesQuery(d, query)) ?? null;
    },
    findById(id: string | Types.ObjectId) {
      const target = id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
      const found = store.docs.find((d) => d._id.equals(target)) ?? null;
      return makeDocQuery(found);
    },
    async findOneAndDelete(query: Record<string, unknown> = {}) {
      const idx = store.docs.findIndex((d) => matchesQuery(d, query));
      if (idx === -1) return null;
      const [removed] = store.docs.splice(idx, 1);
      return removed;
    },
    async updateOne(
      query: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { upsert?: boolean } = {},
    ) {
      let doc = store.docs.find((d) => matchesQuery(d, query)) ?? null;
      const inc = (update.$inc as Record<string, number>) ?? {};
      const set = (update.$set as Record<string, unknown>) ?? {};
      const setOnInsert = (update.$setOnInsert as Record<string, unknown>) ?? {};
      if (!doc) {
        if (!options.upsert) {
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }
        doc = {
          _id: new Types.ObjectId(),
          endorsementScore: 0,
          endorsementCount: 0,
          interestScore: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...setOnInsert,
        };
        store.docs.push(doc);
      }
      for (const [field, delta] of Object.entries(inc)) {
        doc[field] = (typeof doc[field] === 'number' ? (doc[field] as number) : 0) + delta;
      }
      Object.assign(doc, set);
      doc.updatedAt = new Date();
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: doc ? 1 : 0 };
    },
  };
}

jest.mock('../../models/AppEndorsementEdge', () => ({
  __esModule: true,
  AppEndorsementEdge: makeModel(edgeStore),
  default: makeModel(edgeStore),
}));
jest.mock('../../models/AppUserSignal', () => ({
  __esModule: true,
  AppUserSignal: makeModel(signalStore),
  default: makeModel(signalStore),
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: makeModel(userStore),
  default: makeModel(userStore),
}));

const mockGetInfluence = jest.fn();
const mockAward = jest.fn();
jest.mock('../reputation.service', () => ({
  __esModule: true,
  default: {
    getInfluence: (...args: unknown[]) => mockGetInfluence(...args),
    award: (...args: unknown[]) => mockAward(...args),
  },
}));

// The global jest.setup mongoose mock omits `Types`, so restore the REAL
// mongoose here — the service and this test both need a working
// `Types.ObjectId` / `Types.ObjectId.isValid`. The models themselves are mocked
// above, so the real mongoose is used only for its id utilities.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { appSignalsService } from '../appSignals.service';

function findSignal(appId: Types.ObjectId, userId: Types.ObjectId): AnyDoc | undefined {
  return signalStore.docs.find(
    (d) =>
      (d.applicationId as Types.ObjectId).equals(appId) &&
      (d.userId as Types.ObjectId).equals(userId),
  );
}

const APP_ID = new Types.ObjectId();
const OWNER_ID = new Types.ObjectId();
const MEMBER_ID = new Types.ObjectId();

beforeEach(() => {
  clearStores();
  mockGetInfluence.mockReset();
  mockAward.mockReset();
  mockAward.mockResolvedValue({ _id: new Types.ObjectId() });
});

describe('appSignalsService.ingestEndorsements', () => {
  it('adds an edge, increments the member roll-up by the owner weight, and awards the MEMBER once', async () => {
    // Owner has a denormalized ranking weight of 2.0.
    userStore.docs.push({ _id: OWNER_ID, reputationRankWeight: 2.0 });

    const result = await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'add' },
    ]);

    expect(result).toEqual({ added: 1, removed: 0, skipped: 0, invalid: 0 });

    const signal = findSignal(APP_ID, MEMBER_ID);
    expect(signal?.endorsementScore).toBe(2.0);
    expect(signal?.endorsementCount).toBe(1);

    // The MEMBER is awarded, not the giver. Exactly once.
    expect(mockAward).toHaveBeenCalledTimes(1);
    expect(mockAward.mock.calls[0][0]).toMatchObject({
      userId: MEMBER_ID.toString(),
      actionType: 'endorsement_received',
      applicationId: APP_ID.toString(),
    });
  });

  it('is idempotent: re-ingesting the same edge is a no-op (skipped, no second award)', async () => {
    userStore.docs.push({ _id: OWNER_ID, reputationRankWeight: 2.0 });

    const edge = { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'add' as const };
    await appSignalsService.ingestEndorsements(APP_ID.toString(), [edge]);
    const second = await appSignalsService.ingestEndorsements(APP_ID.toString(), [edge]);

    expect(second).toEqual({ added: 0, removed: 0, skipped: 1, invalid: 0 });

    const signal = findSignal(APP_ID, MEMBER_ID);
    // Score did NOT double.
    expect(signal?.endorsementScore).toBe(2.0);
    expect(signal?.endorsementCount).toBe(1);
    expect(mockAward).toHaveBeenCalledTimes(1);
  });

  it('remove subtracts exactly the STORED weight even if the owner reputation changed', async () => {
    // Add at weight 2.0.
    userStore.docs.push({ _id: OWNER_ID, reputationRankWeight: 2.0 });
    await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'add' },
    ]);

    // Owner's reputation later changes to 0.5 — the remove must still subtract 2.0.
    const owner = userStore.docs.find((d) => d._id.equals(OWNER_ID));
    if (owner) owner.reputationRankWeight = 0.5;

    const removeResult = await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'remove' },
    ]);

    expect(removeResult).toEqual({ added: 0, removed: 1, skipped: 0, invalid: 0 });

    const signal = findSignal(APP_ID, MEMBER_ID);
    expect(signal?.endorsementScore).toBe(0); // 2.0 - 2.0, NOT 2.0 - 0.5
    expect(signal?.endorsementCount).toBe(0);
  });

  it('remove of a non-existent edge is a no-op (skipped)', async () => {
    const result = await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'remove' },
    ]);
    expect(result).toEqual({ added: 0, removed: 0, skipped: 1, invalid: 0 });
    expect(findSignal(APP_ID, MEMBER_ID)).toBeUndefined();
  });

  it('a zero-reputation owner (no denorm field) contributes the influence FLOOR, not a large boost and not zero', async () => {
    // No User doc → falls back to reputationService.getInfluence, which returns
    // the floor for a user with no reputation.
    mockGetInfluence.mockResolvedValue({ context: 'ranking', weight: INFLUENCE_MIN, influence: {} });

    await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'add' },
    ]);

    const signal = findSignal(APP_ID, MEMBER_ID);
    expect(signal?.endorsementScore).toBe(INFLUENCE_MIN);
    expect(signal?.endorsementScore).toBeGreaterThan(0);
    expect(signal?.endorsementScore).toBeLessThan(1);
  });

  it('a restricted owner (denorm weight floored to INFLUENCE_MIN) contributes the floor', async () => {
    userStore.docs.push({ _id: OWNER_ID, reputationRankWeight: INFLUENCE_MIN });

    await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'add' },
    ]);

    const signal = findSignal(APP_ID, MEMBER_ID);
    expect(signal?.endorsementScore).toBe(INFLUENCE_MIN);
    // getInfluence is NOT consulted when the denorm field is present.
    expect(mockGetInfluence).not.toHaveBeenCalled();
  });

  it('rejects self-endorsement and malformed ids as invalid (no award, no edge)', async () => {
    const result = await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: OWNER_ID.toString(), op: 'add' }, // self
      { ownerId: 'not-an-objectid', memberId: MEMBER_ID.toString(), op: 'add' }, // malformed
    ]);
    expect(result).toEqual({ added: 0, removed: 0, skipped: 0, invalid: 2 });
    expect(edgeStore.docs).toHaveLength(0);
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('does not fail the batch when the member award throws', async () => {
    userStore.docs.push({ _id: OWNER_ID, reputationRankWeight: 1.0 });
    mockAward.mockRejectedValueOnce(new Error('rule disabled'));

    const result = await appSignalsService.ingestEndorsements(APP_ID.toString(), [
      { ownerId: OWNER_ID.toString(), memberId: MEMBER_ID.toString(), op: 'add' },
    ]);

    // Edge + roll-up still applied despite the award failure.
    expect(result.added).toBe(1);
    expect(findSignal(APP_ID, MEMBER_ID)?.endorsementScore).toBe(1.0);
  });
});

describe('appSignalsService.ingestInterests', () => {
  it('upserts the interest score (last write wins)', async () => {
    await appSignalsService.ingestInterests(APP_ID.toString(), [
      { userId: MEMBER_ID.toString(), interestScore: 0.3 },
    ]);
    expect(findSignal(APP_ID, MEMBER_ID)?.interestScore).toBe(0.3);

    await appSignalsService.ingestInterests(APP_ID.toString(), [
      { userId: MEMBER_ID.toString(), interestScore: 0.9 },
    ]);
    expect(findSignal(APP_ID, MEMBER_ID)?.interestScore).toBe(0.9);
  });

  it('rejects a malformed user id as invalid', async () => {
    const result = await appSignalsService.ingestInterests(APP_ID.toString(), [
      { userId: 'nope', interestScore: 0.5 },
    ]);
    expect(result).toEqual({ upserted: 0, invalid: 1 });
  });
});

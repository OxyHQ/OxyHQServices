/**
 * End-to-end migration flow (karma history → reputation ledger, #217).
 *
 * Replicates the per-entry copy loop from
 * `scripts/migrate-karma-to-reputation.ts` (the script itself reads legacy
 * collections via `mongoose.connection.db` and calls `process.exit`, so it is
 * not directly importable in a unit test). Models are backed by the same kind
 * of in-memory fake used by reputation.service.test.ts. Asserts:
 *   - history entries become active transactions
 *   - the recalculated total matches the legacy `totalKarma`
 *   - a second pass writes nothing (idempotent)
 */

import { Types } from 'mongoose';
import { inferTransactionCategory } from '../../utils/reputationMigrationMapping';
import type { ReputationCategory } from '../../utils/reputation.constants';

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

const txnStore = { docs: [] as AnyDoc[] };
const balanceStore = { docs: [] as AnyDoc[] };
const ruleStore = { docs: [] as AnyDoc[] };
const disputeStore = { docs: [] as AnyDoc[] };
const userStore = { docs: [] as AnyDoc[] };

function matchesQuery(doc: AnyDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = doc[key];
    if (expected !== null && typeof expected === 'object') {
      const op = expected as Record<string, unknown>;
      if ('$ne' in op) return String(actual) !== String(op.$ne);
      if ('$gt' in op) {
        return actual instanceof Date && op.$gt instanceof Date
          ? actual.getTime() > op.$gt.getTime()
          : Number(actual) > Number(op.$gt);
      }
    }
    if (expected instanceof Types.ObjectId) {
      return actual instanceof Types.ObjectId && actual.equals(expected);
    }
    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }
    return String(actual) === String(expected);
  });
}

function makeQuery(results: AnyDoc[]) {
  let skipN = 0;
  let limitN = Number.MAX_SAFE_INTEGER;
  const chain = {
    sort: () => chain,
    skip: (n: number) => {
      skipN = n;
      return chain;
    },
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    session: () => chain,
    select: () => chain,
    populate: () => chain,
    lean: async (): Promise<AnyDoc | null> => results[0] ?? null,
    then: (
      onFulfilled: (value: AnyDoc[]) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(results.slice(skipN, skipN + limitN)).then(onFulfilled, onRejected),
  };
  return chain;
}

function makeDocQuery(doc: AnyDoc | null) {
  const chain = {
    select: () => chain,
    lean: async (): Promise<AnyDoc | null> => doc,
    then: (
      onFulfilled: (value: AnyDoc | null) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(doc).then(onFulfilled, onRejected),
  };
  return chain;
}

function makeModel(store: { docs: AnyDoc[] }) {
  return {
    async create(payload: Record<string, unknown> | Record<string, unknown>[]) {
      const arr = Array.isArray(payload) ? payload : [payload];
      const created = arr.map((data) => {
        const doc: AnyDoc = {
          _id: (data._id as Types.ObjectId) ?? new Types.ObjectId(),
          createdAt: (data.createdAt as Date) ?? new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.docs.push(doc);
        return doc;
      });
      return Array.isArray(payload) ? created : created[0];
    },
    async findOne(query: Record<string, unknown> = {}) {
      return store.docs.find((d) => matchesQuery(d, query)) ?? null;
    },
    findById(id: string | Types.ObjectId) {
      const target = id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
      return makeDocQuery(store.docs.find((d) => d._id.equals(target)) ?? null);
    },
    find(query: Record<string, unknown> = {}) {
      return makeQuery(store.docs.filter((d) => matchesQuery(d, query)));
    },
    async findOneAndUpdate(
      query: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { upsert?: boolean } = {}
    ) {
      let doc = store.docs.find((d) => matchesQuery(d, query)) ?? null;
      const set = (update.$set as Record<string, unknown>) ?? {};
      const setOnInsert = (update.$setOnInsert as Record<string, unknown>) ?? {};
      if (!doc) {
        if (!options.upsert) return null;
        doc = { _id: new Types.ObjectId(), ...setOnInsert, ...set };
        store.docs.push(doc);
      } else {
        Object.assign(doc, set);
      }
      return doc;
    },
    async countDocuments(query: Record<string, unknown> = {}) {
      return store.docs.filter((d) => matchesQuery(d, query)).length;
    },
  };
}

jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: makeModel(txnStore),
  default: makeModel(txnStore),
}));
jest.mock('../../models/ReputationBalance', () => ({
  __esModule: true,
  ReputationBalance: makeModel(balanceStore),
  default: makeModel(balanceStore),
}));
jest.mock('../../models/ReputationRule', () => ({
  __esModule: true,
  ReputationRule: makeModel(ruleStore),
  default: makeModel(ruleStore),
}));
jest.mock('../../models/ReputationDispute', () => ({
  __esModule: true,
  ReputationDispute: makeModel(disputeStore),
  default: makeModel(disputeStore),
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: makeModel(userStore),
  default: makeModel(userStore),
}));
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const startSession = jest.fn(async () => ({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  }));
  const patched = { ...actual, startSession };
  return { __esModule: true, ...patched, default: patched };
});

import reputationService from '../reputation.service';
import { ReputationTransaction } from '../../models/ReputationTransaction';

interface LegacyHistoryEntry {
  action: string;
  points: number;
  timestamp: Date;
  description?: string;
  targetContentId?: string;
}

const USER_ID = new Types.ObjectId();

/**
 * Copy one legacy karma document's history into the ledger, mirroring the
 * migration's idempotent per-entry loop. Returns the number of created txns.
 */
async function migrateKarmaHistory(
  userId: Types.ObjectId,
  history: LegacyHistoryEntry[],
  ruleCategoryByAction: Map<string, ReputationCategory>
): Promise<number> {
  let created = 0;
  for (const entry of history) {
    const createdAt = new Date(entry.timestamp);
    const duplicate = await ReputationTransaction.findOne({
      userId,
      actionType: entry.action,
      points: entry.points,
      createdAt,
    });
    if (duplicate) continue;
    await ReputationTransaction.create({
      userId,
      points: entry.points,
      actionType: entry.action,
      category: inferTransactionCategory(entry.action, entry.points, ruleCategoryByAction),
      sourceActionType: entry.action,
      targetEntityId: entry.targetContentId,
      reason: entry.description,
      status: 'active',
      createdAt,
    });
    created += 1;
  }
  return created;
}

beforeEach(() => {
  txnStore.docs = [];
  balanceStore.docs = [];
  ruleStore.docs = [];
  disputeStore.docs = [];
  userStore.docs = [];
  userStore.docs.push({ _id: USER_ID, verified: false });
});

describe('karma → reputation migration flow (#217)', () => {
  const history: LegacyHistoryEntry[] = [
    { action: 'post_created', points: 10, timestamp: new Date('2024-01-01T00:00:00Z') },
    { action: 'comment_liked', points: 5, timestamp: new Date('2024-01-02T00:00:00Z') },
    { action: 'spam_flagged', points: -8, timestamp: new Date('2024-01-03T00:00:00Z') },
  ];
  const totalKarma = history.reduce((sum, e) => sum + e.points, 0); // 7
  const rules = new Map<string, ReputationCategory>([
    ['post_created', 'content'],
    ['comment_liked', 'social'],
  ]);

  it('copies history into active transactions and the recalc total matches legacy karma', async () => {
    const created = await migrateKarmaHistory(USER_ID, history, rules);
    expect(created).toBe(3);
    expect(txnStore.docs.length).toBe(3);

    const balance = await reputationService.recalculateBalance(USER_ID);
    expect(balance.total).toBe(totalKarma);
    // negative entry without a rule → penalty category.
    const spam = txnStore.docs.find((d) => d.actionType === 'spam_flagged');
    expect(spam?.category).toBe('penalty');
  });

  it('is idempotent — a second pass creates nothing', async () => {
    await migrateKarmaHistory(USER_ID, history, rules);
    const createdOnRerun = await migrateKarmaHistory(USER_ID, history, rules);
    expect(createdOnRerun).toBe(0);
    expect(txnStore.docs.length).toBe(3);

    const balance = await reputationService.recalculateBalance(USER_ID);
    expect(balance.total).toBe(totalKarma);
  });
});

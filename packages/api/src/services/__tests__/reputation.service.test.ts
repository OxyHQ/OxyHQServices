/**
 * reputation.service tests (#217 ledger + #219 derived snapshot).
 *
 * Models and mongoose sessions are mocked with a tiny in-memory store that
 * supports exactly the operations the service performs (create / find / findOne
 * / findById / findOneAndUpdate-upsert / countDocuments / chained
 * sort/skip/limit/session/select/lean + document .save()). The pure derivation
 * formulas are covered separately in utils/__tests__/reputationDerive.test.ts;
 * here we assert ledger semantics end-to-end against the store.
 */

import { Types } from 'mongoose';

// ---------------------------------------------------------------------------
// In-memory document stores, one per collection.
// ---------------------------------------------------------------------------

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

function makeStore() {
  return { docs: [] as AnyDoc[] };
}

const txnStore = makeStore();
const balanceStore = makeStore();
const ruleStore = makeStore();
const disputeStore = makeStore();
const userStore = makeStore();

function clearStores(): void {
  txnStore.docs = [];
  balanceStore.docs = [];
  ruleStore.docs = [];
  disputeStore.docs = [];
  userStore.docs = [];
}

/** Does the document match every key in the (flat) query? */
function matchesQuery(doc: AnyDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = doc[key];
    if (expected !== null && typeof expected === 'object') {
      const op = expected as Record<string, unknown>;
      if ('$gt' in op) {
        return actual instanceof Date && op.$gt instanceof Date
          ? actual.getTime() > op.$gt.getTime()
          : Number(actual) > Number(op.$gt);
      }
      if ('$in' in op) {
        return (op.$in as unknown[]).some((v) => String(v) === String(actual));
      }
      if ('$exists' in op) {
        return (actual !== undefined) === op.$exists;
      }
      if ('$ne' in op) {
        return String(actual) !== String(op.$ne);
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

/**
 * A chainable, list-returning query mirroring the Mongoose query subset the
 * service uses. `resolve()` produces the final array honouring skip/limit; the
 * object is a proper thenable so `await query` yields that array and
 * `.lean()` yields the first element.
 */
function makeQuery(results: AnyDoc[]) {
  let skipN = 0;
  let limitN = Number.MAX_SAFE_INTEGER;
  const resolveList = (): AnyDoc[] => results.slice(skipN, skipN + limitN);
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
    ) => Promise.resolve(resolveList()).then(onFulfilled, onRejected),
  };
  return chain;
}

/**
 * A single-document thenable for `findById`. Resolves to the doc (or null) and
 * also supports `.select().lean()`.
 */
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

/** Attach a `.save()` that writes back into the owning store (idempotent). */
function attachSave(doc: AnyDoc, store: ReturnType<typeof makeStore>): AnyDoc {
  if (typeof doc.save === 'function') {
    return doc;
  }
  Object.defineProperty(doc, 'save', {
    enumerable: false,
    configurable: true,
    value: async () => {
      const idx = store.docs.findIndex((d) => d._id.equals(doc._id));
      if (idx === -1) {
        store.docs.push(doc);
      } else {
        store.docs[idx] = doc;
      }
      return doc;
    },
  });
  return doc;
}

function makeModel(store: ReturnType<typeof makeStore>) {
  return {
    async create(payload: Record<string, unknown> | Record<string, unknown>[]) {
      const arr = Array.isArray(payload) ? payload : [payload];
      const created = arr.map((data) => {
        const doc = attachSave(
          {
            _id: (data._id as Types.ObjectId) ?? new Types.ObjectId(),
            createdAt: (data.createdAt as Date) ?? new Date(),
            updatedAt: new Date(),
            ...data,
          },
          store
        );
        store.docs.push(doc);
        return doc;
      });
      return Array.isArray(payload) ? created : created[0];
    },
    async findOne(query: Record<string, unknown> = {}) {
      const found = store.docs.find((d) => matchesQuery(d, query));
      return found ? attachSave(found, store) : null;
    },
    findById(id: string | Types.ObjectId) {
      const target = id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
      const found = store.docs.find((d) => d._id.equals(target));
      const result = found ? attachSave(found, store) : null;
      // Supports both `await findById()` and `findById().select().lean()`.
      return makeDocQuery(result);
    },
    find(query: Record<string, unknown> = {}) {
      const results = store.docs
        .filter((d) => matchesQuery(d, query))
        .map((d) => attachSave(d, store));
      return makeQuery(results);
    },
    async findOneAndUpdate(
      query: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { upsert?: boolean; new?: boolean } = {}
    ) {
      let doc = store.docs.find((d) => matchesQuery(d, query)) ?? null;
      const set = (update.$set as Record<string, unknown>) ?? {};
      const setOnInsert = (update.$setOnInsert as Record<string, unknown>) ?? {};
      if (!doc) {
        if (!options.upsert) {
          return null;
        }
        doc = attachSave(
          {
            _id: new Types.ObjectId(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...setOnInsert,
            ...set,
          },
          store
        );
        store.docs.push(doc);
      } else {
        Object.assign(doc, set);
        doc.updatedAt = new Date();
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

// Mongoose: keep real Types/ObjectId/isValid, but stub startSession so the
// transactional path runs the work inline without a real DB connection. The
// service imports `mongoose` as the DEFAULT export and calls
// `mongoose.startSession()`, so the patched object MUST be the default too.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const startSession = jest.fn(async () => ({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  }));
  const patched = { ...actual, startSession };
  return {
    __esModule: true,
    ...patched,
    default: patched,
  };
});

import reputationService from '../reputation.service';
import { REPORT_CONFIRMED_ACTION, REPORT_REJECTED_ACTION } from '../../utils/reputation.constants';

const USER_ID = new Types.ObjectId().toString();
const APP_ID = new Types.ObjectId().toString();

/** Seed a rule the service can look up by actionType. */
async function seedRule(
  actionType: string,
  points: number,
  category: string,
  cooldownInMinutes = 0
): Promise<void> {
  ruleStore.docs.push({
    _id: new Types.ObjectId(),
    actionType,
    points,
    category,
    description: `${actionType} rule`,
    cooldownInMinutes,
    isEnabled: true,
  });
}

function seedUser(id: string, verified: boolean): void {
  userStore.docs.push({ _id: new Types.ObjectId(id), verified });
}

beforeEach(() => {
  clearStores();
});

describe('award (#217)', () => {
  it('a positive transaction increments the balance', async () => {
    seedUser(USER_ID, false);
    await seedRule('post_created', 5, 'content');

    await reputationService.award({ userId: USER_ID, actionType: 'post_created' });
    const balance = await reputationService.getBalance(USER_ID);

    expect(balance.total).toBe(5);
    expect(balance.positive).toBe(5);
    expect(balance.breakdown.content).toBe(5);
  });

  it('a negative transaction decrements the balance', async () => {
    seedUser(USER_ID, false);
    await seedRule('spam_flagged', -10, 'penalty');

    await reputationService.award({ userId: USER_ID, actionType: 'spam_flagged' });
    const balance = await reputationService.getBalance(USER_ID);

    expect(balance.total).toBe(-10);
    expect(balance.negative).toBe(-10);
    expect(balance.breakdown.penalties).toBe(10);
    // Negative total → restricted tier (#219).
    expect(balance.trustTier).toBe('restricted');
  });

  it('rejects an unknown or disabled action', async () => {
    seedUser(USER_ID, false);
    await expect(
      reputationService.award({ userId: USER_ID, actionType: 'nope' })
    ).rejects.toThrow(/Unknown or disabled/);
  });

  it('enforces the per-action cooldown', async () => {
    seedUser(USER_ID, false);
    await seedRule('daily_login', 1, 'social', 60);

    await reputationService.award({ userId: USER_ID, actionType: 'daily_login' });
    await expect(
      reputationService.award({ userId: USER_ID, actionType: 'daily_login' })
    ).rejects.toThrow(/cooldown/i);
  });

  it('stores applicationId/credentialId and is idempotent on (applicationId, sourceActionId)', async () => {
    seedUser(USER_ID, false);
    await seedRule('report_confirmed', 8, 'moderation');
    const credentialId = new Types.ObjectId().toString();

    const first = await reputationService.award({
      userId: USER_ID,
      actionType: 'report_confirmed',
      applicationId: APP_ID,
      credentialId,
      sourceActionId: 'src-1',
      sourceActionType: REPORT_CONFIRMED_ACTION,
    });
    const second = await reputationService.award({
      userId: USER_ID,
      actionType: 'report_confirmed',
      applicationId: APP_ID,
      credentialId,
      sourceActionId: 'src-1',
      sourceActionType: REPORT_CONFIRMED_ACTION,
    });

    expect(first._id.toString()).toBe(second._id.toString());
    expect(first.applicationId?.toString()).toBe(APP_ID);
    expect(first.credentialId?.toString()).toBe(credentialId);
    expect(txnStore.docs.length).toBe(1);

    const balance = await reputationService.getBalance(USER_ID);
    expect(balance.total).toBe(8);
  });
});

describe('recalculateBalance (#217 + #219)', () => {
  it('excludes voided; reversal pair nets to zero', async () => {
    seedUser(USER_ID, false);
    await seedRule('a', 10, 'content');
    await seedRule('b', 20, 'content');
    await seedRule('c', 30, 'content');

    const a = await reputationService.award({ userId: USER_ID, actionType: 'a' });
    const b = await reputationService.award({ userId: USER_ID, actionType: 'b' });
    await reputationService.award({ userId: USER_ID, actionType: 'c' });

    await reputationService.voidTransaction(a._id.toString(), {});
    await reputationService.reverseTransaction(b._id.toString(), {});

    const balance = await reputationService.recalculateBalance(USER_ID);
    // a (10) voided → removed; b (20) reversed pairs with its −20 reversal → 0;
    // c (30) stays. Total = 30.
    expect(balance.total).toBe(30);
    expect(balance.breakdown.content).toBe(30);
  });

  it('derives report reliability from confirmed/rejected source actions (#219)', async () => {
    seedUser(USER_ID, false);
    await seedRule('rc', 5, 'moderation');
    await seedRule('rr', 5, 'moderation');

    for (let i = 0; i < 4; i += 1) {
      await reputationService.award({
        userId: USER_ID,
        actionType: 'rc',
        applicationId: APP_ID,
        sourceActionId: `c-${i}`,
        sourceActionType: REPORT_CONFIRMED_ACTION,
      });
    }
    await reputationService.award({
      userId: USER_ID,
      actionType: 'rr',
      applicationId: APP_ID,
      sourceActionId: 'r-0',
      sourceActionType: REPORT_REJECTED_ACTION,
    });

    const balance = await reputationService.recalculateBalance(USER_ID);
    expect(balance.reliability.accurateReports).toBe(4);
    expect(balance.reliability.rejectedReports).toBe(1);
    expect(balance.reliability.reportAccuracyScore).toBeCloseTo(0.8, 5);
  });

  it('reflects User.verified in the trust tier', async () => {
    seedUser(USER_ID, true);
    await seedRule('x', 1, 'content');
    await reputationService.award({ userId: USER_ID, actionType: 'x' });

    const balance = await reputationService.recalculateBalance(USER_ID);
    expect(balance.trustTier).toBe('verified');
  });
});

describe('reverse / void (#217 never delete)', () => {
  it('reverseTransaction marks original reversed and appends a compensating txn', async () => {
    seedUser(USER_ID, false);
    await seedRule('p', 15, 'content');
    const txn = await reputationService.award({ userId: USER_ID, actionType: 'p' });

    const { original, reversal } = await reputationService.reverseTransaction(
      txn._id.toString(),
      {}
    );

    expect(original.status).toBe('reversed');
    expect(reversal.points).toBe(-15);
    expect(reversal.status).toBe('active');
    expect(reversal.reversedTransactionId?.toString()).toBe(original._id.toString());
    // Nothing deleted: original + reversal both persist.
    expect(txnStore.docs.length).toBe(2);

    const balance = await reputationService.getBalance(USER_ID);
    expect(balance.total).toBe(0);
  });

  it('voidTransaction excludes the txn from the balance with no compensating entry', async () => {
    seedUser(USER_ID, false);
    await seedRule('q', 25, 'content');
    const txn = await reputationService.award({ userId: USER_ID, actionType: 'q' });

    const voided = await reputationService.voidTransaction(txn._id.toString(), {});
    expect(voided.status).toBe('voided');
    expect(txnStore.docs.length).toBe(1); // no compensating entry

    const balance = await reputationService.getBalance(USER_ID);
    expect(balance.total).toBe(0);
  });
});

describe('disputes (#217)', () => {
  it('createDispute marks the transaction disputed', async () => {
    seedUser(USER_ID, false);
    await seedRule('d', 7, 'content');
    const txn = await reputationService.award({ userId: USER_ID, actionType: 'd' });

    const dispute = await reputationService.createDispute(
      txn._id.toString(),
      USER_ID,
      'This was wrong'
    );

    expect(dispute.status).toBe('open');
    const stored = txnStore.docs.find((d) => d._id.equals(txn._id));
    expect(stored?.status).toBe('disputed');
  });

  it('resolve-accepted reverses the disputed transaction', async () => {
    seedUser(USER_ID, false);
    await seedRule('e', 12, 'content');
    const txn = await reputationService.award({ userId: USER_ID, actionType: 'e' });
    const dispute = await reputationService.createDispute(
      txn._id.toString(),
      USER_ID,
      'wrong'
    );

    const resolverId = new Types.ObjectId().toString();
    const resolved = await reputationService.resolveDispute(dispute._id.toString(), {
      status: 'accepted',
      resolvedByUserId: resolverId,
    });

    expect(resolved.status).toBe('accepted');
    const original = txnStore.docs.find((d) => d._id.equals(txn._id));
    expect(original?.status).toBe('reversed');

    const balance = await reputationService.getBalance(USER_ID);
    expect(balance.total).toBe(0);
  });

  it('resolve-rejected restores the disputed transaction to active', async () => {
    seedUser(USER_ID, false);
    await seedRule('f', 9, 'content');
    const txn = await reputationService.award({ userId: USER_ID, actionType: 'f' });
    const dispute = await reputationService.createDispute(
      txn._id.toString(),
      USER_ID,
      'wrong'
    );

    const resolverId = new Types.ObjectId().toString();
    const resolved = await reputationService.resolveDispute(dispute._id.toString(), {
      status: 'rejected',
      resolvedByUserId: resolverId,
    });

    expect(resolved.status).toBe('rejected');
    const original = txnStore.docs.find((d) => d._id.equals(txn._id));
    expect(original?.status).toBe('active');

    const balance = await reputationService.getBalance(USER_ID);
    expect(balance.total).toBe(9);
  });
});

describe('getInfluence (#219 capped weights)', () => {
  it('returns the context-specific capped weight', async () => {
    seedUser(USER_ID, false);
    await seedRule('g', 50, 'content');
    await reputationService.award({ userId: USER_ID, actionType: 'g' });

    const def = await reputationService.getInfluence(USER_ID, 'default');
    const report = await reputationService.getInfluence(USER_ID, 'report');

    expect(def.context).toBe('default');
    expect(def.weight).toBeGreaterThanOrEqual(0.1);
    expect(def.weight).toBeLessThanOrEqual(3.0);
    expect(report.context).toBe('report');
    expect(report.weight).toBeGreaterThanOrEqual(0.1);
    expect(report.weight).toBeLessThanOrEqual(3.0);
  });

  it('floors a restricted (negative total) user to the influence minimum', async () => {
    seedUser(USER_ID, false);
    await seedRule('h', -5, 'penalty');
    await reputationService.award({ userId: USER_ID, actionType: 'h' });

    const def = await reputationService.getInfluence(USER_ID, 'default');
    expect(def.weight).toBe(0.1);
  });
});

/**
 * appSignalsService.ingestAffinityEvents tests — the interaction-affinity graph
 * ingest (Fase 2).
 *
 * The two touched models (AppAffinityEdge, AppAffinityEventSeen) are mocked with
 * a tiny in-memory store mirroring the exact Mongoose subset the service uses
 * (findOne / create / updateOne with $set/$inc/$setOnInsert + upsert, and a
 * unique-index throw on a duplicate AppAffinityEventSeen create). The decay math
 * itself is the pure `decayAffinity` from recommendationWeights (unmocked), so
 * these tests exercise the real read-modify-write.
 *
 * Coverage:
 *  - a new edge is created at the event's weight,
 *  - a second event on the same edge DECAYS the stored value then ADDS the new
 *    weight (not a naive sum, not a double-count),
 *  - a caller `weight` overrides the per-type default,
 *  - self-edges and malformed ids are rejected as invalid,
 *  - an unknown type with no override is rejected (0 weight),
 *  - a repeated `eventId` is deduped (folded at most once).
 */

import { Types } from 'mongoose';
import {
  AFFINITY_EVENT_WEIGHTS,
  AFFINITY_HALF_LIFE_MS,
  decayAffinity,
} from '../../utils/recommendationWeights';

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

function makeStore() {
  return { docs: [] as AnyDoc[] };
}

const edgeStore = makeStore();
const seenStore = makeStore();

function clearStores(): void {
  edgeStore.docs = [];
  seenStore.docs = [];
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

/**
 * A tiny in-memory model. `uniqueKeys` (when provided) makes `create` throw an
 * E11000-shaped error on a duplicate combination, faithfully modelling the
 * unique index the real collection carries — this is how the eventId dedup and
 * the create-race fallback are exercised.
 */
function makeModel(store: ReturnType<typeof makeStore>, uniqueKeys?: string[]) {
  return {
    async create(payload: Record<string, unknown>) {
      if (uniqueKeys) {
        const clash = store.docs.some((d) =>
          uniqueKeys.every((k) => {
            const a = d[k];
            const b = payload[k];
            if (a instanceof Types.ObjectId && b instanceof Types.ObjectId) {
              return a.equals(b);
            }
            return String(a) === String(b);
          }),
        );
        if (clash) {
          const err = new Error('E11000 duplicate key') as Error & { code: number };
          err.code = 11000;
          throw err;
        }
      }
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
          affinity: 0,
          eventCount: 0,
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
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
  };
}

jest.mock('../../models/AppAffinityEdge', () => ({
  __esModule: true,
  AppAffinityEdge: makeModel(edgeStore, ['applicationId', 'fromUserId', 'toUserId']),
  default: makeModel(edgeStore, ['applicationId', 'fromUserId', 'toUserId']),
}));
jest.mock('../../models/AppAffinityEventSeen', () => ({
  __esModule: true,
  AppAffinityEventSeen: makeModel(seenStore, ['applicationId', 'eventId']),
  default: makeModel(seenStore, ['applicationId', 'eventId']),
}));

// These models are imported by the service module but unused by the affinity
// path — stub them so importing the service does not crash.
jest.mock('../../models/AppUserSignal', () => ({
  __esModule: true,
  AppUserSignal: makeModel(makeStore()),
  default: makeModel(makeStore()),
}));
jest.mock('../../models/AppEndorsementEdge', () => ({
  __esModule: true,
  AppEndorsementEdge: makeModel(makeStore()),
  default: makeModel(makeStore()),
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: makeModel(makeStore()),
  default: makeModel(makeStore()),
}));
jest.mock('../reputation.service', () => ({
  __esModule: true,
  default: { getInfluence: jest.fn(), award: jest.fn() },
}));

// Restore the REAL mongoose (the global setup mock omits `Types`); the models
// are mocked above, so only the id utilities come from real mongoose.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import { appSignalsService } from '../appSignals.service';

function findEdge(
  appId: Types.ObjectId,
  fromId: Types.ObjectId,
  toId: Types.ObjectId,
): AnyDoc | undefined {
  return edgeStore.docs.find(
    (d) =>
      (d.applicationId as Types.ObjectId).equals(appId) &&
      (d.fromUserId as Types.ObjectId).equals(fromId) &&
      (d.toUserId as Types.ObjectId).equals(toId),
  );
}

const APP_ID = new Types.ObjectId();
const FROM_ID = new Types.ObjectId();
const TO_ID = new Types.ObjectId();

beforeEach(() => {
  clearStores();
});

describe('appSignalsService.ingestAffinityEvents', () => {
  it('creates a new edge at the per-type default weight', async () => {
    const result = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: FROM_ID.toString(), toUserId: TO_ID.toString(), type: 'like' },
    ]);

    expect(result).toEqual({ applied: 1, edgesCreated: 1, duplicate: 0, invalid: 0 });
    const edge = findEdge(APP_ID, FROM_ID, TO_ID);
    expect(edge?.affinity).toBe(AFFINITY_EVENT_WEIGHTS.like);
    expect(edge?.eventCount).toBe(1);
  });

  it('honors a caller weight override over the per-type default', async () => {
    await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: FROM_ID.toString(), toUserId: TO_ID.toString(), type: 'like', weight: 9 },
    ]);
    expect(findEdge(APP_ID, FROM_ID, TO_ID)?.affinity).toBe(9);
  });

  it('DECAYS the stored affinity then ADDS the new event weight (not a naive sum)', async () => {
    // First event: occurred exactly one half-life ago, weight 10.
    const halfLifeAgo = new Date(Date.now() - AFFINITY_HALF_LIFE_MS);
    await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      {
        fromUserId: FROM_ID.toString(),
        toUserId: TO_ID.toString(),
        type: 'like',
        weight: 10,
        occurredAt: halfLifeAgo.toISOString(),
      },
    ]);
    expect(findEdge(APP_ID, FROM_ID, TO_ID)?.affinity).toBe(10);

    // Second event now (weight 4). The stored 10 was set one half-life ago, so
    // it decays to ~5 on read, then +4 → ~9. A naive sum would be 14.
    await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: FROM_ID.toString(), toUserId: TO_ID.toString(), type: 'reply', weight: 4 },
    ]);

    const edge = findEdge(APP_ID, FROM_ID, TO_ID);
    const expected = decayAffinity(10, halfLifeAgo, Date.now()) + 4;
    expect(edge?.affinity as number).toBeCloseTo(expected, 1);
    expect(edge?.affinity as number).toBeLessThan(14); // proves it is NOT a naive sum
    expect(edge?.eventCount).toBe(2);
  });

  it('rejects a self-edge as invalid (no edge created)', async () => {
    const result = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: FROM_ID.toString(), toUserId: FROM_ID.toString(), type: 'like' },
    ]);
    expect(result).toEqual({ applied: 0, edgesCreated: 0, duplicate: 0, invalid: 1 });
    expect(edgeStore.docs).toHaveLength(0);
  });

  it('rejects malformed ids as invalid', async () => {
    const result = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: 'not-an-objectid', toUserId: TO_ID.toString(), type: 'like' },
    ]);
    expect(result).toEqual({ applied: 0, edgesCreated: 0, duplicate: 0, invalid: 1 });
    expect(edgeStore.docs).toHaveLength(0);
  });

  it('rejects an unknown type with no override (zero weight) as invalid', async () => {
    // The contract enum blocks unknown types at the boundary, but the service is
    // defensive: a 0-weight event never touches the edge or its decay clock.
    const result = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: FROM_ID.toString(), toUserId: TO_ID.toString(), type: 'like', weight: 0 },
    ]);
    expect(result).toEqual({ applied: 0, edgesCreated: 0, duplicate: 0, invalid: 1 });
    expect(edgeStore.docs).toHaveLength(0);
  });

  it('dedups a repeated eventId (folded at most once)', async () => {
    const event = {
      fromUserId: FROM_ID.toString(),
      toUserId: TO_ID.toString(),
      type: 'like' as const,
      eventId: 'evt_1',
    };

    const first = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [event]);
    expect(first).toEqual({ applied: 1, edgesCreated: 1, duplicate: 0, invalid: 0 });

    const second = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [event]);
    expect(second).toEqual({ applied: 0, edgesCreated: 0, duplicate: 1, invalid: 0 });

    // The affinity was NOT folded twice.
    expect(findEdge(APP_ID, FROM_ID, TO_ID)?.affinity).toBe(AFFINITY_EVENT_WEIGHTS.like);
    expect(findEdge(APP_ID, FROM_ID, TO_ID)?.eventCount).toBe(1);
  });

  it('folds multiple distinct events in one batch', async () => {
    const other = new Types.ObjectId();
    const result = await appSignalsService.ingestAffinityEvents(APP_ID.toString(), [
      { fromUserId: FROM_ID.toString(), toUserId: TO_ID.toString(), type: 'follow' },
      { fromUserId: FROM_ID.toString(), toUserId: other.toString(), type: 'like' },
    ]);
    expect(result).toEqual({ applied: 2, edgesCreated: 2, duplicate: 0, invalid: 0 });
    expect(findEdge(APP_ID, FROM_ID, TO_ID)?.affinity).toBe(AFFINITY_EVENT_WEIGHTS.follow);
    expect(findEdge(APP_ID, FROM_ID, other)?.affinity).toBe(AFFINITY_EVENT_WEIGHTS.like);
  });
});

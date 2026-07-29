/**
 * Reputation bridge tests — the phase's acceptance criteria.
 *
 * THE TWO SCENARIOS THAT DEFINE DONE, asserted directly:
 *   1. A final global infraction creates EXACTLY ONE transaction and ONE strike.
 *   2. An accepted appeal generates a compensating reversal and REMOVES the
 *      corresponding active risk.
 *
 * Plus the eight pre-effect validations, the repetition/multi-finding maths, and
 * two mutation-tested guards (see `MUTATION EVIDENCE` at the bottom of this
 * file for what was broken and what failed).
 *
 * WHY THE IN-MEMORY STORE ENFORCES UNIQUE INDEXES
 *
 * The whole idempotency argument rests on three unique indexes, not on the
 * read-then-write pre-checks. A fake store that silently accepts duplicates would
 * therefore make every idempotency test here VACUOUS — it would pass whether or
 * not the indexes exist, which is worse than having no test. So `makeModel`
 * takes an index specification and throws a real E11000 on violation:
 *
 *   - `ReputationTransaction` (applicationId, sourceActionId)
 *   - `ModerationEffect`      (incidentId, principalId, effectType, decisionRevision)
 *   - `ModerationEffect`      (eventId)
 *   - `ConductStrike`         (incidentId, userId, effectType, decisionRevision)
 *
 * The mutation tests below break the code that FEEDS those indexes and confirm
 * the assertions fail, which is what proves the store is not just going along
 * with whatever the service does.
 */

import { Types } from 'mongoose';

// ---------------------------------------------------------------------------
// In-memory document stores with real unique-index enforcement.
// ---------------------------------------------------------------------------

interface AnyDoc {
  _id: Types.ObjectId;
  [key: string]: unknown;
}

/** A unique index: the key fields, and whether a partial filter applies. */
interface UniqueIndexSpec {
  fields: string[];
  /** When true, documents missing any key field are exempt (sparse/partial). */
  partialOnPresent?: boolean;
}

function makeStore() {
  return { docs: [] as AnyDoc[] };
}

const txnStore = makeStore();
const balanceStore = makeStore();
const ruleStore = makeStore();
const disputeStore = makeStore();
const userStore = makeStore();
const strikeStore = makeStore();
const effectStore = makeStore();
const policyStore = makeStore();
const bindingStore = makeStore();
const appTrustStore = makeStore();
const personhoodStore = makeStore();
const reporterStore = makeStore();
const reviewerStore = makeStore();
const grantStore = makeStore();

function clearStores(): void {
  for (const store of [
    txnStore,
    balanceStore,
    ruleStore,
    disputeStore,
    userStore,
    strikeStore,
    effectStore,
    policyStore,
    bindingStore,
    appTrustStore,
    personhoodStore,
    reporterStore,
    reviewerStore,
    grantStore,
  ]) {
    store.docs = [];
  }
}

/** Does the document match every key in the (flat) query? */
function matchesQuery(doc: AnyDoc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = doc[key];
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Types.ObjectId)) {
      const op = expected as Record<string, unknown>;
      if ('$gt' in op) {
        return actual instanceof Date && op.$gt instanceof Date
          ? actual.getTime() > op.$gt.getTime()
          : Number(actual) > Number(op.$gt);
      }
      if ('$gte' in op) {
        return actual instanceof Date && op.$gte instanceof Date
          ? actual.getTime() >= op.$gte.getTime()
          : Number(actual) >= Number(op.$gte);
      }
      if ('$lte' in op) {
        return actual instanceof Date && op.$lte instanceof Date
          ? actual.getTime() <= op.$lte.getTime()
          : Number(actual) <= Number(op.$lte);
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
      return String(actual) === String(expected);
    }
    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }
    return String(actual) === String(expected);
  });
}

/** Chainable, list-returning query mirroring the Mongoose subset in use. */
function makeQuery(results: AnyDoc[]) {
  let skipN = 0;
  let limitN = Number.MAX_SAFE_INTEGER;
  let sortSpec: Record<string, number> | undefined;
  const resolveList = (): AnyDoc[] => {
    const out = [...results];
    if (sortSpec) {
      const [field, dir] = Object.entries(sortSpec)[0] ?? [];
      if (field) {
        out.sort((a, b) => {
          const av = a[field];
          const bv = b[field];
          const an = av instanceof Date ? av.getTime() : Number(av ?? 0);
          const bn = bv instanceof Date ? bv.getTime() : Number(bv ?? 0);
          return (an - bn) * (dir < 0 ? -1 : 1);
        });
      }
    }
    return out.slice(skipN, skipN + limitN);
  };
  const chain = {
    sort: (spec?: Record<string, number>) => {
      sortSpec = spec;
      return chain;
    },
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
    lean: async (): Promise<AnyDoc | null> => resolveList()[0] ?? null,
    then: (
      onFulfilled: (value: AnyDoc[]) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(resolveList()).then(onFulfilled, onRejected),
  };
  return chain;
}

/** Single-document thenable for `findOne` / `findById`. */
function makeDocQuery(doc: AnyDoc | null) {
  const chain = {
    select: () => chain,
    session: () => chain,
    lean: async (): Promise<AnyDoc | null> => doc,
    then: (
      onFulfilled: (value: AnyDoc | null) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(doc).then(onFulfilled, onRejected),
  };
  return chain;
}

/** Attach a `.save()` that writes back into the owning store. */
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

/** A duplicate-key error indistinguishable from Mongo's, for the caller's sake. */
function duplicateKeyError(fields: string[]): Error & { code: number } {
  const error = new Error(
    `E11000 duplicate key error collection: test index: ${fields.join('_1_')}_1`
  ) as Error & { code: number };
  error.code = 11000;
  return error;
}

function makeModel(store: ReturnType<typeof makeStore>, indexes: UniqueIndexSpec[] = []) {
  /** Throw E11000 when `data` would violate a unique index. */
  function assertUnique(data: Record<string, unknown>): void {
    for (const index of indexes) {
      if (index.partialOnPresent && index.fields.some((f) => data[f] === undefined)) {
        continue;
      }
      const clash = store.docs.some((doc) =>
        index.fields.every((f) => String(doc[f]) === String(data[f]))
      );
      if (clash) {
        throw duplicateKeyError(index.fields);
      }
    }
  }

  const model = {
    async create(
      payload: Record<string, unknown> | Record<string, unknown>[],
      _options?: unknown
    ) {
      const arr = Array.isArray(payload) ? payload : [payload];
      const created = arr.map((data) => {
        assertUnique(data);
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
    findOne(query: Record<string, unknown> = {}) {
      const found = store.docs.find((d) => matchesQuery(d, query));
      return makeDocQuery(found ? attachSave(found, store) : null);
    },
    findById(id: string | Types.ObjectId) {
      const target = id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
      const found = store.docs.find((d) => d._id.equals(target));
      return makeDocQuery(found ? attachSave(found, store) : null);
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
    async updateOne(query: Record<string, unknown>, update: Record<string, unknown>) {
      const doc = store.docs.find((d) => matchesQuery(d, query));
      if (!doc) {
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      Object.assign(doc, (update.$set as Record<string, unknown>) ?? {});
      doc.updatedAt = new Date();
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
    async countDocuments(query: Record<string, unknown> = {}) {
      return store.docs.filter((d) => matchesQuery(d, query)).length;
    },
  };
  return model;
}

// The three unique indexes the idempotency argument rests on.
const txnModel = makeModel(txnStore, [
  { fields: ['applicationId', 'sourceActionId'], partialOnPresent: true },
]);
const effectModel = makeModel(effectStore, [
  { fields: ['incidentId', 'principalId', 'effectType', 'decisionRevision'] },
  { fields: ['eventId'] },
]);
const strikeModel = makeModel(strikeStore, [
  { fields: ['incidentId', 'userId', 'effectType', 'decisionRevision'] },
]);

jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: txnModel,
  default: txnModel,
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
jest.mock('../../models/ConductStrike', () => ({
  __esModule: true,
  ConductStrike: strikeModel,
  default: strikeModel,
}));
jest.mock('../../models/ModerationEffect', () => ({
  __esModule: true,
  ModerationEffect: effectModel,
  default: effectModel,
}));
jest.mock('../../models/ModerationPolicy', () => ({
  __esModule: true,
  ModerationPolicy: makeModel(policyStore),
  default: makeModel(policyStore),
}));
jest.mock('../../models/IdentityBinding', () => ({
  __esModule: true,
  IdentityBinding: makeModel(bindingStore),
  default: makeModel(bindingStore),
}));
jest.mock('../../models/ApplicationModerationTrust', () => ({
  __esModule: true,
  ApplicationModerationTrust: makeModel(appTrustStore),
  default: makeModel(appTrustStore),
}));
jest.mock('../../models/PersonhoodStatus', () => ({
  __esModule: true,
  PersonhoodStatus: makeModel(personhoodStore),
  default: makeModel(personhoodStore),
}));
jest.mock('../../models/ReporterReputationProfile', () => ({
  __esModule: true,
  ReporterReputationProfile: makeModel(reporterStore),
  default: makeModel(reporterStore),
}));
jest.mock('../../models/ReviewerReputationProfile', () => ({
  __esModule: true,
  ReviewerReputationProfile: makeModel(reviewerStore),
  default: makeModel(reviewerStore),
}));
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: makeModel(grantStore),
  default: makeModel(grantStore),
}));

// The attestation is best-effort and non-fatal by design; stub it so the tests
// assert the CONSEQUENCE, not the signing chain. Its own privacy contract is
// covered in `civic.attestation.moderation.test.ts`.
jest.mock('../civic/attestation.service', () => ({
  __esModule: true,
  attestAward: jest.fn(async () => null),
  attestModerationEffect: jest.fn(async () => null),
}));

// Keep real Types/ObjectId, but stub startSession so the transactional path runs
// inline without a real DB.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const startSession = jest.fn(async () => ({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  }));
  const patched = { ...actual, startSession };
  return { __esModule: true, ...patched, default: patched };
});

import type { ModerationDecisionEvent, ModerationFinding } from '@oxyhq/contracts';
import moderationReputationService from '../moderationReputation.service';
import {
  BASELINE_CONDUCT_FAMILIES,
  BASELINE_MULTI_FINDING_CAP,
  BASELINE_MULTI_FINDING_SECONDARY_SHARE,
  BASELINE_OXY_CONDUCT_POLICY_VERSION,
  BASELINE_REPETITION_MULTIPLIERS,
  BASELINE_REPETITION_WINDOW_DAYS,
  BASELINE_SEVERITY_RULES,
  BASELINE_STANDING_THRESHOLDS,
  CONTEXTUAL_WEIGHT_MIN,
} from '../../utils/moderation.constants';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBJECT_ID = new Types.ObjectId().toString();
const REPORTED_APP_ID = new Types.ObjectId().toString();
const EMITTER_APP_ID = new Types.ObjectId().toString();
const EMITTER_CREDENTIAL_ID = new Types.ObjectId().toString();

const CONTEXT = {
  emitterApplicationId: EMITTER_APP_ID,
  emitterCredentialId: EMITTER_CREDENTIAL_ID,
};

/** The action happened an hour ago; bindings are seeded well before that. */
const OCCURRED_AT = new Date(Date.now() - 60 * 60 * 1000);
const BINDING_VERIFIED_AT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

let bindingId: string;

function seedUser(): void {
  userStore.docs.push({ _id: new Types.ObjectId(SUBJECT_ID), verified: false });
}

async function seedPolicy(): Promise<void> {
  await moderationReputationService.seedBaselinePolicy({
    policyVersion: BASELINE_OXY_CONDUCT_POLICY_VERSION,
    severityRules: BASELINE_SEVERITY_RULES,
    conductFamilies: BASELINE_CONDUCT_FAMILIES,
    repetitionMultipliers: BASELINE_REPETITION_MULTIPLIERS,
    repetitionWindowDays: BASELINE_REPETITION_WINDOW_DAYS,
    multiFindingSecondaryShare: BASELINE_MULTI_FINDING_SECONDARY_SHARE,
    multiFindingCap: BASELINE_MULTI_FINDING_CAP,
    standingThresholds: BASELINE_STANDING_THRESHOLDS,
  });
}

/** The reported application is permitted to produce global effects. */
function seedApplicationTrust(allowed = true): void {
  appTrustStore.docs.push({
    _id: new Types.ObjectId(),
    applicationId: new Types.ObjectId(REPORTED_APP_ID),
    standing: allowed ? 'trusted' : 'sandbox',
    globalReputationEffectsAllowed: allowed,
  });
}

/** An active binding, verified long before the reported action. */
function seedBinding(
  overrides: Partial<{
    userId: string;
    applicationId: string;
    status: string;
    verifiedAt: Date;
  }> = {}
): string {
  const id = new Types.ObjectId();
  bindingStore.docs.push({
    _id: id,
    applicationId: new Types.ObjectId(overrides.applicationId ?? REPORTED_APP_ID),
    userId: new Types.ObjectId(overrides.userId ?? SUBJECT_ID),
    localPrincipalId: 'local-42',
    bindingType: 'oauth_grant',
    status: overrides.status ?? 'active',
    verifiedAt: overrides.verifiedAt ?? BINDING_VERIFIED_AT,
  });
  return id.toString();
}

const HARASSMENT_MEDIUM: ModerationFinding = {
  code: 'harassment.targeted_abuse',
  severity: 'medium',
  scope: 'oxy_network',
  attribution: 'author',
  family: 'harassment',
};

let eventCounter = 0;

function makeEvent(overrides: Partial<ModerationDecisionEvent> = {}): ModerationDecisionEvent {
  eventCounter += 1;
  return {
    eventId: `evt_${eventCounter}`,
    reportedApplicationId: REPORTED_APP_ID,
    type: 'moderation.decision.finalized.v1',
    caseId: 'case_1',
    incidentId: 'inc_1',
    decisionId: 'dec_1',
    decisionRevision: 1,
    subject: {
      principalType: 'oxy_user',
      principalId: SUBJECT_ID,
      bindingProofId: bindingId,
    },
    findings: [HARASSMENT_MEDIUM],
    decisionStatus: 'final',
    policyVersions: {
      universal: '2026.1',
      application: 'mention.2026.07',
      oxyConduct: BASELINE_OXY_CONDUCT_POLICY_VERSION,
    },
    occurredAt: OCCURRED_AT.toISOString(),
    proofHash: 'sha256:abc',
    ...overrides,
  };
}

beforeEach(async () => {
  clearStores();
  eventCounter = 0;
  seedUser();
  await seedPolicy();
  seedApplicationTrust();
  bindingId = seedBinding();
});

// ===========================================================================
// DEFINITION OF DONE — scenario 1
// ===========================================================================

describe('DoD: a final global infraction creates exactly one transaction and one strike', () => {
  it('one event → one transaction, one strike, one effect', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent(),
      CONTEXT
    );

    expect(result.applied).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(txnStore.docs).toHaveLength(1);
    expect(strikeStore.docs).toHaveLength(1);
    expect(effectStore.docs).toHaveLength(1);

    // The figures come from the versioned policy: medium is −8 points / 3 risk.
    expect(txnStore.docs[0].points).toBe(-8);
    expect(strikeStore.docs[0].riskPoints).toBe(3);
    expect(strikeStore.docs[0].status).toBe('active');

    // And the balance's conduct axis reflects it.
    const balance = balanceStore.docs[0];
    expect(balance).toBeDefined();
    const conduct = balance.conduct as { standing: string; activeRisk: number; activeStrikes: number };
    expect(conduct.activeRisk).toBe(3);
    expect(conduct.activeStrikes).toBe(1);
    expect(conduct.standing).toBe('watch');
  });

  it('a hundred deliveries of the same event still produce one transaction and one strike', async () => {
    const event = makeEvent();
    for (let i = 0; i < 100; i += 1) {
      await moderationReputationService.applyModerationDecision(event, CONTEXT);
    }
    expect(txnStore.docs).toHaveLength(1);
    expect(strikeStore.docs).toHaveLength(1);
    expect(effectStore.docs).toHaveLength(1);
  });

  it('two DIFFERENT events for the same incident and revision still produce one of each', async () => {
    // A hundred reports collapse into one incident. Two cases, two event ids, one
    // consequence — the semantic key, not the transport key, is what decides.
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const second = await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_other', caseId: 'case_2' }),
      CONTEXT
    );

    expect(second.applied).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(txnStore.docs).toHaveLength(1);
    expect(strikeStore.docs).toHaveLength(1);
    expect(effectStore.docs).toHaveLength(1);
  });

  it('the ledger idempotency key is the LAST line of defence, not the pre-check', async () => {
    /*
     * MUTATION TARGET: `buildIdempotencyKey`.
     *
     * The pre-check on (incidentId, principalId, effectType, revision) hides the
     * key in the happy path, so a test that only replays an event proves nothing
     * about it. This one removes the effect and strike records — a partially-lost
     * write, or a second code path reaching the same incident — leaving ONLY the
     * ledger transaction. The pre-check then finds nothing, the service proceeds,
     * and the ledger's unique (applicationId, sourceActionId) is the sole thing
     * standing between the subject and a double penalty.
     *
     * Broken (key made per-event by appending `event.eventId`), this case fails:
     *   expect(txnStore.docs).toHaveLength(1)
     *   Expected length: 1, Received length: 2
     */
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    expect(txnStore.docs).toHaveLength(1);

    effectStore.docs = [];
    strikeStore.docs = [];

    await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_replay', caseId: 'case_replay' }),
      CONTEXT
    );

    // The ledger refused the second penalty and returned the original entry.
    expect(txnStore.docs).toHaveLength(1);
    expect(txnStore.docs[0].points).toBe(-8);
  });

  it('an appeal revision is its own consequence, not a duplicate of the first', async () => {
    // Revision is part of the key: a revision-2 decision may legitimately impose
    // a different consequence, so it must not be swallowed as a replay.
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const revision2 = await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_r2', decisionRevision: 2 }),
      CONTEXT
    );

    expect(revision2.idempotent).toBe(false);
    expect(effectStore.docs).toHaveLength(2);
  });
});

// ===========================================================================
// DEFINITION OF DONE — scenario 2
// ===========================================================================

describe('DoD: an accepted appeal generates a compensating reversal and removes the active risk', () => {
  it('reversal appends a compensating entry, nets the balance to zero and clears the risk', async () => {
    const applied = await moderationReputationService.applyModerationDecision(
      makeEvent(),
      CONTEXT
    );
    const effectId = applied.effect?._id.toString();
    expect(effectId).toBeDefined();

    const conductBefore = balanceStore.docs[0].conduct as { activeRisk: number; standing: string };
    expect(conductBefore.activeRisk).toBe(3);
    expect(conductBefore.standing).toBe('watch');

    const result = await moderationReputationService.reverseModerationDecision(
      'dec_1',
      1,
      'Appeal accepted: the material was quoted criticism, not abuse'
    );

    expect(result.idempotent).toBe(false);
    expect(result.reversed).toHaveLength(1);
    expect(result.reversed[0].status).toBe('reversed');
    expect(result.reversed[0].reversalTransactionId).toBeDefined();

    // COMPENSATING, not edited: the original keeps its points and is marked
    // `reversed`; a new entry with negated points is appended. The pair nets to 0.
    const original = txnStore.docs.find((d) => d.points === -8);
    const compensating = txnStore.docs.find((d) => d.points === 8);
    expect(original?.status).toBe('reversed');
    expect(compensating?.status).toBe('active');
    expect(compensating?.reversedTransactionId).toBeDefined();
    expect(txnStore.docs.reduce((sum, d) => sum + Number(d.points), 0)).toBe(0);

    // The strike stops carrying risk; the ledger history survives.
    expect(strikeStore.docs[0].status).toBe('reversed');
    expect(strikeStore.docs[0].resolvedAt).toBeDefined();

    const conductAfter = balanceStore.docs[0].conduct as {
      activeRisk: number;
      activeStrikes: number;
      standing: string;
    };
    expect(conductAfter.activeRisk).toBe(0);
    expect(conductAfter.activeStrikes).toBe(0);
    expect(conductAfter.standing).toBe('good');
  });

  it('reversing twice is idempotent — no second compensating entry', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    await moderationReputationService.reverseModerationDecision('dec_1', 1, 'Appeal accepted');
    const txnCount = txnStore.docs.length;

    const again = await moderationReputationService.reverseModerationDecision(
      'dec_1',
      1,
      'Appeal accepted'
    );
    expect(again.idempotent).toBe(true);
    expect(txnStore.docs).toHaveLength(txnCount);
  });

  it('reversing a decision that produced no effect is an error, not a silent success', async () => {
    await expect(
      moderationReputationService.reverseModerationDecision('dec_nope', 1, 'Appeal accepted')
    ).rejects.toThrow(/No moderation effect/);
  });
});

// ===========================================================================
// THE EIGHT PRE-EFFECT VALIDATIONS (§11.7)
// ===========================================================================

describe('validation 1 — the emitting credential', () => {
  it('an event with no emitting credential identity is refused', async () => {
    await expect(
      moderationReputationService.applyModerationDecision(makeEvent(), {
        emitterApplicationId: '',
      })
    ).rejects.toThrow(/service credential/i);
  });
});

describe('validation 2 — not already processed', () => {
  it('a redelivered event is answered from the stored effect', async () => {
    const event = makeEvent();
    const first = await moderationReputationService.applyModerationDecision(event, CONTEXT);
    const second = await moderationReputationService.applyModerationDecision(event, CONTEXT);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.effect?._id.toString()).toBe(first.effect?._id.toString());
  });
});

describe('validation 3 — the decision must be effective', () => {
  it('an inconclusive decision produces no effect and is NOT read as no-violation', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({ decisionStatus: 'inconclusive' }),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('decision_not_effective');
    expect(txnStore.docs).toHaveLength(0);
    expect(strikeStore.docs).toHaveLength(0);
  });

  it('a provisional decision produces no effect under the baseline policy', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({ decisionStatus: 'provisional' }),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('decision_not_effective');
    expect(txnStore.docs).toHaveLength(0);
  });

  it('a provisional decision DOES produce an effect when the policy version permits it', async () => {
    policyStore.docs[0].provisionalEffectsAllowed = true;
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({ decisionStatus: 'provisional' }),
      CONTEXT
    );
    expect(result.applied).toBe(true);
    expect(txnStore.docs).toHaveLength(1);
  });
});

describe('validation 4 — the binding proof', () => {
  /*
   * MUTATION TARGET: the `if (!binding.ok) return skip` block in
   * `applyModerationDecision`.
   *
   * This is the hole the whole phase exists to close: before it, `award` accepted
   * a bare `userId` and trusted it. Broken (the early return deleted so a failed
   * resolution falls through), EVERY case in this block fails:
   *   expect(txnStore.docs).toHaveLength(0)
   *   Expected length: 0, Received length: 1
   * — and `expect(result.skipReason).toBe('no_binding_proof')` receives
   * `undefined`, so the failure names the guard directly.
   */

  it('NO binding proof, NO effect', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        subject: {
          principalType: 'oxy_user',
          principalId: SUBJECT_ID,
          bindingProofId: new Types.ObjectId().toString(),
        },
      }),
      CONTEXT
    );

    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('no_binding_proof');
    expect(txnStore.docs).toHaveLength(0);
    expect(strikeStore.docs).toHaveLength(0);
    expect(effectStore.docs).toHaveLength(0);
  });

  it('a binding created AFTER the reported action proves nothing', async () => {
    // Presence now is not presence then. This is the check most easily mistaken
    // for decoration.
    const lateBinding = seedBinding({ verifiedAt: new Date() });
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        subject: {
          principalType: 'oxy_user',
          principalId: SUBJECT_ID,
          bindingProofId: lateBinding,
        },
      }),
      CONTEXT
    );

    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('binding_after_action');
    expect(txnStore.docs).toHaveLength(0);
  });

  it('a binding for a DIFFERENT person cannot penalise this one', async () => {
    const otherUser = new Types.ObjectId().toString();
    userStore.docs.push({ _id: new Types.ObjectId(otherUser), verified: false });
    const otherBinding = seedBinding({ userId: otherUser });

    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        subject: {
          principalType: 'oxy_user',
          principalId: SUBJECT_ID,
          bindingProofId: otherBinding,
        },
      }),
      CONTEXT
    );

    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('binding_principal_mismatch');
    expect(txnStore.docs).toHaveLength(0);
  });

  it('a revoked binding cannot carry a new consequence', async () => {
    const revoked = seedBinding({ status: 'revoked' });
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        subject: {
          principalType: 'oxy_user',
          principalId: SUBJECT_ID,
          bindingProofId: revoked,
        },
      }),
      CONTEXT
    );

    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('binding_revoked');
    expect(txnStore.docs).toHaveLength(0);
  });

  it("a binding belonging to ANOTHER application is not this application's proof", async () => {
    // The emitter cannot borrow a proof from a tenant it does not speak for: the
    // lookup is scoped by application, so a foreign id is simply not found.
    const foreignBinding = seedBinding({
      applicationId: new Types.ObjectId().toString(),
    });
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        subject: {
          principalType: 'oxy_user',
          principalId: SUBJECT_ID,
          bindingProofId: foreignBinding,
        },
      }),
      CONTEXT
    );

    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('no_binding_proof');
    expect(txnStore.docs).toHaveLength(0);
  });
});

describe('validation 5 — the finding must reach the network', () => {
  it('an application-local finding produces no global effect', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [{ ...HARASSMENT_MEDIUM, scope: 'application_local' }],
      }),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('finding_scope_local');
    expect(txnStore.docs).toHaveLength(0);
  });

  it('an identity-integrity finding does reach the network', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [
          {
            ...HARASSMENT_MEDIUM,
            scope: 'identity_integrity',
            family: 'impersonation',
            code: 'impersonation.account',
          },
        ],
      }),
      CONTEXT
    );
    expect(result.applied).toBe(true);
    expect(txnStore.docs).toHaveLength(1);
  });
});

describe('validation 6 — the policy version must recognise the finding', () => {
  it('an unknown policy version is refused rather than falling back to the current one', async () => {
    // A fallback would apply today's tuning to a decision made under another,
    // which is precisely what versioning exists to prevent.
    await expect(
      moderationReputationService.applyModerationDecision(
        makeEvent({
          policyVersions: {
            universal: '2026.1',
            application: 'mention.2026.07',
            oxyConduct: 'oxy.2099.9',
          },
        }),
        CONTEXT
      )
    ).rejects.toThrow(/Unknown Oxy conduct policy version/);
    expect(txnStore.docs).toHaveLength(0);
  });

  it('a conduct family the policy version does not recognise produces no effect', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [{ ...HARASSMENT_MEDIUM, family: 'astrology', code: 'astrology.bad_takes' }],
      }),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('finding_not_in_policy');
    expect(txnStore.docs).toHaveLength(0);
  });
});

describe('validation 7 — one effect per incident', () => {
  it('the semantic key holds even when the transport key differs', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_z', caseId: 'case_z', decisionId: 'dec_1' }),
      CONTEXT
    );
    expect(effectStore.docs).toHaveLength(1);
  });

  it('two different people in one incident each get their own consequence', async () => {
    const sharer = new Types.ObjectId().toString();
    userStore.docs.push({ _id: new Types.ObjectId(sharer), verified: false });
    const sharerBinding = seedBinding({ userId: sharer });

    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const second = await moderationReputationService.applyModerationDecision(
      makeEvent({
        eventId: 'evt_sharer',
        subject: {
          principalType: 'oxy_user',
          principalId: sharer,
          bindingProofId: sharerBinding,
        },
        findings: [{ ...HARASSMENT_MEDIUM, attribution: 'sharer' }],
      }),
      CONTEXT
    );

    expect(second.applied).toBe(true);
    expect(second.idempotent).toBe(false);
    expect(effectStore.docs).toHaveLength(2);
    expect(txnStore.docs).toHaveLength(2);
  });
});

describe('validation 8 — a superseded revision produces nothing', () => {
  it('a superseded decision does not resurrect a consequence an appeal removed', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({ decisionStatus: 'superseded' }),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('decision_superseded');
    expect(txnStore.docs).toHaveLength(0);
  });

  it('a corrected decision likewise produces nothing', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({ decisionStatus: 'corrected' }),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('decision_superseded');
  });
});

describe('application trust gate (§11.13)', () => {
  it('a sandboxed application moderates locally and produces no global effect', async () => {
    appTrustStore.docs = [];
    seedApplicationTrust(false);
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent(),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('application_not_permitted');
    expect(txnStore.docs).toHaveLength(0);
  });

  it('an application with NO trust document fails safe — local only', async () => {
    // The failure mode of forgetting to configure an application must be "it
    // touches nothing global", not "it can penalise arbitrary Oxy users".
    appTrustStore.docs = [];
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent(),
      CONTEXT
    );
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('application_not_permitted');
    expect(txnStore.docs).toHaveLength(0);
  });
});

// ===========================================================================
// REPETITION, CAPS AND EXPIRY (§11.9, §11.10)
// ===========================================================================

describe('repetition and multi-finding caps', () => {
  it('a first similar incident carries no multiplier', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent(),
      CONTEXT
    );
    expect(result.effect?.repetitionMultiplier).toBe(1);
    expect(result.effect?.points).toBe(-8);
  });

  it('a second similar incident escalates by the policy multiplier', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const second = await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_2', incidentId: 'inc_2', decisionId: 'dec_2' }),
      CONTEXT
    );
    expect(second.effect?.repetitionMultiplier).toBe(1.5);
    expect(second.effect?.points).toBe(-12);
    expect(second.effect?.activeRisk).toBe(5); // round(3 × 1.5)
  });

  it('a REVERSED prior strike is not a prior offence', async () => {
    // A decision that was overturned must not escalate the next one.
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    await moderationReputationService.reverseModerationDecision('dec_1', 1, 'Appeal accepted');

    const next = await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_2', incidentId: 'inc_2', decisionId: 'dec_2' }),
      CONTEXT
    );
    expect(next.effect?.repetitionMultiplier).toBe(1);
  });

  it('a prior incident in a DIFFERENT conduct family does not escalate', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const other = await moderationReputationService.applyModerationDecision(
      makeEvent({
        eventId: 'evt_2',
        incidentId: 'inc_2',
        decisionId: 'dec_2',
        findings: [{ ...HARASSMENT_MEDIUM, family: 'spam', code: 'spam.bulk' }],
      }),
      CONTEXT
    );
    expect(other.effect?.repetitionMultiplier).toBe(1);
  });

  it('escalation is bounded by the last multiplier in the policy', async () => {
    for (let i = 1; i <= 6; i += 1) {
      await moderationReputationService.applyModerationDecision(
        makeEvent({ eventId: `evt_${i}`, incidentId: `inc_${i}`, decisionId: `dec_${i}` }),
        CONTEXT
      );
    }
    const last = effectStore.docs[effectStore.docs.length - 1];
    const ceiling = BASELINE_REPETITION_MULTIPLIERS[BASELINE_REPETITION_MULTIPLIERS.length - 1];
    expect(last.repetitionMultiplier).toBe(ceiling);
  });

  it('secondary findings add at most their share, and the total is capped', async () => {
    // Five effective findings would be 1 + 4×0.25 = 2.0 uncapped; the policy caps
    // at 1.5, so stacking taxonomy labels cannot manufacture a sanction.
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [
          HARASSMENT_MEDIUM,
          { ...HARASSMENT_MEDIUM, code: 'harassment.b', severity: 'low' },
          { ...HARASSMENT_MEDIUM, code: 'harassment.c', severity: 'low' },
          { ...HARASSMENT_MEDIUM, code: 'harassment.d', severity: 'low' },
          { ...HARASSMENT_MEDIUM, code: 'harassment.e', severity: 'low' },
        ],
      }),
      CONTEXT
    );
    expect(result.effect?.multiFindingMultiplier).toBe(BASELINE_MULTI_FINDING_CAP);
    expect(result.effect?.points).toBe(-12); // round(-8 × 1.5)
  });

  it('the primary finding is the most severe one', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [
          { ...HARASSMENT_MEDIUM, severity: 'low', code: 'harassment.mild' },
          { ...HARASSMENT_MEDIUM, severity: 'high', code: 'harassment.severe' },
        ],
      }),
      CONTEXT
    );
    expect(result.effect?.severity).toBe('high');
    // high is −20 / risk 8, with a 1.25 multi-finding multiplier for one secondary.
    expect(result.effect?.points).toBe(-25);
  });

  it('a critical finding restricts standing outright', async () => {
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [{ ...HARASSMENT_MEDIUM, severity: 'critical', family: 'child_safety', code: 'child_safety.csam' }],
      }),
      CONTEXT
    );
    expect(result.effect?.activeRisk).toBe(20);
    const conduct = balanceStore.docs[0].conduct as { standing: string };
    expect(conduct.standing).toBe('restricted');
  });
});

describe('expiry (§11.10)', () => {
  it('a lapsed strike stops carrying risk while its ledger entry survives', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    // Wind the expiry back so the sweep is due.
    strikeStore.docs[0].expiresAt = new Date(Date.now() - 1000);

    const result = await moderationReputationService.expireConductStrikes(100);
    expect(result.expired).toBe(1);
    expect(strikeStore.docs[0].status).toBe('expired');

    // The consequence decayed; the history did not.
    expect(txnStore.docs).toHaveLength(1);
    expect(txnStore.docs[0].points).toBe(-8);
    const conduct = balanceStore.docs[0].conduct as { activeRisk: number; standing: string };
    expect(conduct.activeRisk).toBe(0);
    expect(conduct.standing).toBe('good');
  });

  it('a critical strike has no expiry and is never swept', async () => {
    await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [{ ...HARASSMENT_MEDIUM, severity: 'critical', family: 'child_safety', code: 'child_safety.csam' }],
      }),
      CONTEXT
    );
    expect(strikeStore.docs[0].expiresAt).toBeUndefined();

    const result = await moderationReputationService.expireConductStrikes(100);
    expect(result.expired).toBe(0);
    expect(strikeStore.docs[0].status).toBe('active');
  });

  it('a not-yet-due strike is left alone', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const result = await moderationReputationService.expireConductStrikes(100);
    expect(result.expired).toBe(0);
    expect(strikeStore.docs[0].status).toBe('active');
  });
});

// ===========================================================================
// CONTRIBUTION NEVER CANCELS CONDUCT (§11.4)
// ===========================================================================

describe('contribution points never cancel an active strike', () => {
  /** Award `points` of legitimate, non-conduct contribution to the subject. */
  function seedContribution(points: number): void {
    txnStore.docs.push({
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(SUBJECT_ID),
      points,
      actionType: 'real_life_attested',
      category: 'physical',
      status: 'active',
      createdAt: new Date(),
    });
  }

  it('a high contribution tier and a limited standing coexist, exactly as the model intends', async () => {
    await moderationReputationService.applyModerationDecision(
      makeEvent({ findings: [{ ...HARASSMENT_MEDIUM, severity: 'high' }] }),
      CONTEXT
    );
    const before = balanceStore.docs[0].conduct as { activeRisk: number; standing: string };
    expect(before.standing).toBe('limited');

    seedContribution(5000);
    const reputationService = (await import('../reputation.service')).default;
    const balance = await reputationService.recalculateBalance(SUBJECT_ID);

    // THE PAIR the multidimensional model exists to make representable: a long
    // genuine contribution history AND an active consequence, reported side by
    // side rather than netted into one number.
    expect(balance.contribution.tier).toBe('high_trust');
    expect(balance.contribution.points).toBe(5000);

    // Conduct did not move an inch. No amount of contribution reduces active
    // risk or improves standing — only expiry or reversal can.
    expect(balance.conduct.activeRisk).toBe(8);
    expect(balance.conduct.standing).toBe('limited');
    expect(balance.conduct.activeStrikes).toBe(1);
  });

  it('contribution CANNOT buy off a restricted standing', async () => {
    // The stronger half of the invariant. A restricted standing forces the legacy
    // tier to match no matter how large the total, so a consumer that only knows
    // about `trustTier` cannot be told the account is unremarkable.
    await moderationReputationService.applyModerationDecision(
      makeEvent({
        findings: [
          { ...HARASSMENT_MEDIUM, severity: 'critical', family: 'child_safety', code: 'child_safety.csam' },
        ],
      }),
      CONTEXT
    );
    expect((balanceStore.docs[0].conduct as { standing: string }).standing).toBe('restricted');

    seedContribution(50_000);
    const reputationService = (await import('../reputation.service')).default;
    const balance = await reputationService.recalculateBalance(SUBJECT_ID);

    expect(balance.contribution.tier).toBe('high_trust');
    expect(balance.conduct.standing).toBe('restricted');
    expect(balance.conduct.activeRisk).toBe(20);
    expect(balance.trustTier).toBe('restricted');
    // Every contextual weight is floored, so a restricted account is neither
    // drawn for review nor prioritised as a reporter.
    expect(balance.contextualInfluence.reviewSelectionWeight).toBe(CONTEXTUAL_WEIGHT_MIN);
  });

  it('the conduct penalty stays in the total, so the ledger remains honest', async () => {
    // Contribution EXCLUDES the penalty; `total` does not. The ledger says what
    // happened; the axes say what it means.
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    seedContribution(100);

    const reputationService = (await import('../reputation.service')).default;
    const balance = await reputationService.recalculateBalance(SUBJECT_ID);

    expect(balance.total).toBe(92); // 100 − 8
    expect(balance.contribution.points).toBe(100);
  });
});

// ===========================================================================
// RECONCILIATION
// ===========================================================================

describe('reconcileModerationIncident', () => {
  it('a healthy incident is examined and nothing is written', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const result = await moderationReputationService.reconcileModerationIncident('inc_1');
    expect(result.effectsExamined).toBe(1);
    expect(result.strikesRepaired).toBe(0);
    expect(result.supersededReversed).toBe(0);
  });

  it('repairs an effect whose strike never landed', async () => {
    // Points deducted, standing unmoved — silent, and nothing but a
    // reconciliation pass ever notices.
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    strikeStore.docs = [];

    const result = await moderationReputationService.reconcileModerationIncident('inc_1');
    expect(result.strikesRepaired).toBe(1);
    expect(strikeStore.docs).toHaveLength(1);
    expect(strikeStore.docs[0].riskPoints).toBe(3);

    const conduct = balanceStore.docs[0].conduct as { activeRisk: number };
    expect(conduct.activeRisk).toBe(3);
  });

  it('reverses a consequence a later revision superseded', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    await moderationReputationService.applyModerationDecision(
      makeEvent({ eventId: 'evt_r2', decisionRevision: 2, decisionId: 'dec_1' }),
      CONTEXT
    );

    const result = await moderationReputationService.reconcileModerationIncident('inc_1');
    expect(result.supersededReversed).toBe(1);

    const revision1 = effectStore.docs.find((d) => d.decisionRevision === 1);
    expect(revision1?.status).toBe('reversed');
  });
});

// ===========================================================================
// FINALIZE
// ===========================================================================

describe('finalizeModerationDecision', () => {
  it('re-derives the snapshot from the durable effect and strike', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    // Simulate a lost snapshot write.
    balanceStore.docs = [];

    const effects = await moderationReputationService.finalizeModerationDecision('dec_1', 1);
    expect(effects).toHaveLength(1);
    const conduct = balanceStore.docs[0].conduct as { activeRisk: number };
    expect(conduct.activeRisk).toBe(3);
  });

  it('cannot conjure a consequence from a decision id alone', async () => {
    await expect(
      moderationReputationService.finalizeModerationDecision('dec_never', 1)
    ).rejects.toThrow(/No moderation effect/);
    expect(txnStore.docs).toHaveLength(0);
  });
});

// ===========================================================================
// THE SERVICE DOES NOT TRUST ITS CALLER
// ===========================================================================

describe('query inputs are coerced at the service boundary', () => {
  /*
   * The route validates the body with zod, so an object where a string belongs is
   * already rejected there. These cases exist because every method here is
   * EXPORTED: a queue worker, a reconciliation script or a future caller is under
   * no obligation to have passed through that gate, and a Mongo filter handed
   * `{ $ne: null }` where it expects an id matches EVERY document. The coercion
   * therefore lives where the query lives.
   *
   * `as never` is how a test reaches a shape the type system exists to forbid —
   * that is the point: the runtime must hold even when the types were bypassed.
   */

  it('an operator object in eventId cannot make the replay check match an unrelated effect', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    expect(effectStore.docs).toHaveLength(1);

    // Uncoerced, `findOne({ eventId: { $ne: null } })` would match the effect
    // above and report a successful idempotent replay of a DIFFERENT incident.
    const result = await moderationReputationService.applyModerationDecision(
      makeEvent({
        eventId: { $ne: null } as never,
        incidentId: 'inc_unrelated',
        decisionId: 'dec_unrelated',
      }),
      CONTEXT
    );
    expect(result.idempotent).toBe(false);
  });

  it('a malformed decisionRevision is rejected rather than silently matching nothing', async () => {
    // A `NaN` revision would match no document, so a reversal would report "no
    // effect exists" and send an operator looking for a missing effect instead of
    // a malformed request.
    await expect(
      moderationReputationService.applyModerationDecision(
        makeEvent({ decisionRevision: 'not-a-number' as never }),
        CONTEXT
      )
    ).rejects.toThrow(/decisionRevision must be a positive integer/);
    expect(txnStore.docs).toHaveLength(0);
  });

  it('a malformed occurredAt is rejected rather than defeating the binding time check', async () => {
    // An invalid date yields `NaN`, and every comparison against `NaN` is false —
    // which would make `verifiedAt > occurredAt` false and wave a late binding
    // straight through the one check that proves presence.
    await expect(
      moderationReputationService.applyModerationDecision(
        makeEvent({ occurredAt: 'not-a-date' }),
        CONTEXT
      )
    ).rejects.toThrow(/occurredAt must be a valid ISO 8601 timestamp/);
    expect(txnStore.docs).toHaveLength(0);
  });

  it('an operator object in decisionId cannot reverse an unrelated decision', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);

    await expect(
      moderationReputationService.reverseModerationDecision(
        { $ne: null } as never,
        1,
        'Appeal accepted'
      )
    ).rejects.toThrow(/No moderation effect/);

    // The real effect is untouched: nothing was compensated.
    expect(effectStore.docs[0].status).toBe('applied');
    expect(strikeStore.docs[0].status).toBe('active');
    expect(txnStore.docs).toHaveLength(1);
  });

  it('an operator object in the conduct family cannot inflate the repetition multiplier', async () => {
    // Uncoerced, `find({ family: { $ne: null } })` would count EVERY prior strike
    // as a similar incident and escalate the penalty for an unrelated family.
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);

    const second = await moderationReputationService.applyModerationDecision(
      makeEvent({
        eventId: 'evt_2',
        incidentId: 'inc_2',
        decisionId: 'dec_2',
        findings: [{ ...HARASSMENT_MEDIUM, family: { $ne: null } as never }],
      }),
      CONTEXT
    );

    // The family is not one the policy recognises, so it produces nothing at all
    // — and in particular it does not reach the repetition lookup.
    expect(second.applied).toBe(false);
    expect(second.skipReason).toBe('finding_not_in_policy');
    expect(effectStore.docs).toHaveLength(1);
  });
});

// ===========================================================================
// PRIVACY OF THE LEDGER ROW (§11.17, §11.18)
// ===========================================================================

describe('what a conduct transaction is allowed to know', () => {
  it('the ledger row carries the severity and family, never the taxonomy code', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const metadata = txnStore.docs[0].metadata as Record<string, unknown>;

    expect(metadata.severity).toBe('medium');
    expect(metadata.family).toBe('harassment');
    // The ledger is readable by its subject; a sanction row must explain itself
    // without becoming a dossier.
    expect(JSON.stringify(metadata)).not.toContain('targeted_abuse');
    expect(metadata).not.toHaveProperty('reporterId');
    expect(metadata).not.toHaveProperty('victimId');
  });

  it('the policy version is recorded so the figure stays recomputable', async () => {
    await moderationReputationService.applyModerationDecision(makeEvent(), CONTEXT);
    const metadata = txnStore.docs[0].metadata as Record<string, unknown>;
    expect(metadata.policyVersion).toBe(BASELINE_OXY_CONDUCT_POLICY_VERSION);
  });
});

/*
 * ===========================================================================
 * MUTATION EVIDENCE
 * ===========================================================================
 *
 * Both load-bearing guards were broken and the suite re-run, to confirm the
 * assertions are not vacuous. Verbatim results:
 *
 * (1) THE IDEMPOTENCY KEY — `buildIdempotencyKey` in
 *     `moderationReputation.service.ts`, mutated to append `event.eventId` so
 *     each delivery gets its own key:
 *
 *       ● DoD: a final global infraction … › the ledger idempotency key is the
 *         LAST line of defence, not the pre-check
 *         expect(received).toHaveLength(expected)
 *         Expected length: 1
 *         Received length: 2
 *
 *     One incident, two ledger penalties. The named test is exactly the one
 *     written to cover that guard.
 *
 * (2) THE BINDING CHECK — the `if (!binding.ok) { return { applied: false, … } }`
 *     block deleted so a failed resolution falls through, with `bindingId` taken
 *     from the event's claimed `bindingProofId` (what a trusting implementation
 *     would have done):
 *
 *       ● validation 4 — the binding proof › NO binding proof, NO effect
 *         expect(received).toBe(expected) // Object.is equality
 *         Expected: false
 *         Received: true
 *         > 812 |     expect(result.applied).toBe(false);
 *       ● validation 4 … › a binding created AFTER the reported action proves nothing
 *       ● validation 4 … › a binding for a DIFFERENT person cannot penalise this one
 *       ● validation 4 … › a revoked binding cannot carry a new consequence
 *       ● validation 4 … › a binding belonging to ANOTHER application is not this
 *         application's proof
 *
 *       Tests: 5 failed, 44 passed, 49 total
 *
 *     All five cases in the block fail, each naming the guard.
 *
 * (3) THE BOUNDARY COERCION — `readEventIdentifiers` mutated to pass identifiers
 *     through raw, the `occurredAt` validity check deleted, and the `family` /
 *     `decisionId` coercions removed, i.e. exactly what a trusting implementation
 *     looks like:
 *
 *       ● query inputs are coerced … › an operator object in eventId cannot make
 *         the replay check match an unrelated effect
 *       ● query inputs are coerced … › a malformed decisionRevision is rejected
 *         rather than silently matching nothing
 *       ● query inputs are coerced … › a malformed occurredAt is rejected rather
 *         than defeating the binding time check
 *       ● query inputs are coerced … › an operator object in decisionId cannot
 *         reverse an unrelated decision
 *
 *       Tests: 4 failed, 50 passed, 54 total
 *
 * With all three guards in place: 54 passed, 54 total.
 */

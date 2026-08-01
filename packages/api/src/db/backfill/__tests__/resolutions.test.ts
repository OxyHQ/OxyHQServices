/**
 * The two documented resolutions, and the audit false positive, against a REAL
 * MongoDB and a REAL Postgres.
 *
 * These decisions are the reason a production data migration is allowed to
 * start at all, so they are held to the standard the rest of this directory is:
 * seed the shape production actually holds, run the real backfill, and read
 * what arrived — never a unit test of the predicate in isolation, which would
 * prove the predicate agrees with itself.
 *
 * ## What each block has to establish, and the mutation that proves it can fail
 *
 * 1. **The card rule is NARROW.** A corrupt card degrades to a null card with
 *    the message preserved and reported by id — AND a valid card survives with
 *    all four columns intact. Mutation: widen the rule so it fires on a valid
 *    card, and `keeps a VALID card completely intact` goes red naming the
 *    column it lost.
 * 2. **The duplicate resolver keeps the NEWEST.** Mutation: make it keep the
 *    oldest, and `keeps the MOST RECENT request of a group` goes red naming
 *    the id that should have survived.
 * 3. **A null in a nullable enum-checked column does not block, and an
 *    out-of-set value still does.** Both halves, because a check that only
 *    asserts the first would pass against an audit that reports nothing at all.
 *
 * Both resolutions must also be VISIBLE: the counts and the ids ride in the
 * run summary, so an operator can confirm the decision was applied as stated.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { connectPostgres, closePostgres, type Database } from '../../../config/postgres';
import { createTestDatabase, dropTestDatabase } from '../../testDatabase';
import { messages, validationRequests } from '../../schema';
import {
  cleanFixtures,
  dirtyFixtures,
  DUP_REQUEST_MIDDLE,
  DUP_REQUEST_NEWEST,
  DUP_REQUEST_OLDEST,
  DUP_UNTIMED_NEWER,
  DUP_UNTIMED_OLDER,
  DUPLICATE_ACTION_KEY,
  DUPLICATE_ACTION_KEY_UNTIMED,
  MESSAGE,
  MESSAGE_CORRUPT_CARD,
  MESSAGE_VALID_CARD,
  resolvableFixtures,
  type FixtureSet,
} from '../backfillFixtures';
import { COLLECTION_PLANS } from '../collectionMap';
import { createMongoTestDatabase, type MongoTestDatabase } from '../mongoTestSource';
import { planTables, tableName } from '../plan';
import {
  DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS,
  DEMOTED_VALIDATION_REQUEST_STATUS,
  DROP_UNRENDERABLE_MESSAGE_CARD,
  objectIdTimestamp,
  planResolutions,
} from '../resolutions';
import { AuditBlockedError, runBackfill, type RunSummary } from '../runner';
import { verifyBackfill } from '../verify';

jest.setTimeout(300_000);

let db: Database;
let sharedDatabaseUrl: string | undefined;
let ownDatabaseUrl: string;

// Owns its own throwaway database, for the same reason `roundTrip.test.ts`
// does: it truncates every table the plans write, and a truncate is not
// something a neighbouring suite survives.
beforeAll(async () => {
  sharedDatabaseUrl = process.env.DATABASE_URL;
  ownDatabaseUrl = await createTestDatabase();
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
  await dropTestDatabase(ownDatabaseUrl);
  process.env.DATABASE_URL = sharedDatabaseUrl;
});

async function seed(fixtures: FixtureSet): Promise<MongoTestDatabase> {
  const mongo = await createMongoTestDatabase();
  for (const [collection, documents] of Object.entries(fixtures)) {
    await mongo.seed(collection, documents);
  }
  return mongo;
}

async function truncateAll(): Promise<void> {
  const names = new Set<string>();
  for (const plan of COLLECTION_PLANS) {
    for (const table of planTables(plan)) names.add(`"${tableName(table)}"`);
  }
  await db.execute(sql.raw(`truncate table ${[...names].join(', ')} cascade`));
}

/** The applied summary for one rule, by id. */
function applied(summary: RunSummary, ruleId: string) {
  const entry = summary.resolutions.find((candidate) => candidate.rule.id === ruleId);
  if (entry === undefined) {
    throw new Error(
      `The run summary carries no entry for rule ${ruleId}. Every declared rule ` +
        'must be reported, including one that changed nothing.'
    );
  }
  return entry;
}

describe('documented resolutions are applied, and reported', () => {
  let mongo: MongoTestDatabase;
  let summary: RunSummary;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(resolvableFixtures());
    summary = await runBackfill({ db, source: mongo.source, batchSize: 3 });
  });

  afterAll(async () => {
    await mongo.drop();
  });

  // -------------------------------------------------------------------------
  // the audit still reports, it just no longer blocks
  // -------------------------------------------------------------------------

  it('REPORTS both findings and names the rule that answers each', () => {
    const resolved = summary.findings.filter((finding) => finding.resolvedBy !== undefined);
    // Neither finding was silenced: both rules are still computed, counted and
    // carried in the summary — with the rule attached. THREE findings, because
    // the uniqueness audit reports one per colliding GROUP and the fixtures
    // hold two of them.
    expect(resolved).toHaveLength(3);
    expect([...new Set(resolved.map((finding) => finding.resolvedBy?.id))].sort()).toEqual([
      DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS.id,
      DROP_UNRENDERABLE_MESSAGE_CARD.id,
    ]);

    // …and NOTHING else in this fixture set blocks, so the copy ran.
    expect(summary.findings.filter((finding) => finding.resolvedBy === undefined)).toEqual([]);

    const card = resolved.find((finding) => finding.collection === 'messages');
    expect(card?.detail).toContain('messages.card.type');
    expect(card?.sampleIds).toContain(MESSAGE_CORRUPT_CARD);

    const duplicates = resolved.filter((finding) => finding.kind === 'uniqueness');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((finding) => finding.detail).join('\n')).toContain(
      'validation_requests_open_source_action_key'
    );
  });

  // -------------------------------------------------------------------------
  // finding 1 — drop the card, keep the message
  // -------------------------------------------------------------------------

  it('writes the corrupt-card message with a NULL card and its body intact', async () => {
    const [row] = await db.select().from(messages).where(eq(messages.id, MESSAGE_CORRUPT_CARD));

    // The message survived. This is the half that matters most: refusing the
    // row would have lost a real message.
    expect(row?.subject).toBe('Your trip is confirmed');
    expect(row?.text).toBe('The body of this message is intact and must survive.');

    // …and the card is gone WHOLE. `messages_card_complete_check` asserts all
    // four are set or all four are null, so a partial drop would not even
    // insert.
    expect(row?.cardType).toBeNull();
    expect(row?.cardData).toBeNull();
    expect(row?.cardConfidence).toBeNull();
    expect(row?.cardExtractedAt).toBeNull();
  });

  it('keeps a VALID card completely intact — the rule fires on nothing else', async () => {
    // THE CONTROL, and the assertion the "widen the card rule" mutation breaks.
    // Every one of the four columns is checked, because a rule that fired here
    // would null them together and an assertion on `cardType` alone would be
    // just as red for a bug that only lost `cardData`.
    const [row] = await db.select().from(messages).where(eq(messages.id, MESSAGE_VALID_CARD));
    expect(row?.cardType).toBe('bill');
    expect(row?.cardData).toEqual({ total: 7 });
    expect(row?.cardConfidence).toBe(0.75);
    expect(row?.cardExtractedAt).toBeInstanceOf(Date);

    // The clean fixture's own card, untouched as well — two independent
    // controls, so the check does not rest on one row.
    const [original] = await db.select().from(messages).where(eq(messages.id, MESSAGE));
    expect(original?.cardType).toBe('purchase');
  });

  it('reports EVERY degraded message by id, and only those', () => {
    const card = applied(summary, DROP_UNRENDERABLE_MESSAGE_CARD.id);
    // Exactly one document, named. A silent drop is how data goes missing, and
    // an over-broad rule would list the two healthy cards here too.
    expect(card.documentIds).toEqual([MESSAGE_CORRUPT_CARD]);
    expect(card.documents).toBe(1);
    expect(card.records[0]?.detail).toContain('card.type is {"confidence":0');
    expect(card.records[0]?.detail).toContain('trip | purchase | event | bill | package');
  });

  // -------------------------------------------------------------------------
  // finding 2 — keep the most recent, demote the rest
  // -------------------------------------------------------------------------

  it('keeps the MOST RECENT request of a group and demotes the others', async () => {
    const rows = await db
      .select()
      .from(validationRequests)
      .where(
        inArray(validationRequests.id, [DUP_REQUEST_OLDEST, DUP_REQUEST_MIDDLE, DUP_REQUEST_NEWEST])
      );
    const byId = new Map(rows.map((row) => [row.id, row]));

    // Nothing was deleted — all three rows are present.
    expect(rows).toHaveLength(3);

    // THE ASSERTION the "keep the oldest" mutation breaks, and it names the id.
    expect(byId.get(DUP_REQUEST_NEWEST)?.status).toBe('pending');
    expect(byId.get(DUP_REQUEST_OLDEST)?.status).toBe(DEMOTED_VALIDATION_REQUEST_STATUS);
    expect(byId.get(DUP_REQUEST_MIDDLE)?.status).toBe(DEMOTED_VALIDATION_REQUEST_STATUS);

    // A demoted row carries no verdict: `validation_requests_terminal_check`
    // requires a null outcome for a terminal status that is not a verdict, and
    // a jury that never voted has none to carry.
    expect(byId.get(DUP_REQUEST_OLDEST)?.outcome).toBeNull();
    expect(byId.get(DUP_REQUEST_MIDDLE)?.outcome).toBeNull();

    // Every other field travelled verbatim.
    expect(byId.get(DUP_REQUEST_OLDEST)?.sourceActionId).toBe(DUPLICATE_ACTION_KEY);
    expect(byId.get(DUP_REQUEST_OLDEST)?.rngSeed).toBe(`seed-${DUP_REQUEST_OLDEST}`);
  });

  it('orders a group with no createdAt by the ObjectId timestamp', async () => {
    const rows = await db
      .select()
      .from(validationRequests)
      .where(inArray(validationRequests.id, [DUP_UNTIMED_OLDER, DUP_UNTIMED_NEWER]));
    const byId = new Map(rows.map((row) => [row.id, row]));

    // Precondition: the fallback is the ONLY thing that can order these, and it
    // orders them this way. Asserting it here means a survivor picked by
    // insertion order rather than by an instant cannot pass.
    const older = objectIdTimestamp(DUP_UNTIMED_OLDER);
    const newer = objectIdTimestamp(DUP_UNTIMED_NEWER);
    expect(older).not.toBeNull();
    expect(newer?.getTime() ?? 0).toBeGreaterThan(older?.getTime() ?? 0);

    expect(byId.get(DUP_UNTIMED_NEWER)?.status).toBe('pending');
    expect(byId.get(DUP_UNTIMED_OLDER)?.status).toBe(DEMOTED_VALIDATION_REQUEST_STATUS);
  });

  it('leaves exactly one row per key occupying the partial unique index', async () => {
    // The property the whole resolution exists for, asserted directly against
    // the index's own predicate rather than inferred from the statuses above.
    const [row] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(validationRequests)
      .where(
        sql`${validationRequests.sourceActionId} = ${DUPLICATE_ACTION_KEY} and ${validationRequests.status} in ('pending', 'quorum_met')`
      );
    expect(row?.value).toBe(1);
  });

  it('reports the demoted ids, the survivor, and which field ordered them', () => {
    const demote = applied(summary, DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS.id);
    expect([...demote.documentIds].sort()).toEqual(
      [DUP_REQUEST_OLDEST, DUP_REQUEST_MIDDLE, DUP_UNTIMED_OLDER].sort()
    );
    expect(demote.records[0]?.detail).toContain(DEMOTED_VALIDATION_REQUEST_STATUS);

    // The PLAN names the survivor and says which field decided — the two
    // things a human re-reading this decision needs.
    const groups = summary.resolutionPlan.duplicateOpenValidationRequests;
    const timed = groups.find((group) => group.sourceActionId === DUPLICATE_ACTION_KEY);
    expect(timed?.survivorId).toBe(DUP_REQUEST_NEWEST);
    expect(timed?.members.map((member) => member.orderedBy)).toEqual([
      'createdAt',
      'createdAt',
      'createdAt',
    ]);

    const untimed = groups.find(
      (group) => group.sourceActionId === DUPLICATE_ACTION_KEY_UNTIMED
    );
    expect(untimed?.survivorId).toBe(DUP_UNTIMED_NEWER);
    expect(untimed?.members.map((member) => member.orderedBy)).toEqual([
      'objectId timestamp',
      'objectId timestamp',
    ]);
  });

  // -------------------------------------------------------------------------
  // the copy as a whole still verifies
  // -------------------------------------------------------------------------

  it('verifies clean — the verifier expects what the resolutions actually wrote', async () => {
    // The verifier recomputes its expectation by re-running the transform, so
    // this fails outright if it were to run under different resolutions than
    // the copy did: every demoted request would read as a `status`
    // field-fidelity failure.
    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    const report = await verifyBackfill(db, mongo.source, plans, { batchSize: 3 });
    expect(report.failures).toEqual([]);
    expect(report.comparedFields).toBeGreaterThan(500);
  });

  it('is safe to re-run — the same survivor, counted once', async () => {
    const second = await runBackfill({ db, source: mongo.source, batchSize: 3 });

    // A comparator that could order two equal instants differently between
    // runs would flip the survivor and leave two rows open.
    const groups = second.resolutionPlan.duplicateOpenValidationRequests;
    expect(groups.find((group) => group.sourceActionId === DUPLICATE_ACTION_KEY)?.survivorId).toBe(
      DUP_REQUEST_NEWEST
    );

    // The log keys on (rule, document), so pass B and the deferred-reference
    // pass re-running the transform cannot inflate the count the operator
    // checks against the audit's.
    expect(applied(second, DROP_UNRENDERABLE_MESSAGE_CARD.id).documents).toBe(1);
    expect(applied(second, DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS.id).documents).toBe(3);
  });
});

describe('a nullable enum-checked column: null passes, an out-of-set value blocks', () => {
  // The two halves of the false positive, adjacent on purpose. Asserting only
  // the first would pass against an audit that reported nothing at all.

  it('does NOT report a null `deniedReason` — Postgres accepts it', async () => {
    await truncateAll();
    // The WHOLE clean set, not just `authsessions`: this test asserts the copy
    // SUCCEEDS, and the session's `applicationId` / `oauth.subjectAccountId`
    // are real foreign keys. It also makes the assertion below the stronger
    // one — no finding anywhere in the fixture set, not merely none on this
    // one column.
    const mongo = await seed(cleanFixtures());
    try {
      const summary = await runBackfill({ db, source: mongo.source, batchSize: 5 });

      // Precondition: the fixture really does carry an explicit null, so this
      // is not passing because the audit saw nothing. `distinct` returns `[]`
      // for a field absent from every document — a very different situation.
      const observed = await mongo.source.collection('authsessions').distinct('deniedReason', {});
      expect(observed).toContain(null);

      expect(summary.findings).toEqual([]);
    } finally {
      await mongo.drop();
    }
  });

  it('DOES report an out-of-set `deniedReason` and refuses the copy', async () => {
    await truncateAll();
    const mongo = await seed({ authsessions: dirtyFixtures().authsessions ?? [] });
    try {
      let error: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 5 });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AuditBlockedError);
      if (!(error instanceof AuditBlockedError)) throw new Error('unreachable');
      expect(error.message).toContain('"bogus"');
      expect(error.message).toContain('authsessions.deniedReason');
      // No rule answers this one, so it blocks — the audit did not simply stop
      // looking at the column.
      expect(error.findings.every((finding) => finding.resolvedBy === undefined)).toBe(true);
    } finally {
      await mongo.drop();
    }
  });

  it('still blocks a null in a NOT NULL column with no declared default', async () => {
    // The other side of the nullability split: skipping a null is correct only
    // because the COLUMN is nullable. A NOT NULL column would fail `23502`, and
    // that is not a CHECK question at all.
    await truncateAll();
    const mongo = await seed({
      notifications: [
        {
          _id: '68ad000000000000000000a1',
          recipientId: '68a1000000000000000000a1',
          actorId: '68a1000000000000000000a4',
          // `notifications.type` is NOT NULL and the plan declares no
          // `absentAs`, so an explicit null here is a row Postgres refuses.
          type: null,
          entityId: 'x',
          entityType: 'post',
          read: false,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
    });
    try {
      let error: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 5 });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AuditBlockedError);
      if (!(error instanceof AuditBlockedError)) throw new Error('unreachable');
      expect(error.message).toContain('notifications.type');
      expect(error.message).toContain('is NOT NULL');
    } finally {
      await mongo.drop();
    }
  });
});

describe('the resolution pre-pass reads Mongo and decides nothing else', () => {
  it('finds no duplicate groups in clean data', async () => {
    const mongo = await seed({ validationrequests: cleanFixtures().validationrequests ?? [] });
    try {
      const plan = await planResolutions(mongo.source);
      // A single request holding its own key is not a collision, and reporting
      // it as a resolved group would claim the rule did something it did not.
      expect(plan.duplicateOpenValidationRequests).toEqual([]);
      expect(plan.demotedValidationRequestIds.size).toBe(0);
    } finally {
      await mongo.drop();
    }
  });

  it('ignores a group whose duplicates are already CLOSED', async () => {
    // The partial index only covers `pending`/`quorum_met`, so two closed
    // requests sharing a key are LEGAL. The rule must not claim them — it
    // would report a demotion that never happened.
    const template = (cleanFixtures().validationrequests ?? [])[0] ?? {};
    const mongo = await seed({
      validationrequests: [
        { ...template, _id: 'closed-1', sourceActionId: 'shared', status: 'expired' },
        { ...template, _id: 'closed-2', sourceActionId: 'shared', status: 'expired' },
      ],
    });
    try {
      const plan = await planResolutions(mongo.source);
      expect(plan.duplicateOpenValidationRequests).toEqual([]);
    } finally {
      await mongo.drop();
    }
  });

  it('treats an ABSENT status as open, exactly as the transform does', async () => {
    // The transform writes `str(doc,'status') ?? 'pending'`. If the pre-pass
    // disagreed, a row it thought was closed would land open and collide.
    const template = (cleanFixtures().validationrequests ?? [])[0] ?? {};
    const { status: _ignored, ...withoutStatus } = template;
    const mongo = await seed({
      validationrequests: [
        { ...withoutStatus, _id: 'untyped-1', sourceActionId: 'shared', createdAt: new Date(1) },
        { ...withoutStatus, _id: 'untyped-2', sourceActionId: 'shared', createdAt: new Date(2) },
      ],
    });
    try {
      const plan = await planResolutions(mongo.source);
      expect(plan.duplicateOpenValidationRequests).toHaveLength(1);
      expect(plan.duplicateOpenValidationRequests[0]?.survivorId).toBe('untyped-2');
    } finally {
      await mongo.drop();
    }
  });
});

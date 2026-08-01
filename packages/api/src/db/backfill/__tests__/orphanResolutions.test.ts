/**
 * The ten orphaned-reference resolutions, against a REAL MongoDB and a REAL
 * Postgres.
 *
 * These rules DELETE PRODUCTION ROWS. That is what the decision is — nine
 * relations are NOT NULL with `ON DELETE CASCADE`, so a row whose parent the
 * source never held has no other answer — but it means the standard here is not
 * "the rule works". It is that the rule cannot fire on anything else, and that
 * every row it does fire on is named.
 *
 * ## What each block establishes, and the mutation that proves it can fail
 *
 * 1. **The declarations ARE the schema.** Every one of the ten resolves to a
 *    real constraint whose nullability and `ON DELETE` match the action, and to
 *    a parent collection whose plan writes the referenced table. Derived from
 *    drizzle and from `COLLECTION_PLANS`, so a schema change that invalidates a
 *    decision fails here rather than letting the rule keep firing under a
 *    premise that stopped being true.
 * 2. **A dropped row is DROPPED, a nulled column is NULLED, and the controls are
 *    untouched.** Mutation: widen the predicate so it fires on a row whose
 *    parent is live, and the control assertions go red naming the rows that
 *    should have survived.
 * 3. **Nothing is silent.** The audit still reports every orphan by value and
 *    id, marked resolved; the run summary carries every acted-on row by id; and
 *    the `dropped-document` finding does not fire for a removal the rules
 *    account for. Mutation: stop recording the drop, and the id report goes red.
 * 4. **`dropped-document` stays unanswerable.** A transform that loses a
 *    document still blocks even while these rules are live, which is the one
 *    property no resolution may ever take away.
 * 5. **The copy still verifies**, because the verifier expects what the rules
 *    wrote rather than what the source held.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, type Database } from '../../../config/postgres';
import { createTestDatabase, dropTestDatabase } from '../../testDatabase';
import {
  bundles,
  deviceSessionAccounts,
  deviceSessions,
  notifications,
  userFollows,
} from '../../schema';
import { auditWouldBlockCopy, type AuditFinding } from '../audit';
import {
  cleanFixtures,
  DELETED_USER,
  DEVICE_SESSION,
  orphanResolutionFixtures,
  RESOLVED_ORPHAN_BUNDLE,
  RESOLVED_ORPHAN_DEVICE_SESSION,
  RESOLVED_ORPHAN_FOLLOW,
  RESOLVED_ORPHAN_NOTIFICATION,
  USER_A,
  USER_B,
  type FixtureSet,
} from '../backfillFixtures';
import { COLLECTION_PLANS } from '../collectionMap';
import { createMongoTestDatabase, oid, type MongoTestDatabase } from '../mongoTestSource';
import { planTables, tableName, type CollectionPlan } from '../plan';
import {
  assertOrphanResolutionsMatchSchema,
  auditReferentialIntegrity,
  relationForColumn,
} from '../referentialIntegrity';
import {
  createResolutionContext,
  ORPHAN_RESOLUTIONS,
  planResolutions,
  ResolutionLog,
} from '../resolutions';
import { discover, runBackfill, type RunSummary } from '../runner';
import { verifyBackfill } from '../verify';

jest.setTimeout(300_000);

let db: Database;
let sharedDatabaseUrl: string | undefined;
let ownDatabaseUrl: string;

// Its own throwaway database: this file truncates every table the plans write.
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

/** The applied summary for one rule, by id. Throws rather than returning undefined. */
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

/** The plan for a collection, by name. Throws rather than silently skipping. */
function planFor(collection: string): CollectionPlan {
  const plan = COLLECTION_PLANS.find((candidate) => candidate.collection === collection);
  if (plan === undefined) throw new Error(`No plan for ${collection}`);
  return plan;
}

/**
 * A `users` plan that silently drops one document.
 *
 * Injected by WRAPPING the real plan rather than by editing it, so the mutation
 * is disarmed by construction when the test ends and the transform under test is
 * otherwise the real one.
 */
function usersPlanThatDrops(documentId: string): CollectionPlan {
  const real = planFor('users');
  return {
    ...real,
    transform(doc, emit, resolutions) {
      if (String(doc._id) === documentId) return;
      real.transform(doc, emit, resolutions);
    },
  };
}

/** Discovery's plan list with the lossy `users` plan swapped in. */
async function plansWithLossyUsers(mongo: MongoTestDatabase) {
  const discovery = await discover(mongo.source);
  return discovery.migrated.map((entry) =>
    entry.plan.collection === 'users'
      ? { plan: usersPlanThatDrops(USER_A), documents: entry.documents }
      : entry
  );
}

/** A device session naming the SAME absent account in two different columns. */
const BOTH_COLUMNS_DEVICE_SESSION = '68ae000000000000000000a5';

/** The referential finding for one constraint. */
function findingFor(findings: readonly AuditFinding[], constraint: string): AuditFinding {
  const finding = findings.find(
    (candidate) =>
      candidate.kind === 'referential-integrity' && candidate.detail.includes(constraint)
  );
  if (finding === undefined) {
    throw new Error(
      `No referential finding names ${constraint}. A rule that made the finding ` +
        'DISAPPEAR would be a silenced check, which is the one thing a resolution ' +
        'must never be.'
    );
  }
  return finding;
}

// ---------------------------------------------------------------------------
// 0. the one path
// ---------------------------------------------------------------------------

describe('every consumer runs a transform through `transformDocument`', () => {
  /** Production modules of the backfill — tests and fixtures excluded. */
  function backfillSources(): { path: string; source: string }[] {
    const root = join(__dirname, '..');
    const files: { path: string; source: string }[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name === 'backfillFixtures.ts' || entry.name === 'mongoTestSource.ts') continue;
        files.push({ path, source: readFileSync(path, 'utf8') });
      }
    };
    walk(root);
    return files;
  }

  it('calls `plan.transform` from exactly one module — the wrapper itself', () => {
    // The orphan rules are applied to the ROW a transform emits rather than
    // inside the transform, which is what keeps the copy, the verifier's two
    // passes and the audit provably identical. The cost of that choice is this
    // invariant: a consumer that called `plan.transform` directly would write
    // rows the rules removed, and nothing in the type system says otherwise.
    //
    // Reported as full matched LINES, never a capture group, so a failure names
    // what it found.
    const sources = backfillSources();
    // Vacuity floor: a traversal that found nothing would pass silently.
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(sources.some((entry) => entry.path.endsWith('runner.ts'))).toBe(true);

    // A member CALL (`plan.transform(`), never a plan's own method DEFINITION
    // (`transform(doc, emit) {`), which every file under `plans/` legitimately
    // has. The two are one dot apart, so the pattern is anchored on it.
    const offenders: string[] = [];
    for (const entry of sources) {
      if (entry.path.endsWith('resolutions.ts')) continue;
      for (const line of entry.source.split('\n')) {
        if (/\.transform\s*\(/.test(line)) offenders.push(`${entry.path}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);

    // …and the wrapper really does call it, so this is not passing because the
    // pattern matches nothing anywhere.
    const wrapper = sources.find((entry) => entry.path.endsWith('resolutions.ts'));
    expect(wrapper?.source).toContain('plan.transform(');
  });
});

// ---------------------------------------------------------------------------
// 1. the declarations are the schema
// ---------------------------------------------------------------------------

describe('every declared rule matches the constraint it answers', () => {
  it('covers exactly the ten relations the production audit reported', () => {
    // The vacuity floor of this block: an empty declaration list would satisfy
    // every "for each" assertion below.
    expect(ORPHAN_RESOLUTIONS).toHaveLength(10);
    expect(
      ORPHAN_RESOLUTIONS.map((entry) =>
        relationForColumn(entry.table, entry.property).constraint
      ).sort()
    ).toEqual([
      'app_user_signals_user_id_users_id_fk',
      'bundles_user_id_users_id_fk',
      'device_session_accounts_account_id_users_id_fk',
      'device_sessions_active_account_id_users_id_fk',
      'notifications_actor_id_users_id_fk',
      'notifications_recipient_id_users_id_fk',
      'restrictions_restricted_id_users_id_fk',
      'security_activities_user_id_users_id_fk',
      'user_follows_followed_id_users_id_fk',
      'user_follows_follower_id_users_id_fk',
    ]);
  });

  it('drops only where NULL is unavailable and the schema already cascades', () => {
    // The premise the decision rests on, asserted per relation rather than
    // taken from the table in `resolutions.ts` — a schema edit invalidates the
    // decision, and this is where that has to surface.
    for (const entry of ORPHAN_RESOLUTIONS.filter((rule) => rule.action === 'drop-row')) {
      const relation = relationForColumn(entry.table, entry.property);
      expect([relation.constraint, relation.nullable, relation.onDelete]).toEqual([
        relation.constraint,
        false,
        'cascade',
      ]);
    }
  });

  it('writes NULL only where the schema itself declares SET NULL', () => {
    const nulling = ORPHAN_RESOLUTIONS.filter((rule) => rule.action === 'write-null');
    expect(nulling).toHaveLength(1);
    const [entry] = nulling;
    if (entry === undefined) throw new Error('unreachable');
    const relation = relationForColumn(entry.table, entry.property);
    expect(relation.constraint).toBe('device_sessions_active_account_id_users_id_fk');
    expect(relation.nullable).toBe(true);
    expect(relation.onDelete).toBe('set null');
  });

  it('names a parent collection whose own plan writes the referenced table', () => {
    // The one fact `resolutions.ts` cannot derive without importing the
    // collection map (which imports it back), so it is declared there and
    // checked here. A wrong parent collection is the failure that would build
    // the rule's predicate from the wrong set of ids.
    for (const entry of ORPHAN_RESOLUTIONS) {
      expect(tableName(planFor(entry.parentCollection).table)).toBe(tableName(entry.targetTable));
    }
  });

  it('passes its own schema-agreement check', () => {
    expect(() => {
      assertOrphanResolutionsMatchSchema();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. what the rules do, and what they report
// ---------------------------------------------------------------------------

describe('a dangling reference the rules answer', () => {
  let mongo: MongoTestDatabase;
  let summary: RunSummary;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(orphanResolutionFixtures());
    // It COPIES. The whole point of the decision is that these findings stop
    // blocking, so a throw here is the first failure this file can have.
    summary = await runBackfill({ db, source: mongo.source, batchSize: 3 });
  });

  afterAll(async () => {
    await mongo.drop();
  });

  // -- the rows themselves ---------------------------------------------------

  it('DROPS the row whose parent is gone, and keeps the one whose parent is live', async () => {
    const rows = await db.select().from(bundles);
    const ids = rows.map((row) => row.id);

    // THE CONTROL, and the assertion the "widen the rule" mutation breaks: the
    // clean set's bundle belongs to a live account and must be untouched.
    expect(ids).toContain('68a7000000000000000000a2');
    expect(rows.find((row) => row.id === '68a7000000000000000000a2')?.name).toBe('Receipts');

    // …and the orphan is gone, not written with a made-up owner.
    expect(ids).not.toContain(RESOLVED_ORPHAN_BUNDLE);
    expect(rows).toHaveLength(1);
  });

  it('drops an orphaned follow and an orphaned notification, keeping their siblings', async () => {
    const follows = await db.select().from(userFollows);
    expect(follows.map((row) => row.id)).toEqual(['68a3000000000000000000a1']);
    expect(follows[0]?.followerId).toBe(USER_A);

    const notified = await db.select().from(notifications);
    expect(notified.map((row) => row.id)).toEqual(['68a3000000000000000000a5']);
    // The control's own actor is live and its row is intact — `notifications`
    // carries TWO rules, one per column, and neither may touch this row.
    expect(notified[0]?.actorId).toBe(USER_B);
    expect(notified[0]?.recipientId).toBe(USER_A);
  });

  it('writes NULL and KEEPS the device session, while dropping only its dead entry', async () => {
    // The case the decision turns on: the account entry goes, the device
    // survives holding no active account. Dropping the session instead would
    // sign a user out of a live device to fix a dead pointer.
    const [session] = await db
      .select()
      .from(deviceSessions)
      .where(eq(deviceSessions.id, RESOLVED_ORPHAN_DEVICE_SESSION));
    expect(session).toBeDefined();
    expect(session?.activeAccountId).toBeNull();
    // Every other column verbatim — a rule that rewrote more than the one
    // column would show up here.
    expect(session?.deviceId).toBe('dev-orphan');
    expect(session?.revision).toBe(1);
    expect(session?.secretHash).toBe('b2'.repeat(32));

    const entries = await db
      .select()
      .from(deviceSessionAccounts)
      .where(eq(deviceSessionAccounts.deviceSessionId, RESOLVED_ORPHAN_DEVICE_SESSION));
    // ONE entry: the dead one dropped, the live one kept. This is the control
    // that proves the drop is per ROW and not per document.
    expect(entries.map((row) => row.accountId)).toEqual([USER_B]);
    expect(entries[0]?.sessionId).toBe('sess-live');

    // …and the healthy device session from the clean set is entirely untouched.
    const [control] = await db
      .select()
      .from(deviceSessions)
      .where(eq(deviceSessions.id, DEVICE_SESSION));
    expect(control?.activeAccountId).toBe(USER_A);
    const controlEntries = await db
      .select()
      .from(deviceSessionAccounts)
      .where(eq(deviceSessionAccounts.deviceSessionId, DEVICE_SESSION));
    expect(controlEntries).toHaveLength(2);
  });

  // -- the report ------------------------------------------------------------

  it('still REPORTS every orphan, marked resolved rather than made to disappear', () => {
    const referential = summary.findings.filter(
      (finding) => finding.kind === 'referential-integrity'
    );
    // Five: four relations from four documents, plus the device session's
    // account entry. A rule that suppressed its own finding would show up as a
    // shorter list.
    expect(referential).toHaveLength(5);
    expect(referential.every((finding) => finding.resolvedBy !== undefined)).toBe(true);
    expect(referential.every((finding) => auditWouldBlockCopy(finding) === false)).toBe(true);

    const bundle = findingFor(summary.findings, 'bundles_user_id_users_id_fk');
    // The four things an operator needs, unchanged by the rule: the relation,
    // the missing VALUE, the referencing document, and the count.
    expect(bundle.detail).toContain('bundles.user_id -> users.id');
    expect(bundle.detail).toContain(DELETED_USER);
    expect(bundle.sampleIds).toContain(RESOLVED_ORPHAN_BUNDLE);
    expect(bundle.documents).toBe(1);
    expect(bundle.detail).toContain('never reach Postgres');
    expect(bundle.resolvedBy?.id).toBe('drop-orphaned-bundles-user-id');

    const active = findingFor(summary.findings, 'device_sessions_active_account_id_users_id_fk');
    expect(active.resolvedBy?.id).toBe('null-orphaned-device-sessions-active-account-id');
  });

  it('reports every acted-on row by id, per rule', () => {
    const dropped = applied(summary, 'drop-orphaned-bundles-user-id');
    expect(dropped.documentIds).toEqual([RESOLVED_ORPHAN_BUNDLE]);
    expect(dropped.documents).toBe(1);
    expect(dropped.records[0]?.detail).toContain(DELETED_USER);
    expect(dropped.records[0]?.detail).toContain('The ROW is dropped');

    expect(applied(summary, 'drop-orphaned-user-follows-follower-id').documentIds).toEqual([
      RESOLVED_ORPHAN_FOLLOW,
    ]);
    expect(applied(summary, 'drop-orphaned-notifications-actor-id').documentIds).toEqual([
      RESOLVED_ORPHAN_NOTIFICATION,
    ]);

    const entry = applied(summary, 'drop-orphaned-device-session-accounts-account-id');
    // Keyed by the DEVICE SESSION's `_id`, because that is the document the
    // entry lives in — and that is the id an operator looks up in Mongo.
    expect(entry.documentIds).toEqual([RESOLVED_ORPHAN_DEVICE_SESSION]);

    const nulled = applied(summary, 'null-orphaned-device-sessions-active-account-id');
    expect(nulled.documentIds).toEqual([RESOLVED_ORPHAN_DEVICE_SESSION]);
    expect(nulled.records[0]?.detail).toContain('written NULL and the row is KEPT');

    // A rule that fired on nothing is still reported — that is how "live but
    // unneeded" stays distinguishable from "never wired up".
    expect(applied(summary, 'drop-orphaned-restrictions-restricted-id').documents).toBe(0);
    expect(applied(summary, 'drop-orphaned-security-activities-user-id').documents).toBe(0);
  });

  it('counts a rule-removed row apart from a LOST one, and never as data loss', () => {
    const report = summary.referentialIntegrity;
    // No `dropped-document` finding: every shortfall is accounted for by a rule
    // that named the row it removed.
    expect(report.findings.filter((finding) => finding.kind === 'dropped-document')).toEqual([]);
    expect(report.orphanRowsByOrigin['dropped-by-the-copy']).toBe(0);

    const bundleEmission = report.emissions.find((entry) => entry.collection === 'bundles');
    expect(bundleEmission?.documentsRead).toBe(2);
    expect(bundleEmission?.primaryRowsEmitted).toBe(1);
    expect(bundleEmission?.primaryRowsDroppedByRule).toBe(1);

    // The device session is KEPT, so its own emission is untouched — only its
    // child row went.
    const deviceEmission = report.emissions.find((entry) => entry.collection === 'devicesessions');
    expect(deviceEmission?.primaryRowsDroppedByRule).toBe(0);
    expect(deviceEmission?.primaryRowsEmitted).toBe(deviceEmission?.documentsRead);
  });

  it('says what each drop could cascade to, from the derived FK graph', () => {
    const cascades = summary.referentialIntegrity.dropCascades;
    const bundle = cascades.find((entry) => entry.rule.id === 'drop-orphaned-bundles-user-id');
    expect(bundle?.rowsDropped).toBe(1);
    // Nothing in the schema references `bundles`, so this drop can orphan
    // nothing — stated rather than assumed, and derived from the same graph the
    // audit walks, so a schema that grows such a reference changes this answer
    // without anyone editing the test.
    expect(bundle?.inboundConstraints).toEqual([]);
    expect(bundle?.orphanedByDrop).toEqual([]);

    const entry = cascades.find(
      (candidate) => candidate.rule.id === 'drop-orphaned-device-session-accounts-account-id'
    );
    expect(entry?.inboundConstraints).toEqual([]);
    // The rule that writes NULL drops nothing, so it has no cascade at all.
    expect(
      cascades.some((candidate) => candidate.rule.id.startsWith('null-orphaned-'))
    ).toBe(false);
  });

  it('verifies clean — the verifier expects what the rules wrote', async () => {
    // The verifier recomputes its expectation by re-running the transform under
    // the same resolutions, so a dropped row must be absent from the
    // expectation as well as from the table. If the two disagreed, this is a
    // `row-count` failure naming `bundles`.
    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    const report = await verifyBackfill(db, mongo.source, plans, { batchSize: 3 });
    expect(report.failures).toEqual([]);
    expect(report.comparedFields).toBeGreaterThan(500);
  });

  it('is safe to re-run — the same rows, counted once', async () => {
    const second = await runBackfill({ db, source: mongo.source, batchSize: 3 });
    expect(applied(second, 'drop-orphaned-bundles-user-id').documents).toBe(1);
    expect(await db.select().from(bundles)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. what the rules may NOT do
// ---------------------------------------------------------------------------

describe('the rules stand down rather than guess', () => {
  it('fires on nothing when the parent collection is absent from the source', async () => {
    // An empty parent set is indistinguishable from a pre-pass that read
    // nothing, and one of those would drop every row of nine tables. So the
    // rules are inert and the orphans BLOCK, which is the answer a human has to
    // give anyway.
    const fixtures = cleanFixtures();
    const mongo = await seed({ bundles: fixtures.bundles ?? [] });
    try {
      const plan = await planResolutions(mongo.source);
      expect(plan.orphanParents.size).toBe(0);

      const resolutions = createResolutionContext(plan, new ResolutionLog());
      const discovery = await discover(mongo.source);
      const report = await auditReferentialIntegrity(mongo.source, discovery.migrated, resolutions);

      const orphans = report.orphans.find((entry) => entry.collection === 'bundles');
      expect(orphans?.documents).toBe(1);
      expect(orphans?.mootDocuments).toBe(0);
      expect(orphans?.resolvedBy).toBeUndefined();
      expect(report.findings.every((finding) => finding.resolvedBy === undefined)).toBe(true);
    } finally {
      await mongo.drop();
    }
  });

  it('answers only the column its rule names, not a sibling holding the same id', async () => {
    // `device_sessions` carries TWO nullable `SET NULL` references into `users`
    // and a rule for exactly ONE of them. When both columns name the same
    // absent account — which is the ordinary shape, since the background
    // credential is bound to an account of the device — an answer keyed on the
    // VALUE rather than on the COLUMN would clear both, quietly resolving an
    // orphan nobody decided anything about.
    await truncateAll();
    const fixtures = cleanFixtures();
    const mongo = await seed({
      ...fixtures,
      devicesessions: [
        ...(fixtures.devicesessions ?? []),
        {
          _id: oid(BOTH_COLUMNS_DEVICE_SESSION),
          deviceId: 'dev-both',
          accounts: [],
          activeAccountId: oid(DELETED_USER),
          backgroundSecretHash: 'c3'.repeat(32),
          backgroundSecretAccountId: oid(DELETED_USER),
          revision: 1,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
    });
    try {
      const resolutions = createResolutionContext(
        await planResolutions(mongo.source),
        new ResolutionLog()
      );
      const discovery = await discover(mongo.source);
      const report = await auditReferentialIntegrity(mongo.source, discovery.migrated, resolutions);

      const active = report.orphans.find(
        (entry) => entry.relation.constraint === 'device_sessions_active_account_id_users_id_fk'
      );
      expect(active?.documents).toBe(1);
      expect(active?.resolvedBy?.id).toBe('null-orphaned-device-sessions-active-account-id');

      // THE ASSERTION: the sibling column holds the very same missing id and
      // has no rule, so it is still a real orphan and still blocks.
      const background = report.orphans.find(
        (entry) =>
          entry.relation.constraint ===
          'device_sessions_background_secret_account_id_users_id_fk'
      );
      expect(background?.documents).toBe(1);
      expect(background?.mootDocuments).toBe(0);
      expect(background?.resolvedBy).toBeUndefined();
      expect(
        report.findings.filter(
          (finding) =>
            finding.kind === 'referential-integrity' &&
            finding.detail.includes('background_secret_account_id') &&
            auditWouldBlockCopy(finding)
        )
      ).toHaveLength(1);
    } finally {
      await mongo.drop();
    }
  });

  it('never answers a `dropped-document` finding', async () => {
    await truncateAll();
    const mongo = await seed(orphanResolutionFixtures());
    try {
      const resolutions = createResolutionContext(
        await planResolutions(mongo.source),
        new ResolutionLog()
      );
      const report = await auditReferentialIntegrity(
        mongo.source,
        await plansWithLossyUsers(mongo),
        resolutions
      );
      const drop = report.findings.find((finding) => finding.kind === 'dropped-document');
      expect(drop).toBeDefined();
      expect(drop?.collection).toBe('users');
      // The property this whole block exists for: the ten rules are live, they
      // fired in this very pass, and NONE of them clears this.
      expect(drop?.resolvedBy).toBeUndefined();
      expect(auditWouldBlockCopy(drop as AuditFinding)).toBe(true);
    } finally {
      await mongo.drop();
    }
  });

  it('refuses to answer an orphan whose parent the MIGRATION lost', async () => {
    // `users` losing a document makes `bundles.user_id` dangle for a reason the
    // rules must never paper over: the source HOLDS that account. The origin is
    // no longer `absent-in-source`, so no rule may attach — even though the
    // rows themselves are dropped and would otherwise look answerable.
    await truncateAll();
    const mongo = await seed(orphanResolutionFixtures());
    try {
      const resolutions = createResolutionContext(
        await planResolutions(mongo.source),
        new ResolutionLog()
      );
      const report = await auditReferentialIntegrity(
        mongo.source,
        await plansWithLossyUsers(mongo),
        resolutions
      );
      const orphans = report.orphans.filter(
        (entry) => entry.relation.targetTableName === 'users'
      );
      expect(orphans.length).toBeGreaterThan(0);
      expect(orphans.every((entry) => entry.origin !== 'absent-in-source')).toBe(true);
      expect(orphans.every((entry) => entry.resolvedBy === undefined)).toBe(true);
    } finally {
      await mongo.drop();
    }
  });
});

/**
 * The eleven orphaned-reference resolutions and the ONE cascade, against a REAL
 * MongoDB and a REAL Postgres.
 *
 * These rules DELETE PRODUCTION ROWS. That is what the decision is — ten of the
 * eleven relations cascade, so a row whose parent the source never held goes
 * with it — but it means the standard here is not "the rule works". It is that
 * the rule cannot fire on anything else, and that every row it does fire on is
 * named.
 *
 * The twelfth, `drop-cascaded-file-variants-file-id`, is the only rule that
 * removes rows over a parent the SOURCE STILL HOLDS — this migration is what
 * takes it away. Three protections keep it from becoming "remove anything that
 * references a removed row", and they are independent: it is declared for ONE
 * relation, it only sees rows built from the SAME DOCUMENT as the parent, and
 * the overreach guard compares its tally against the traversal's. Removing any
 * one still leaves `message_attachments` — ON DELETE **no action**, a stored
 * message's attachment — standing; removing two does not.
 *
 * The `files` rule is the one to read twice. Its column is NULLABLE, so unlike
 * the nine `users` drops a widened predicate would NOT fail loudly on the way
 * in — it would quietly destroy files that have a live owner — and each row it
 * removes is the last record of an object still sitting in S3. Its controls are
 * therefore load-bearing in a way the others' are not: a live-owner file, and
 * the SENTINEL-owned files whose `__namespace__` owner is not an account at all.
 *
 * ## What each block establishes, and the mutation that proves it can fail
 *
 * 1. **The declarations ARE the schema.** Every one of the eleven resolves to a
 *    real constraint whose `ON DELETE` matches the action, justifies NULL
 *    exactly where NULL was available, and names a parent collection whose plan
 *    writes the referenced table. Derived from drizzle and from
 *    `COLLECTION_PLANS`, so a schema change that invalidates a decision fails
 *    here rather than letting the rule keep firing under a premise that stopped
 *    being true.
 * 2. **A dropped row is DROPPED, a nulled column is NULLED, and the controls are
 *    untouched.** Mutation: widen the predicate so it fires on a row whose
 *    parent is live, and the control assertions go red naming the rows that
 *    should have survived — including the file whose owner exists.
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
  fileVariants,
  files,
  notifications,
  userFollows,
  users,
} from '../../schema';
import { sqlColumnName } from '@oxyhq/db';
import { auditWouldBlockCopy, type AuditFinding } from '../audit';
import {
  cleanFixtures,
  DELETED_USER,
  DEVICE_SESSION,
  FILE_FEDERATION,
  FILE_LINK_PREVIEW,
  FILE_USER,
  LIVE_OWNER_FILE,
  orphanFileWithChildrenFixtures,
  orphanResolutionFixtures,
  RESOLVED_ORPHAN_BUNDLE,
  RESOLVED_ORPHAN_DEVICE_SESSION,
  RESOLVED_ORPHAN_FILE,
  RESOLVED_ORPHAN_FILE_SHA256,
  RESOLVED_ORPHAN_FILE_STORAGE_KEY,
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
  referentialRelations,
  relationForColumn,
} from '../referentialIntegrity';
import { assertParentsPrecedeChildren } from '../parentKeys';
import {
  createResolutionContext,
  DROP_CASCADED_FILE_VARIANT,
  DROP_ORPHANED_FILE,
  MissingParentKeysError,
  ORPHAN_RESOLUTIONS,
  parentKeysFrom,
  planResolutions,
  ResolutionLog,
} from '../resolutions';
import {
  AuditBlockedError,
  discover,
  emptyState,
  runAudits,
  runBackfill,
  type RunSummary,
} from '../runner';
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

/** An account that reaches POSTGRES while MongoDB is still short of it. */
const LATE_USER = '68af000000000000000000a1';
/** A file owned by it, built while the source still had no such account. */
const LATE_PARENT_FILE = '68af000000000000000000a2';

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
    const modules: { path: string; source: string }[] = [];
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
        modules.push({ path, source: readFileSync(path, 'utf8') });
      }
    };
    walk(root);
    return modules;
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
// 0b. the parent set is POSTGRES, at the moment the level is copied
// ---------------------------------------------------------------------------

describe('the rules decide against Postgres, not a snapshot of a moving source', () => {
  afterEach(async () => {
    await truncateAll();
  });

  it('does NOT fire on a parent that reached Postgres after the source was read', async () => {
    // THE RACE, and the reason this shape exists. Production Mongo takes writes
    // while the migration reads it — `users` moved 60,673 → 60,843 → 60,847
    // across one attempt — so a set read once at the start is stale by the time
    // a child level copies, and a file uploaded in that window looked exactly
    // like a file whose owner was deleted years ago. On the real run the rule
    // was about to remove EIGHT live files.
    //
    // Shaped as a RESUMED run, which is the only way to make the two designs
    // distinguishable: the parent table is already NON-EMPTY when the second
    // run starts, so a set read once up-front is wrong rather than merely
    // empty — an empty one would make the rules inert and hide the difference.
    await truncateAll();
    const fixtures = cleanFixtures();
    const mongo = await seed({
      ...fixtures,
      files: [
        ...(fixtures.files ?? []),
        {
          _id: oid(LATE_PARENT_FILE),
          sha256: '7'.repeat(64),
          size: 512,
          mime: 'image/png',
          ext: 'png',
          // An account the source does not hold yet.
          ownerUserId: LATE_USER,
          status: 'active',
          visibility: 'private',
          purpose: 'user',
          storageKey: `content/2026/03/77/${'7'.repeat(64)}.png`,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
    });
    try {
      // Precondition: at the instant a pre-pass would have run, the source is
      // short of that parent — so this measures the race rather than a fixture
      // that never had one.
      expect(await mongo.source.collection('users').countDocuments({ _id: oid(LATE_USER) })).toBe(0);

      // Run one copies the accounts as they stand. `users` is now non-empty in
      // Postgres, which is what a resumed cutover looks like.
      await runBackfill({ db, source: mongo.source, batchSize: 3 }, emptyState(), ['users']);
      const before = await db.select({ id: users.id }).from(users);
      expect(before.length).toBeGreaterThan(0);
      expect(before.map((row) => row.id)).not.toContain(LATE_USER);

      // …and NOW the live writer creates the account — in the window between
      // that read and the level that copies its file.
      await mongo.seed('users', [
        {
          _id: oid(LATE_USER),
          username: 'latearrival',
          email: 'late@example.com',
          publicKey: 'CC'.repeat(33),
          name: { first: 'Late', last: 'Arrival' },
          kind: 'personal',
          accountStatus: 'active',
          type: 'local',
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]);

      // Run two copies both levels. The `users` level commits the new account;
      // the `files` level reads the parent set AFTER it, so it sees it.
      const summary = await runBackfill({ db, source: mongo.source, batchSize: 3 }, emptyState(), [
        'users',
        'files',
      ]);

      // THE ASSERTION: the file is still here, with its owner intact.
      const [row] = await db.select().from(files).where(eq(files.id, LATE_PARENT_FILE));
      expect(row?.ownerUserId).toBe(LATE_USER);

      // …and the rule stayed SILENT rather than removing it and reporting it —
      // a report of a row that should never have been touched is not a defence.
      expect(applied(summary, 'drop-orphaned-files-owner-user-id').documents).toBe(0);
      // The guard stayed silent too: with the rule and the traversal reading the
      // same live answer there is nothing left for it to disagree about.
      expect(summary.findings.filter((finding) => finding.kind === 'resolution-overreach')).toEqual(
        []
      );
    } finally {
      await mongo.drop();
    }
  });

  it('REFUSES rather than answering from a set nobody loaded', async () => {
    // The failure mode that must never degrade quietly. A rule with no parent
    // set does not fall back to the source, to an empty set, or to "keep
    // everything" — it stops the run. The old shape's whole bug was answering
    // from the wrong set, so answering from no set at all has to be louder.
    const empty = parentKeysFrom(new Map());
    expect(() => empty.keysFor(users)).toThrow(MissingParentKeysError);
    expect(() => empty.keysFor(users)).toThrow(/refused rather than answered/);
  });

  it('checks that a rule never outruns the level that fills its parent table', () => {
    // Reading Postgres is exact only because the parent table is COMPLETE by
    // then, which is a property of the topological order rather than of the
    // query. Asserted against the same derivation the copy uses, so a schema
    // change that put a referencing table in its parent's level fails here.
    expect(() => {
      assertParentsPrecedeChildren(COLLECTION_PLANS);
    }).not.toThrow();

    // …and the check can fail: a plan list holding only `files` puts nothing
    // before it, so its rule has no completed `users` to read.
    expect(() => {
      assertParentsPrecedeChildren([planFor('files'), planFor('users')]);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 1. the declarations are the schema
// ---------------------------------------------------------------------------

describe('every declared rule matches the constraint it answers', () => {
  it('covers exactly the eleven relations the production audit reported', () => {
    // The vacuity floor of this block: an empty declaration list would satisfy
    // every "for each" assertion below.
    expect(ORPHAN_RESOLUTIONS).toHaveLength(12);
    expect(
      ORPHAN_RESOLUTIONS.filter((entry) => entry.trigger === 'absent-parent')
        .map((entry) => relationForColumn(entry.table, entry.property).constraint)
        .sort()
    ).toEqual([
      'app_user_signals_user_id_users_id_fk',
      'bundles_user_id_users_id_fk',
      'device_session_accounts_account_id_users_id_fk',
      'device_sessions_active_account_id_users_id_fk',
      'files_owner_user_id_users_id_fk',
      'notifications_actor_id_users_id_fk',
      'notifications_recipient_id_users_id_fk',
      'restrictions_restricted_id_users_id_fk',
      'security_activities_user_id_users_id_fk',
      'user_follows_followed_id_users_id_fk',
      'user_follows_follower_id_users_id_fk',
    ]);
  });

  it('declares exactly ONE cascade, and only for the relation decided', () => {
    // The list is the whole guard. Three constraints reference `files` and two
    // of them — `file_links` (cascade) and `message_attachments` (**no
    // action**) — are deliberately absent, so they still block. A cascade
    // appearing here for either of those is a decision nobody made, and
    // `message_attachments` is the one the schema argues hardest about.
    const cascades = ORPHAN_RESOLUTIONS.filter((entry) => entry.trigger === 'parent-dropped');
    expect(cascades.map((entry) => relationForColumn(entry.table, entry.property).constraint))
      .toEqual(['file_variants_file_id_files_id_fk']);

    const [cascade] = cascades;
    if (cascade === undefined) throw new Error('unreachable');
    // It cascades FROM the rule that removes the parent, named — not from "a
    // drop" in general.
    expect(cascade.cascadesFrom?.rule.id).toBe('drop-orphaned-files-owner-user-id');
    expect(cascade.rule.id).toBe('drop-cascaded-file-variants-file-id');
    // …and the schema agrees: the relation it answers really does cascade.
    const relation = relationForColumn(cascade.table, cascade.property);
    expect([relation.nullable, relation.onDelete]).toEqual([false, 'cascade']);

    // The two it must NOT cover, asserted by the SHAPE of the graph rather than
    // by naming them: every other constraint into `files` is unanswered.
    const inbound = referentialRelations(COLLECTION_PLANS).filter(
      (entry) => entry.targetTableName === 'files'
    );
    expect(inbound.map((entry) => entry.constraint).sort()).toEqual([
      'file_links_file_id_files_id_fk',
      'file_variants_file_id_files_id_fk',
      'message_attachments_file_id_files_id_fk',
    ]);
    const answered = new Set(
      ORPHAN_RESOLUTIONS.map((entry) => relationForColumn(entry.table, entry.property).constraint)
    );
    expect(inbound.filter((entry) => answered.has(entry.constraint))).toHaveLength(1);
  });

  it('carries the variant id, its file, its type and its OWN S3 key', () => {
    // A variant's object is a DIFFERENT object from its parent file's, so a
    // cleanup working only from the 179 originals would leave every rendition
    // behind. The four columns are what makes the variant resolvable on its own.
    expect(DROP_CASCADED_FILE_VARIANT.carry?.map((column) => sqlColumnName(column))).toEqual([
      'id',
      'file_id',
      'type',
      'key',
    ]);
    expect(DROP_CASCADED_FILE_VARIANT.rule.decision).toContain('NOT the parent file');
    expect(DROP_CASCADED_FILE_VARIANT.rule.decision).toContain('COMPLETE list, never a sample');
    // The key is content-addressed on the PARENT'S sha256, so it is not
    // exclusively owned and the per-content precondition still applies.
    expect(DROP_CASCADED_FILE_VARIANT.rule.decision).toContain('per-CONTENT precondition');
  });

  it('drops only where the schema cascades, and justifies NULL only where it exists', () => {
    // The premise each decision rests on, asserted per relation rather than
    // taken from the table in `resolutions.ts` — a schema edit invalidates the
    // decision, and this is where that has to surface.
    //
    // The two shapes are checked together on purpose: `whyNotNull` present on a
    // NOT NULL column, or absent on a NULLABLE one, are both declarations that
    // have drifted from the column they name.
    for (const entry of ORPHAN_RESOLUTIONS.filter((rule) => rule.action === 'drop-row')) {
      const relation = relationForColumn(entry.table, entry.property);
      expect([relation.constraint, relation.onDelete]).toEqual([relation.constraint, 'cascade']);
      expect([relation.constraint, relation.nullable, entry.whyNotNull !== undefined]).toEqual([
        relation.constraint,
        relation.nullable,
        relation.nullable,
      ]);
    }

    // Exactly ONE drop is on a nullable column, and it is the files one — so
    // the branch above is exercised in both directions rather than vacuously.
    const nullableDrops = ORPHAN_RESOLUTIONS.filter(
      (rule) => rule.action === 'drop-row' && relationForColumn(rule.table, rule.property).nullable
    );
    expect(nullableDrops.map((rule) => rule.rule.id)).toEqual([
      'drop-orphaned-files-owner-user-id',
    ]);
  });

  it('states the S3 cost in the decision the run report prints', () => {
    // The cost is the reason this decision is not a formality, and the report
    // is the only place an operator meets it. Asserting the words keeps it from
    // being softened into a summary later.
    const decision = DROP_ORPHANED_FILE.rule.decision;
    expect(decision).toContain('STILL IN S3');
    expect(decision).toContain('COMPLETE list, never a sample');
    expect(decision).toContain('sha256');
    expect(decision).toContain('storage_key');
    // …and that MongoDB keeps the rows, which is what makes it reversible.
    expect(decision).toContain('MongoDB keeps every one of these rows');
    // The carried columns are declared as real columns, so a rename breaks the
    // build rather than emptying the worklist.
    expect(DROP_ORPHANED_FILE.carry?.map((column) => sqlColumnName(column))).toEqual([
      'sha256',
      'storage_key',
    ]);
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
    // Seven: five relations from five documents, the device session's account
    // entry, and the dropped file's variants. A rule that suppressed its own
    // finding would show up as a shorter list — the CASCADE included, which is
    // the one whose orphans this migration creates rather than inherits.
    expect(referential).toHaveLength(7);
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

  it('names every constraint into a table it drops from, and what each one did', () => {
    // `files` is the one table these rules drop from that anything references.
    // The disclosure enumerates ALL THREE constraints and says what happened
    // through each — which is what made the cascade decidable in the first
    // place, and what must go on saying "0" for the two nobody decided.
    const cascades = summary.referentialIntegrity.dropCascades;
    const file = cascades.find((entry) => entry.rule.id === 'drop-orphaned-files-owner-user-id');
    expect(file?.rowsDropped).toBe(1);
    expect([...(file?.inboundConstraints ?? [])].sort()).toEqual([
      'file_links_file_id_files_id_fk',
      'file_variants_file_id_files_id_fk',
      'message_attachments_file_id_files_id_fk',
    ]);

    // The variants DID follow, and the entry names the rule they followed —
    // never a bare count, which would read the same as an unanswered orphan.
    expect(file?.orphanedByDrop).toEqual([
      {
        constraint: 'file_variants_file_id_files_id_fk',
        documents: 2,
        resolvedBy: DROP_CASCADED_FILE_VARIANT.rule,
      },
    ]);
    // …and the two nobody decided are absent because they are ZERO here, which
    // is a measurement rather than an exemption: `orphanFileWithChildrenFixtures`
    // makes `file_links` non-zero and the run is refused.
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

  // -- the eleventh rule: the one that strands real bytes ---------------------

  it('DROPS the file whose owner is gone — and NULL was available', async () => {
    const rows = await db.select().from(files);
    const byId = new Map(rows.map((row) => [row.id, row]));

    // The orphan is gone, and gone WHOLE — not kept with a NULL owner, which
    // is the answer the column would have accepted and this decision refused.
    expect(byId.has(RESOLVED_ORPHAN_FILE)).toBe(false);
    expect(rows.filter((row) => row.ownerUserId === null && row.systemOwner === null)).toEqual([]);

    // CONTROL 1 — a file owned by a LIVE account, with NOTHING referencing it.
    // This is the assertion the "point the rule at a live owner" mutation
    // breaks, and it matters more here than anywhere else in this file: the
    // column is NULLABLE, so a widened predicate would not fail loudly on the
    // way in. It is childless on purpose — `FILE_USER` below has links,
    // variants and an attachment, so dropping THAT one is caught by the cascade
    // before any assertion runs, which would leave the predicate's narrowness
    // untested.
    expect(byId.get(LIVE_OWNER_FILE)?.ownerUserId).toBe(USER_B);
    expect(byId.get(LIVE_OWNER_FILE)?.storageKey).toContain('ffffff');
    expect(byId.get(FILE_USER)?.ownerUserId).toBe(USER_A);
    expect(byId.get(FILE_USER)?.storageKey).toBe('assets/a');

    // CONTROL 2 — the SENTINEL-owned files. `__federation__` and
    // `__link_preview_cache__` are not accounts at all, and the transform sends
    // them to `system_owner` leaving `owner_user_id` NULL, so the rule cannot
    // see them. Production holds 192 + 29,432 + 48,616 of these; a predicate
    // that read a sentinel as an absent account would destroy every one.
    expect(byId.get(FILE_FEDERATION)?.systemOwner).toBe('__federation__');
    expect(byId.get(FILE_FEDERATION)?.ownerUserId).toBeNull();
    expect(byId.get(FILE_LINK_PREVIEW)?.systemOwner).toBe('__link_preview_cache__');
    expect(byId.get(FILE_LINK_PREVIEW)?.ownerUserId).toBeNull();
  });

  it('takes the file\'s VARIANTS with it, and leaves every other file\'s alone', async () => {
    const rows = await db.select().from(fileVariants);

    // The two renditions of the dropped file are gone: a variant of a file that
    // will not exist is what `ON DELETE cascade` describes.
    expect(rows.filter((row) => row.fileId === RESOLVED_ORPHAN_FILE)).toEqual([]);

    // THE CONTROL — the clean set's own file keeps its variant. The cascade
    // fires on a removed PARENT, never on "a file", so a widened trigger shows
    // up here as an empty table.
    expect(rows.map((row) => row.fileId)).toEqual([FILE_USER]);
    expect(rows[0]?.type).toBe('thumbnail');
    expect(rows[0]?.key).toBe('assets/a-thumb');
  });

  it('emits each removed variant with its file, its type and its OWN key', () => {
    const cascaded = applied(summary, 'drop-cascaded-file-variants-file-id');
    expect(cascaded.documents).toBe(2);
    expect(cascaded.records).toHaveLength(2);

    // A variant's object is NOT the parent's, so the id alone would strand it.
    // Every row, with the four columns that resolve it — never a sample.
    const carried = cascaded.records.map((record) => record.evidence);
    expect(carried.map((entry) => entry?.type).sort()).toEqual(['thumbnail', 'webp']);
    for (const entry of carried) {
      expect(entry?.file_id).toBe(RESOLVED_ORPHAN_FILE);
      expect(entry?.id).toBeDefined();
      // The key is content-addressed on the PARENT'S sha256 — which is why the
      // per-content precondition still applies and why the hash is legible in
      // the key itself.
      expect(entry?.key).toContain(RESOLVED_ORPHAN_FILE_SHA256);
      expect(entry?.key).toMatch(/^variants\/\d{4}\/\d{2}\//);
    }
    expect(cascaded.records[0]?.detail).toContain('drop-orphaned-files-owner-user-id');
  });

  it('emits the sha256 and the storage key with every dropped file id', () => {
    const dropped = applied(summary, 'drop-orphaned-files-owner-user-id');

    // Every id, and for each one the two columns that identify the S3 object
    // the row was the last record of. A count without them would be a list of
    // ids to something nobody can find afterwards.
    expect(dropped.documentIds).toEqual([RESOLVED_ORPHAN_FILE]);
    expect(dropped.records).toHaveLength(1);
    expect(dropped.records[0]?.evidence).toEqual({
      sha256: RESOLVED_ORPHAN_FILE_SHA256,
      storage_key: RESOLVED_ORPHAN_FILE_STORAGE_KEY,
    });

    // The KEY is carried rather than derived because it cannot be derived: it
    // embeds the upload's year and month, which no later run can recover from
    // the hash and the mime type.
    expect(RESOLVED_ORPHAN_FILE_STORAGE_KEY).toContain(RESOLVED_ORPHAN_FILE_SHA256);
    expect(RESOLVED_ORPHAN_FILE_STORAGE_KEY).toMatch(/^content\/\d{4}\/\d{2}\//);

    // Records are complete for EVERY rule, never sampled — asserted across the
    // whole summary so a cap introduced later fails here.
    for (const entry of summary.resolutions) {
      expect(entry.records).toHaveLength(entry.documents);
      expect(entry.documentIds).toHaveLength(entry.documents);
    }
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
  it('fires on nothing when the parent table holds no rows', async () => {
    // An EMPTY parent set is the one case that must not be read as "every
    // reference is an orphan": it would remove every row of ten tables. So the
    // rules stand down and the orphans BLOCK, which is the answer a human has
    // to give anyway. (An UNLOADED set is a different failure and refuses
    // outright — `MissingParentKeysError`.)
    const fixtures = cleanFixtures();
    const mongo = await seed({ bundles: fixtures.bundles ?? [] });
    try {
      const resolutions = createResolutionContext(
        await planResolutions(mongo.source),
        new ResolutionLog()
      );
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

  it('cascades to the ONE relation decided, and blocks on the ones not', async () => {
    // The whole point of the cascade being declared per relation. A dropped
    // file's VARIANTS follow it, because `file_variants.file_id` cascades and
    // somebody decided that. Its LINK does not — `file_links.file_id` cascades
    // too and nobody decided it — so the run is still REFUSED, before the copy.
    // If this ever passes silently, the cascade has generalised into "remove
    // anything that references a removed row", which would take
    // `message_attachments` (ON DELETE **no action**) with it.
    await truncateAll();
    const mongo = await seed(orphanFileWithChildrenFixtures());
    try {
      let caught: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 3 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AuditBlockedError);
      if (!(caught instanceof AuditBlockedError)) throw new Error('unreachable');

      // BLOCKING: the link AND the message attachment, both unanswered.
      const blocking = caught.findings.filter(
        (finding) => finding.kind === 'referential-integrity'
      );
      const detail = blocking.map((finding) => finding.detail).join('\n');
      expect(detail).toContain('file_links_file_id_files_id_fk');
      // The one the schema argues hardest about: `no action` means a stored
      // message's attachment is never emptied silently, and it comes from
      // ANOTHER collection — which a cascade restricted to one document could
      // not reach even if someone declared it.
      expect(detail).toContain('message_attachments_file_id_files_id_fk');
      expect(detail).toContain('ON DELETE no action');
      expect(blocking.every((finding) => finding.resolvedBy === undefined)).toBe(true);
      expect(blocking).toHaveLength(2);

      // The origin is SETTLED — a rule removed the parent — so the report must
      // not send the operator off to establish it.
      expect(detail).toContain('ORIGIN parent-removed-by-rule');
      expect(detail).toContain('what is missing is a decision');
      expect(detail).not.toContain('until the origin is settled');

      // ANSWERED: the variant, by the cascade, and named.
      const audited = await runAudits(
        mongo.source,
        await discover(mongo.source),
        createResolutionContext(await planResolutions(mongo.source), new ResolutionLog())
      );
      const variants = findingFor(audited.findings, 'file_variants_file_id_files_id_fk');
      expect(variants.resolvedBy?.id).toBe('drop-cascaded-file-variants-file-id');
      expect(auditWouldBlockCopy(variants)).toBe(false);

      // …and nothing was written: the refusal happens before the copy.
      const [row] = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from files`
      );
      expect(row?.count).toBe(0);
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

/**
 * The referential-integrity audit, against a REAL MongoDB and a REAL Postgres.
 *
 * This audit exists because its absence let `--audit-only` report CLEAN and the
 * copy then die on `bundles_user_id_users_id_fk` partway through level 2 of 6.
 * So the standard it is held to is the one that failure implies: it must be
 * impossible for this file to pass against a version of the audit that does not
 * actually run.
 *
 * ## Three things have to be established, and each has its own failure mode
 *
 * 1. **The derived relations ARE the database's foreign keys.** Not a subset,
 *    not a superset, and with the same `ON DELETE` and the same constraint name.
 *    Checked against `pg_constraint` in a migrated database, in BOTH directions
 *    — a derivation that finds 3 of 165 relations would otherwise pass every
 *    orphan test below that happens to use one of the 3.
 * 2. **A production-shaped orphan is FOUND, named, and BLOCKS.** Three of them,
 *    because the schema's own `ON DELETE` makes a NOT NULL orphan, a nullable
 *    `SET NULL` orphan and a nullable `CASCADE` orphan three different questions.
 * 3. **A healthy relation stays SILENT.** The control, and the half that a
 *    check reporting everything would fail. Asserted on the same clean fixture
 *    set the rest of this directory copies successfully.
 *
 * ## And the vacuity floor, which is the actual bug being fixed
 *
 * A traversal that inspects nothing reports zero orphans, and zero orphans is
 * exactly what a clean run reports. So `VacuousReferentialIntegrityError` is
 * asserted directly, and every clean assertion here is paired with the COUNTS
 * that prove the pass looked at something.
 */

import { sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, type Database } from '../../../config/postgres';
import { createTestDatabase, dropTestDatabase } from '../../testDatabase';
import {
  cleanFixtures,
  dirtyFixtures,
  DELETED_APPLICATION,
  DELETED_MESSAGE,
  DELETED_USER,
  FORWARD_CHILD_TOPIC,
  FORWARD_PARENT_TOPIC,
  ORPHAN_BUNDLE,
  ORPHAN_PUSH_TOKEN,
  ORPHAN_REMINDER,
  orphanFixtures,
  ORG,
  SUB,
  type FixtureSet,
} from '../backfillFixtures';
import { COLLECTION_PLANS } from '../collectionMap';
import { createMongoTestDatabase, type MongoTestDatabase } from '../mongoTestSource';
import { planTables, tableName, type CollectionPlan } from '../plan';
import {
  auditReferentialIntegrity,
  referentialRelations,
  VacuousReferentialIntegrityError,
  type Relation,
} from '../referentialIntegrity';
import { createResolutionContext, planResolutions, ResolutionLog } from '../resolutions';
import { AuditBlockedError, discover, runAudits, runBackfill } from '../runner';

jest.setTimeout(300_000);

let db: Database;
let sharedDatabaseUrl: string | undefined;
let ownDatabaseUrl: string;

// Its own throwaway database: this file truncates every table the plans write,
// which is not something a neighbouring suite survives.
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

/** A resolution context over a source, exactly as the runner builds one. */
async function resolutionsFor(mongo: MongoTestDatabase) {
  return createResolutionContext(await planResolutions(mongo.source), new ResolutionLog());
}

/** The plan for a collection, by name. Throws rather than silently skipping. */
function planFor(collection: string): CollectionPlan {
  const plan = COLLECTION_PLANS.find((candidate) => candidate.collection === collection);
  if (plan === undefined) throw new Error(`No plan for ${collection}`);
  return plan;
}

// ---------------------------------------------------------------------------
// 1. the derivation is the database
// ---------------------------------------------------------------------------

/**
 * `pg_constraint.confdeltype` → the drizzle spelling of the same action.
 *
 * The comparison has to cross this mapping rather than assume it: an `ON DELETE`
 * is decided per relation in this schema (`MIGRATION-CONTRACT.md` requires it),
 * and it is the one fact the audit's RECOMMENDATION turns on.
 */
const CONFDELTYPE: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

interface CatalogueForeignKey {
  readonly conname: string;
  readonly source_table: string;
  readonly target_table: string;
  readonly confdeltype: string;
  readonly source_columns: string[];
  readonly target_columns: string[];
}

/** Every foreign key the migrated database actually enforces. */
async function catalogueForeignKeys(): Promise<CatalogueForeignKey[]> {
  return [
    ...(await db.execute<CatalogueForeignKey>(sql`
      select
        c.conname,
        src.relname as source_table,
        tgt.relname as target_table,
        c.confdeltype::text as confdeltype,
        (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) as source_columns,
        (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.confkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
        ) as target_columns
      from pg_constraint c
      join pg_class src on src.oid = c.conrelid
      join pg_class tgt on tgt.oid = c.confrelid
      join pg_namespace n on n.oid = src.relnamespace
      where c.contype = 'f' and n.nspname = 'public'
      order by c.conname
    `)),
  ];
}

/** The relation rendered as one comparable line. */
function signature(relation: Relation): string {
  return (
    `${relation.constraint} ${relation.tableName}(` +
    `${relation.columns.map((column) => column.sqlName).join(',')}) -> ` +
    `${relation.targetTableName}(` +
    `${relation.targetColumns.map((column) => column.sqlName).join(',')}) ` +
    `on delete ${relation.onDelete}`
  );
}

/** The same line, built from the catalogue instead. */
function catalogueSignature(entry: CatalogueForeignKey): string {
  return (
    `${entry.conname} ${entry.source_table}(${entry.source_columns.join(',')}) -> ` +
    `${entry.target_table}(${entry.target_columns.join(',')}) ` +
    `on delete ${CONFDELTYPE[entry.confdeltype] ?? `unknown(${entry.confdeltype})`}`
  );
}

describe('the relations are DERIVED, and they are the database\'s own', () => {
  const relations = referentialRelations(COLLECTION_PLANS);

  it('derives a relation count that could not come from an empty traversal', () => {
    // The vacuity floor of this whole block. Every assertion below compares two
    // sets; two EMPTY sets are equal, so without a floor a broken derivation
    // and a broken catalogue query would agree perfectly.
    expect(relations.length).toBeGreaterThanOrEqual(150);
  });

  it('matches pg_constraint exactly — name, columns, target and ON DELETE', async () => {
    const catalogue = await catalogueForeignKeys();
    // Precondition: the throwaway database really was migrated. Without it a
    // catalogue query returning nothing would make the diffs below trivially
    // pass in one direction.
    expect(catalogue.length).toBeGreaterThanOrEqual(150);

    const derived = new Set(relations.map(signature));
    const enforced = new Set(catalogue.map(catalogueSignature));

    // BOTH directions, and reported as sorted lists so a failure names the
    // offending constraints rather than saying two sets differ. A missing entry
    // is a constraint this audit would never check; an extra one is a relation
    // it would check against a table Postgres does not constrain.
    expect([...enforced].filter((entry) => !derived.has(entry)).sort()).toEqual([]);
    expect([...derived].filter((entry) => !enforced.has(entry)).sort()).toEqual([]);
  });

  it('names the constraint the way Postgres does, not the way drizzle would', () => {
    // The failure that started this: Postgres said `bundles_user_id_users_id_fk`
    // and drizzle's own `ForeignKey.getName()` answers
    // `bundles_userId_users_id_fk`, because it builds the name from the
    // TypeScript PROPERTY names. Reporting a name the operator cannot find in
    // the error they are holding is worse than reporting none.
    const bundles = relations.find((relation) => relation.tableName === 'bundles');
    expect(bundles?.constraint).toBe('bundles_user_id_users_id_fk');
    expect(bundles?.columns.map((column) => column.sqlName)).toEqual(['user_id']);
    expect(bundles?.columns.map((column) => column.property)).toEqual(['userId']);
  });

  it('truncates a long constraint name the way Postgres silently does', () => {
    // `drizzle-kit` emits the FULL 85-character name in the ADD CONSTRAINT
    // statement and Postgres truncates it to 63 bytes on creation, so eleven of
    // this schema's foreign keys are enforced under a name the migration file
    // never spells — and the `23503` an operator is holding quotes the truncated
    // one. Asserted directly rather than only through the catalogue diff above,
    // because that diff would go green again if BOTH sides lost the truncation.
    const longest = relations.find(
      (relation) => relation.tableName === 'transparency_checkpoint_snapshot_entries'
    );
    expect(longest?.constraint).toBe(
      'transparency_checkpoint_snapshot_entries_checkpoint_id_transpar'
    );
    expect(longest?.constraint).toHaveLength(63);
    expect(relations.every((relation) => relation.constraint.length <= 63)).toBe(true);
  });

  it('reads nullability and ON DELETE per relation, since the report turns on both', () => {
    const byConstraint = new Map(relations.map((relation) => [relation.constraint, relation]));

    const notNullCascade = byConstraint.get('bundles_user_id_users_id_fk');
    expect(notNullCascade?.nullable).toBe(false);
    expect(notNullCascade?.onDelete).toBe('cascade');

    const nullableSetNull = byConstraint.get('reminders_related_message_id_messages_id_fk');
    expect(nullableSetNull?.nullable).toBe(true);
    expect(nullableSetNull?.onDelete).toBe('set null');

    const nullableCascade = byConstraint.get('push_tokens_application_id_applications_id_fk');
    expect(nullableCascade?.nullable).toBe(true);
    expect(nullableCascade?.onDelete).toBe('cascade');
  });

  it('covers the four relations whose TARGET is not a primary key', () => {
    // These are the ones a "compare against the referenced table's ids" shortcut
    // would silently get wrong: the referenced set is a different column, and in
    // one case a content hash rather than a row id at all.
    const targets = new Set(
      relations.map(
        (relation) =>
          `${relation.targetTableName}.${relation.targetColumns
            .map((column) => column.sqlName)
            .join(',')}`
      )
    );
    expect(targets).toContain('signed_records.record_id');
    expect(targets).toContain('update_assets.sha256');
    expect(targets).toContain('app_updates.update_id');
    expect(targets).toContain('moderation_policies.policy_version');
  });
});

// ---------------------------------------------------------------------------
// 2. production-shaped orphans
// ---------------------------------------------------------------------------

describe('a dangling foreign key is found, named, and refuses the copy', () => {
  let mongo: MongoTestDatabase;
  let blocked: AuditBlockedError;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(orphanFixtures());
    let caught: unknown;
    try {
      await runBackfill({ db, source: mongo.source, batchSize: 3 });
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof AuditBlockedError)) {
      throw new Error(
        `Expected the run to be REFUSED by the audit; got ${String(caught)}. ` +
          'Three documents in this fixture set name a parent that does not exist.'
      );
    }
    blocked = caught;
  });

  afterAll(async () => {
    await mongo.drop();
  });

  it('BLOCKS on a NOT NULL orphan — the exact production failure', () => {
    const finding = blocked.findings.find(
      (candidate) =>
        candidate.kind === 'referential-integrity' &&
        candidate.detail.includes('bundles_user_id_users_id_fk')
    );
    expect(finding).toBeDefined();

    // The four things an operator needs to act without opening the code: the
    // relation, the referencing collection, the missing VALUE, and the
    // referencing document's own id.
    expect(finding?.detail).toContain('bundles.user_id -> users.id');
    expect(finding?.collection).toBe('bundles');
    expect(finding?.detail).toContain(DELETED_USER);
    expect(finding?.sampleIds).toContain(ORPHAN_BUNDLE);
    expect(finding?.documents).toBe(1);

    // NOT NULL, so there is no value that satisfies the constraint — and the
    // report has to say so rather than imply NULL is available.
    expect(finding?.detail).toContain('NOT NULL');
    expect(finding?.detail).toContain('no override flag');
  });

  it('reports a NULLABLE `ON DELETE SET NULL` orphan as the schema\'s own answer', () => {
    const orphans = blocked.findings.find(
      (candidate) =>
        candidate.kind === 'referential-integrity' &&
        candidate.detail.includes('reminders_related_message_id_messages_id_fk')
    );
    expect(orphans).toBeDefined();
    expect(orphans?.detail).toContain(DELETED_MESSAGE);
    expect(orphans?.sampleIds).toContain(ORPHAN_REMINDER);

    // The recommendation, and it is a recommendation: SET NULL on a nullable
    // column is what the schema already says happens when the parent goes, so
    // writing NULL here would land the row exactly where that policy puts it.
    expect(orphans?.detail).toContain('ON DELETE SET NULL');
    expect(orphans?.detail).toContain('NOT applied here');
  });

  it('reports a NULLABLE `ON DELETE CASCADE` orphan as a DIFFERENT question', () => {
    const orphans = blocked.findings.find(
      (candidate) =>
        candidate.kind === 'referential-integrity' &&
        candidate.detail.includes('push_tokens_application_id_applications_id_fk')
    );
    expect(orphans).toBeDefined();
    expect(orphans?.detail).toContain(DELETED_APPLICATION);
    expect(orphans?.sampleIds).toContain(ORPHAN_PUSH_TOKEN);

    // Nullable, so NULL is representable — but CASCADE says the row goes with
    // its parent, never survives holding NULL. Collapsing this into the SET NULL
    // case would be the audit inventing a policy, which is the thing it must
    // not do. Asserted against the OTHER case's wording so the two cannot drift
    // into one message.
    expect(orphans?.detail).toContain('ON DELETE cascade');
    expect(orphans?.detail).not.toContain('ON DELETE SET NULL');
    expect(orphans?.detail).toContain('would DROP');
  });

  it('stays SILENT on the healthy relations — the control', () => {
    const referential = blocked.findings.filter(
      (finding) => finding.kind === 'referential-integrity'
    );
    // EXACTLY three. The fixture set is the clean one plus three dangling
    // documents, so a fourth finding means the audit reported a reference that
    // resolves — the failure mode that would block a migration over healthy data
    // and get this gate switched off by whoever hit it next.
    expect(referential).toHaveLength(3);

    // `labels.user_id -> users.id` is the same relation SHAPE as the broken
    // `bundles.user_id` one, on the same target table, and it is fine.
    expect(referential.map((finding) => finding.detail).join('\n')).not.toContain(
      'labels_user_id_users_id_fk'
    );

    // And the healthy bundle beside the orphaned one is never named.
    const bundles = referential.find((finding) => finding.collection === 'bundles');
    expect(bundles?.sampleIds).toEqual([ORPHAN_BUNDLE]);
  });

  it('resolves a SELF-reference that points FORWARD in `_id` order', () => {
    // Precondition, and the whole point of the fixture: the child is streamed
    // BEFORE its parent, so at the moment the child's row is built no such
    // parent has been seen. Only the end-of-collection recheck can resolve it.
    // Without this assertion the test would pass just as happily against a
    // fixture pair that happened to sort the other way round.
    expect(FORWARD_CHILD_TOPIC < FORWARD_PARENT_TOPIC).toBe(true);

    const referential = blocked.findings.filter(
      (finding) => finding.kind === 'referential-integrity'
    );
    const details = referential.map((finding) => finding.detail).join('\n');
    expect(details).not.toContain('topics_parent_topic_id_topics_id_fk');
    // `users.parent_account_id` is the same class — SUB names ORG, both `users`
    // documents, and the copy defers the column to a second pass for it.
    expect(details).not.toContain('users_parent_account_id_users_id_fk');
    expect([SUB, ORG].every((id) => id.length === 24)).toBe(true);
  });

  it('refuses BEFORE the copy — nothing was written', async () => {
    const [row] = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from bundles`
    );
    expect(row?.count).toBe(0);
  });

  it('quotes what it inspected, so the answer is checkable', async () => {
    const resolutions = await resolutionsFor(mongo);
    const discovery = await discover(mongo.source);
    const report = await auditReferentialIntegrity(mongo.source, discovery.migrated, resolutions);

    expect(report.ran).toBe(true);
    expect(report.skippedReason).toBeNull();
    expect(report.relationsInspected).toBeGreaterThanOrEqual(150);
    expect(report.collectionsInspected).toBe(discovery.migrated.length);
    expect(report.documentsInspected).toBeGreaterThan(0);
    expect(report.referencesChecked).toBeGreaterThan(0);

    // Every orphan, by value, with the referencing document ids under it — the
    // structure the CLI prints and the reason a relation with one deleted
    // account behind 44 rows reads as one line rather than 44.
    const bundles = report.orphans.find((entry) => entry.collection === 'bundles');
    expect(bundles?.resolvability).toBe('not-null');
    expect(bundles?.distinctValues).toBe(1);
    expect(bundles?.values).toEqual([
      { value: DELETED_USER, documents: 1, documentIds: [ORPHAN_BUNDLE] },
    ]);

    const pushTokens = report.orphans.find((entry) => entry.collection === 'pushtokens');
    expect(pushTokens?.resolvability).toBe('nullable-other-action');
    const reminders = report.orphans.find((entry) => entry.collection === 'reminders');
    expect(reminders?.resolvability).toBe('nullable-set-null');
  });
});

// ---------------------------------------------------------------------------
// 3. the control, on its own
// ---------------------------------------------------------------------------

describe('a source whose references all resolve', () => {
  let mongo: MongoTestDatabase;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(cleanFixtures());
  });

  afterAll(async () => {
    await mongo.drop();
  });

  it('reports nothing — and says how much it looked at while doing so', async () => {
    const summary = await runBackfill({ db, source: mongo.source, batchSize: 5 });

    expect(summary.findings.filter((finding) => finding.kind === 'referential-integrity')).toEqual(
      []
    );

    // A clean answer means nothing without these. Every one of them would be
    // zero for a traversal that never ran, which is the state the audit was in
    // before this file existed.
    const report = summary.referentialIntegrity;
    expect(report.ran).toBe(true);
    expect(report.relationsInspected).toBeGreaterThanOrEqual(150);
    expect(report.collectionsInspected).toBe(summary.discovery.migrated.length);
    expect(report.documentsInspected).toBeGreaterThan(50);
    expect(report.rowsInspected).toBeGreaterThan(report.documentsInspected);
    expect(report.referencesChecked).toBeGreaterThan(50);

    // Derived and EXERCISED are different numbers and the report must not
    // conflate them. Measured on this fixture set: 165 derived, 148 exercised.
    // The floor is what makes "no orphans" mean something — a traversal that
    // built rows but resolved almost no references would satisfy every other
    // count here. The gap is real too: the seventeen unexercised relations are
    // optional columns this data leaves null, which is a fact about the
    // fixtures rather than a gap in the check.
    expect(report.relationsExercised).toBeGreaterThanOrEqual(100);
    expect(report.relationsExercised).toBeLessThan(report.relationsInspected);
  });
});

// ---------------------------------------------------------------------------
// 4. the vacuity floor
// ---------------------------------------------------------------------------

describe('a pass that inspected nothing FAILS instead of reporting clean', () => {
  it('refuses when the plans it was given declare no foreign key', async () => {
    // `link_previews` is one of the eight tables with no outgoing foreign key.
    // Handing the audit only that plan is the shape of a derivation that found
    // nothing: it would otherwise return a perfectly clean report.
    const mongo = await seed({ linkpreviews: cleanFixtures().linkpreviews ?? [] });
    try {
      const resolutions = await resolutionsFor(mongo);
      await expect(
        auditReferentialIntegrity(
          mongo.source,
          [{ plan: planFor('linkpreviews'), documents: 1 }],
          resolutions
        )
      ).rejects.toBeInstanceOf(VacuousReferentialIntegrityError);
    } finally {
      await mongo.drop();
    }
  });

  it('refuses when discovery counted documents the traversal never read', async () => {
    // The shape of a broken stream: discovery says the collection holds 7
    // documents and the pass reads none. A report saying "0 orphans" here would
    // be a claim about a collection it never opened.
    const mongo = await seed({});
    try {
      const resolutions = await resolutionsFor(mongo);
      await expect(
        auditReferentialIntegrity(
          mongo.source,
          [{ plan: planFor('bundles'), documents: 7 }],
          resolutions
        )
      ).rejects.toBeInstanceOf(VacuousReferentialIntegrityError);
    } finally {
      await mongo.drop();
    }
  });

  it('does NOT refuse when the collection is genuinely empty', async () => {
    // The other half, and the one that keeps the floor from crying wolf: a
    // mapped collection with zero documents is a normal, correct nothing.
    // Asserting only the rejection above would pass against a floor that fired
    // on every empty collection in production.
    const mongo = await seed({});
    try {
      const resolutions = await resolutionsFor(mongo);
      const report = await auditReferentialIntegrity(
        mongo.source,
        [{ plan: planFor('bundles'), documents: 0 }],
        resolutions
      );
      expect(report.ran).toBe(true);
      expect(report.documentsInspected).toBe(0);
      expect(report.orphans).toEqual([]);
    } finally {
      await mongo.drop();
    }
  });

  it('is silent, not vacuous, for a run with no collections to copy at all', async () => {
    // The one case that is legitimately nothing: discovery already reported it.
    const mongo = await seed({ refreshtokens: [{ _id: 'rt1', tokenHash: 'h' }] });
    try {
      const resolutions = await resolutionsFor(mongo);
      const report = await auditReferentialIntegrity(mongo.source, [], resolutions);
      expect(report.ran).toBe(true);
      expect(report.orphans).toEqual([]);
      expect(report.collectionsInspected).toBe(0);
    } finally {
      await mongo.drop();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. skipped is not clean
// ---------------------------------------------------------------------------

describe('when an earlier audit already blocks, the pass is NOT RUN', () => {
  it('says so, rather than reporting a clean referential answer', async () => {
    await truncateAll();
    // The referential pass runs the plans' own transforms, and a transform
    // THROWS on a document the schema refuses — so running it here would replace
    // the enum report with a `BackfillValueError` naming one document.
    const mongo = await seed({ applications: dirtyFixtures().applications ?? [] });
    try {
      const resolutions = await resolutionsFor(mongo);
      const discovery = await discover(mongo.source);
      const { findings, referentialIntegrity } = await runAudits(
        mongo.source,
        discovery,
        resolutions
      );

      // The enum finding survived — that is what the skip protects.
      expect(findings.some((finding) => finding.detail.includes('applications.status'))).toBe(true);

      // And the referential answer is UNKNOWN, said out loud. `ran: false` with
      // zero orphans must never be readable as a clean pass.
      expect(referentialIntegrity.ran).toBe(false);
      expect(referentialIntegrity.skippedReason).toContain('UNKNOWN, not clean');
      expect(referentialIntegrity.orphans).toEqual([]);
      expect(referentialIntegrity.relationsInspected).toBe(0);
      expect(referentialIntegrity.findings).toEqual([]);
    } finally {
      await mongo.drop();
    }
  });
});

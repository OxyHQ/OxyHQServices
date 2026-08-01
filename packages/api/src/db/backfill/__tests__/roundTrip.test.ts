/**
 * The end-to-end proof: seed a REAL MongoDB, run the REAL backfill against a
 * REAL Postgres, and check what arrived.
 *
 * Both databases are throwaway and created per run — Postgres by
 * `jest.globalSetup.ts`, Mongo by `createMongoTestDatabase()`. Neither is a
 * fake, for the reason spelled out in `mongoTestSource.ts`: the audits are
 * written in Mongo's query language and a fake would only prove it agrees with
 * itself.
 *
 * The four things this file has to establish, in order of how badly each would
 * hurt if it were wrong:
 *
 * 1. **The verifier can detect missing data.** Mutation-tested: skip a
 *    collection, assert the verifier goes red AND names it. Everything else
 *    here rests on the verifier being real.
 * 2. Every mapped collection round-trips, with counts matching.
 * 3. Child decompositions produce the right number of rows — element counts,
 *    not document counts.
 * 4. Dirty fixtures are REPORTED, not silently dropped and not silently
 *    written.
 */

import { eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { connectPostgres, closePostgres, type Database } from '../../../config/postgres';
import { createTestDatabase, dropTestDatabase } from '../../testDatabase';
import {
  applications,
  authChallenges,
  deviceSessionAccounts,
  emailFilterActions,
  emailFilterConditions,
  fileLinks,
  fileVariants,
  files,
  labels,
  messageAttachments,
  messageRecipients,
  moderationPolicySeverityRules,
  moderationPolicyStandingThresholds,
  pushTokens,
  reputationReviewingReliability,
  transparencyCheckpointAnchors,
  transparencyCheckpointSignatures,
  transparencyCheckpointSnapshotEntries,
  updateChannelRollbacks,
  userAncestors,
  userAuthMethods,
  userLinkMetadata,
  userLocations,
  userVerifiedDomains,
  users,
  userCredits,
  userFollows,
  validationRequestValidators,
  webauthnCredentials,
  appUpdateAssets,
  linkPreviews,
  identityBackups,
  nodeIngestWitnesses,
  transparencyCheckpoints,
} from '../../schema';
import {
  cleanFixtures,
  dirtyFixtures,
  FILE_FEDERATION,
  FILE_LINK_PREVIEW,
  FILE_USER,
  MESSAGE,
  ORG,
  SUB,
  USER_A,
  type FixtureSet,
} from '../backfillFixtures';
import { AuditBlockedError, runBackfill, UnknownCollectionError } from '../runner';
import { COLLECTION_PLANS } from '../collectionMap';
import { createMongoTestDatabase, type MongoTestDatabase } from '../mongoTestSource';
import { verifyBackfill, VerificationError } from '../verify';
import { planTables, tableName } from '../plan';

jest.setTimeout(300_000);

let db: Database;
let sharedDatabaseUrl: string | undefined;
let ownDatabaseUrl: string;

// This suite TRUNCATES every table the plans write, so it owns its own
// throwaway database rather than sharing the run-wide one — the same reason
// `transparency.service.test.ts` does. Jest runs suites in parallel against one
// database by default, and a truncate is not something a neighbour survives.
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

/** Seed a fixture set into a fresh throwaway Mongo. */
async function seed(fixtures: FixtureSet): Promise<MongoTestDatabase> {
  const mongo = await createMongoTestDatabase();
  for (const [collection, documents] of Object.entries(fixtures)) {
    await mongo.seed(collection, documents);
  }
  return mongo;
}

/** Wipe every table the plans write, so each test starts from a known state. */
async function truncateAll(): Promise<void> {
  const names = new Set<string>();
  for (const plan of COLLECTION_PLANS) {
    for (const table of planTables(plan)) names.add(`"${tableName(table)}"`);
  }
  // ONE statement, so the FK graph never has to be respected in between —
  // `truncate a, b, c cascade` drops them together.
  await db.execute(sql.raw(`truncate table ${[...names].join(', ')} cascade`));
}

/** Rows currently in a table. */
async function rowCount(table: PgTable): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(table);
  return row?.value ?? 0;
}

describe('backfill round trip against a real MongoDB and a real Postgres', () => {
  let mongo: MongoTestDatabase;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(cleanFixtures());
    await runBackfill({ db, source: mongo.source, batchSize: 2 });
  });

  afterAll(async () => {
    await mongo.drop();
  });

  it('verifies clean — counts and field fidelity for every seeded collection', async () => {
    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    const report = await verifyBackfill(db, mongo.source, plans, { batchSize: 2 });

    // Vacuity floor: the assertion above passes trivially if nothing was
    // compared, so the counts are asserted too.
    expect(report.failures).toEqual([]);
    expect(report.checkedCollections).toBeGreaterThanOrEqual(70);
    expect(report.comparedDocuments).toBeGreaterThanOrEqual(70);
    expect(report.comparedFields).toBeGreaterThan(500);
  });

  it('copies every mapped collection that was seeded', async () => {
    const live = new Set(await mongo.source.listCollections());
    const seededPlans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    // The fixture set covers the whole map; if it stops doing so, this says so
    // rather than quietly verifying less.
    expect(seededPlans.length).toBe(COLLECTION_PLANS.length);
  });

  it('copies ids VERBATIM, including the two non-ObjectId primary keys', async () => {
    const [user] = await db.select().from(users).where(eq(users.id, USER_A));
    expect(user?.id).toBe(USER_A);

    // `usercredits._id` is a 24-hex STRING keying `user_credits.user_id`.
    const credits = await db.select().from(userCredits);
    expect(credits.map((row) => row.userId)).toEqual([USER_A]);

    // `linkpreviews._id` is the SHA-256 of the normalized URL.
    const previews = await db.select().from(linkPreviews);
    expect(previews[0]?.id).toBe('e'.repeat(64));
  });

  it('splits files.ownerUserId into owner_user_id and system_owner', async () => {
    const rows = await db.select().from(files);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(FILE_USER)?.ownerUserId).toBe(USER_A);
    expect(byId.get(FILE_USER)?.systemOwner).toBeNull();

    // The sentinels move, and `owner_user_id` becomes NULL — which is what lets
    // it be a real foreign key for the 99.99% of rows that ARE user-owned.
    expect(byId.get(FILE_FEDERATION)?.ownerUserId).toBeNull();
    expect(byId.get(FILE_FEDERATION)?.systemOwner).toBe('__federation__');
    expect(byId.get(FILE_LINK_PREVIEW)?.systemOwner).toBe('__link_preview_cache__');
  });

  it('fills the deferred self-references after every row exists', async () => {
    // `users.parent_account_id` is inserted NULL and filled by pass B; a row
    // still NULL here means pass B never ran.
    const [sub] = await db.select().from(users).where(eq(users.id, SUB));
    expect(sub?.parentAccountId).toBe(ORG);
    expect(sub?.rootAccountId).toBe(ORG);
    expect(sub?.automationOwnerId).toBe(USER_A);
  });

  it('re-applies the Mongoose SETTER that has no Postgres counterpart', async () => {
    // `push_tokens.token` was `trim: true` in Mongoose — application behaviour,
    // not schema. Dropping it silently changes what is stored AND lets an
    // untrimmed row collide with its own trimmed self.
    const [token] = await db.select().from(pushTokens);
    expect(token?.token).toBe('ExponentPushToken[abc]');
  });

  it('maps the legacy null `purpose` once, so no reader needs the branch', async () => {
    const rows = await db.select().from(authChallenges);
    expect(rows.map((row) => row.purpose)).toEqual(['signin']);
  });

  it('keeps a bytea column byte-identical', async () => {
    const [credential] = await db.select().from(webauthnCredentials);
    expect(Buffer.from(credential?.credentialPublicKey ?? [])).toEqual(
      Buffer.from([1, 2, 3, 4, 250])
    );
  });

  it('keeps a client-supplied ISO string as text rather than reformatting it', async () => {
    const [backup] = await db.select().from(identityBackups);
    expect(backup?.clientCreatedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('converts epoch-millisecond fields to timestamptz', async () => {
    const [witness] = await db.select().from(nodeIngestWitnesses);
    expect(witness?.ingestedAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    const [checkpoint] = await db.select().from(transparencyCheckpoints);
    expect(checkpoint?.periodEnd.toISOString()).toBe('2026-02-03T04:05:06.000Z');
  });
});

describe('child-table decompositions produce one row per ELEMENT', () => {
  let mongo: MongoTestDatabase;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(cleanFixtures());
    await runBackfill({ db, source: mongo.source, batchSize: 5 });
  });

  afterAll(async () => {
    await mongo.drop();
  });

  // `source` names the ARRAY each table decomposes, because that is the fact
  // under test: the expected count is a number of array ELEMENTS, never a
  // number of documents.
  it.each<{ name: string; table: PgTable; expected: number; source: string }>([
    { name: 'user_locations', table: userLocations, expected: 2, source: 'users[0].locations' },
    { name: 'user_auth_methods', table: userAuthMethods, expected: 1, source: 'users[0].authMethods' },
    { name: 'user_verified_domains', table: userVerifiedDomains, expected: 1, source: 'users[0].verifiedDomains' },
    { name: 'user_ancestors', table: userAncestors, expected: 1, source: 'users[2].ancestors' },
    { name: 'user_link_metadata', table: userLinkMetadata, expected: 1, source: 'users[0].linksMetadata' },
    // to: 2 + cc: 1 + bcc: 0 — THREE arrays into ONE table.
    { name: 'message_recipients', table: messageRecipients, expected: 3, source: 'messages[0].{to,cc,bcc}' },
    { name: 'message_attachments', table: messageAttachments, expected: 1, source: 'messages[0].attachments' },
    { name: 'file_links', table: fileLinks, expected: 1, source: 'files[0].links' },
    { name: 'file_variants', table: fileVariants, expected: 1, source: 'files[0].variants' },
    { name: 'device_session_accounts', table: deviceSessionAccounts, expected: 2, source: 'devicesessions[0].accounts' },
    { name: 'email_filter_conditions', table: emailFilterConditions, expected: 2, source: 'emailfilters[0].conditions' },
    { name: 'email_filter_actions', table: emailFilterActions, expected: 2, source: 'emailfilters[0].actions' },
    { name: 'app_update_assets', table: appUpdateAssets, expected: 1, source: 'appupdates[0].assets' },
    {
      name: 'update_channel_rollbacks',
      table: updateChannelRollbacks,
      expected: 1,
      source: 'updatechannels[0].rollbacksToEmbedded',
    },
    {
      name: 'moderation_policy_severity_rules',
      table: moderationPolicySeverityRules,
      expected: 2,
      source: 'moderationpolicies[0].severityRules',
    },
    {
      name: 'moderation_policy_standing_thresholds',
      table: moderationPolicyStandingThresholds,
      expected: 2,
      source: 'moderationpolicies[0].standingThresholds',
    },
    // categoryReliability (1) + languageReliability (1) — TWO maps into ONE table.
    {
      name: 'reputation_reviewing_reliability',
      table: reputationReviewingReliability,
      expected: 2,
      source: 'reputationbalances[0].reviewing.*Reliability',
    },
    {
      name: 'validation_request_validators',
      table: validationRequestValidators,
      expected: 2,
      source: 'validationrequests[0].selectedValidatorIds',
    },
    {
      name: 'transparency_checkpoint_anchors',
      table: transparencyCheckpointAnchors,
      expected: 1,
      source: 'transparencycheckpoints[0].anchors',
    },
    {
      name: 'transparency_checkpoint_signatures',
      table: transparencyCheckpointSignatures,
      expected: 1,
      source: 'transparencycheckpoints[0].signatures',
    },
    {
      name: 'transparency_checkpoint_snapshot_entries',
      table: transparencyCheckpointSnapshotEntries,
      expected: 1,
      source: 'transparencycheckpoints[0].snapshot',
    },
  ])('$name holds one row per element of $source', async ({ table, expected }) => {
    expect(await rowCount(table)).toBe(expected);
  });

  it('keeps the ordinal where order is part of the contract', async () => {
    // Filter conditions are evaluated and actions APPLIED in order, so a set is
    // not the same object.
    const conditions = await db.select().from(emailFilterConditions);
    expect(conditions.sort((a, b) => a.ord - b.ord).map((row) => row.field)).toEqual([
      'from',
      'subject',
    ]);

    // `message_recipients.ord` restarts per KIND — the unique is
    // `(message_id, kind, ord)`.
    const recipients = await db
      .select()
      .from(messageRecipients)
      .where(eq(messageRecipients.messageId, MESSAGE));
    const to = recipients.filter((row) => row.kind === 'to').sort((a, b) => a.ord - b.ord);
    expect(to.map((row) => row.address)).toEqual(['nate@oxy.so', 'other@oxy.so']);
    expect(recipients.filter((row) => row.kind === 'cc').map((row) => row.ord)).toEqual([0]);
  });

  it('reads coordinates by NAME, so the historical transposition cannot travel', async () => {
    const rows = await db.select().from(userLocations);
    const home = rows.find((row) => row.locationKey === 'home');
    // Barcelona: latitude ~41.39 N, longitude ~2.17 E. A transposition would
    // put this at 2.17 N / 41.39 E — off the coast of Somalia, and a test that
    // only asserted "a row came back" would pass against exactly that bug.
    expect(home?.latitude).toBeCloseTo(41.3874, 4);
    expect(home?.longitude).toBeCloseTo(2.1686, 4);
    // The second location has no coordinates at all, and the CHECK requires
    // both halves or neither.
    const work = rows.find((row) => row.locationKey === 'work');
    expect(work?.latitude).toBeNull();
    expect(work?.longitude).toBeNull();
  });
});

describe('idempotence and resumability', () => {
  let mongo: MongoTestDatabase;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(cleanFixtures());
  });

  afterAll(async () => {
    await mongo.drop();
  });

  it('is safe to run twice — the second run writes no duplicate rows', async () => {
    await runBackfill({ db, source: mongo.source, batchSize: 3 });
    const after1 = await rowCount(users);
    const links1 = await rowCount(fileLinks);
    const recipients1 = await rowCount(messageRecipients);

    // A full re-run from zero, with no checkpoint: every insert conflicts on
    // its own verbatim id and is skipped.
    await runBackfill({ db, source: mongo.source, batchSize: 3 });
    expect(await rowCount(users)).toBe(after1);
    expect(await rowCount(fileLinks)).toBe(links1);
    expect(await rowCount(messageRecipients)).toBe(recipients1);

    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    await expect(verifyBackfill(db, mongo.source, plans, { batchSize: 3 })).resolves.toBeDefined();
  });
});

describe('the verifier can detect missing data — mutation test', () => {
  let mongo: MongoTestDatabase;

  beforeAll(async () => {
    await truncateAll();
    mongo = await seed(cleanFixtures());
  });

  afterAll(async () => {
    await mongo.drop();
  });

  it('FAILS and NAMES a collection the backfill was made to skip', async () => {
    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));

    // THE MUTATION: copy everything except `labels`. This is the "backfill skips
    // a collection" scenario, injected through the runner's own `only` filter
    // rather than by editing code, so the mutation is disarmed by construction
    // when the test ends.
    const skipped = 'labels';
    const copied = plans.map((plan) => plan.collection).filter((name) => name !== skipped);
    await runBackfill({ db, source: mongo.source, batchSize: 5 }, undefined, copied);

    // Precondition: the mutation actually took effect. Without this the
    // assertion below could pass because the copy failed for some other reason.
    expect(await rowCount(labels)).toBe(0);
    expect(await rowCount(users)).toBeGreaterThan(0);

    let error: unknown;
    try {
      await verifyBackfill(db, mongo.source, plans, { batchSize: 5 });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(VerificationError);
    if (!(error instanceof VerificationError)) throw new Error('unreachable');
    // It must NAME the offending collection and table, not merely fail.
    expect(error.message).toContain(skipped);
    expect(error.message).toContain('expected 1 row(s) from labels, found 0');
    expect(error.report.failures.some((failure) => failure.collection === skipped)).toBe(true);
  });

  it('FAILS when a CHILD table is short, which a document count would miss', async () => {
    await truncateAll();
    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    await runBackfill({ db, source: mongo.source, batchSize: 5 });

    // Delete ONE recipient row. Every document is still present and the parent
    // `messages` count is untouched — only the element count moves. A verifier
    // that counted documents would report success here.
    await db.delete(messageRecipients).where(eq(messageRecipients.kind, 'cc'));

    let error: unknown;
    try {
      await verifyBackfill(db, mongo.source, plans, { batchSize: 5 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(VerificationError);
    if (!(error instanceof VerificationError)) throw new Error('unreachable');
    expect(error.message).toContain('message_recipients');
    expect(error.report.failures.some((failure) => failure.kind === 'child-row-count')).toBe(true);
  });

  it('FAILS when a stored FIELD is wrong, which a row count would miss', async () => {
    await truncateAll();
    const live = new Set(await mongo.source.listCollections());
    const plans = COLLECTION_PLANS.filter((plan) => live.has(plan.collection));
    await runBackfill({ db, source: mongo.source, batchSize: 5 });

    // Corrupt one value without changing any count — the shape a transform
    // silently dropping a column would produce.
    await db.update(users).set({ bio: 'tampered' }).where(eq(users.id, USER_A));

    let error: unknown;
    try {
      await verifyBackfill(db, mongo.source, plans, { batchSize: 5 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(VerificationError);
    if (!(error instanceof VerificationError)) throw new Error('unreachable');
    expect(error.report.failures.some((failure) => failure.kind === 'field-fidelity')).toBe(true);
    expect(error.message).toContain('tampered');
  });
});

describe('dirty production data is REPORTED, never silently dropped or written', () => {
  it('refuses the copy and names the enum value a CHECK would reject', async () => {
    await truncateAll();
    const mongo = await seed({ applications: dirtyFixtures().applications ?? [] });
    try {
      let error: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 5 });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AuditBlockedError);
      if (!(error instanceof AuditBlockedError)) throw new Error('unreachable');
      expect(error.message).toContain('"restricted"');
      expect(error.message).toContain('applications.status');
      expect(error.message).toContain('68ab000000000000000000a1');

      // And nothing was written — the refusal is BEFORE the copy, not partway.
      expect(await rowCount(applications)).toBe(0);
    } finally {
      await mongo.drop();
    }
  });

  it('refuses and names BOTH sides of a case-insensitive collision', async () => {
    await truncateAll();
    const fixtures = cleanFixtures();
    const mongo = await seed({ users: fixtures.users ?? [], labels: dirtyFixtures().labels ?? [] });
    try {
      let error: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 5 });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AuditBlockedError);
      if (!(error instanceof AuditBlockedError)) throw new Error('unreachable');
      expect(error.message).toContain('labels_user_id_lower_name_key');
      // Both rows, so a human can decide which survives — the migration must not.
      expect(error.message).toContain('68ab000000000000000000a2');
      expect(error.message).toContain('68ab000000000000000000a3');
      expect(await rowCount(labels)).toBe(0);
    } finally {
      await mongo.drop();
    }
  });

  it('refuses an undeclared files system-owner sentinel and names it', async () => {
    await truncateAll();
    const fixtures = cleanFixtures();
    const mongo = await seed({ users: fixtures.users ?? [], files: dirtyFixtures().files ?? [] });
    try {
      let error: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 5 });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AuditBlockedError);
      if (!(error instanceof AuditBlockedError)) throw new Error('unreachable');
      expect(error.message).toContain('__something_else__');
      expect(error.message).toContain('files_system_owner_check');
      expect(await rowCount(files)).toBe(0);
    } finally {
      await mongo.drop();
    }
  });

  it('THROWS on a non-user follow rather than filtering it away', async () => {
    await truncateAll();
    const fixtures = cleanFixtures();
    const mongo = await seed({ users: fixtures.users ?? [], follows: dirtyFixtures().follows ?? [] });
    try {
      // `followType` is not enum-audited (the audit predicts a CHECK, and there
      // is no `follow_type` column at all), so this one surfaces from the
      // TRANSFORM — which is the point: the row is refused, not skipped.
      await expect(runBackfill({ db, source: mongo.source, batchSize: 5 })).rejects.toThrow(
        /followType.*"hashtag"/s
      );
      expect(await rowCount(userFollows)).toBe(0);
    } finally {
      await mongo.drop();
    }
  });
});

describe('an unmapped collection is a hard failure', () => {
  it('refuses to run and names the collection nobody accounted for', async () => {
    await truncateAll();
    const mongo = await seed({ somethingnobodyremembered: [{ _id: 'x', value: 1 }] });
    try {
      let error: unknown;
      try {
        await runBackfill({ db, source: mongo.source, batchSize: 5 });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(UnknownCollectionError);
      if (!(error instanceof UnknownCollectionError)) throw new Error('unreachable');
      expect(error.message).toContain('somethingnobodyremembered');
      expect(error.message).toContain('neither mapped nor explicitly excluded');
    } finally {
      await mongo.drop();
    }
  });

  it('reports an excluded collection with its document count and reason', async () => {
    await truncateAll();
    const mongo = await seed({
      refreshtokens: [{ _id: 'rt1', tokenHash: 'h' }],
      devicetokens: [{ _id: 'dt1', tokenHash: 'h' }],
    });
    try {
      const summary = await runBackfill({ db, source: mongo.source, batchSize: 5 });
      const excluded = Object.fromEntries(
        summary.discovery.excluded.map((entry) => [entry.collection, entry])
      );
      expect(excluded.refreshtokens?.documents).toBe(1);
      expect(excluded.devicetokens?.documents).toBe(1);
      expect(excluded.devicetokens?.reason).toContain('NOT the push-token registry');
      // Nothing was copied from either.
      expect(await rowCount(pushTokens)).toBe(0);
    } finally {
      await mongo.drop();
    }
  });
});

/**
 * Measure the backfill's throughput against production-SHAPED data.
 *
 * Answers one question with numbers rather than an estimate: how long does the
 * real 494,778-document copy take, and where does the time go?
 *
 * It seeds a throwaway MongoDB with the production DISTRIBUTION (the same
 * document counts per collection, scaled by `--scale`), runs the real copy
 * against a throwaway Postgres, and reports rows/second per collection plus a
 * projected wall clock.
 *
 * ```bash
 * MONGODB_URI=mongodb://127.0.0.1:27017 \
 * DATABASE_URL=postgres://oxy:oxy@127.0.0.1:5432/oxy_dev \
 *   bun run packages/api/scripts/backfill-benchmark.ts --scale=0.1
 * ```
 *
 * It is a script and not a jest test on purpose: at full scale it writes half a
 * million rows and takes minutes, which is not something to put in a suite that
 * runs on every commit. The CORRECTNESS of the copy is proved by
 * `src/db/backfill/__tests__/roundTrip.test.ts`; this measures only speed.
 */

import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { closePostgres, connectPostgres } from '../src/config/postgres';
import { mongoSourceFromDb, type MongoSource } from '../src/db/backfill/mongoSource';
import { COLLECTION_PLANS } from '../src/db/backfill/collectionMap';
import { planTables, tableName } from '../src/db/backfill/plan';
import { copyCollection, DEFAULT_BATCH_SIZE } from '../src/db/backfill/runner';

/**
 * The measured production distribution (2026-08-01): 494,778 documents across
 * 41 non-empty collections. Only the collections that carry real volume are
 * listed; the rest are below 20 documents and contribute nothing measurable.
 */
const PRODUCTION_COUNTS: Record<string, number> = {
  files: 296_924,
  linkpreviews: 75_172,
  users: 59_927,
  appusersignals: 32_966,
  securityactivities: 1_179,
  messages: 1_057,
  senderavatars: 279,
  notifications: 136,
  follows: 85,
  reputationbalances: 76,
  appendorsementedges: 62,
  reputationtransactions: 62,
  mailboxes: 56,
  appaffinityeventseens: 50,
  devicesessions: 47,
  bundles: 44,
  appaffinityedges: 29,
  validationrequests: 23,
  applicationcredentials: 22,
  transparencycheckpoints: 20,
  sessions: 20,
  applications: 20,
};

/** Documents excluded from the copy but counted in the 494,778 total. */
const EXCLUDED_DOCUMENTS = 26_208 + 211 + 22; // refreshtokens + devicetokens + fedcmgrants

const T0 = new Date('2026-01-02T03:04:05.000Z');

function hexId(index: number, prefix: string): string {
  return `${prefix}${index.toString(16).padStart(24 - prefix.length, '0')}`.slice(0, 24);
}

function oid(hex: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(hex);
}

/** A `users` document with a realistic column spread. */
function userDoc(index: number): Record<string, unknown> {
  return {
    _id: oid(hexId(index, '11')),
    username: `bench_user_${index}`,
    email: `bench_${index}@example.com`,
    name: { first: 'Bench', last: `User${index}` },
    kind: 'personal',
    accountStatus: 'active',
    type: 'local',
    color: 'oxy',
    languages: ['en-US'],
    bio: 'A representative biography of roughly the length real ones run to.',
    privacySettings: { isPrivateAccount: false },
    notificationPreferences: { pushEnabled: true },
    userPreferences: { theme: 'system' },
    federation: {},
    createdAt: T0,
    updatedAt: T0,
  };
}

/** A `files` document — the largest collection, and the sentinel split. */
function fileDoc(index: number, ownerCount: number): Record<string, unknown> {
  // One file in twenty is system-owned, matching the federation/link-preview
  // caches' share of the real collection closely enough to exercise the split.
  const systemOwned = index % 20 === 0;
  return {
    _id: oid(hexId(index, '22')),
    sha256: randomBytes(32).toString('hex'),
    size: 4096 + index,
    mime: 'image/png',
    ext: 'png',
    ownerUserId: systemOwned ? '__federation_media_cache__' : hexId(index % ownerCount, '11'),
    status: 'active',
    visibility: systemOwned ? 'public' : 'private',
    purpose: systemOwned ? 'federation-media-cache' : 'user',
    storageKey: `assets/${index}`,
    originalName: `file-${index}.png`,
    metadata: { width: 800, height: 600 },
    // A fifth of files carry one link and one variant — the child-table load.
    links:
      index % 5 === 0
        ? [
            {
              app: 'mention',
              entityType: 'post',
              entityId: `post-${index}`,
              createdBy: hexId(index % ownerCount, '11'),
              createdAt: T0,
            },
          ]
        : [],
    variants:
      index % 5 === 0
        ? [{ type: 'thumbnail', key: `assets/${index}-t`, width: 64, height: 64, size: 512 }]
        : [],
    createdAt: T0,
    updatedAt: T0,
  };
}

/** A `linkpreviews` document — the string-`_id` collection. */
function linkPreviewDoc(index: number): Record<string, unknown> {
  return {
    _id: randomBytes(32).toString('hex'),
    requestedUrl: `https://example.com/a/${index}`,
    canonicalUrl: `https://example.com/a/${index}`,
    title: `Example ${index}`,
    description: 'A description of about the length a real Open Graph one runs to.',
    siteName: 'Example',
    status: 'resolved',
    version: 1,
    resolvedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  };
}

function appUserSignalDoc(index: number, ownerCount: number, applicationId: string) {
  return {
    _id: oid(hexId(index, '33')),
    applicationId: oid(applicationId),
    userId: oid(hexId(index % ownerCount, '11')),
    endorsementScore: index % 7,
    interestScore: (index % 11) / 11,
    createdAt: T0,
    updatedAt: T0,
  };
}

function securityActivityDoc(index: number, ownerCount: number) {
  return {
    _id: oid(hexId(index, '44')),
    userId: oid(hexId(index % ownerCount, '11')),
    eventType: 'sign_in',
    eventDescription: 'Signed in',
    severity: 'low',
    metadata: { method: 'passkey' },
    userAgent: 'Mozilla/5.0',
    deviceId: `dev-${index}`,
    timestamp: T0,
    createdAt: T0,
    updatedAt: T0,
  };
}

interface Measurement {
  readonly collection: string;
  readonly documents: number;
  readonly rows: number;
  readonly seconds: number;
}

async function main(): Promise<void> {
  const scaleArg = process.argv.find((arg) => arg.startsWith('--scale='));
  const scale = scaleArg === undefined ? 1 : Number(scaleArg.slice('--scale='.length));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('--scale must be a positive number');
  const batchArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
  const batchSize = batchArg === undefined ? DEFAULT_BATCH_SIZE : Number(batchArg.slice('--batch-size='.length));

  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  const url = new URL(mongoUri);
  url.pathname = `/oxy_backfill_bench_${randomBytes(6).toString('hex')}`;

  const connection = await mongoose.createConnection(url.toString()).asPromise();
  const selected = connection.db;
  if (!selected) throw new Error('no database selected');
  // Bound to a `const` the narrowing survives into the closures below;
  // `connection.db` is re-read on every access and narrows only locally.
  const mongoDb = selected;
  const source: MongoSource = mongoSourceFromDb(mongoDb, async () => {
    await connection.close();
  });

  const db = await connectPostgres();
  const scaled = (name: string): number => Math.max(1, Math.round((PRODUCTION_COUNTS[name] ?? 0) * scale));

  const userCount = scaled('users');
  const applicationId = hexId(1, '99');

  process.stdout.write(`Seeding MongoDB at scale ${scale}…\n`);
  await mongoDb.collection('users').insertMany(
    Array.from({ length: userCount }, (_unused, index) => userDoc(index))
  );
  await mongoDb.collection('applications').insertOne({
    _id: oid(applicationId),
    name: 'Bench',
    type: 'first_party',
    status: 'active',
    ownerAccountId: oid(hexId(0, '11')),
    createdByUserId: oid(hexId(0, '11')),
    createdAt: T0,
    updatedAt: T0,
  });

  // Seed in chunks so the driver's own batching does not dominate the setup.
  const SEED_CHUNK = 10_000;
  async function seedMany(
    name: string,
    total: number,
    build: (index: number) => Record<string, unknown>
  ): Promise<void> {
    for (let start = 0; start < total; start += SEED_CHUNK) {
      const size = Math.min(SEED_CHUNK, total - start);
      await mongoDb
        .collection(name)
        .insertMany(Array.from({ length: size }, (_unused, offset) => build(start + offset)));
    }
  }

  await seedMany('files', scaled('files'), (index) => fileDoc(index, userCount));
  await seedMany('linkpreviews', scaled('linkpreviews'), linkPreviewDoc);
  await seedMany('appusersignals', scaled('appusersignals'), (index) =>
    appUserSignalDoc(index, userCount, applicationId)
  );
  await seedMany('securityactivities', scaled('securityactivities'), (index) =>
    securityActivityDoc(index, userCount)
  );

  const benchmarked = ['users', 'applications', 'files', 'linkpreviews', 'appusersignals', 'securityactivities'];
  const plans = COLLECTION_PLANS.filter((plan) => benchmarked.includes(plan.collection));
  // Dependency order among the benchmarked set: users → applications →
  // everything else.
  const ordered = [...plans].sort(
    (a, b) => benchmarked.indexOf(a.collection) - benchmarked.indexOf(b.collection)
  );

  process.stdout.write(`\nCopying with batch size ${batchSize}…\n`);
  const measurements: Measurement[] = [];
  const runStarted = Date.now();
  for (const plan of ordered) {
    const startedAt = Date.now();
    const result = await copyCollection(plan, { db, source, batchSize });
    const seconds = (Date.now() - startedAt) / 1000;
    const rows = Object.values(result.rowsByTable).reduce((sum, value) => sum + value, 0);
    measurements.push({ collection: plan.collection, documents: result.documentsRead, rows, seconds });
    process.stdout.write(
      `  ${plan.collection.padEnd(20)} ${String(result.documentsRead).padStart(8)} docs  ` +
        `${String(rows).padStart(8)} rows  ${seconds.toFixed(2)}s  ` +
        `${Math.round(rows / Math.max(seconds, 0.001))} rows/s\n`
    );
  }
  const totalSeconds = (Date.now() - runStarted) / 1000;

  const totalDocuments = measurements.reduce((sum, entry) => sum + entry.documents, 0);
  const totalRows = measurements.reduce((sum, entry) => sum + entry.rows, 0);
  const docsPerSecond = totalDocuments / Math.max(totalSeconds, 0.001);

  process.stdout.write(
    `\nMeasured: ${totalDocuments} documents → ${totalRows} rows in ${totalSeconds.toFixed(2)}s ` +
      `(${Math.round(docsPerSecond)} docs/s, ${Math.round(totalRows / totalSeconds)} rows/s)\n`
  );

  // The projection quotes the MIGRATED document total, not the 494,778 that
  // includes the excluded collections — copying nothing takes no time, and
  // saying otherwise would flatter the number.
  const migratedTotal = 494_778 - EXCLUDED_DOCUMENTS;
  process.stdout.write(
    `Projected for the real ${migratedTotal} migrated documents ` +
      `(494,778 total minus ${EXCLUDED_DOCUMENTS} in excluded collections): ` +
      `${(migratedTotal / docsPerSecond / 60).toFixed(1)} minutes at this rate, SERIAL.\n` +
      'Levels run concurrently in the real runner, so this is an upper bound.\n'
  );

  const touched = new Set<string>();
  for (const plan of ordered) for (const table of planTables(plan)) touched.add(tableName(table));
  process.stdout.write(`Tables written: ${[...touched].sort().join(', ')}\n`);

  await mongoDb.dropDatabase();
  await source.close();
  await closePostgres();
}

main().catch((error: unknown) => {
  process.stderr.write(`benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

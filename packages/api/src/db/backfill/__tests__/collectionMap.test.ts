/**
 * The map itself: every table fed, every collection classified, no duplicates.
 *
 * These are the checks that make the map an ARTEFACT rather than a list someone
 * maintains by hand. The one that matters most is `tablesWithoutAPlan()`: it
 * asks the question from the TABLE side, which is the only direction that
 * notices a table nobody wrote a plan for.
 */

import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  allSchemaTables,
  classifyCollection,
  COLLECTION_PLANS,
  knownCollections,
  NOT_MIGRATED,
  POSTGRES_NATIVE_TABLES,
  tablesWithoutAPlan,
} from '../collectionMap';
import { planLevels, selfReferences } from '../order';
import { planTables, tableName } from '../plan';

describe('collection → table map', () => {
  it('feeds every table declared in the schema barrel', () => {
    // An empty list is the finish line, exactly as `DEFERRED_FOREIGN_KEYS`
    // treats its own. Anything here is a table the backfill would leave empty.
    expect(tablesWithoutAPlan()).toEqual([]);
  });

  it('accounts for every table: 97 backfilled, 6 born in Postgres', () => {
    // A vacuity floor. Without it a traversal bug that finds zero tables makes
    // the assertion above pass trivially.
    //
    // The two numbers are pinned SEPARATELY on purpose. A single total would
    // let a new table be added to the native list — where nothing migrates it
    // — while the check still passed, which is the exact accident the list is
    // meant to make impossible.
    const tables = allSchemaTables();
    expect(tables.length).toBe(103);

    const covered = new Set<string>();
    for (const plan of COLLECTION_PLANS) {
      for (const table of planTables(plan)) covered.add(tableName(table));
    }
    expect(covered.size).toBe(97);
    expect(POSTGRES_NATIVE_TABLES).toHaveLength(6);
    // No table may be both: a plan writing a table listed as having no source
    // means one of the two is a lie.
    for (const entry of POSTGRES_NATIVE_TABLES) expect(covered.has(entry.table)).toBe(false);
  });

  it('gives every Postgres-native table a written reason', () => {
    // Same discipline as `NOT_MIGRATED`. An entry with no reason is an entry
    // nobody can review, and this list is the one that says "nothing will ever
    // migrate this".
    for (const entry of POSTGRES_NATIVE_TABLES) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it('names each collection exactly once, across plans and exclusions', () => {
    const names = knownCollections();
    expect(new Set(names).size).toBe(names.length);
  });

  it('maps one collection per primary table', () => {
    const primaries = COLLECTION_PLANS.map((plan) => tableName(plan.table));
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it('gives every exclusion a non-trivial reason', () => {
    for (const exclusion of NOT_MIGRATED) {
      // An unexplained exclusion is indistinguishable from an oversight six
      // months later, so the reason is load-bearing rather than decorative.
      expect(exclusion.reason.length).toBeGreaterThan(60);
    }
    expect(NOT_MIGRATED.length).toBeGreaterThan(0);
  });

  it('classifies a mapped, an excluded and an unheard-of collection', () => {
    expect(classifyCollection('users').kind).toBe('migrated');
    expect(classifyCollection('refreshtokens').kind).toBe('excluded');
    expect(classifyCollection('somethingnobodyremembered').kind).toBe('unknown');
  });

  it('keeps devicetokens excluded and pushtokens migrated — they are NOT the same thing', () => {
    // The names differ and so do the meanings: `devicetokens` backed the
    // deleted device-ATTRIBUTION credential, `pushtokens` is the Expo push
    // registry. Conflating them would migrate dead secrets into `push_tokens`.
    const devicetokens = classifyCollection('devicetokens');
    expect(devicetokens.kind).toBe('excluded');

    const pushtokens = classifyCollection('pushtokens');
    expect(pushtokens.kind).toBe('migrated');
    if (pushtokens.kind !== 'migrated') throw new Error('unreachable');
    expect(tableName(pushtokens.plan.table)).toBe('push_tokens');
  });

  it('routes `follows` to user_follows and keeps the dead `followers` excluded', () => {
    const follows = classifyCollection('follows');
    expect(follows.kind).toBe('migrated');
    if (follows.kind !== 'migrated') throw new Error('unreachable');
    expect(tableName(follows.plan.table)).toBe('user_follows');
    expect(classifyCollection('followers').kind).toBe('excluded');
  });

  it('knows the one collection declared inline rather than by a model file', () => {
    // `federation_keypairs` was named by an explicit third argument to
    // `mongoose.model` inside `services/federation.service.ts`, so it is
    // derivable from neither the model registry nor the table name.
    const federation = classifyCollection('federation_keypairs');
    expect(federation.kind).toBe('migrated');
    if (federation.kind !== 'migrated') throw new Error('unreachable');
    expect(tableName(federation.plan.table)).toBe('federation_key_pairs');
  });

  it('uses Mongoose-derived collection names, not the snake_case table names', () => {
    // The pluralize() artefacts are the LIVE names. If a plan ever quietly
    // switched to the table name, `db.listCollections()` would report the real
    // collection as `unknown` — which fails the run, but only in production.
    const collections = COLLECTION_PLANS.map((plan) => plan.collection);
    expect(collections).toContain('appaffinityeventseens');
    expect(collections).toContain('applicationmoderationtrusts');
    expect(collections).toContain('restricteds');
    expect(collections).toContain('userappdatas');
    expect(collections).not.toContain('app_affinity_seen_events');
    expect(collections).not.toContain('push_tokens');
  });
});

describe('insert order', () => {
  // Asserted against `planLevels` — the function the RUNNER uses — rather than
  // a second sort written for the test. A test-only topological sort would be a
  // duplicate implementation that can agree with itself while disagreeing with
  // production.
  it('orders levels so every table follows the tables it references', () => {
    const levels = planLevels(COLLECTION_PLANS);
    expect(levels.flat().length).toBe(COLLECTION_PLANS.length);

    const placed = new Set<string>();
    for (const level of levels) {
      // Everything a level's plans depend on must already be placed by an
      // EARLIER level — checked before this level's own tables are added, which
      // is what proves the plans within a level are independent of each other
      // and can therefore run concurrently.
      for (const plan of level) {
        for (const table of planTables(plan)) {
          const config = getTableConfig(table);
          const own = new Set(planTables(plan).map(tableName));
          for (const foreignKey of config.foreignKeys) {
            const target = getTableConfig(foreignKey.reference().foreignTable).name;
            if (target === config.name || own.has(target)) continue;
            expect(placed.has(target)).toBe(true);
          }
        }
      }
      for (const plan of level) {
        for (const table of planTables(plan)) placed.add(tableName(table));
      }
    }
  });

  it('puts files in a level with other collections, so the big one is not serialised alone', () => {
    const levels = planLevels(COLLECTION_PLANS);
    const filesLevel = levels.find((level) => level.some((plan) => plan.collection === 'files'));
    expect(filesLevel).toBeDefined();
    // `files` is more than half the document total; it running alone while
    // dozens of independent collections wait is the shape levels exist to avoid.
    expect(filesLevel?.length ?? 0).toBeGreaterThan(1);
  });

  it('identifies exactly the seven self-referencing tables', () => {
    const found = Object.fromEntries(
      selfReferences(COLLECTION_PLANS).map((entry) => [tableName(entry.table), entry.columns])
    );
    expect(found).toEqual({
      account_credentials: ['rotatedFromCredentialId'],
      app_updates: ['promotedFromUpdateId'],
      application_credentials: ['rotatedFromCredentialId'],
      reputation_transactions: ['reversedTransactionId'],
      signed_records: ['prev'],
      topics: ['parentTopicId'],
      users: ['automationOwnerId', 'parentAccountId', 'rootAccountId'],
    });
  });
});

/**
 * The karma → reputation migration mapping, checked against the REAL ledger it
 * writes into (#217).
 *
 * WHAT THIS SUITE USED TO BE, AND WHY IT IS NOT THAT ANY MORE
 *
 * It re-implemented the migration's per-entry copy loop inside the test file —
 * its own `migrateKarmaHistory` helper — over a hand-written in-memory Mongo
 * emulator, and then asserted that the loop it had just written did what it had
 * just written. The script itself was never executed, so the only propositions
 * on the table were "the test's loop copies entries" and "the emulator stores
 * what it is handed". Neither is a property of this codebase.
 *
 * The real script (`src/scripts/migrate-karma-to-reputation.ts`) is still Mongo
 * end to end: it reads the legacy `karmas` / `karmarules` COLLECTIONS through
 * `mongoose.connection.db` and writes through the Mongoose `ReputationTransaction`
 * model. The ledger those rows have to land in is Postgres now, and it is
 * reachable only through `reputation.service.ts`. So there is no executable
 * end-to-end path left to test, and simulating one would be the same tautology
 * in a new costume.
 *
 * WHAT SURVIVES, AND IS WORTH HOLDING
 *
 * `utils/reputationMigrationMapping.ts` — two pure functions that decide the
 * CATEGORY of every migrated rule and every migrated ledger entry. Their return
 * values in isolation are already covered by
 * `utils/__tests__/reputationMigrationMapping.test.ts`; that suite cannot see
 * the property that actually matters here, which is a JOINT one:
 *
 *   every category the mapping can emit must be a value the ledger's own closed
 *   value set ACCEPTS, and must be FILED where the balance recompute expects it.
 *
 * Those are two independent authorities — `REPUTATION_CATEGORIES` (the column's
 * CHECK) and the `switch` in `recalculateBalance` — and the mapping agrees with
 * neither by construction. A mapping that returned `system` instead of `trust`
 * type-checks, passes the isolated unit test's sibling cases, and then fails
 * every INSERT during a production migration; a mapping that returned a legal
 * but unbucketed category migrates silently and reports the wrong breakdown
 * forever. Both are checked below against rows actually written.
 *
 * Rows are inserted with drizzle rather than through `award`, because that is
 * what a migration does: it bypasses the rule lookup and the cooldown and
 * supplies its own `createdAt`. The whole run shares one database, so every row
 * carries a per-test random id and no assertion depends on a table being empty.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { REPUTATION_CATEGORIES, type ReputationCategory } from '@oxyhq/contracts';
import { closePostgres, connectPostgres, getDb } from '../../config/postgres';
import { applications } from '../../db/schema/applications';
import { reputationRules } from '../../db/schema/reputationRules';
import { reputationTransactions } from '../../db/schema/reputationTransactions';
import { users } from '../../db/schema/users';
import {
  inferTransactionCategory,
  mapLegacyRuleCategory,
} from '../../utils/reputationMigrationMapping';
import reputationService from '../reputation.service';

const uniqueId = () => randomUUID().replace(/-/g, '');

/** One legacy history entry, as the script reads it off a `karmas` document. */
interface LegacyHistoryEntry {
  action: string;
  points: number;
  timestamp: Date;
  description?: string;
  targetContentId?: string;
}

async function makeUser(): Promise<string> {
  const id = uniqueId();
  await getDb().insert(users).values({ id, username: `m${id}` });
  return id;
}

/** A real application row, so `reputation_transactions.application_id` resolves. */
async function makeAttributingApplication(ownerAccountId: string): Promise<string> {
  const [row] = await getDb()
    .insert(applications)
    .values({ name: `mig-${uniqueId().slice(0, 8)}`, ownerAccountId })
    .returning({ id: applications.id });
  return row.id;
}

/**
 * Write one legacy history entry into the ledger exactly as the migration
 * derives it: the category from {@link inferTransactionCategory}, the timestamp
 * carried over verbatim, `status: 'active'`, and no application attribution.
 */
async function migrateEntry(
  userId: string,
  entry: LegacyHistoryEntry,
  ruleCategoryByAction: Map<string, ReputationCategory>
): Promise<string> {
  const [row] = await getDb()
    .insert(reputationTransactions)
    .values({
      userId,
      points: entry.points,
      actionType: entry.action,
      category: inferTransactionCategory(entry.action, entry.points, ruleCategoryByAction),
      sourceActionType: entry.action,
      targetEntityId: entry.targetContentId,
      reason: entry.description,
      status: 'active',
      createdAt: entry.timestamp,
    })
    .returning({ id: reputationTransactions.id });
  return row.id;
}

/** Every legacy `KarmaRule.category` the mapping documents, plus an unknown one. */
const LEGACY_RULE_CATEGORIES = [
  'content',
  'social',
  'system',
  'purchases',
  'other',
  'a-value-no-legacy-rule-ever-had',
] as const;

beforeAll(async () => {
  await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('every category the mapping emits is one the ledger accepts', () => {
  it('maps every legacy rule category onto a value `reputation_rules` stores', async () => {
    // `reputation_rules.category` carries a CHECK built from
    // `REPUTATION_CATEGORIES`. A mapping that returned the LEGACY spelling —
    // `system`, say, instead of `trust` — is a type error nowhere and a failed
    // INSERT on every migrated rule.
    for (const legacy of LEGACY_RULE_CATEGORIES) {
      const category = mapLegacyRuleCategory(legacy);
      expect(REPUTATION_CATEGORIES).toContain(category);

      const actionType = `migrated_rule_${uniqueId().slice(0, 12)}`;
      await reputationService.upsertRule({
        actionType,
        points: 4,
        category,
        description: `legacy ${legacy}`,
        cooldownInMinutes: 0,
        isEnabled: true,
      });

      const [stored] = await getDb()
        .select({ category: reputationRules.category })
        .from(reputationRules)
        .where(eq(reputationRules.actionType, actionType));
      expect(stored).toBeDefined();
      expect(stored.category).toBe(category);
    }
  });

  it('maps every entry shape onto a value `reputation_transactions` stores', async () => {
    const userId = await makeUser();
    const known = `known_${uniqueId().slice(0, 12)}`;
    const rules = new Map<string, ReputationCategory>([[known, 'content']]);

    // The three branches of `inferTransactionCategory`: rule-backed, negative
    // without a rule, positive without a rule.
    const entries: LegacyHistoryEntry[] = [
      { action: known, points: 10, timestamp: new Date('2024-01-01T00:00:00Z') },
      { action: `orphan_neg_${uniqueId().slice(0, 8)}`, points: -8, timestamp: new Date('2024-01-02T00:00:00Z') },
      { action: `orphan_pos_${uniqueId().slice(0, 8)}`, points: 5, timestamp: new Date('2024-01-03T00:00:00Z') },
    ];

    const ids = [];
    for (const entry of entries) {
      ids.push(await migrateEntry(userId, entry, rules));
    }

    const stored = await getDb()
      .select({
        id: reputationTransactions.id,
        actionType: reputationTransactions.actionType,
        category: reputationTransactions.category,
      })
      .from(reputationTransactions)
      .where(eq(reputationTransactions.userId, userId));

    expect(stored).toHaveLength(3);
    expect(ids).toHaveLength(3);
    const byAction = new Map(stored.map((row) => [row.actionType, row.category]));
    expect(byAction.get(entries[0].action)).toBe('content');
    expect(byAction.get(entries[1].action)).toBe('penalty');
    expect(byAction.get(entries[2].action)).toBe('other');
  });
});

describe('the balance recompute files a migrated row where the mapping put it', () => {
  it('puts a rule-backed entry in its NAMED bucket', async () => {
    const userId = await makeUser();
    const action = `content_${uniqueId().slice(0, 12)}`;
    await migrateEntry(
      userId,
      { action, points: 10, timestamp: new Date('2024-01-01T00:00:00Z') },
      new Map<string, ReputationCategory>([[action, 'content']])
    );

    const balance = await reputationService.recalculateBalance(userId);
    expect(balance.total).toBe(10);
    expect(balance.breakdown.content).toBe(10);
    expect(balance.breakdown.penalties).toBe(0);
  });

  it('puts a `trust`-mapped entry in the trust bucket, not in `other`', async () => {
    // The one legacy category whose NAME changes on the way across
    // (`system` → `trust`). Its bucket is the thing the rename can get wrong.
    const userId = await makeUser();
    const action = `system_${uniqueId().slice(0, 12)}`;
    const category = mapLegacyRuleCategory('system');
    expect(category).toBe('trust');

    await migrateEntry(
      userId,
      { action, points: 6, timestamp: new Date('2024-01-01T00:00:00Z') },
      new Map<string, ReputationCategory>([[action, category]])
    );

    const balance = await reputationService.recalculateBalance(userId);
    expect(balance.breakdown.trust).toBe(6);
    expect(balance.breakdown.content).toBe(0);
    expect(balance.breakdown.social).toBe(0);
  });

  it('files an unmapped NEGATIVE entry under `penalties` and no named bucket', async () => {
    // `penalty` and `other` are legal categories with no named bucket of their
    // own — `penalties` is the absolute sum of NEGATIVE points across every
    // category, which is a different rule from "the penalty category". A test
    // that only checked the stored `category` string would miss the difference.
    const userId = await makeUser();
    const action = `orphan_${uniqueId().slice(0, 12)}`;
    await migrateEntry(
      userId,
      { action, points: -8, timestamp: new Date('2024-01-02T00:00:00Z') },
      new Map<string, ReputationCategory>()
    );

    const balance = await reputationService.recalculateBalance(userId);
    expect(balance.total).toBe(-8);
    expect(balance.negative).toBe(-8);
    expect(balance.breakdown.penalties).toBe(8);
    expect(balance.breakdown.content).toBe(0);
    expect(balance.breakdown.trust).toBe(0);
  });

  it('keeps a rule-backed NEGATIVE entry in its named bucket AND counts it as a penalty', async () => {
    // `inferTransactionCategory` prefers the rule category even when the points
    // are negative, so this row lands in BOTH — the named bucket goes negative
    // while `penalties` counts its magnitude. Getting only one of the two right
    // is the failure this pins.
    const userId = await makeUser();
    const action = `neg_content_${uniqueId().slice(0, 12)}`;
    const rules = new Map<string, ReputationCategory>([[action, 'content']]);
    expect(inferTransactionCategory(action, -5, rules)).toBe('content');

    await migrateEntry(
      userId,
      { action, points: -5, timestamp: new Date('2024-01-04T00:00:00Z') },
      rules
    );

    const balance = await reputationService.recalculateBalance(userId);
    expect(balance.breakdown.content).toBe(-5);
    expect(balance.breakdown.penalties).toBe(5);
  });

  it('sums a whole migrated history to the legacy total', async () => {
    const userId = await makeUser();
    const known = `post_created_${uniqueId().slice(0, 8)}`;
    const liked = `comment_liked_${uniqueId().slice(0, 8)}`;
    const rules = new Map<string, ReputationCategory>([
      [known, 'content'],
      [liked, 'social'],
    ]);
    const history: LegacyHistoryEntry[] = [
      { action: known, points: 10, timestamp: new Date('2024-01-01T00:00:00Z') },
      { action: liked, points: 5, timestamp: new Date('2024-01-02T00:00:00Z') },
      { action: `spam_flagged_${uniqueId().slice(0, 8)}`, points: -8, timestamp: new Date('2024-01-03T00:00:00Z') },
    ];
    for (const entry of history) {
      await migrateEntry(userId, entry, rules);
    }

    const balance = await reputationService.recalculateBalance(userId);
    expect(balance.total).toBe(history.reduce((sum, entry) => sum + entry.points, 0));
    expect(balance.breakdown.content).toBe(10);
    expect(balance.breakdown.social).toBe(5);
    expect(balance.breakdown.penalties).toBe(8);
  });
});

describe('a migrated row carries its ORIGINAL timestamp, and the ledger honours it', () => {
  it('counts a years-old entry — there is no recency window on the recompute', async () => {
    const userId = await makeUser();
    const action = `ancient_${uniqueId().slice(0, 12)}`;
    const timestamp = new Date('2019-03-04T05:06:07Z');
    await migrateEntry(userId, { action, points: 12, timestamp }, new Map());

    const [stored] = await getDb()
      .select({ createdAt: reputationTransactions.createdAt })
      .from(reputationTransactions)
      .where(
        and(
          eq(reputationTransactions.userId, userId),
          eq(reputationTransactions.actionType, action)
        )
      );
    // The migration supplies `created_at`; a column default would silently
    // restamp every migrated row with the migration's own run time and destroy
    // the history the migration exists to preserve.
    expect(stored.createdAt.toISOString()).toBe(timestamp.toISOString());

    expect((await reputationService.recalculateBalance(userId)).total).toBe(12);
  });

  it('picks `lastTransactionId` by the migrated timestamps, not by insertion order', async () => {
    const userId = await makeUser();
    // Inserted oldest-last, so an implementation that took "the row written
    // most recently" would answer with the 2019 entry.
    const newest = await migrateEntry(
      userId,
      { action: `newest_${uniqueId().slice(0, 8)}`, points: 3, timestamp: new Date('2024-06-01T00:00:00Z') },
      new Map()
    );
    await migrateEntry(
      userId,
      { action: `oldest_${uniqueId().slice(0, 8)}`, points: 4, timestamp: new Date('2019-01-01T00:00:00Z') },
      new Map()
    );

    const balance = await reputationService.recalculateBalance(userId);
    expect(balance.lastTransactionId).toBe(newest);
    expect(balance.total).toBe(7);
  });
});

describe('the ledger does not supply the migration with idempotency', () => {
  it('accepts the same migrated entry twice, because it names no application', async () => {
    // `reputation_transactions_source_action_key` is `UNIQUE (application_id,
    // source_action_id)`, and Postgres treats NULLs as DISTINCT — a migrated row
    // sets NEITHER column, so the index exempts it. Re-running the migration is
    // therefore safe only because of the script's OWN per-entry duplicate check
    // on `(userId, actionType, points, createdAt)`. Nothing in the schema will
    // catch a re-run that loses that check, which is why it is asserted here
    // rather than assumed.
    const userId = await makeUser();
    const entry: LegacyHistoryEntry = {
      action: `replayed_${uniqueId().slice(0, 12)}`,
      points: 9,
      timestamp: new Date('2024-02-02T00:00:00Z'),
    };

    await migrateEntry(userId, entry, new Map());
    await migrateEntry(userId, entry, new Map());

    const rows = await getDb()
      .select({ id: reputationTransactions.id })
      .from(reputationTransactions)
      .where(
        and(
          eq(reputationTransactions.userId, userId),
          eq(reputationTransactions.actionType, entry.action)
        )
      );
    expect(rows).toHaveLength(2);
    expect((await reputationService.recalculateBalance(userId)).total).toBe(18);
  });

  it('DOES refuse a second row once one carries an application and a source action', async () => {
    // The control, so the case above cannot read as "the index does not exist".
    const userId = await makeUser();
    const [duplicate] = await getDb()
      .select({ id: reputationTransactions.id })
      .from(reputationTransactions)
      .where(eq(reputationTransactions.userId, userId));
    expect(duplicate).toBeUndefined();

    const actionType = `attributed_${uniqueId().slice(0, 12)}`;
    await reputationService.upsertRule({
      actionType,
      points: 2,
      category: 'other',
      description: 'attributed award',
      cooldownInMinutes: 0,
      isEnabled: true,
    });
    const applicationId = await makeAttributingApplication(userId);
    const sourceActionId = `src-${uniqueId()}`;

    const first = await reputationService.award({
      userId,
      actionType,
      applicationId,
      sourceActionId,
    });
    const second = await reputationService.award({
      userId,
      actionType,
      applicationId,
      sourceActionId,
    });
    expect(second.id).toBe(first.id);

    const rows = await getDb()
      .select({ id: reputationTransactions.id })
      .from(reputationTransactions)
      .where(eq(reputationTransactions.userId, userId));
    expect(rows).toHaveLength(1);
  });
});

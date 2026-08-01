/**
 * Documented resolutions — what the migration DOES about production rows the
 * Postgres schema would otherwise refuse.
 *
 * ## Why this file exists, and why it is not an override flag
 *
 * `audit.ts` deliberately has no `--force`: a blocking finding is cleared by
 * fixing the data or by widening the schema, and both are decisions rather than
 * switches. There is a third move, and it is the one this file encodes —
 * **teach the migration what to do**. A resolution is not a silenced check. The
 * audit still runs, still reads the allowed set from the drizzle column, and
 * still REPORTS the offending values with their counts and ids; what changes is
 * that a finding a rule answers stops BLOCKING, because the answer is written
 * down here, in code, next to the reason it is safe.
 *
 * Three properties keep that honest:
 *
 * 1. **A rule is declared on the audit it answers**, by column (`EnumAudit`) or
 *    by index (`UniquenessAudit`). It cannot cover a finding nobody attached it
 *    to.
 * 2. **A rule reports every row it changes, by id** ({@link ResolutionLog}).
 *    A silent drop is exactly how data goes missing, so the count and the ids
 *    ride in the run output next to the copy result.
 * 3. **MongoDB is never written.** Both rules change what the copy WRITES to
 *    Postgres; the source documents stay exactly as they are, which is what
 *    makes a revisited decision cheap — drop the Postgres database, change the
 *    rule, run again.
 *
 * ## The rules
 *
 * ### `drop-unrenderable-message-card`
 *
 * ~13 of 1,057 production `messages` carry `card.type` holding an OBJECT
 * (`{"confidence":0,"extractedAt":"2026-03-07T…"}`) where `messages.card_type`
 * is `text` constrained to `trip|purchase|event|bill|package`. Something
 * assigned card METADATA to the type field.
 *
 * The card is automatically extracted presentation metadata; the message body
 * is intact. A card whose `type` is an object is already unrenderable by every
 * client, so dropping it takes away nothing that works today — whereas refusing
 * the row would lose a real message. So: **drop the card, keep the message.**
 * The rule is narrow by construction — it fires only when `card.type` is not
 * one of the five values {@link messages.cardType} itself declares — and every
 * message it degrades is counted and named.
 *
 * ### `demote-duplicate-open-validation-requests`
 *
 * 23 `validationrequests` sit in two groups sharing a `sourceActionId`
 * (`personhood_audit:69b2d3df5d12f58c9800d651` ×13,
 * `personhood_audit:6981c9178fcdefaf81988ffb` ×10) while `status` is still
 * open, which `validation_requests_open_source_action_key` forbids.
 *
 * These are not dirty data. They are THE BUG THE INDEX EXISTS TO PREVENT,
 * recorded: `openValidationRequest` does a `findOne` and then a `create` — a
 * check-then-act with a real window in which two callers both open a jury for
 * the same action. So: **keep the most recent row per key, and write the others
 * with a terminal status** so they no longer occupy the partial index. Nothing
 * is deleted; the losers remain as the audit record of a jury that was opened
 * and never resolved.
 *
 * The cost is nil: `selectValidators` has no minimum-pool guard and the
 * eligible pool never clears QUORUM, so these juries could only ever expire
 * anyway. {@link DEMOTED_VALIDATION_REQUEST_STATUS} is exactly that outcome.
 *
 * ### The eleven orphaned-reference rules — {@link ORPHAN_RESOLUTIONS}
 *
 * Production holds 682 rows across eleven relations whose parent account
 * MongoDB does not hold. `referentialIntegrity.ts` measured every one of them as
 * `absent-in-source` — pre-existing dangling debt Mongo never checked, with
 * NOTHING lost by the copy — so what is on the table is what happens to the
 * REFERENCING row, and the schema's own `ON DELETE` is what answers it:
 *
 * - **Nine NOT NULL / `ON DELETE CASCADE` relations: DROP the referencing row.**
 *   A cascade is the schema's written answer to losing the parent, and these are
 *   precisely the rows a cascade would have removed had Mongo enforced one. NULL
 *   is not available on a NOT NULL column, so the only alternative is inventing
 *   a placeholder parent — fabricating an account.
 * - **`files.owner_user_id` (179 rows): DROP the row too**, even though the
 *   column is NULLABLE and NULL would insert. It is the one relation here where
 *   both answers were available and one was chosen; the reasoning, and the fact
 *   that it strands real S3 objects, are in {@link DROP_ORPHANED_FILE}.
 * - **`device_sessions.active_account_id`: write NULL and KEEP the row.** The
 *   column is nullable and declares `ON DELETE SET NULL`, so NULL is literally
 *   where the declared policy puts a row whose parent is gone. Dropping the
 *   device session instead would sign a user out of a live device to fix a dead
 *   pointer. Its sibling `device_session_accounts` rows for those same parents
 *   ARE dropped by the rule above: the account entry goes, the device survives
 *   holding no active account.
 *
 * Five properties keep these honest, and each is checked rather than asserted in
 * prose:
 *
 * 1. **The predicate is narrow by construction.** A rule fires on ONE declared
 *    `(table, column)` and only when that column holds a value the parent
 *    collection does not, read from {@link ResolutionPlan.orphanParents}. Any
 *    other row is emitted byte-for-byte unchanged.
 * 2. **The schema is the premise, and it is verified.** The decisions above rest
 *    on what each constraint declares; nothing here restates it —
 *    `assertOrphanResolutionsMatchSchema` derives each relation from the drizzle
 *    metadata and REFUSES a rule whose declared action disagrees with the
 *    constraint it answers. A drop on a NULLABLE column is refused outright
 *    unless the declaration also says WHY NULL was not taken
 *    ({@link OrphanRelation.whyNotNull}), so the one case where both answers
 *    existed cannot be declared by copying a line from the nine where only one
 *    did.
 * 3. **The audit still finds the orphans, and only stops blocking when the rows
 *    provably do not reach Postgres.** References are checked on the row the
 *    transform BUILT, so every one of the 503 is still reported by value, count
 *    and id; the finding is answered because the row is removed or the column
 *    nulled, and because the rule's own tally MATCHES the traversal's. A rule
 *    that acted on more rows than the traversal found orphaned blocks as an
 *    overreach — that is the guard against a widened predicate quietly deleting
 *    live data.
 * 4. **An empty parent set makes every rule INERT.** "The pre-pass read nothing"
 *    and "the parent collection is genuinely empty" are indistinguishable, and
 *    one of them would drop every row of ten tables. So the rules stand down
 *    and the orphans block instead.
 * 5. **A rule that DESTROYS a row emits what the row was the last handle on.**
 *    {@link OrphanRelation.carry} names columns copied verbatim into the record,
 *    so the report is a usable worklist rather than a list of ids to something
 *    nobody can find — see {@link DROP_ORPHANED_FILE}, whose rows are the only
 *    index of 179 objects still in S3.
 *
 * `dropped-document` — a transform emitting fewer rows than it read — remains
 * unanswerable by any of this. A row a rule removes is counted SEPARATELY
 * ({@link ResolvedRow.written} being `null` is what the audit tallies), so an
 * unexplained shortfall still blocks exactly as before; only the rows a rule
 * removed and named are subtracted.
 */

import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { sqlColumnName } from '../casing';
import { appUserSignals } from '../schema/appUserSignals';
import { bundles } from '../schema/bundles';
import { deviceSessionAccounts } from '../schema/deviceSessionAccounts';
import { deviceSessions } from '../schema/deviceSessions';
import { files } from '../schema/files';
import { messages } from '../schema/messages';
import { notifications } from '../schema/notifications';
import { restrictions } from '../schema/restrictions';
import { securityActivities } from '../schema/securityActivities';
import { userFollows } from '../schema/userFollows';
import { users } from '../schema/users';
import { OPEN_VALIDATION_REQUEST_STATUSES, VALIDATION_REQUEST_STATUSES } from '../schema/validationRequests';
import type { MongoSource } from './mongoSource';
import { allowedValues, tableName, type CollectionPlan } from './plan';
import { date, describeId, id, isObjectId, type MongoDocument } from './values';

/**
 * The live collection name of the validator-jury requests.
 *
 * Shared by the plan that copies them and by the pre-pass below, so the query
 * that decides which rows are demoted can never end up reading a different
 * collection from the one being written.
 */
export const VALIDATION_REQUESTS_COLLECTION = 'validationrequests';

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------

/** A decision about production data, written down where the code applies it. */
export interface ResolutionRule {
  /** Stable id, quoted in the run report and in the audit finding it answers. */
  readonly id: string;
  /** The collection whose rows it changes. */
  readonly collection: string;
  /** What the audit found, in the operator's words. */
  readonly finding: string;
  /** What the migration does about it, and why that costs nothing. */
  readonly decision: string;
}

/**
 * The status a demoted duplicate is written with.
 *
 * Typed as a member of the column's own enum, so removing `expired` from
 * {@link VALIDATION_REQUEST_STATUSES} fails `tsc` here rather than the INSERT.
 *
 * `expired` is the ONE terminal status `validation_requests_terminal_check`
 * accepts with a NULL `outcome`: `validated` and `rejected` each require an
 * outcome equal to the status, and inventing a verdict for a jury that never
 * voted would be a worse lie than the duplicate it resolves. It is also what
 * these requests were going to become anyway.
 */
export const DEMOTED_VALIDATION_REQUEST_STATUS: (typeof VALIDATION_REQUEST_STATUSES)[number] =
  'expired';

export const DROP_UNRENDERABLE_MESSAGE_CARD: ResolutionRule = {
  id: 'drop-unrenderable-message-card',
  collection: 'messages',
  finding:
    '`card.type` holds a value that is not one of the five card types the ' +
    'column declares — production has ~13 documents where it holds a card ' +
    'METADATA OBJECT instead of a type.',
  decision:
    'Drop the CARD, keep the MESSAGE: the row is written with all four card ' +
    'columns NULL and its body untouched. The card is automatically extracted ' +
    'presentation metadata and a card whose type is not a card type is already ' +
    'unrenderable by every client, so nothing that works today stops working — ' +
    'while refusing the row would lose a real message. Every degraded message ' +
    'is reported by id.',
};

export const DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS: ResolutionRule = {
  id: 'demote-duplicate-open-validation-requests',
  collection: VALIDATION_REQUESTS_COLLECTION,
  finding:
    'Several requests share one `sourceActionId` while still OPEN, which ' +
    '`validation_requests_open_source_action_key` forbids. This is the bug the ' +
    'index exists to prevent, recorded: `openValidationRequest` does `findOne` ' +
    'then `create`, a check-then-act with a real window.',
  decision:
    'Keep the MOST RECENT request per key and write the others with the ' +
    `terminal status \`${DEMOTED_VALIDATION_REQUEST_STATUS}\` so they no longer ` +
    'occupy the partial index. ' +
    'Nothing is deleted — a demoted row stays as the audit record of a ' +
    'jury that was opened and never resolved. It costs nothing that would ' +
    'otherwise have happened: `selectValidators` has no minimum-pool guard and ' +
    'the eligible pool never clears QUORUM, so these juries could only ever ' +
    'expire. Every demoted request is reported by id, next to the survivor.',
};

// ---------------------------------------------------------------------------
// the orphaned-reference rules
// ---------------------------------------------------------------------------

/**
 * What the migration does with a row whose parent the SOURCE never held.
 *
 * The two answers the schema itself offers, and nothing else: no placeholder
 * parent is ever fabricated, and no row is silently altered in any other way.
 */
export type OrphanAction =
  /** The row is not written at all — what `ON DELETE CASCADE` declares. */
  | 'drop-row'
  /** The column is written NULL and the row is kept — what `ON DELETE SET NULL` declares. */
  | 'write-null';

/**
 * One foreign key whose orphans a documented rule answers.
 *
 * Declared as `(table, column)` and NOTHING else about the constraint: the
 * constraint name, the nullability and the `ON DELETE` are all derived from the
 * drizzle metadata by `referentialIntegrity.ts`, which then REFUSES a rule whose
 * {@link action} disagrees with what the schema declares. Restating them here
 * would be a second source of truth for the very facts the decision rests on.
 */
export interface OrphanRelation {
  readonly rule: ResolutionRule;
  readonly action: OrphanAction;
  /**
   * Why NULL was NOT the answer — required for a `drop-row` on a NULLABLE
   * column, and refused on a NOT NULL one.
   *
   * On a NOT NULL column there is nothing to justify: no value satisfies the
   * constraint, so dropping is the only answer left. On a NULLABLE one NULL IS
   * representable, so choosing to destroy the row instead is a real choice and
   * has to be written down. `assertOrphanResolutionsMatchSchema` enforces both
   * directions, which is what stops a nullable drop from ever being declared by
   * copying a line from the nine above.
   */
  readonly whyNotNull?: string;
  /**
   * Columns of the row to carry into the record VERBATIM when the rule fires.
   *
   * For a rule that DESTROYS a row, the report is the only thing left of it. If
   * the row is the last handle on something outside this database — `files` and
   * its S3 object — then whichever columns identify that thing have to ride in
   * the report beside the id, because after the copy nobody can look them up.
   */
  readonly carry?: readonly PgColumn[];
  /** The LIVE collection whose documents produce the referencing rows. */
  readonly collection: string;
  /** The referencing table. */
  readonly table: PgTable;
  /** Its SQL name, so an emitted row can be matched without re-deriving it. */
  readonly tableName: string;
  /** The referencing column. */
  readonly column: PgColumn;
  /** The drizzle PROPERTY that column occupies in an emitted row. */
  readonly property: string;
  /** Its SQL name, for the report — what a `23503` and `psql` both spell. */
  readonly columnName: string;
  /** The table the reference must find a row in. */
  readonly targetTable: PgTable;
  /**
   * The collection whose documents become that table's rows.
   *
   * The rule's parent set is read from it before the copy starts. Declared
   * rather than looked up so this module never imports the collection map —
   * `plans/` imports this file, so the reverse edge would be a cycle. The
   * agreement is checked instead: `__tests__/orphanResolutions.test.ts` asserts
   * this collection's plan writes {@link targetTable}.
   */
  readonly parentCollection: string;
}

/** The collection every one of these relations resolves its parent in. */
const USERS_COLLECTION = 'users';

/** Everything one declaration says that is not derivable from the schema. */
interface OrphanResolutionInput {
  readonly action: OrphanAction;
  /** The LIVE collection whose documents produce the referencing rows. */
  readonly collection: string;
  readonly table: PgTable;
  readonly column: PgColumn;
  readonly targetTable: PgTable;
  readonly parentCollection: string;
  /** {@link OrphanRelation.whyNotNull} — required for a nullable `drop-row`. */
  readonly whyNotNull?: string;
  /** What the drop DESTROYS beyond the row, when it destroys anything. */
  readonly cost?: string;
  /** {@link OrphanRelation.carry}. */
  readonly carry?: readonly PgColumn[];
}

/**
 * Declare one orphan resolution, composing its rule from the relation.
 *
 * The id and the prose are DERIVED from the table and column so eleven rules
 * cannot drift into eleven slightly different statements of one decision — the
 * decision genuinely is the same for all ten drops, and only the relation, the
 * reason NULL was refused, and the cost differ.
 */
function orphanResolution(input: OrphanResolutionInput): OrphanRelation {
  const { action, collection, table, column, targetTable, parentCollection } = input;
  const from = tableName(table);
  const columnName = sqlColumnName(column);
  const to = tableName(targetTable);
  const reference = `${from}.${columnName}`;
  const prefix = action === 'drop-row' ? 'drop' : 'null';

  return {
    rule: {
      id: `${prefix}-orphaned-${from}-${columnName}`.replace(/_/g, '-'),
      collection,
      finding:
        `${reference} names a \`${to}\` row the source does not hold. MongoDB ` +
        'enforced no foreign key, so the reference was already dangling there; ' +
        'Postgres answers 23503. The audit measured it as `absent-in-source` — ' +
        'nothing was lost by the copy.',
      decision:
        action === 'drop-row'
          ? `DROP the referencing row. ${reference} cascades from \`${to}\`, so ` +
            'the schema itself says this row goes when its parent does — these ' +
            'are exactly the rows a cascade would already have removed. ' +
            (input.whyNotNull ??
              'NULL is not available on a NOT NULL column, and the only other ' +
                'option is inventing a placeholder parent, which would fabricate ' +
                'an account.') +
            ' Every dropped row is reported by id, and the rest of the document ' +
            'does not travel in any other form.' +
            (input.cost === undefined ? '' : ` ${input.cost}`)
          : `Write NULL and KEEP the row. ${reference} is NULLABLE and declares ` +
            `ON DELETE SET NULL against \`${to}\`, so NULL is literally where ` +
            'the declared policy puts a row whose parent is gone. Dropping the ' +
            'row instead would sign a user out of a live device to fix a dead ' +
            'pointer. Every other column is written verbatim, and every nulled ' +
            'row is reported by id.',
    },
    action,
    collection,
    table,
    tableName: from,
    column,
    // `column.name` on a drizzle column is the TypeScript PROPERTY name — the
    // key an emitted row uses. `sqlColumnName` is the other half. Confusing the
    // two is the trap `db/casing.ts` exists to close.
    property: column.name,
    columnName,
    targetTable,
    parentCollection,
    ...(input.whyNotNull === undefined ? {} : { whyNotNull: input.whyNotNull }),
    ...(input.carry === undefined ? {} : { carry: input.carry }),
  };
}

/**
 * `files.owner_user_id` — the one drop that destroys more than a row.
 *
 * 179 files across 121 absent accounts. It is separated out because it is the
 * only relation here where BOTH of the schema's answers were available and one
 * was chosen, and because of what the chosen one costs.
 *
 * ## Why not NULL, when NULL is representable
 *
 * The column is NULLABLE, so unlike the nine `users` relations NULL would
 * insert. It is still not an answer: this codebase does not USE NULL to mean
 * "nobody owns this file". An ownerless asset is marked with a SENTINEL —
 * `FILE_SYSTEM_OWNERS` in `schema/files.ts`, `__federation__` /
 * `__federation_media_cache__` /
 * `__link_preview_cache__` — and `files_owner_check` asserts exactly one of
 * `owner_user_id` and `system_owner` is set, so a row with neither would not
 * even insert. Writing NULL would therefore be inventing a state no reader
 * expects, and minting a fourth `__orphaned__` sentinel would be inventing a
 * value the application has never seen. `ON DELETE cascade` is what the schema
 * already declares, and it introduces nothing new.
 *
 * ## What it costs, stated where it will be read
 *
 * Each dropped row is the last RECORD of an object that is still sitting in S3.
 * Those bytes become unreferenced garbage that nothing can enumerate afterwards
 * — `files` was the index. That is why {@link OrphanRelation.carry} names
 * `sha256` and `storage_key`: the run report emits all three per dropped file,
 * the complete list and never a sample, and that list is the only remaining
 * handle on those objects.
 *
 * The key is worth carrying rather than re-deriving. `generateStorageKey`
 * (`services/assetService.ts:1816`) is content-addressed but stamps the
 * UPLOAD's year and month into the path (`content/{year}/{month}/{2}/{sha}.ext`),
 * so it cannot be recomputed from `sha256` and `mime` after the fact.
 *
 * This migration deliberately deletes NO S3 object and checks no precondition
 * for doing so. MongoDB stays untouched and keeps all 179 rows, which is what
 * makes the drop reversible; deleting bytes now would convert a rollback into
 * permanent loss. A later cleanup also cannot delete per ROW: `sha256` is
 * unique only among LIVE rows (`files_sha256_live_key` is PARTIAL) and the
 * upload path REUSES an existing object for a matching hash
 * (`assetService.ts:490`), so the object behind one of these may be the object a
 * live row — or a future upload — resolves to. The deletable precondition is
 * per-CONTENT: no `files` row of any status shares that `sha256`. The report
 * carries what such a check would need; it does not run it.
 */
export const DROP_ORPHANED_FILE: OrphanRelation = orphanResolution({
  action: 'drop-row',
  collection: 'files',
  table: files,
  column: files.ownerUserId,
  targetTable: users,
  parentCollection: USERS_COLLECTION,
  whyNotNull:
    'NULL is representable here — the column is NULLABLE — and was still not ' +
    'taken: this codebase marks an ownerless file with a SENTINEL in ' +
    '`system_owner`, never with NULL, so a NULL owner is a state no reader ' +
    'expects and `files_owner_check` refuses a row with neither. A fourth ' +
    '`__orphaned__` sentinel would invent a value the application has never seen.',
  cost:
    'THE COST IS REAL AND IS NOT SOFTENED: each dropped row is the last record ' +
    'of an object that IS STILL IN S3, and those bytes become unreferenced ' +
    'garbage nothing can enumerate once this table stops describing them. That ' +
    'is why every dropped file is reported with its `sha256` and its ' +
    '`storage_key` beside its id — the COMPLETE list, never a sample. It is the ' +
    'only remaining handle on those objects, and it is what a later cleanup ' +
    'would work from. This migration deletes no object and MongoDB keeps every ' +
    'one of these rows, which is what makes the choice reversible.',
  // The two columns that identify the object. Declared as drizzle COLUMNS, so a
  // rename is a compile error here rather than a silently empty report field.
  carry: [files.sha256, files.storageKey],
});

/**
 * Every relation whose orphans are ANSWERED, and how.
 *
 * Exactly the eleven the production audit reported, each measured
 * `absent-in-source`. A relation absent from this list still BLOCKS.
 */
export const ORPHAN_RESOLUTIONS: readonly OrphanRelation[] = [
  // The collection names are the LIVE ones, which Mongoose derived by
  // pluralising a model name rather than declaring (`restricteds`,
  // `securityactivities`, `appusersignals`) — never a guess from the table name,
  // and `__tests__/orphanResolutions.test.ts` checks each against the plan that
  // writes the table.
  drop('appusersignals', appUserSignals, appUserSignals.userId),
  drop('bundles', bundles, bundles.userId),
  // Fed by `devicesessions`: the account set is a subdocument ARRAY on the
  // device-session document, so dropping one of these rows removes an account
  // entry, never the device.
  drop('devicesessions', deviceSessionAccounts, deviceSessionAccounts.accountId),
  drop('notifications', notifications, notifications.actorId),
  drop('notifications', notifications, notifications.recipientId),
  drop('restricteds', restrictions, restrictions.restrictedId),
  drop('securityactivities', securityActivities, securityActivities.userId),
  drop('follows', userFollows, userFollows.followedId),
  drop('follows', userFollows, userFollows.followerId),
  DROP_ORPHANED_FILE,
  // The ONE row-preserving answer, and the only relation here whose schema lets
  // NULL stand for a lost parent.
  orphanResolution({
    action: 'write-null',
    collection: 'devicesessions',
    table: deviceSessions,
    column: deviceSessions.activeAccountId,
    targetTable: users,
    parentCollection: USERS_COLLECTION,
  }),
];

/** One NOT NULL / `ON DELETE CASCADE` relation into `users`. */
function drop(collection: string, table: PgTable, column: PgColumn): OrphanRelation {
  return orphanResolution({
    action: 'drop-row',
    collection,
    table,
    column,
    targetTable: users,
    parentCollection: USERS_COLLECTION,
  });
}

/** The declared resolutions for one table, by its SQL name. */
const ORPHAN_RESOLUTIONS_BY_TABLE: ReadonlyMap<string, readonly OrphanRelation[]> = (() => {
  const index = new Map<string, OrphanRelation[]>();
  for (const relation of ORPHAN_RESOLUTIONS) {
    const existing = index.get(relation.tableName);
    if (existing) existing.push(relation);
    else index.set(relation.tableName, [relation]);
  }
  return index;
})();

/**
 * Every documented resolution.
 *
 * The inventory {@link ResolutionLog.summary} reports against, so a rule that
 * fired zero times still appears — which is how "the rule is live and this data
 * did not need it" is distinguishable from "the rule was never wired up".
 */
const RESOLUTION_RULES: readonly ResolutionRule[] = [
  DROP_UNRENDERABLE_MESSAGE_CARD,
  DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS,
  ...ORPHAN_RESOLUTIONS.map((relation) => relation.rule),
];

// ---------------------------------------------------------------------------
// what the rules did
// ---------------------------------------------------------------------------

/** One document a rule acted on. */
export interface ResolutionRecord {
  readonly rule: ResolutionRule;
  /** The source `_id`, so the operator can look the row up in Mongo. */
  readonly documentId: string;
  /**
   * WHICH part of the document, when one document can be acted on more than
   * once by the same rule.
   *
   * The two original rules act on a document as a whole, so they leave it
   * unset. An orphan rule acts on a ROW, and one document can produce several
   * — a `devicesessions` document holds an ARRAY of accounts, so two of its
   * entries naming two absent parents are two separate acts. Without this they
   * would collapse into one record and the report would name one of them.
   */
  readonly within?: string;
  /** What changed about this document, specifically. */
  readonly detail: string;
  /**
   * Columns of the row, carried verbatim — {@link OrphanRelation.carry}.
   *
   * Present only for a rule that declared them, and printed as `name=value`
   * beside the id. This is the report's payload rather than its prose: for a
   * dropped `files` row it is the `sha256` and `storage_key` of an object that
   * outlives the row, and nothing else will know them afterwards.
   */
  readonly evidence?: Readonly<Record<string, string>>;
}

/** Per-rule roll-up for the run report. */
export interface ResolutionSummary {
  readonly rule: ResolutionRule;
  readonly documents: number;
  readonly documentIds: readonly string[];
  readonly records: readonly ResolutionRecord[];
}

/**
 * Collects what the rules actually did.
 *
 * Deduped on `(rule, document)`, because a transform is run more than once
 * against the same document by design — the deferred-self-reference pass
 * re-streams the collection, and the verifier re-runs the transform to compute
 * its expectation. Recording the same fact twice would inflate a count the
 * operator is meant to check against the audit's.
 */
export class ResolutionLog {
  private readonly records = new Map<string, ResolutionRecord>();

  record(entry: ResolutionRecord): void {
    this.records.set(`${entry.rule.id}\u0000${entry.documentId}\u0000${entry.within ?? ''}`, entry);
  }

  /**
   * Every rule with what it did, INCLUDING the rules that did nothing.
   *
   * A rule reporting zero documents is information: it says the rule is still
   * declared and this data did not need it.
   */
  summary(): readonly ResolutionSummary[] {
    return RESOLUTION_RULES.map((rule) => {
      const records = [...this.records.values()]
        .filter((entry) => entry.rule.id === rule.id)
        .sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0));
      return {
        rule,
        documents: records.length,
        documentIds: records.map((entry) => entry.documentId),
        records,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// the pre-pass
// ---------------------------------------------------------------------------

/** Where the instant that ordered a duplicate came from. */
export type ValidationRequestOrdering = 'createdAt' | 'objectId timestamp' | 'id only';

/** One member of a duplicate group, with what ordered it. */
export interface DuplicateOpenValidationRequest {
  readonly id: string;
  /** The instant it was ordered by, or `null` when it had none. */
  readonly orderedAt: Date | null;
  /** Which field supplied that instant. Quoted in the report. */
  readonly orderedBy: ValidationRequestOrdering;
}

/** One `sourceActionId` held open by more than one request. */
export interface DuplicateOpenValidationRequestGroup {
  readonly sourceActionId: string;
  /** Most recent FIRST. */
  readonly members: readonly DuplicateOpenValidationRequest[];
  /** The one that stays open. */
  readonly survivorId: string;
  /** The ones written terminal. */
  readonly demotedIds: readonly string[];
}

/**
 * Whole-collection state the rules need, computed from the source before the
 * copy starts.
 *
 * Two of the rules need one, for the same reason: the question is about a SET
 * the document is not a member of. "Which of these is the most recent" is a
 * question about a GROUP, and "does this account still exist" is a question
 * about the whole `users` collection — neither is answerable from the document
 * in hand. The card rule is a per-document predicate and needs nothing.
 */
export interface ResolutionPlan {
  readonly duplicateOpenValidationRequests: readonly DuplicateOpenValidationRequestGroup[];
  /** Every id that loses the most-recent-wins tie-break, across all groups. */
  readonly demotedValidationRequestIds: ReadonlySet<string>;
  /**
   * Every `_id` each parent collection of {@link ORPHAN_RESOLUTIONS} holds.
   *
   * Keyed by the LIVE collection name. A collection that is absent from the
   * source, or that holds nothing, is absent from this map — which makes its
   * rules INERT rather than making every reference to it an orphan. That
   * direction is deliberate: "the pre-pass read nothing" and "the collection is
   * empty" are indistinguishable here, and one of them would drop every row of
   * nine tables. Standing down leaves the orphans blocking, which is the answer
   * a human has to give anyway.
   */
  readonly orphanParents: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The creation instant an ObjectId carries in its first four bytes.
 *
 * Derived from the hex rather than from a driver method, so it does not depend
 * on which `bson` copy produced the value — the same reason
 * {@link isObjectId} is duck-typed. Returns `null` for anything that is not a
 * 24-character hex id (`usercredits`, `linkpreviews` and every other string key
 * carry no instant at all).
 */
export function objectIdTimestamp(id: string): Date | null {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  return new Date(Number.parseInt(id.slice(0, 8), 16) * 1000);
}

/**
 * The Mongo spelling of `validation_requests_open_source_action_key`'s partial
 * predicate — the documents that will occupy that index ONCE COPIED.
 *
 * It is exported and shared rather than written twice because two readers need
 * the identical set and they fail in opposite directions if they disagree: the
 * pre-pass below decides which rows to demote, and the uniqueness AUDIT decides
 * which rows can collide. A pre-pass narrower than the audit leaves a group the
 * rule cannot cover, which blocks the migration over rows Postgres would have
 * accepted; a pre-pass wider than the audit demotes a row nothing required.
 *
 * `{status: null}` is deliberate and is NOT the same as the SQL predicate's
 * status list: in Mongo it matches an explicit null AND a missing field, which
 * is exactly the set the transform writes as `pending` via
 * `str(doc,'status') ?? 'pending'`. Those rows land OPEN, so they belong here
 * even though `null` is not one of the SQL statuses.
 */
export const OPEN_AFTER_COPY_MATCH: Readonly<Record<string, unknown>> = Object.freeze({
  $or: [{ status: { $in: [...OPEN_VALIDATION_REQUEST_STATUSES] } }, { status: null }],
});

/**
 * Read the source and decide which duplicate open requests are demoted, and
 * which accounts still exist.
 *
 * Reads only — the source handle refuses anything that is not one
 * ({@link MongoSource}), so this cannot touch the rollback source it reads.
 */
export async function planResolutions(source: MongoSource): Promise<ResolutionPlan> {
  const orphanParents = await readOrphanParents(source);
  const groups = await source
    .collection(VALIDATION_REQUESTS_COLLECTION)
    .aggregate([
      {
        $match: {
          // A NULL `source_action_id` could not collide anyway — the column is
          // NOT NULL here, and a unique index is NULLS DISTINCT regardless.
          sourceActionId: { $ne: null },
          ...OPEN_AFTER_COPY_MATCH,
        },
      },
      {
        $group: {
          _id: '$sourceActionId',
          count: { $sum: 1 },
          members: { $push: { id: '$_id', createdAt: '$createdAt' } },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  const resolved: DuplicateOpenValidationRequestGroup[] = [];
  const demotedValidationRequestIds = new Set<string>();

  for (const group of groups) {
    const sourceActionId = typeof group._id === 'string' ? group._id : String(group._id);
    const raw = Array.isArray(group.members) ? group.members : [];
    const members = raw
      .map((entry: unknown) => describeMember(entry))
      .filter((entry): entry is DuplicateOpenValidationRequest => entry !== null)
      .sort(mostRecentFirst);

    // One member left after coercion is not a collision; reporting it as a
    // resolved group would claim the rule did something it did not.
    if (members.length < 2) continue;

    const [survivor, ...losers] = members;
    if (survivor === undefined) continue;
    for (const loser of losers) demotedValidationRequestIds.add(loser.id);
    resolved.push({
      sourceActionId,
      members,
      survivorId: survivor.id,
      demotedIds: losers.map((loser) => loser.id),
    });
  }

  return { duplicateOpenValidationRequests: resolved, demotedValidationRequestIds, orphanParents };
}

/**
 * Every `_id` the parent collections hold, for the orphan rules' predicate.
 *
 * Projected to `_id` alone: `users` carries 81 emitted columns and this needs
 * one of them, so the read is served by the `_id` index rather than by fetching
 * the documents. The id is coerced through {@link id}, the SAME helper the
 * transforms use to build a reference — a set built with a different coercion
 * would answer "absent" for a parent that is present in another spelling, and
 * that direction deletes live rows.
 *
 * A collection missing from the source is SKIPPED rather than recorded empty,
 * and a collection that turns out to hold nothing is dropped from the map for
 * the same reason — see {@link ResolutionPlan.orphanParents}.
 */
async function readOrphanParents(
  source: MongoSource
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const parents = new Map<string, ReadonlySet<string>>();
  const live = new Set(await source.listCollections());

  for (const collection of new Set(ORPHAN_RESOLUTIONS.map((entry) => entry.parentCollection))) {
    if (!live.has(collection)) continue;
    const ids = new Set<string>();
    const cursor = source.collection(collection).find({}, { projection: { _id: 1 } });
    for await (const doc of cursor) {
      const value = id(doc as MongoDocument, '_id');
      if (value !== null) ids.add(value);
    }
    if (ids.size > 0) parents.set(collection, ids);
  }

  return parents;
}

/** One `$push`ed group member, with the instant that orders it. */
function describeMember(entry: unknown): DuplicateOpenValidationRequest | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as { id?: unknown; createdAt?: unknown };
  const raw = record.id;
  const id = isObjectId(raw) ? raw.toHexString() : typeof raw === 'string' ? raw : null;
  if (id === null || id.length === 0) return null;

  // `createdAt` is the field that genuinely orders these — the model carries
  // Mongoose timestamps. It is read through the same coercion every transform
  // uses, so a value the copy would refuse is refused here too rather than
  // silently ordering the group wrong.
  const createdAt = date({ _id: id, createdAt: record.createdAt }, 'createdAt');
  if (createdAt !== null) return { id, orderedAt: createdAt, orderedBy: 'createdAt' };

  // Falling back to the ObjectId's own embedded timestamp is second-best but
  // still a real instant. A string `_id` has neither, and the deterministic id
  // tie-break below is all that is left.
  const generated = objectIdTimestamp(id);
  if (generated !== null) return { id, orderedAt: generated, orderedBy: 'objectId timestamp' };
  return { id, orderedAt: null, orderedBy: 'id only' };
}

/**
 * Most recent first, with a DETERMINISTIC tie-break.
 *
 * The tie-break is not cosmetic: the copy is re-runnable and the verifier
 * recomputes this, so a comparator that could order two equal timestamps
 * differently between calls would let a re-run keep a different survivor and
 * leave two rows open.
 */
function mostRecentFirst(
  a: DuplicateOpenValidationRequest,
  b: DuplicateOpenValidationRequest
): number {
  const left = a.orderedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const right = b.orderedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (left !== right) return right - left;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// ---------------------------------------------------------------------------
// what a transform is handed
// ---------------------------------------------------------------------------

/** Everything a transform needs to apply the documented rules. */
export interface ResolutionContext {
  /** Requests that lost the most-recent-wins tie-break and are written terminal. */
  readonly demotedValidationRequestIds: ReadonlySet<string>;
  /** Record that a rule changed what a document becomes. */
  readonly record: (entry: ResolutionRecord) => void;
  /**
   * Does a rule already answer this uniqueness collision?
   *
   * Asked by `auditUniqueness`, so `audit.ts` needs no knowledge of any
   * particular rule. True only when the rule acts on all but ONE of the
   * group's rows — the survivor. A group it would empty entirely, or one it
   * does not touch (the audit over-approximates a PARTIAL index, so two
   * already-closed requests are reported and are legal), is NOT resolved and
   * still blocks: fail-closed, because only a human can say whether a
   * collision the rule was not written for matters.
   */
  readonly resolvesUniquenessGroup: (rule: ResolutionRule, ids: readonly string[]) => boolean;
  /**
   * Every `_id` each parent collection holds — {@link ResolutionPlan.orphanParents}.
   *
   * Read by {@link transformDocument}, never by a transform: the orphan rules
   * are applied to the ROW a transform emits rather than inside it, so no plan
   * has to remember to ask.
   */
  readonly orphanParents: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Bind a plan and a log into the context a transform is called with. */
export function createResolutionContext(
  plan: ResolutionPlan,
  log: ResolutionLog
): ResolutionContext {
  return {
    demotedValidationRequestIds: plan.demotedValidationRequestIds,
    orphanParents: plan.orphanParents,
    record: (entry) => {
      log.record(entry);
    },
    resolvesUniquenessGroup: (rule, ids) => {
      if (rule.id !== DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS.id) return false;
      if (ids.length < 2) return false;
      const demoted = ids.filter((id) => plan.demotedValidationRequestIds.has(id));
      return demoted.length === ids.length - 1;
    },
  };
}

// ---------------------------------------------------------------------------
// running a transform under the rules
// ---------------------------------------------------------------------------

/** One documented rule that fired on one emitted row. */
export interface AppliedOrphanResolution {
  readonly relation: OrphanRelation;
  /** The value the row carried — absent from the parent set, which is why it fired. */
  readonly value: string;
}

/**
 * One row a document produced, with what the documented rules did to it.
 *
 * `source` and `written` are BOTH carried, and the split is the whole point:
 *
 * - The **audit** checks references on `source`, so every orphan is still found,
 *   counted and named even when a rule removes the row that carried it. A rule
 *   that made the finding disappear would be a silenced check, which
 *   `resolutions.ts` exists not to be.
 * - Everything that WRITES uses `written`, and cannot write a dropped row by
 *   accident: `written` is `null` for one, so a consumer has to handle the null
 *   before it has a row at all.
 */
export interface ResolvedRow {
  readonly table: PgTable;
  /** The row the transform built. Never written; it is the report's evidence. */
  readonly source: Record<string, unknown>;
  /** The row to WRITE, or `null` when a rule drops it entirely. */
  readonly written: Record<string, unknown> | null;
  /** Every rule that acted on it. Empty for the overwhelming majority of rows. */
  readonly applied: readonly AppliedOrphanResolution[];
}

/**
 * Run a plan's transform and apply the documented ROW-level resolutions to
 * everything it emits.
 *
 * Every caller of `plan.transform` goes through this — the copy, the verifier's
 * two passes and the referential audit — which is what makes the decisions the
 * same in all of them by construction rather than by four call sites
 * remembering. It is also why the orphan rules are NOT written inside the
 * transforms: a transform describes the MAPPING, one document to its rows, and
 * a rule that erases a row is not part of that description. (The card and
 * duplicate-request rules are inside their transforms because they are
 * per-document VALUE decisions that need the document, which this wrapper does
 * not have a general way to reach.)
 */
export function transformDocument(
  plan: CollectionPlan,
  doc: MongoDocument,
  resolutions: ResolutionContext,
  emit: (row: ResolvedRow) => void
): void {
  const documentId = describeId(doc) ?? UNIDENTIFIED_DOCUMENT;
  plan.transform(
    doc,
    (table, row) => {
      emit(resolveOrphanedReferences(table, row, documentId, resolutions));
    },
    resolutions
  );
}

/** What a record names when the document carries no `_id` to name it by. */
const UNIDENTIFIED_DOCUMENT = '(document has no _id)';

/**
 * Apply every declared orphan resolution to one emitted row.
 *
 * NARROW BY CONSTRUCTION, and the narrowness is worth spelling out because a
 * widened predicate here DELETES PRODUCTION ROWS:
 *
 * - Only a table named in {@link ORPHAN_RESOLUTIONS} is considered at all; every
 *   other row returns with `written === source` and nothing recorded.
 * - Only the ONE declared column of each entry is read.
 * - A NULL, absent or non-string value is left alone — under MATCH SIMPLE a NULL
 *   component satisfies the constraint unconditionally, so there is no orphan to
 *   answer.
 * - The value must be ABSENT from the parent set. A value the parent collection
 *   holds is not touched, which is the property the control rows in
 *   `__tests__/orphanResolutions.test.ts` assert and the mutation test breaks.
 * - An unknown or empty parent set stands the rule down entirely.
 */
function resolveOrphanedReferences(
  table: PgTable,
  row: Record<string, unknown>,
  documentId: string,
  resolutions: ResolutionContext
): ResolvedRow {
  const declared = ORPHAN_RESOLUTIONS_BY_TABLE.get(tableName(table));
  if (declared === undefined) return { table, source: row, written: row, applied: [] };

  const applied: AppliedOrphanResolution[] = [];
  let dropped = false;
  let written = row;

  for (const relation of declared) {
    const parents = resolutions.orphanParents.get(relation.parentCollection);
    if (parents === undefined || parents.size === 0) continue;
    const value = row[relation.property];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (parents.has(value)) continue;

    applied.push({ relation, value });
    if (relation.action === 'drop-row') dropped = true;
    else written = { ...written, [relation.property]: null };

    // Read off the SOURCE row: the columns a rule carries describe what the row
    // pointed at, and for a dropped row there will be nothing else left to read
    // them from.
    const evidence = carriedColumns(relation, row);

    resolutions.record({
      rule: relation.rule,
      documentId,
      // One document can produce several rows for the same relation — a
      // `devicesessions` document holds an array of accounts — so the record is
      // keyed by the offending value too rather than collapsing them.
      within: value,
      detail:
        `${relation.tableName}.${relation.columnName} is ${JSON.stringify(value)}, ` +
        `which no \`${relation.parentCollection}\` document holds. ` +
        (relation.action === 'drop-row'
          ? 'The ROW is dropped and nothing else about it is written; ON DELETE ' +
            "CASCADE is the schema's own answer to a missing parent. " +
            (relation.whyNotNull === undefined
              ? 'The column is NOT NULL, so no value satisfies the constraint.'
              : 'The column is NULLABLE and NULL was deliberately not written — ' +
                'see the rule.')
          : 'The COLUMN is written NULL and the row is KEPT; the column is ' +
            'nullable with ON DELETE SET NULL, which is exactly where that ' +
            'policy puts a row whose parent is gone. Every other column is ' +
            'written verbatim.'),
      ...(evidence === null ? {} : { evidence }),
    });
  }

  return { table, source: row, written: dropped ? null : written, applied };
}

/**
 * The columns a rule carries, read off the row it is acting on.
 *
 * `null` when the rule carries none, which is every rule but the `files` one.
 * A declared column the row does not hold is REPORTED as `(absent)` rather than
 * omitted: a worklist entry missing its key silently would be worse than one
 * that says the key was not there.
 */
function carriedColumns(
  relation: OrphanRelation,
  row: Record<string, unknown>
): Record<string, string> | null {
  if (relation.carry === undefined || relation.carry.length === 0) return null;
  const carried: Record<string, string> = {};
  for (const column of relation.carry) {
    const value = row[column.name];
    carried[sqlColumnName(column)] =
      value === null || value === undefined ? '(absent)' : String(value);
  }
  return carried;
}

// ---------------------------------------------------------------------------
// applying the rules
// ---------------------------------------------------------------------------

/** How much of an offending `card.type` to quote in the report. */
const CARD_TYPE_EXCERPT = 120;

/**
 * Decide what a message's `card` becomes: the card itself, or nothing.
 *
 * NARROW BY CONSTRUCTION — the only thing that triggers the rule is a
 * `card.type` outside the five values `messages.card_type` declares, read from
 * the drizzle column so it cannot drift from the CHECK. A card with a valid
 * type is returned untouched, including its `data`, `confidence` and
 * `extractedAt`; widening this predicate would silently discard cards that
 * render perfectly well today.
 *
 * @returns The card to write, or `null` to write the message with no card.
 */
export function resolveMessageCard(
  documentId: string,
  card: MongoDocument | null,
  resolutions: ResolutionContext
): MongoDocument | null {
  if (card === null) return null;
  const type = card.type;
  if (typeof type === 'string' && allowedValues(messages.cardType).includes(type)) return card;

  resolutions.record({
    rule: DROP_UNRENDERABLE_MESSAGE_CARD,
    documentId,
    detail:
      `card.type is ${excerpt(type)}, which is not one of ` +
      `${allowedValues(messages.cardType).join(' | ')}. The card is dropped ` +
      '(all four card columns NULL); the message and its body are written unchanged.',
  });
  return null;
}

/** A value rendered for the report, bounded so one bad document cannot flood it. */
function excerpt(value: unknown): string {
  const rendered = value === undefined ? 'undefined' : JSON.stringify(value);
  return rendered.length <= CARD_TYPE_EXCERPT
    ? rendered
    : `${rendered.slice(0, CARD_TYPE_EXCERPT)}…`;
}

/** The lifecycle state a validation request is written with. */
export interface ResolvedValidationRequestState {
  readonly status: string;
  readonly outcome: string | null;
}

/**
 * Decide the status a validation request is written with.
 *
 * A request that did not lose the tie-break is returned exactly as the source
 * has it. A demoted one is written {@link DEMOTED_VALIDATION_REQUEST_STATUS}
 * with a NULL outcome — null because `validation_requests_terminal_check`
 * requires it for a non-verdict terminal status, and because a jury that never
 * voted has no verdict to carry.
 */
export function resolveValidationRequestState(
  documentId: string,
  status: string,
  outcome: string | null,
  resolutions: ResolutionContext
): ResolvedValidationRequestState {
  if (!resolutions.demotedValidationRequestIds.has(documentId)) return { status, outcome };

  resolutions.record({
    rule: DEMOTE_DUPLICATE_OPEN_VALIDATION_REQUESTS,
    documentId,
    detail:
      `status ${JSON.stringify(status)} → ${JSON.stringify(DEMOTED_VALIDATION_REQUEST_STATUS)}: ` +
      'a more recent request holds the same `sourceActionId` open, and only one ' +
      'may. Every other field is written verbatim; nothing is deleted.',
  });
  return { status: DEMOTED_VALIDATION_REQUEST_STATUS, outcome: null };
}

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
 * ## The two rules
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
 */

import { messages } from '../schema/messages';
import { OPEN_VALIDATION_REQUEST_STATUSES, VALIDATION_REQUEST_STATUSES } from '../schema/validationRequests';
import type { MongoSource } from './mongoSource';
import { allowedValues } from './plan';
import { date, isObjectId, type MongoDocument } from './values';

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
];

// ---------------------------------------------------------------------------
// what the rules did
// ---------------------------------------------------------------------------

/** One document a rule acted on. */
export interface ResolutionRecord {
  readonly rule: ResolutionRule;
  /** The source `_id`, so the operator can look the row up in Mongo. */
  readonly documentId: string;
  /** What changed about this document, specifically. */
  readonly detail: string;
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
    this.records.set(`${entry.rule.id} ${entry.documentId}`, entry);
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
 * Only the duplicate-request rule needs one: "which of these is the most
 * recent" is a question about a GROUP, and a per-document transform cannot see
 * a group. The card rule is a per-document predicate and needs nothing.
 */
export interface ResolutionPlan {
  readonly duplicateOpenValidationRequests: readonly DuplicateOpenValidationRequestGroup[];
  /** Every id that loses the most-recent-wins tie-break, across all groups. */
  readonly demotedValidationRequestIds: ReadonlySet<string>;
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
 * Read the source and decide which duplicate open requests are demoted.
 *
 * `aggregate` only — the source handle refuses anything that is not a read
 * ({@link MongoSource}), so this cannot touch the rollback source it reads.
 *
 * The `$match` mirrors the transform's own `str(doc,'status') ?? 'pending'`:
 * `{status: null}` in Mongo matches both an explicit null AND a missing field,
 * which is exactly the set of documents the copy writes as `pending`. If the
 * two disagreed, a row the pre-pass thought was closed would land open and
 * collide.
 */
export async function planResolutions(source: MongoSource): Promise<ResolutionPlan> {
  const groups = await source
    .collection(VALIDATION_REQUESTS_COLLECTION)
    .aggregate([
      {
        $match: {
          // A NULL `source_action_id` could not collide anyway — the column is
          // NOT NULL here, and a unique index is NULLS DISTINCT regardless.
          sourceActionId: { $ne: null },
          $or: [{ status: { $in: [...OPEN_VALIDATION_REQUEST_STATUSES] } }, { status: null }],
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

  return { duplicateOpenValidationRequests: resolved, demotedValidationRequestIds };
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
}

/** Bind a plan and a log into the context a transform is called with. */
export function createResolutionContext(
  plan: ResolutionPlan,
  log: ResolutionLog
): ResolutionContext {
  return {
    demotedValidationRequestIds: plan.demotedValidationRequestIds,
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

/**
 * Pre-flight audits — run against the LIVE source, before a single row is
 * inserted.
 *
 * Everything here answers one question: which production documents would the
 * Postgres schema refuse, and why? Finding out during the copy is far worse
 * than finding out first — a `23514` three hours into a 296,924-document run
 * names a constraint, not a row, and by then the operator has to decide between
 * aborting a partial migration and hand-patching data under time pressure.
 *
 * ## Why an enum audit is necessary at all
 *
 * Mongoose validators only run on documents saved through a MODEL, and this
 * codebase never set `runValidators` on its update paths — so an `enum:` in a
 * schema is documentation, not a constraint. Live data can and does hold values
 * the schema forbids; this repo has a confirmed case of `status: 'restricted'`
 * written against an enum declaring three other values. A Postgres CHECK **is**
 * enforced. Every such value is a row the migration will reject, and every one
 * is reported here with its count.
 *
 * The audit reads the allowed set from the drizzle COLUMN, never from a list
 * repeated here, so it predicts the CHECK rather than a copy of it.
 *
 * ## Why a uniqueness audit is necessary
 *
 * Postgres now has case-insensitive unique indexes Mongo lacked the collation
 * for (`labels`, `email_templates`, `bundles`, and the `users` identifiers).
 * Two rows differing only by case are legal in Mongo today and collide here.
 * The audit reports the colliding GROUPS — both sides, with their ids — rather
 * than letting the copy fail on the second one, because "which of these two is
 * the real one" is a decision for a human and the report is what that decision
 * needs.
 *
 * ## Findings are not warnings
 *
 * `auditWouldBlockCopy` is true for every finding here. The runner refuses to
 * copy a collection with a blocking finding. There is deliberately no override
 * flag: the two ways forward are to fix the data or to widen the schema, and
 * both are decisions, not switches.
 */

import type { PgColumn } from 'drizzle-orm/pg-core';
import type { CollectionPlan, EnumAudit, UniquenessNormalization } from './plan';
import { allowedValues } from './plan';
import type { MongoSource } from './mongoSource';

/** One thing the schema would refuse. */
export interface AuditFinding {
  readonly collection: string;
  /** `enum` | `uniqueness` | `file-system-owner`. */
  readonly kind: 'enum' | 'uniqueness' | 'file-system-owner';
  /** Human-readable, and specific enough to act on without opening the code. */
  readonly detail: string;
  /** Documents affected, where the audit can count them. */
  readonly documents: number;
  /** A few offending `_id`s, so the operator can look at real rows. */
  readonly sampleIds: readonly string[];
}

/** How many colliding/offending ids to quote per finding. */
const SAMPLE_LIMIT = 5;

/**
 * Check every enum-backed column of a plan against `distinct()` on the source.
 *
 * `distinct` is the right instrument: it is a single index-assisted pass that
 * returns the VALUE SET rather than the documents, so it costs the same on a
 * 300,000-document collection as on a 20-document one — which is what makes it
 * affordable to run over everything before touching anything.
 */
export async function auditEnums(
  source: MongoSource,
  plan: CollectionPlan
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const audit of plan.enumAudits ?? []) {
    const allowed = new Set(allowedValues(audit.column));
    const collection = source.collection(plan.collection);
    const observed = await collection.distinct(audit.path, {});

    for (const value of observed) {
      // Absent is not a violation when the transform substitutes a default —
      // that is what `absentAs` declares. Reporting it would be a false
      // positive on every document written before the field existed.
      if (value === null || value === undefined) {
        if (audit.absentAs !== undefined) continue;
        findings.push(
          await describeEnumFinding(source, plan, audit, null, 'is absent/null and no default is declared')
        );
        continue;
      }
      if (typeof value !== 'string') {
        findings.push(
          await describeEnumFinding(
            source,
            plan,
            audit,
            value,
            `is ${typeof value}, but the column is text`
          )
        );
        continue;
      }
      if (allowed.has(value)) continue;
      findings.push(
        await describeEnumFinding(
          source,
          plan,
          audit,
          value,
          `is not one of ${[...allowed].join(' | ')}`
        )
      );
    }
  }
  return findings;
}

async function describeEnumFinding(
  source: MongoSource,
  plan: CollectionPlan,
  audit: EnumAudit,
  value: unknown,
  why: string
): Promise<AuditFinding> {
  const collection = source.collection(plan.collection);
  const filter = { [audit.path]: value } as Record<string, unknown>;
  const documents = await collection.countDocuments(filter);
  const samples = await collection
    .find(filter, { projection: { _id: 1 }, limit: SAMPLE_LIMIT })
    .toArray();
  return {
    collection: plan.collection,
    kind: 'enum',
    detail:
      `${plan.collection}.${audit.path} = ${JSON.stringify(value)} ${why}. ` +
      `${columnLabel(audit.column)} would reject these rows.`,
    documents,
    sampleIds: samples.map((doc) => String(doc._id)),
  };
}

function columnLabel(column: PgColumn): string {
  return `The CHECK on ${column.name}`;
}

/**
 * Find groups of documents that collide under a uniqueness rule Postgres
 * enforces and Mongo did not.
 *
 * Implemented as one `$group` over the normalized key. `$toLower` is applied to
 * the case-insensitive paths, which is the same normalization the Postgres
 * expression index applies — with the ONE known boundary `CONVENTIONS.md`
 * already records: Postgres `lower()` is simple case mapping while Mongo's
 * `$toLower` is too, so the two agree here; it is JavaScript's
 * `toLowerCase()` that differs, and no part of this audit uses it.
 */
export async function auditUniqueness(
  source: MongoSource,
  plan: CollectionPlan
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const audit of plan.uniquenessAudits ?? []) {
    // Postgres unique indexes are NULLS DISTINCT: a row with a NULL in ANY
    // indexed column never conflicts. Excluding those rows is not an
    // optimisation — including them reports every sparse row as colliding with
    // every other, which is a false positive on exactly the columns most likely
    // to be sparse.
    const present: Record<string, unknown> = {};
    for (const part of audit.key) {
      present[part.path] = { $nin: [null, undefined] };
    }

    const groupKey: Record<string, unknown> = {};
    for (const part of audit.key) {
      groupKey[keyAlias(part.path)] = normalizedExpression(part.path, part.normalize);
    }

    const groups = await source
      .collection(plan.collection)
      .aggregate([
        { $match: present },
        { $group: { _id: groupKey, count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ])
      .toArray();

    for (const group of groups) {
      const ids = Array.isArray(group.ids) ? group.ids : [];
      findings.push({
        collection: plan.collection,
        kind: 'uniqueness',
        detail:
          `${audit.index} would reject ${group.count} documents sharing the key ` +
          `${JSON.stringify(group._id)} (normalized as ` +
          `${audit.key.map((part) => `${part.path}:${part.normalize}`).join(', ')}). ` +
          'Mongo allowed them to coexist; Postgres will not. ' +
          'Decide which row survives — the migration must not choose.',
        documents: typeof group.count === 'number' ? group.count : ids.length,
        sampleIds: ids.slice(0, SAMPLE_LIMIT).map((value: unknown) => String(value)),
      });
    }
  }
  return findings;
}

/**
 * The Mongo expression matching one column's index expression.
 *
 * `$toLower` and Postgres `lower()` both apply SIMPLE case mapping, so they
 * agree — the boundary `CONVENTIONS.md` records is JavaScript's
 * `String.toLowerCase()`, which applies FULL case mapping and is used by
 * neither side of this comparison. `$trim` with no `chars` strips whitespace,
 * as `btrim` with no second argument does.
 */
function normalizedExpression(path: string, normalize: UniquenessNormalization): unknown {
  const field = `$${path}`;
  if (normalize === 'exact') return field;
  if (normalize === 'lower') return { $toLower: field };
  return { $toLower: { $trim: { input: field } } };
}

/** `$group` keys cannot contain a dot; `plan.name` becomes `plan__name`. */
function keyAlias(path: string): string {
  return path.replace(/\./g, '__');
}

/**
 * Census the `files.ownerUserId` sentinel split, and report any sentinel the
 * schema does not declare.
 *
 * `files` is the largest collection and this is its one structural change:
 * `__federation__`, `__federation_media_cache__` and `__link_preview_cache__`
 * move to `system_owner`, everything else stays in `owner_user_id`, and a CHECK
 * asserts exactly one is set. The discriminator is `like '\_\_%'` — an ObjectId
 * hex can never start with an underscore.
 *
 * The transform already throws on an undeclared sentinel. This runs FIRST so
 * the operator learns about a fourth namespace before the copy starts rather
 * than partway through 296,924 documents, and it prints the census either way
 * because "how many rows land in each namespace" is the number the verifier
 * checks afterwards.
 */
export async function auditFileSystemOwners(
  source: MongoSource,
  collection: string,
  declaredSentinels: readonly string[]
): Promise<{ findings: AuditFinding[]; census: Record<string, number> }> {
  const handle = source.collection(collection);
  const groups = await handle
    .aggregate([
      { $match: { ownerUserId: { $regex: '^__' } } },
      { $group: { _id: '$ownerUserId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    ])
    .toArray();

  const census: Record<string, number> = {};
  const findings: AuditFinding[] = [];
  for (const group of groups) {
    const sentinel = String(group._id);
    const count = typeof group.count === 'number' ? group.count : 0;
    census[sentinel] = count;
    if (declaredSentinels.includes(sentinel)) continue;
    const ids = Array.isArray(group.ids) ? group.ids : [];
    findings.push({
      collection,
      kind: 'file-system-owner',
      detail:
        `ownerUserId = ${JSON.stringify(sentinel)} starts with "__" so it is a ` +
        'system-owner sentinel, but it is not one of the three FILE_SYSTEM_OWNERS ' +
        `the schema declares (${declaredSentinels.join(', ')}). ` +
        'files_system_owner_check would reject these rows. A fourth namespace was ' +
        'introduced without the schema learning about it.',
      documents: count,
      sampleIds: ids.slice(0, SAMPLE_LIMIT).map((value: unknown) => String(value)),
    });
  }
  return { findings, census };
}

/**
 * Every finding blocks the copy.
 *
 * Written as a function rather than assumed, so a future finding class that is
 * genuinely advisory has one place to say so — and so the runner's refusal
 * reads as a decision rather than an accident.
 */
export function auditWouldBlockCopy(finding: AuditFinding): boolean {
  return (
    finding.kind === 'enum' ||
    finding.kind === 'uniqueness' ||
    finding.kind === 'file-system-owner'
  );
}

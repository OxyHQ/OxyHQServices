/**
 * One-shot MongoDB → PostgreSQL backfill.
 *
 * Runs as an ECS Fargate task inside the VPC, because production Mongo and RDS
 * are both unreachable from a laptop:
 *
 * ```bash
 * aws --profile oxy --region us-west-2 ecs run-task \
 *   --cluster oxy-cluster --task-definition oxy-pg-migrate --launch-type FARGATE \
 *   --network-configuration 'awsvpcConfiguration={subnets=[…],securityGroups=[…],assignPublicIp=ENABLED}' \
 *   --overrides '{"containerOverrides":[{"name":"oxy-api","command":[
 *      "bun","run","packages/api/scripts/backfill-mongo-to-postgres.ts","--audit-only"]}]}'
 * ```
 *
 * It lives in `packages/api/scripts/` and not `/tmp` for a concrete reason: the
 * image installs with bun's ISOLATED linker, so a package resolves at
 * `/app/node_modules/.bun/<pkg>@<ver>+<hash>/node_modules/<pkg>` and a script
 * outside a package's own resolution graph cannot `require` anything. The
 * Dockerfile copies `packages/api/scripts` and `packages/api/src`, so this file
 * and everything it imports are present and resolvable.
 *
 * ## The phases, and why they are separable
 *
 * | flag | phases |
 * |---|---|
 * | `--audit-only` | discover + audit. Touches nothing. Run this FIRST. |
 * | (default) | discover + audit + copy |
 * | `--verify` | …and verify afterwards |
 * | `--verify-only` | verify an already-copied database |
 *
 * `--audit-only` exists because the audits are the phase whose OUTPUT is a
 * decision: an enum value the CHECK refuses, two names that collide
 * case-insensitively, or a row naming a parent that does not exist, has to be
 * resolved by a human before a copy is worth starting. Discovering that partway
 * through 296,924 documents is the outcome this separation prevents — and did
 * not, until the referential-integrity audit was added: the first production
 * run reported CLEAN here and then failed on `bundles_user_id_users_id_fk`.
 *
 * `--audit-only` is no longer cheap. The referential pass streams every mapped
 * collection and runs its transform, so it costs roughly the read half of a
 * copy. `--batch-size` applies to it.
 *
 * ## Safety
 *
 * - MongoDB access is read-only by construction (`mongoSource.ts` hands out a
 *   Proxy that throws on anything but a read).
 * - Every insert is `ON CONFLICT DO NOTHING`, so re-running is always safe.
 * - `--state-file` makes a re-run resume instead of re-scanning. Losing the
 *   file costs time, never integrity.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { connectPostgres, closePostgres } from '../src/config/postgres';
import {
  COLLECTION_PLANS,
  NOT_MIGRATED,
  knownCollections,
  tablesWithoutAPlan,
} from '../src/db/backfill/collectionMap';
import { connectMongoSource, redactUri, type Checkpoint } from '../src/db/backfill/mongoSource';
import { auditWouldBlockCopy, type AuditFinding } from '../src/db/backfill/audit';
import {
  describeRelationColumns,
  VacuousReferentialIntegrityError,
  type ReferentialIntegrityReport,
} from '../src/db/backfill/referentialIntegrity';
import {
  createResolutionContext,
  planResolutions,
  ResolutionLog,
  type ResolutionPlan,
  type ResolutionSummary,
} from '../src/db/backfill/resolutions';
import {
  AuditBlockedError,
  DEFAULT_BATCH_SIZE,
  discover,
  emptyState,
  runAudits,
  runBackfill,
  UnknownCollectionError,
  type BackfillState,
} from '../src/db/backfill/runner';
import { verifyBackfill, VacuousVerificationError, VerificationError } from '../src/db/backfill/verify';

interface Options {
  readonly auditOnly: boolean;
  readonly verify: boolean;
  readonly verifyOnly: boolean;
  readonly restart: boolean;
  readonly batchSize: number;
  readonly stateFile: string | null;
  readonly only: readonly string[] | undefined;
  readonly sampleSize: number;
}

function parseOptions(argv: readonly string[]): Options {
  const flag = (name: string): boolean => argv.includes(`--${name}`);
  const value = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const found = argv.find((arg) => arg.startsWith(prefix));
    return found?.slice(prefix.length);
  };
  const numeric = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--${name} must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    return parsed;
  };
  const only = value('only');
  return {
    auditOnly: flag('audit-only'),
    verify: flag('verify'),
    verifyOnly: flag('verify-only'),
    restart: flag('restart'),
    batchSize: numeric('batch-size', DEFAULT_BATCH_SIZE),
    stateFile: value('state-file') ?? null,
    only: only === undefined ? undefined : only.split(',').map((entry) => entry.trim()),
    sampleSize: numeric('sample-size', 25),
  };
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function heading(title: string): void {
  say(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

async function loadState(path: string | null, restart: boolean): Promise<BackfillState> {
  if (path === null || restart) return emptyState();
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('state file does not contain an object');
    }
    const record = parsed as Partial<BackfillState>;
    return {
      checkpoints: record.checkpoints ?? {},
      completed: record.completed ?? [],
    };
  } catch (error) {
    // A MISSING state file is the normal first run and must not be an error; a
    // CORRUPT one must be, because silently starting from zero would turn a
    // resumed run into a full rescan nobody asked for and hide the corruption.
    if (isNotFound(error)) {
      say(`No state file at ${path} — starting from the beginning.`);
      return emptyState();
    }
    throw new Error(
      `Could not read the state file at ${path}: ${describeError(error)}. ` +
        'Delete it to start over, or pass --restart.'
    );
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is not set — it names the SOURCE database');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — it names the TARGET database');
  }

  say(`Source (MongoDB): ${redactUri(mongoUri)}`);
  say(`Target (Postgres): ${redactUri(process.env.DATABASE_URL)}`);
  say(`Batch size: ${options.batchSize}`);

  const orphanTables = tablesWithoutAPlan();
  if (orphanTables.length > 0) {
    throw new Error(
      `${orphanTables.length} table(s) are declared in the schema but no plan ` +
        `feeds them: ${orphanTables.join(', ')}. Every table must have a source ` +
        'or be a deliberate post-cutover-only table — and there is currently no ' +
        'member of that second class, so this is a gap.'
    );
  }
  say(
    `Map: ${COLLECTION_PLANS.length} collection(s) migrated, ` +
      `${NOT_MIGRATED.length} excluded, ${knownCollections().length} known in total.`
  );

  const db = await connectPostgres();
  const source = await connectMongoSource(mongoUri);
  let exitCode = 0;

  try {
    if (options.verifyOnly) {
      return await runVerification(db, source, options);
    }

    // ---- discover ---------------------------------------------------------
    heading('DISCOVERY');
    const discovery = await discover(source);
    for (const entry of discovery.migrated) {
      say(`  migrate  ${entry.plan.collection.padEnd(32)} ${entry.documents} document(s)`);
    }
    for (const entry of discovery.excluded) {
      say(`  EXCLUDE  ${entry.collection.padEnd(32)} ${entry.documents} document(s)`);
      say(`           reason: ${entry.reason}`);
    }
    if (discovery.absent.length > 0) {
      say(`\n  Mapped but absent from this database (nothing to do): ${discovery.absent.join(', ')}`);
    }
    if (discovery.unknown.length > 0) {
      throw new UnknownCollectionError(discovery.unknown);
    }

    // ---- audit ------------------------------------------------------------
    //
    // The resolution pre-pass runs FIRST, because a finding a documented rule
    // answers has to be reported as answered rather than as blocking — and the
    // `--audit-only` report must show the same decisions the copy would apply.
    const resolutionPlan = await planResolutions(source);
    // The log is held rather than discarded: the audit phase RUNS the plans'
    // transforms, so by the end of it every rule has already acted on exactly
    // the rows it will act on during the copy. `--audit-only` prints that,
    // which is how an operator sees the specific list before anything is
    // written rather than after.
    const auditResolutionLog = new ResolutionLog();
    const resolutions = createResolutionContext(resolutionPlan, auditResolutionLog);

    heading('AUDIT');
    const { findings, fileOwnerCensus, referentialIntegrity } = await runAudits(
      source,
      discovery,
      resolutions,
      { batchSize: options.batchSize }
    );
    if (Object.keys(fileOwnerCensus).length > 0) {
      say('  files.ownerUserId system-owner census:');
      for (const [sentinel, count] of Object.entries(fileOwnerCensus).sort()) {
        say(`    ${sentinel.padEnd(32)} ${count} file(s)`);
      }
    }
    if (findings.length === 0) {
      say('  No findings. Every value the schema constrains is one the schema accepts.');
    }
    for (const finding of findings) reportFinding(finding);

    const blocking = findings.filter(auditWouldBlockCopy);
    const answered = findings.length - blocking.length;
    if (findings.length > 0) {
      say(
        `\n  ${blocking.length} finding(s) BLOCK the copy; ` +
          `${answered} answered by a documented resolution rule.`
      );
    }
    reportReferentialIntegrity(referentialIntegrity);
    reportResolutionPlan(resolutionPlan);

    if (options.auditOnly) {
      // What the rules WOULD do, by id — measured, because the audit already
      // ran every transform under exactly these decisions.
      reportResolutionsApplied(
        auditResolutionLog.summary(),
        referentialIntegrity,
        'RESOLUTIONS THE COPY WOULD APPLY'
      );
      heading(blocking.length === 0 ? 'AUDIT CLEAN' : 'AUDIT FOUND BLOCKING ROWS');
      return blocking.length === 0 ? 0 : 1;
    }

    // ---- copy -------------------------------------------------------------
    heading('COPY');
    const state = await loadState(options.stateFile, options.restart);
    const summary = await runBackfill(
      {
        db,
        source,
        batchSize: options.batchSize,
        onProgress: (message) => say(`  ${message}`),
        onCheckpoint: async (collection, checkpoint) => {
          if (options.stateFile === null) return;
          await persistCheckpoint(options.stateFile, state, collection, checkpoint);
        },
      },
      state,
      options.only
    );

    heading('COPY RESULT');
    let totalRows = 0;
    for (const copy of summary.copies) {
      say(`  ${copy.collection}: ${copy.documentsRead} document(s) read`);
      for (const [table, rows] of Object.entries(copy.rowsByTable)) {
        say(`      → ${table.padEnd(40)} ${rows} row(s)`);
        totalRows += rows;
      }
      if (copy.selfReferencesFilled > 0) {
        say(`      → self-references filled: ${copy.selfReferencesFilled}`);
      }
    }
    say(`\n  ${totalRows} row(s) written across ${summary.copies.length} collection(s).`);

    reportResolutionsApplied(
      summary.resolutions,
      summary.referentialIntegrity,
      'RESOLUTIONS APPLIED'
    );

    if (options.verify) exitCode = await runVerification(db, source, options);
  } catch (error) {
    if (error instanceof UnknownCollectionError || error instanceof AuditBlockedError) {
      heading('REFUSED');
      say(error.message);
      return 1;
    }
    // A vacuous referential pass is not a data problem and not a clean run — it
    // says the audit itself did not work, which must never read as "no orphans".
    if (error instanceof VacuousReferentialIntegrityError) {
      heading('AUDIT DID NOT RUN');
      say(error.message);
      return 1;
    }
    throw error;
  } finally {
    await source.close();
    await closePostgres();
  }

  return exitCode;
}

/**
 * One audit finding, saying plainly whether it blocks.
 *
 * A finding a rule answers is printed in FULL — same value, same count, same
 * ids — with the rule and its decision underneath. The point of a resolution is
 * that the operator can see the decision was applied as stated; a finding that
 * quietly stopped being printed would defeat exactly that.
 */
function reportFinding(finding: AuditFinding): void {
  say(`  [${finding.kind}] ${finding.detail}`);
  say(`      ${finding.documents} document(s); e.g. ${finding.sampleIds.join(', ') || '(none)'}`);
  if (finding.resolvedBy === undefined) {
    say('      BLOCKS the copy — fix the data, widen the schema, or write a rule.');
    return;
  }
  say(`      RESOLVED by \`${finding.resolvedBy.id}\` — does not block.`);
  say(`      decision: ${finding.resolvedBy.decision}`);
}

/**
 * The referential-integrity pass: what it inspected, then every orphan it found.
 *
 * The COUNTS print whether or not anything was found, and that is the point —
 * "no orphans" is a claim about a check, so the operator has to be able to see
 * that the check looked at 165 relations and half a million references rather
 * than at nothing. The previous audit reported clean by having no such check at
 * all.
 *
 * Orphans print by VALUE with the referencing document ids under each, because
 * one deleted account is usually the whole explanation for a relation's findings
 * and a flat list of 44 document ids hides that.
 */
function reportReferentialIntegrity(report: ReferentialIntegrityReport): void {
  heading('REFERENTIAL INTEGRITY');
  if (!report.ran) {
    say('  NOT RUN — referential integrity is UNKNOWN, which is not the same as clean.');
    say(`  ${report.skippedReason ?? '(no reason recorded)'}`);
    return;
  }
  say(
    `  ${report.relationsInspected} foreign key(s) derived from the schema, ` +
      `${report.relationsExercised} of them exercised by this data; ` +
      `${report.collectionsInspected} collection(s) streamed, ` +
      `${report.documentsInspected} document(s) read, ${report.rowsInspected} row(s) ` +
      `built, ${report.referencesChecked} non-NULL reference(s) resolved.`
  );

  // Transform fidelity FIRST: it is the evidence behind every origin verdict
  // below, and a deficit here is a worse problem than any orphan. The two
  // reasons a plan emits fewer rows than it read are printed APART, because
  // they are opposite events: one is a decision with the ids to check it
  // against, the other is silent data loss.
  const lossy = report.emissions.filter((entry) => entry.documentsRead !== entry.primaryRowsEmitted);
  say(
    `  Transform fidelity: ${report.emissions.length - lossy.length} of ` +
      `${report.emissions.length} plan(s) emitted exactly one primary row per ` +
      'document read.'
  );
  for (const entry of lossy) {
    const unexplained =
      entry.documentsRead - entry.primaryRowsEmitted - entry.primaryRowsDroppedByRule;
    if (entry.primaryRowsDroppedByRule > 0) {
      say(
        `    by RULE  ${entry.collection}: read ${entry.documentsRead}, emitted ` +
          `${entry.primaryRowsEmitted} into ${entry.table} — ` +
          `${entry.primaryRowsDroppedByRule} row(s) removed by a documented ` +
          'resolution, each reported by id below.'
      );
    }
    if (unexplained > 0) {
      say(
        `    DROPPED  ${entry.collection}: read ${entry.documentsRead}, emitted ` +
          `${entry.primaryRowsEmitted} into ${entry.table} — ` +
          `${unexplained} document(s) LOST by the copy, with nothing accounting ` +
          'for them.'
      );
    }
  }

  if (report.orphans.length === 0) {
    say('  Every reference names a row the migration produces.');
    return;
  }

  // The split that decides where the fix belongs. Printed before the detail so
  // an operator sees immediately whether they are looking at pre-existing Mongo
  // debt or at data this migration lost.
  const byOrigin = report.orphanRowsByOrigin;
  say(
    `\n  Orphaned rows by ORIGIN — ${byOrigin['absent-in-source']} absent in the ` +
      `source (pre-existing debt, decide about the referencing row), ` +
      `${byOrigin['dropped-by-the-copy']} dropped by the copy (DATA LOSS, fix the ` +
      `transform), ${byOrigin.undetermined} undetermined (check by hand).`
  );

  say(`\n  ${report.orphans.length} relation(s) hold orphans:`);
  for (const orphans of report.orphans) {
    const relation = orphans.relation;
    say(
      `\n    ${describeRelationColumns(relation)}  [${relation.constraint}, ` +
        `${relation.nullable ? 'NULLABLE' : 'NOT NULL'}, ON DELETE ${relation.onDelete}]`
    );
    say(
      `      ${orphans.documents} row(s) from ${orphans.collection} across ` +
        `${orphans.distinctValues} missing value(s) — origin: ${orphans.origin}, ` +
        `resolvability: ${orphans.resolvability}`
    );
    say(`      ${orphans.originReason}`);
    if (orphans.resolvedBy !== undefined) {
      say(
        `      RESOLVED by \`${orphans.resolvedBy.id}\` — all ${orphans.documents} ` +
          'row(s) provably never reach Postgres, so this does not block.'
      );
    } else if (orphans.mootDocuments > 0) {
      say(
        `      ${orphans.mootDocuments} of ${orphans.documents} row(s) are removed ` +
          'by a documented rule; the rest would still be attempted, so this BLOCKS.'
      );
    }
    for (const value of orphans.values) {
      const ids = value.documentIds.join(', ');
      const elided =
        value.documents > value.documentIds.length
          ? ` … and ${value.documents - value.documentIds.length} more`
          : '';
      say(`      missing ${JSON.stringify(value.value)} — referenced by ${ids}${elided}`);
    }
    if (orphans.distinctValues > orphans.values.length) {
      say(`      … and ${orphans.distinctValues - orphans.values.length} more missing value(s)`);
    }
  }
}

/** What the resolutions are going to do, decided before anything is written. */
function reportResolutionPlan(plan: ResolutionPlan): void {
  const groups = plan.duplicateOpenValidationRequests;
  if (groups.length === 0) return;

  heading('RESOLUTION PLAN');
  say(
    `  ${groups.length} sourceActionId(s) are held open by more than one ` +
      `validation request; ${plan.demotedValidationRequestIds.size} request(s) ` +
      'will be written terminal so exactly one stays open per key.'
  );
  for (const group of groups) {
    const orderedBy = [...new Set(group.members.map((member) => member.orderedBy))].join(', ');
    say(`    ${group.sourceActionId} — ${group.members.length} open request(s), ordered by ${orderedBy}`);
    say(`      keep    ${group.survivorId} (most recent)`);
    say(`      demote  ${group.demotedIds.join(', ')}`);
  }
}

/**
 * What the resolutions actually did, per rule, with every id.
 *
 * A rule that DROPS rows also prints what those drops could take with them —
 * a dropped row is a parent as well as a child, and "nothing references
 * `notifications`" is an answer the operator needs stated rather than assumed.
 * It comes from the same derived foreign-key graph the audit uses, so a schema
 * that grows a reference to one of these tables is covered without anyone
 * remembering to look.
 */
function reportResolutionsApplied(
  summaries: readonly ResolutionSummary[],
  referential: ReferentialIntegrityReport,
  title: string
): void {
  heading(title);
  const cascadesByRule = new Map(
    referential.dropCascades.map((cascade) => [cascade.rule.id, cascade])
  );

  for (const summary of summaries) {
    say(`  ${summary.rule.id} — ${summary.documents} document(s) changed`);
    if (summary.documents === 0) {
      say('      nothing in this data needed it.');
      continue;
    }
    // Every id, not a sample: the whole point is that the operator can check
    // the decision landed exactly where the audit said it would — and, where a
    // rule DESTROYS a row, that the carried columns are the only remaining
    // handle on whatever the row was describing. So they print on their own
    // line per row rather than being folded into a count.
    for (const record of summary.records) {
      say(`      ${record.documentId}: ${record.detail}`);
      if (record.evidence === undefined) continue;
      const carried = Object.entries(record.evidence)
        .map(([column, value]) => `${column}=${value}`)
        .join('  ');
      say(`          ${carried}`);
    }

    const cascade = cascadesByRule.get(summary.rule.id);
    if (cascade === undefined) continue;
    if (cascade.inboundConstraints.length === 0) {
      say(
        `      CASCADE: nothing in the schema references ${cascade.table}, so ` +
          `dropping ${cascade.rowsDropped} row(s) from it can orphan nothing.`
      );
      continue;
    }
    say(
      `      CASCADE: ${cascade.inboundConstraints.length} constraint(s) reference ` +
        `${cascade.table} — ${cascade.inboundConstraints.join(', ')}.`
    );
    if (cascade.orphanedByDrop.length === 0) {
      say('      No row referencing a dropped one was found, so these drops orphan nothing.');
      continue;
    }
    for (const orphaned of cascade.orphanedByDrop) {
      say(
        orphaned.resolvedBy === undefined
          ? `      ${orphaned.documents} row(s) reference a DROPPED row through ` +
              `${orphaned.constraint} — nothing is declared about them, so they are ` +
              'reported as orphans above and BLOCK. Decide before this rule can be ' +
              'applied.'
          : `      ${orphaned.documents} row(s) reference a DROPPED row through ` +
              `${orphaned.constraint} and follow it, by \`${orphaned.resolvedBy.id}\` — ` +
              'listed with that rule.'
      );
    }
  }
}

async function runVerification(
  db: Awaited<ReturnType<typeof connectPostgres>>,
  source: Awaited<ReturnType<typeof connectMongoSource>>,
  options: Options
): Promise<number> {
  heading('VERIFY');
  const live = new Set(await source.listCollections());
  const plans = COLLECTION_PLANS.filter(
    (plan) =>
      live.has(plan.collection) &&
      (options.only === undefined || options.only.includes(plan.collection))
  );
  try {
    const report = await verifyBackfill(db, source, plans, {
      sampleSize: options.sampleSize,
      batchSize: options.batchSize,
    });
    say(
      `  PASS — ${report.checkedCollections} collection(s), ${report.checkedTables} table(s), ` +
        `${report.comparedDocuments} sampled document(s), ${report.comparedFields} field comparison(s).`
    );
    return 0;
  } catch (error) {
    if (error instanceof VerificationError || error instanceof VacuousVerificationError) {
      heading('VERIFICATION FAILED');
      say(error.message);
      return 1;
    }
    throw error;
  }
}

/**
 * Write the checkpoint for one collection.
 *
 * Mutates the in-memory state and rewrites the whole file. The file is small
 * (one entry per collection) and rewriting it whole means a crash mid-write
 * cannot produce a half-updated entry — the previous file is either fully
 * replaced or not at all, and an unreadable file is a loud failure on the next
 * run rather than a silently wrong resume position.
 */
async function persistCheckpoint(
  path: string,
  state: BackfillState,
  collection: string,
  checkpoint: Checkpoint
): Promise<void> {
  const checkpoints = { ...state.checkpoints, [collection]: checkpoint };
  Object.assign(state, { checkpoints });
  await writeFile(path, `${JSON.stringify({ ...state, checkpoints }, null, 2)}\n`, 'utf8');
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`\nBackfill FAILED: ${describeError(error)}\n`);
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });

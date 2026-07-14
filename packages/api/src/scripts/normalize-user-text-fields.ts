#!/usr/bin/env bun
/**
 * One-shot, idempotent normalization of the TEXT fields already stored on
 * `users` documents.
 *
 * WHY
 * ---
 * Third-party and user-authored text used to be persisted with whatever
 * whitespace the source happened to carry. The worst case, and the bug that
 * triggered this cleanup: a remote page served
 *
 *     <title>
 *       Mi título
 *     </title>
 *
 * and the extracted string — newline plus six spaces of indentation — was stored
 * verbatim in `linksMetadata[].title`. Clients render these fields in a React
 * Native `Text` (`white-space: pre-wrap` on web), which does NOT collapse
 * whitespace the way HTML does, so the profile showed a blank line and an indent
 * inside the link card.
 *
 * The write paths are fixed (`utils/profileTextNormalization.ts`,
 * `utils/displayNameSanitize.ts`, `utils/sanitize.ts`, all delegating to the
 * canonical `@oxyhq/core` normalizers). This script cleans the documents that
 * were written BEFORE the fix.
 *
 * THE INVARIANT: what this script writes is byte-identical to what the profile
 * write path (`user.service.updateUserProfile`) would persist for the same input.
 * It holds because the script CALLS the write path's own normalizers instead of
 * restating their rules — a second copy of the policy is exactly how the backfill
 * would come to fabricate a document the write path would have rejected (e.g. a
 * `linksMetadata` entry with an empty `url`, which the schema marks `required`).
 * `scripts/__tests__/normalizeUserTextFields.writePathParity.test.ts` pins it.
 *
 * WHAT IT NORMALIZES (per user document), all via the write path's normalizers
 *   - `name`                            → normalizeProfileName (+ drops the stale
 *                                         `full` virtual if a copy was persisted)
 *   - `bio` / `description` / `address` → normalizeMultilineText (paragraphs survive)
 *   - `linksMetadata[]`                 → normalizeLinksMetadata
 *   - `locations[]`                     → normalizeLocations
 *   - `links[]`                         → normalizeLinks
 *
 * SCOPE — whitespace only. The free-text fields (`bio`, `description`, `address`)
 * are normalized with `normalizeMultilineText`, which is the WHITESPACE half of
 * the write path's `sanitizePlainText`; its other half (HTML-entity decoding + tag
 * stripping) is deliberately NOT replayed over historical documents. It is a
 * content transform, not a whitespace fix, and `decodeHtmlEntities` is not
 * idempotent for double-encoded input (`&amp;amp;` → `&amp;` → `&`), so folding it
 * in would break the "a re-run writes nothing" guarantee below. For any value
 * carrying no markup — the whole domain of the bug being fixed — the two agree
 * byte for byte.
 *
 * `LinkPreview` documents are deliberately NOT touched: bumping
 * `LINK_PREVIEW_RESOLVER_VERSION` to 2 already marks every cached preview stale,
 * so they re-resolve through the fixed resolver on their own.
 *
 * Safety:
 *   - No document deletes, no drops, no schema changes. Within an array, an entry
 *     that cannot be the thing it claims to be — a link card with no URL, an empty
 *     `links[]` string, a non-object entry — IS dropped, because that is what the
 *     write path does with it and keeping it would persist a document that fails
 *     the `required` validators on the user's next profile save.
 *   - Reads through a CURSOR and writes in bounded `bulkWrite` batches — a large
 *     `users` collection is never loaded into memory.
 *   - Writes ONLY the documents whose normalized value actually differs, and only
 *     the fields that differ. A second run therefore performs 0 writes.
 *   - The normalizers are idempotent, so the script is safe to re-run at any time.
 *   - `DRY_RUN=true` reports the plan (and a sample of the changes) without writing.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/src/scripts/normalize-user-text-fields.ts
 * Or, against the compiled output:
 *   node packages/api/dist/scripts/normalize-user-text-fields.js
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   NODE_ENV      selects the DB name via getDbName()
 *   DRY_RUN=true  plan only, no writes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { normalizeMultilineText } from '@oxyhq/core';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';
import {
  normalizeLinks,
  normalizeLinksMetadata,
  normalizeLocations,
  normalizeProfileName,
} from '../utils/profileTextNormalization.js';

dotenv.config();

/** Flush a bulk batch every N operations to bound memory on large collections. */
const BATCH_SIZE = 500;

/** How many changed documents to log in full while dry-running. */
const DRY_RUN_SAMPLE_SIZE = 20;

/**
 * The on-disk user shape this script reads. Deliberately schema-independent
 * (`unknown` leaves, read straight from the driver) so a document that predates
 * the current Mongoose schema — or violates it — is still normalized instead of
 * throwing on cast.
 */
export interface StoredUserDoc {
  _id: mongoose.Types.ObjectId;
  name?: unknown;
  bio?: unknown;
  description?: unknown;
  address?: unknown;
  links?: unknown;
  linksMetadata?: unknown;
  locations?: unknown;
}

type UnknownRecord = Record<string, unknown>;

/**
 * A JSON object as the driver deserializes it. BSON leaves (ObjectId, Date,
 * Binary) are class instances, not plain objects, and are compared by identity /
 * by value in {@link deepEquals} rather than key by key.
 */
function isPlainObject(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Structural equality between a stored value and its normalized counterpart.
 *
 * This is the ONLY thing the script adds on top of the write path's normalizers:
 * "did the value change?" is a diffing question, orthogonal to the normalization
 * POLICY, which lives entirely in `utils/profileTextNormalization.ts`. Deciding it
 * generically is what lets the script own zero copies of that policy.
 *
 * The normalizers rebuild only the containers they touch (arrays, entry objects)
 * and pass every other leaf through BY REFERENCE, so the `a === b` fast path
 * covers the BSON leaves (ObjectId, Binary) that have no meaningful structural
 * comparison here. `Date` is compared by value anyway, defensively.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEquals(item, b[index]));
  }

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEquals(a[key], b[key])
    );
  }

  return false;
}

/**
 * The `$set` payload for one document. Values are whole fields (`name`,
 * `linksMetadata`, …) rather than dotted array paths: an array element's index
 * is not a stable identity, and rewriting the whole array is both simpler and
 * atomic.
 */
type UpdateSet = Record<string, unknown>;

interface BulkUpdateOne {
  updateOne: {
    filter: { _id: mongoose.Types.ObjectId };
    update: { $set: UpdateSet };
  };
}

/** Per-field counters, so the summary shows WHICH fields were dirty in prod. */
type FieldCounters = Record<string, number>;

/**
 * Add `key` to the `$set` only when the normalized value differs from what is on
 * disk. This is the script's single decision point: the VALUE always comes from a
 * write-path normalizer, and all this adds is "has it changed?".
 */
function setIfChanged(update: UpdateSet, key: string, current: unknown, next: unknown): void {
  if (!deepEquals(current, next)) {
    update[key] = next;
  }
}

/**
 * The write path's `normalizeProfileName`, plus the one thing that is specific to
 * a STORED document: `name.full` is a schema virtual, so a persisted copy of it
 * (written by an older code path) goes stale the moment first/last change and is
 * dropped here. The write path never receives it — it only ever sees a client
 * payload — which is why this sits on top of the shared normalizer instead of
 * inside it.
 */
function normalizeStoredName(value: unknown): unknown {
  const normalized = normalizeProfileName(value);
  if (!isPlainObject(normalized) || !('full' in normalized)) {
    return normalized;
  }
  const withoutVirtual: UnknownRecord = { ...normalized };
  delete withoutVirtual.full;
  return withoutVirtual;
}

/**
 * Build the `$set` for one stored user, containing ONLY the fields whose
 * normalized value differs from what is on disk. An empty object means the
 * document is already clean and must not be written.
 *
 * Every value in the result is produced by the SAME normalizer the profile write
 * path runs, so a backfilled document is byte-identical to one written today.
 */
export function buildUserTextUpdate(doc: StoredUserDoc): UpdateSet {
  const update: UpdateSet = {};

  setIfChanged(update, 'name', doc.name, normalizeStoredName(doc.name));

  // Free text: the author's line breaks are meaningful, so these use the MULTILINE
  // normalizer — the same one `sanitizePlainText` delegates its whitespace pass to.
  // It strips the trailing spaces that turn a "blank" line into an uncollapsible
  // one, without flattening real paragraphs. See SCOPE in the header for why the
  // entity-decoding / tag-stripping half of `sanitizePlainText` is not replayed.
  for (const key of ['bio', 'description', 'address'] as const) {
    const current = doc[key];
    if (typeof current !== 'string') continue;
    setIfChanged(update, key, current, normalizeMultilineText(current));
  }

  setIfChanged(update, 'linksMetadata', doc.linksMetadata, normalizeLinksMetadata(doc.linksMetadata));
  setIfChanged(update, 'locations', doc.locations, normalizeLocations(doc.locations));
  setIfChanged(update, 'links', doc.links, normalizeLinks(doc.links));

  return update;
}

async function backfill(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No active MongoDB connection');
  }

  const users = db.collection<StoredUserDoc>('users');

  // Only documents that HAVE at least one of the affected fields are worth
  // scanning. A document with none of them cannot produce a change.
  const filter = {
    $or: [
      { name: { $exists: true } },
      { bio: { $exists: true } },
      { description: { $exists: true } },
      { address: { $exists: true } },
      { links: { $exists: true } },
      { linksMetadata: { $exists: true } },
      { locations: { $exists: true } },
    ],
  };

  const total = await users.countDocuments(filter);
  logger.info('User documents to scan', { count: total });

  const cursor = users
    .find(filter, {
      projection: {
        name: 1,
        bio: 1,
        description: 1,
        address: 1,
        links: 1,
        linksMetadata: 1,
        locations: 1,
      },
    })
    .batchSize(BATCH_SIZE);

  let scanned = 0;
  let updated = 0;
  let sampled = 0;
  const fieldCounters: FieldCounters = {};
  let batch: BulkUpdateOne[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    if (!dryRun) {
      await users.bulkWrite(batch, { ordered: false });
    }
    updated += batch.length;
    batch = [];
    logger.info('Backfill progress', { scanned, total, updated, dryRun });
  };

  for await (const doc of cursor) {
    scanned += 1;

    const update = buildUserTextUpdate(doc);
    const changedFields = Object.keys(update);
    if (changedFields.length === 0) continue;

    for (const field of changedFields) {
      fieldCounters[field] = (fieldCounters[field] ?? 0) + 1;
    }

    if (dryRun && sampled < DRY_RUN_SAMPLE_SIZE) {
      sampled += 1;
      logger.info('Would normalize user', {
        userId: doc._id.toString(),
        fields: changedFields,
      });
    }

    batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: update } } });
    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  logger.info('User text normalization summary', {
    total,
    scanned,
    updated,
    unchanged: scanned - updated,
    fields: fieldCounters,
    dryRun,
  });
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }

  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  logger.info('Connected to MongoDB', { dbName });

  try {
    await backfill();
  } finally {
    await mongoose.disconnect();
    logger.info('MongoDB connection closed');
  }
}

// Only auto-run when invoked directly as a script (bun run … / node dist/…), NOT
// when imported — the unit test drives `buildUserTextUpdate` in isolation, with
// no mongoose connection. Mirrors the guard in `set-seed-verifiers.ts`.
//
// The explicit `process.exit(0)`: imported singletons (Redis-backed caches,
// BullMQ workers) keep the event loop alive, which would otherwise leave this
// Fargate one-shot task running forever after the work is done.
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      logger.error(
        'User text normalization failed',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'normalize-user-text-fields', method: 'main' }
      );
      process.exit(1);
    });
}

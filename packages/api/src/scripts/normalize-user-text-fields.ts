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
 * WHAT IT NORMALIZES (per user document)
 *   - `name.first` / `name.last`        → cleanDisplayName (inline + char policy + cap)
 *   - `bio` / `description`             → normalizeMultilineText (paragraphs survive)
 *   - `address`                         → normalizeInlineText
 *   - `linksMetadata[].url/.title/.description` → normalizeInlineText (+ length caps)
 *   - `locations[].name/.label` and every string leaf of `locations[].address`
 *                                       → normalizeInlineText (+ length cap)
 *   - `links[]`                         → normalizeInlineText, empty entries dropped
 *
 * `LinkPreview` documents are deliberately NOT touched: bumping
 * `LINK_PREVIEW_RESOLVER_VERSION` to 2 already marks every cached preview stale,
 * so they re-resolve through the fixed resolver on their own.
 *
 * Safety:
 *   - No deletes, no drops, no schema changes.
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
import { normalizeInlineText, normalizeMultilineText } from '@oxyhq/core';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { cleanDisplayName } from '../utils/displayNameSanitize.js';
import {
  MAX_LINK_DESCRIPTION_LENGTH,
  MAX_LINK_TITLE_LENGTH,
  MAX_LINK_URL_LENGTH,
  MAX_LOCATION_TEXT_LENGTH,
  normalizeDisplayValue,
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

/** The address leaves of a stored `locations[]` entry — all single-line values. */
const LOCATION_ADDRESS_TEXT_KEYS = [
  'street',
  'streetNumber',
  'streetDetails',
  'postalCode',
  'city',
  'state',
  'country',
  'formattedAddress',
] as const;

type UnknownRecord = Record<string, unknown>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
 * Normalize the `name` sub-document. Returns `undefined` when nothing changes.
 * Uses the same `cleanDisplayName` the write paths use, so a backfilled name is
 * byte-identical to one written today.
 */
function normalizeStoredName(value: unknown): UnknownRecord | undefined {
  if (!isUnknownRecord(value)) return undefined;

  let changed = false;
  const result: UnknownRecord = { ...value };
  for (const part of ['first', 'last'] as const) {
    const partValue = result[part];
    if (typeof partValue !== 'string') continue;
    const cleaned = cleanDisplayName(partValue);
    if (cleaned !== partValue) {
      result[part] = cleaned;
      changed = true;
    }
  }
  // `full` is a schema virtual; a stored copy would go stale the moment first/last
  // change, so it is dropped from the persisted sub-document if present.
  if ('full' in result) {
    delete result.full;
    changed = true;
  }
  return changed ? result : undefined;
}

/** Normalize `linksMetadata[]`. Returns `undefined` when nothing changes. */
function normalizeStoredLinksMetadata(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;

  let changed = false;
  const result: unknown[] = [];
  for (const entry of value) {
    if (!isUnknownRecord(entry)) {
      // A non-object entry is unusable as a link card; dropping it IS a change.
      changed = true;
      continue;
    }

    const next: UnknownRecord = { ...entry };
    const caps: Array<[key: string, max: number]> = [
      ['url', MAX_LINK_URL_LENGTH],
      ['title', MAX_LINK_TITLE_LENGTH],
      ['description', MAX_LINK_DESCRIPTION_LENGTH],
    ];
    for (const [key, max] of caps) {
      const current = next[key];
      if (typeof current !== 'string') continue;
      const normalized = normalizeDisplayValue(current, max);
      if (normalized !== current) {
        next[key] = normalized;
        changed = true;
      }
    }
    result.push(next);
  }
  return changed ? result : undefined;
}

/** Normalize `locations[]`. Returns `undefined` when nothing changes. */
function normalizeStoredLocations(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;

  let changed = false;
  const result: unknown[] = [];
  for (const entry of value) {
    if (!isUnknownRecord(entry)) {
      changed = true;
      continue;
    }

    const next: UnknownRecord = { ...entry };
    for (const key of ['name', 'label'] as const) {
      const current = next[key];
      if (typeof current !== 'string') continue;
      const normalized = normalizeDisplayValue(current, MAX_LOCATION_TEXT_LENGTH);
      if (normalized !== current) {
        next[key] = normalized;
        changed = true;
      }
    }

    if (isUnknownRecord(next.address)) {
      const address: UnknownRecord = { ...next.address };
      let addressChanged = false;
      for (const key of LOCATION_ADDRESS_TEXT_KEYS) {
        const current = address[key];
        if (typeof current !== 'string') continue;
        const normalized = normalizeDisplayValue(current, MAX_LOCATION_TEXT_LENGTH);
        if (normalized !== current) {
          address[key] = normalized;
          addressChanged = true;
        }
      }
      if (addressChanged) {
        next.address = address;
        changed = true;
      }
    }

    result.push(next);
  }
  return changed ? result : undefined;
}

/** Normalize `links[]` (plain URLs). Returns `undefined` when nothing changes. */
function normalizeStoredLinks(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  let changed = false;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      changed = true;
      continue;
    }
    const url = normalizeDisplayValue(entry, MAX_LINK_URL_LENGTH);
    if (url !== entry) changed = true;
    if (url) {
      result.push(url);
    } else {
      changed = true;
    }
  }
  return changed ? result : undefined;
}

/**
 * Build the `$set` for one stored user, containing ONLY the fields whose
 * normalized value differs from what is on disk. An empty object means the
 * document is already clean and must not be written.
 */
export function buildUserTextUpdate(doc: StoredUserDoc): UpdateSet {
  const update: UpdateSet = {};

  const name = normalizeStoredName(doc.name);
  if (name) update.name = name;

  // Bodies: the author's line breaks are meaningful, so these use the MULTILINE
  // normalizer — it strips the trailing spaces that turn a "blank" line into an
  // uncollapsible one, without flattening real paragraphs.
  for (const key of ['bio', 'description'] as const) {
    const current = doc[key];
    if (typeof current !== 'string') continue;
    const normalized = normalizeMultilineText(current);
    if (normalized !== current) update[key] = normalized;
  }

  // A postal address is one line of display text.
  if (typeof doc.address === 'string') {
    const normalized = normalizeInlineText(doc.address);
    if (normalized !== doc.address) update.address = normalized;
  }

  const linksMetadata = normalizeStoredLinksMetadata(doc.linksMetadata);
  if (linksMetadata) update.linksMetadata = linksMetadata;

  const locations = normalizeStoredLocations(doc.locations);
  if (locations) update.locations = locations;

  const links = normalizeStoredLinks(doc.links);
  if (links) update.links = links;

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

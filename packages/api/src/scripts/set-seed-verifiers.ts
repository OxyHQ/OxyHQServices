#!/usr/bin/env bun
/**
 * Idempotent admin script: bootstrap the proof-of-personhood web-of-trust
 * genesis root (civic / Commons — Fase 3).
 *
 * Marks a small, hand-picked set of accounts (given by USERNAME) as
 * `User.isSeedVerifier = true`. A seed verifier is the trust root: personhood
 * treats them as score = 1 (a known real, unique human) without needing
 * vouches, so they can bootstrap the network by vouching for others.
 *
 * For each resolved username:
 *   - already `isSeedVerifier` → skipped (no write; idempotent).
 *   - otherwise → `User.isSeedVerifier = true` (explicit single-field `$set`),
 *     then `recomputePersonhood(userId)` runs (which short-circuits on the seed
 *     flag to score 1 / isRealPerson true, mirrors `User.verified`, recalculates
 *     the reputation balance, and invalidates userCache).
 *
 * A username that does not resolve to a user is warned and SKIPPED — the batch
 * continues. If ANY username failed to resolve, the process exits non-zero
 * AFTER processing every resolvable one.
 *
 * Safety:
 *   - No deletes, no drops.
 *   - Explicit single field only (never spreads request/body data).
 *   - Re-running performs 0 writes once every named account is seeded.
 *   - DRY_RUN reports exactly what WOULD change and writes NOTHING.
 *   - Bounded to exactly the named usernames.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   SEED_VERIFIER_USERNAMES=oxy,nate bun run packages/api/src/scripts/set-seed-verifiers.ts
 * Or, against the compiled output:
 *   SEED_VERIFIER_USERNAMES=oxy,nate node packages/api/dist/scripts/set-seed-verifiers.js
 *
 * Env:
 *   SEED_VERIFIER_USERNAMES   required — comma-separated usernames (e.g. `oxy,nate`)
 *   MONGODB_URI               required (injected by ECS from SSM)
 *   NODE_ENV                  selects the DB name via getDbName() (e.g. oxy-prod)
 *   DRY_RUN=true|1            plan only, no writes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import PersonhoodStatus from '../models/PersonhoodStatus.js';
import { recomputePersonhood } from '../services/civic/personhood.service.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/** Structured outcome of seeding a single username (drives logging + exit code). */
export interface SeedResult {
  username: string;
  /** Whether the username resolved to an existing user. */
  resolved: boolean;
  userId?: string;
  displayName?: string;
  /** True when the user was already a seed verifier (no write performed). */
  alreadySeeded?: boolean;
  /** True when this run flipped `isSeedVerifier` to true. */
  seeded?: boolean;
  /** Personhood score (current, in dry-run; post-recompute, on a real seed). */
  score?: number;
  /** Personhood `isRealPerson` verdict (current in dry-run; post-recompute otherwise). */
  isRealPerson?: boolean;
  /** `User.verified` after the write (real run only). */
  verified?: boolean;
}

/**
 * Resolve a single username to a user and either report (dry-run) or apply the
 * seed-verifier flag + recompute personhood (real run). Returns a structured
 * result; never throws for a missing user (returns `resolved: false`).
 */
export async function seedVerifierByUsername(
  username: string,
  dryRun: boolean,
): Promise<SeedResult> {
  // Query without `.lean()` so the `name.displayName` virtual getter is available.
  const user = await User.findOne({ username })
    .select('_id username verified isSeedVerifier name')
    .exec();

  if (!user) {
    return { username, resolved: false };
  }

  const userId = user._id.toString();
  const displayName = user.name?.displayName;
  const currentlySeeded = user.isSeedVerifier === true;

  if (dryRun) {
    // Read CURRENT personhood WITHOUT writing (never call recomputePersonhood).
    const status = await PersonhoodStatus.findOne({ userId })
      .select('score isRealPerson')
      .lean<{ score?: number; isRealPerson?: boolean } | null>();
    return {
      username,
      resolved: true,
      userId,
      displayName,
      alreadySeeded: currentlySeeded,
      seeded: false,
      score: status?.score ?? 0,
      isRealPerson: status?.isRealPerson ?? false,
      verified: user.verified === true,
    };
  }

  if (currentlySeeded) {
    // Idempotent: already a seed verifier — no write, no recompute.
    return {
      username,
      resolved: true,
      userId,
      displayName,
      alreadySeeded: true,
      seeded: false,
      verified: user.verified === true,
    };
  }

  // Explicit single field — never spread request/body data.
  await User.updateOne({ _id: user._id }, { $set: { isSeedVerifier: true } });

  const status = await recomputePersonhood(userId);

  // Re-read `verified` so we log the final, post-recompute value.
  const after = await User.findById(userId).select('verified').lean<{ verified?: boolean } | null>();

  return {
    username,
    resolved: true,
    userId,
    displayName,
    alreadySeeded: false,
    seeded: true,
    score: status.score,
    isRealPerson: status.isRealPerson,
    verified: after?.verified === true,
  };
}

async function run(usernames: string[], dryRun: boolean): Promise<boolean> {
  let anyUnresolved = false;

  for (const username of usernames) {
    const result = await seedVerifierByUsername(username, dryRun);

    if (!result.resolved) {
      anyUnresolved = true;
      logger.warn('username did not resolve', { username });
      continue;
    }

    if (dryRun) {
      logger.info('DRY RUN — would seed verifier', {
        username: result.username,
        userId: result.userId,
        displayName: result.displayName,
        currentIsSeedVerifier: result.alreadySeeded === true,
        wouldChange: result.alreadySeeded !== true,
        currentScore: result.score,
        currentIsRealPerson: result.isRealPerson,
        currentVerified: result.verified,
      });
      continue;
    }

    if (result.alreadySeeded) {
      logger.info('already seeded, skipping', {
        username: result.username,
        userId: result.userId,
        displayName: result.displayName,
      });
      continue;
    }

    logger.info('seed verifier applied', {
      username: result.username,
      userId: result.userId,
      displayName: result.displayName,
      isSeedVerifierBefore: false,
      isSeedVerifierAfter: true,
      personhoodScore: result.score,
      personhoodIsRealPerson: result.isRealPerson,
      verifiedAfter: result.verified,
    });
  }

  logger.info('Seed verifier summary', {
    dryRun,
    requested: usernames.length,
    unresolved: anyUnresolved,
  });

  return anyUnresolved;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';

  const raw = process.env.SEED_VERIFIER_USERNAMES ?? '';
  const usernames = Array.from(
    new Set(
      raw
        .split(',')
        .map((u) => u.trim())
        .filter((u) => u.length > 0),
    ),
  );

  if (usernames.length === 0) {
    logger.error(
      'SEED_VERIFIER_USERNAMES is required (comma-separated usernames, e.g. ' +
        '`oxy,nate`). No accounts were modified.\n' +
        'Usage:\n' +
        '  SEED_VERIFIER_USERNAMES=oxy,nate [DRY_RUN=true] ' +
        'bun run packages/api/src/scripts/set-seed-verifiers.ts',
    );
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  logger.info('Connected to MongoDB', { dbName });

  let anyUnresolved = false;
  try {
    anyUnresolved = await run(usernames, dryRun);
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }

  if (anyUnresolved) {
    // Non-zero exit AFTER processing every resolvable username.
    process.exit(1);
  }
}

// Only auto-run when invoked directly as a script (bun run … / node dist/…),
// NOT when imported (e.g. by the unit test, which drives `seedVerifierByUsername`
// in isolation). Mirrors the `require.main === module` guard in `server.ts`.
if (require.main === module) {
  main().catch((error) => {
    logger.error(
      'Set seed verifiers failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: 'set-seed-verifiers', method: 'main' },
    );
    process.exit(1);
  });
}

#!/usr/bin/env bun
/**
 * Account migration — Phase 0: backfill `kind` + tree fields on every User.
 *
 * Every existing user becomes a root account: `kind = 'personal'` (or `'bot'`
 * for `type ∈ {automated, agent}`), `parentAccountId = null`, `ancestors = []`,
 * `rootAccountId = self`, `accountStatus = 'active'`. Managed sub-accounts and
 * minted org accounts are re-classified by later phases (which run after this).
 *
 * Idempotent: only users still missing `rootAccountId` are touched. Re-running
 * performs 0 writes. NOTHING is deleted.
 *
 *   bun run packages/api/scripts/migrate-accounts-00-backfill-kind.ts
 *   DRY_RUN=true  plan only
 */

import { connect, disconnect, isDryRun, rawDb } from './account-migration-lib';
import { logger } from '../src/utils/logger';

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const users = rawDb().collection('users');
  const cursor = users.find(
    { rootAccountId: { $exists: false } },
    { projection: { _id: 1, type: 1 } }
  );

  let scanned = 0;
  let changed = 0;
  for await (const doc of cursor) {
    scanned += 1;
    const type = doc.type as string | undefined;
    const kind = type === 'automated' || type === 'agent' ? 'bot' : 'personal';
    if (!dryRun) {
      await users.updateOne(
        { _id: doc._id },
        {
          $set: {
            kind,
            parentAccountId: null,
            ancestors: [],
            rootAccountId: doc._id,
            accountStatus: 'active',
          },
        }
      );
    }
    changed += 1;
  }

  logger.info('Phase 0 summary', { dryRun, scanned, changed });

  const remaining = await users.countDocuments({ rootAccountId: { $exists: false } });
  logger.info('Read-back: users still missing rootAccountId', { count: dryRun ? scanned : remaining });
}

async function main(): Promise<void> {
  await connect();
  try {
    await migrate();
  } finally {
    await disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
  logger.error(
    'Phase 0 (backfill kind) failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-accounts-00' }
  );
  process.exit(1);
});

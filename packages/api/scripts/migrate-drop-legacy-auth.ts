#!/usr/bin/env bun
/**
 * Fase C migration — drop legacy password / social / 2FA auth state.
 *
 * Sign-in is now passkey (WebAuthn) or the Commons handoff. This one-shot
 * migration removes the retired auth material from every `users` document:
 *   - `$unset` the `password`, `twoFactorAuth` (incl. its nested `secret` +
 *     `backupCodes`), and any top-level `backupCodes` fields;
 *   - `$pull` every `authMethods[]` entry of a removed type
 *     (`password` / `google` / `apple` / `github`), leaving only
 *     `identity` + `webauthn` entries.
 *
 * SAFETY GATE (owner: "almost no password-only users exist"). Before writing,
 * it counts accounts whose ONLY auth methods are the removed legacy types — no
 * `identity` key and no `webauthn` passkey. Those accounts would be locked out
 * by the cutover. If that count exceeds a small threshold the migration HALTS
 * and reports instead of applying, so a surprise (many real password-only
 * users) forces a human decision rather than silently orphaning them.
 *
 * Idempotent + DRY_RUN-gated (mirrors the other `migrate-*` scripts). NOTHING
 * that survives the cutover is deleted; re-running performs 0 writes.
 *
 *   bun run packages/api/scripts/migrate-drop-legacy-auth.ts
 *   DRY_RUN=true  plan only (also runs the safety count)
 */

import { connect, disconnect, isDryRun, rawDb } from './account-migration-lib';
import { logger } from '../src/utils/logger';

/** Auth-method types removed in Fase C. */
const REMOVED_AUTH_TYPES = ['password', 'google', 'apple', 'github'] as const;
/** Surviving auth-method types. */
const KEPT_AUTH_TYPES = ['identity', 'webauthn'] as const;
/**
 * If MORE than this many accounts would be locked out (only legacy auth methods,
 * no key and no passkey), STOP and report. The owner confirmed almost none
 * exist; a higher number means the assumption is wrong and needs a human.
 */
const LOCKOUT_HALT_THRESHOLD = 20;

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const users = rawDb().collection('users');

  // 1. Safety count — accounts whose ONLY auth methods are the removed legacy
  //    types (at least one legacy method AND no identity/webauthn method).
  const legacyOnlyFilter = {
    authMethods: {
      $elemMatch: { type: { $in: REMOVED_AUTH_TYPES } },
      $not: { $elemMatch: { type: { $in: KEPT_AUTH_TYPES } } },
    },
  };
  const legacyOnlyCount = await users.countDocuments(legacyOnlyFilter);

  // Of those, the ones that also have no usable identity `publicKey` are the
  // truly unrecoverable lock-outs (a bare `publicKey` still lets them sign in
  // via the key challenge even without an `identity` authMethods row).
  const trulyLockedOutCount = await users.countDocuments({
    $and: [
      legacyOnlyFilter,
      { $or: [{ publicKey: { $exists: false } }, { publicKey: null }, { publicKey: '' }] },
    ],
  });

  logger.info('Fase C safety count', {
    legacyOnlyAccounts: legacyOnlyCount,
    trulyLockedOutAccounts: trulyLockedOutCount,
    haltThreshold: LOCKOUT_HALT_THRESHOLD,
  });

  if (legacyOnlyCount > LOCKOUT_HALT_THRESHOLD) {
    logger.error(
      'HALT — more legacy-only accounts than expected; NOT applying. ' +
        'Review these accounts (they have only password/social auth, no key or passkey) ' +
        'before proceeding.',
      new Error(`legacyOnlyAccounts=${legacyOnlyCount} exceeds threshold ${LOCKOUT_HALT_THRESHOLD}`),
      { component: 'migrate-drop-legacy-auth' },
    );
    return;
  }

  // 2. Report the write footprint.
  const withPassword = await users.countDocuments({ password: { $exists: true } });
  const withTwoFactor = await users.countDocuments({ twoFactorAuth: { $exists: true } });
  const withLegacyMethods = await users.countDocuments({ 'authMethods.type': { $in: REMOVED_AUTH_TYPES } });
  logger.info('Fase C write footprint', { withPassword, withTwoFactor, withLegacyMethods });

  if (dryRun) {
    logger.info('DRY RUN complete — would $unset password/twoFactorAuth/backupCodes and $pull legacy authMethods');
    return;
  }

  // 3. Apply — strip the retired fields from every account.
  const unsetResult = await users.updateMany(
    {},
    { $unset: { password: '', twoFactorAuth: '', backupCodes: '' } },
  );

  // 4. Apply — drop the removed auth-method entries, keeping identity/webauthn.
  const pullResult = await users.updateMany(
    { 'authMethods.type': { $in: REMOVED_AUTH_TYPES } },
    { $pull: { authMethods: { type: { $in: REMOVED_AUTH_TYPES } } } },
  );

  logger.info('Fase C apply summary', {
    fieldsUnsetModified: unsetResult.modifiedCount,
    legacyMethodsPulledModified: pullResult.modifiedCount,
  });

  // 5. Read-back — everything must be gone.
  const remainingPassword = await users.countDocuments({ password: { $exists: true } });
  const remainingTwoFactor = await users.countDocuments({ twoFactorAuth: { $exists: true } });
  const remainingLegacyMethods = await users.countDocuments({ 'authMethods.type': { $in: REMOVED_AUTH_TYPES } });
  logger.info('Fase C read-back (all should be 0)', {
    remainingPassword,
    remainingTwoFactor,
    remainingLegacyMethods,
  });
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
      'Fase C migration (drop legacy auth) failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: 'migrate-drop-legacy-auth' },
    );
    process.exit(1);
  });

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
 * Housekeeping (NOT done here): the `recoverycodes` collection is now orphaned —
 * the `RecoveryCode` model and every recovery endpoint were deleted in Fase C.
 * It holds only hashed, now-unusable codes and can be dropped manually later
 * (`db.recoverycodes.drop()`); it is left in place so this migration touches
 * only `users`.
 *
 *   bun run packages/api/scripts/migrate-drop-legacy-auth.ts
 *   DRY_RUN=true  plan only (also runs the safety count)
 */

import { connect, disconnect, isDryRun, rawDb } from './account-migration-lib';
import { logger } from '../src/utils/logger';

/** Auth-method types removed in Fase C. */
const REMOVED_AUTH_TYPES = ['password', 'google', 'apple', 'github'] as const;
/**
 * If MORE than this many accounts would be locked out (no usable sign-in left
 * AFTER the migration strips their legacy credentials), STOP and report. The
 * owner confirmed almost none exist; a higher number means the assumption is
 * wrong and needs a human.
 */
const LOCKOUT_HALT_THRESHOLD = 20;

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const users = rawDb().collection('users');

  // 1. Safety count — POST-MIGRATION USABILITY, not just the shape of the
  //    `authMethods[]` array. An account is locked out by this migration iff,
  //    once its legacy credentials are stripped, it has NO usable sign-in left:
  //      (a) no identity `publicKey` (a bare key still signs in via challenge),
  //      (b) no `webauthn` passkey, AND
  //      (c) it DID hold a legacy credential we are about to remove — either a
  //          `password` field OR a removed-type `authMethods[]` entry.
  //    Keying (c) off the `password` field (not only `authMethods`) is what
  //    catches the pre-`authMethods` era: password-only users whose array was
  //    never backfilled would otherwise slip past the halt and be $unset into a
  //    permanent lockout.
  const noPublicKey = {
    $or: [{ publicKey: { $exists: false } }, { publicKey: null }, { publicKey: '' }],
  };
  const noPasskey = { authMethods: { $not: { $elemMatch: { type: 'webauthn' } } } };
  const hadLegacyCredential = {
    $or: [
      { password: { $exists: true } },
      { authMethods: { $elemMatch: { type: { $in: REMOVED_AUTH_TYPES } } } },
    ],
  };
  const lockedOutAfterFilter = { $and: [noPublicKey, noPasskey, hadLegacyCredential] };

  const lockedOutAfter = await users.countDocuments(lockedOutAfterFilter);

  // Breakdown (may overlap) so the operator can see WHERE the risk sits — the
  // pre-authMethods `password`-field population vs. the authMethods-era one.
  const lockedOutWithPasswordField = await users.countDocuments({
    $and: [noPublicKey, noPasskey, { password: { $exists: true } }],
  });
  const lockedOutWithLegacyAuthMethods = await users.countDocuments({
    $and: [noPublicKey, noPasskey, { authMethods: { $elemMatch: { type: { $in: REMOVED_AUTH_TYPES } } } }],
  });

  logger.info('Fase C safety count (post-migration lock-out)', {
    lockedOutAfter,
    breakdown: { lockedOutWithPasswordField, lockedOutWithLegacyAuthMethods },
    haltThreshold: LOCKOUT_HALT_THRESHOLD,
  });

  if (lockedOutAfter > LOCKOUT_HALT_THRESHOLD) {
    logger.error(
      'HALT — more accounts would be locked out than expected; NOT applying. ' +
        'These accounts have no identity key and no passkey, only a legacy ' +
        'password/social credential this migration removes. Review them before ' +
        'proceeding.',
      new Error(`lockedOutAfter=${lockedOutAfter} exceeds threshold ${LOCKOUT_HALT_THRESHOLD}`),
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

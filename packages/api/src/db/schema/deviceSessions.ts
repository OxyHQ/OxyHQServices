/**
 * `device_sessions` — the SERVER AUTHORITY for what is signed in on one device.
 *
 * Ported from `models/DeviceSession.ts`. Every zero-cookie mint
 * (`POST /session/device/token`) resolves against this row, so it is the closest
 * thing in the schema to a credential store and each nullable column below is
 * load-bearing.
 *
 * ## `accounts[]` is a CHILD TABLE, not `jsonb`
 *
 * Each entry carries TWO user references (`accountId`, `operatedByUserId`). As
 * `jsonb` both would be orphanable ids inside an opaque value — un-joinable,
 * un-constrained, and invisible to `ON DELETE`. `device_session_accounts` makes
 * them real foreign keys, which is what makes deleting an account actually
 * remove it from every device instead of leaving a dangling entry that the
 * mint path would have to defend against. See `deviceSessionAccounts.ts`.
 *
 * ## The `default: undefined` workaround does NOT travel
 *
 * `secretHash` is `default: undefined` in Mongoose (never `null`) purely because
 * a Mongo SPARSE unique index collides on nulls. Postgres unique indexes treat
 * NULLs as DISTINCT, so a plain `UNIQUE` on a nullable column is already
 * correct — and substituting `''` would be worse than the original problem,
 * since an empty string is a VALUE and therefore collides for real. The same
 * applies to the four other `default: undefined` fields here, none of which is
 * unique at all. `__tests__/authSession.test.ts` pins this.
 */

import { integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz, updatedAt } from './columns';
import { users } from './users';

export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: generatedId(),
    /**
     * The device's own identifier — per web origin, per native app group. It is
     * this row's natural key, not a reference to anything (see the ledger).
     */
    deviceId: text().notNull(),
    /**
     * Whichever account of the device's set is currently active.
     *
     * `SET NULL`, and NULL is a first-class state here (the Mongoose default):
     * "signed in, nothing selected". `CASCADE` would delete the whole DEVICE
     * when one of possibly several accounts is deleted, taking every other
     * account's entry with it. `resolveActiveToken` refuses to mint for a null
     * or dead active account, and `healActiveAccount` re-elects one on the next
     * `getState`, so `SET NULL` fails closed.
     */
    activeAccountId: text().references(() => users.id, { onDelete: 'set null' }),
    /**
     * `sha256(deviceSecret)` — the zero-cookie transport's proof. The raw secret
     * is held only by the client, so this is a verifier, not a credential: a
     * dump of this column cannot forge a mint. Unique so one secret can never
     * address two devices; NULL for a device that has not been bound to a
     * secret yet.
     */
    secretHash: text(),
    /** The just-rotated secret's hash, honoured until `prev_secret_expires_at`. */
    prevSecretHash: text(),
    prevSecretExpiresAt: timestamptz(),
    /**
     * `sha256` of the non-rotating background credential, presented by native
     * background code at `POST /session/device/background-token`. Deliberately
     * separate from `secret_hash` so a widget worker never contends with the
     * rotating secret the JS runtime depends on.
     */
    backgroundSecretHash: text(),
    /**
     * The single account the background credential may mint for.
     *
     * `SET NULL` is the fail-CLOSED choice here, which is the opposite of the
     * `push_tokens.application_id` trap: `mintFromBackgroundSecret`
     * (`deviceSession.service.ts:470`) rejects the presentation outright when
     * `boundAccountId` is falsy, so nulling this column disarms the credential
     * rather than widening it. `signout` already clears the whole triple when
     * the bound account leaves the device; the constraint is the backstop for a
     * delete that bypasses the service.
     */
    backgroundSecretAccountId: text().references(() => users.id, { onDelete: 'set null' }),
    backgroundSecretExpiresAt: timestamptz(),
    /** Bumped on every mutation; the client's cross-app resync signal. */
    revision: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('device_sessions_device_id_key').on(t.deviceId),
    // Mongo: `{secretHash: 1}, { unique: true, sparse: true }`. Sparse exists
    // only to stop nulls colliding, which Postgres does not do — so this is a
    // plain UNIQUE on a nullable column and means exactly the same thing.
    unique('device_sessions_secret_hash_key').on(t.secretHash),
    // `prev_secret_hash` and `background_secret_hash` are deliberately NOT
    // indexed: both are read only after the row has already been found by
    // `device_id`, and both churn on every rotation.
  ]
);

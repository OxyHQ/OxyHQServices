/**
 * `account_members` — one membership of a member on an account.
 *
 * Ported from `models/AccountMember.ts`. This single table replaced the legacy
 * `WorkspaceMember` + `ApplicationMember` + `ManagedAccount.managers[]` tables,
 * and it is what every RBAC decision in `routes/accounts.ts` and
 * `routes/applications.ts` resolves through: the NEAREST row over
 * `[accountId, ...account.ancestors]` wins, unless `inherit` is false.
 *
 * ## `permissions` does NOT travel
 *
 * Mongo stored a `permissions[]` array beside `role`, and every write site sets
 * it to exactly `permissionsForAccountRole(role)` — `account.service.ts:283`,
 * `:726`, `:733`, `:766`, `:840`, `:850`. It is a derivation of `role`, not
 * data, and `resolveEffectiveRole` (`account.service.ts:549`) already falls back
 * to deriving it when the array is empty, a branch that exists only for rows
 * written before the field.
 *
 * The wire contract is unchanged: `serializeMember` (`routes/accounts.ts:167`)
 * keeps emitting `permissions`, computed with the same
 * `permissionsForAccountRole(role)` the writes used. Same treatment as
 * `name.displayName` and `did` on `users` — derived at the serializer, and the
 * legacy empty-array branch does not travel with it.
 */

import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { ACCOUNT_ROLES } from '../../utils/accountRoles';
import { createdAt, generatedId, timestamptz, updatedAt } from './columns';
import { users } from './users';

/**
 * Membership lifecycle. `removed` is retained rather than deleted so a
 * re-invitation reactivates the same row (`addMember`).
 *
 * Declared here rather than imported from `models/AccountMember.ts`, which pulls
 * in mongoose; `__tests__/applications.test.ts` holds the copies equal.
 * `ACCOUNT_ROLES` needs no such copy — `utils/accountRoles.ts` is
 * dependency-free, so it is imported directly and cannot drift at all.
 */
export const ACCOUNT_MEMBER_STATUSES = ['active', 'invited', 'removed'] as const;

/** Renders a `const` tuple as a SQL `in (…)` list. */
function inList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

export const accountMembers = pgTable(
  'account_members',
  {
    id: generatedId(),
    /** The account the membership is ON (a User of any `kind`). */
    accountId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The member (a `personal` User). */
    memberUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text({ enum: ACCOUNT_ROLES }).notNull(),
    /**
     * Whether the membership cascades to descendant accounts. `false` scopes it
     * to `account_id` alone — the member is NOT a member of its children.
     */
    inherit: boolean().notNull().default(true),
    status: text({ enum: ACCOUNT_MEMBER_STATUSES }).notNull().default('active'),
    /**
     * Who issued the invitation. Attribution — `SET NULL` so an inviter's
     * account erasure never removes a membership that is still valid.
     */
    invitedByUserId: text().references(() => users.id, { onDelete: 'set null' }),
    joinedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one membership row per (account, member) — `addMember` reads this
    // to decide between reactivating and inserting.
    unique('account_members_account_id_member_user_id_key').on(t.accountId, t.memberUserId),
    // "What can this user reach" — drives `listAccessibleAccounts`.
    index('account_members_member_user_id_status_idx').on(t.memberUserId, t.status),
    // Mongo's standalone `{accountId}` and `{memberUserId}` are both dropped: a
    // btree serves any leading prefix, and the two indexes above already lead
    // with those columns.
    check('account_members_role_check', sql`${t.role} in (${sql.raw(inList(ACCOUNT_ROLES))})`),
    check(
      'account_members_status_check',
      sql`${t.status} in (${sql.raw(inList(ACCOUNT_MEMBER_STATUSES))})`
    ),
  ]
);

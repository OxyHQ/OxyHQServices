/**
 * Account Service — unified Account graph (tree + membership + credentials).
 *
 * The `users` row IS the principal Account. This service owns the graph
 * semantics layered on top of it:
 *  - tree maintenance (create child accounts, reparent with cycle/depth guards,
 *    materialised path rewrite);
 *  - membership resolution WITH inheritance (the nearest membership row over
 *    `[accountId, ...ancestors]` wins; ancestor rows cascade only when
 *    `inherit` is true);
 *  - `verifyActingAs` generalised to "member of accountId (directly or via an
 *    inheriting ancestor) holding `account:act_as`";
 *  - members CRUD + transfer-ownership (never removes/demotes the last owner);
 *  - service credentials for `bot`-kind accounts (7-day rotation grace).
 *
 * ## What the Postgres port changed
 *
 * - **`ancestors` is `user_ancestors`, not an embedded array.** Each edge is a
 *   row with a real foreign key and an explicit `depth`, so the ROOT-FIRST order
 *   the Mongo array carried implicitly is now stated (`db/schema/userAncestors.ts`).
 * - **`account_members.permissions` does not travel.** Every write site set it
 *   to exactly `permissionsForAccountRole(role)`; it is a derivation of `role`,
 *   not data, and the serializer keeps emitting it from the role.
 * - **The session-less transaction fallback is DELETED, not translated.** The
 *   Mongoose helper string-matched a "no replica set" error and re-ran the work
 *   WITHOUT a transaction, so a subtree move on a standalone deployment ran
 *   non-atomically — a half-rewritten materialised path, silently. Postgres has
 *   no such mode, so there is nothing to fall back to.
 *
 * Pure tree/inheritance helpers are exported separately so they can be unit
 * tested without a database.
 */

import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb, type Database } from '../config/postgres';
import { accountCredentials } from '../db/schema/accountCredentials';
import { accountMembers } from '../db/schema/accountMembers';
import { userAncestors, MAX_ACCOUNT_DEPTH } from '../db/schema/userAncestors';
import { users } from '../db/schema/users';
import {
  publicColumns,
  USERS_PROTECTED_COLUMNS,
} from '../db/schema/protectedColumns';
import type { AccountKind } from '../db/schema/users';
import { CHILD_ACCOUNT_KINDS, type OrganizationCategory } from '@oxyhq/contracts';
import {
  permissionsForAccountRole,
  roleCanActAs,
  type AccountRole,
} from '../utils/accountRoles';
import { isCredentialUsable } from '../utils/credentialUsability';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../utils/error';
import { DISPLAY_NAME_INVALID_MESSAGE, isValidDisplayName } from '@oxyhq/core';
import { logger } from '../utils/logger';
import userCache from '../utils/userCache';
import type { ApplicationScope } from '../utils/applicationScopes';

const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;
const SECRET_RANDOM_BYTES = 32;

/**
 * Grace window during which a rotated-away credential keeps working (7 days),
 * matching the Application credential rotation semantics.
 */
const CREDENTIAL_ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Reject a name half that the display-name policy would not allow.
 *
 * Account create/update is a second write path onto the same `users` columns
 * `updateUserProfile` guards, so it has to run the same policy — otherwise the
 * policy is only enforced on whichever path the caller happens to pick.
 */
function assertValidAccountName(
  name: { first?: string; last?: string; displayName?: string } | undefined
): void {
  if (!name || typeof name !== 'object') return;
  // `displayName` is validated by the SAME policy as the human halves. It is a
  // third write path onto the display string, so exempting it would mean the
  // character policy holds only on whichever field the caller happened to use.
  for (const part of ['first', 'last', 'displayName'] as const) {
    const value = name[part];
    if (typeof value === 'string' && !isValidDisplayName(value)) {
      throw new BadRequestError(DISPLAY_NAME_INVALID_MESSAGE);
    }
  }
}

/** How the caller is related to an account in their accessible forest. */
export type AccountRelationship = 'self' | 'owner' | 'member';

/** An `account_members` row. */
export type AccountMemberRow = typeof accountMembers.$inferSelect;

/** An `account_credentials` row. */
export type AccountCredentialRow = typeof accountCredentials.$inferSelect;

/**
 * A `users` row, read as an ACCOUNT rather than as a profile — WITHOUT the
 * protected columns.
 *
 * Every read here goes through `publicColumns(users)`, so the phone number, the
 * contact-discovery hashes and the refresh token never enter this service's
 * memory, let alone an account DTO. Narrowing the TYPE to match is the half that
 * a convention cannot give you: a serializer that reaches for `phone` on an
 * account now fails `tsc` instead of shipping it.
 *
 * `schema/__tests__/protectedColumns.test.ts` is the gate for the other half —
 * it scans `src/` for bare `select()` against a protected table and names the
 * `file:line`. It caught all eight sites in this batch.
 */
export type AccountRow = Omit<
  typeof users.$inferSelect,
  (typeof USERS_PROTECTED_COLUMNS)[number]
>;

/**
 * An account plus its materialised path, which is the shape every tree
 * operation needs and which no single row can carry now that `ancestors` is a
 * child table.
 */
export interface AccountWithAncestors {
  account: AccountRow;
  /** Root FIRST — `depth 0` is the tree root, the last entry is the parent. */
  ancestors: string[];
}

/** A minimal membership shape sufficient for inheritance resolution. */
export interface MembershipLike {
  accountId: string;
  role: AccountRole;
  inherit: boolean;
  status: string;
}

/** Resolved effective access of a caller over an account. */
export interface EffectiveAccess {
  role: AccountRole;
  permissions: string[];
  /** `self` = implicit ownership of one's own personal account. */
  source: 'self' | 'direct' | 'inherited';
  /** The concrete membership row, when the access came from one. */
  membership: AccountMemberRow | null;
}

/** A node in the caller's accessible account forest. */
export interface AccountNode {
  accountId: string;
  kind: AccountKind;
  parentAccountId: string | null;
  rootAccountId: string;
  account: AccountRow;
  relationship: AccountRelationship;
  /** The caller's effective membership ROW over this account (null for `self`). */
  callerMembership: AccountMemberRow | null;
  /** Whether `callerMembership` is a direct row or inherited from an ancestor. */
  callerMembershipSource: 'direct' | 'inherited' | null;
  childCount: number;
}

export interface CreateChildAccountInput {
  kind: Exclude<AccountKind, 'personal'>;
  username: string;
  name?: { first?: string; last?: string; displayName?: string };
  bio?: string;
  avatar?: string;
  description?: string;
  /** Meaningful only when `kind` is `organization`. */
  organizationCategory?: OrganizationCategory;
}

// ===========================================================================
// Pure helpers (no DB) — exported for unit testing
// ===========================================================================

/** The ancestor path a new child of `parent` should carry (root → parent). */
export function childAncestorsOf(parent: AccountWithAncestors): string[] {
  return [...parent.ancestors, parent.account.id];
}

/** The `rootAccountId` a new child of `parent` should carry. */
export function childRootOf(parent: AccountWithAncestors): string {
  return parent.account.rootAccountId ?? parent.account.id;
}

/**
 * A channel has no administrator of its own — only members — so it cannot parent
 * another channel. Stated once here so service and user create/move paths share
 * the same invariant.
 */
export function channelCannotParentChannel(
  parentKind: AccountKind | string | null | undefined,
  childKind: AccountKind | string | null | undefined
): boolean {
  return parentKind === 'channel' && childKind === 'channel';
}

/**
 * Would re-parenting `accountId` under `newParent` create a cycle? True when the
 * new parent IS the account itself, or the account is already an ancestor of the
 * new parent (i.e. the new parent is a descendant of the account).
 */
export function wouldCreateCycle(
  accountId: string,
  newParent: AccountWithAncestors
): boolean {
  if (newParent.account.id === accountId) {
    return true;
  }
  return newParent.ancestors.includes(accountId);
}

/**
 * Rewrite a descendant's path after its subtree root moved. The descendant's
 * ancestors begin with the moved node's OLD ancestors as a prefix (followed by
 * the moved node's id and any intermediate ids). Swapping that prefix for the
 * moved node's NEW ancestors preserves the in-subtree suffix.
 */
export function rewriteDescendantAncestors(
  oldSelfAncestors: string[],
  newSelfAncestors: string[],
  descendantAncestors: string[]
): string[] {
  const suffix = descendantAncestors.slice(oldSelfAncestors.length);
  return [...newSelfAncestors, ...suffix];
}

/**
 * Resolve the effective membership of a caller over an account given the
 * caller's membership rows on the account and any of its ancestors.
 *
 * Resolution walks NEAREST-FIRST: the account itself, then its ancestors from
 * immediate parent up to the root. A direct row on the account always wins
 * (its `inherit` flag only governs whether IT cascades to ITS children). An
 * ancestor row applies to the account only when `inherit` is true. Returns the
 * first matching active row, or null.
 */
export function resolveEffectiveMembership<T extends MembershipLike>(
  rows: T[],
  accountId: string,
  ancestors: string[]
): { row: T; source: 'direct' | 'inherited' } | null {
  const byAccount = new Map<string, T>();
  for (const row of rows) {
    if (row.status === 'active') {
      byAccount.set(row.accountId, row);
    }
  }
  // Nearest-first: the account, then ancestors from immediate parent → root.
  const path = [accountId, ...[...ancestors].reverse()];
  for (let i = 0; i < path.length; i++) {
    const row = byAccount.get(path[i]);
    if (!row) continue;
    if (i === 0) {
      return { row, source: 'direct' };
    }
    if (row.inherit) {
      return { row, source: 'inherited' };
    }
  }
  return null;
}

// ===========================================================================
// Internal reads
// ===========================================================================

/** Load an account with its materialised path, or null. */
async function loadAccount(
  db: Database,
  accountId: string
): Promise<AccountWithAncestors | null> {
  const [account] = await db.select(publicColumns(users)).from(users).where(eq(users.id, accountId)).limit(1);
  if (!account) return null;
  return { account, ancestors: await loadAncestors(db, accountId) };
}

/** The root→parent path of one account. */
async function loadAncestors(db: Database, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ ancestorId: userAncestors.ancestorId })
    .from(userAncestors)
    .where(eq(userAncestors.userId, accountId))
    .orderBy(asc(userAncestors.depth));
  return rows.map((row) => row.ancestorId);
}

/**
 * Replace one account's materialised path.
 *
 * Delete-then-insert rather than a positional update: the path is addressed by
 * `(user_id, depth)` and a move changes its LENGTH, so an in-place update would
 * leave the tail of a shortened path behind.
 */
async function writeAncestors(
  tx: Database,
  accountId: string,
  ancestors: string[]
): Promise<void> {
  await tx.delete(userAncestors).where(eq(userAncestors.userId, accountId));
  if (ancestors.length === 0) return;
  await tx.insert(userAncestors).values(
    ancestors.map((ancestorId, depth) => ({ userId: accountId, depth, ancestorId }))
  );
}

export class AccountService {
  // -------------------------------------------------------------------------
  // Tree maintenance
  // -------------------------------------------------------------------------

  /**
   * Create a child account under `parentAccountId`. Mints a no-login account
   * row of the requested non-personal `kind`, wires its tree fields, and records
   * the creator as an `owner` member of the new account.
   *
   * One transaction: an account whose owner membership failed to write is an
   * account nobody can administer.
   */
  async createChildAccount(
    parentAccountId: string,
    creatorUserId: string,
    input: CreateChildAccountInput
  ): Promise<{ account: AccountRow; membership: AccountMemberRow }> {
    if (!CHILD_ACCOUNT_KINDS.includes(input.kind)) {
      throw new BadRequestError(
        `A child account kind must be one of: ${CHILD_ACCOUNT_KINDS.join(', ')}`
      );
    }
    if (input.organizationCategory !== undefined && input.kind !== 'organization') {
      throw new BadRequestError('organizationCategory applies only to organization accounts');
    }

    const db = getDb();
    const parent = await loadAccount(db, parentAccountId);
    if (!parent) {
      throw new NotFoundError('Parent account not found');
    }

    if (parent.ancestors.length + 1 > MAX_ACCOUNT_DEPTH) {
      throw new BadRequestError(
        `Maximum account nesting depth (${MAX_ACCOUNT_DEPTH}) exceeded`
      );
    }
    if (channelCannotParentChannel(parent.account.kind, input.kind)) {
      throw new BadRequestError('A channel cannot own another channel');
    }

    const username = await this.resolveUniqueUsername(input.username);

    assertValidAccountName(input.name);

    const ancestors = childAncestorsOf(parent);
    const rootAccountId = childRootOf(parent);

    const { account, membership } = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          username,
          nameFirst: input.name?.first,
          nameLast: input.name?.last,
          nameDisplay: input.name?.displayName,
          bio: input.bio,
          description: input.description,
          avatar: input.avatar,
          verified: true,
          type: 'local',
          kind: input.kind,
          organizationCategory:
            input.kind === 'organization' ? input.organizationCategory : undefined,
          parentAccountId: parent.account.id,
          rootAccountId,
          accountStatus: 'active',
        })
        .returning();

      await writeAncestors(tx, created.id, ancestors);

      const [member] = await tx
        .insert(accountMembers)
        .values({
          accountId: created.id,
          memberUserId: creatorUserId,
          role: 'owner',
          inherit: true,
          status: 'active',
          invitedByUserId: creatorUserId,
          joinedAt: new Date(),
        })
        .returning();

      return { account: created, membership: member };
    });

    logger.info('Account created', {
      accountId: account.id,
      parentAccountId: parent.account.id,
      kind: input.kind,
      createdBy: creatorUserId,
    });

    return { account, membership };
  }

  /**
   * Re-parent `accountId` under `newParentId`. Rejects self-parenting, cycles
   * (the new parent being a descendant), and any move that would push the
   * subtree past `MAX_ACCOUNT_DEPTH`. Personal accounts are always roots and may
   * not be moved. The subtree's materialised paths and roots are rewritten
   * atomically — with no session-less fallback, so a standalone deployment can
   * no longer leave the tree half-rewritten.
   */
  async moveAccount(accountId: string, newParentId: string): Promise<AccountRow> {
    if (accountId === newParentId) {
      throw new BadRequestError('An account cannot be its own parent');
    }

    const db = getDb();
    const [account, newParent] = await Promise.all([
      loadAccount(db, accountId),
      loadAccount(db, newParentId),
    ]);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (!newParent) {
      throw new NotFoundError('New parent account not found');
    }
    if (account.account.kind === 'personal') {
      throw new BadRequestError('A personal account is always a root and cannot be moved');
    }
    if (wouldCreateCycle(accountId, newParent)) {
      throw new BadRequestError('Cannot move an account beneath itself or one of its descendants');
    }
    if (channelCannotParentChannel(newParent.account.kind, account.account.kind)) {
      throw new BadRequestError('A channel cannot own another channel');
    }

    const oldSelfAncestors = account.ancestors;
    const newSelfAncestors = childAncestorsOf(newParent);
    const newRoot = childRootOf(newParent);

    const affectedIds: string[] = [accountId];

    const moved = await db.transaction(async (tx) => {
      // Every account whose path contains this one — the whole subtree, in one
      // indexed read (`user_ancestors_ancestor_id_idx`), which is the reason the
      // path is materialised at all.
      const descendantIds = (
        await tx
          .select({ userId: userAncestors.userId })
          .from(userAncestors)
          .where(eq(userAncestors.ancestorId, accountId))
      ).map((row) => row.userId);

      const descendantPaths = new Map<string, string[]>();
      let maxDescDepth = oldSelfAncestors.length;
      for (const descendantId of descendantIds) {
        const path = await loadAncestors(tx, descendantId);
        descendantPaths.set(descendantId, path);
        maxDescDepth = Math.max(maxDescDepth, path.length);
      }

      // Depth guard over the whole subtree.
      const subtreeRelativeDepth = maxDescDepth - oldSelfAncestors.length;
      if (newSelfAncestors.length + subtreeRelativeDepth > MAX_ACCOUNT_DEPTH) {
        throw new BadRequestError(
          `Move would exceed the maximum account nesting depth (${MAX_ACCOUNT_DEPTH})`
        );
      }

      const [updated] = await tx
        .update(users)
        .set({ parentAccountId: newParent.account.id, rootAccountId: newRoot })
        .where(eq(users.id, accountId))
        .returning();
      await writeAncestors(tx, accountId, newSelfAncestors);

      for (const [descendantId, path] of descendantPaths) {
        await writeAncestors(
          tx,
          descendantId,
          rewriteDescendantAncestors(oldSelfAncestors, newSelfAncestors, path)
        );
        await tx
          .update(users)
          .set({ rootAccountId: newRoot })
          .where(eq(users.id, descendantId));
        affectedIds.push(descendantId);
      }

      return updated;
    });

    for (const id of affectedIds) {
      userCache.invalidate(id);
    }

    logger.info('Account moved', {
      accountId,
      newParentId,
      affected: affectedIds.length,
    });

    return moved;
  }

  /**
   * Apply a whitelisted profile update to an account. Never mass-assigns —
   * only the explicit fields below are writable. A username change is validated
   * for the character policy + uniqueness.
   */
  async updateAccount(
    accountId: string,
    input: {
      username?: string;
      name?: { first?: string; last?: string; displayName?: string };
      bio?: string | null;
      avatar?: string | null;
      description?: string;
      color?: string;
      links?: string[];
      organizationCategory?: OrganizationCategory | null;
    }
  ): Promise<AccountRow> {
    const db = getDb();
    const [account] = await db.select(publicColumns(users)).from(users).where(eq(users.id, accountId)).limit(1);
    if (!account) {
      throw new NotFoundError('Account not found');
    }

    const set: Partial<typeof users.$inferInsert> = {};

    if (input.organizationCategory !== undefined) {
      if (account.kind !== 'organization') {
        throw new BadRequestError('organizationCategory applies only to organization accounts');
      }
      set.organizationCategory = input.organizationCategory ?? null;
    }

    if (input.username !== undefined) {
      set.username = await this.resolveUniqueUsername(input.username, accountId);
    }
    if (input.name !== undefined) {
      assertValidAccountName(input.name);
      // Mongo merged the supplied halves over the stored subdocument; the two
      // columns are independent, so only the supplied half is written.
      if (input.name.first !== undefined) set.nameFirst = input.name.first;
      if (input.name.last !== undefined) set.nameLast = input.name.last;
      // An empty string CLEARS the explicit name and falls back to the composed
      // `first`/`last`, which is the only way back once one is set.
      if (input.name.displayName !== undefined) {
        set.nameDisplay = input.name.displayName === '' ? null : input.name.displayName;
      }
    }
    if (input.bio !== undefined) set.bio = input.bio;
    if (input.avatar !== undefined) set.avatar = input.avatar;
    if (input.description !== undefined) set.description = input.description;
    if (input.color !== undefined) set.color = input.color;
    if (input.links !== undefined) set.links = input.links;

    const updated =
      Object.keys(set).length > 0
        ? (await db.update(users).set(set).where(eq(users.id, accountId)).returning())[0]
        : account;

    userCache.invalidate(accountId);

    logger.info('Account updated', { accountId });
    return updated;
  }

  /**
   * Archive an account (the `DELETE /accounts/:id` action). Sets
   * `accountStatus: 'archived'` — NEVER hard-deletes, so the tree edges and
   * history survive. Personal accounts cannot be archived (use the GDPR
   * self-delete flow instead).
   */
  async archiveAccount(accountId: string): Promise<AccountRow> {
    const db = getDb();
    const [account] = await db.select(publicColumns(users)).from(users).where(eq(users.id, accountId)).limit(1);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (account.kind === 'personal') {
      throw new BadRequestError('A personal account cannot be archived');
    }

    const [archived] = await db
      .update(users)
      .set({ accountStatus: 'archived' })
      .where(eq(users.id, accountId))
      .returning();
    userCache.invalidate(accountId);

    logger.info('Account archived', { accountId });
    return archived;
  }

  /**
   * Immediate (non-archived) children of an account, annotated with the caller's
   * relationship + effective membership (so the route can emit `AccountNode`s).
   */
  async listChildren(userId: string, accountId: string): Promise<AccountNode[]> {
    const children = await getDb()
      .select(publicColumns(users))
      .from(users)
      .where(and(eq(users.parentAccountId, accountId), ne(users.accountStatus, 'archived')))
      .orderBy(asc(users.createdAt));
    return this.annotateAccounts(userId, children);
  }

  /**
   * The full (non-archived) subtree rooted at `accountId`, including itself,
   * annotated with the caller's relationship + effective membership.
   */
  async getSubtree(userId: string, accountId: string): Promise<AccountNode[]> {
    const subtree = await getDb()
      .select(publicColumns(users))
      .from(users)
      .where(
        and(
          sql`(${users.id} = ${accountId} or exists (
            select 1 from ${userAncestors}
            where ${userAncestors.userId} = ${users.id}
              and ${userAncestors.ancestorId} = ${accountId}
          ))`,
          ne(users.accountStatus, 'archived')
        )
      )
      .orderBy(asc(users.createdAt));
    return this.annotateAccounts(userId, subtree);
  }

  // -------------------------------------------------------------------------
  // Membership + inheritance
  // -------------------------------------------------------------------------

  /**
   * Resolve the caller's effective access over `accountId`, honouring
   * inheritance. A caller over their OWN personal account is an implicit owner.
   * Returns null when the caller has no access.
   */
  async resolveEffectiveAccess(
    userId: string,
    accountId: string
  ): Promise<EffectiveAccess | null> {
    if (userId === accountId) {
      // A user is the implicit owner of their own (personal) account.
      return {
        role: 'owner',
        permissions: permissionsForAccountRole('owner'),
        source: 'self',
        membership: null,
      };
    }

    const db = getDb();
    const [account] = await db
      .select({ id: users.id, accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.id, accountId))
      .limit(1);
    if (!account || account.accountStatus === 'archived') {
      return null;
    }
    return this.effectiveAccessForAccount(userId, { id: account.id });
  }

  /**
   * Effective access of `userId` over an already-identified account.
   *
   * Takes an object rather than an id so a caller that has already loaded the
   * account keeps reading naturally; only the id is used, because the
   * materialised path lives in `user_ancestors` now and is read here either way.
   */
  async effectiveAccessForAccount(
    userId: string,
    account: { id?: unknown; _id?: unknown }
  ): Promise<EffectiveAccess | null> {
    const raw = account.id ?? account._id;
    const accountId = typeof raw === 'string' ? raw : String(raw ?? '');
    if (!accountId) {
      return null;
    }

    if (accountId === userId) {
      return {
        role: 'owner',
        permissions: permissionsForAccountRole('owner'),
        source: 'self',
        membership: null,
      };
    }

    const db = getDb();
    const ancestors = await loadAncestors(db, accountId);
    const pathIds = [accountId, ...ancestors];

    const rows = await db
      .select()
      .from(accountMembers)
      .where(
        and(
          eq(accountMembers.memberUserId, userId),
          inArray(accountMembers.accountId, pathIds),
          eq(accountMembers.status, 'active')
        )
      );

    const resolved = resolveEffectiveMembership(rows, accountId, ancestors);
    if (!resolved) {
      return null;
    }

    return {
      role: resolved.row.role,
      // Derived from the role, always. Mongo stored an array beside it that
      // every write site set to exactly this; it is not data and does not travel.
      permissions: permissionsForAccountRole(resolved.row.role),
      source: resolved.source,
      membership: resolved.row,
    };
  }

  /**
   * Authorise `userId` to switch INTO `accountId` (`POST /accounts/:id/switch`).
   * Authorised iff the caller's effective role carries `account:act_as`. Returns
   * the role on success, null otherwise. Also re-run to keep a managed-account
   * session bound to its operator's membership (revocation kills the session).
   */
  async verifyActingAs(userId: string, accountId: string): Promise<AccountRole | null> {
    const access = await this.resolveEffectiveAccess(userId, accountId);
    if (!access) {
      return null;
    }
    return roleCanActAs(access.role) ? access.role : null;
  }

  /**
   * The caller's accessible account forest: their own personal account (`self`)
   * plus every account they are a direct member of and the entire subtree below
   * each. Each node is annotated with the caller's relationship + effective
   * membership and a child count.
   */
  async listAccessibleAccounts(userId: string): Promise<AccountNode[]> {
    const db = getDb();

    const directRows = await db
      .select()
      .from(accountMembers)
      .where(
        and(eq(accountMembers.memberUserId, userId), eq(accountMembers.status, 'active'))
      );
    const directAccountIds = directRows.map((row) => row.accountId);

    // `inArray`, never `= any(${jsArray})`: interpolating a JS array into `sql`
    // binds it as a single TUPLE parameter, and Postgres rejects it outright
    // with `malformed array literal`. `inArray` renders a proper `in (...)`
    // list. (The correlated `${users.id}` inside the EXISTS is safe here because
    // a raw `sql` fragment renders columns table-qualified; a subquery built
    // with the query builder would render it BARE and silently match the
    // subquery's own table instead.)
    const reachable =
      directAccountIds.length > 0
        ? or(
            eq(users.id, userId),
            inArray(users.id, directAccountIds),
            sql`exists (
              select 1 from ${userAncestors}
              where ${userAncestors.userId} = ${users.id}
                and ${inArray(userAncestors.ancestorId, directAccountIds)}
            )`
          )
        : eq(users.id, userId);

    const accounts = await db
      .select(publicColumns(users))
      .from(users)
      .where(and(reachable, ne(users.accountStatus, 'archived')))
      .orderBy(asc(users.createdAt));

    return this.annotateAccounts(userId, accounts, directRows);
  }

  /**
   * Annotate a set of accounts with the caller's relationship + effective
   * membership and a child count, producing `AccountNode`s. The caller's direct
   * membership rows are fetched once (or reused when supplied), and every path
   * is read in ONE query, so inheritance is resolved in-memory with no per-node
   * round trip. `childCount` is computed from the supplied set when closed
   * (forest/subtree); for a flat sibling list it falls back to a grouped count.
   */
  private async annotateAccounts(
    userId: string,
    accounts: AccountRow[],
    directRowsArg?: AccountMemberRow[]
  ): Promise<AccountNode[]> {
    const db = getDb();
    const directRows =
      directRowsArg ??
      (await db
        .select()
        .from(accountMembers)
        .where(
          and(eq(accountMembers.memberUserId, userId), eq(accountMembers.status, 'active'))
        ));

    const accountIds = accounts.map((account) => account.id);

    // Every path in one read, ordered so each account's list rebuilds root-first.
    const pathsById = new Map<string, string[]>();
    if (accountIds.length > 0) {
      const pathRows = await db
        .select({ userId: userAncestors.userId, ancestorId: userAncestors.ancestorId })
        .from(userAncestors)
        .where(inArray(userAncestors.userId, accountIds))
        .orderBy(asc(userAncestors.userId), asc(userAncestors.depth));
      for (const row of pathRows) {
        const path = pathsById.get(row.userId) ?? [];
        path.push(row.ancestorId);
        pathsById.set(row.userId, path);
      }
    }

    // Child counts: prefer the in-memory set (closed for forest/subtree). For any
    // account whose children are not in the set, fall back to a grouped count.
    const inSetChildCounts = new Map<string, number>();
    for (const account of accounts) {
      const parentId = account.parentAccountId;
      if (parentId) {
        inSetChildCounts.set(parentId, (inSetChildCounts.get(parentId) ?? 0) + 1);
      }
    }
    const needsCount = accounts.filter((a) => !inSetChildCounts.has(a.id));
    const groupedChildCounts = new Map<string, number>();
    if (needsCount.length > 0) {
      const rows = await db
        .select({ parentId: users.parentAccountId, n: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            inArray(
              users.parentAccountId,
              needsCount.map((a) => a.id)
            ),
            ne(users.accountStatus, 'archived')
          )
        )
        .groupBy(users.parentAccountId);
      for (const row of rows) {
        if (row.parentId) groupedChildCounts.set(row.parentId, row.n);
      }
    }

    return accounts.map((account) => {
      const ancestors = pathsById.get(account.id) ?? [];
      const isSelf = account.id === userId;

      let relationship: AccountRelationship;
      let callerMembership: AccountMemberRow | null = null;
      let callerMembershipSource: 'direct' | 'inherited' | null = null;

      if (isSelf) {
        relationship = 'self';
      } else {
        const resolved = resolveEffectiveMembership(directRows, account.id, ancestors);
        relationship = resolved?.row.role === 'owner' ? 'owner' : 'member';
        if (resolved) {
          callerMembership = resolved.row;
          callerMembershipSource = resolved.source;
        }
      }

      return {
        accountId: account.id,
        kind: account.kind,
        parentAccountId: account.parentAccountId,
        rootAccountId: account.rootAccountId ?? account.id,
        account,
        relationship,
        callerMembership,
        callerMembershipSource,
        childCount: inSetChildCounts.get(account.id) ?? groupedChildCounts.get(account.id) ?? 0,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Members CRUD
  // -------------------------------------------------------------------------

  /** Direct (non-removed) membership rows on an account. */
  async listMembers(accountId: string): Promise<AccountMemberRow[]> {
    return getDb()
      .select()
      .from(accountMembers)
      .where(
        and(eq(accountMembers.accountId, accountId), ne(accountMembers.status, 'removed'))
      )
      .orderBy(asc(accountMembers.createdAt));
  }

  /**
   * Add (or re-activate) a direct membership on an account. `owner` is not
   * assignable here — ownership is granted only via {@link transferOwnership}.
   *
   * ONE statement: the compound unique on `(account_id, member_user_id)` is what
   * decides between inserting and reactivating, so the read-then-branch the
   * Mongo version ran cannot race with a concurrent invitation.
   */
  async addMember(
    accountId: string,
    callerUserId: string,
    targetUserId: string,
    role: Exclude<AccountRole, 'owner'>,
    inherit = true
  ): Promise<AccountMemberRow> {
    const db = getDb();

    const [existing] = await db
      .select({ status: accountMembers.status })
      .from(accountMembers)
      .where(
        and(
          eq(accountMembers.accountId, accountId),
          eq(accountMembers.memberUserId, targetUserId)
        )
      )
      .limit(1);
    if (existing?.status === 'active') {
      throw new BadRequestError('User is already a member of this account');
    }

    const [member] = await db
      .insert(accountMembers)
      .values({
        accountId,
        memberUserId: targetUserId,
        role,
        inherit,
        status: 'active',
        invitedByUserId: callerUserId,
        joinedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accountMembers.accountId, accountMembers.memberUserId],
        set: {
          role,
          inherit,
          status: 'active',
          invitedByUserId: callerUserId,
          joinedAt: new Date(),
        },
      })
      .returning();

    logger.info('Account member added', {
      accountId,
      memberId: member.id,
      role,
      by: callerUserId,
    });

    return member;
  }

  /**
   * Change a member's role and/or inheritance. An owner's role can only be
   * changed via {@link transferOwnership}.
   */
  async updateMemberRole(
    accountId: string,
    memberId: string,
    role: Exclude<AccountRole, 'owner'>,
    inherit?: boolean
  ): Promise<AccountMemberRow> {
    const member = await this.requireDirectMember(accountId, memberId);
    if (member.role === 'owner') {
      throw new ForbiddenError("An owner's role can only be changed via transfer-ownership");
    }

    const [updated] = await getDb()
      .update(accountMembers)
      .set(inherit === undefined ? { role } : { role, inherit })
      .where(eq(accountMembers.id, memberId))
      .returning();

    logger.info('Account member role updated', { accountId, memberId, role });
    return updated;
  }

  /**
   * Remove a member. The last active owner can never be removed; an owner may
   * only be removed by another owner (enforced by the caller via `callerIsOwner`).
   */
  async removeMember(
    accountId: string,
    memberId: string,
    callerIsOwner: boolean
  ): Promise<void> {
    const db = getDb();
    const member = await this.requireDirectMember(accountId, memberId);

    if (member.role === 'owner') {
      if (!callerIsOwner) {
        throw new ForbiddenError('Only an owner may remove another owner');
      }
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(accountMembers)
        .where(
          and(
            eq(accountMembers.accountId, accountId),
            eq(accountMembers.role, 'owner'),
            eq(accountMembers.status, 'active')
          )
        );
      if (n <= 1) {
        throw new BadRequestError('Cannot remove the last owner of an account');
      }
    }

    await db
      .update(accountMembers)
      .set({ status: 'removed' })
      .where(eq(accountMembers.id, memberId));

    logger.info('Account member removed', { accountId, memberId });
  }

  /**
   * Transfer ownership to another active member. The target is promoted to
   * `owner`; the caller's direct `owner` row (if any) is demoted to `admin`. A
   * personal account cannot be transferred.
   *
   * One transaction: a promotion whose matching demotion failed leaves TWO
   * owners, which the "cannot remove the last owner" guard then reads as safe.
   */
  async transferOwnership(
    accountId: string,
    callerUserId: string,
    targetUserId: string
  ): Promise<void> {
    const db = getDb();
    const [account] = await db
      .select({ kind: users.kind })
      .from(users)
      .where(eq(users.id, accountId))
      .limit(1);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (account.kind === 'personal') {
      throw new BadRequestError('A personal account cannot be transferred');
    }

    if (targetUserId === callerUserId) {
      throw new BadRequestError('You already own this account');
    }

    await db.transaction(async (tx) => {
      const promoted = await tx
        .update(accountMembers)
        .set({ role: 'owner' })
        .where(
          and(
            eq(accountMembers.accountId, accountId),
            eq(accountMembers.memberUserId, targetUserId),
            eq(accountMembers.status, 'active')
          )
        )
        .returning({ id: accountMembers.id });
      if (promoted.length === 0) {
        throw new NotFoundError('Target user is not an active member of this account');
      }

      await tx
        .update(accountMembers)
        .set({ role: 'admin' })
        .where(
          and(
            eq(accountMembers.accountId, accountId),
            eq(accountMembers.memberUserId, callerUserId),
            eq(accountMembers.status, 'active'),
            eq(accountMembers.role, 'owner')
          )
        );
    });

    logger.info('Account ownership transferred', {
      accountId,
      from: callerUserId,
      to: targetUserId,
    });
  }

  // -------------------------------------------------------------------------
  // Service credentials (bot accounts)
  // -------------------------------------------------------------------------

  /** List an account's credentials (never includes secret material). */
  async listCredentials(accountId: string): Promise<Omit<AccountCredentialRow, 'secretHash'>[]> {
    const { secretHash: _secretHash, ...columns } = getTableColumnsOf();
    return getDb()
      .select(columns)
      .from(accountCredentials)
      .where(eq(accountCredentials.accountId, accountId))
      .orderBy(sql`${accountCredentials.createdAt} desc`);
  }

  /**
   * Create a service credential for a `bot`-kind account. The plaintext secret
   * is returned EXACTLY ONCE.
   */
  async createCredential(
    accountId: string,
    callerUserId: string,
    input: {
      name: string;
      environment: AccountCredentialRow['environment'];
      scopes?: ApplicationScope[];
    }
  ): Promise<{ credential: AccountCredentialRow; secret: string }> {
    const db = getDb();
    const [account] = await db
      .select({ kind: users.kind })
      .from(users)
      .where(eq(users.id, accountId))
      .limit(1);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (account.kind !== 'bot') {
      throw new BadRequestError('Service credentials are only available to bot accounts');
    }

    const { publicKey, secret, secretHash } = this.generateCredentialMaterial();
    const [credential] = await db
      .insert(accountCredentials)
      .values({
        accountId,
        name: input.name,
        publicKey,
        secretHash,
        type: 'service',
        environment: input.environment,
        scopes: input.scopes ?? [],
        status: 'active',
        createdByUserId: callerUserId,
      })
      .returning();

    logger.info('Account credential created', {
      accountId,
      credentialId: credential.id,
      by: callerUserId,
    });

    return { credential, secret };
  }

  /**
   * Rotate a credential — zero-downtime. Mints a replacement (fresh keys) then
   * deprecates the previous one with a 7-day grace `expiresAt`.
   *
   * One transaction: a mint whose deprecation failed leaves TWO active
   * credentials with no record of which supersedes which.
   */
  async rotateCredential(
    accountId: string,
    credentialId: string,
    callerUserId: string
  ): Promise<{
    credential: AccountCredentialRow;
    secret: string;
    rotatedFrom: string;
    graceExpiresAt: Date;
  }> {
    const db = getDb();
    const [previous] = await db
      .select()
      .from(accountCredentials)
      .where(
        and(
          eq(accountCredentials.id, credentialId),
          eq(accountCredentials.accountId, accountId),
          ne(accountCredentials.status, 'revoked')
        )
      )
      .limit(1);
    if (!previous) {
      throw new NotFoundError('Credential not found');
    }

    const { publicKey, secret, secretHash } = this.generateCredentialMaterial();
    const graceExpiresAt = new Date(Date.now() + CREDENTIAL_ROTATION_GRACE_MS);

    const rotated = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accountCredentials)
        .values({
          accountId: previous.accountId,
          name: previous.name,
          publicKey,
          secretHash,
          type: previous.type,
          environment: previous.environment,
          scopes: previous.scopes,
          status: 'active',
          rotatedFromCredentialId: previous.id,
          createdByUserId: callerUserId,
        })
        .returning();

      await tx
        .update(accountCredentials)
        .set({ status: 'deprecated', expiresAt: graceExpiresAt })
        .where(eq(accountCredentials.id, previous.id));

      return created;
    });

    logger.info('Account credential rotated', {
      accountId,
      previousCredentialId: previous.id,
      newCredentialId: rotated.id,
      by: callerUserId,
    });

    return { credential: rotated, secret, rotatedFrom: previous.id, graceExpiresAt };
  }

  /** Revoke a credential — it can no longer authenticate (no grace). */
  async revokeCredential(accountId: string, credentialId: string): Promise<void> {
    const revoked = await getDb()
      .update(accountCredentials)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(accountCredentials.id, credentialId),
          eq(accountCredentials.accountId, accountId)
        )
      )
      .returning({ id: accountCredentials.id });
    if (revoked.length === 0) {
      throw new NotFoundError('Credential not found');
    }

    logger.info('Account credential revoked', { accountId, credentialId });
  }

  /**
   * Resolve a usable (active or within-grace) service credential by its public
   * key. Shared predicate with the Application credential resolution sites.
   */
  async resolveUsableCredential(publicKey: string): Promise<AccountCredentialRow | null> {
    const [credential] = await getDb()
      .select()
      .from(accountCredentials)
      .where(eq(accountCredentials.publicKey, publicKey))
      .limit(1);
    if (!credential || !isCredentialUsable(credential)) {
      return null;
    }
    return credential;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Fetch a direct, non-removed membership row or throw 404. */
  private async requireDirectMember(
    accountId: string,
    memberId: string
  ): Promise<AccountMemberRow> {
    const [member] = await getDb()
      .select()
      .from(accountMembers)
      .where(
        and(
          eq(accountMembers.id, memberId),
          eq(accountMembers.accountId, accountId),
          ne(accountMembers.status, 'removed')
        )
      )
      .limit(1);
    if (!member) {
      throw new NotFoundError('Member not found');
    }
    return member;
  }

  /**
   * Resolve a unique username, suffixing a numeric counter on collision (org and
   * bot accounts share the account username index with humans). Validates the
   * username character policy.
   *
   * The collision probe is written against the EXPRESSION the unique index is
   * built on — `lower(btrim(username))`, `db/schema/users.ts` — so a candidate
   * that differs only by case is REJECTED here rather than by the constraint.
   */
  private async resolveUniqueUsername(requested: string, excludeId?: string): Promise<string> {
    const base = requested.trim().toLowerCase();
    if (!base) {
      throw new BadRequestError('Username is required');
    }
    if (!/^[\w.-]+$/.test(base)) {
      throw new BadRequestError(
        'Username may only contain letters, numbers, underscores, hyphens, and dots'
      );
    }

    const db = getDb();
    let candidate = base;
    for (let suffix = 1; suffix <= 1000; suffix++) {
      const clauses = [sql`lower(btrim(${users.username})) = lower(btrim(${candidate}))`];
      if (excludeId) {
        clauses.push(ne(users.id, excludeId));
      }
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(...clauses))
        .limit(1);
      if (!taken) {
        return candidate;
      }
      candidate = `${base}${suffix}`;
    }
    throw new ConflictError('Could not allocate a unique username');
  }

  /** Generate a fresh credential public key + plaintext secret + its hash. */
  private generateCredentialMaterial(): {
    publicKey: string;
    secret: string;
    secretHash: string;
  } {
    const publicKey =
      CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
    const secret = crypto.randomBytes(SECRET_RANDOM_BYTES).toString('hex');
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
    return { publicKey, secret, secretHash };
  }
}

/**
 * The credential columns, so `listCredentials` can drop `secret_hash` by NAME.
 *
 * Mongo's `.select('-secretHash')` was an exclusion; drizzle enumerates, so the
 * omission is expressed as a destructure and the compiler carries it into the
 * return type — a serializer that reads `secretHash` off the result fails `tsc`.
 */
function getTableColumnsOf() {
  const {
    id, accountId, name, publicKey, secretHash, type, environment, scopes, status,
    rotatedFromCredentialId, createdByUserId, lastUsedAt, expiresAt, createdAt, updatedAt,
  } = accountCredentials;
  return {
    id, accountId, name, publicKey, secretHash, type, environment, scopes, status,
    rotatedFromCredentialId, createdByUserId, lastUsedAt, expiresAt, createdAt, updatedAt,
  };
}

export const accountService = new AccountService();
export default accountService;

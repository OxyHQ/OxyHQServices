/**
 * Account Service — unified Account graph (tree + membership + credentials).
 *
 * The `User` document IS the principal Account. This service owns the graph
 * semantics layered on top of it:
 *  - tree maintenance (create child accounts, reparent with cycle/depth guards,
 *    materialised `ancestors` rewrite);
 *  - membership resolution WITH inheritance (the nearest membership row over
 *    `[accountId, ...ancestors]` wins; ancestor rows cascade only when
 *    `inherit` is true);
 *  - `verifyActingAs` generalised to "member of accountId (directly or via an
 *    inheriting ancestor) holding `account:act_as`";
 *  - members CRUD + transfer-ownership (never removes/demotes the last owner);
 *  - service credentials for `bot`-kind accounts (7-day rotation grace).
 *
 * Pure tree/inheritance helpers are exported separately so they can be unit
 * tested without a database (the API test harness mocks mongoose).
 */

import mongoose, { type ClientSession } from 'mongoose';
import User, { type IUser, MAX_ACCOUNT_DEPTH, type AccountKind, type OrganizationCategory } from '../models/User';
import AccountMember, { type IAccountMember } from '../models/AccountMember';
import AccountCredential, { type IAccountCredential } from '../models/AccountCredential';
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
import { logger } from '../utils/logger';
import userCache from '../utils/userCache';
import crypto from 'crypto';
import type { ApplicationScope } from '../utils/applicationScopes';

const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;
const SECRET_RANDOM_BYTES = 32;

/**
 * Grace window during which a rotated-away credential keeps working (7 days),
 * matching the Application credential rotation semantics.
 */
const CREDENTIAL_ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type ObjectId = mongoose.Types.ObjectId;

/** Account kinds that may be CREATED as children (personal accounts are roots). */
const CHILD_ACCOUNT_KINDS: readonly AccountKind[] = ['organization', 'project', 'bot'];

/** How the caller is related to an account in their accessible forest. */
export type AccountRelationship = 'self' | 'owner' | 'member';

/** A minimal membership shape sufficient for inheritance resolution. */
export interface MembershipLike {
  accountId: ObjectId;
  role: AccountRole;
  permissions: string[];
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
  membership: IAccountMember | null;
}

/** A node in the caller's accessible account forest. */
export interface AccountNode {
  accountId: string;
  kind: AccountKind;
  parentAccountId: string | null;
  rootAccountId: string;
  account: IUser;
  relationship: AccountRelationship;
  /** The caller's effective membership ROW over this account (null for `self`). */
  callerMembership: IAccountMember | null;
  /** Whether `callerMembership` is a direct row or inherited from an ancestor. */
  callerMembershipSource: 'direct' | 'inherited' | null;
  childCount: number;
}

export interface CreateChildAccountInput {
  kind: Exclude<AccountKind, 'personal'>;
  username: string;
  name?: { first?: string; last?: string };
  bio?: string;
  avatar?: string;
  description?: string;
  /** Meaningful only when `kind` is `organization`. */
  organizationCategory?: OrganizationCategory;
}

// ===========================================================================
// Pure helpers (no DB) — exported for unit testing
// ===========================================================================

/** The `ancestors` array a new child of `parent` should carry (root → parent). */
export function childAncestorsOf(parent: Pick<IUser, '_id' | 'ancestors'>): ObjectId[] {
  return [...((parent.ancestors as ObjectId[]) ?? []), parent._id];
}

/** The `rootAccountId` a new child of `parent` should carry. */
export function childRootOf(parent: Pick<IUser, '_id' | 'rootAccountId'>): ObjectId {
  return (parent.rootAccountId as ObjectId) ?? parent._id;
}

/**
 * Would re-parenting `accountId` under `newParent` create a cycle? True when the
 * new parent IS the account itself, or the account is already an ancestor of the
 * new parent (i.e. the new parent is a descendant of the account).
 */
export function wouldCreateCycle(
  accountId: ObjectId,
  newParent: Pick<IUser, '_id' | 'ancestors'>
): boolean {
  if (newParent._id.equals(accountId)) {
    return true;
  }
  const ancestors = ((newParent.ancestors as ObjectId[]) ?? []).map((id) => id.toString());
  return ancestors.includes(accountId.toString());
}

/**
 * Rewrite a descendant's `ancestors` after its subtree root moved. The
 * descendant's ancestors begin with the moved node's OLD ancestors as a prefix
 * (followed by the moved node's id and any intermediate ids). Swapping that
 * prefix for the moved node's NEW ancestors preserves the in-subtree suffix.
 */
export function rewriteDescendantAncestors(
  oldSelfAncestors: ObjectId[],
  newSelfAncestors: ObjectId[],
  descendantAncestors: ObjectId[]
): ObjectId[] {
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
  accountId: ObjectId,
  ancestors: ObjectId[]
): { row: T; source: 'direct' | 'inherited' } | null {
  const byAccount = new Map<string, T>();
  for (const row of rows) {
    if (row.status === 'active') {
      byAccount.set(row.accountId.toString(), row);
    }
  }
  // Nearest-first: the account, then ancestors from immediate parent → root.
  const path = [accountId, ...[...ancestors].reverse()];
  for (let i = 0; i < path.length; i++) {
    const row = byAccount.get(path[i].toString());
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
// Transaction helper (falls back to session-less execution when unsupported)
// ===========================================================================

async function withTransaction<T>(
  work: (session: ClientSession | undefined) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transactionsUnsupported =
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set') ||
      message.includes('does not support transactions');
    if (transactionsUnsupported) {
      logger.warn(
        'Account: transactions unsupported by this MongoDB deployment; ' +
          'executing without a transaction',
        { component: 'account.service' }
      );
      return work(undefined);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export class AccountService {
  // -------------------------------------------------------------------------
  // Tree maintenance
  // -------------------------------------------------------------------------

  /**
   * Create a child account under `parentAccountId`. Mints a no-login `User`
   * (`authMethods: []`) of the requested non-personal `kind`, wires its tree
   * fields, and records the creator as an `owner` member of the new account.
   */
  async createChildAccount(
    parentAccountId: string,
    creatorUserId: string,
    input: CreateChildAccountInput
  ): Promise<{ account: IUser; membership: IAccountMember }> {
    if (!CHILD_ACCOUNT_KINDS.includes(input.kind)) {
      throw new BadRequestError(
        `A child account kind must be one of: ${CHILD_ACCOUNT_KINDS.join(', ')}`
      );
    }
    if (input.organizationCategory !== undefined && input.kind !== 'organization') {
      throw new BadRequestError('organizationCategory applies only to organization accounts');
    }

    const parent = await User.findById(parentAccountId);
    if (!parent) {
      throw new NotFoundError('Parent account not found');
    }

    const parentAncestors = (parent.ancestors as ObjectId[]) ?? [];
    if (parentAncestors.length + 1 > MAX_ACCOUNT_DEPTH) {
      throw new BadRequestError(
        `Maximum account nesting depth (${MAX_ACCOUNT_DEPTH}) exceeded`
      );
    }

    const username = await this.resolveUniqueUsername(input.username);

    const ancestors = childAncestorsOf(parent);
    const rootAccountId = childRootOf(parent);

    const account = await User.create({
      username,
      name: input.name ?? {},
      bio: input.bio ?? '',
      description: input.description,
      avatar: input.avatar ?? undefined,
      authMethods: [],
      verified: true,
      type: 'local',
      kind: input.kind,
      organizationCategory:
        input.kind === 'organization' ? input.organizationCategory : undefined,
      parentAccountId: parent._id,
      ancestors,
      rootAccountId,
      accountStatus: 'active',
    });

    const creatorObjectId = new mongoose.Types.ObjectId(creatorUserId);
    const membership = await AccountMember.create({
      accountId: account._id,
      memberUserId: creatorObjectId,
      role: 'owner',
      permissions: permissionsForAccountRole('owner'),
      inherit: true,
      status: 'active',
      invitedByUserId: creatorObjectId,
      joinedAt: new Date(),
    });

    logger.info('Account created', {
      accountId: account._id.toString(),
      parentAccountId: parent._id.toString(),
      kind: input.kind,
      createdBy: creatorUserId,
    });

    return { account, membership };
  }

  /**
   * Re-parent `accountId` under `newParentId`. Rejects self-parenting, cycles
   * (the new parent being a descendant), and any move that would push the
   * subtree past `MAX_ACCOUNT_DEPTH`. Personal accounts are always roots and may
   * not be moved. The subtree's materialised `ancestors`/`rootAccountId` are
   * rewritten atomically.
   */
  async moveAccount(accountId: string, newParentId: string): Promise<IUser> {
    if (accountId === newParentId) {
      throw new BadRequestError('An account cannot be its own parent');
    }

    const [account, newParent] = await Promise.all([
      User.findById(accountId),
      User.findById(newParentId),
    ]);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (!newParent) {
      throw new NotFoundError('New parent account not found');
    }
    if (account.kind === 'personal') {
      throw new BadRequestError('A personal account is always a root and cannot be moved');
    }
    if (wouldCreateCycle(account._id, newParent)) {
      throw new BadRequestError('Cannot move an account beneath itself or one of its descendants');
    }

    const oldSelfAncestors = (account.ancestors as ObjectId[]) ?? [];
    const newSelfAncestors = childAncestorsOf(newParent);
    const newRoot = childRootOf(newParent);

    const affectedIds: string[] = [account._id.toString()];

    await withTransaction(async (session) => {
      const opts = session ? { session } : {};

      const descendants = await User.find({ ancestors: account._id }, null, opts);

      // Depth guard over the whole subtree.
      const oldSelfDepth = oldSelfAncestors.length;
      let maxDescDepth = oldSelfDepth;
      for (const descendant of descendants) {
        maxDescDepth = Math.max(maxDescDepth, (descendant.ancestors?.length ?? 0));
      }
      const subtreeRelativeDepth = maxDescDepth - oldSelfDepth;
      const newSelfDepth = newSelfAncestors.length;
      if (newSelfDepth + subtreeRelativeDepth > MAX_ACCOUNT_DEPTH) {
        throw new BadRequestError(
          `Move would exceed the maximum account nesting depth (${MAX_ACCOUNT_DEPTH})`
        );
      }

      account.parentAccountId = newParent._id;
      account.ancestors = newSelfAncestors;
      account.rootAccountId = newRoot;
      await account.save(opts);

      for (const descendant of descendants) {
        descendant.ancestors = rewriteDescendantAncestors(
          oldSelfAncestors,
          newSelfAncestors,
          (descendant.ancestors as ObjectId[]) ?? []
        );
        descendant.rootAccountId = newRoot;
        await descendant.save(opts);
        affectedIds.push(descendant._id.toString());
      }
    });

    for (const id of affectedIds) {
      userCache.invalidate(id);
    }

    logger.info('Account moved', {
      accountId: account._id.toString(),
      newParentId: newParent._id.toString(),
      affected: affectedIds.length,
    });

    return account;
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
      name?: { first?: string; last?: string };
      bio?: string;
      avatar?: string;
      description?: string;
      color?: string;
      links?: string[];
      organizationCategory?: OrganizationCategory | null;
    }
  ): Promise<IUser> {
    const account = await User.findById(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (input.organizationCategory !== undefined) {
      if (account.kind !== 'organization') {
        throw new BadRequestError('organizationCategory applies only to organization accounts');
      }
      account.organizationCategory =
        input.organizationCategory === null ? undefined : input.organizationCategory;
    }

    if (input.username !== undefined) {
      account.username = await this.resolveUniqueUsername(input.username, account._id);
    }
    if (input.name !== undefined) account.name = input.name;
    if (input.bio !== undefined) account.bio = input.bio;
    if (input.avatar !== undefined) account.avatar = input.avatar;
    if (input.description !== undefined) account.description = input.description;
    if (input.color !== undefined) account.color = input.color;
    if (input.links !== undefined) account.links = input.links;

    await account.save();
    userCache.invalidate(account._id.toString());

    logger.info('Account updated', { accountId });
    return account;
  }

  /**
   * Archive an account (the `DELETE /accounts/:id` action). Sets
   * `accountStatus: 'archived'` — NEVER hard-deletes, so the tree edges and
   * history survive. Personal accounts cannot be archived (use the GDPR
   * self-delete flow instead).
   */
  async archiveAccount(accountId: string): Promise<IUser> {
    const account = await User.findById(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (account.kind === 'personal') {
      throw new BadRequestError('A personal account cannot be archived');
    }
    account.accountStatus = 'archived';
    await account.save();
    userCache.invalidate(account._id.toString());

    logger.info('Account archived', { accountId });
    return account;
  }

  /**
   * Immediate (non-archived) children of an account, annotated with the caller's
   * relationship + effective membership (so the route can emit `AccountNode`s).
   */
  async listChildren(userId: string, accountId: string): Promise<AccountNode[]> {
    const children = await User.find({
      parentAccountId: new mongoose.Types.ObjectId(accountId),
      accountStatus: { $ne: 'archived' },
    }).sort({ createdAt: 1 });
    return this.annotateAccounts(userId, children);
  }

  /**
   * The full (non-archived) subtree rooted at `accountId`, including itself,
   * annotated with the caller's relationship + effective membership.
   */
  async getSubtree(userId: string, accountId: string): Promise<AccountNode[]> {
    const id = new mongoose.Types.ObjectId(accountId);
    const subtree = await User.find({
      $or: [{ _id: id }, { ancestors: id }],
      accountStatus: { $ne: 'archived' },
    }).sort({ createdAt: 1 });
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

    const account = await User.findById(accountId);
    if (!account || account.accountStatus === 'archived') {
      return null;
    }
    return this.effectiveAccessForAccount(userId, account);
  }

  /**
   * Effective access of `userId` over an already-loaded `account` document.
   * Lets route middleware that has already fetched the account avoid a second
   * query while keeping the inheritance logic in one place.
   */
  async effectiveAccessForAccount(
    userId: string,
    account: IUser
  ): Promise<EffectiveAccess | null> {
    if (account._id.equals(new mongoose.Types.ObjectId(userId))) {
      return {
        role: 'owner',
        permissions: permissionsForAccountRole('owner'),
        source: 'self',
        membership: null,
      };
    }

    const ancestors = (account.ancestors as ObjectId[]) ?? [];
    const pathIds = [account._id, ...ancestors];

    const rows = await AccountMember.find({
      memberUserId: new mongoose.Types.ObjectId(userId),
      accountId: { $in: pathIds },
      status: 'active',
    });

    const resolved = resolveEffectiveMembership(rows, account._id, ancestors);
    if (!resolved) {
      return null;
    }

    return {
      role: resolved.row.role,
      permissions:
        resolved.row.permissions?.length > 0
          ? resolved.row.permissions
          : permissionsForAccountRole(resolved.row.role),
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
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const directRows = await AccountMember.find({
      memberUserId: userObjectId,
      status: 'active',
    });
    const directAccountIds = directRows.map((row) => row.accountId);

    const orClauses: Record<string, unknown>[] = [{ _id: userObjectId }];
    if (directAccountIds.length > 0) {
      orClauses.push({ _id: { $in: directAccountIds } });
      orClauses.push({ ancestors: { $in: directAccountIds } });
    }

    const accounts = await User.find({
      $or: orClauses,
      accountStatus: { $ne: 'archived' },
    }).sort({ createdAt: 1 });

    return this.annotateAccounts(userId, accounts, directRows);
  }

  /**
   * Annotate a set of account documents with the caller's relationship +
   * effective membership and a child count, producing `AccountNode`s. The
   * caller's direct membership rows are fetched once (or reused when supplied),
   * so inheritance is resolved in-memory with no per-node query. `childCount` is
   * computed from the supplied set when closed (forest/subtree); for a flat
   * sibling list (children) it falls back to a grouped count of grandchildren.
   */
  private async annotateAccounts(
    userId: string,
    accounts: IUser[],
    directRowsArg?: IAccountMember[]
  ): Promise<AccountNode[]> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const directRows =
      directRowsArg ??
      (await AccountMember.find({ memberUserId: userObjectId, status: 'active' }));

    // Child counts: prefer the in-memory set (closed for forest/subtree). For any
    // account whose children are not in the set, fall back to a grouped count.
    const inSetChildCounts = new Map<string, number>();
    for (const account of accounts) {
      const parentId = account.parentAccountId?.toString();
      if (parentId) {
        inSetChildCounts.set(parentId, (inSetChildCounts.get(parentId) ?? 0) + 1);
      }
    }
    const needsCount = accounts.filter((a) => !inSetChildCounts.has(a._id.toString()));
    const groupedChildCounts = new Map<string, number>();
    if (needsCount.length > 0) {
      const rows = await User.aggregate<{ _id: ObjectId; n: number }>([
        {
          $match: {
            parentAccountId: { $in: needsCount.map((a) => a._id) },
            accountStatus: { $ne: 'archived' },
          },
        },
        { $group: { _id: '$parentAccountId', n: { $sum: 1 } } },
      ]);
      for (const row of rows) {
        groupedChildCounts.set(row._id.toString(), row.n);
      }
    }

    return accounts.map((account) => {
      const ancestors = (account.ancestors as ObjectId[]) ?? [];
      const isSelf = account._id.equals(userObjectId);

      let relationship: AccountRelationship;
      let callerMembership: IAccountMember | null = null;
      let callerMembershipSource: 'direct' | 'inherited' | null = null;

      if (isSelf) {
        relationship = 'self';
      } else {
        const resolved = resolveEffectiveMembership(directRows, account._id, ancestors);
        relationship = resolved?.row.role === 'owner' ? 'owner' : 'member';
        if (resolved) {
          callerMembership = resolved.row;
          callerMembershipSource = resolved.source;
        }
      }

      const idStr = account._id.toString();
      const childCount = inSetChildCounts.has(idStr)
        ? (inSetChildCounts.get(idStr) ?? 0)
        : (groupedChildCounts.get(idStr) ?? 0);

      return {
        accountId: idStr,
        kind: (account.kind as AccountKind) ?? 'personal',
        parentAccountId: account.parentAccountId ? account.parentAccountId.toString() : null,
        rootAccountId: (account.rootAccountId ?? account._id).toString(),
        account,
        relationship,
        callerMembership,
        callerMembershipSource,
        childCount,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Members CRUD
  // -------------------------------------------------------------------------

  /** Direct (non-removed) membership rows on an account. */
  async listMembers(accountId: string): Promise<IAccountMember[]> {
    return AccountMember.find({
      accountId: new mongoose.Types.ObjectId(accountId),
      status: { $ne: 'removed' },
    }).sort({ createdAt: 1 });
  }

  /**
   * Add (or re-activate) a direct membership on an account. `owner` is not
   * assignable here — ownership is granted only via {@link transferOwnership}.
   */
  async addMember(
    accountId: string,
    callerUserId: string,
    targetUserId: string,
    role: Exclude<AccountRole, 'owner'>,
    inherit = true
  ): Promise<IAccountMember> {
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const targetObjectId = new mongoose.Types.ObjectId(targetUserId);

    const existing = await AccountMember.findOne({
      accountId: accountObjectId,
      memberUserId: targetObjectId,
    });
    if (existing && existing.status === 'active') {
      throw new BadRequestError('User is already a member of this account');
    }

    const permissions = permissionsForAccountRole(role);
    const callerObjectId = new mongoose.Types.ObjectId(callerUserId);

    let member: IAccountMember;
    if (existing) {
      existing.role = role;
      existing.permissions = permissions;
      existing.inherit = inherit;
      existing.status = 'active';
      existing.invitedByUserId = callerObjectId;
      existing.joinedAt = new Date();
      member = await existing.save();
    } else {
      member = await AccountMember.create({
        accountId: accountObjectId,
        memberUserId: targetObjectId,
        role,
        permissions,
        inherit,
        status: 'active',
        invitedByUserId: callerObjectId,
        joinedAt: new Date(),
      });
    }

    logger.info('Account member added', {
      accountId,
      memberId: member._id.toString(),
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
  ): Promise<IAccountMember> {
    const member = await this.requireDirectMember(accountId, memberId);
    if (member.role === 'owner') {
      throw new ForbiddenError("An owner's role can only be changed via transfer-ownership");
    }
    member.role = role;
    member.permissions = permissionsForAccountRole(role);
    if (inherit !== undefined) {
      member.inherit = inherit;
    }
    await member.save();

    logger.info('Account member role updated', { accountId, memberId, role });
    return member;
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
    const member = await this.requireDirectMember(accountId, memberId);

    if (member.role === 'owner') {
      if (!callerIsOwner) {
        throw new ForbiddenError('Only an owner may remove another owner');
      }
      const ownerCount = await AccountMember.countDocuments({
        accountId: new mongoose.Types.ObjectId(accountId),
        role: 'owner',
        status: 'active',
      });
      if (ownerCount <= 1) {
        throw new BadRequestError('Cannot remove the last owner of an account');
      }
    }

    member.status = 'removed';
    await member.save();

    logger.info('Account member removed', { accountId, memberId });
  }

  /**
   * Transfer ownership to another active member. The target is promoted to
   * `owner`; the caller's direct `owner` row (if any) is demoted to `admin`. A
   * personal account cannot be transferred.
   */
  async transferOwnership(
    accountId: string,
    callerUserId: string,
    targetUserId: string
  ): Promise<void> {
    const account = await User.findById(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (account.kind === 'personal') {
      throw new BadRequestError('A personal account cannot be transferred');
    }

    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const targetMember = await AccountMember.findOne({
      accountId: accountObjectId,
      memberUserId: new mongoose.Types.ObjectId(targetUserId),
      status: 'active',
    });
    if (!targetMember) {
      throw new NotFoundError('Target user is not an active member of this account');
    }

    if (targetMember.memberUserId.toString() === callerUserId) {
      throw new BadRequestError('You already own this account');
    }

    targetMember.role = 'owner';
    targetMember.permissions = permissionsForAccountRole('owner');
    await targetMember.save();

    const callerMember = await AccountMember.findOne({
      accountId: accountObjectId,
      memberUserId: new mongoose.Types.ObjectId(callerUserId),
      status: 'active',
    });
    if (callerMember && callerMember.role === 'owner') {
      callerMember.role = 'admin';
      callerMember.permissions = permissionsForAccountRole('admin');
      await callerMember.save();
    }

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
  async listCredentials(accountId: string): Promise<IAccountCredential[]> {
    return AccountCredential.find({
      accountId: new mongoose.Types.ObjectId(accountId),
    })
      .select('-secretHash')
      .sort({ createdAt: -1 });
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
      environment: IAccountCredential['environment'];
      scopes?: ApplicationScope[];
    }
  ): Promise<{ credential: IAccountCredential; secret: string }> {
    const account = await User.findById(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (account.kind !== 'bot') {
      throw new BadRequestError('Service credentials are only available to bot accounts');
    }

    const { publicKey, secret, secretHash } = this.generateCredentialMaterial();
    const credential = await AccountCredential.create({
      accountId: account._id,
      name: input.name,
      publicKey,
      secretHash,
      type: 'service',
      environment: input.environment,
      scopes: input.scopes ?? [],
      status: 'active',
      createdByUserId: new mongoose.Types.ObjectId(callerUserId),
    });

    logger.info('Account credential created', {
      accountId,
      credentialId: credential._id.toString(),
      by: callerUserId,
    });

    return { credential, secret };
  }

  /**
   * Rotate a credential — zero-downtime. Mints a replacement (fresh keys) then
   * deprecates the previous one with a 7-day grace `expiresAt`.
   */
  async rotateCredential(
    accountId: string,
    credentialId: string,
    callerUserId: string
  ): Promise<{
    credential: IAccountCredential;
    secret: string;
    rotatedFrom: string;
    graceExpiresAt: Date;
  }> {
    const previous = await AccountCredential.findOne({
      _id: new mongoose.Types.ObjectId(credentialId),
      accountId: new mongoose.Types.ObjectId(accountId),
      status: { $ne: 'revoked' },
    });
    if (!previous) {
      throw new NotFoundError('Credential not found');
    }

    const { publicKey, secret, secretHash } = this.generateCredentialMaterial();

    const rotated = await AccountCredential.create({
      accountId: previous.accountId,
      name: previous.name,
      publicKey,
      secretHash,
      type: previous.type,
      environment: previous.environment,
      scopes: previous.scopes,
      status: 'active',
      rotatedFromCredentialId: previous._id,
      createdByUserId: new mongoose.Types.ObjectId(callerUserId),
    });

    const graceExpiresAt = new Date(Date.now() + CREDENTIAL_ROTATION_GRACE_MS);
    previous.status = 'deprecated';
    previous.expiresAt = graceExpiresAt;
    await previous.save();

    logger.info('Account credential rotated', {
      accountId,
      previousCredentialId: previous._id.toString(),
      newCredentialId: rotated._id.toString(),
      by: callerUserId,
    });

    return {
      credential: rotated,
      secret,
      rotatedFrom: previous._id.toString(),
      graceExpiresAt,
    };
  }

  /** Revoke a credential — it can no longer authenticate (no grace). */
  async revokeCredential(accountId: string, credentialId: string): Promise<void> {
    const credential = await AccountCredential.findOne({
      _id: new mongoose.Types.ObjectId(credentialId),
      accountId: new mongoose.Types.ObjectId(accountId),
    });
    if (!credential) {
      throw new NotFoundError('Credential not found');
    }
    credential.status = 'revoked';
    await credential.save();

    logger.info('Account credential revoked', { accountId, credentialId });
  }

  /**
   * Resolve a usable (active or within-grace) service credential by its public
   * key. Shared predicate with the Application credential resolution sites.
   */
  async resolveUsableCredential(publicKey: string): Promise<IAccountCredential | null> {
    const credential = await AccountCredential.findOne({ publicKey });
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
  ): Promise<IAccountMember> {
    const member = await AccountMember.findOne({
      _id: new mongoose.Types.ObjectId(memberId),
      accountId: new mongoose.Types.ObjectId(accountId),
      status: { $ne: 'removed' },
    });
    if (!member) {
      throw new NotFoundError('Member not found');
    }
    return member;
  }

  /**
   * Resolve a unique username, suffixing a numeric counter on collision (org and
   * bot accounts share the `User.username` unique index with humans). Validates
   * the username character policy.
   */
  private async resolveUniqueUsername(requested: string, excludeId?: ObjectId): Promise<string> {
    const base = requested.trim().toLowerCase();
    if (!base) {
      throw new BadRequestError('Username is required');
    }
    if (!/^[\w.-]+$/.test(base)) {
      throw new BadRequestError(
        'Username may only contain letters, numbers, underscores, hyphens, and dots'
      );
    }

    let candidate = base;
    for (let suffix = 1; suffix <= 1000; suffix++) {
      const query: Record<string, unknown> = { username: candidate };
      if (excludeId) {
        query._id = { $ne: excludeId };
      }
      const taken = await User.findOne(query);
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

export const accountService = new AccountService();
export default accountService;

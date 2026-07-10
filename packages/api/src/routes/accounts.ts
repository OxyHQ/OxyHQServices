import express from 'express';
import type { Request } from 'express';
import mongoose from 'mongoose';
import type { OrganizationCategory } from '@oxyhq/contracts';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { isStaffUser } from '../middleware/requireStaff';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/error';
import { accountService, type AccountNode, type EffectiveAccess } from '../services/account.service';
import { User, IUser } from '../models/User';
import { IAccountMember } from '../models/AccountMember';
import { IAccountCredential } from '../models/AccountCredential';
import sessionService from '../services/session.service';
import deviceSessionService from '../services/deviceSession.service';
import { broadcastDeviceState } from '../utils/socket';
import { decodeToken, extractTokenFromRequest } from '../middleware/authUtils';
import { logger } from '../utils/logger';
import type { SessionAuthResponse } from '../types/session';
import { resolveUserByIdentifier } from '../utils/resolveUserIdentifier';
import { isPrivilegedScope, type ApplicationScope } from '../utils/applicationScopes';
import { stripSensitiveUrlQueryParams } from '../utils/sanitizeUrl';
import { formatUserResponse } from '../utils/userTransform';
import type { AccountPermission, AccountRole } from '../utils/accountRoles';
import {
  accountIdRouteParams,
  accountMemberParams,
  accountCredentialParams,
  listAccountsQuerySchema,
  createAccountSchema,
  updateAccountSchema,
  moveAccountSchema,
  inviteAccountMemberSchema,
  updateAccountMemberSchema,
  transferAccountOwnershipSchema,
  createAccountCredentialSchema,
} from '../schemas/account.schemas';

/**
 * Request decorated by `loadAccountContext` / `requireAccountPermission` with
 * the resolved account (a User doc) and the caller's effective access over it.
 */
interface AccountContextRequest extends AuthRequest {
  account?: IUser;
  access?: EffectiveAccess;
}

const router = express.Router();

// All account routes require an authenticated user.
router.use(authMiddleware);

/** Resolve the authenticated user id, or throw 401. */
function requireUserId(req: AuthRequest): string {
  const userId = req.user?._id?.toString();
  if (!userId) {
    throw new UnauthorizedError('Authentication required');
  }
  return userId;
}

/**
 * Resolve the caller's central deviceId from their verified bearer (the access
 * token embeds a `deviceId` claim). Returns null when the token is absent or
 * undecodable. Mirrors `resolveCallerDeviceId` in sessionDevice.ts.
 */
function resolveCallerDeviceId(req: AuthRequest): string | null {
  const token = extractTokenFromRequest(req);
  const decoded = token ? decodeToken(token) : null;
  return decoded?.deviceId ?? null;
}

/** Per-user (or per-IP when anonymous) rate-limit key for a scope. */
function userScopedKey(scope: string) {
  return (req: Request): string => {
    const userId = (req as AuthRequest).user?._id?.toString();
    return userId ? `${scope}:${userId}` : `${scope}:ip:${req.ip ?? 'unknown'}`;
  };
}

const readLimiter = rateLimit({
  prefix: 'rl:accounts:read:',
  windowMs: 60 * 1000,
  max: 240,
  message: 'Too many account requests. Please slow down.',
  keyGenerator: userScopedKey('accounts:read'),
});

const writeLimiter = rateLimit({
  prefix: 'rl:accounts:write:',
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many account changes. Please slow down.',
  keyGenerator: userScopedKey('accounts:write'),
});

const membersLimiter = rateLimit({
  prefix: 'rl:accounts:members:',
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many membership changes. Please slow down.',
  keyGenerator: userScopedKey('accounts:members'),
});

const credentialsLimiter = rateLimit({
  prefix: 'rl:accounts:credentials:',
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many credential operations. Please slow down.',
  keyGenerator: userScopedKey('accounts:credentials'),
});

/** Serialise an account (a User doc) for client responses. */
/**
 * Serialise a membership row for client responses. `source` is the contextual
 * resolution origin — `'direct'` for a real row on the account (the default for
 * the members list), `'inherited'` when surfaced as a node's `callerMembership`
 * resolved from an ancestor.
 */
function serializeMember(member: IAccountMember, source: 'direct' | 'inherited' = 'direct') {
  return {
    _id: member._id.toString(),
    accountId: member.accountId.toString(),
    memberUserId: member.memberUserId.toString(),
    role: member.role,
    permissions: member.permissions,
    inherit: member.inherit,
    status: member.status,
    source,
    invitedByUserId: member.invitedByUserId?.toString(),
    joinedAt: member.joinedAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

/**
 * Serialise an `AccountNode` for client responses: the canonical public user DTO
 * nested under `account` (carries `name.displayName`), plus relationship +
 * `callerMembership` (a full member row, or null for `self`) + childCount.
 */
function serializeAccountNode(node: AccountNode) {
  return {
    accountId: node.accountId,
    kind: node.kind,
    parentAccountId: node.parentAccountId,
    account: formatUserResponse(node.account),
    relationship: node.relationship,
    callerMembership: node.callerMembership
      ? serializeMember(node.callerMembership, node.callerMembershipSource ?? 'direct')
      : null,
    childCount: node.childCount,
  };
}

/**
 * Build an `AccountNode` for a single loaded account from the caller's resolved
 * effective access (used by the single-account endpoints).
 */
function accountNodeFromAccess(
  account: IUser,
  access: EffectiveAccess,
  childCount: number
): AccountNode {
  const relationship: AccountNode['relationship'] =
    access.source === 'self' ? 'self' : access.role === 'owner' ? 'owner' : 'member';
  return {
    accountId: account._id.toString(),
    kind: (account.kind as AccountNode['kind']) ?? 'personal',
    parentAccountId: account.parentAccountId ? account.parentAccountId.toString() : null,
    rootAccountId: (account.rootAccountId ?? account._id).toString(),
    account,
    relationship,
    callerMembership: access.membership,
    callerMembershipSource: access.source === 'self' ? null : access.source,
    childCount,
  };
}

/** Count an account's non-archived direct children. */
async function countChildren(accountId: mongoose.Types.ObjectId): Promise<number> {
  return User.countDocuments({ parentAccountId: accountId, accountStatus: { $ne: 'archived' } });
}

/** Serialise a credential — NEVER includes secret material. */
function serializeCredential(credential: IAccountCredential) {
  return {
    _id: credential._id.toString(),
    accountId: credential.accountId.toString(),
    name: credential.name,
    publicKey: credential.publicKey,
    type: credential.type,
    environment: credential.environment,
    scopes: credential.scopes,
    status: credential.status,
    lastUsedAt: credential.lastUsedAt,
    expiresAt: credential.expiresAt,
    rotatedFromCredentialId: credential.rotatedFromCredentialId
      ? credential.rotatedFromCredentialId.toString()
      : undefined,
    createdByUserId: credential.createdByUserId.toString(),
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

/**
 * Serialise a freshly created/rotated credential WITH its one-time secret merged
 * in directly (no wrapper). `extra` carries rotation metadata.
 */
function serializeCredentialWithSecret(
  credential: IAccountCredential,
  secret: string,
  extra?: Record<string, unknown>
) {
  return { ...serializeCredential(credential), secret, ...(extra ?? {}) };
}

/**
 * Resolve the account (non-archived) for `:id` and the caller's effective
 * access over it. 404 when missing/archived, 403 when the caller has no access.
 */
async function loadAccountContext(req: AccountContextRequest): Promise<{
  account: IUser;
  access: EffectiveAccess;
}> {
  const userId = requireUserId(req);
  const id = req.params.id;

  if (!mongoose.isValidObjectId(id)) {
    throw new NotFoundError('Account not found');
  }

  const account = await User.findById(id);
  if (!account || account.accountStatus === 'archived') {
    throw new NotFoundError('Account not found');
  }

  const access = await accountService.effectiveAccessForAccount(userId, account);
  if (!access) {
    throw new ForbiddenError('You do not have access to this account');
  }

  req.account = account;
  req.access = access;
  return { account, access };
}

/**
 * RBAC middleware factory. Resolves the account + caller's effective access for
 * `:id`, then enforces that the access carries `permission`.
 */
function requireAccountPermission(permission: AccountPermission) {
  return asyncHandler(async (req: AccountContextRequest, _res, next) => {
    const { access } = await loadAccountContext(req);
    if (!access.permissions.includes(permission)) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
    next();
  });
}

// ============================================================================
// Accounts — forest + CRUD
// ============================================================================

/**
 * The caller's accessible account forest: their own personal account plus every
 * account they can reach (direct membership + inherited subtree). Flat by
 * default; `?tree=true` nests children under parents.
 */
router.get(
  '/',
  readLimiter,
  validate({ query: listAccountsQuerySchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);
    const nodes = await accountService.listAccessibleAccounts(userId);
    const serialized = nodes.map(serializeAccountNode);

    if (req.query.tree === 'true') {
      res.json({ accounts: buildForest(nodes, serialized) });
      return;
    }
    res.json({ accounts: serialized });
  })
);

/**
 * Switch INTO a managed/org account — a TRUE account switch (the whole app
 * becomes that account), NOT a per-request delegation. Mints a REAL session
 * whose `user` IS the target account, exactly like switching device accounts.
 *
 * The caller (operator) must hold `account:act_as` over the target. The minted
 * session records the operator (`operatedByUserId`) for audit and binds its
 * validity to that membership — revoking it kills the session (re-checked on
 * validate + refresh).
 *
 * The minted managed session is registered into the operator's device set
 * server-side (`deviceSessionService.addAccount`, broadcast to the device room)
 * so it survives reload and syncs across the device's apps via the socket.
 *
 * Returns the SAME shape as login / claimSession (`SessionAuthResponse`) so the
 * client plants it as the active session.
 */
router.post(
  '/:id/switch',
  writeLimiter,
  validate({ params: accountIdRouteParams }),
  asyncHandler(async (req: AuthRequest, res) => {
    const operatorId = requireUserId(req);
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      throw new NotFoundError('Account not found');
    }

    // Authorize: the operator must hold account:act_as over the target (directly
    // or inherited). Non-members / insufficient role → 403. This is the ONLY gate
    // — the session token then carries identity; no per-request header is trusted.
    const role = await accountService.verifyActingAs(operatorId, id);
    if (!role) {
      throw new ForbiddenError('You are not authorized to switch into this account');
    }

    const account = await User.findById(id);
    if (!account || account.accountStatus === 'archived') {
      throw new NotFoundError('Account not found');
    }
    // Only managed accounts are switch targets. Personal accounts are human
    // logins and must never be assumed via a switch (that would be impersonation).
    if (!account.kind || account.kind === 'personal') {
      throw new ForbiddenError('Cannot switch into a personal account');
    }

    // Mint a REAL session for the managed account, recording the operator so the
    // session's validity stays bound to their act_as membership.
    //
    // Inherit the OPERATOR's central deviceId so the org session joins the SAME
    // device doc as the operator's own session. Without this the switch mints a
    // fresh deviceId (UA/IP-derived), the org lands in a device doc the browser
    // never restores from on reload (it restores via the operator's personal
    // session), and the switch silently reverts. If the caller's bearer has no
    // decodable deviceId, keep today's behavior (let createSession allocate one).
    const callerDeviceId = resolveCallerDeviceId(req);
    if (!callerDeviceId) {
      logger.warn('[accounts] switch: no deviceId on operator bearer — org session gets a fresh device', {
        component: 'accounts',
        method: 'switch',
        operatorId,
        targetAccountId: id,
      });
    }
    const session = await sessionService.createSession(account._id.toString(), req, {
      operatedByUserId: operatorId,
      ...(callerDeviceId ? { deviceId: callerDeviceId } : {}),
    });

    // Register the managed session into the operator's device set server-side so
    // it survives reload and syncs cross-domain via the socket room — a switch is
    // a deliberate activation, so `activate: 'always'`. This replaces the client
    // establishing the slot separately. Best-effort: never fail the switch on a
    // device-set write. Only when the operator's device is known.
    if (callerDeviceId) {
      try {
        const { state, changed } = await deviceSessionService.addAccount(
          session.deviceId,
          {
            accountId: account._id.toString(),
            sessionId: session.sessionId,
            operatedByUserId: operatorId,
          },
          { activate: 'always' },
        );
        if (changed) broadcastDeviceState(state);
      } catch (error) {
        logger.warn('[accounts] switch: device-set registration failed', {
          component: 'accounts',
          method: 'switch',
          operatorId,
          targetAccountId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const userData = formatUserResponse(account);
    if (!userData) {
      throw new Error('Failed to format account data');
    }

    // No cookie is planted here — the device-set registration above
    // (`deviceSessionService.addAccount` + `broadcastDeviceState`) is what makes
    // the switch survive reload and sync cross-domain via the socket room. The
    // SDK plants the returned `accessToken` directly; there is no separate
    // cookie-establishing round trip.

    // Mirror the canonical login / claimSession response shape.
    const response: SessionAuthResponse = {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      expiresAt: session.expiresAt.toISOString(),
      accessToken: session.accessToken,
      user: {
        id: userData.id,
        username: userData.username,
        avatar: userData.avatar,
      },
    };

    res.status(200).json(response);
  })
);

/**
 * Create an account. `parentAccountId` defaults to the caller's own personal
 * account when omitted (a top-level org/project/bot they own). The caller must
 * hold `children:create` over the parent.
 */
router.post(
  '/',
  writeLimiter,
  validate({ body: createAccountSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);
    const body = req.body as {
      parentAccountId?: string;
      kind: 'organization' | 'project' | 'bot';
      username: string;
      name?: { first?: string; last?: string };
      bio?: string;
      avatar?: string;
      description?: string;
      organizationCategory?: OrganizationCategory;
    };

    const parentAccountId = body.parentAccountId ?? userId;
    if (!mongoose.isValidObjectId(parentAccountId)) {
      throw new BadRequestError('Invalid parentAccountId');
    }

    // The caller must be allowed to create children on the chosen parent.
    const access = await accountService.resolveEffectiveAccess(userId, parentAccountId);
    if (!access) {
      throw new ForbiddenError('You do not have access to the parent account');
    }
    if (!access.permissions.includes('children:create')) {
      throw new ForbiddenError('Missing required permission: children:create');
    }

    const { account, membership } = await accountService.createChildAccount(parentAccountId, userId, {
      kind: body.kind,
      username: body.username,
      name: body.name,
      bio: body.bio,
      avatar: body.avatar ? stripSensitiveUrlQueryParams(body.avatar) : body.avatar,
      description: body.description,
      organizationCategory: body.organizationCategory,
    });

    const node: AccountNode = {
      accountId: account._id.toString(),
      kind: (account.kind as AccountNode['kind']) ?? body.kind,
      parentAccountId: account.parentAccountId ? account.parentAccountId.toString() : null,
      rootAccountId: (account.rootAccountId ?? account._id).toString(),
      account,
      relationship: 'owner',
      callerMembership: membership,
      callerMembershipSource: 'direct',
      childCount: 0,
    };
    res.status(201).json({ account: serializeAccountNode(node) });
  })
);

/** Get a single account the caller can read. */
router.get(
  '/:id',
  readLimiter,
  validate({ params: accountIdRouteParams }),
  requireAccountPermission('account:read'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    const access = req.access;
    if (!account || !access) {
      throw new NotFoundError('Account not found');
    }
    const childCount = await countChildren(account._id);
    res.json({ account: serializeAccountNode(accountNodeFromAccess(account, access, childCount)) });
  })
);

/** Partially update an account (`account:update`). */
router.patch(
  '/:id',
  writeLimiter,
  validate({ params: accountIdRouteParams, body: updateAccountSchema }),
  requireAccountPermission('account:update'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const body = req.body as {
      username?: string;
      name?: { first?: string; last?: string };
      bio?: string;
      avatar?: string;
      description?: string;
      color?: string;
      links?: string[];
      organizationCategory?: OrganizationCategory | null;
    };

    const updated = await accountService.updateAccount(account._id.toString(), {
      ...body,
      avatar: body.avatar !== undefined ? stripSensitiveUrlQueryParams(body.avatar) : undefined,
    });

    const access = req.access;
    if (!access) {
      throw new NotFoundError('Account not found');
    }
    const childCount = await countChildren(updated._id);
    res.json({ account: serializeAccountNode(accountNodeFromAccess(updated, access, childCount)) });
  })
);

/** Archive an account (`account:delete`). Never hard-deletes. */
router.delete(
  '/:id',
  writeLimiter,
  validate({ params: accountIdRouteParams }),
  requireAccountPermission('account:delete'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    await accountService.archiveAccount(account._id.toString());
    res.json({ success: true });
  })
);

// ============================================================================
// Tree
// ============================================================================

/** Immediate children of an account (`children:read`). */
router.get(
  '/:id/children',
  readLimiter,
  validate({ params: accountIdRouteParams }),
  requireAccountPermission('children:read'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const children = await accountService.listChildren(requireUserId(req), account._id.toString());
    res.json({ accounts: children.map(serializeAccountNode) });
  })
);

/** The full subtree rooted at an account (`children:read`), including itself. */
router.get(
  '/:id/tree',
  readLimiter,
  validate({ params: accountIdRouteParams }),
  requireAccountPermission('children:read'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const subtree = await accountService.getSubtree(requireUserId(req), account._id.toString());
    res.json({ accounts: subtree.map(serializeAccountNode) });
  })
);

/**
 * Re-parent an account (`children:update` on the account being moved). The
 * caller must ALSO hold `children:create` on the destination parent.
 */
router.post(
  '/:id/move',
  writeLimiter,
  validate({ params: accountIdRouteParams, body: moveAccountSchema }),
  requireAccountPermission('children:update'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const { newParentId } = req.body as { newParentId: string };
    if (!mongoose.isValidObjectId(newParentId)) {
      throw new BadRequestError('Invalid newParentId');
    }

    const userId = requireUserId(req);
    const destAccess = await accountService.resolveEffectiveAccess(userId, newParentId);
    if (!destAccess || !destAccess.permissions.includes('children:create')) {
      throw new ForbiddenError('Missing permission to add children to the destination account');
    }

    const moved = await accountService.moveAccount(account._id.toString(), newParentId);
    const access = req.access;
    if (!access) {
      throw new NotFoundError('Account not found');
    }
    const childCount = await countChildren(moved._id);
    res.json({ account: serializeAccountNode(accountNodeFromAccess(moved, access, childCount)) });
  })
);

// ============================================================================
// Members
// ============================================================================

/** List direct members of an account (`members:read`). */
router.get(
  '/:id/members',
  membersLimiter,
  validate({ params: accountIdRouteParams }),
  requireAccountPermission('members:read'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const members = await accountService.listMembers(account._id.toString());
    res.json({ members: members.map((member) => serializeMember(member)) });
  })
);

/** Add a member by username/email (`members:invite`). */
router.post(
  '/:id/members',
  membersLimiter,
  validate({ params: accountIdRouteParams, body: inviteAccountMemberSchema }),
  requireAccountPermission('members:invite'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const { usernameOrEmail, role, inherit } = req.body as {
      usernameOrEmail: string;
      role: Exclude<AccountRole, 'owner'>;
      inherit?: boolean;
    };

    const targetUser = await resolveUserByIdentifier(usernameOrEmail);
    if (!targetUser) {
      throw new NotFoundError('User not found');
    }

    const member = await accountService.addMember(
      account._id.toString(),
      requireUserId(req),
      targetUser._id.toString(),
      role,
      inherit
    );

    res.status(201).json({ member: serializeMember(member) });
  })
);

/** Change a member's role/inheritance (`members:update`). */
router.patch(
  '/:id/members/:memberId',
  membersLimiter,
  validate({ params: accountMemberParams, body: updateAccountMemberSchema }),
  requireAccountPermission('members:update'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (!mongoose.isValidObjectId(req.params.memberId)) {
      throw new NotFoundError('Member not found');
    }
    const { role, inherit } = req.body as {
      role: Exclude<AccountRole, 'owner'>;
      inherit?: boolean;
    };

    const member = await accountService.updateMemberRole(
      account._id.toString(),
      req.params.memberId,
      role,
      inherit
    );
    res.json({ member: serializeMember(member) });
  })
);

/** Remove a member (`members:remove`). Last owner cannot be removed. */
router.delete(
  '/:id/members/:memberId',
  membersLimiter,
  validate({ params: accountMemberParams }),
  requireAccountPermission('members:remove'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    const access = req.access;
    if (!account || !access) {
      throw new NotFoundError('Account not found');
    }
    if (!mongoose.isValidObjectId(req.params.memberId)) {
      throw new NotFoundError('Member not found');
    }

    await accountService.removeMember(
      account._id.toString(),
      req.params.memberId,
      access.role === 'owner'
    );
    res.json({ success: true });
  })
);

/** Transfer ownership to another active member (`ownership:transfer`). */
router.post(
  '/:id/transfer-ownership',
  membersLimiter,
  validate({ params: accountIdRouteParams, body: transferAccountOwnershipSchema }),
  requireAccountPermission('ownership:transfer'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const { userId: targetUserId } = req.body as { userId: string };
    if (!mongoose.isValidObjectId(targetUserId)) {
      throw new BadRequestError('Invalid userId');
    }

    await accountService.transferOwnership(account._id.toString(), requireUserId(req), targetUserId);
    res.json({ success: true });
  })
);

// ============================================================================
// Credentials (bot accounts)
// ============================================================================

/** List an account's service credentials (`credentials:read`). */
router.get(
  '/:id/credentials',
  credentialsLimiter,
  validate({ params: accountIdRouteParams }),
  requireAccountPermission('credentials:read'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const credentials = await accountService.listCredentials(account._id.toString());
    res.json({ credentials: credentials.map(serializeCredential) });
  })
);

/**
 * Create a service credential for a bot account (`credentials:create`). The
 * plaintext secret is returned EXACTLY ONCE. Privileged scopes are staff-gated.
 */
router.post(
  '/:id/credentials',
  credentialsLimiter,
  validate({ params: accountIdRouteParams, body: createAccountCredentialSchema }),
  requireAccountPermission('credentials:create'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const body = req.body as {
      name: string;
      environment: IAccountCredential['environment'];
      scopes?: ApplicationScope[];
    };

    // Privileged scopes (e.g. federation:write) confer act-on-behalf authority
    // and are NOT self-grantable — only platform staff may mint a credential
    // carrying one.
    const requestedScopes = body.scopes ?? [];
    if (!isStaffUser(req)) {
      const privileged = requestedScopes.filter((scope) => isPrivilegedScope(scope));
      if (privileged.length > 0) {
        throw new ForbiddenError(
          `Granting the scope(s) [${privileged.join(', ')}] requires Oxy platform staff privileges`
        );
      }
    }

    const { credential, secret } = await accountService.createCredential(
      account._id.toString(),
      requireUserId(req),
      { name: body.name, environment: body.environment, scopes: requestedScopes }
    );

    // The credential-with-secret object is returned DIRECTLY (no wrapper).
    res.status(201).json(serializeCredentialWithSecret(credential, secret));
  })
);

/** Rotate a credential — zero-downtime (`credentials:rotate`). */
router.post(
  '/:id/credentials/:credId/rotate',
  credentialsLimiter,
  validate({ params: accountCredentialParams }),
  requireAccountPermission('credentials:rotate'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (!mongoose.isValidObjectId(req.params.credId)) {
      throw new NotFoundError('Credential not found');
    }

    const result = await accountService.rotateCredential(
      account._id.toString(),
      req.params.credId,
      requireUserId(req)
    );

    // The rotated credential-with-secret object is returned DIRECTLY (no wrapper).
    res.json(
      serializeCredentialWithSecret(result.credential, result.secret, {
        rotatedFrom: result.rotatedFrom,
        graceExpiresAt: result.graceExpiresAt,
      })
    );
  })
);

/** Revoke a credential (`credentials:revoke`). */
router.delete(
  '/:id/credentials/:credId',
  credentialsLimiter,
  validate({ params: accountCredentialParams }),
  requireAccountPermission('credentials:revoke'),
  asyncHandler(async (req: AccountContextRequest, res) => {
    const account = req.account;
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    if (!mongoose.isValidObjectId(req.params.credId)) {
      throw new NotFoundError('Credential not found');
    }
    await accountService.revokeCredential(account._id.toString(), req.params.credId);
    res.json({ success: true });
  })
);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Nest a flat accessible-account list into a forest. Each node gains a
 * `children` array; nodes whose parent is not in the accessible set become
 * roots of the returned forest. Used only for `GET /accounts?tree=true`.
 */
function buildForest(
  nodes: AccountNode[],
  serialized: ReturnType<typeof serializeAccountNode>[]
): (ReturnType<typeof serializeAccountNode> & { children: unknown[] })[] {
  const byId = new Map<string, ReturnType<typeof serializeAccountNode> & { children: unknown[] }>();
  for (const item of serialized) {
    byId.set(item.accountId, { ...item, children: [] });
  }

  const roots: (ReturnType<typeof serializeAccountNode> & { children: unknown[] })[] = [];
  for (const node of nodes) {
    const item = byId.get(node.accountId);
    if (!item) continue;
    const parent = node.parentAccountId ? byId.get(node.parentAccountId) : undefined;
    if (parent) {
      parent.children.push(item);
    } else {
      roots.push(item);
    }
  }
  return roots;
}

export default router;

import express, { type Request, type Response } from 'express';
import type { Model, Document } from 'mongoose';
import User from "../models/User";
import Block from "../models/Block";
import Restricted from "../models/Restricted";
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } from '../utils/error';
import { resolveUserIdToObjectId } from '../utils/validation';
import userCache from '../utils/userCache';
import blockCache from '../utils/blockCache';
import graphCache from '../utils/graphCache';
import { z } from "zod";
import { validate } from '../middleware/validate';
import { privacyUserIdParams, targetIdParams } from '../schemas/privacy.schemas';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
  };
}

const router = express.Router();
router.use(authMiddleware);

const privacySettingsSchema = z.object({
  isPrivateAccount: z.boolean().optional(),
  hideOnlineStatus: z.boolean().optional(),
  hideLastSeen: z.boolean().optional(),
  profileVisibility: z.boolean().optional(),
  loginAlerts: z.boolean().optional(),
  blockScreenshots: z.boolean().optional(),
      login: z.boolean().optional(),
  biometricLogin: z.boolean().optional(),
  showActivity: z.boolean().optional(),
  allowTagging: z.boolean().optional(),
  allowMentions: z.boolean().optional(),
  hideReadReceipts: z.boolean().optional(),
  allowDirectMessages: z.boolean().optional(),
  dataSharing: z.boolean().optional(),
  locationSharing: z.boolean().optional(),
  analyticsSharing: z.boolean().optional(),
  sensitiveContent: z.boolean().optional(),
  autoFilter: z.boolean().optional(),
  muteKeywords: z.boolean().optional(),
  discoverableByEmail: z.boolean().optional(),
  discoverableByPhone: z.boolean().optional(),
});

// Get privacy settings (own settings only)
const getPrivacySettings = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const authUser = (req as AuthenticatedRequest).user;

  if (!authUser?.id) {
    throw new UnauthorizedError('Authentication required');
  }

  const objectId = await resolveUserIdToObjectId(id);
  const authUserObjectId = await resolveUserIdToObjectId(authUser.id);

  if (authUserObjectId !== objectId) {
    throw new BadRequestError('Not authorized to view these settings');
  }

  const user = await User.findById(objectId).select('privacySettings').lean();
  if (!user) {
    throw new NotFoundError('User not found');
  }
  res.json(user.privacySettings);
});

// Update privacy settings
const updatePrivacySettings = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const settings = privacySettingsSchema.parse(req.body);
  const authUser = (req as AuthenticatedRequest).user;

  if (!authUser?.id) {
    throw new UnauthorizedError('Authentication required');
  }

  const objectId = await resolveUserIdToObjectId(id);
  const authUserObjectId = await resolveUserIdToObjectId(authUser.id);

  if (authUserObjectId !== objectId) {
    throw new BadRequestError('Not authorized to update these settings');
  }

  const setOps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    setOps[`privacySettings.${key}`] = value;
  }

  const user = await User.findByIdAndUpdate(
    objectId,
    Object.keys(setOps).length > 0 ? { $set: setOps } : {},
    { new: true }
  ).select('privacySettings');

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Bust the in-memory user cache so the next getUserBySession serves the
  // fresh privacy settings instead of the stale snapshot. Without this the
  // client refetch on mutation success silently reverts the toggle.
  userCache.invalidate(objectId);

  res.json(user.privacySettings);
});

// Generic handler factory for user management operations
const createUserListHandler = <T extends Document>(
  UserModel: Model<T>,
  fieldName: 'blockedId' | 'restrictedId'
) => {
  return asyncHandler(async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const users = await UserModel.find({ userId: authUser?.id })
      .populate(fieldName, 'username avatar')
      .lean();
    res.json(users);
  });
};

const createUserActionHandler = <T extends Document>(
  UserModel: Model<T>,
  fieldName: 'blockedId' | 'restrictedId',
  actionName: string
) => {
  return asyncHandler(async (req: Request, res: Response) => {
    const { targetId } = req.params;
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser?.id || authUser.id === targetId) {
      throw new BadRequestError(`Invalid ${actionName} request`);
    }

    const existing = await UserModel.findOne({
      userId: authUser.id,
      [fieldName]: targetId
    });

    if (existing) {
      throw new ConflictError(`User already ${actionName === 'block' ? 'blocked' : 'restricted'}`);
    }

    const record = new UserModel({
      userId: authUser.id,
      [fieldName]: targetId
    });
    await record.save();

    // The media-access block check (mediaPrivacyService.isUserBlocked) caches
    // the block relationship in `blockCache` (60s TTL) keyed by (ownerId,
    // viewerId). A block is symmetric and can be cached under EITHER direction
    // depending on which side owns the media being viewed, so bust both keys —
    // otherwise a just-blocked user keeps seeing the blocker's media until the
    // TTL lapses.
    if (fieldName === 'blockedId') {
      blockCache.invalidate(authUser.id, targetId);
      blockCache.invalidate(targetId, authUser.id);

      // The block changed the blocker's cached `blockedIds`; invalidate both
      // sides' viewer graph (symmetric, like the blockCache busts above) so the
      // next `GET /users/me/graph` recomputes fresh truth.
      await Promise.all([
        graphCache.invalidate(authUser.id),
        graphCache.invalidate(targetId),
      ]);
    }

    res.json({ message: `User ${actionName === 'block' ? 'blocked' : 'restricted'} successfully` });
  });
};

const createUserRemoveHandler = <T extends Document>(
  UserModel: Model<T>,
  fieldName: 'blockedId' | 'restrictedId',
  actionName: string
) => {
  return asyncHandler(async (req: Request, res: Response) => {
    const { targetId } = req.params;
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser?.id) {
      throw new UnauthorizedError("Authentication required");
    }

    const result = await UserModel.deleteOne({
      userId: authUser.id,
      [fieldName]: targetId
    });

    if (result.deletedCount === 0) {
      throw new NotFoundError(`${actionName === 'unblock' ? 'Block' : 'Restriction'} not found`);
    }

    // Symmetric to blockUser: drop both cached directions so the unblocked user
    // regains access to the formerly-blocking user's media immediately instead
    // of waiting out the blockCache TTL.
    if (fieldName === 'blockedId') {
      blockCache.invalidate(authUser.id, targetId);
      blockCache.invalidate(targetId, authUser.id);

      // Symmetric to blockUser: the unblock changed the blocker's cached
      // `blockedIds`, so invalidate both sides' viewer graph.
      await Promise.all([
        graphCache.invalidate(authUser.id),
        graphCache.invalidate(targetId),
      ]);
    }

    res.json({ message: `User ${actionName === 'unblock' ? 'unblocked' : 'unrestricted'} successfully` });
  });
};

// Blocked users handlers
const getBlockedUsers = createUserListHandler(Block, 'blockedId');
const blockUser = createUserActionHandler(Block, 'blockedId', 'block');
const unblockUser = createUserRemoveHandler(Block, 'blockedId', 'unblock');

// Restricted users handlers
const getRestrictedUsers = createUserListHandler(Restricted, 'restrictedId');
const restrictUser = createUserActionHandler(Restricted, 'restrictedId', 'restrict');
const unrestrictUser = createUserRemoveHandler(Restricted, 'restrictedId', 'unrestrict');

/**
 * @openapi
 * /privacy/{id}/privacy:
 *   get:
 *     tags:
 *       - Privacy
 *     summary: Get a user's privacy settings
 *     description: >
 *       Return the full privacy settings record for the user. Some fields
 *       are only visible to the owner; non-owner callers see a redacted
 *       projection.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Privacy settings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *             examples:
 *               default:
 *                 value:
 *                   profileVisibility: public
 *                   showActivity: true
 *                   allowDirectMessages: contacts-only
 *                   discoverableByEmail: false
 *                   discoverableByPhone: false
 *       401:
 *         description: Missing or invalid bearer token.
 *       404:
 *         description: User not found.
 */
router.get("/:id/privacy", validate({ params: privacyUserIdParams }), getPrivacySettings);

/**
 * @openapi
 * /privacy/{id}/privacy:
 *   patch:
 *     tags:
 *       - Privacy
 *     summary: Update a user's privacy settings (owner only)
 *     description: >
 *       Partial update of the user's privacy settings. Only the owner of
 *       the account may patch their settings — other callers get 403.
 *       Invalidates the in-memory user cache so subsequent reads return
 *       fresh values.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *           examples:
 *             tighten:
 *               summary: Make profile private and disable email discovery
 *               value:
 *                 profileVisibility: private
 *                 discoverableByEmail: false
 *     responses:
 *       200:
 *         description: Updated privacy settings.
 *       400:
 *         description: Validation failed.
 *       401:
 *         description: Missing or invalid bearer token.
 *       403:
 *         description: Caller is not the owner.
 */
router.patch("/:id/privacy", validate({ params: privacyUserIdParams }), updatePrivacySettings);

/**
 * @openapi
 * /privacy/blocked:
 *   get:
 *     tags:
 *       - Privacy
 *     summary: List blocked users
 *     description: Return the users the authenticated caller has blocked.
 *     responses:
 *       200:
 *         description: List of blocked users.
 */
router.get("/blocked", getBlockedUsers);

/**
 * @openapi
 * /privacy/blocked/{targetId}:
 *   post:
 *     tags:
 *       - Privacy
 *     summary: Block a user
 *     description: >
 *       Block `targetId` for the authenticated caller. Blocking is
 *       symmetric — neither account can see the other's posts, profile, or
 *       reach the other in DMs.
 *     parameters:
 *       - name: targetId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User blocked.
 */
router.post("/blocked/:targetId", validate({ params: targetIdParams }), blockUser);

/**
 * @openapi
 * /privacy/blocked/{targetId}:
 *   delete:
 *     tags:
 *       - Privacy
 *     summary: Unblock a user
 *     parameters:
 *       - name: targetId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User unblocked.
 */
router.delete("/blocked/:targetId", validate({ params: targetIdParams }), unblockUser);

/**
 * @openapi
 * /privacy/restricted:
 *   get:
 *     tags:
 *       - Privacy
 *     summary: List restricted users
 *     description: Return the users the authenticated caller has restricted.
 *     responses:
 *       200:
 *         description: List of restricted users.
 */
router.get("/restricted", getRestrictedUsers);

/**
 * @openapi
 * /privacy/restricted/{targetId}:
 *   post:
 *     tags:
 *       - Privacy
 *     summary: Restrict a user
 *     description: >
 *       Restrict `targetId` — they can still see public content but their
 *       replies and DMs are silently filtered out of the caller's view.
 *     parameters:
 *       - name: targetId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User restricted.
 */
router.post("/restricted/:targetId", validate({ params: targetIdParams }), restrictUser);

/**
 * @openapi
 * /privacy/restricted/{targetId}:
 *   delete:
 *     tags:
 *       - Privacy
 *     summary: Unrestrict a user
 *     parameters:
 *       - name: targetId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User unrestricted.
 */
router.delete("/restricted/:targetId", validate({ params: targetIdParams }), unrestrictUser);

export default router;

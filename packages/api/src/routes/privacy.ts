import express, { Request, Response } from 'express';
import { Model, Document } from 'mongoose';
import User from "../models/User";
import Block from "../models/Block";
import Restricted from "../models/Restricted";
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } from '../utils/error';
import { resolveUserIdToObjectId } from '../utils/validation';
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

  const user = await User.findByIdAndUpdate(
    objectId,
    { $set: { privacySettings: settings } },
    { new: true }
  ).select('privacySettings');

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.json(user.privacySettings);
});

// Generic handler factory for user management operations
const createUserListHandler = (
  UserModel: Model<Document>,
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

const createUserActionHandler = (
  UserModel: Model<Document>,
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

    res.json({ message: `User ${actionName === 'block' ? 'blocked' : 'restricted'} successfully` });
  });
};

const createUserRemoveHandler = (
  UserModel: Model<Document>,
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

router.get("/:id/privacy", validate({ params: privacyUserIdParams }), getPrivacySettings);
router.patch("/:id/privacy", validate({ params: privacyUserIdParams }), updatePrivacySettings);
router.get("/blocked", getBlockedUsers);
router.post("/blocked/:targetId", validate({ params: targetIdParams }), blockUser);
router.delete("/blocked/:targetId", validate({ params: targetIdParams }), unblockUser);
router.get("/restricted", getRestrictedUsers);
router.post("/restricted/:targetId", validate({ params: targetIdParams }), restrictUser);
router.delete("/restricted/:targetId", validate({ params: targetIdParams }), unrestrictUser);

export default router;

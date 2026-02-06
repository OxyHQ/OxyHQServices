import express, { Request, Response } from 'express';
import User from "../models/User";
import Block from "../models/Block";
import Restricted from "../models/Restricted";
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } from '../utils/error';
import { resolveUserIdToObjectId } from '../utils/validation';
import { z } from "zod";

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
const createUserListHandler = <T extends typeof Block | typeof Restricted>(
  Model: T,
  fieldName: 'blockedId' | 'restrictedId'
) => {
  return asyncHandler(async (req: Request, res: Response) => {
    const authUser = (req as AuthenticatedRequest).user;
    const users = await (Model as any).find({ userId: authUser?.id })
      .populate(fieldName, 'username avatar')
      .lean();
    res.json(users);
  });
};

const createUserActionHandler = <T extends typeof Block | typeof Restricted>(
  Model: T,
  fieldName: 'blockedId' | 'restrictedId',
  actionName: string
) => {
  return asyncHandler(async (req: Request, res: Response) => {
    const { targetId } = req.params;
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser?.id || authUser.id === targetId) {
      throw new BadRequestError(`Invalid ${actionName} request`);
    }

    const existing = await (Model as any).findOne({
      userId: authUser.id,
      [fieldName]: targetId
    });

    if (existing) {
      throw new ConflictError(`User already ${actionName === 'block' ? 'blocked' : 'restricted'}`);
    }

    const record = new (Model as any)({
      userId: authUser.id,
      [fieldName]: targetId
    });
    await record.save();

    res.json({ message: `User ${actionName === 'block' ? 'blocked' : 'restricted'} successfully` });
  });
};

const createUserRemoveHandler = <T extends typeof Block | typeof Restricted>(
  Model: T,
  fieldName: 'blockedId' | 'restrictedId',
  actionName: string
) => {
  return asyncHandler(async (req: Request, res: Response) => {
    const { targetId } = req.params;
    const authUser = (req as AuthenticatedRequest).user;

    if (!authUser?.id) {
      throw new UnauthorizedError("Authentication required");
    }

    const result = await (Model as any).deleteOne({
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

router.get("/:id/privacy", getPrivacySettings);
router.patch("/:id/privacy", updatePrivacySettings);
router.get("/blocked", getBlockedUsers);
router.post("/blocked/:targetId", blockUser);
router.delete("/blocked/:targetId", unblockUser);
router.get("/restricted", getRestrictedUsers);
router.post("/restricted/:targetId", restrictUser);
router.delete("/restricted/:targetId", unrestrictUser);

export default router;

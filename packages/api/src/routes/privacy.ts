import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import User from "../models/User";
import Block from "../models/Block";
import Restricted from "../models/Restricted";
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, ConflictError, UnauthorizedError } from '../utils/error';
import { z } from "zod";
import { logger } from '../utils/logger';

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

// Get privacy settings
const getPrivacySettings = async (req: AuthRequest, res: Response) => {
  try {
    // Use authenticated user's MongoDB ObjectId from req.user._id
    // Never trust req.params.id as it may be a public key
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    const userId = req.user._id;
    const user = await User.findById(userId).select('privacySettings');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user.privacySettings);
  } catch (error) {
    logger.error('Error fetching privacy settings:', error);
    res.status(500).json({ 
      message: "Error fetching privacy settings",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

// Update privacy settings
const updatePrivacySettings = async (req: AuthRequest, res: Response) => {
  try {
    // Use authenticated user's MongoDB ObjectId from req.user._id
    // Never trust req.params.id as it may be a public key
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    const userId = req.user._id;
    const settings = privacySettingsSchema.parse(req.body);

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { privacySettings: settings } },
      { new: true }
    ).select('privacySettings');

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user.privacySettings);
  } catch (error) {
    logger.error('Error updating privacy settings:', error);
    res.status(500).json({ 
      message: "Error updating privacy settings",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

// Generic handler factory for user management operations
const createUserListHandler = <T extends typeof Block | typeof Restricted>(
  Model: T,
  fieldName: 'blockedId' | 'restrictedId'
) => {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user || !req.user._id) {
      throw new UnauthorizedError("Authentication required");
    }
    const userId = req.user._id.toString();
    const users = await (Model as any).find({ userId })
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
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    const { targetId } = req.params;
    if (!req.user || !req.user._id) {
      throw new UnauthorizedError("Authentication required");
    }
    
    const userId = req.user._id.toString();
    if (userId === targetId) {
      throw new BadRequestError(`Invalid ${actionName} request`);
    }

    const existing = await (Model as any).findOne({
      userId,
      [fieldName]: targetId
    });

    if (existing) {
      throw new ConflictError(`User already ${actionName === 'block' ? 'blocked' : 'restricted'}`);
    }

    const record = new (Model as any)({
      userId,
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
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    const { targetId } = req.params;
    if (!req.user || !req.user._id) {
      throw new UnauthorizedError("Authentication required");
    }
    
    const userId = req.user._id.toString();
    const result = await (Model as any).deleteOne({
      userId,
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

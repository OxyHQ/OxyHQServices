import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import Subscription from "../models/Subscription";
import BillingSubscription from "../models/BillingSubscription";
import User from "../models/User";
import { logger } from '../utils/logger';
import { ForbiddenError, UnauthorizedError } from '../utils/error';
import userCache from '../utils/userCache';
import { formatSubscriptionResponse } from '../utils/subscriptionResponse';

function assertOwnership(req: AuthRequest, userId: string): void {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }
  if (req.user._id.toString() !== userId) {
    throw new ForbiddenError('You do not have permission to access this subscription');
  }
}

export const getSubscription = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    assertOwnership(req, userId);
    const [billingSubscription, legacySubscription] = await Promise.all([
      BillingSubscription.findOne({
        userId,
        status: { $in: ['active', 'trialing'] },
      }).lean(),
      Subscription.findOne({ userId }),
    ]);
    res.json(formatSubscriptionResponse(billingSubscription, legacySubscription));
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error fetching subscription:', error);
    res.status(500).json({
      message: "Error fetching subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const cancelSubscription = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    assertOwnership(req, userId);
    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      { status: "canceled" },
      { new: true }
    );

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    await User.findByIdAndUpdate(userId, {
      $set: { 'privacySettings.analyticsSharing': false },
    });
    userCache.invalidate(userId);

    res.json(subscription);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error canceling subscription:', error);
    res.status(500).json({
      message: "Error canceling subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
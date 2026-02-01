import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Subscription from "../models/Subscription";
import User from "../models/User";
import { logger } from '../utils/logger';
import { ForbiddenError, UnauthorizedError } from '../utils/error';

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
    const subscription = await Subscription.findOne({ userId });
    res.json(subscription || { plan: "basic" });
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

export const updateSubscription = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    assertOwnership(req, userId);
    const { plan } = req.body;

    let features = {
      analytics: false,
      premiumBadge: false,
      unlimitedFollowing: false,
      higherUploadLimits: false,
      promotedPosts: false,
      businessTools: false,
    };

    // Set features based on plan
    if (plan === "pro" || plan === "business") {
      features = {
        ...features,
        analytics: true,
        premiumBadge: true,
        unlimitedFollowing: true,
        higherUploadLimits: true,
      };
    }

    if (plan === "business") {
      features = {
        ...features,
        promotedPosts: true,
        businessTools: true,
      };
    }

    // Calculate end date (30 days from now)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      {
        plan,
        status: "active",
        startDate: new Date(),
        endDate,
        features,
      },
      { upsert: true, new: true }
    );

    // Update user analytics sharing based on subscription
    await User.findByIdAndUpdate(
      userId,
      { 
        $set: { 
          "privacySettings.analyticsSharing": features.analytics
        }
      }
    );

    res.json(subscription);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error updating subscription:', error);
    res.status(500).json({
      message: "Error updating subscription",
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
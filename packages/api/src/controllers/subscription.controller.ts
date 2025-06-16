import { Request, Response } from "express";
import Subscription from "../models/Subscription";
import User from "../models/User";
import { logger } from '../utils/logger';

export const getSubscription = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const subscription = await Subscription.findOne({ userId });
    res.json(subscription || { plan: "basic" });
  } catch (error) {
    logger.error('Error fetching subscription:', error);
    res.status(500).json({ 
      message: "Error fetching subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const updateSubscription = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
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
    logger.error('Error updating subscription:', error);
    res.status(500).json({ 
      message: "Error updating subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const cancelSubscription = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
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
    logger.error('Error canceling subscription:', error);
    res.status(500).json({ 
      message: "Error canceling subscription",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
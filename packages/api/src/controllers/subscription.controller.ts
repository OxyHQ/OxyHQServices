import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import Subscription from '../models/Subscription';
import BillingSubscription from '../models/BillingSubscription';
import User from '../models/User';
import { logger } from '../utils/logger';
import { ForbiddenError, UnauthorizedError } from '../utils/error';
import userCache from '../utils/userCache';
import { formatSubscriptionResponse } from '../utils/subscriptionResponse';
import { inForceSubscriptionFilter } from '../utils/subscriptionStatus';
import { findCurrentSubscription } from '../services/subscriptionLifecycle.service';
import { getStripe } from '../utils/stripeClient';

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
      // Lapsed rows are retained as history now that nothing deletes them, so
      // the current standing has to be picked deliberately rather than by
      // whichever row `findOne` happens to return.
      findCurrentSubscription(userId),
    ]);
    res.json(formatSubscriptionResponse(billingSubscription, legacySubscription));
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error fetching subscription:', error);
    res.status(500).json({
      message: 'Error fetching subscription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const cancelSubscription = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    assertOwnership(req, userId);

    const billingSubscription = await BillingSubscription.findOne({
      userId,
      status: { $in: ['active', 'trialing'] },
    });

    if (billingSubscription) {
      await getStripe().subscriptions.update(billingSubscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      billingSubscription.cancelAtPeriodEnd = true;
      await billingSubscription.save();
    }

    // Only a subscription that is still in force can be cancelled — an already
    // lapsed row is history, and flipping it to `canceled` would rewrite why it
    // ended.
    const legacySubscription = await Subscription.findOneAndUpdate(
      { userId, ...inForceSubscriptionFilter() },
      { status: 'canceled' },
      { new: true, sort: { endDate: -1 } },
    );

    if (!billingSubscription && !legacySubscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    await User.findByIdAndUpdate(userId, {
      $set: { 'privacySettings.analyticsSharing': false },
    });
    userCache.invalidate(userId);

    res.json(
      formatSubscriptionResponse(
        billingSubscription,
        legacySubscription,
      ),
    );
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) {
      throw error;
    }
    logger.error('Error canceling subscription:', error);
    res.status(500).json({
      message: 'Error canceling subscription',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

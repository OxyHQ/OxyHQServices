import type { Response } from 'express';
import mongoose from 'mongoose';
import { File } from '../models/File';
import Subscription from '../models/Subscription';
import type { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

type StorageCategory = 'documents' | 'photosVideos' | 'recordings' | 'other';

const GB = 1024 * 1024 * 1024;
const TB = 1024 * 1024 * 1024 * 1024;

const getPlanStorageLimitBytes = (plan: string | undefined): number => {
  switch (plan) {
    case 'pro':
      return 2 * TB;
    case 'business':
      return 5 * TB;
    case 'basic':
    default:
      return 15 * GB;
  }
};

export const getStorageUsage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?._id?.toString() || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Subscription is keyed by ObjectId; tolerate non-ObjectId (shouldn’t happen, but keep it safe)
    let subscriptionPlan: 'basic' | 'pro' | 'business' | undefined;
    try {
      const subscription = await Subscription.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
      subscriptionPlan = (subscription?.plan as any) || 'basic';
    } catch {
      subscriptionPlan = 'basic';
    }

    const totalLimitBytes = getPlanStorageLimitBytes(subscriptionPlan);

    const results = await File.aggregate<{
      _id: StorageCategory;
      bytes: number;
      count: number;
    }>([
      { $match: { ownerUserId: userId, status: 'active' } },
      {
        $project: {
          mime: 1,
          totalSize: {
            $add: [
              '$size',
              {
                $ifNull: [{ $sum: '$variants.size' }, 0],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          category: {
            $switch: {
              branches: [
                {
                  case: { $regexMatch: { input: '$mime', regex: /^(image|video)\// } },
                  then: 'photosVideos',
                },
                {
                  case: { $regexMatch: { input: '$mime', regex: /^audio\// } },
                  then: 'recordings',
                },
                {
                  case: { $regexMatch: { input: '$mime', regex: /^(text|application)\// } },
                  then: 'documents',
                },
              ],
              default: 'other',
            },
          },
        },
      },
      {
        $group: {
          _id: '$category',
          bytes: { $sum: '$totalSize' },
          count: { $sum: 1 },
        },
      },
    ]);

    const breakdown: Record<StorageCategory, { bytes: number; count: number }> = {
      documents: { bytes: 0, count: 0 },
      photosVideos: { bytes: 0, count: 0 },
      recordings: { bytes: 0, count: 0 },
      other: { bytes: 0, count: 0 },
    };

    for (const row of results) {
      breakdown[row._id] = { bytes: row.bytes ?? 0, count: row.count ?? 0 };
    }

    const totalUsedBytes =
      breakdown.documents.bytes +
      breakdown.photosVideos.bytes +
      breakdown.recordings.bytes +
      breakdown.other.bytes;

    return res.json({
      plan: subscriptionPlan,
      totalUsedBytes,
      totalLimitBytes,
      // Keep names close to UI categories; mail/family not implemented yet.
      categories: {
        documents: breakdown.documents,
        mail: { bytes: 0, count: 0 },
        photosVideos: breakdown.photosVideos,
        recordings: breakdown.recordings,
        family: { bytes: 0, count: 0 },
        other: breakdown.other,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error computing storage usage', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({
      message: 'Error computing storage usage',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};






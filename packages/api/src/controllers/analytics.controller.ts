import { Request, Response } from "express";
import Analytics from "../models/Analytics";
import User from "../models/User";
import { getDateRange } from "./utils/dateUtils";
import { logger } from '../utils/logger';

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const { userID, period = "weekly" } = req.query;
    const { startDate, endDate } = getDateRange(period as string);

    const analytics = await Analytics.find({
      userID,
      period,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });

    // Get growth metrics from User model
    const userStats = await User.findById(userID).select('_count');
    
    res.json({
      timeSeriesData: analytics,
      growth: userStats?._count || {}
    });
  } catch (error) {
    logger.error('Error fetching analytics:', error);
    res.status(500).json({ 
      message: "Error fetching analytics",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const updateAnalytics = async (req: Request, res: Response) => {
  try {
    const { userID, type, data } = req.body;
    const date = new Date();
    
    // Update or create analytics record for each period
    const periods = ["daily", "weekly", "monthly", "yearly"];
    
    await Promise.all(periods.map(async (period) => {
      const update = {
        $inc: {
          [`stats.${type}`]: 1,
          ...data
        }
      };
      
      await Analytics.findOneAndUpdate(
        { userID, period, date },
        update,
        { upsert: true, new: true }
      );
    }));

    res.json({ message: "Analytics updated successfully" });
  } catch (error) {
    logger.error('Error updating analytics:', error);
    res.status(500).json({ 
      message: "Error updating analytics",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const getContentViewers = async (req: Request, res: Response) => {
  try {
    const { userID, period = "weekly" } = req.query;
    const { startDate, endDate } = getDateRange(period as string);
    
    const viewers = await Analytics.aggregate([
      { 
        $match: { 
          userID,
          date: { $gte: startDate, $lte: endDate },
          "stats.viewers": { $exists: true }
        }
      },
      { $unwind: "$stats.viewers" },
      { $group: {
        _id: "$stats.viewers.userID",
        viewCount: { $sum: 1 },
        lastViewed: { $max: "$stats.viewers.timestamp" }
      }},
      { $limit: 100 }
    ]);
    
    res.json(viewers);
  } catch (error) {
    logger.error('Error fetching content viewers:', error);
    res.status(500).json({ 
      message: "Error fetching content viewers",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const getFollowerDetails = async (req: Request, res: Response) => {
  try {
    const { userID, period = "weekly" } = req.query;
    const { startDate, endDate } = getDateRange(period as string);
    
    const followerStats = await User.aggregate([
      { $match: { _id: userID } },
      { $lookup: {
        from: "users",
        localField: "followers",
        foreignField: "_id",
        as: "followerDetails"
      }},
      { $project: {
        totalFollowers: { $size: "$followers" },
        newFollowers: {
          $size: {
            $filter: {
              input: "$followerDetails",
              as: "follower",
              cond: { $gte: ["$$follower.createdAt", startDate] }
            }
          }
        },
        activeFollowers: {
          $size: {
            $filter: {
              input: "$followerDetails",
              as: "follower",
              cond: { $gte: ["$$follower.updatedAt", startDate] }
            }
          }
        }
      }}
    ]);
    
    res.json(followerStats[0] || { totalFollowers: 0, newFollowers: 0, activeFollowers: 0 });
  } catch (error) {
    logger.error('Error fetching follower details:', error);
    res.status(500).json({ 
      message: "Error fetching follower details",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
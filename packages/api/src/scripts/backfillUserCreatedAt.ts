/**
 * Migration Script: Backfill createdAt for User accounts
 *
 * This script adds createdAt timestamps to existing User documents that don't have one.
 * For documents without createdAt, it uses:
 * 1. The MongoDB ObjectId creation timestamp (_id timestamp)
 * 2. Or falls back to updatedAt if available
 * 3. Or uses current time as last resort
 *
 * Usage:
 *   npm run backfill:user-created-at
 *   or: tsx src/scripts/backfillUserCreatedAt.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

async function backfillUserCreatedAt() {
  try {
    // Connect to MongoDB
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    logger.info('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB');

    // Find all users without createdAt
    const usersWithoutCreatedAt = await User.find({
      createdAt: { $exists: false }
    }).select('_id updatedAt');

    logger.info(`Found ${usersWithoutCreatedAt.length} users without createdAt`);

    if (usersWithoutCreatedAt.length === 0) {
      logger.info('No users need to be updated. All users have createdAt.');
      await mongoose.connection.close();
      process.exit(0);
      return;
    }

    let updatedCount = 0;
    let errorCount = 0;

    // Process each user
    for (const user of usersWithoutCreatedAt) {
      try {
        // Extract timestamp from MongoDB ObjectId
        // ObjectId contains a timestamp of when it was created
        const objectIdTimestamp = user._id.getTimestamp();

        // Use ObjectId timestamp, fall back to updatedAt, or use current time
        const createdAt = objectIdTimestamp || user.updatedAt || new Date();

        // Update the user document
        await User.updateOne(
          { _id: user._id },
          { $set: { createdAt } }
        );

        updatedCount++;

        if (updatedCount % 100 === 0) {
          logger.info(`Progress: ${updatedCount}/${usersWithoutCreatedAt.length} users updated`);
        }
      } catch (error) {
        errorCount++;
        logger.error(`Error updating user ${user._id}:`, error);
      }
    }

    logger.info('Migration completed:', {
      total: usersWithoutCreatedAt.length,
      updated: updatedCount,
      errors: errorCount,
    });

    // Verify the migration
    const remainingUsers = await User.countDocuments({
      createdAt: { $exists: false }
    });

    if (remainingUsers > 0) {
      logger.warn(`Warning: ${remainingUsers} users still don't have createdAt`);
    } else {
      logger.info('Success: All users now have createdAt');
    }

    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the migration
backfillUserCreatedAt();

/**
 * Migration Script: Update Avatar Files to Public Visibility
 * 
 * This script finds all files that are used as avatars and updates their visibility to 'public'.
 * Run this once to fix existing avatars that were uploaded before the auto-public feature was added.
 */

import mongoose from 'mongoose';
import { User } from '../models/User';
import { File } from '../models/File';
import { logger } from '../utils/logger';

async function migrateAvatarsToPublic() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/oxy';
    await mongoose.connect(mongoUri);
    logger.info('Connected to MongoDB');

    // Find all users with avatars
    const usersWithAvatars = await User.find({ avatar: { $exists: true, $ne: null } }).select('avatar username');
    logger.info(`Found ${usersWithAvatars.length} users with avatars`);

    let updated = 0;
    let alreadyPublic = 0;
    let notFound = 0;

    for (const user of usersWithAvatars) {
      if (!user.avatar) continue;

      try {
        const file = await File.findById(user.avatar);
        
        if (!file) {
          logger.warn(`Avatar file not found for user ${user.username}:`, user.avatar);
          notFound++;
          continue;
        }

        if (file.visibility === 'public') {
          logger.debug(`Avatar already public for user ${user.username}:`, file._id);
          alreadyPublic++;
          continue;
        }

        // Update to public
        file.visibility = 'public';
        await file.save();
        
        logger.info(`✅ Updated avatar to public for user ${user.username}:`, file._id);
        updated++;
      } catch (err) {
        logger.error(`Error updating avatar for user ${user.username}:`, err);
      }
    }

    logger.info('Migration complete!', {
      total: usersWithAvatars.length,
      updated,
      alreadyPublic,
      notFound,
      failed: usersWithAvatars.length - updated - alreadyPublic - notFound
    });

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  migrateAvatarsToPublic();
}

export { migrateAvatarsToPublic };

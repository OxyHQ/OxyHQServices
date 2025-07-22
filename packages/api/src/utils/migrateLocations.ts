import User from '../models/User';
import { logger } from './logger';

export async function migrateLocationsToMultiple() {
  try {
    logger.info('Starting location migration...');
    
    // Find users with single location but no locations array
    const usersToMigrate = await User.find({
      location: { $exists: true, $ne: '' },
      $or: [
        { locations: { $exists: false } },
        { locations: { $size: 0 } }
      ]
    });
    
    logger.info(`Found ${usersToMigrate.length} users to migrate`);
    
    for (const user of usersToMigrate) {
      if (user.location && user.location.trim()) {
        // Convert single location to locations array
        const locationData = {
          id: `migrated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: user.location,
          label: 'Location',
          type: 'other',
          address: {
            formattedAddress: user.location
          },
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        user.locations = [locationData];
        await user.save();
        
        logger.info(`Migrated location for user ${user.username}: "${user.location}"`);
      }
    }
    
    logger.info('Location migration completed successfully');
  } catch (error) {
    logger.error('Error during location migration:', error);
    throw error;
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateLocationsToMultiple()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
} 
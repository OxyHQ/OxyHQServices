import mongoose from 'mongoose';
import { logger } from './logger';

// Database configuration
const dbConfig = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10, // Maximum number of connections in the pool
  minPoolSize: 2,  // Minimum number of connections in the pool
  serverSelectionTimeoutMS: 5000, // Timeout for server selection
  socketTimeoutMS: 45000, // Timeout for socket operations
  autoIndex: true, // Build indexes
  autoCreate: true, // Create collections if they don't exist
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
};

// Connection state tracking
let isConnected = false;
let connectionAttempts = 0;
const maxConnectionAttempts = 5;

// Performance monitoring
const performanceMetrics = {
  queryCount: 0,
  slowQueries: [] as Array<{ query: string; duration: number; timestamp: Date }>,
  connectionErrors: 0,
  lastQueryTime: new Date(),
};

// Slow query threshold (in milliseconds)
const SLOW_QUERY_THRESHOLD = 100;

// Connect to MongoDB with retry logic
export const connectToDatabase = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    logger.error('MONGODB_URI environment variable is not set');
    process.exit(1);
  }

  try {
    // Set up mongoose connection
    await mongoose.connect(mongoUri, dbConfig);
    
    isConnected = true;
    connectionAttempts = 0;
    logger.info('Connected to MongoDB successfully');
    
    // Set up connection event listeners
    setupConnectionListeners();
    
    // Set up query monitoring
    setupQueryMonitoring();
    
    // Create indexes for better performance
    await createIndexes();
    
  } catch (error) {
    connectionAttempts++;
    logger.error(`MongoDB connection attempt ${connectionAttempts} failed:`, error);
    
    if (connectionAttempts >= maxConnectionAttempts) {
      logger.error('Max connection attempts reached. Exiting...');
      process.exit(1);
    }
    
    // Retry after exponential backoff
    const retryDelay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
    logger.info(`Retrying connection in ${retryDelay}ms...`);
    
    setTimeout(() => {
      connectToDatabase();
    }, retryDelay);
  }
};

// Setup connection event listeners
const setupConnectionListeners = (): void => {
  const db = mongoose.connection;
  
  db.on('connected', () => {
    isConnected = true;
    logger.info('MongoDB connection established');
  });
  
  db.on('error', (error) => {
    isConnected = false;
    performanceMetrics.connectionErrors++;
    logger.error('MongoDB connection error:', error);
  });
  
  db.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB connection disconnected');
  });
  
  db.on('reconnected', () => {
    isConnected = true;
    logger.info('MongoDB connection reestablished');
  });
  
  db.on('close', () => {
    isConnected = false;
    logger.info('MongoDB connection closed');
  });
};

// Setup query monitoring
const setupQueryMonitoring = (): void => {
  mongoose.set('debug', process.env.NODE_ENV === 'development');
  
  // Monitor all queries
  mongoose.connection.on('query', (query) => {
    performanceMetrics.queryCount++;
    performanceMetrics.lastQueryTime = new Date();
    
    // Log slow queries
    if (query.duration > SLOW_QUERY_THRESHOLD) {
      const slowQuery = {
        query: query.sql || query.op,
        duration: query.duration,
        timestamp: new Date(),
      };
      
      performanceMetrics.slowQueries.push(slowQuery);
      
      // Keep only last 100 slow queries
      if (performanceMetrics.slowQueries.length > 100) {
        performanceMetrics.slowQueries.shift();
      }
      
      logger.warn(`Slow query detected: ${slowQuery.query} took ${slowQuery.duration}ms`);
    }
  });
};

// Create indexes for better performance
const createIndexes = async (): Promise<void> => {
  try {
    // User indexes - handle text index conflict gracefully
    try {
      await mongoose.model('User').createIndexes();
    } catch (error: any) {
      if (error.code === 85 && error.codeName === 'IndexOptionsConflict') {
        logger.warn('User text index conflict detected, skipping text index creation');
        // Create other indexes manually, excluding the text index
        const User = mongoose.model('User');
        await User.collection.createIndex({ username: 1, email: 1 }, { background: true });
        await User.collection.createIndex({ 'privacySettings.isPrivateAccount': 1, createdAt: -1 }, { background: true });
        await User.collection.createIndex({ isOnline: 1, lastSeen: -1 }, { background: true });
        await User.collection.createIndex({ followers: 1, createdAt: -1 }, { background: true });
        await User.collection.createIndex({ following: 1, createdAt: -1 }, { background: true });
        await User.collection.createIndex({ bookmarks: 1 }, { background: true });
        await User.collection.createIndex({ labels: 1 }, { background: true });
        await User.collection.createIndex({ lastSeen: 1 }, { background: true });
        await User.collection.createIndex({ isOnline: 1 }, { background: true });
      } else {
        throw error;
      }
    }
    
    // Session indexes
    try {
      await mongoose.model('Session').createIndexes();
    } catch (error: any) {
      if (error.code !== 85) {
        logger.error('Error creating Session indexes:', error);
      }
    }
    
    // Notification indexes
    try {
      await mongoose.model('Notification').createIndexes();
    } catch (error: any) {
      if (error.code !== 85) {
        logger.error('Error creating Notification indexes:', error);
      }
    }
    
    // Transaction indexes
    try {
      await mongoose.model('Transaction').createIndexes();
    } catch (error: any) {
      if (error.code !== 85) {
        logger.error('Error creating Transaction indexes:', error);
      }
    }
    
    // Only create Karma indexes if the model is registered
    try {
      if (mongoose.models.Karma) {
        await mongoose.model('Karma').createIndexes();
      }
    } catch (error: any) {
      if (error.code !== 85) {
        logger.error('Error creating Karma indexes:', error);
      }
    }
    
    logger.info('Database indexes created successfully');
  } catch (error) {
    logger.error('Error creating indexes:', error);
  }
};

// Health check function
export const checkDatabaseHealth = async (): Promise<{
  status: 'healthy' | 'unhealthy';
  isConnected: boolean;
  metrics: typeof performanceMetrics;
}> => {
  try {
    if (!isConnected) {
      return {
        status: 'unhealthy',
        isConnected: false,
        metrics: performanceMetrics,
      };
    }
    
    // Ping the database
    if (mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
    } else {
      throw new Error('Database connection not established');
    }
    
    return {
      status: 'healthy',
      isConnected: true,
      metrics: performanceMetrics,
    };
  } catch (error) {
    logger.error('Database health check failed:', error);
    return {
      status: 'unhealthy',
      isConnected: false,
      metrics: performanceMetrics,
    };
  }
};

// Graceful shutdown
export const closeDatabaseConnection = async (): Promise<void> => {
  try {
    await mongoose.connection.close();
    logger.info('Database connection closed gracefully');
  } catch (error) {
    logger.error('Error closing database connection:', error);
  }
};

// Get database statistics
export const getDatabaseStats = () => {
  return {
    isConnected,
    connectionAttempts,
    performanceMetrics,
    connectionState: mongoose.connection.readyState,
  };
};

// Export connection status
export const getConnectionStatus = (): boolean => isConnected;

// Process termination handlers
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing database connection...');
  await closeDatabaseConnection();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing database connection...');
  await closeDatabaseConnection();
  process.exit(0);
}); 
import { Request, Response, NextFunction } from 'express';
import { performanceMonitor } from '../utils/performanceMonitor';
import { logger } from '../utils/logger';

/**
 * Performance monitoring middleware
 * Tracks API response times and logs slow requests
 */
export const performanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const operation = `${req.method} ${req.path}`;

  // Track response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Record the metric
    performanceMonitor.recordMetric(operation, duration, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    // Log slow requests
    if (duration > 1000) {
      logger.warn(`Slow request: ${operation} took ${duration}ms`, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      });
    }
  });

  next();
};

/**
 * Database query monitoring middleware
 * Wraps mongoose queries to track performance
 */
export const monitorDatabaseQuery = async <T>(
  operation: string,
  queryFn: () => Promise<T>
): Promise<T> => {
  const endTimer = performanceMonitor.startTimer(`db:${operation}`);
  
  try {
    const result = await queryFn();
    endTimer({ success: true });
    return result;
  } catch (error) {
    endTimer({ success: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};

/**
 * Get memory usage statistics
 */
export const getMemoryStats = () => {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // Resident Set Size in MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // Total heap in MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // Used heap in MB
    external: Math.round(usage.external / 1024 / 1024), // External memory in MB
    arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024), // Array buffers in MB
  };
};

/**
 * Get MongoDB connection pool statistics
 */
export const getConnectionPoolStats = (mongooseConnection: any) => {
  if (!mongooseConnection || !mongooseConnection.db) {
    return null;
  }

  return {
    readyState: mongooseConnection.readyState,
    host: mongooseConnection.host,
    name: mongooseConnection.name,
    // Note: MongoDB driver doesn't expose pool stats directly in older versions
    // Connection pool size is configured but not exposed via API
    // Use MongoDB monitoring tools or connection events for detailed stats
  };
};

export default performanceMiddleware;


import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

// Performance metrics storage
interface PerformanceMetrics {
  requestCount: number;
  totalResponseTime: number;
  averageResponseTime: number;
  slowRequests: Array<{
    path: string;
    method: string;
    duration: number;
    timestamp: Date;
    statusCode: number;
  }>;
  errorCount: number;
  statusCodes: Record<number, number>;
  endpoints: Record<string, {
    count: number;
    totalTime: number;
    averageTime: number;
    errors: number;
  }>;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    requestCount: 0,
    totalResponseTime: 0,
    averageResponseTime: 0,
    slowRequests: [],
    errorCount: 0,
    statusCodes: {},
    endpoints: {}
  };

  private slowRequestThreshold = 1000; // 1 second
  private maxSlowRequests = 100;

  // Middleware to track request performance
  trackRequest() {
    return (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      const path = req.route?.path || req.path;
      const method = req.method;

      // Track endpoint
      if (!this.metrics.endpoints[path]) {
        this.metrics.endpoints[path] = {
          count: 0,
          totalTime: 0,
          averageTime: 0,
          errors: 0
        };
      }

      // Override res.end to capture response data
      const originalEnd = res.end;
      res.end = function(chunk?: any, encoding?: any) {
        const duration = Date.now() - start;
        const statusCode = res.statusCode;

        // Update metrics
        this.updateMetrics(path, method, duration, statusCode);

        // Log slow requests
        if (duration > this.slowRequestThreshold) {
          this.logSlowRequest(path, method, duration, statusCode);
        }

        // Call original end method
        originalEnd.call(this, chunk, encoding);
      }.bind(this);

      next();
    };
  }

  private updateMetrics(path: string, method: string, duration: number, statusCode: number) {
    // Update overall metrics
    this.metrics.requestCount++;
    this.metrics.totalResponseTime += duration;
    this.metrics.averageResponseTime = this.metrics.totalResponseTime / this.metrics.requestCount;

    // Update status code counts
    this.metrics.statusCodes[statusCode] = (this.metrics.statusCodes[statusCode] || 0) + 1;

    // Update endpoint metrics
    const endpoint = this.metrics.endpoints[path];
    endpoint.count++;
    endpoint.totalTime += duration;
    endpoint.averageTime = endpoint.totalTime / endpoint.count;

    if (statusCode >= 400) {
      this.metrics.errorCount++;
      endpoint.errors++;
    }
  }

  private logSlowRequest(path: string, method: string, duration: number, statusCode: number) {
    const slowRequest = {
      path,
      method,
      duration,
      timestamp: new Date(),
      statusCode
    };

    this.metrics.slowRequests.push(slowRequest);

    // Keep only the most recent slow requests
    if (this.metrics.slowRequests.length > this.maxSlowRequests) {
      this.metrics.slowRequests.shift();
    }

    logger.warn(`Slow request detected: ${method} ${path} took ${duration}ms (${statusCode})`);
  }

  // Get current performance metrics
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  // Get performance summary
  getSummary() {
    const { requestCount, totalResponseTime, averageResponseTime, errorCount, statusCodes } = this.metrics;
    
    return {
      requestCount,
      totalResponseTime,
      averageResponseTime: Math.round(averageResponseTime * 100) / 100,
      errorRate: requestCount > 0 ? (errorCount / requestCount * 100).toFixed(2) + '%' : '0%',
      statusCodes,
      slowRequestCount: this.metrics.slowRequests.length,
      topEndpoints: this.getTopEndpoints(5)
    };
  }

  // Get top performing endpoints
  getTopEndpoints(limit: number = 10) {
    return Object.entries(this.metrics.endpoints)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, limit)
      .map(([path, metrics]) => ({
        path,
        count: metrics.count,
        averageTime: Math.round(metrics.averageTime * 100) / 100,
        errorRate: metrics.count > 0 ? (metrics.errors / metrics.count * 100).toFixed(2) + '%' : '0%'
      }));
  }

  // Get slowest endpoints
  getSlowestEndpoints(limit: number = 10) {
    return Object.entries(this.metrics.endpoints)
      .filter(([, metrics]) => metrics.count > 0)
      .sort(([, a], [, b]) => b.averageTime - a.averageTime)
      .slice(0, limit)
      .map(([path, metrics]) => ({
        path,
        averageTime: Math.round(metrics.averageTime * 100) / 100,
        count: metrics.count
      }));
  }

  // Reset metrics
  resetMetrics() {
    this.metrics = {
      requestCount: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      slowRequests: [],
      errorCount: 0,
      statusCodes: {},
      endpoints: {}
    };
  }

  // Set slow request threshold
  setSlowRequestThreshold(threshold: number) {
    this.slowRequestThreshold = threshold;
  }

  // Get recent slow requests
  getRecentSlowRequests(limit: number = 20) {
    return this.metrics.slowRequests
      .slice(-limit)
      .reverse()
      .map(request => ({
        ...request,
        timestamp: request.timestamp.toISOString()
      }));
  }
}

// Create singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Performance middleware
export const performanceMiddleware = performanceMonitor.trackRequest();

// Memory usage monitoring
export const getMemoryUsage = () => {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100, // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100, // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
    external: Math.round(usage.external / 1024 / 1024 * 100) / 100, // MB
    arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024 * 100) / 100 // MB
  };
};

// CPU usage monitoring
export const getCPUUsage = () => {
  const usage = process.cpuUsage();
  return {
    user: Math.round(usage.user / 1000), // milliseconds
    system: Math.round(usage.system / 1000) // milliseconds
  };
};

// System health check
export const getSystemHealth = () => {
  return {
    uptime: process.uptime(),
    memory: getMemoryUsage(),
    cpu: getCPUUsage(),
    performance: performanceMonitor.getSummary()
  };
};

// Periodic performance logging
export const startPerformanceLogging = (intervalMs: number = 60000) => {
  setInterval(() => {
    const health = getSystemHealth();
    logger.info('Performance metrics:', health);
  }, intervalMs);
}; 
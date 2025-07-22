import { logger } from './logger';

interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface PerformanceStats {
  operation: string;
  count: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  totalDuration: number;
  lastUpdated: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private stats: Map<string, PerformanceStats> = new Map();
  private maxMetrics: number = 1000;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Start timing an operation
   */
  startTimer(operation: string): () => void {
    const startTime = Date.now();
    
    return (metadata?: Record<string, any>) => {
      const duration = Date.now() - startTime;
      this.recordMetric(operation, duration, metadata);
    };
  }

  /**
   * Record a performance metric
   */
  recordMetric(operation: string, duration: number, metadata?: Record<string, any>): void {
    const metric: PerformanceMetric = {
      operation,
      duration,
      timestamp: Date.now(),
      metadata
    };

    this.metrics.push(metric);
    this.updateStats(operation, duration);

    // Keep only the latest metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log slow operations
    if (duration > 1000) {
      logger.warn(`Slow operation detected: ${operation} took ${duration}ms`, metadata);
    }
  }

  /**
   * Update statistics for an operation
   */
  private updateStats(operation: string, duration: number): void {
    const existing = this.stats.get(operation);
    
    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.avgDuration = existing.totalDuration / existing.count;
      existing.minDuration = Math.min(existing.minDuration, duration);
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      existing.lastUpdated = Date.now();
    } else {
      this.stats.set(operation, {
        operation,
        count: 1,
        avgDuration: duration,
        minDuration: duration,
        maxDuration: duration,
        totalDuration: duration,
        lastUpdated: Date.now()
      });
    }
  }

  /**
   * Get performance statistics
   */
  getStats(): PerformanceStats[] {
    return Array.from(this.stats.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Get statistics for a specific operation
   */
  getOperationStats(operation: string): PerformanceStats | undefined {
    return this.stats.get(operation);
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(limit: number = 50): PerformanceMetric[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Get metrics for a specific operation
   */
  getOperationMetrics(operation: string, limit: number = 50): PerformanceMetric[] {
    return this.metrics
      .filter(m => m.operation === operation)
      .slice(-limit);
  }

  /**
   * Get average duration for an operation
   */
  getAverageDuration(operation: string): number {
    const stats = this.stats.get(operation);
    return stats ? stats.avgDuration : 0;
  }

  /**
   * Check if an operation is performing poorly
   */
  isOperationSlow(operation: string, threshold: number = 1000): boolean {
    const avgDuration = this.getAverageDuration(operation);
    return avgDuration > threshold;
  }

  /**
   * Get slow operations
   */
  getSlowOperations(threshold: number = 1000): PerformanceStats[] {
    return this.getStats().filter(stats => stats.avgDuration > threshold);
  }

  /**
   * Clear old metrics
   */
  private cleanup(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.metrics = this.metrics.filter(m => m.timestamp > oneHourAgo);
    
    // Clean up old stats
    for (const [operation, stats] of this.stats.entries()) {
      if (stats.lastUpdated < oneHourAgo) {
        this.stats.delete(operation);
      }
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30 * 60 * 1000); // Clean up every 30 minutes
  }

  /**
   * Stop the monitor
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all metrics and stats
   */
  clear(): void {
    this.metrics = [];
    this.stats.clear();
    logger.info('Performance monitor cleared');
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    totalMetrics: number;
    totalOperations: number;
    slowOperations: number;
    averageResponseTime: number;
  } {
    const stats = this.getStats();
    const totalOperations = stats.length;
    const slowOperations = this.getSlowOperations().length;
    const averageResponseTime = stats.length > 0 
      ? stats.reduce((sum, stat) => sum + stat.avgDuration, 0) / stats.length 
      : 0;

    return {
      totalMetrics: this.metrics.length,
      totalOperations,
      slowOperations,
      averageResponseTime
    };
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();
export default performanceMonitor; 
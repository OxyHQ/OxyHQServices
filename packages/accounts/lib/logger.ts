/**
 * Logger Utility
 * 
 * Professional logging utility that only logs in development mode
 * and provides structured logging for production debugging.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  data?: unknown;
  timestamp: number;
}

class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private maxLogs = 100;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Log debug information (only in development)
   */
  debug(message: string, context?: string, data?: unknown): void {
    if (__DEV__) {
      console.log(`[DEBUG]${context ? ` [${context}]` : ''} ${message}`, data || '');
    }
    this.addLog('debug', message, context, data);
  }

  /**
   * Log informational messages (only in development)
   */
  info(message: string, context?: string, data?: unknown): void {
    if (__DEV__) {
      console.log(`[INFO]${context ? ` [${context}]` : ''} ${message}`, data || '');
    }
    this.addLog('info', message, context, data);
  }

  /**
   * Log warnings
   */
  warn(message: string, context?: string, data?: unknown): void {
    if (__DEV__) {
      console.warn(`[WARN]${context ? ` [${context}]` : ''} ${message}`, data || '');
    }
    this.addLog('warn', message, context, data);
  }

  /**
   * Log errors (always logged, even in production for crash reporting)
   */
  error(message: string, context?: string, error?: unknown): void {
    // Always log errors for crash reporting
    console.error(`[ERROR]${context ? ` [${context}]` : ''} ${message}`, error || '');
    this.addLog('error', message, context, error);
  }

  /**
   * Add log entry to in-memory buffer
   */
  private addLog(level: LogLevel, message: string, context?: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      message,
      context,
      data,
      timestamp: Date.now(),
    };

    this.logs.push(entry);

    // Keep only the last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Get recent logs (useful for debugging)
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Export logs for debugging or crash reporting
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export convenience methods
export const logDebug = (message: string, context?: string, data?: unknown) => 
  logger.debug(message, context, data);

export const logInfo = (message: string, context?: string, data?: unknown) => 
  logger.info(message, context, data);

export const logWarn = (message: string, context?: string, data?: unknown) => 
  logger.warn(message, context, data);

export const logError = (message: string, context?: string, error?: unknown) => 
  logger.error(message, context, error);

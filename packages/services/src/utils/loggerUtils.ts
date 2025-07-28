/**
 * Centralized logging utilities for consistent logging across the application
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export interface LogContext {
  component?: string;
  method?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  [key: string]: any;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private isDevelopment: boolean = process.env.NODE_ENV === 'development';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` [${Object.entries(context).map(([k, v]) => `${k}:${v}`).join(', ')}]` : '';
    return `[${timestamp}] ${level}${contextStr}: ${message}`;
  }

  debug(message: string, context?: LogContext, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formattedMessage = this.formatMessage('DEBUG', message, context);
      if (this.isDevelopment) {
        console.log(formattedMessage, ...args);
      }
    }
  }

  info(message: string, context?: LogContext, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const formattedMessage = this.formatMessage('INFO', message, context);
      console.log(formattedMessage, ...args);
    }
  }

  warn(message: string, context?: LogContext, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const formattedMessage = this.formatMessage('WARN', message, context);
      console.warn(formattedMessage, ...args);
    }
  }

  error(message: string, error?: any, context?: LogContext, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formattedMessage = this.formatMessage('ERROR', message, context);
      if (error) {
        console.error(formattedMessage, error, ...args);
      } else {
        console.error(formattedMessage, ...args);
      }
    }
  }

  // Specialized logging methods for common patterns
  auth(message: string, context?: LogContext, ...args: any[]): void {
    this.info(`🔐 ${message}`, { ...context, category: 'auth' }, ...args);
  }

  api(message: string, context?: LogContext, ...args: any[]): void {
    this.info(`🌐 ${message}`, { ...context, category: 'api' }, ...args);
  }

  session(message: string, context?: LogContext, ...args: any[]): void {
    this.info(`📱 ${message}`, { ...context, category: 'session' }, ...args);
  }

  user(message: string, context?: LogContext, ...args: any[]): void {
    this.info(`👤 ${message}`, { ...context, category: 'user' }, ...args);
  }

  device(message: string, context?: LogContext, ...args: any[]): void {
    this.info(`📱 ${message}`, { ...context, category: 'device' }, ...args);
  }

  payment(message: string, context?: LogContext, ...args: any[]): void {
    this.info(`💳 ${message}`, { ...context, category: 'payment' }, ...args);
  }

  // Performance logging
  performance(operation: string, duration: number, context?: LogContext): void {
    const level = duration > 1000 ? LogLevel.WARN : LogLevel.INFO;
    const message = `⏱️ ${operation} completed in ${duration}ms`;
    if (level === LogLevel.WARN) {
      this.warn(message, { ...context, category: 'performance', duration });
    } else {
      this.info(message, { ...context, category: 'performance', duration });
    }
  }

  // Error logging with stack trace
  errorWithStack(message: string, error: Error, context?: LogContext): void {
    this.error(message, error, { ...context, stack: error.stack });
  }

  // Group related log messages
  group(label: string, fn: () => void): void {
    if (this.isDevelopment && this.shouldLog(LogLevel.DEBUG)) {
      console.group(label);
      fn();
      console.groupEnd();
    } else {
      fn();
    }
  }
}

// Create singleton instance
export const logger = new Logger();

// Convenience functions for common logging patterns
export const logAuth = (message: string, context?: LogContext, ...args: any[]) => 
  logger.auth(message, context, ...args);

export const logApi = (message: string, context?: LogContext, ...args: any[]) => 
  logger.api(message, context, ...args);

export const logSession = (message: string, context?: LogContext, ...args: any[]) => 
  logger.session(message, context, ...args);

export const logUser = (message: string, context?: LogContext, ...args: any[]) => 
  logger.user(message, context, ...args);

export const logDevice = (message: string, context?: LogContext, ...args: any[]) => 
  logger.device(message, context, ...args);

export const logPayment = (message: string, context?: LogContext, ...args: any[]) => 
  logger.payment(message, context, ...args);

export const logError = (message: string, error?: any, context?: LogContext, ...args: any[]) => 
  logger.error(message, error, context, ...args);

export const logPerformance = (operation: string, duration: number, context?: LogContext) => 
  logger.performance(operation, duration, context); 
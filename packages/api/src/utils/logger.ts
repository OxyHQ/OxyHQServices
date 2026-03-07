import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogContext {
  [key: string]: unknown;
}

class Logger {
  setLevel(level: LogLevel): void {
    const map: Record<LogLevel, string> = {
      [LogLevel.DEBUG]: 'debug',
      [LogLevel.INFO]: 'info',
      [LogLevel.WARN]: 'warn',
      [LogLevel.ERROR]: 'error',
      [LogLevel.NONE]: 'silent',
    };
    pinoLogger.level = map[level] || 'info';
  }

  debug(message: string, context?: LogContext): void {
    context ? pinoLogger.debug(context, message) : pinoLogger.debug(message);
  }

  info(message: string, context?: LogContext): void {
    context ? pinoLogger.info(context, message) : pinoLogger.info(message);
  }

  warn(message: string, context?: LogContext): void {
    context ? pinoLogger.warn(context, message) : pinoLogger.warn(message);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const merged: Record<string, unknown> = { ...context };
    if (error instanceof Error) {
      merged.err = { message: error.message, stack: error.stack, name: error.name };
    } else if (error && typeof error === 'object') {
      Object.assign(merged, error);
    } else if (error !== undefined && error !== null) {
      merged.errorValue = error;
    }
    pinoLogger.error(merged, message);
  }

  errorWithStack(message: string, error: Error, context?: LogContext): void {
    this.error(message, error, context);
  }

  performance(operation: string, duration: number, context?: LogContext): void {
    const msg = `${operation} completed in ${duration}ms`;
    const merged = { ...context, operation, duration };
    duration > 1000 ? pinoLogger.warn(merged, msg) : pinoLogger.info(merged, msg);
  }
}

export const logger = new Logger();

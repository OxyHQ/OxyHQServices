/**
 * Debug Utilities
 *
 * Provides safe logging functions that only output in development mode.
 * All logs are stripped in production builds.
 *
 * @module shared/utils/debugUtils
 */

/* global __DEV__ */
declare const __DEV__: boolean | undefined;

/**
 * Check if running in development mode
 */
export const isDev = (): boolean => {
  return typeof __DEV__ !== 'undefined' && __DEV__;
};

/**
 * Log a debug message (only in development)
 * @param prefix - Log prefix (e.g., '[FedCM]')
 * @param args - Arguments to log
 */
export const debugLog = (prefix: string, ...args: unknown[]): void => {
  if (isDev()) {
    console.log(prefix, ...args);
  }
};

/**
 * Log a debug warning (only in development)
 * @param prefix - Log prefix
 * @param args - Arguments to log
 */
export const debugWarn = (prefix: string, ...args: unknown[]): void => {
  if (isDev()) {
    console.warn(prefix, ...args);
  }
};

/**
 * Log a debug error (only in development)
 * @param prefix - Log prefix
 * @param args - Arguments to log
 */
export const debugError = (prefix: string, ...args: unknown[]): void => {
  if (isDev()) {
    console.error(prefix, ...args);
  }
};

/**
 * Create a namespaced debug logger
 * @param namespace - Logger namespace (e.g., 'FedCM', 'PopupAuth')
 * @returns Object with log, warn, error methods
 *
 * @example
 * ```ts
 * const debug = createDebugLogger('FedCM');
 * debug.log('Starting authentication');
 * debug.warn('Token expires soon');
 * debug.error('Authentication failed', error);
 * ```
 */
export const createDebugLogger = (namespace: string) => {
  const prefix = `[${namespace}]`;
  return {
    log: (...args: unknown[]) => debugLog(prefix, ...args),
    warn: (...args: unknown[]) => debugWarn(prefix, ...args),
    error: (...args: unknown[]) => debugError(prefix, ...args),
  };
};

/* eslint-disable no-console */
// The single logging abstraction for the backend. Swap the implementation
// (pino, etc.) here without touching call sites.
export const logger = {
  info: (message: string, ...args: unknown[]): void => console.log(`[info] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]): void => console.warn(`[warn] ${message}`, ...args),
  error: (message: string, ...args: unknown[]): void => console.error(`[error] ${message}`, ...args),
};

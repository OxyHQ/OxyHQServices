interface LoggerFunction {
  (message: string, ...args: any[]): void;
}

interface Logger {
  info: LoggerFunction;
  warn: LoggerFunction;
  error: LoggerFunction;
  debug: LoggerFunction;
}

const createLogger = (): Logger => {
  return {
    info: (message: string, ...args: any[]) => {
      console.log(`[INFO] ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
      console.warn(`[WARN] ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
      console.error(`[ERROR] ${message}`, ...args);
    },
    debug: (message: string, ...args: any[]) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(`[DEBUG] ${message}`, ...args);
      }
    }
  };
};

export const logger = createLogger();
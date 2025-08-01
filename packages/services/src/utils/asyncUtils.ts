/**
 * Async utilities for common asynchronous patterns and error handling
 */

/**
 * Wrapper for async operations with automatic error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  errorHandler?: (error: any) => void,
  context?: string
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (errorHandler) {
      errorHandler(error);
    } else {
      console.error(`Error in ${context || 'operation'}:`, error);
    }
    return null;
  }
}

/**
 * Execute multiple async operations in parallel with error handling
 */
export async function parallelWithErrorHandling<T>(
  operations: (() => Promise<T>)[],
  errorHandler?: (error: any, index: number) => void
): Promise<(T | null)[]> {
  const results = await Promise.allSettled(
    operations.map((op, index) => 
      withErrorHandling(op, error => errorHandler?.(error, index))
    )
  );
  
  return results.map(result => 
    result.status === 'fulfilled' ? result.value : null
  );
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  shouldRetry?: (error: any) => boolean
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      if (shouldRetry && !shouldRetry(error)) {
        break;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Debounce async function calls
 */
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
  func: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: NodeJS.Timeout;
  const lastPromise: Promise<ReturnType<T>> | null = null;
  
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return new Promise((resolve, reject) => {
      clearTimeout(timeoutId);
      
      timeoutId = setTimeout(async () => {
        try {
          const result = await func(...args);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  };
}

/**
 * Throttle async function calls
 */
export function throttleAsync<T extends (...args: any[]) => Promise<any>>(
  func: T,
  limit: number,
  interval: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let inThrottle = false;
  let lastPromise: Promise<ReturnType<T>> | null = null;
  
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (inThrottle) {
      return lastPromise!;
    }
    
    inThrottle = true;
    lastPromise = func(...args);
    
    setTimeout(() => {
      inThrottle = false;
    }, interval);
    
    return lastPromise;
  };
}

/**
 * Execute async operations sequentially with progress tracking
 */
export async function sequentialWithProgress<T>(
  operations: (() => Promise<T>)[],
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = [];
  
  for (let i = 0; i < operations.length; i++) {
    const result = await operations[i]();
    results.push(result);
    onProgress?.(i + 1, operations.length);
  }
  
  return results;
}

/**
 * Batch async operations
 */
export async function batchAsync<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processor(batch);
  }
}

/**
 * Create a cancellable async operation
 */
export function createCancellableAsync<T>(
  operation: (signal: AbortSignal) => Promise<T>
): { execute: () => Promise<T>; cancel: () => void } {
  let abortController: AbortController | null = null;
  
  return {
    execute: async () => {
      abortController = new AbortController();
      return await operation(abortController.signal);
    },
    cancel: () => {
      abortController?.abort();
    }
  };
}

/**
 * Timeout wrapper for async operations
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  return Promise.race([operation, timeoutPromise]);
}

/**
 * Cache async operation results
 */
export function createAsyncCache<T>(
  ttl: number = 5 * 60 * 1000 // 5 minutes default
) {
  const cache = new Map<string, { data: T; timestamp: number }>();
  
  return {
    get: (key: string): T | null => {
      const item = cache.get(key);
      if (!item) return null;
      
      if (Date.now() - item.timestamp > ttl) {
        cache.delete(key);
        return null;
      }
      
      return item.data;
    },
    
    set: (key: string, data: T): void => {
      cache.set(key, { data, timestamp: Date.now() });
    },
    
    clear: (): void => {
      cache.clear();
    },
    
    delete: (key: string): boolean => {
      return cache.delete(key);
    }
  };
}

/**
 * Execute async operation with loading state
 */
export async function withLoadingState<T>(
  operation: () => Promise<T>,
  setLoading: (loading: boolean) => void
): Promise<T> {
  setLoading(true);
  try {
    return await operation();
  } finally {
    setLoading(false);
  }
}

/**
 * Create a promise that resolves after a delay
 */
export const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Execute async operation with retry on specific errors
 */
export async function retryOnError<T>(
  operation: () => Promise<T>,
  retryableErrors: (string | number)[],
  maxRetries = 3
): Promise<T> {
  return retryAsync(operation, maxRetries, 1000, (error) => {
    const errorCode = error?.code || error?.status || error?.message;
    return retryableErrors.includes(errorCode);
  });
} 
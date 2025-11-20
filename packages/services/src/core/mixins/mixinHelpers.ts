/**
 * Helper utilities for mixin classes
 * Provides common patterns to reduce code duplication
 */

import type { OxyServicesBase } from '../OxyServices.base';

/**
 * Wraps an async method with standard error handling
 * Reduces boilerplate in mixin methods
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  handleError: (error: any) => Error
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw handleError(error);
  }
}

/**
 * Creates a standard API request method with error handling
 * Reduces duplication across mixin methods
 */
export function createApiMethod<T>(
  makeRequest: OxyServicesBase['makeRequest'],
  handleError: OxyServicesBase['handleError'],
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string | ((...args: any[]) => string),
  options: {
    cache?: boolean;
    cacheTTL?: number;
    retry?: boolean;
    transformData?: (data: any) => any;
    transformResponse?: (response: any) => T;
  } = {}
) {
  return async (...args: any[]): Promise<T> => {
    const urlString = typeof url === 'function' ? url(...args) : url;
    const requestData = options.transformData ? options.transformData(args) : args[0];
    
    const requestOptions = {
      cache: options.cache ?? true,
      cacheTTL: options.cacheTTL,
      retry: options.retry ?? true,
    };

    try {
      const response = await makeRequest<T>(method, urlString, requestData, requestOptions);
      return options.transformResponse ? options.transformResponse(response) : response;
    } catch (error) {
      throw handleError(error);
    }
  };
}

/**
 * Cache time constants (in milliseconds)
 */
export const CACHE_TIMES = {
  SHORT: 1 * 60 * 1000,      // 1 minute
  MEDIUM: 2 * 60 * 1000,     // 2 minutes
  LONG: 5 * 60 * 1000,       // 5 minutes
  VERY_LONG: 10 * 60 * 1000, // 10 minutes
  EXTRA_LONG: 30 * 60 * 1000, // 30 minutes
} as const;


/**
 * Service guard utilities to prevent TypeError when accessing service methods
 * Specifically designed to prevent "Cannot read properties of undefined" errors
 */

import type { OxyServices } from '../core/OxyServices';
import { isNotNullOrUndefined, safeCall } from './validationUtils';
import { createApiError, ErrorCodes } from './errorUtils';

/**
 * Safe wrapper for calling searchProfiles method
 * Prevents TypeError when service instance is undefined
 */
export async function safeSearchProfiles(
  oxyServices: OxyServices | null | undefined,
  query: string,
  pagination?: any
): Promise<any[]> {
  if (!isNotNullOrUndefined(oxyServices)) {
    console.warn('safeSearchProfiles: OxyServices instance is not available, returning empty array');
    return [];
  }

  try {
    // Additional validation to ensure the service has the searchProfiles method
    if (typeof oxyServices.searchProfiles !== 'function') {
      console.error('safeSearchProfiles: searchProfiles method is not available on service instance');
      return [];
    }

    return await oxyServices.searchProfiles(query, pagination);
  } catch (error: any) {
    console.error('safeSearchProfiles: Error during search:', error);
    // Return empty array on error to prevent UI crashes
    return [];
  }
}

/**
 * Safe wrapper for any OxyServices method call
 * Generic function to safely call any method on the service
 */
export async function safeServiceCall<T>(
  oxyServices: OxyServices | null | undefined,
  methodName: keyof OxyServices,
  ...args: any[]
): Promise<T | null> {
  if (!isNotNullOrUndefined(oxyServices)) {
    console.warn(`safeServiceCall: OxyServices instance is not available for method ${String(methodName)}`);
    return null;
  }

  try {
    const method = oxyServices[methodName];
    if (typeof method !== 'function') {
      console.error(`safeServiceCall: Method ${String(methodName)} is not available on service instance`);
      return null;
    }

    return await (method as Function).apply(oxyServices, args);
  } catch (error: any) {
    console.error(`safeServiceCall: Error calling ${String(methodName)}:`, error);
    return null;
  }
}

/**
 * Check if OxyServices instance is ready for use
 */
export function isServiceReady(oxyServices: OxyServices | null | undefined): oxyServices is OxyServices {
  if (!isNotNullOrUndefined(oxyServices)) {
    return false;
  }

  // Check if essential methods exist
  const essentialMethods = ['searchProfiles', 'getCurrentUser', 'signIn', 'signUp'];
  return essentialMethods.every(method => 
    typeof (oxyServices as any)[method] === 'function'
  );
}

/**
 * Safe wrapper specifically for handleSearch function pattern
 * This addresses the exact error scenario from the issue
 */
export async function safeHandleSearch(
  oxyServices: OxyServices | null | undefined,
  query: string,
  options: {
    onSuccess?: (results: any[]) => void;
    onError?: (error: any) => void;
    onEmpty?: () => void;
    pagination?: any;
  } = {}
): Promise<void> {
  const { onSuccess, onError, onEmpty, pagination } = options;

  try {
    // Early return if service is not ready
    if (!isServiceReady(oxyServices)) {
      console.warn('safeHandleSearch: Service not ready, aborting search');
      if (onEmpty) onEmpty();
      return;
    }

    // Validate query
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      console.warn('safeHandleSearch: Invalid query provided');
      if (onEmpty) onEmpty();
      return;
    }

    const results = await safeSearchProfiles(oxyServices, query, pagination);
    
    if (results.length === 0) {
      if (onEmpty) onEmpty();
    } else {
      if (onSuccess) onSuccess(results);
    }
  } catch (error: any) {
    console.error('safeHandleSearch: Search operation failed:', error);
    if (onError) onError(error);
  }
}

/**
 * Safe wrapper for loadMoreResults function pattern
 * Addresses pagination scenarios where service might become undefined
 */
export async function safeLoadMoreResults(
  oxyServices: OxyServices | null | undefined,
  currentQuery: string,
  currentPage: number,
  options: {
    onSuccess?: (results: any[], hasMore: boolean) => void;
    onError?: (error: any) => void;
    pageSize?: number;
  } = {}
): Promise<void> {
  const { onSuccess, onError, pageSize = 10 } = options;

  try {
    if (!isServiceReady(oxyServices)) {
      console.warn('safeLoadMoreResults: Service not ready, aborting load more');
      if (onError) onError(new Error('Service not available'));
      return;
    }

    if (!currentQuery || typeof currentQuery !== 'string') {
      console.warn('safeLoadMoreResults: Invalid query provided');
      if (onError) onError(new Error('Invalid query'));
      return;
    }

    const pagination = {
      page: currentPage,
      limit: pageSize,
      offset: (currentPage - 1) * pageSize
    };

    const results = await safeSearchProfiles(oxyServices, currentQuery, pagination);
    const hasMore = results.length === pageSize;

    if (onSuccess) onSuccess(results, hasMore);
  } catch (error: any) {
    console.error('safeLoadMoreResults: Load more operation failed:', error);
    if (onError) onError(error);
  }
}

/**
 * Hook-like function to validate service instance with retry logic
 * Returns a promise that resolves when service is ready or rejects after timeout
 */
export async function waitForServiceReady(
  getServiceInstance: () => OxyServices | null | undefined,
  timeoutMs: number = 5000,
  checkIntervalMs: number = 100
): Promise<OxyServices> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkService = () => {
      const service = getServiceInstance();
      
      if (isServiceReady(service)) {
        resolve(service);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error(`Service did not become ready within ${timeoutMs}ms`));
        return;
      }

      setTimeout(checkService, checkIntervalMs);
    };

    checkService();
  });
}
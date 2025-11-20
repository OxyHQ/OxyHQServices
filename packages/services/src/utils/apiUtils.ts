/**
 * Utility functions for common API patterns
 */

/**
 * Build URL search parameters from an object
 * @param params Object with parameter key-value pairs
 * @returns URLSearchParams instance
 */
export function buildSearchParams(params: Record<string, any>): URLSearchParams {
  const searchParams = new URLSearchParams();
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, value.toString());
    }
  }
  
  return searchParams;
}

/**
 * Build URL with search parameters
 * @param baseUrl Base URL
 * @param params Object with parameter key-value pairs
 * @returns Complete URL with search parameters
 */
export function buildUrl(baseUrl: string, params?: Record<string, any>): string {
  if (!params) return baseUrl;
  
  const searchParams = buildSearchParams(params);
  const queryString = searchParams.toString();
  
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/**
 * Common pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Build pagination search parameters
 * @param params Pagination parameters
 * @returns URLSearchParams with pagination
 */
export function buildPaginationParams(params: PaginationParams): URLSearchParams {
  return buildSearchParams(params);
}

/**
 * Common API response wrapper
 */
export interface ApiResponse<T = any> {
  data: T;
  message?: string;
  success?: boolean;
}

/**
 * Common error response wrapper
 */
export interface ErrorResponse {
  message: string;
  code: string;
  status: number;
  details?: any;
}

/**
 * Safe JSON parsing with error handling
 * @param data Data to parse
 * @param fallback Fallback value if parsing fails
 * @returns Parsed data or fallback
 */
export function safeJsonParse<T>(data: any, fallback: T): T {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return fallback;
    }
  }
  return data as T;
} 
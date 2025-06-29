/**
 * Zero Config Authenticated Fetch Hook
 * 
 * Simple hook that provides fetch-like API with automatic authentication
 * Leverages the existing useOxy hook and OxyProvider infrastructure
 * 
 * Usage:
 *   const authFetch = useAuthFetch();
 *   const response = await authFetch('/api/protected');
 *   const data = await authFetch.get('/api/users');
 */

import { useCallback } from 'react';
import { useOxy } from '../context/OxyContext';

export interface AuthFetchOptions extends Omit<RequestInit, 'body'> {
  body?: any; // Allow any type for body, we'll JSON.stringify if needed
}

export interface AuthFetchAPI {
  // Main fetch function (drop-in replacement)
  (input: RequestInfo | URL, init?: AuthFetchOptions): Promise<Response>;
  
  // Convenience methods for JSON APIs
  get: (endpoint: string, options?: AuthFetchOptions) => Promise<any>;
  post: (endpoint: string, data?: any, options?: AuthFetchOptions) => Promise<any>;
  put: (endpoint: string, data?: any, options?: AuthFetchOptions) => Promise<any>;
  delete: (endpoint: string, options?: AuthFetchOptions) => Promise<any>;
  
  // Access to auth state and methods
  isAuthenticated: boolean;
  user: any;
  login: (username: string, password: string) => Promise<any>;
  logout: () => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<any>;
  
  // API configuration
  setApiUrl: (url: string) => void;
}

/**
 * Hook that provides authenticated fetch functionality
 * Uses the existing OxyServices instance from useOxy context
 */
export function useAuthFetch(): AuthFetchAPI {
  const { oxyServices, isAuthenticated, user, login, logout, signUp, activeSessionId, setApiUrl } = useOxy();

  // Validate that we have the required dependencies
  if (!oxyServices) {
    throw new Error('useAuthFetch requires OxyServices to be initialized. Make sure your app is wrapped with OxyProvider.');
  }

  // Main fetch function with automatic auth headers
  const authFetch = useCallback(async (input: RequestInfo | URL, init?: AuthFetchOptions): Promise<Response> => {
    if (!oxyServices) {
      throw new Error('OxyServices not initialized. Make sure to wrap your app in OxyProvider.');
    }

    const url = resolveURL(input, oxyServices.getBaseURL());
    const options = await addAuthHeaders(init, oxyServices, activeSessionId || undefined, isAuthenticated);

    try {
      let response = await fetch(url, options);

      // Handle token expiry and automatic refresh
      if (response.status === 401 && isAuthenticated) {
        // Try to refresh token if we have refresh capability
        if (oxyServices.refreshTokens) {
          try {
            await oxyServices.refreshTokens();
            const retryOptions = await addAuthHeaders(init, oxyServices, activeSessionId || undefined, isAuthenticated);
            response = await fetch(url, retryOptions);
          } catch (refreshError) {
            // Refresh failed, throw authentication error
            const error = new Error('Authentication expired. Please login again.') as any;
            error.status = 401;
            error.code = 'AUTH_EXPIRED';
            throw error;
          }
        }
      }

      return response;
    } catch (error) {
      // Re-throw with additional context if needed
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Request failed');
    }
  }, [oxyServices, activeSessionId, isAuthenticated]);

  // JSON convenience methods
  const get = useCallback(async (endpoint: string, options?: AuthFetchOptions) => {
    const response = await authFetch(endpoint, { ...options, method: 'GET' });
    return handleJsonResponse(response);
  }, [authFetch]);

  const post = useCallback(async (endpoint: string, data?: any, options?: AuthFetchOptions) => {
    const response = await authFetch(endpoint, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: data ? JSON.stringify(data) : undefined
    });
    return handleJsonResponse(response);
  }, [authFetch]);

  const put = useCallback(async (endpoint: string, data?: any, options?: AuthFetchOptions) => {
    const response = await authFetch(endpoint, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      body: data ? JSON.stringify(data) : undefined
    });
    return handleJsonResponse(response);
  }, [authFetch]);

  const del = useCallback(async (endpoint: string, options?: AuthFetchOptions) => {
    const response = await authFetch(endpoint, { ...options, method: 'DELETE' });
    return handleJsonResponse(response);
  }, [authFetch]);

  // Attach convenience methods and auth state to the main function
  const fetchWithMethods = authFetch as AuthFetchAPI;
  fetchWithMethods.get = get;
  fetchWithMethods.post = post;
  fetchWithMethods.put = put;
  fetchWithMethods.delete = del;
  fetchWithMethods.isAuthenticated = isAuthenticated;
  fetchWithMethods.user = user;
  fetchWithMethods.login = login;
  fetchWithMethods.logout = logout;
  fetchWithMethods.signUp = signUp;
  fetchWithMethods.setApiUrl = setApiUrl;

  return fetchWithMethods;
}

/**
 * Helper functions
 */

function resolveURL(input: RequestInfo | URL, baseURL: string): string {
  if (!baseURL) {
    throw new Error('Base URL not configured. Please provide a baseURL in OxyServices configuration.');
  }

  const url = input.toString();
  
  // If it's already a full URL (http/https), return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Normalize base URL (remove trailing slash)
  const normalizedBaseURL = baseURL.replace(/\/$/, '');
  
  // If URL starts with /, it's relative to base URL
  if (url.startsWith('/')) {
    return `${normalizedBaseURL}${url}`;
  }
  
  // Otherwise, append to base URL with /
  return `${normalizedBaseURL}/${url}`;
}

async function addAuthHeaders(init?: AuthFetchOptions, oxyServices?: any, activeSessionId?: string, isAuthenticated?: boolean): Promise<RequestInit> {
  const headers = new Headers(init?.headers);
  
  // Add auth header if user is authenticated
  if (isAuthenticated && oxyServices && !headers.has('Authorization')) {
    try {
      // First try to get regular JWT access token
      let accessToken = oxyServices.getAccessToken?.();
      
      // If no JWT token but we have a secure session, try to get token from session
      if (!accessToken && activeSessionId) {
        try {
          const tokenData = await oxyServices.getTokenBySession(activeSessionId);
          accessToken = tokenData.accessToken;
        } catch (error) {
          // Silent fail - will attempt request without token
        }
      }
      
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
    } catch (error) {
      // Silent fail - will attempt request without token
    }
  }

  const body = init?.body;
  const processedBody = body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams)
    ? JSON.stringify(body)
    : body;

  return {
    ...init,
    headers,
    body: processedBody
  };
}

async function handleJsonResponse(response: Response): Promise<any> {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.error || errorMessage;
    } catch {
      // Ignore JSON parsing errors
    }
    
    const error = new Error(errorMessage) as any;
    error.status = response.status;
    error.response = response;
    throw error;
  }

  try {
    return await response.json();
  } catch {
    // If response isn't JSON, return the response itself
    return response;
  }
}

export default useAuthFetch; 
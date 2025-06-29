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
}

/**
 * Hook that provides authenticated fetch functionality
 * Uses the existing OxyServices instance from useOxy context
 */
export function useAuthFetch(): AuthFetchAPI {
  const { oxyServices, isAuthenticated, user, login, logout, signUp, activeSessionId } = useOxy();

  // Main fetch function with automatic auth headers
  const authFetch = useCallback(async (input: RequestInfo | URL, init?: AuthFetchOptions): Promise<Response> => {
    const url = resolveURL(input, oxyServices.getBaseURL());
    const options = await addAuthHeaders(init, oxyServices, activeSessionId || undefined, isAuthenticated);

    try {
      let response = await fetch(url, options);

      // Handle token expiry and automatic refresh
      if (response.status === 401 && isAuthenticated) {
        // Try to refresh token and retry
        try {
          await oxyServices.refreshTokens();
          const retryOptions = await addAuthHeaders(init, oxyServices, activeSessionId || undefined, isAuthenticated);
          response = await fetch(url, retryOptions);
        } catch (refreshError) {
          // Refresh failed, user needs to login again
          console.warn('Token refresh failed, user needs to re-authenticate');
          throw new Error('Authentication expired. Please login again.');
        }
      }

      return response;
    } catch (error) {
      console.error('AuthFetch error:', error);
      throw error;
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

  return fetchWithMethods;
}

/**
 * Helper functions
 */

function resolveURL(input: RequestInfo | URL, baseURL: string): string {
  const url = input.toString();
  
  // If it's already a full URL, return as is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // If it starts with /, it's relative to base URL
  if (url.startsWith('/')) {
    return `${baseURL}${url}`;
  }
  
  // Otherwise, append to base URL with /
  return `${baseURL}/${url}`;
}

async function addAuthHeaders(init?: AuthFetchOptions, oxyServices?: any, activeSessionId?: string, isAuthenticated?: boolean): Promise<RequestInit> {
  const headers = new Headers(init?.headers);
  
  // Debug logging
  console.log('[Auth API Debug] isAuthenticated:', isAuthenticated, 'activeSessionId:', activeSessionId, 'oxyServices:', !!oxyServices);
  
  // Add auth header if user is authenticated (use context state instead of getCurrentUserId)
  if (isAuthenticated && oxyServices && !headers.has('Authorization')) {
    try {
      // First try to get regular JWT access token
      let accessToken = oxyServices.getAccessToken?.();
      console.log('[Auth API Debug] JWT accessToken from getAccessToken():', !!accessToken);
      
      // If no JWT token but we have a secure session, try to get token from session
      if (!accessToken && activeSessionId) {
        console.log('[Auth API] No JWT token, trying to get token from secure session:', activeSessionId);
        try {
          const tokenData = await oxyServices.getTokenBySession(activeSessionId);
          accessToken = tokenData.accessToken;
          console.log('[Auth API] Got token from session successfully');
        } catch (error) {
          console.warn('[Auth API] Failed to get token from session:', error);
        }
      }
      
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
        console.log('[Auth API] Added Authorization header successfully');
      } else {
        console.warn('[Auth API] No authentication token available - JWT token:', !!oxyServices.getAccessToken?.(), 'activeSessionId:', activeSessionId);
      }
    } catch (error) {
      console.error('[Auth API] Error getting access token:', error);
    }
  } else {
    console.warn('[Auth API] Cannot authenticate - isAuthenticated:', isAuthenticated, 'oxyServices:', !!oxyServices, 'hasAuthHeader:', headers.has('Authorization'));
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
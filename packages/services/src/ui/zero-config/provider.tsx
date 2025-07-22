/**
 * Zero-config OxyHQ Provider and Hook for React/React Native
 * 
 * This provides a simplified, one-line setup for frontend authentication
 * with automatic token management and API integration.
 */

import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { OxyServices } from '../../core';
import { User, LoginResponse } from '../../models/interfaces';

export interface OxyZeroConfigState {
  // Authentication state
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Simple auth methods
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<User>;

  // Access to the OxyServices client
  api: OxyServices;
}

const OxyZeroConfigContext = createContext<OxyZeroConfigState | null>(null);

export interface OxyZeroConfigProviderProps {
  children: ReactNode;
  /** Base URL of your Oxy API server (defaults to process.env.REACT_APP_OXY_API_URL or http://localhost:3001) */
  apiUrl?: string;
  /** Called when authentication state changes */
  onAuthChange?: (user: User | null) => void;
  /** Storage key prefix (default: 'oxy_zero') */
  storagePrefix?: string;
}

/**
 * Zero-config provider for OxyHQ Services
 * 
 * @example
 * ```tsx
 * import { OxyZeroConfigProvider } from '@oxyhq/services/ui';
 * 
 * function App() {
 *   return (
 *     <OxyZeroConfigProvider>
 *       <MyApp />
 *     </OxyZeroConfigProvider>
 *   );
 * }
 * ```
 */
export const OxyZeroConfigProvider: React.FC<OxyZeroConfigProviderProps> = ({
  children,
  apiUrl,
  onAuthChange,
  storagePrefix = 'oxy_zero'
}) => {
  // Determine API URL with fallbacks
  const finalApiUrl = apiUrl || 
    (typeof process !== 'undefined' && process.env?.REACT_APP_OXY_API_URL) ||
    'http://localhost:3001';

  // Initialize OxyServices
  const [api] = useState(() => new OxyServices({ baseURL: finalApiUrl }));
  
  // State
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = user !== null;

  // Storage helpers
  const getStorageKey = (key: string) => `${storagePrefix}_${key}`;

  const saveToStorage = useCallback((key: string, value: string) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(getStorageKey(key), value);
      }
    } catch (error) {
      console.warn('Failed to save to storage:', error);
    }
  }, [storagePrefix]);

  const getFromStorage = useCallback((key: string): string | null => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(getStorageKey(key));
      }
    } catch (error) {
      console.warn('Failed to read from storage:', error);
    }
    return null;
  }, [storagePrefix]);

  const removeFromStorage = useCallback((key: string) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(getStorageKey(key));
      }
    } catch (error) {
      console.warn('Failed to remove from storage:', error);
    }
  }, [storagePrefix]);

  // Initialize authentication state
  useEffect(() => {
    const initAuth = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Try to restore tokens from storage
        const savedAccessToken = getFromStorage('accessToken');
        const savedRefreshToken = getFromStorage('refreshToken');

        if (savedAccessToken && savedRefreshToken) {
          // Set tokens in the API client
          api.setTokens(savedAccessToken, savedRefreshToken);

          // Validate the token
          const isValid = await api.validate();
          if (isValid) {
            // Load user data
            const currentUser = await api.getCurrentUser();
            setUser(currentUser);
            
            if (onAuthChange) {
              onAuthChange(currentUser);
            }
          } else {
            // Invalid token, clear storage
            removeFromStorage('accessToken');
            removeFromStorage('refreshToken');
            api.clearTokens();
          }
        }
      } catch (error: any) {
        console.warn('Failed to restore authentication:', error);
        setError('Failed to restore authentication');
        
        // Clear invalid tokens
        removeFromStorage('accessToken');
        removeFromStorage('refreshToken');
        api.clearTokens();
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [api, getFromStorage, removeFromStorage, onAuthChange]);

  // Login method
  const login = useCallback(async (username: string, password: string): Promise<User> => {
    try {
      setIsLoading(true);
      setError(null);

      const response: LoginResponse = await api.login(username, password);
      
      // Save tokens to storage
      if (response.accessToken) {
        saveToStorage('accessToken', response.accessToken);
      }
      if (response.refreshToken) {
        saveToStorage('refreshToken', response.refreshToken);
      }

      // Update state
      setUser(response.user);
      
      if (onAuthChange) {
        onAuthChange(response.user);
      }

      return response.user;
    } catch (error: any) {
      const errorMessage = error.message || 'Login failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [api, saveToStorage, onAuthChange]);

  // Logout method
  const logout = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      await api.logout();
    } catch (error) {
      console.warn('Logout API call failed:', error);
    } finally {
      // Always clean up local state and storage
      removeFromStorage('accessToken');
      removeFromStorage('refreshToken');
      api.clearTokens();
      setUser(null);
      setError(null);
      setIsLoading(false);
      
      if (onAuthChange) {
        onAuthChange(null);
      }
    }
  }, [api, removeFromStorage, onAuthChange]);

  // Register method
  const register = useCallback(async (username: string, email: string, password: string): Promise<User> => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await api.signUp(username, email, password);
      
      // Save token from registration
      if (response.token) {
        saveToStorage('accessToken', response.token);
        // Note: signUp doesn't return refreshToken in current API
      }

      // Update state
      setUser(response.user);
      
      if (onAuthChange) {
        onAuthChange(response.user);
      }

      return response.user;
    } catch (error: any) {
      const errorMessage = error.message || 'Registration failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [api, saveToStorage, onAuthChange]);

  const contextValue: OxyZeroConfigState = {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    register,
    api
  };

  return (
    <OxyZeroConfigContext.Provider value={contextValue}>
      {children}
    </OxyZeroConfigContext.Provider>
  );
};

/**
 * Zero-config hook for OxyHQ Services
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, login, logout, isAuthenticated } = useOxyZeroConfig();
 *   
 *   const handleLogin = () => {
 *     login('username', 'password');
 *   };
 *   
 *   if (isAuthenticated) {
 *     return <div>Welcome, {user?.username}!</div>;
 *   }
 *   
 *   return <button onClick={handleLogin}>Login</button>;
 * }
 * ```
 */
export const useOxyZeroConfig = (): OxyZeroConfigState => {
  const context = useContext(OxyZeroConfigContext);
  if (!context) {
    throw new Error('useOxyZeroConfig must be used within an OxyZeroConfigProvider');
  }
  return context;
};

/**
 * Hook for automatic API client with authentication
 * This automatically includes the auth token in requests
 * 
 * @example
 * ```tsx
 * function ProfileComponent() {
 *   const api = useOxyApi();
 *   
 *   const updateProfile = async (data) => {
 *     const user = await api.updateProfile(data);
 *     // Token is automatically included
 *   };
 * }
 * ```
 */
export const useOxyApi = (): OxyServices => {
  const { api } = useOxyZeroConfig();
  return api;
};
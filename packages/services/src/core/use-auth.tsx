/**
 * Zero-Config Authentication Hook for React/React Native
 * 
 * Provides automatic authentication state management with minimal setup required.
 */

import { useState, useEffect, useCallback, useContext, createContext, ReactNode } from 'react';
import { AuthenticationManager, getAuthManager, initializeAuth } from './auth-manager';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: any | null;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getCurrentUser: () => Promise<any>;
  checkUsernameAvailability: (username: string) => Promise<{ available: boolean; message: string }>;
  checkEmailAvailability: (email: string) => Promise<{ available: boolean; message: string }>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  baseURL?: string;
}

/**
 * Authentication Provider Component
 * 
 * Wrap your app with this provider to enable zero-config authentication.
 * All authentication state will be automatically managed.
 */
export function AuthProvider({ children, baseURL = 'https://api.oxy.so' }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    error: null,
  });

  const authManager = initializeAuth(baseURL);

  // Update state when auth manager state changes
  useEffect(() => {
    const unsubscribe = authManager.onAuthStateChange((authState) => {
      setState(prevState => ({
        ...prevState,
        isAuthenticated: authState.isAuthenticated,
        user: authState.user,
        isLoading: false,
      }));
    });

    return unsubscribe;
  }, [authManager]);

  const login = useCallback(async (username: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      await authManager.login({ username, password });
      // State will be updated via the auth state change listener
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }));
      throw error;
    }
  }, [authManager]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      await authManager.register({ username, email, password });
      // State will be updated via the auth state change listener
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      }));
      throw error;
    }
  }, [authManager]);

  const logout = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      await authManager.logout();
      // State will be updated via the auth state change listener
    } catch (error) {
      console.error('Logout error:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Logout failed',
      }));
    }
  }, [authManager]);

  const getCurrentUser = useCallback(async () => {
    try {
      return await authManager.getCurrentUser();
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to get current user',
      }));
      throw error;
    }
  }, [authManager]);

  const checkUsernameAvailability = useCallback(async (username: string) => {
    return await authManager.checkUsernameAvailability(username);
  }, [authManager]);

  const checkEmailAvailability = useCallback(async (email: string) => {
    return await authManager.checkEmailAvailability(email);
  }, [authManager]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  const contextValue: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    getCurrentUser,
    checkUsernameAvailability,
    checkEmailAvailability,
    clearError,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Authentication Hook
 * 
 * Use this hook in any component to access authentication state and methods.
 * No additional setup required - just wrap your app with AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
}

/**
 * Higher-Order Component for authentication
 * 
 * Wraps a component to ensure user is authenticated before rendering.
 * Automatically redirects to login if not authenticated.
 */
export function withAuth<P extends object>(
  Component: React.ComponentType<P>,
  options: {
    redirectTo?: () => void;
    LoadingComponent?: React.ComponentType;
    requireAuth?: boolean;
  } = {}
) {
  const {
    redirectTo,
    LoadingComponent = () => null,
    requireAuth = true,
  } = options;

  return function AuthenticatedComponent(props: P) {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
      return <LoadingComponent />;
    }

    if (requireAuth && !isAuthenticated) {
      if (redirectTo) {
        redirectTo();
        return null;
      }
      
      // Default behavior - render nothing if not authenticated
      return null;
    }

    if (!requireAuth && isAuthenticated) {
      // Component should only be shown to non-authenticated users
      return null;
    }

    return <Component {...props} />;
  };
}

/**
 * Hook for authenticated API calls
 * 
 * Returns an authenticated HTTP client that automatically handles tokens.
 */
export function useOxyClient() {
  const authManager = getAuthManager();
  return authManager.getClient();
}

/**
 * Hook for authentication status only (minimal re-renders)
 */
export function useAuthStatus(): { isAuthenticated: boolean; isLoading: boolean } {
  const { isAuthenticated, isLoading } = useAuth();
  return { isAuthenticated, isLoading };
}

/**
 * Hook for current user data
 */
export function useCurrentUser(): { user: any | null; isLoading: boolean; refetch: () => Promise<any> } {
  const { user, isLoading, getCurrentUser } = useAuth();
  
  return {
    user,
    isLoading,
    refetch: getCurrentUser,
  };
}
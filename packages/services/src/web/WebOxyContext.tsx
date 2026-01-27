/**
 * Web-Only Oxy Context
 * Clean implementation with ZERO React Native dependencies
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { OxyServices } from '../core';
import type { User } from '../models/interfaces';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../ui/hooks/queryClient';

export interface WebAuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface WebAuthActions {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export interface WebOxyContextValue extends WebAuthState, WebAuthActions {
  oxyServices: OxyServices;
}

const WebOxyContext = createContext<WebOxyContextValue | null>(null);

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
  authWebUrl?: string;
  onAuthStateChange?: (user: User | null) => void;
}

/**
 * Web-only Oxy Provider
 * Minimal, clean implementation for web apps
 */
export function WebOxyProvider({
  children,
  baseURL,
  authWebUrl,
  onAuthStateChange,
}: WebOxyProviderProps) {
  const [oxyServices] = useState(() => new OxyServices({ baseURL, authWebUrl }));
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queryClient] = useState(() => createQueryClient());

  const isAuthenticated = !!user;

  // Initialize - check for existing session
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        // Try to get current user (will use existing auth token if available)
        const currentUser = await oxyServices.getCurrentUser();

        if (mounted && currentUser) {
          setUser(currentUser);
        }
      } catch (err) {
        // No active session - this is fine
        console.log('[WebOxy] No active session');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
    };
  }, [oxyServices]);

  // Notify parent of auth state changes
  useEffect(() => {
    onAuthStateChange?.(user);
  }, [user, onAuthStateChange]);

  const signIn = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      // Open popup to auth.oxy.so
      const popup = window.open(
        `${authWebUrl || 'https://auth.oxy.so'}/login?origin=${encodeURIComponent(window.location.origin)}`,
        'oxy-auth',
        'width=500,height=700,popup=yes'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Listen for message from popup
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== (authWebUrl || 'https://auth.oxy.so')) {
          return;
        }

        if (event.data.type === 'oxy-auth-success') {
          const { accessToken, user: authUser } = event.data;

          // Store the access token for API requests
          if (typeof window !== 'undefined' && accessToken) {
            localStorage.setItem('oxy-access-token', accessToken);
          }

          setUser(authUser);
          setIsLoading(false);

          window.removeEventListener('message', handleMessage);
          popup.close();
        } else if (event.data.type === 'oxy-auth-error') {
          setError(event.data.error || 'Authentication failed');
          setIsLoading(false);
          window.removeEventListener('message', handleMessage);
          popup.close();
        }
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was closed
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          setIsLoading(false);
        }
      }, 500);
    } catch (err) {
      console.error('[WebOxy] Sign in error:', err);
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setIsLoading(false);
    }
  }, [authWebUrl]);

  const signOut = useCallback(async () => {
    setError(null);

    try {
      // Clear stored token
      if (typeof window !== 'undefined') {
        localStorage.removeItem('oxy-access-token');
      }

      setUser(null);
    } catch (err) {
      console.error('[WebOxy] Sign out error:', err);
      setError(err instanceof Error ? err.message : 'Sign out failed');
    }
  }, []);

  const contextValue: WebOxyContextValue = {
    user,
    isAuthenticated,
    isLoading,
    error,
    signIn,
    signOut,
    oxyServices,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <WebOxyContext.Provider value={contextValue}>
        {children}
      </WebOxyContext.Provider>
    </QueryClientProvider>
  );
}

export function useWebOxy() {
  const context = useContext(WebOxyContext);
  if (!context) {
    throw new Error('useWebOxy must be used within WebOxyProvider');
  }
  return context;
}

export function useAuth() {
  const { user, isAuthenticated, isLoading, error, signIn, signOut, oxyServices } = useWebOxy();

  return {
    user,
    isAuthenticated,
    isLoading,
    isReady: !isLoading,
    error,
    signIn,
    signOut,
    oxyServices,
  };
}

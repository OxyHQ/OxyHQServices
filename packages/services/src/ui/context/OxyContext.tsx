/**
 * OxyContext using Zustand stores
 * This replaces the complex Redux + Context combination with a clean, performant solution
 */

import React, { createContext, useContext, useEffect, ReactNode, useRef } from 'react';
import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { SecureClientSession, MinimalUserData } from '../../models/secureSession';
import { initializeOxyStore, useAuth, useFollow } from '../../stores';

// Define the context shape - maintaining backward compatibility
export interface OxyContextState {
  // Authentication state
  user: User | null; // Current active user (loaded from server)
  minimalUser: MinimalUserData | null; // Minimal user data for UI
  sessions: SecureClientSession[]; // All active sessions
  activeSessionId: string | null;
  isAuthenticated: boolean; // Single source of truth for authentication - use this instead of service methods
  isLoading: boolean;
  error: string | null;

  // Auth methods
  login: (username: string, password: string, deviceName?: string) => Promise<User>;
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<User>;

  // Multi-session methods
  switchSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;

  // Device management methods
  getDeviceSessions: () => Promise<any[]>;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;

  // Helper methods
  ensureToken: () => Promise<void>; // Ensure token is set before API calls
  refreshUserData: () => Promise<void>; // Refresh user data from server

  // Access to services
  oxyServices: OxyServices;
  bottomSheetRef?: React.RefObject<any>;

  // Methods to directly control the bottom sheet
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

// Create the context
const OxyContext = createContext<OxyContextState | null>(null);

// Props for the OxyContextProvider - maintaining backward compatibility
export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices: OxyServices;
  storageKeyPrefix?: string; // Kept for backward compatibility but not used
  onAuthStateChange?: (user: User | null) => void; // Kept for backward compatibility
  bottomSheetRef?: React.RefObject<any>;
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

/**
 * OxyContextProvider using Zustand stores
 * Initializes the Zustand store and provides OxyServices access
 */
export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices,
  storageKeyPrefix, // Kept for backward compatibility
  onAuthStateChange, // Kept for backward compatibility
  bottomSheetRef,
  showBottomSheet,
  hideBottomSheet,
}) => {
  const isInitialized = useRef(false);
  const onAuthStateChangeRef = useRef(onAuthStateChange);
  
  // Update the ref when the callback changes
  useEffect(() => {
    onAuthStateChangeRef.current = onAuthStateChange;
  }, [onAuthStateChange]);

  // Initialize the store once
  useEffect(() => {
    if (!isInitialized.current) {
      initializeOxyStore(oxyServices);
      isInitialized.current = true;
    }
  }, [oxyServices]);

  return (
    <OxyContext.Provider value={{ 
      oxyServices, 
      bottomSheetRef, 
      showBottomSheet, 
      hideBottomSheet 
    }}>
      <AuthStateChangeListener onAuthStateChange={onAuthStateChangeRef.current} />
      {children}
    </OxyContext.Provider>
  );
};

/**
 * Component to handle auth state change callbacks for backward compatibility
 */
const AuthStateChangeListener: React.FC<{ onAuthStateChange?: (user: User | null) => void }> = ({ 
  onAuthStateChange 
}) => {
  const auth = useAuth();
  
  useEffect(() => {
    if (onAuthStateChange) {
      onAuthStateChange(auth.user);
    }
  }, [auth.user, onAuthStateChange]);

  return null;
};

/**
 * Hook to access the OxyContext
 */
export const useOxyContext = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxyContext must be used within an OxyContextProvider');
  }
  
  const auth = useAuth();
  const follow = useFollow();

  return {
    // Context values
    ...context,
    
    // Authentication state and actions
    user: auth.user,
    minimalUser: auth.minimalUser,
    sessions: auth.sessions,
    activeSessionId: auth.activeSessionId,
    isAuthenticated: auth.isAuthenticated,
    isLoading: auth.isLoading,
    error: auth.error,

    // Auth actions
    login: auth.login,
    logout: auth.logout,
    logoutAll: auth.logoutAll,
    signUp: auth.signUp,
    switchSession: auth.switchSession,
    removeSession: auth.removeSession,
    refreshSessions: auth.refreshSessions,
    refreshUserData: auth.refreshUserData,
    
    // Device management
    getDeviceSessions: auth.getDeviceSessions,
    logoutAllDeviceSessions: auth.logoutAllDeviceSessions,
    updateDeviceName: auth.updateDeviceName,
    ensureToken: auth.ensureToken,
  };
};

/**
 * Main hook that combines all Oxy functionality
 * This is the primary hook that components should use
 */
export const useOxy = () => {
  const context = useOxyContext();
  const follow = useFollow();

  return {
    // All context functionality
    ...context,

    // Follow functionality
    followingUsers: follow.followingUsers,
    loadingUsers: follow.loadingUsers,
    followErrors: follow.errors,
    
    // Follow actions
    toggleFollow: follow.toggleFollow,
    followUser: follow.followUser,
    unfollowUser: follow.unfollowUser,
    fetchFollowStatus: follow.fetchFollowStatus,
    fetchMultipleStatuses: follow.fetchMultipleStatuses,
    setFollowingStatus: follow.setFollowingStatus,
    clearFollowError: follow.clearFollowError,
    clearAllFollowErrors: follow.clearAllFollowErrors,
  };
};

// Export for legacy support - keeping the original interface
export const OxyProvider = OxyContextProvider;

// Export types
export type { OxyContextState, OxyContextProviderProps };
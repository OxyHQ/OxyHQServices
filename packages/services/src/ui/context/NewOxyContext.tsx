/**
 * Simplified OxyContext using Zustand stores
 * This replaces the complex Redux + Context combination with a clean, performant solution
 */

import React, { createContext, useContext, useEffect, ReactNode, useRef } from 'react';
import { OxyServices } from '../../core';
import { initializeOxyStore, useAuth, useFollow } from '../../stores';

export interface OxyContextValue {
  // Access to services
  oxyServices: OxyServices;
  bottomSheetRef?: React.RefObject<any>;

  // Methods to directly control the bottom sheet
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

// Create the context
const OxyContext = createContext<OxyContextValue | null>(null);

// Props for the OxyContextProvider
export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices: OxyServices;
  bottomSheetRef?: React.RefObject<any>;
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

/**
 * Simplified OxyContextProvider
 * Initializes the Zustand store and provides OxyServices access
 */
export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices,
  bottomSheetRef,
  showBottomSheet,
  hideBottomSheet,
}) => {
  const isInitialized = useRef(false);

  // Initialize the store once
  useEffect(() => {
    if (!isInitialized.current) {
      initializeOxyStore(oxyServices);
      isInitialized.current = true;
    }
  }, [oxyServices]);

  const contextValue: OxyContextValue = {
    oxyServices,
    bottomSheetRef,
    showBottomSheet,
    hideBottomSheet,
  };

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

/**
 * Hook to access the OxyContext
 */
export const useOxyContext = (): OxyContextValue => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxyContext must be used within an OxyContextProvider');
  }
  return context;
};

/**
 * Main hook that combines all Oxy functionality
 * This is the primary hook that components should use
 */
export const useOxy = () => {
  const context = useOxyContext();
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
    updateProfile: auth.updateProfile,
    
    // Device management
    getDeviceSessions: auth.getDeviceSessions,
    logoutAllDeviceSessions: auth.logoutAllDeviceSessions,
    updateDeviceName: auth.updateDeviceName,
    ensureToken: auth.ensureToken,

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

    // Helper methods
    clearError: auth.clearError,
    reset: auth.reset,
  };
};

// Export types
// Types are exported inline above
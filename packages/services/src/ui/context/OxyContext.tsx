import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { SecureLoginResponse, SecureClientSession, MinimalUserData } from '../../models/secureSession';
import { DeviceManager } from '../../utils/deviceManager';
import { useOxyStore } from '../stores/oxyStore';

// Define the context shape
export interface OxyContextState {
  // Authentication state
  user: User | null; // Current active user (loaded from server)
  minimalUser: MinimalUserData | null; // Minimal user data for UI
  sessions: SecureClientSession[]; // All active sessions
  activeSessionId: string | null;
  isAuthenticated: boolean;
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

  // Access to services
  oxyServices: OxyServices;
  bottomSheetRef?: React.RefObject<any>;

  // Methods to directly control the bottom sheet
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

// Create the context with default values
const OxyContext = createContext<OxyContextState | null>(null);

// Props for the OxyContextProvider
export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices: OxyServices;
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
  bottomSheetRef?: React.RefObject<any>;
}

// Platform storage interface
interface StorageInterface {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

// Web localStorage implementation
class WebStorage implements StorageInterface {
  async getItem(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    localStorage.clear();
  }
}

// React Native AsyncStorage implementation
let AsyncStorage: StorageInterface;

// Determine the platform and set up storage
const isReactNative = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
};

// Get appropriate storage for the platform
const getStorage = async (): Promise<StorageInterface> => {
  if (isReactNative()) {
    if (!AsyncStorage) {
      try {
        const asyncStorageModule = await import('@react-native-async-storage/async-storage');
        AsyncStorage = asyncStorageModule.default;
      } catch (error) {
        console.error('Failed to import AsyncStorage:', error);
        throw new Error('AsyncStorage is required in React Native environment');
      }
    }
    return AsyncStorage;
  }

  return new WebStorage();
};

export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices,
  storageKeyPrefix = 'oxy_secure',
  onAuthStateChange,
  bottomSheetRef,
}) => {
  // Get store state and actions
  const store = useOxyStore();
  
  // Initialize storage and services
  useEffect(() => {
    const initStorage = async () => {
      try {
        const platformStorage = await getStorage();
        store.setStorage(platformStorage);
        store.setOxyServices(oxyServices);
        store.setStorageKeyPrefix(storageKeyPrefix);
        if (onAuthStateChange) {
          store.setOnAuthStateChange(onAuthStateChange);
        }
        if (bottomSheetRef) {
          store.setBottomSheetRef(bottomSheetRef);
        }
      } catch (error) {
        console.error('Failed to initialize storage:', error);
        store.setError('Failed to initialize storage');
      }
    };

    initStorage();
  }, [oxyServices, storageKeyPrefix, onAuthStateChange, bottomSheetRef]);

  // Initialize auth when storage is ready
  useEffect(() => {
    if (store.storage && store.oxyServices) {
      store.initializeAuth();
    }
  }, [store.storage, store.oxyServices]);

  // Create context value that matches the original interface
  const contextValue: OxyContextState = {
    // State from store
    user: store.user,
    minimalUser: store.minimalUser,
    sessions: store.sessions,
    activeSessionId: store.activeSessionId,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    error: store.error,

    // Methods from store
    login: store.login,
    logout: store.logout,
    logoutAll: store.logoutAll,
    signUp: store.signUp,
    switchSession: store.switchSession,
    removeSession: store.removeSession,
    refreshSessions: store.refreshSessions,
    getDeviceSessions: store.getDeviceSessions,
    logoutAllDeviceSessions: store.logoutAllDeviceSessions,
    updateDeviceName: store.updateDeviceName,

    // Services and refs
    oxyServices: store.oxyServices || oxyServices,
    bottomSheetRef: store.bottomSheetRef,
    showBottomSheet: store.showBottomSheet,
    hideBottomSheet: store.hideBottomSheet,
  };

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

// Hook to use the context
export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxy must be used within an OxyContextProvider');
  }
  return context;
};

export default OxyContext;

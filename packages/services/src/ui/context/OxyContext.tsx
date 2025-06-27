import React, { createContext, useContext, ReactNode, useCallback } from 'react';
import { OxyServices, User, MinimalUserData, SecureClientSession } from '../../';
import { useAppDispatch, useAppSelector } from '../../hooks/reduxHooks';
import {
  login as loginAction,
  logout as logoutAction,
  logoutAll as logoutAllAction,
  signUp as signUpAction,
  switchSession as switchSessionAction,
  // We will need to create thunks/actions for these if they are to be managed by Redux
  // refreshSessions, getDeviceSessions, logoutAllDeviceSessions, updateDeviceName
} from '../../store/slices/authSlice';
import { DeviceManager } from '../../utils/deviceManager'; // Keep for device specific ops not in Redux

// Define the context shape for methods not yet in Redux or for direct passthrough
// This context will be minimal and primarily delegate to Redux or direct service calls.
export interface OxyContextAccess {
  // Auth methods that dispatch Redux actions
  login: (username: string, password: string, deviceName?: string) => Promise<User>; // Returns User on success
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<User>; // Returns User on success
  switchSession: (sessionId: string) => Promise<void>; // Consider what this should return

  // Direct access to OxyServices for methods not yet in Redux
  // Or for functionalities that don't need to be global state managed by Redux
  getDeviceSessions: () => Promise<any[]>; // Example: still direct
  logoutAllDeviceSessions: () => Promise<void>; // Example: still direct
  updateDeviceName: (deviceName: string) => Promise<void>; // Example: still direct

  // Bottom sheet controls - these might remain in a React context if they control a specific UI instance
  // Or they could be moved to a UI slice in Redux if global control is needed.
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
  bottomSheetRef?: React.RefObject<any>; // Retained for direct manipulation if needed

  // Expose the raw oxyServices instance if some components need direct, non-state-managed access
  oxyServicesInstance: OxyServices | null;
}

const OxyContext = createContext<OxyContextAccess | null>(null);

export interface OxyContextProviderProps {
  children: ReactNode;
  // oxyServices, storageKeyPrefix, onAuthStateChange are handled by Redux Provider and authSlice
  bottomSheetRef?: React.RefObject<any>; // For UI components that need direct ref
}

// This Provider now mainly provides access to dispatchers for Redux actions
// and direct service calls for non-Redux managed operations.
// The actual state (user, isAuthenticated, etc.) is consumed via useAppSelector.
export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
  children,
  bottomSheetRef,
}) => {
  const dispatch = useAppDispatch();
  // Get necessary state from Redux to pass to thunks
  const { oxyServices, sessions, activeSessionId, storage, storageKeyPrefix } = useAppSelector(state => ({
    oxyServices: state.auth.oxyServices,
    sessions: state.auth.sessions,
    activeSessionId: state.auth.activeSessionId,
    // Assuming storage and storageKeyPrefix are also part of your Redux state or passed differently
    // For this example, let's assume they are configured and available when initAuth runs.
    // If not, thunks need to get them from their arguments or a config.
    // For simplicity, we'll rely on thunks to get storage/prefix from their direct args if needed.
    // This context provider doesn't need to know about them anymore.
    storage: undefined, // Placeholder, thunks will get this from their own setup
    storageKeyPrefix: undefined // Placeholder
  }));

  const login = useCallback(async (username: string, password: string, deviceName?: string): Promise<User> => {
    if (!oxyServices) throw new Error("OxyServices not initialized in Redux state");
    // The thunk needs currentSessions and currentActiveSessionId
    const resultAction = await dispatch(loginAction({
        username,
        password,
        deviceName,
        oxyServices,
        storage: {} as any, // Actual storage should be passed by OxyProvider during initAuth
        currentSessions: sessions,
        currentActiveSessionId: activeSessionId
    }));
    if (loginAction.fulfilled.match(resultAction)) {
      return resultAction.payload.user;
    } else {
      throw new Error(resultAction.payload as string || "Login failed via Redux");
    }
  }, [dispatch, oxyServices, sessions, activeSessionId]);

  const logout = useCallback(async (targetSessionId?: string) => {
    if (!oxyServices || activeSessionId === null) throw new Error("Cannot logout: Services or active session missing");
    const resultAction = await dispatch(logoutAction({
        targetSessionId,
        oxyServices,
        storage: {} as any,
        currentSessions: sessions,
        currentActiveSessionId: activeSessionId
    }));
    if (logoutAction.rejected.match(resultAction)) {
        throw new Error(resultAction.payload as string || "Logout failed via Redux");
    }
  }, [dispatch, oxyServices, sessions, activeSessionId]);

  const logoutAll = useCallback(async () => {
    if (!oxyServices || activeSessionId === null) throw new Error("Cannot logout all: Services or active session missing");
    const resultAction = await dispatch(logoutAllAction({
        oxyServices,
        storage: {} as any,
        currentActiveSessionId: activeSessionId
    }));
     if (logoutAllAction.rejected.match(resultAction)) {
        throw new Error(resultAction.payload as string || "Logout all failed via Redux");
    }
  }, [dispatch, oxyServices, activeSessionId]);

  const signUp = useCallback(async (username: string, email: string, password: string): Promise<User> => {
    if (!oxyServices) throw new Error("OxyServices not initialized in Redux state");
    const resultAction = await dispatch(signUpAction({
        username,
        email,
        password,
        oxyServices,
        storage: {} as any,
        currentSessions: sessions,
        currentActiveSessionId: activeSessionId
    }));
    if (signUpAction.fulfilled.match(resultAction)) {
      return resultAction.payload.user;
    } else {
      throw new Error(resultAction.payload as string || "Sign up failed via Redux");
    }
  }, [dispatch, oxyServices, sessions, activeSessionId]);

  const switchSession = useCallback(async (sessionId: string) => {
    if (!oxyServices) throw new Error("OxyServices not initialized in Redux state");
    const resultAction = await dispatch(switchSessionAction({
        sessionId,
        oxyServices,
        storage: {} as any
    }));
    if (switchSessionAction.rejected.match(resultAction)) {
        throw new Error(resultAction.payload as string || "Switch session failed via Redux");
    }
  }, [dispatch, oxyServices]);

  // --- Methods not (yet) in Redux, called directly on oxyServices instance ---
  // Ensure oxyServices is available from Redux store before calling these.
  const getDeviceSessions = useCallback(async (): Promise<any[]> => {
    if (!oxyServices || !activeSessionId) throw new Error("OxyServices or active session not available");
    return oxyServices.getDeviceSessions(activeSessionId);
  }, [oxyServices, activeSessionId]);

  const logoutAllDeviceSessions = useCallback(async (): Promise<void> => {
    if (!oxyServices || !activeSessionId) throw new Error("OxyServices or active session not available");
    // This action might also need to be a thunk if it clears local Redux state significantly
    await oxyServices.logoutAllDeviceSessions(activeSessionId);
    // Potentially dispatch an action here to clear all sessions from Redux state if needed
    // For now, assuming it's handled by a subsequent initAuth or similar.
  }, [oxyServices, activeSessionId]);

  const updateDeviceName = useCallback(async (deviceName: string): Promise<void> => {
    if (!oxyServices || !activeSessionId) throw new Error("OxyServices or active session not available");
    await oxyServices.updateDeviceName(activeSessionId, deviceName);
    await DeviceManager.updateDeviceName(deviceName); // Local device manager update
  }, [oxyServices, activeSessionId]);

  // Bottom Sheet controls (passed through if bottomSheetRef is provided)
  const showBottomSheet = useCallback((screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => {
    if (bottomSheetRef?.current) {
      bottomSheetRef.current.expand?.(); // Or present()
      if (screenOrConfig) {
        setTimeout(() => { // Ensure sheet is open
          const screen = typeof screenOrConfig === 'string' ? screenOrConfig : screenOrConfig.screen;
          const props = typeof screenOrConfig === 'string' ? undefined : screenOrConfig.props;
          // @ts-ignore _navigateToScreen is custom
          bottomSheetRef.current?._navigateToScreen?.(screen, props);
        }, 100);
      }
    }
  }, [bottomSheetRef]);

  const hideBottomSheet = useCallback(() => {
    bottomSheetRef?.current?.dismiss?.();
  }, [bottomSheetRef]);

  const contextValue: OxyContextAccess = {
    login,
    logout,
    logoutAll,
    signUp,
    switchSession,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    showBottomSheet: bottomSheetRef ? showBottomSheet : undefined,
    hideBottomSheet: bottomSheetRef ? hideBottomSheet : undefined,
    bottomSheetRef,
    oxyServicesInstance: oxyServices,
  };

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

// Hook to use the context for accessing methods
export const useOxy = (): OxyContextAccess => {
  const context = useContext(OxyContext);
  if (!context) {
    // This error means useOxy is used outside of an OxyContextProvider,
    // which is now a much thinner layer. The main <Provider store={store}> should wrap the app.
    throw new Error('useOxy must be used within an OxyProvider (which includes ReduxProvider and OxyContextProvider)');
  }
  return context;
};

// Default export can be the context itself if direct consumption is needed,
// but typically useOxy hook is preferred.
export default OxyContext;

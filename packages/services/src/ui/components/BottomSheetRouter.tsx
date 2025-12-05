import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import BottomSheet, { type BottomSheetRef } from './BottomSheet';
import type { RouteName } from '../navigation/routes';
import { getScreenComponent, isValidRoute } from '../navigation/routes';
import type { BaseScreenProps } from '../types/navigation';
import { useOxy } from '../context/OxyContext';
import { useColorScheme } from '../hooks/use-color-scheme';
import {
    setBottomSheetRef as setManagerRef,
    updateBottomSheetState,
    subscribeToBottomSheetState,
    managerShowBottomSheet,
    managerCloseBottomSheet,
    managerNavigateToStep,
    managerGoBack,
    type BottomSheetRouterState,
} from '../navigation/bottomSheetManager';

export interface BottomSheetRouterProps {
    onScreenChange?: (screen: RouteName | null) => void;
    onDismiss?: () => void;
}

// Re-export the public API for backward compatibility
// The actual implementation is in bottomSheetApi.ts to avoid require cycles
export { showBottomSheet, closeBottomSheet } from '../navigation/bottomSheetApi';

// Re-export types and functions for backward compatibility
export type { BottomSheetRouterState };
export { subscribeToBottomSheetState };

const BottomSheetRouterComponent: React.FC<BottomSheetRouterProps> = ({ onScreenChange, onDismiss }) => {
    const [state, setState] = useState<BottomSheetRouterState>({
        currentScreen: null,
        screenProps: {},
        currentStep: undefined,
        navigationHistory: [],
        isOpen: false,
    });
    const sheetRef = useRef<BottomSheetRef>(null);
    const colorScheme = useColorScheme();
    
    // Extract all OxyContext values to pass as props
    // This eliminates the need for screens to import useOxy() directly
    const {
        user,
        sessions,
        activeSessionId,
        isAuthenticated,
        isLoading,
        isTokenReady,
        error,
        currentLanguage,
        currentLanguageName,
        currentNativeLanguageName,
        login,
        logout,
        logoutAll,
        signUp,
        completeMfaLogin,
        switchSession,
        removeSession,
        refreshSessions,
        setLanguage,
        getDeviceSessions,
        logoutAllDeviceSessions,
        updateDeviceName,
        oxyServices,
    } = useOxy();

    // Subscribe to global state changes
    useEffect(() => {
        const unsubscribe = subscribeToBottomSheetState((newState) => {
            setState(newState);
            onScreenChange?.(newState.currentScreen);
        });

        // Set the ref so showBottomSheet can access it
        setManagerRef(sheetRef);

        return () => {
            unsubscribe();
            setManagerRef(null);
        };
    }, [onScreenChange]);

    // Present bottom sheet when state becomes open and screen is set
    useEffect(() => {
        if (state.isOpen && state.currentScreen && sheetRef.current) {
            sheetRef.current.present();
        }
    }, [state.isOpen, state.currentScreen]);

    // Handle sheet dismiss
    const handleDismiss = useCallback(() => {
        managerCloseBottomSheet();
        onDismiss?.();
    }, [onDismiss]);

    // Get the current screen component
    const ScreenComponent = useMemo(() => {
        if (!state.currentScreen) {
            return null;
        }
        return getScreenComponent(state.currentScreen);
    }, [state.currentScreen]);

    // Navigation functions for screens
    const navigate = useCallback((screen: RouteName, props?: Record<string, unknown>) => {
        if (!isValidRoute(screen)) {
            if (__DEV__) {
                console.warn(`[BottomSheetRouter] Invalid route in navigate: ${screen}`);
            }
            return;
        }

        // Check if navigating to the same screen (step navigation within same screen)
        const isSameScreen = screen === state.currentScreen;
        
        // Only add to history if navigating to a different screen
        // Same-screen navigation is for step changes and shouldn't pollute history
        managerShowBottomSheet(screen, props, { 
            addToHistory: !isSameScreen 
        });
    }, [state.currentScreen]);

    // Track current step for step-based screens
    const currentStepRef = useRef<number | undefined>(state.currentStep ?? state.screenProps?.initialStep);
    
    useEffect(() => {
        currentStepRef.current = state.currentStep ?? state.screenProps?.initialStep;
    }, [state.currentStep, state.screenProps?.initialStep]);
    
    // Check if current screen is step-based (has initialStep prop)
    const isStepBasedScreen = useMemo(() => {
        return state.screenProps?.initialStep !== undefined || state.currentStep !== undefined;
    }, [state.screenProps?.initialStep, state.currentStep]);
    
    // Callback to track step changes from StepBasedScreen
    const handleStepChange = useCallback((step: number, totalSteps: number) => {
        updateBottomSheetState({
            currentStep: step,
        });
        currentStepRef.current = step;
    }, []);
    
    const goBack = useCallback(() => {
        // Priority 1: Check if there's screen history (navigate to previous screen)
        // This takes precedence over step navigation
        if (state.navigationHistory.length > 0) {
            const wentBack = managerGoBack();
            if (wentBack) {
                return; // Successfully navigated back to previous screen
            }
        }
        
        // Priority 2: If on a step-based screen and not on first step, go to previous step
        // Use the most up-to-date step value from state or ref
        const currentStep = state.currentStep ?? currentStepRef.current ?? state.screenProps?.initialStep ?? 0;
        
        if (isStepBasedScreen && currentStep > 0) {
            const previousStep = currentStep - 1;
            
            // Navigate to previous step by updating the screen props
            // This will trigger StepBasedScreen to update via initialStep prop
            updateBottomSheetState({
                screenProps: {
                    ...state.screenProps,
                    initialStep: previousStep,
                },
                currentStep: previousStep,
            });
            
            // Also update the ref immediately
            currentStepRef.current = previousStep;
            
            return;
        }
        
        // Priority 3: No history and on step 0 (or not step-based) - close the sheet
        managerCloseBottomSheet();
    }, [isStepBasedScreen, state.screenProps, state.currentStep, state.navigationHistory.length]);

    const handleClose = useCallback(() => {
        managerCloseBottomSheet();
    }, []);

    // Handle authentication - close bottom sheet when user successfully authenticates
    const handleAuthenticated = useCallback((user?: unknown) => {
        managerCloseBottomSheet();
    }, []);

    // Prepare screen props with all OxyContext values
    // This allows screens to receive everything via props instead of importing useOxy()
    const screenProps: BaseScreenProps = useMemo(
        () => ({
            // Navigation props
            navigate,
            goBack,
            onClose: handleClose,
            onAuthenticated: handleAuthenticated,
            
            // Theme props
            theme: colorScheme ?? 'light',
            currentScreen: state.currentScreen ?? undefined,
            
            // Step navigation - pass initialStep from state if available
            initialStep: state.currentStep ?? state.screenProps?.initialStep,
            
            // Step change callback for step-based screens
            onStepChange: handleStepChange,
            
            // OxyContext values - injected as props
            user,
            sessions,
            activeSessionId,
            isAuthenticated,
            isLoading,
            isTokenReady,
            error,
            currentLanguage,
            currentLanguageName,
            currentNativeLanguageName,
            login,
            logout,
            logoutAll,
            signUp,
            completeMfaLogin,
            switchSession,
            removeSession,
            refreshSessions,
            setLanguage,
            getDeviceSessions,
            logoutAllDeviceSessions,
            updateDeviceName,
            oxyServices,
            
            // Screen-specific props from navigation (but don't override initialStep if state.currentStep is set)
            ...(state.currentStep !== undefined 
                ? { ...state.screenProps, initialStep: state.currentStep }
                : state.screenProps
            ),
        }),
        [
            navigate,
            goBack,
            handleClose,
            handleAuthenticated,
            colorScheme,
            state.currentScreen,
            state.currentStep,
            state.screenProps,
            handleStepChange,
            user,
            sessions,
            activeSessionId,
            isAuthenticated,
            isLoading,
            isTokenReady,
            error,
            currentLanguage,
            currentLanguageName,
            currentNativeLanguageName,
            login,
            logout,
            logoutAll,
            signUp,
            completeMfaLogin,
            switchSession,
            removeSession,
            refreshSessions,
            setLanguage,
            getDeviceSessions,
            logoutAllDeviceSessions,
            updateDeviceName,
            oxyServices,
        ],
    );

    // Don't render if no screen is set
    if (!ScreenComponent || !state.currentScreen) {
        return null;
    }

    return (
        <BottomSheet
            ref={sheetRef}
            enableDynamicSizing={true}
            enablePanDownToClose={true}
            enableDismissOnClose={true}
            onDismiss={handleDismiss}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
        >
            <View style={styles.screenContainer}>
                <ScreenComponent {...screenProps} />
            </View>
        </BottomSheet>
    );
};

const BottomSheetRouter = React.memo(BottomSheetRouterComponent);
BottomSheetRouter.displayName = 'BottomSheetRouter';

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        paddingVertical: 0,
        paddingTop: 0,
        paddingBottom: 0,
        marginVertical: 0,
        marginTop: 0,
        marginBottom: 0,
    },
});

export default BottomSheetRouter;


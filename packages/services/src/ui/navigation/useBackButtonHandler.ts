import { useEffect } from 'react';
import { Platform, BackHandler } from 'react-native';
import type { OxyRouterController, StepController } from './types';

interface UseBackButtonHandlerParams {
    stepControllerRef: React.MutableRefObject<StepController | null>;
    routerRef: React.MutableRefObject<OxyRouterController | null>;
    isOpenRef: React.MutableRefObject<boolean>;
    handleClose: () => void;
}

/**
 * Unified back button handler that prioritizes:
 * 1. Step navigation (if current screen has steps)
 * 2. Router navigation (if router has history)
 * 3. Close bottom sheet
 * 
 * Navigation happens immediately without waiting for keyboard dismiss.
 * Keyboard will dismiss naturally after screen changes.
 */
const handleBackNavigation = (
    stepControllerRef: React.MutableRefObject<StepController | null>,
    routerRef: React.MutableRefObject<OxyRouterController | null>,
    handleClose: () => void
): boolean => {
    // Priority 1: Check if current screen has step history
    if (stepControllerRef.current?.canGoBack()) {
        // Navigate immediately - keyboard will dismiss naturally after screen changes
        stepControllerRef.current.goBack();
        return true; // Prevent default back behavior
    }

    // Priority 2: Check if router has navigation history
    if (routerRef.current?.canGoBack()) {
        // Navigate immediately - keyboard will dismiss naturally after screen changes
        routerRef.current.goBack();
        return true; // Prevent default back behavior
    }

    // Priority 3: Close bottom sheet
    handleClose();
    return true; // Prevent default back behavior
};

/**
 * Custom hook to handle back button navigation for Oxy bottom sheet
 * Works on both Android (hardware back) and Web (browser back)
 */
export const useBackButtonHandler = ({
    stepControllerRef,
    routerRef,
    isOpenRef,
    handleClose,
}: UseBackButtonHandlerParams): void => {
    useEffect(() => {
        if (Platform.OS === 'web') {
            // For web, handle browser back button
            const handlePopState = (event: PopStateEvent) => {
                if (isOpenRef.current) {
                    event.preventDefault();
                    handleBackNavigation(stepControllerRef, routerRef, handleClose);
                    // Push a new state to prevent browser navigation
                    window.history.pushState(null, '', window.location.href);
                }
            };

            window.addEventListener('popstate', handlePopState);
            return () => {
                window.removeEventListener('popstate', handlePopState);
            };
        } else {
            // For mobile (Android), handle hardware back button
            const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
                if (isOpenRef.current) {
                    return handleBackNavigation(stepControllerRef, routerRef, handleClose);
                }
                // Bottom sheet is closed - let app handle back button
                return false;
            });

            return () => {
                backHandler.remove();
            };
        }
    }, [stepControllerRef, routerRef, isOpenRef, handleClose]);
};


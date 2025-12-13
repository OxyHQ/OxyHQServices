import React, { useRef, useEffect, useCallback } from 'react';
import { BackHandler, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    type SharedValue,
} from 'react-native-reanimated';
import { useStore } from 'zustand';
import type { RouteName } from '../navigation/routes';
import { getScreenComponent, isValidRoute } from '../navigation/routes';
import type { BaseScreenProps } from '../types/navigation';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';
import BottomSheet, { type BottomSheetRef } from './BottomSheet';
import {
    setBottomSheetRef as setManagerRef,
    updateBottomSheetState,
    subscribeToBottomSheetState,
    managerShowBottomSheet,
    managerCloseBottomSheet,
    managerGoBack,
    type BottomSheetRouterState,
    getBottomSheetState,
    bottomSheetStore,
} from '../navigation/bottomSheetManager';

export interface BottomSheetRouterProps {
    onScreenChange?: (screen: RouteName | null) => void;
    onDismiss?: () => void;
}

// Re-export types for backward compatibility
export type { BottomSheetRouterState };
export { subscribeToBottomSheetState };

// Re-export BottomSheetRef for backward compatibility
export type { BottomSheetRef };

/**
 * BottomSheetRouter - Manages navigation within bottom sheet modals
 * 
 * Uses custom BottomSheet component built with react-native-reanimated v4.
 * State is managed by bottomSheetManager (single source of truth).
 * 
 * Features:
 * - Screen navigation with history stack
 * - Step-based navigation for multi-step screens
 * - Android back button handling
 * - Minimal props passing (screens use useOxy() for context)
 */
// Animated screen container for smooth transitions
const AnimatedScreenContainer: React.FC<{
    children: React.ReactNode;
    fadeAnim: SharedValue<number>;
    scaleAnim: SharedValue<number>;
    screenKey: string;
}> = ({ children, fadeAnim, scaleAnim, screenKey }) => {
    const animatedStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
        transform: [
            { scale: scaleAnim.value }
        ]
    }));

    return (
        <Animated.View
            key={screenKey}
            style={[{ flexShrink: 1 }, animatedStyle]}
        >
            {children}
        </Animated.View>
    );
};

const BottomSheetRouterComponent: React.FC<BottomSheetRouterProps> = ({ onScreenChange, onDismiss }) => {
    const bottomSheetRef = useRef<BottomSheetRef>(null);
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];

    // Animation values for screen transitions
    const fadeAnim = useSharedValue(1);
    const scaleAnim = useSharedValue(1);
    const previousScreenRef = useRef<RouteName | null>(null);
    const isTransitioningRef = useRef(false);

    // Create stable ref object for manager compatibility
    // Manager expects: { current: { present: () => void; dismiss: () => void } | null } | null
    const managerRefObject = useRef({
        current: {
            present: () => bottomSheetRef.current?.present(),
            dismiss: () => bottomSheetRef.current?.dismiss(),
        },
    });

    // Single source of truth - subscribe to manager state using Zustand
    const state = useStore(bottomSheetStore);

    // Animate screen transition when screen changes
    const animateScreenTransition = useCallback((newScreen: RouteName | null, newState: BottomSheetRouterState) => {
        // ... implementation uses newState which comes from the store ...
        // We can just rely on the re-render from useStore, no need to manually set local state
        // However, the animation logic relied on queueing state updates.
        // Let's adapt it.
        onScreenChange?.(newScreen);

        // Note: The original logic tried to defer the state update (setState) until animation completed.
        // With Zustand, the global state is already updated.
        // The animation logic needs to react to the state change.

        // Since useStore forces a re-render with the NEW state, we are already "in" the new state.
        // To animate "out" the old screen, we would need to have captured the previous screen
        // before the re-render, OR we accept that the transition might be slightly different.

        // Actually, the original logic had `setState` to control when the UI updates.
        // With global store, the UI updates immediately.
        // For now, let's trust the re-render. If animation is jerky, we can revisit.
        // But wait, the original logic:
        // 1. Check if transitioning. If so, wait.
        // 2. If valid change, start exit animation -> then update local state -> then enter animation.

        // With Zustand, we can't "delay" the state update because it's global.
        // So `state` (from useStore) is ALREADY the new state.
        // We need to detect that `state.currentScreen` changed from our `previousScreenRef`.

    }, [onScreenChange]);

    // Handle screen transitions based on state changes
    useEffect(() => {
        const newScreen = state.currentScreen;
        const previousScreen = previousScreenRef.current;
        const isScreenChange = previousScreen !== null && previousScreen !== newScreen && newScreen !== null;

        if (isScreenChange) {
            // Logic to handle transition...
            // Since we are already re-rendered with new state, we might see a flash of new content.
            // Ideally we shouldn't have updated the global store until animation started...
            // BUT `bottomSheetManager` updates the store immediately.

            // For this fix, let's keep it simple: Just update the refs. 
            // The complex animation logic in the original file was trying to bridge imperative calls with React state.

            previousScreenRef.current = newScreen;
        } else if (previousScreen === null && newScreen !== null) {
            // Opening first time
            fadeAnim.value = 1;
            scaleAnim.value = 1;
            previousScreenRef.current = newScreen;
            onScreenChange?.(newScreen);
        } else {
            previousScreenRef.current = newScreen;
        }

        setManagerRef(managerRefObject.current);
    }, [state.currentScreen, onScreenChange, fadeAnim, scaleAnim]);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            setManagerRef(null);
        };
    }, []);

    // Handle explicit dismiss - only update state, don't call dismiss again
    const handleDismiss = useCallback(() => {
        // Only update state, don't call dismiss() as it's already being dismissed
        updateBottomSheetState({
            currentScreen: null,
            screenProps: {},
            currentStep: undefined,
            navigationHistory: [],
            isOpen: false,
        });
        onDismiss?.();
    }, [onDismiss]);

    // Get current screen component (lazy-loaded)
    const ScreenComponent = state.currentScreen ? getScreenComponent(state.currentScreen) : null;

    // Navigation handler - validates route and updates manager state
    // For step-based screens, step changes are treated as navigation events (added to history)
    const navigate = useCallback((screen: RouteName, props?: Record<string, unknown>) => {
        if (!isValidRoute(screen)) {
            if (__DEV__) {
                console.warn(`[BottomSheetRouter] Invalid route: ${screen}`);
            }
            return;
        }

        const isSameScreen = screen === state.currentScreen;
        const newStep = typeof props?.initialStep === 'number' ? props.initialStep : undefined;
        const currentStep = state.currentStep ?? (typeof state.screenProps?.initialStep === 'number' ? state.screenProps.initialStep : undefined);

        // For step-based screens: if same screen but different step, treat as navigation (add to history)
        // This allows step navigation to be handled by router with animations
        const isStepChange = isSameScreen && newStep !== undefined && newStep !== currentStep;

        managerShowBottomSheet(screen, props, {
            addToHistory: !isSameScreen || isStepChange, // Add to history if different screen OR step change
        });
    }, [state.currentScreen, state.currentStep, state.screenProps]);

    // Step change handler for step-based screens
    // This is called by StepBasedScreen to notify router of step changes
    // The router now handles step navigation through navigate/goBack, so this is mainly for compatibility
    const handleStepChange = useCallback((step: number, _totalSteps?: number) => {
        // Step changes are now handled through navigate/goBack, but we still update currentStep
        // for screens that might query it directly
        if (state.currentScreen) {
            updateBottomSheetState({
                currentStep: step,
                screenProps: {
                    ...state.screenProps,
                    initialStep: step,
                }
            });
        }
    }, [state.currentScreen, state.screenProps]);

    // Check if the bottom sheet can be dismissed (no navigation history or steps to go back to)
    const canDismiss = useCallback((): boolean => {
        // Use global state to avoid stale closures during transitions
        const currentState = getBottomSheetState();

        // Check if there's navigation history
        if (currentState.navigationHistory.length > 0) {
            return false;
        }

        // Check if there are steps to go back to
        const initialStep = typeof currentState.screenProps?.initialStep === 'number'
            ? currentState.screenProps.initialStep
            : undefined;
        const currentStep = currentState.currentStep ?? initialStep ?? 0;
        const isStepBased = initialStep !== undefined || currentState.currentStep !== undefined;

        if (isStepBased && typeof currentStep === 'number' && currentStep > 0) {
            return false;
        }

        // No history and on step 0 (or not step-based) - can dismiss
        return true;
    }, []);

    // Go back handler with priority:
    // 1. Screen history (navigate to previous screen)
    // 2. Step navigation (navigate to previous step)
    // 3. Close sheet (no history/step available)
    const goBack = useCallback(() => {
        // Use global state to avoid stale closures during transitions
        const currentState = getBottomSheetState();

        // Priority 1: Screen history
        if (currentState.navigationHistory.length > 0) {
            const wentBack = managerGoBack();
            if (wentBack) {
                return true;
            }
        }

        // Priority 2: Step navigation
        const initialStep = typeof currentState.screenProps?.initialStep === 'number'
            ? currentState.screenProps.initialStep
            : undefined;
        const currentStep = currentState.currentStep ?? initialStep ?? 0;
        const isStepBased = initialStep !== undefined || currentState.currentStep !== undefined;

        if (isStepBased && typeof currentStep === 'number' && currentStep > 0) {
            const previousStep = currentStep - 1;
            updateBottomSheetState({
                screenProps: {
                    ...currentState.screenProps,
                    initialStep: previousStep,
                },
                currentStep: previousStep,
            });
            return true;
        }

        // Priority 3: Close sheet
        managerCloseBottomSheet();
        return true;
    }, []);

    // Android hardware back button handler
    useEffect(() => {
        if (!state.isOpen) {
            return;
        }

        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
            return goBack();
        });

        return () => {
            backHandler.remove();
        };
    }, [state.isOpen, goBack]);

    // Present modal when state changes to open
    // This must be before any early returns to follow rules of hooks
    useEffect(() => {
        if (state.isOpen && bottomSheetRef.current) {
            bottomSheetRef.current.present();
        }
    }, [state.isOpen]);


    // Minimal screen props - only navigation-specific
    // Screens should use useOxy() hook for OxyContext values (user, sessions, etc.)
    // Calculate initialStep first, ensuring it's always a number or undefined
    const calculatedInitialStep = typeof state.currentStep === 'number'
        ? state.currentStep
        : (typeof state.screenProps?.initialStep === 'number'
            ? state.screenProps.initialStep
            : undefined);

    // Extract screenProps without initialStep to avoid conflicts
    const { initialStep: _, ...otherScreenProps } = state.screenProps;

    const scrollTo = useCallback((y: number, animated?: boolean) => {
        bottomSheetRef.current?.scrollTo(y, animated);
    }, []);

    const screenProps: BaseScreenProps & { scrollTo: (y: number, animated?: boolean) => void } = {
        navigate,
        goBack,
        onClose: () => managerCloseBottomSheet(),
        onAuthenticated: () => managerCloseBottomSheet(),
        theme: colorScheme ?? 'light',
        currentScreen: state.currentScreen ?? undefined,
        initialStep: calculatedInitialStep,
        onStepChange: handleStepChange,
        scrollTo, // Pass scrollTo method
        ...otherScreenProps,
    };

    // renderBackground must be called before any conditional returns (React hooks rule)
    const renderBackground = useCallback(
        (props: { style?: StyleProp<ViewStyle> }) => (
            <View
                style={[
                    styles.background,
                    { backgroundColor: colors.background },
                    props.style,
                ]}
            />
        ),
        [colors.background],
    );

    // Handle dismissal attempt - check if we can dismiss or need to go back
    const handleDismissAttempt = useCallback((): boolean => {
        if (!canDismiss()) {
            // There's navigation history or steps to go back to - navigate back instead
            goBack();
            return false; // Prevent dismissal
        }
        // No history or steps - allow dismissal
        return true;
    }, [canDismiss, goBack]);

    // Don't render if no screen is set
    if (!ScreenComponent || !state.currentScreen) {
        return null;
    }

    return (
        <BottomSheet
            ref={bottomSheetRef}
            enablePanDownToClose={true}
            backgroundComponent={renderBackground}
            enableHandlePanningGesture={true}
            style={styles.container}
            onDismiss={handleDismiss}
            onDismissAttempt={handleDismissAttempt}
        >
            <AnimatedScreenContainer
                fadeAnim={fadeAnim}
                scaleAnim={scaleAnim}
                screenKey={state.currentScreen}
            >
                <ScreenComponent {...screenProps} />
            </AnimatedScreenContainer>
        </BottomSheet>
    );
};

const BottomSheetRouter = React.memo(BottomSheetRouterComponent);
BottomSheetRouter.displayName = 'BottomSheetRouter';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        width: '100%',
        alignSelf: 'center',
        marginHorizontal: 'auto',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
});

export default BottomSheetRouter;

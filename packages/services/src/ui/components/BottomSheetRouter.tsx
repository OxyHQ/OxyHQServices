import React, { useRef, useEffect, useCallback } from 'react';
import { BackHandler, View, StyleSheet, ScrollView, Keyboard, Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    type SharedValue,
} from 'react-native-reanimated';
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
            style={[{ flex: 1 }, animatedStyle]}
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

    // Single source of truth - subscribe to manager state
    const [state, setState] = React.useState<BottomSheetRouterState>(() => getBottomSheetState());

    // Animate screen transition when screen changes
    const animateScreenTransition = useCallback((newScreen: RouteName | null, newState: BottomSheetRouterState) => {
        if (isTransitioningRef.current) {
            // If already transitioning, queue this state update
            setTimeout(() => {
                setState(newState);
                onScreenChange?.(newScreen);
            }, 400); // Wait for current transition to complete
            return;
        }

        const previousScreen = previousScreenRef.current;
        const isScreenChange = previousScreen !== null && previousScreen !== newScreen && newScreen !== null;

        if (!isScreenChange) {
            // First screen or no screen - just set to visible and update state immediately
            fadeAnim.value = 1;
            scaleAnim.value = 1;
            previousScreenRef.current = newScreen;
            setState(newState);
            onScreenChange?.(newScreen);
            return;
        }

        isTransitioningRef.current = true;

        const applyScreenChange = () => {
            // Update state after fade-out completes
            setState(newState);
            onScreenChange?.(newScreen);
            previousScreenRef.current = newScreen;

            // Prepare new screen animation
            fadeAnim.value = 0;
            scaleAnim.value = 0.98;

            // Animate new screen in
            fadeAnim.value = withTiming(1, { duration: 220 });
            scaleAnim.value = withTiming(1, { duration: 220 }, (finished) => {
                if (finished) {
                    runOnJS(() => {
                        isTransitioningRef.current = false;
                    })();
                }
            });
        };

        // Animate current screen out
        scaleAnim.value = withTiming(0.98, { duration: 180 });
        fadeAnim.value = withTiming(0, { duration: 180 }, (finished) => {
            if (finished) {
                runOnJS(applyScreenChange)();
            }
        });
    }, [fadeAnim, scaleAnim, onScreenChange]);

    // Subscribe to state changes from manager
    useEffect(() => {
        const unsubscribe = subscribeToBottomSheetState((newState) => {
            const previousScreen = previousScreenRef.current;
            const newScreen = newState.currentScreen;

            // Animate transition if screen changed
            if (previousScreen !== newScreen) {
                animateScreenTransition(newScreen, newState);
            } else {
                // Same screen, just update state (e.g., props changed)
                setState(newState);
                onScreenChange?.(newScreen);
            }
        });

        setManagerRef(managerRefObject.current);

        return () => {
            unsubscribe();
            setManagerRef(null);
        };
    }, [animateScreenTransition, onScreenChange]);

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
    const navigate = useCallback((screen: RouteName, props?: Record<string, unknown>) => {
        if (!isValidRoute(screen)) {
            if (__DEV__) {
                console.warn(`[BottomSheetRouter] Invalid route: ${screen}`);
            }
            return;
        }

        const isSameScreen = screen === state.currentScreen;
        managerShowBottomSheet(screen, props, {
            addToHistory: !isSameScreen,
        });
    }, [state.currentScreen]);

    // Step change handler for step-based screens
    const handleStepChange = useCallback((step: number, _totalSteps?: number) => {
        updateBottomSheetState({ currentStep: step });
    }, []);

    // Go back handler with priority:
    // 1. Screen history (navigate to previous screen)
    // 2. Step navigation (navigate to previous step)
    // 3. Close sheet (no history/step available)
    const goBack = useCallback(() => {
        // Priority 1: Screen history
        if (state.navigationHistory.length > 0) {
            const wentBack = managerGoBack();
            if (wentBack) {
                return true;
            }
        }

        // Priority 2: Step navigation
        const initialStep = typeof state.screenProps?.initialStep === 'number'
            ? state.screenProps.initialStep
            : undefined;
        const currentStep = state.currentStep ?? initialStep ?? 0;
        const isStepBased = initialStep !== undefined || state.currentStep !== undefined;

        if (isStepBased && typeof currentStep === 'number' && currentStep > 0) {
            const previousStep = currentStep - 1;
            updateBottomSheetState({
                screenProps: {
                    ...state.screenProps,
                    initialStep: previousStep,
                },
                currentStep: previousStep,
            });
            return true;
        }

        // Priority 3: Close sheet
        managerCloseBottomSheet();
        return false;
    }, [state.navigationHistory.length, state.currentStep, state.screenProps]);

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

    // Handle keyboard visibility - update padding instantly
    useEffect(() => {
        if (!state.isOpen) {
            bottomSheetRef.current?.updateKeyboardPadding(0);
            return;
        }

        const showSubscription = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            (e) => {
                bottomSheetRef.current?.updateKeyboardPadding(e.endCoordinates.height);
            },
        );

        const hideSubscription = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => {
                bottomSheetRef.current?.updateKeyboardPadding(0);
            },
        );

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
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

    const screenProps: BaseScreenProps = {
        navigate,
        goBack,
        onClose: () => managerCloseBottomSheet(),
        onAuthenticated: () => managerCloseBottomSheet(),
        theme: colorScheme ?? 'light',
        currentScreen: state.currentScreen ?? undefined,
        initialStep: calculatedInitialStep,
        onStepChange: handleStepChange,
        ...otherScreenProps,
    };

    // Don't render if no screen is set
    if (!ScreenComponent || !state.currentScreen) {
        return null;
    }

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

    return (
        <BottomSheet
            ref={bottomSheetRef}
            enablePanDownToClose={true}
            backgroundComponent={renderBackground}
            enableHandlePanningGesture={true}
            style={styles.container}
            handleStyle={styles.handleStyle}
            handleIndicatorStyle={[
                styles.handleIndicatorStyle,
                { backgroundColor: colors.border },
            ]}
            onDismiss={handleDismiss}
        >
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <AnimatedScreenContainer
                    fadeAnim={fadeAnim}
                    scaleAnim={scaleAnim}
                    screenKey={state.currentScreen}
                >
                    <ScreenComponent {...screenProps} />
                </AnimatedScreenContainer>
            </ScrollView>
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
    handleStyle: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 20,
    },
    handleIndicatorStyle: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
});

export default BottomSheetRouter;

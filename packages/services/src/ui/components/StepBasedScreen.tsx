import type React from 'react';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    KeyboardAvoidingView,
    ScrollView,
    StatusBar,
    Platform,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    type SharedValue,
} from 'react-native-reanimated';
import { useThemeColors, createAuthStyles } from '../styles';
import type { BaseScreenProps, StepController } from '../navigation/types';
import type { RouteName } from '../navigation/routes';

export interface StepConfig {
    id: string;
    component: React.ComponentType<any>;
    props?: Record<string, any>;
    canProceed?: (stepData?: any) => boolean;
    onEnter?: () => void;
    onExit?: () => void;
}

export interface StepBasedScreenProps extends Omit<BaseScreenProps, 'navigate'> {
    steps: StepConfig[];
    initialStep?: number;
    showProgressIndicator?: boolean;
    enableAnimations?: boolean;
    onStepChange?: (currentStep: number, totalSteps: number) => void;
    onComplete?: (stepData: any[]) => void;
    stepData?: any[];
    navigate: (screen: RouteName, props?: Record<string, any>) => void;
    oxyServices: any; // Required services for step components
    getNavigationProps?: () => Record<string, unknown>; // Optional callback to extract navigation props from screen state
}

interface StepBasedScreenState {
    currentStep: number;
    stepData: any[];
    isTransitioning: boolean;
}

// Individual animated progress dot
const AnimatedProgressDot: React.FC<{
    isActive: boolean;
    colors: any;
    styles: any;
}> = ({ isActive, colors, styles }) => {
    const width = useSharedValue(isActive ? 12 : 6);
    const backgroundColor = useSharedValue(isActive ? colors.primary : colors.border);

    useEffect(() => {
        width.value = withTiming(isActive ? 12 : 6, { duration: 300 });
        backgroundColor.value = withTiming(
            isActive ? colors.primary : colors.border,
            { duration: 300 }
        );
    }, [isActive, colors.primary, colors.border, width, backgroundColor]);

    const animatedStyle = useAnimatedStyle(() => ({
        width: width.value,
        backgroundColor: backgroundColor.value,
    }));

    return (
        <Animated.View
            style={[
                styles.progressDot,
                animatedStyle,
            ]}
        />
    );
};

// Progress indicator component
const ProgressIndicator: React.FC<{
    currentStep: number;
    totalSteps: number;
    colors: any;
    styles: any;
}> = ({ currentStep, totalSteps, colors, styles }) => (
    <View style={styles.progressContainer}>
        {Array.from({ length: totalSteps }, (_, index) => (
            <AnimatedProgressDot
                key={index}
                isActive={currentStep === index}
                colors={colors}
                styles={styles}
            />
        ))}
    </View>
);

// Step container with animations
const AnimatedStepContainer: React.FC<{
    children: React.ReactNode;
    fadeAnim: SharedValue<number>;
    scaleAnim: SharedValue<number>;
    styles: any;
    stepKey: string;
}> = ({ children, fadeAnim, scaleAnim, styles, stepKey }) => {
    const animatedStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
        transform: [
            { scale: scaleAnim.value }
        ]
    }));

    return (
        <Animated.View
            key={stepKey}
            style={[styles.stepContainer, animatedStyle]}
        >
            {children}
        </Animated.View>
    );
};

const StepBasedScreen: React.FC<StepBasedScreenProps> = ({
    steps,
    initialStep = 0,
    showProgressIndicator = true,
    enableAnimations = true,
    onStepChange,
    onComplete,
    stepData = [],
    navigate,
    goBack,
    onAuthenticated,
    theme,
    oxyServices,
    stepControllerRef,
    currentScreen, // Current screen name for router-based step navigation
    getNavigationProps, // Optional callback to extract navigation props from screen state
}) => {
    // ========================================================================
    // State Management
    // ========================================================================
    const [state, setState] = useState<StepBasedScreenState>({
        currentStep: initialStep,
        stepData: [...stepData],
        isTransitioning: false,
    });

    // ========================================================================
    // Computed Values
    // ========================================================================
    const colors = useThemeColors(theme);
    const styles = useMemo(() => ({
        ...createAuthStyles(colors, theme),
        // Additional styles for step components
        modernHeader: {
            alignItems: 'flex-start' as const,
            width: '100%',
            marginBottom: 24,
        },
        modernTitle: {
            fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
            fontWeight: Platform.OS === 'web' ? 'bold' as const : undefined,
            fontSize: 42,
            lineHeight: 50.4, // 42 * 1.2
            marginBottom: 12,
            textAlign: 'left' as const,
        },
        modernSubtitle: {
            fontSize: 18,
            lineHeight: 24,
            textAlign: 'left' as const,
            opacity: 0.8,
        },
        modernInputContainer: {
            width: '100%',
        },
        button: {
            flexDirection: 'row' as const,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 18,
            paddingHorizontal: 32,
            borderRadius: 16,
            marginVertical: 8,
            gap: 8,
            width: '100%',
            ...Platform.select({
                web: {
                    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                },
                default: {
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 6,
                }
            }),
        },
        buttonText: {
            color: '#FFFFFF',
            fontSize: 16,
            fontWeight: '600' as const,
            letterSpacing: 0.5,
        },
        footerText: {
            fontSize: 14,
            lineHeight: 20,
        },
        footerTextContainer: {
            flexDirection: 'row' as const,
            justifyContent: 'center' as const,
            marginTop: 16,
        },
        linkText: {
            fontSize: 14,
            lineHeight: 20,
            fontWeight: '600' as const,
            textDecorationLine: 'underline' as const,
        },
        progressContainer: {
            flexDirection: 'row' as const,
            width: '100%',
            justifyContent: 'center' as const,
            marginTop: 24, // Space for bottom sheet handle (~20px) + small buffer
            marginBottom: 24, // Equal spacing below dots
        },
        progressDot: {
            height: 6,
            width: 6,
            borderRadius: 3,
            marginHorizontal: 3,
            backgroundColor: colors.border,
        },
    }), [colors, theme]);

    // ========================================================================
    // Animation Values
    // ========================================================================
    const fadeAnim = useSharedValue(1);
    const scaleAnim = useSharedValue(1);

    // ========================================================================
    // Refs for Callbacks
    // ========================================================================
    const onStepChangeRef = useRef(onStepChange);
    const onCompleteRef = useRef(onComplete);
    onStepChangeRef.current = onStepChange;
    onCompleteRef.current = onComplete;

    // ========================================================================
    // Effects
    // ========================================================================
    useEffect(() => {
        setState(prevState => ({
            ...prevState,
            stepData: [...stepData],
        }));
    }, [stepData]);

    // ========================================================================
    // Step Data Management
    // ========================================================================
    const updateStepData = useCallback((stepIndex: number, data: any) => {
        setState(prev => {
            const nextStepData = prev.stepData.slice();
            nextStepData[stepIndex] = data;
            return {
                ...prev,
                stepData: nextStepData,
            };
        });
    }, []);

    // ========================================================================
    // Animation & Transitions
    // ========================================================================
    const animateTransition = useCallback((nextStep: number) => {
        if (!enableAnimations) {
            setState(prev => ({ ...prev, currentStep: nextStep }));
            onStepChangeRef.current?.(nextStep, steps.length);
            // Call onEnter for new step when animations are disabled
            if (nextStep >= 0 && nextStep < steps.length) {
                const nextStepConfig = steps[nextStep];
                nextStepConfig?.onEnter?.();
            }
            return;
        }

        setState(prev => ({ ...prev, isTransitioning: true }));

        const applyStepChange = (targetStep: number, totalSteps: number) => {
            setState(prev => ({
                ...prev,
                currentStep: targetStep,
                isTransitioning: false,
            }));
            onStepChangeRef.current?.(targetStep, totalSteps);

            // Call onEnter for new step after state has updated
            if (targetStep >= 0 && targetStep < steps.length) {
                const newStepConfig = steps[targetStep];
                newStepConfig?.onEnter?.();
            }

            // Prepare next step animation
            fadeAnim.value = 0;
            scaleAnim.value = 0.98;

            fadeAnim.value = withTiming(1, { duration: 220 });
            scaleAnim.value = withTiming(1, { duration: 220 });
        };

        // Animate current step out
        scaleAnim.value = withTiming(0.98, { duration: 180 });
        fadeAnim.value = withTiming(0, { duration: 180 }, (finished) => {
            if (finished) {
                runOnJS(applyStepChange)(nextStep, steps.length);
            }
        });
    }, [enableAnimations, steps.length, fadeAnim, scaleAnim]);

    // Update step when initialStep prop changes (from router navigation)
    // All step navigation is managed by OxyRouter - this component just responds to prop changes
    useEffect(() => {
        if (__DEV__) {
            console.log('StepBasedScreen: initialStep prop changed', {
                initialStep,
                currentStep: state.currentStep,
                isTransitioning: state.isTransitioning,
            });
        }

        // Only update if prop actually changed and is different from current state
        if (initialStep !== undefined && initialStep !== state.currentStep && !state.isTransitioning) {
            const targetStep = initialStep;

            // Only proceed if the target step is valid
            if (targetStep < 0 || targetStep >= steps.length) {
                if (__DEV__) {
                    console.warn('StepBasedScreen: invalid target step', targetStep);
                }
                return;
            }

            if (__DEV__) {
                console.log('StepBasedScreen: updating step', {
                    from: state.currentStep,
                    to: targetStep,
                });
            }

            // Call onExit for current step before changing (if different)
            if (state.currentStep >= 0 && state.currentStep < steps.length && state.currentStep !== targetStep) {
                const currentStepConfig = steps[state.currentStep];
                currentStepConfig?.onExit?.();
            }

            // Use animateTransition to handle animation and state update
            // onEnter will be called by animateTransition when step change completes
            animateTransition(targetStep);
        }
    }, [initialStep, state.currentStep, state.isTransitioning, steps, animateTransition]);

    // ========================================================================
    // Step Navigation
    // ========================================================================
    // All step navigation is managed by OxyRouter
    const nextStep = useCallback(() => {
        if (state.isTransitioning) return;

        const currentStepConfig = steps[state.currentStep];
        if (currentStepConfig?.canProceed) {
            const stepData = state.stepData[state.currentStep];
            if (!currentStepConfig.canProceed(stepData)) {
                return; // Step validation failed
            }
        }

        if (state.currentStep < steps.length - 1) {
            const nextStepIndex = state.currentStep + 1;

            // All navigation is managed by OxyRouter - just call navigate
            // Extract props to preserve them across navigation
            const navigationProps: Record<string, unknown> = { initialStep: nextStepIndex };

            // Use extraction callback if provided (gets latest values directly from screen state)
            // Otherwise fall back to extracting from stepData prop
            if (getNavigationProps) {
                const extractedProps = getNavigationProps();
                Object.assign(navigationProps, extractedProps);

                if (__DEV__) {
                    console.log('StepBasedScreen: nextStep navigation (using getNavigationProps)', {
                        nextStepIndex,
                        extractedProps,
                        navigationProps,
                    });
                }
            } else {
                // Fallback: Extract props from stepData prop (not state) to preserve state across navigation
                // Priority: step 0 first (where initial form data is usually stored), then other steps
                // This ensures username, userProfile, email, etc. are preserved when navigating between steps
                const step0Data = stepData[0] || {};
                const currentStepData = stepData[state.currentStep] || {};

                // Extract from step 0 first (has priority), then fallback to current step or other steps
                if (step0Data.username) {
                    navigationProps.username = step0Data.username;
                } else if (currentStepData.username) {
                    navigationProps.username = currentStepData.username;
                }

                if (step0Data.userProfile) {
                    navigationProps.userProfile = step0Data.userProfile;
                } else if (currentStepData.userProfile) {
                    navigationProps.userProfile = currentStepData.userProfile;
                }

                if (step0Data.email) {
                    navigationProps.email = step0Data.email;
                } else if (currentStepData.email) {
                    navigationProps.email = currentStepData.email;
                }

                if (__DEV__) {
                    console.log('StepBasedScreen: nextStep navigation (using stepData)', {
                        nextStepIndex,
                        step0Data: {
                            hasUsername: !!step0Data.username,
                            hasUserProfile: !!step0Data.userProfile
                        },
                        navigationProps,
                    });
                }
            }

            if (currentScreen && navigate) {
                navigate(currentScreen, navigationProps);
            } else {
                if (__DEV__) {
                    console.warn('StepBasedScreen: navigate function not available', {
                        currentScreen,
                        hasNavigate: !!navigate,
                    });
                }
            }
        } else {
            // Final step - call onComplete
            onCompleteRef.current?.(state.stepData);
        }
    }, [state.currentStep, state.isTransitioning, steps, currentScreen, navigate, stepData, getNavigationProps]); // Include getNavigationProps in dependencies

    const prevStep = useCallback(() => {
        if (state.isTransitioning) return;

        // Only navigate back if we're not on the first step
        // If we're on the first step, prevent back navigation to avoid closing the screen
        if (state.currentStep > 0) {
            // All back navigation is managed by OxyRouter's goBack
            // This will restore the previous step's props from router history
            goBack?.();
        }
    }, [state.isTransitioning, state.currentStep, goBack]);

    const goToStep = useCallback((stepIndex: number) => {
        if (state.isTransitioning || stepIndex < 0 || stepIndex >= steps.length) return;

        if (stepIndex !== state.currentStep) {
            // All navigation is managed by OxyRouter - just call navigate
            // Extract props to preserve state across navigation
            const navigationProps: Record<string, unknown> = { initialStep: stepIndex };

            // Use extraction callback if provided, otherwise fall back to stepData
            if (getNavigationProps) {
                const extractedProps = getNavigationProps();
                Object.assign(navigationProps, extractedProps);
            } else {
                // Preserve props from step 0 (where initial form data is usually stored)
                const step0Data = stepData[0] || {};
                if (step0Data.username) navigationProps.username = step0Data.username;
                if (step0Data.userProfile) navigationProps.userProfile = step0Data.userProfile;
                if (step0Data.email) navigationProps.email = step0Data.email;
            }

            if (currentScreen && navigate) {
                navigate(currentScreen, navigationProps);
            } else {
                if (__DEV__) {
                    console.warn('StepBasedScreen: navigate function not available');
                }
            }
        }
    }, [state.currentStep, state.isTransitioning, steps, currentScreen, navigate, stepData, getNavigationProps]);

    // ========================================================================
    // Step Controller Exposure
    // ========================================================================
    useEffect(() => {
        if (!stepControllerRef) return;

        stepControllerRef.current = {
            canGoBack: () => state.currentStep > 0,
            goBack: prevStep,
        };

        return () => {
            stepControllerRef.current = null;
        };
    }, [state.currentStep, prevStep, stepControllerRef]);

    // ========================================================================
    // Step Component & Props
    // ========================================================================
    const currentStepConfig = steps[state.currentStep];
    const CurrentStepComponent = currentStepConfig?.component;

    const updateCurrentStepData = useCallback(
        (data: any) => updateStepData(state.currentStep, data),
        [state.currentStep, updateStepData]
    );

    const stepProps = useMemo(() => ({
        ...currentStepConfig?.props,
        // Common props
        colors,
        styles,
        theme,
        navigate,
        goBack,
        onAuthenticated,
        oxyServices,

        // Step navigation
        nextStep,
        prevStep,
        goToStep,
        currentStep: state.currentStep,
        totalSteps: steps.length,

        // Step data - spread the step data properties directly as props
        ...state.stepData[state.currentStep],

        // Step data management
        updateStepData: updateCurrentStepData,
        allStepData: state.stepData,

        // State
        isTransitioning: state.isTransitioning,

        // Animation refs (for components that need direct access)
        fadeAnim,
        scaleAnim,
    }), [
        currentStepConfig?.props,
        colors,
        styles,
        theme,
        navigate,
        goBack,
        onAuthenticated,
        oxyServices,
        nextStep,
        prevStep,
        goToStep,
        state.currentStep,
        state.stepData,
        state.isTransitioning,
        steps.length,
        updateCurrentStepData,
        fadeAnim,
        scaleAnim,
    ]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={false}
                alwaysBounceVertical={false}
                overScrollMode="never"
            >
                {showProgressIndicator && steps.length > 1 && (
                    <ProgressIndicator
                        currentStep={state.currentStep}
                        totalSteps={steps.length}
                        colors={colors}
                        styles={styles}
                    />
                )}

                <AnimatedStepContainer
                    fadeAnim={fadeAnim}
                    scaleAnim={scaleAnim}
                    styles={styles}
                    stepKey={`step-${state.currentStep}`}
                >
                    {CurrentStepComponent && (
                        <CurrentStepComponent {...stepProps} />
                    )}
                </AnimatedStepContainer>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

export default StepBasedScreen;

import type React from 'react';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    KeyboardAvoidingView,
    ScrollView,
    StatusBar,
    Platform,
    StyleSheet,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSequence,
    withDelay,
    withSpring,
    runOnJS,
    interpolate,
} from 'react-native-reanimated';
import { useThemeColors, createAuthStyles } from '../styles';
import type { BaseScreenProps } from '../navigation/types';

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
    navigate: (screen: string, props?: Record<string, any>) => void;
    oxyServices: any; // Required services for step components
}

interface StepBasedScreenState {
    currentStep: number;
    stepData: any[];
    isTransitioning: boolean;
}

// Progress indicator component
const ProgressIndicator: React.FC<{
    currentStep: number;
    totalSteps: number;
    colors: any;
    styles: any;
}> = ({ currentStep, totalSteps, colors, styles }) => (
    <View style={styles.progressContainer}>
        {Array.from({ length: totalSteps }, (_, index) => (
            <View
                key={index}
                style={[
                    styles.progressDot,
                    currentStep === index
                        ? { backgroundColor: colors.primary, width: 24 }
                        : { backgroundColor: colors.border }
                ]}
            />
        ))}
    </View>
);

// Step container with animations
const AnimatedStepContainer: React.FC<{
    children: React.ReactNode;
    fadeAnim: Animated.SharedValue<number>;
    slideAnim: Animated.SharedValue<number>;
    scaleAnim: Animated.SharedValue<number>;
    styles: any;
    stepKey: string;
}> = ({ children, fadeAnim, slideAnim, scaleAnim, styles, stepKey }) => {
    const animatedStyle = useAnimatedStyle(() => ({
        opacity: fadeAnim.value,
        transform: [
            { translateX: slideAnim.value },
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
}) => {
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
            letterSpacing: -0.5,
        },
        modernSubtitle: {
            fontSize: 18,
            lineHeight: 24,
            textAlign: 'left' as const,
            opacity: 0.8,
        },
        modernInputContainer: {
            width: '100%',
            marginBottom: 24,
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
    }), [colors, theme]);

    // State management
    const [state, setState] = useState<StepBasedScreenState>({
        currentStep: initialStep,
        stepData: stepData,
        isTransitioning: false,
    });

    // Update state when stepData prop changes
    useEffect(() => {
        setState(prevState => ({
            ...prevState,
            stepData: stepData,
        }));
    }, [stepData]);

    // Animation values
    const fadeAnim = useSharedValue(1);
    const slideAnim = useSharedValue(0);
    const scaleAnim = useSharedValue(1);

    // Refs for animation callbacks
    const onStepChangeRef = useRef(onStepChange);
    const onCompleteRef = useRef(onComplete);
    onStepChangeRef.current = onStepChange;
    onCompleteRef.current = onComplete;

    // Update step data
    const updateStepData = useCallback((stepIndex: number, data: any) => {
        setState(prev => ({
            ...prev,
            stepData: prev.stepData.map((item, index) =>
                index === stepIndex ? data : item
            ),
        }));
    }, [setState]);

    // Animation transition function
    const animateTransition = useCallback((nextStep: number) => {
        if (!enableAnimations) {
            setState(prev => ({ ...prev, currentStep: nextStep }));
            onStepChangeRef.current?.(nextStep, steps.length);
            return;
        }

        setState(prev => ({ ...prev, isTransitioning: true }));

        // Scale down current content
        scaleAnim.value = withSequence(
            withTiming(0.95, { duration: 150 }),
            withTiming(0.95, { duration: 50 })
        );

        fadeAnim.value = withSequence(
            withTiming(0, { duration: 200 }),
            withTiming(0, { duration: 50 }, (finished) => {
                if (finished) {
                    runOnJS(() => {
                        setState(prev => ({
                            ...prev,
                            currentStep: nextStep,
                            isTransitioning: false
                        }));
                        onStepChangeRef.current?.(nextStep, steps.length);
                    })();

                    // Reset animations with proper timing
                    slideAnim.value = withDelay(16, withTiming(-50, { duration: 0 }));
                    scaleAnim.value = withDelay(16, withTiming(0.95, { duration: 0 }));

                    // Animate in new content
                    fadeAnim.value = withDelay(16, withTiming(1, { duration: 300 }));
                    slideAnim.value = withDelay(16, withSpring(0, {
                        damping: 15,
                        stiffness: 200,
                    }));
                    scaleAnim.value = withDelay(16, withSpring(1, {
                        damping: 15,
                        stiffness: 200,
                    }));
                }
            })
        );
    }, [fadeAnim, slideAnim, scaleAnim, enableAnimations, steps.length]);

    // Navigation functions
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
            // Call onExit for current step
            currentStepConfig?.onExit?.();

            animateTransition(state.currentStep + 1);

            // Call onEnter for next step
            const nextStepConfig = steps[state.currentStep + 1];
            nextStepConfig?.onEnter?.();
        } else {
            // Final step - call onComplete
            onCompleteRef.current?.(state.stepData);
        }
    }, [state.currentStep, state.stepData, state.isTransitioning, steps, animateTransition]);

    const prevStep = useCallback(() => {
        if (state.isTransitioning) return;

        if (state.currentStep > 0) {
            // Call onExit for current step
            const currentStepConfig = steps[state.currentStep];
            currentStepConfig?.onExit?.();

            animateTransition(state.currentStep - 1);

            // Call onEnter for previous step
            const prevStepConfig = steps[state.currentStep - 1];
            prevStepConfig?.onEnter?.();
        } else {
            // First step - go back
            goBack?.();
        }
    }, [state.currentStep, state.isTransitioning, steps, animateTransition, goBack]);

    const goToStep = useCallback((stepIndex: number) => {
        if (state.isTransitioning || stepIndex < 0 || stepIndex >= steps.length) return;

        if (stepIndex !== state.currentStep) {
            // Call onExit for current step
            const currentStepConfig = steps[state.currentStep];
            currentStepConfig?.onExit?.();

            animateTransition(stepIndex);

            // Call onEnter for target step
            const targetStepConfig = steps[stepIndex];
            targetStepConfig?.onEnter?.();
        }
    }, [state.currentStep, state.isTransitioning, steps, animateTransition]);

    // Get current step component
    const currentStepConfig = steps[state.currentStep];
    const CurrentStepComponent = currentStepConfig?.component;

    // Enhanced props for the step component
    const stepProps = {
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
        updateStepData: (data: any) => updateStepData(state.currentStep, data),
        allStepData: state.stepData,

        // State
        isTransitioning: state.isTransitioning,

        // Animation refs (for components that need direct access)
        fadeAnim,
        slideAnim,
        scaleAnim,
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                removeClippedSubviews={true}
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
                    slideAnim={slideAnim}
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

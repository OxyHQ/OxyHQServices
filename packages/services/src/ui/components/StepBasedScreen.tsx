import type React from 'react';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Platform,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
} from 'react-native-reanimated';
import { useThemeColors, createAuthStyles } from '../styles';
import { fontFamilies } from '../styles/fonts';
import type { BaseScreenProps, StepController } from '../types/navigation';
import type { RouteName } from '../types/navigation';
import { screenContentStyle } from '../constants/spacing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
    stepData: any[];
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

// Step container - animations are now handled by router

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
    // Router now handles step navigation - we just track step data
    const [state, setState] = useState<StepBasedScreenState>({
        stepData: [...stepData],
    });

    // Current step comes from router via initialStep prop
    const currentStep = initialStep ?? 0;

    // ========================================================================
    // Computed Values
    // ========================================================================
    // Narrow theme type with default value
    const themeValue = (theme === 'light' || theme === 'dark') ? theme : 'light';
    const themeString = typeof theme === 'string' ? theme : 'light';
    const colors = useThemeColors(themeValue);
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => ({
        ...createAuthStyles(colors, themeString),
        // Additional styles for step components
        modernHeader: {
            alignItems: 'flex-start' as const,
            width: '100%',
            marginBottom: 24,
        },
        modernTitle: {
            fontFamily: fontFamilies.interBold,
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
            marginBottom: 0, // BottomSheet handles all bottom spacing
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
    // Animation Values (removed - router handles animations now)
    // ========================================================================

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
    // Step Change Effects
    // ========================================================================
    // Router handles all step navigation - we just respond to prop changes
    useEffect(() => {
        // Validate step
        if (currentStep < 0 || currentStep >= steps.length) {
            if (__DEV__) {
                console.warn('StepBasedScreen: invalid step', currentStep);
            }
            return;
        }

        // Call onEnter for current step
        const currentStepConfig = steps[currentStep];
        currentStepConfig?.onEnter?.();

        // Notify parent of step change
        onStepChangeRef.current?.(currentStep, steps.length);

        // Cleanup: call onExit when step changes
        return () => {
            if (currentStepConfig?.onExit) {
                currentStepConfig.onExit();
            }
        };
    }, [currentStep, steps]);

    // ========================================================================
    // Step Navigation
    // ========================================================================
    // All step navigation is now handled by router - these functions use router's navigate/goBack
    const nextStep = useCallback(() => {
        const currentStepConfig = steps[currentStep];
        if (currentStepConfig?.canProceed) {
            const stepData = state.stepData[currentStep];
            if (!currentStepConfig.canProceed(stepData)) {
                return; // Step validation failed
            }
        }

        if (currentStep < steps.length - 1) {
            const nextStepIndex = currentStep + 1;

            // Extract props to preserve them across navigation
            const navigationProps: Record<string, unknown> = { initialStep: nextStepIndex };

            // Use extraction callback if provided
            if (getNavigationProps) {
                const extractedProps = getNavigationProps();
                Object.assign(navigationProps, extractedProps);
            } else {
                // Fallback: Extract props from stepData
                const step0Data = stepData[0] || {};
                const currentStepData = stepData[currentStep] || {};

                if (step0Data.username || currentStepData.username) {
                    navigationProps.username = step0Data.username || currentStepData.username;
                }
                if (step0Data.userProfile || currentStepData.userProfile) {
                    navigationProps.userProfile = step0Data.userProfile || currentStepData.userProfile;
                }
                if (step0Data.email || currentStepData.email) {
                    navigationProps.email = step0Data.email || currentStepData.email;
                }
            }

            // Router handles step navigation with animations
            if (currentScreen && navigate && typeof currentScreen === 'string') {
                navigate(currentScreen as RouteName, navigationProps);
            }
        } else {
            // Final step - call onComplete
            onCompleteRef.current?.(state.stepData);
        }
    }, [currentStep, steps, currentScreen, navigate, state.stepData, getNavigationProps, stepData]);

    const prevStep = useCallback(() => {
        // Use router's goBack - it handles step navigation automatically
        if (currentStep > 0 && typeof goBack === 'function') {
            goBack();
        } else if (typeof goBack === 'function') {
            // On first step, goBack will check screen history or close
            goBack();
        }
    }, [currentStep, goBack]);

    const goToStep = useCallback((stepIndex: number) => {
        if (stepIndex < 0 || stepIndex >= steps.length || stepIndex === currentStep) return;

        // Extract props to preserve state
        const navigationProps: Record<string, unknown> = { initialStep: stepIndex };

        if (getNavigationProps) {
            const extractedProps = getNavigationProps();
            Object.assign(navigationProps, extractedProps);
        } else {
            const step0Data = stepData[0] || {};
            if (step0Data.username) navigationProps.username = step0Data.username;
            if (step0Data.userProfile) navigationProps.userProfile = step0Data.userProfile;
            if (step0Data.email) navigationProps.email = step0Data.email;
        }

        // Router handles step navigation with animations
        if (currentScreen && navigate && typeof currentScreen === 'string') {
            navigate(currentScreen as RouteName, navigationProps);
        }
    }, [currentStep, steps, currentScreen, navigate, stepData, getNavigationProps]);

    // ========================================================================
    // Step Controller Exposure
    // ========================================================================
    useEffect(() => {
        if (!stepControllerRef || typeof stepControllerRef !== 'object' || !('current' in stepControllerRef)) return;

        stepControllerRef.current = {
            canGoBack: () => currentStep > 0,
            goBack: prevStep,
        };

        return () => {
            if (stepControllerRef && typeof stepControllerRef === 'object' && 'current' in stepControllerRef) {
                stepControllerRef.current = null;
            }
        };
    }, [currentStep, prevStep, stepControllerRef]);

    // ========================================================================
    // Step Component & Props
    // ========================================================================
    const currentStepConfig = steps[currentStep];
    const CurrentStepComponent = currentStepConfig?.component;

    const updateCurrentStepData = useCallback(
        (data: any) => updateStepData(currentStep, data),
        [currentStep, updateStepData]
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
        currentStep: currentStep,
        totalSteps: steps.length,

        // Step data - spread the step data properties directly as props
        ...state.stepData[currentStep],

        // Step data management
        updateStepData: updateCurrentStepData,
        allStepData: state.stepData,
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
        currentStep,
        state.stepData,
        steps.length,
        updateCurrentStepData,
    ]);

    // Pure content wrapper - all layout is handled by BottomSheetRouter
    // This component only renders content, no layout calculations
    // Add safe area insets to bottom padding so content doesn't sit under safe area
    const contentStyle = useMemo(() => ({
        ...screenContentStyle,
        paddingBottom: screenContentStyle.paddingBottom + insets.bottom,
    }), [insets.bottom]);

    return (
        <View style={contentStyle}>
            {showProgressIndicator && steps.length > 1 && (
                <ProgressIndicator
                    currentStep={currentStep}
                    totalSteps={steps.length}
                    colors={colors}
                    styles={styles}
                />
            )}

            {/* Router handles animations now - no need for AnimatedStepContainer */}
            <View style={styles.stepContainer}>
                {CurrentStepComponent && (
                    <CurrentStepComponent {...stepProps} />
                )}
            </View>
        </View>
    );
};

export default StepBasedScreen;

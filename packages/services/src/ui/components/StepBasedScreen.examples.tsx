// =============================================================================
// StepBasedScreen Usage Examples
// =============================================================================
// This file demonstrates how to use the StepBasedScreen component for different
// multi-step flows like SignUp, RecoverAccount, and other similar screens.

import React, { useState, useCallback } from 'react';
import StepBasedScreen, { type StepConfig } from './StepBasedScreen';
import type { BaseScreenProps } from '../navigation/types';

// =============================================================================
// Example 1: SignUp Screen with Multiple Steps
// =============================================================================

interface SignUpFormData {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
}

const SignUpScreenExample: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
}) => {
    const [formData, setFormData] = useState<SignUpFormData>({
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
    });

    const [validationState, setValidationState] = useState({
        username: { status: 'idle' as 'idle' | 'validating' | 'valid' | 'invalid', message: '' },
        email: { status: 'idle' as 'idle' | 'validating' | 'valid' | 'invalid', message: '' },
        password: { status: 'idle' as 'idle' | 'validating' | 'valid' | 'invalid', message: '' },
    });

    const updateFormField = useCallback((field: keyof SignUpFormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    const validateUsername = useCallback(async (username: string) => {
        // Username validation logic here
        return username.length >= 3;
    }, []);

    const validateEmail = useCallback((email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }, []);

    const validatePassword = useCallback((password: string) => {
        return password.length >= 8;
    }, []);

    // Step components would be defined in separate files
    const IdentityStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Username and Email inputs */}
        </div>
    );

    const SecurityStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Password inputs */}
        </div>
    );

    const SummaryStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Form summary and submit */}
        </div>
    );

    const steps: StepConfig[] = [
        {
            id: 'identity',
            component: IdentityStep,
            canProceed: () =>
                !!(formData.username.trim() &&
                    formData.email.trim() &&
                    validateEmail(formData.email) &&
                    validationState.username.status === 'valid'),
            onEnter: async () => {
                if (formData.username && validationState.username.status === 'idle') {
                    const isValid = await validateUsername(formData.username);
                    setValidationState(prev => ({
                        ...prev,
                        username: {
                            status: isValid ? 'valid' : 'invalid',
                            message: isValid ? '' : 'Username is already taken'
                        }
                    }));
                }
            },
        },
        {
            id: 'security',
            component: SecurityStep,
            canProceed: () =>
                !!(formData.password &&
                    validatePassword(formData.password) &&
                    formData.password === formData.confirmPassword),
        },
        {
            id: 'summary',
            component: SummaryStep,
            canProceed: () => true, // Always allow proceeding to final step
        },
    ];

    const handleComplete = useCallback(async (stepData: any[]) => {
        try {
            // Perform sign up with collected data
            console.log('Signing up with data:', formData);
            // Navigate to welcome screen or handle authentication
            navigate('WelcomeNewUser', { newUser: { /* user data */ } });
        } catch (error) {
            console.error('Sign up failed:', error);
        }
    }, [formData, navigate]);

    const stepData = [
        {
            formData,
            updateFormField,
            validationState,
            setValidationState,
        },
        {
            formData,
            updateFormField,
            validatePassword,
        },
        {
            formData,
            onSignUp: handleComplete,
        },
    ];

    return (
        <StepBasedScreen
            steps={steps}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate}
            goBack={goBack}
            onAuthenticated={onAuthenticated}
            theme={theme}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};

// =============================================================================
// Example 2: Recover Account Screen with 3 Steps
// =============================================================================

const RecoverAccountScreenExample: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
}) => {
    const [identifier, setIdentifier] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const RequestStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Email/Username input */}
        </div>
    );

    const VerifyStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* PIN input */}
        </div>
    );

    const SuccessStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Success message and next actions */}
        </div>
    );

    const steps: StepConfig[] = [
        {
            id: 'request',
            component: RequestStep,
            canProceed: () => identifier.trim().length > 0,
            onEnter: () => {
                // Reset state when entering request step
                setError('');
            },
        },
        {
            id: 'verify',
            component: VerifyStep,
            canProceed: () => verificationCode.length === 6,
            onEnter: async () => {
                // Send verification code when entering verify step
                setIsLoading(true);
                try {
                    // Simulate API call
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    setIsLoading(false);
                } catch (err) {
                    setError('Failed to send verification code');
                    setIsLoading(false);
                }
            },
        },
        {
            id: 'success',
            component: SuccessStep,
            canProceed: () => true,
            onEnter: () => {
                // Handle successful verification
                console.log('Account recovery successful');
            },
        },
    ];

    const handleComplete = useCallback((stepData: any[]) => {
        // Navigate back to sign in or to password reset
        navigate('SignIn');
    }, [navigate]);

    const stepData = [
        {
            identifier,
            setIdentifier,
            error,
            setError,
            isLoading,
        },
        {
            verificationCode,
            setVerificationCode,
            error,
            setError,
            isLoading,
            setIsLoading,
        },
        {
            identifier,
            onContinue: () => navigate('ResetPassword', { identifier }),
        },
    ];

    return (
        <StepBasedScreen
            steps={steps}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate}
            goBack={goBack}
            theme={theme}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};

// =============================================================================
// Example 3: Onboarding Flow with 4 Steps
// =============================================================================

const OnboardingScreenExample: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
}) => {
    const [onboardingData, setOnboardingData] = useState({
        name: '',
        interests: [] as string[],
        notifications: true,
        theme: 'system' as 'light' | 'dark' | 'system',
    });

    const WelcomeStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Welcome message */}
        </div>
    );

    const ProfileStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Name and avatar setup */}
        </div>
    );

    const PreferencesStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Interests selection */}
        </div>
    );

    const SettingsStep: React.FC<any> = ({ /* props */ }) => (
        <div>
            {/* Notification and theme preferences */}
        </div>
    );

    const steps: StepConfig[] = [
        {
            id: 'welcome',
            component: WelcomeStep,
            canProceed: () => true, // Always allow proceeding from welcome
        },
        {
            id: 'profile',
            component: ProfileStep,
            canProceed: () => onboardingData.name.trim().length > 0,
        },
        {
            id: 'preferences',
            component: PreferencesStep,
            canProceed: () => onboardingData.interests.length > 0,
        },
        {
            id: 'settings',
            component: SettingsStep,
            canProceed: () => true, // Always allow completing settings
        },
    ];

    const handleComplete = useCallback(async (stepData: any[]) => {
        try {
            // Save onboarding data
            console.log('Saving onboarding data:', onboardingData);
            // Complete onboarding and navigate to main app
            navigate('MainApp');
        } catch (error) {
            console.error('Failed to save onboarding data:', error);
        }
    }, [onboardingData, navigate]);

    const stepData = [
        { /* Welcome step data */ },
        {
            onboardingData,
            setOnboardingData,
        },
        {
            onboardingData,
            setOnboardingData,
        },
        {
            onboardingData,
            setOnboardingData,
            onComplete: handleComplete,
        },
    ];

    return (
        <StepBasedScreen
            steps={steps}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate}
            goBack={goBack}
            onAuthenticated={onAuthenticated}
            theme={theme}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};

// =============================================================================
// Example 4: Advanced Configuration with Custom Validation
// =============================================================================

interface AdvancedStepConfig extends StepConfig {
    title: string;
    description: string;
    estimatedDuration?: number; // in seconds
    isOptional?: boolean;
}

const AdvancedFlowScreenExample: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
}) => {
    const [currentStepData, setCurrentStepData] = useState<any>({});

    const steps: AdvancedStepConfig[] = [
        {
            id: 'personalization',
            title: 'Personalize Your Experience',
            description: 'Tell us about your preferences',
            component: () => <div>Personalization form</div>,
            canProceed: () => true,
            estimatedDuration: 30,
        },
        {
            id: 'security-setup',
            title: 'Security Setup',
            description: 'Configure your security preferences',
            component: () => <div>Security setup form</div>,
            canProceed: (data) => data?.securityLevel !== undefined,
            estimatedDuration: 60,
        },
        {
            id: 'optional-integrations',
            title: 'Integrations (Optional)',
            description: 'Connect with other services',
            component: () => <div>Integrations setup</div>,
            canProceed: () => true,
            isOptional: true,
            estimatedDuration: 45,
        },
    ];

    const handleStepChange = useCallback((currentStep: number, totalSteps: number) => {
        console.log(`Step changed: ${currentStep + 1}/${totalSteps}`);
        // Could show step title, description, estimated time, etc.
    }, []);

    const handleComplete = useCallback((stepData: any[]) => {
        console.log('Advanced flow completed with data:', stepData);
        navigate('Dashboard');
    }, [navigate]);

    return (
        <StepBasedScreen
            steps={steps}
            stepData={[currentStepData]}
            onComplete={handleComplete}
            onStepChange={handleStepChange}
            navigate={navigate}
            goBack={goBack}
            theme={theme}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};

export {
    SignUpScreenExample,
    RecoverAccountScreenExample,
    OnboardingScreenExample,
    AdvancedFlowScreenExample
};

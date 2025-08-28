import type React from 'react';
import { useState, useRef, useCallback } from 'react';
import type { BaseScreenProps } from '../navigation/types';
import { useThemeColors } from '../styles';
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';
import RecoverRequestStep from './steps/RecoverRequestStep';
import RecoverVerifyStep from './steps/RecoverVerifyStep';
import RecoverSuccessStep from './steps/RecoverSuccessStep';

// Constants
const PIN_LENGTH = 6;

// Main component
const RecoverAccountScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
}) => {
    const colors = useThemeColors(theme);

    // Form state
    const [identifier, setIdentifier] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Handle back navigation based on return parameters
    const handleBack = useCallback(() => {
        if (returnTo && returnStep !== undefined) {
            navigate(returnTo, {
                initialStep: returnStep,
                ...returnData
            });
        } else {
            navigate('SignIn');
        }
    }, [navigate, returnTo, returnStep, returnData]);

    // Step configurations
    const steps: StepConfig[] = [
        {
            id: 'request',
            component: RecoverRequestStep,
            canProceed: () => identifier.trim().length >= 3,
            onEnter: () => {
                // Reset messages when entering request step
                setErrorMessage('');
                setSuccessMessage('');
            },
        },
        {
            id: 'verify',
            component: RecoverVerifyStep,
            canProceed: () => verificationCode.length === PIN_LENGTH,
            onEnter: () => {
                // Simulate sending verification code
                setIsLoading(true);
                setTimeout(() => {
                    setIsLoading(false);
                    setSuccessMessage('A 6-digit code has been sent to your email or phone.');
                }, 1000);
            },
        },
        {
            id: 'success',
            component: RecoverSuccessStep,
            canProceed: () => true,
            onEnter: () => {
                setSuccessMessage('Your account has been verified! You can now reset your password.');
            },
        },
    ];

    // Handle completion
    const handleComplete = useCallback((stepData: any[]) => {
        // Final step completed - could navigate to password reset
        console.log('Account recovery completed');
    }, []);

    // Step data for the reusable component
    const stepData = [
        // Request step
        {
            identifier,
            setIdentifier,
            errorMessage,
            setErrorMessage,
            isLoading,
            setIsLoading,
        },
        // Verify step
        {
            verificationCode,
            setVerificationCode,
            errorMessage,
            setErrorMessage,
            successMessage,
            setSuccessMessage,
            isLoading,
            setIsLoading,
        },
        // Success step
        {
            successMessage,
        },
    ];

    return (
        <StepBasedScreen
            steps={steps}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate}
            goBack={handleBack}
            theme={theme}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};



export default RecoverAccountScreen; 
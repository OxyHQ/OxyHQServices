import type React from 'react';
import { useState, useRef, useCallback } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeColors } from '../styles';
import { useOxy } from '../context/OxyContext';
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';
import RecoverRequestStep from './steps/RecoverRequestStep';
import RecoverVerifyStep from './steps/RecoverVerifyStep';
import RecoverSuccessStep from './steps/RecoverSuccessStep';
import RecoverResetPasswordStep from './steps/RecoverResetPasswordStep';

// Constants
const PIN_LENGTH = 6;

// Main component
const RecoverAccountScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
    initialStep,
    currentScreen,
}) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices } = useOxy();
    const colors = useThemeColors(theme);
    const { t } = useI18n();

    // Form state
    const [identifier, setIdentifier] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Handle back navigation
    const handleBack = useCallback(() => {
        navigate('SignIn');
    }, [navigate]);

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
                setIsLoading(false);
                setSuccessMessage(t('recover.enterCode'));
            },
        },
        {
            id: 'reset',
            component: RecoverResetPasswordStep,
            canProceed: () => true,
        },
        {
            id: 'success',
            component: RecoverSuccessStep,
            canProceed: () => true,
            onEnter: () => {
                setSuccessMessage(t('recover.resetSuccess'));
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
            identifier,
        },
        // Reset step
        {
            identifier,
            verificationCode,
            password,
            confirmPassword,
            setPassword,
            setConfirmPassword,
            errorMessage,
            setErrorMessage,
            isLoading,
            setIsLoading,
            oxyServices,
        },
        // Success step
        {
            successMessage,
        },
    ];

    // Ensure initialStep is a number (defensive check)
    const safeInitialStep = typeof initialStep === 'number' ? initialStep : 0;

    return (
        <StepBasedScreen
            steps={steps}
            initialStep={safeInitialStep}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate}
            goBack={handleBack}
            theme={theme}
            currentScreen={currentScreen}
            oxyServices={oxyServices}
            showProgressIndicator={true}
            enableAnimations={true}
        />
    );
};



export default RecoverAccountScreen; 

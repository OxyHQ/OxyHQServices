import type React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { useThemeColors } from '../styles';
import { toast } from '../../lib/sonner';
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';
import SignUpWelcomeStep from './steps/SignUpWelcomeStep';
import SignUpIdentityStep from './steps/SignUpIdentityStep';
import SignUpSecurityStep from './steps/SignUpSecurityStep';
import SignUpSummaryStep from './steps/SignUpSummaryStep';

// Types for better type safety
interface ValidationState {
    status: 'idle' | 'validating' | 'valid' | 'invalid';
    message: string;
}

// Constants
const USERNAME_MIN_LENGTH = 3;
const PASSWORD_MIN_LENGTH = 8;

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Main component
const SignUpScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
}) => {
    const { signUp, oxyServices } = useOxy();
    const colors = useThemeColors(theme);

    // Form data state
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Validation state
    const [validationState, setValidationState] = useState<ValidationState>({
        status: 'idle',
        message: '',
    });

    // Error message state
    const [errorMessage, setErrorMessage] = useState('');

    // Username validation with caching
    const usernameCache = useRef<Map<string, { available: boolean; timestamp: number }>>(new Map());

    const validateUsername = useCallback(async (usernameToValidate: string): Promise<boolean> => {
        if (!usernameToValidate || usernameToValidate.length < USERNAME_MIN_LENGTH) {
            setValidationState({ status: 'invalid', message: 'Username must be at least 3 characters' });
            return false;
        }

        // Check cache first
        const cached = usernameCache.current.get(usernameToValidate);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < 5 * 60 * 1000) {
            const isValid = cached.available;
            setValidationState({
                status: isValid ? 'valid' : 'invalid',
                message: isValid ? '' : 'Username is already taken'
            });
            return isValid;
        }

        setValidationState({ status: 'validating', message: '' });

        try {
            const result = await oxyServices.checkUsernameAvailability(usernameToValidate);
            const isValid = result.available;

            // Cache the result
            usernameCache.current.set(usernameToValidate, {
                available: isValid,
                timestamp: now
            });

            setValidationState({
                status: isValid ? 'valid' : 'invalid',
                message: isValid ? '' : (result.message || 'Username is already taken')
            });

            return isValid;
        } catch (error: any) {
            console.error('Username validation error:', error);
            setValidationState({
                status: 'invalid',
                message: 'Unable to validate username. Please try again.'
            });
            return false;
        }
    }, [oxyServices]);

    // Email validation
    const validateEmail = useCallback((emailToValidate: string): boolean => {
        return EMAIL_REGEX.test(emailToValidate);
    }, []);

    // Password validation
    const validatePassword = useCallback((passwordToValidate: string): boolean => {
        return passwordToValidate.length >= PASSWORD_MIN_LENGTH;
    }, []);

    // Handle form completion
    const handleComplete = useCallback(async (stepData: any[]) => {
        if (!username || !email || !password) {
            toast.error('Please fill in all required fields');
            return;
        }

        if (!validateEmail(email)) {
            toast.error('Please enter a valid email address');
            return;
        }

        if (!validatePassword(password)) {
            toast.error('Password must be at least 8 characters long');
            return;
        }

        if (password !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }

        try {
            setIsLoading(true);
            const user = await signUp(username, email, password);
            toast.success('Account created successfully! Welcome to Oxy!');

            // Navigate to welcome screen or handle authentication
            navigate('WelcomeNewUser', { newUser: user });
        } catch (error: any) {
            toast.error(error.message || 'Sign up failed');
        } finally {
            setIsLoading(false);
        }
    }, [username, email, password, confirmPassword, validateEmail, validatePassword, signUp, navigate]);

    // Cleanup cache on unmount
    useEffect(() => {
        return () => {
            usernameCache.current.clear();
        };
    }, []);

    // Step configurations
    const steps: StepConfig[] = useMemo(() => [
        {
            id: 'welcome',
            component: SignUpWelcomeStep,
            canProceed: () => true,
        },
        {
            id: 'identity',
            component: SignUpIdentityStep,
            canProceed: () => !!(username.trim() && email.trim() && validateEmail(email) && validationState.status === 'valid'),
            onEnter: () => {
                // Auto-validate username when entering this step
                if (username && validationState.status === 'idle') {
                    validateUsername(username);
                }
            },
        },
        {
            id: 'security',
            component: SignUpSecurityStep,
            canProceed: () => !!(password && validatePassword(password) && password === confirmPassword),
        },
        {
            id: 'summary',
            component: SignUpSummaryStep,
            canProceed: () => true,
        },
    ], [username, email, password, confirmPassword, validationState.status, validateEmail, validatePassword, validateUsername]);

    // Step data for the reusable component
    const stepData = useMemo(() => [
        // Welcome step - no data needed
        {},
        // Identity step
        {
            username,
            email,
            setUsername,
            setEmail,
            validationState,
            setValidationState,
            setErrorMessage,
            validateEmail,
            validateUsername,
        },
        // Security step
        {
            password,
            confirmPassword,
            setPassword,
            setConfirmPassword,
            showPassword,
            showConfirmPassword,
            setShowPassword,
            setShowConfirmPassword,
            setErrorMessage,
            validatePassword,
        },
        // Summary step
        {
            isLoading,
        },
    ], [
        username, email, password, confirmPassword, showPassword, showConfirmPassword,
        validationState, errorMessage, validateEmail, validatePassword, isLoading
    ]);

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
            oxyServices={oxyServices}
        />
    );
};

export default SignUpScreen;
